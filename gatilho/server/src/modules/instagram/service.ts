import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { APP_NAME } from "@gatilho/shared";
import { env, metaConfigured } from "../../config/env";
import { db } from "../../db/client";
import { instagramAccounts, oauthStates } from "../../db/schema";
import { decrypt, encrypt, hashToken, randomToken } from "../../lib/crypto";
import { AppError, notFound, unavailable } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { GraphApiError, InstagramClient } from "../../integrations/instagram/client";
import { buildAuthorizeUrl, exchangeCodeForToken, exchangeForLongLivedToken, refreshLongLivedToken } from "../../integrations/instagram/oauth";
import { audit, recordSystemError } from "../../services/audit";
import { publishEvent } from "../../services/events";
import { notify } from "../../services/notifications";
import { enqueue } from "../../queue/queue";
import { checkLimit } from "../billing/limits";

export type InstagramAccount = typeof instagramAccounts.$inferSelect;

const PROFESSIONAL_TYPES = new Set(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]);

/** Dados públicos da conta (nunca inclui token). */
export function publicAccount(a: InstagramAccount) {
  return {
    id: a.id,
    igUserId: a.igUserId,
    username: a.username,
    name: a.name,
    profilePictureUrl: a.profilePictureUrl,
    accountType: a.accountType,
    followersCount: a.followersCount,
    mediaCount: a.mediaCount,
    scopes: a.scopes,
    status: a.status,
    tokenExpiresAt: a.tokenExpiresAt,
    webhookSubscribedAt: a.webhookSubscribedAt,
    webhookError: a.webhookError,
    lastError: a.lastError,
    lastErrorAt: a.lastErrorAt,
    lastWebhookAt: a.lastWebhookAt,
    connectedAt: a.connectedAt,
    disconnectedAt: a.disconnectedAt,
    permissions: {
      messages: a.scopes.includes("instagram_business_manage_messages"),
      comments: a.scopes.includes("instagram_business_manage_comments"),
    },
  };
}

export async function startOAuth(workspaceId: string, userId: string, returnTo = "/app/instagram"): Promise<string> {
  if (!metaConfigured()) {
    throw unavailable("A integração com o Instagram ainda não foi configurada neste servidor (INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET).");
  }
  const state = randomToken(24);
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  await db.insert(oauthStates).values({
    stateHash: hashToken(state),
    workspaceId,
    userId,
    returnTo: returnTo.startsWith("/app") || returnTo.startsWith("/onboarding") ? returnTo : "/app/instagram",
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
    return { returnTo: "/app/instagram", status: "error", message: "A sessão de conexão expirou. Tente conectar novamente." };
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
      .select({ id: instagramAccounts.id })
      .from(instagramAccounts)
      .where(and(eq(instagramAccounts.igUserId, igUserId), isNull(instagramAccounts.disconnectedAt), ne(instagramAccounts.workspaceId, row.workspaceId)))
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
      .from(instagramAccounts)
      .where(and(eq(instagramAccounts.workspaceId, row.workspaceId), eq(instagramAccounts.igUserId, igUserId)))
      .orderBy(instagramAccounts.createdAt)
      .limit(1);

    if (!existing || existing.disconnectedAt) {
      const limit = await checkLimit(row.workspaceId, "instagram_accounts");
      if (!limit.ok) return { returnTo, status: "error", message: limit.message };
    }

    const values = {
      igUserId,
      igScopedId: me.id ? String(me.id) : null,
      username: me.username,
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

    let account: InstagramAccount;
    if (existing) {
      [account] = await db.update(instagramAccounts).set(values).where(eq(instagramAccounts.id, existing.id)).returning();
    } else {
      [account] = await db.insert(instagramAccounts).values({ ...values, workspaceId: row.workspaceId }).returning();
    }

    await subscribeAccountWebhooks(account.id);
    await audit({ workspaceId: row.workspaceId, userId: row.userId, action: existing ? "instagram.reconnected" : "instagram.connected", entityType: "instagram_account", entityId: account.id, metadata: { username: me.username } });
    await publishEvent({ workspaceId: row.workspaceId, type: "instagram.updated" });
    return { returnTo, status: "connected" };
  } catch (err) {
    await recordSystemError("instagram.oauth_callback", err, { workspaceId: row.workspaceId });
    const message = err instanceof GraphApiError ? err.userMessage : "Não foi possível conectar o Instagram. Tente novamente.";
    return { returnTo, status: "error", message };
  }
}

export async function getAccountForWorkspace(workspaceId: string, accountId: string): Promise<InstagramAccount> {
  const [account] = await db
    .select()
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.id, accountId), eq(instagramAccounts.workspaceId, workspaceId)))
    .limit(1);
  if (!account) throw notFound("Conta do Instagram não encontrada.");
  return account;
}

export function clientFor(account: InstagramAccount): InstagramClient {
  if (!account.accessTokenEnc || account.disconnectedAt) {
    throw new AppError(409, "instagram_disconnected", "A conta do Instagram está desconectada. Reconecte para continuar.");
  }
  return new InstagramClient(decrypt(account.accessTokenEnc));
}

