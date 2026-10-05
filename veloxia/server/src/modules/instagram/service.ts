/** Conexão oficial do Instagram (OAuth da API do Instagram com login do Instagram). */
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { APP_NAME } from "@veloxia/shared";
import { env, metaConfigured } from "../../config/env";
import { db } from "../../db/client";
import { channelAccounts, oauthStates } from "../../db/schema";
import { encrypt, hashToken, randomToken } from "../../lib/crypto";
import { unavailable } from "../../lib/errors";
import { GraphApiError, InstagramClient } from "../../integrations/instagram/client";
import { buildAuthorizeUrl, exchangeCodeForToken, exchangeForLongLivedToken } from "../../integrations/instagram/oauth";
import { audit, recordSystemError } from "../../services/audit";
import { publishEvent } from "../../services/events";
import { subscribeAccountWebhooks } from "../../channels/accounts";
import type { ChannelAccount } from "../../channels/types";
import { assertCanConnect } from "../billing/limits";

const PROFESSIONAL_TYPES = new Set(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]);
const DEFAULT_RETURN = "/app/canais?canal=instagram";

export async function startOAuth(workspaceId: string, userId: string, returnTo = DEFAULT_RETURN): Promise<string> {
  if (!metaConfigured()) {
    throw unavailable("A integração com o Instagram ainda não foi configurada neste servidor (INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET).");
  }
  const state = randomToken(24);
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({
    stateHash: hashToken(state),
    workspaceId,
    userId,
    returnTo: returnTo.startsWith("/app") || returnTo.startsWith("/onboarding") ? returnTo : DEFAULT_RETURN,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  return buildAuthorizeUrl(state);
}

export interface CallbackResult {
  returnTo: string;
  status: "connected" | "error" | "denied";
  message?: string;
}

/** Processa o retorno do OAuth do Instagram e salva a conta conectada. */
export async function completeOAuth(query: Record<string, string | undefined>): Promise<CallbackResult> {
  const state = query.state ?? "";
  const [row] = state
    ? await db.select().from(oauthStates).where(eq(oauthStates.stateHash, hashToken(state))).limit(1)
    : [];
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return { returnTo: DEFAULT_RETURN, status: "error", message: "A sessão de conexão expirou. Tente conectar novamente." };
  }
  await db.update(oauthStates).set({ usedAt: new Date() }).where(eq(oauthStates.id, row.id));
  const returnTo = row.returnTo;

  if (query.error || !query.code) {
    const denied = query.error === "access_denied" || query.error_reason === "user_denied";
    return {
      returnTo,
      status: denied ? "denied" : "error",
      message: denied ? "A conexão foi cancelada no Instagram." : "O Instagram não autorizou a conexão. Tente novamente.",
    };
  }

  try {
    const short = await exchangeCodeForToken(query.code);
    const long = await exchangeForLongLivedToken(short.accessToken);
    const client = new InstagramClient(long.accessToken);
    const me = await client.getMe();
    const igUserId = String(me.user_id ?? me.id ?? short.userId);
    const accountType = (me.account_type ?? "").toUpperCase();
    if (accountType && !PROFESSIONAL_TYPES.has(accountType)) {
      return {
        returnTo,
        status: "error",
        message: "Esta conta não é profissional. Mude para conta Comercial ou de Criador de conteúdo no app do Instagram e conecte novamente.",
      };
    }

    // Conta já conectada a outro espaço de trabalho?
    const [other] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.channel, "instagram"),
          eq(channelAccounts.externalId, igUserId),
          isNull(channelAccounts.disconnectedAt),
          ne(channelAccounts.workspaceId, row.workspaceId),
        ),
      )
      .limit(1);
    if (other) {
      return {
        returnTo,
        status: "error",
        message: `A conta @${me.username} já está conectada a outro usuário do ${APP_NAME}. Desconecte-a lá antes de conectar aqui.`,
      };
    }

    const [existing] = await db
      .select()
      .from(channelAccounts)
      .where(and(eq(channelAccounts.workspaceId, row.workspaceId), eq(channelAccounts.channel, "instagram"), eq(channelAccounts.externalId, igUserId)))
      .orderBy(channelAccounts.createdAt)
      .limit(1);

    if (!existing || existing.disconnectedAt) {
      const allowed = await assertCanConnect(row.workspaceId, "instagram").then(
        () => null,
        (err: Error & { publicMessage?: string }) => err.publicMessage ?? err.message,
      );
      if (allowed) return { returnTo, status: "error", message: allowed };
    }

    const values = {
      channel: "instagram" as const,
      externalId: igUserId,
      scopedId: me.id ? String(me.id) : null,
      handle: me.username,
      name: me.name ?? null,
      profilePictureUrl: me.profile_picture_url ?? null,
      accountType: accountType || null,
      followersCount: me.followers_count ?? null,
      mediaCount: me.media_count ?? null,
      accessTokenEnc: encrypt(long.accessToken),
      tokenExpiresAt: long.expiresAt,
      tokenRefreshedAt: new Date(),
      scopes: short.permissions.length ? short.permissions : env.META_SCOPES.split(","),
      status: "connected" as const,
      lastError: null,
      lastErrorAt: null,
      disconnectedAt: null,
      connectedAt: new Date(),
      connectedByUserId: row.userId,
      updatedAt: new Date(),
    };

    let account: ChannelAccount;
    if (existing) {
      [account] = await db.update(channelAccounts).set(values).where(eq(channelAccounts.id, existing.id)).returning();
    } else {
      [account] = await db.insert(channelAccounts).values({ ...values, workspaceId: row.workspaceId }).returning();
    }

    await subscribeAccountWebhooks(account.id);
    await audit({
      workspaceId: row.workspaceId,
      userId: row.userId,
      action: existing ? "instagram.reconnected" : "instagram.connected",
      entityType: "channel_account",
      entityId: account.id,
      metadata: { username: me.username },
    });
    await publishEvent({ workspaceId: row.workspaceId, type: "channels.updated" });
    return { returnTo, status: "connected" };
  } catch (err) {
    await recordSystemError("instagram.oauth_callback", err, { workspaceId: row.workspaceId });
    const message = err instanceof GraphApiError ? err.userMessage : "Não foi possível conectar o Instagram. Tente novamente.";
    return { returnTo, status: "error", message };
  }
}