/** Atualiza o estado da conta quando a API informa token inválido/sem permissão. */
export async function handleAccountGraphError(account: InstagramAccount, err: unknown): Promise<void> {
  if (!(err instanceof GraphApiError)) return;
  if (err.kind === "auth") {
    await db
      .update(instagramAccounts)
      .set({ status: "token_expired", lastError: err.userMessage, lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(instagramAccounts.id, account.id));
    await notify({
      workspaceId: account.workspaceId,
      type: "token_expired",
      severity: "error",
      title: `Reconecte o Instagram @${account.username}`,
      body: "A autorização do Instagram expirou ou foi revogada. As automações ficam paradas até você reconectar.",
      linkUrl: "/app/instagram",
      dedupeKey: `token_expired:${account.id}`,
      dedupeWindowMinutes: 24 * 60,
    });
    await publishEvent({ workspaceId: account.workspaceId, type: "instagram.updated" });
  } else if (err.kind === "permission") {
    await db
      .update(instagramAccounts)
      .set({ lastError: err.userMessage, lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(instagramAccounts.id, account.id));
    await notify({
      workspaceId: account.workspaceId,
      type: "config_error",
      severity: "warning",
      title: "Permissão do Instagram ausente",
      body: err.userMessage,
      linkUrl: "/app/instagram",
      dedupeKey: `permission:${account.id}`,
      dedupeWindowMinutes: 12 * 60,
    });
  }
}

export async function subscribeAccountWebhooks(accountId: string): Promise<boolean> {
  const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt) return false;
  try {
    const fields = env.META_WEBHOOK_FIELDS.split(",").map((f) => f.trim()).filter(Boolean);
    await clientFor(account).subscribeWebhooks(fields);
    await db
      .update(instagramAccounts)
      .set({ webhookSubscribedAt: new Date(), webhookError: null, updatedAt: new Date() })
      .where(eq(instagramAccounts.id, account.id));
    return true;
  } catch (err) {
    const message = err instanceof GraphApiError ? err.userMessage : "Falha ao ativar o recebimento de mensagens.";
    await db.update(instagramAccounts).set({ webhookError: message, updatedAt: new Date() }).where(eq(instagramAccounts.id, account.id));
    await handleAccountGraphError(account, err);
    await recordSystemError("instagram.subscribe_webhooks", err, { workspaceId: account.workspaceId, details: { accountId } });
    if (err instanceof GraphApiError && err.retryable) {
      await enqueue("instagram.subscribe_webhooks", { accountId }, { delaySeconds: 60, dedupeKey: `subscribe:${accountId}:${Date.now()}` });
    }
    await notify({
      workspaceId: account.workspaceId,
      type: "webhook_error",
      severity: "error",
      title: "Não foi possível ativar o recebimento de mensagens",
      body: message,
      linkUrl: "/app/instagram",
      dedupeKey: `webhook_sub:${account.id}`,
    });
    return false;
  }
}

export async function disconnectAccount(accountId: string, opts: { userId?: string; reason?: string } = {}): Promise<void> {
  const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt) return;
  if (account.accessTokenEnc) {
    try {
      await clientFor(account).unsubscribeWebhooks();
    } catch (err) {
      logger.warn({ err, accountId }, "não foi possível cancelar a inscrição de webhooks (seguindo com a desconexão)");
    }
  }
  await db
    .update(instagramAccounts)
    .set({ status: "disconnected", disconnectedAt: new Date(), accessTokenEnc: null, tokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(instagramAccounts.id, accountId));
  await audit({ workspaceId: account.workspaceId, userId: opts.userId, action: "instagram.disconnected", entityType: "instagram_account", entityId: account.id, metadata: { reason: opts.reason ?? "user" } });
  await publishEvent({ workspaceId: account.workspaceId, type: "instagram.updated" });
}

/** Renova o token de longa duração (válido por 60 dias). */
export async function refreshAccountToken(accountId: string): Promise<void> {
  const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt || !account.accessTokenEnc) return;
  try {
    const refreshed = await refreshLongLivedToken(decrypt(account.accessTokenEnc));
    await db
      .update(instagramAccounts)
      .set({
        accessTokenEnc: encrypt(refreshed.accessToken),
        tokenExpiresAt: refreshed.expiresAt,
        tokenRefreshedAt: new Date(),
        status: account.status === "token_expired" ? "connected" : account.status,
        updatedAt: new Date(),
      })
      .where(eq(instagramAccounts.id, account.id));
  } catch (err) {
    await handleAccountGraphError(account, err);
    if (err instanceof GraphApiError && err.retryable) throw err;
    await recordSystemError("instagram.refresh_token", err, { workspaceId: account.workspaceId, details: { accountId } });
  }
}

/** Contas com token perto de expirar (ou já expirado) para renovação/alerta. */
export async function scanTokens(): Promise<void> {
  const now = Date.now();
  const accounts = await db.select().from(instagramAccounts).where(isNull(instagramAccounts.disconnectedAt));
  for (const account of accounts) {
    if (!account.tokenExpiresAt) continue;
    const msLeft = account.tokenExpiresAt.getTime() - now;
    if (msLeft <= 0) {
      if (account.status !== "token_expired") {
        await db.update(instagramAccounts).set({ status: "token_expired", updatedAt: new Date() }).where(eq(instagramAccounts.id, account.id));
        await notify({
          workspaceId: account.workspaceId,
          type: "token_expired",
          severity: "error",
          title: `Token do Instagram @${account.username} expirou`,
          body: "Reconecte a conta para que as automações voltem a funcionar.",
          linkUrl: "/app/instagram",
          dedupeKey: `token_expired:${account.id}`,
          dedupeWindowMinutes: 24 * 60,
        });
      }
      continue;
    }
    // Renova quando faltam menos de 30 dias (o token precisa ter pelo menos 24h).
    const refreshedAgo = now - (account.tokenRefreshedAt?.getTime() ?? 0);
    if (msLeft < 30 * 86400_000 && refreshedAgo > 86400_000) {
      await enqueue("instagram.refresh_token", { accountId: account.id }, { dedupeKey: `refresh:${account.id}:${new Date().toISOString().slice(0, 10)}` });
    }
  }
}
