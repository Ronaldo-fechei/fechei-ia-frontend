/**
 * Operações comuns sobre contas de canal (Instagram, WhatsApp…): consulta,
 * dados públicos (sem tokens), tratamento de erros do provedor, webhooks,
 * desconexão e renovação de tokens.
 */
import { and, eq, isNull } from "drizzle-orm";
import { CHANNEL_INFO, formatChannelHandle, formatPhone, type Channel } from "@veloxia/shared";
import { db } from "../db/client";
import { channelAccounts } from "../db/schema";
import { notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { audit, recordSystemError } from "../services/audit";
import { publishEvent } from "../services/events";
import { notify } from "../services/notifications";
import { enqueue } from "../queue/queue";
import { ChannelError } from "../engine/channel";
import { getDriver } from "./registry";
import type { ChannelAccount } from "./types";

/** "Instagram @loja" / "WhatsApp +55 11 99999-0000". */
export function accountLabel(account: Pick<ChannelAccount, "channel" | "handle">): string {
  const handle = account.channel === "whatsapp" ? formatPhone(account.handle) : formatChannelHandle(account.channel, account.handle);
  return `${CHANNEL_INFO[account.channel].label} ${handle}`.trim();
}

/** Dados públicos da conta (nunca inclui token ou PIN). */
export function publicAccount(a: ChannelAccount) {
  const base = {
    id: a.id,
    channel: a.channel,
    externalId: a.externalId,
    handle: a.handle,
    displayHandle: a.channel === "whatsapp" ? formatPhone(a.handle) : formatChannelHandle(a.channel, a.handle),
    name: a.name,
    profilePictureUrl: a.profilePictureUrl,
    status: a.status,
    scopes: a.scopes,
    webhookSubscribedAt: a.webhookSubscribedAt,
    webhookError: a.webhookError,
    lastError: a.lastError,
    lastErrorAt: a.lastErrorAt,
    lastWebhookAt: a.lastWebhookAt,
    connectedAt: a.connectedAt,
    disconnectedAt: a.disconnectedAt,
    tokenExpiresAt: a.tokenExpiresAt,
  };
  if (a.channel === "instagram") {
    return {
      ...base,
      // Compatibilidade: telas do Instagram usam "username".
      username: a.handle,
      accountType: a.accountType,
      followersCount: a.followersCount,
      mediaCount: a.mediaCount,
      permissions: {
        messages: a.scopes.includes("instagram_business_manage_messages"),
        comments: a.scopes.includes("instagram_business_manage_comments"),
      },
    };
  }
  return {
    ...base,
    username: a.handle,
    whatsapp: {
      wabaId: a.metadata.wabaId ?? null,
      qualityRating: a.metadata.qualityRating ?? null,
      messagingLimitTier: a.metadata.messagingLimitTier ?? null,
      nameStatus: a.metadata.nameStatus ?? null,
      coexistence: !!a.metadata.coexistence,
    },
  };
}

export async function listActiveAccounts(workspaceId: string, channel?: Channel): Promise<ChannelAccount[]> {
  return db
    .select()
    .from(channelAccounts)
    .where(
      and(eq(channelAccounts.workspaceId, workspaceId), isNull(channelAccounts.disconnectedAt), channel ? eq(channelAccounts.channel, channel) : undefined),
    )
    .orderBy(channelAccounts.connectedAt);
}

export async function getAccountForWorkspace(workspaceId: string, accountId: string, channel?: Channel): Promise<ChannelAccount> {
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.workspaceId, workspaceId)))
    .limit(1);
  if (!account || (channel && account.channel !== channel)) throw notFound("Conta não encontrada.");
  return account;
}

const channelsPage = (account: ChannelAccount) => `/app/canais?canal=${account.channel}`;

/** Atualiza o estado da conta quando o provedor informa token inválido, falta de permissão ou de pagamento. */
export async function handleAccountError(account: ChannelAccount, err: unknown): Promise<void> {
  const channelErr = err instanceof ChannelError ? err : getDriver(account.channel).toChannelError(err);
  const label = accountLabel(account);
  if (channelErr.kind === "auth") {
    await db
      .update(channelAccounts)
      .set({ status: "token_expired", lastError: channelErr.userMessage, lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(channelAccounts.id, account.id));
    await notify({
      workspaceId: account.workspaceId,
      type: "token_expired",
      severity: "error",
      title: `Reconecte o ${label}`,
      body: "A autorização expirou ou foi revogada. As automações deste canal ficam paradas até você reconectar.",
      linkUrl: channelsPage(account),
      dedupeKey: `token_expired:${account.id}`,
      dedupeWindowMinutes: 24 * 60,
    });
    await publishEvent({ workspaceId: account.workspaceId, type: "channels.updated" });
  } else if (channelErr.kind === "permission" || channelErr.kind === "payment") {
    await db
      .update(channelAccounts)
      .set({ lastError: channelErr.userMessage, lastErrorAt: new Date(), updatedAt: new Date() })
      .where(eq(channelAccounts.id, account.id));
    await notify({
      workspaceId: account.workspaceId,
      type: channelErr.kind === "payment" ? "billing" : "config_error",
      severity: "warning",
      title: channelErr.kind === "payment" ? `${label}: cadastre uma forma de pagamento na Meta` : `${label}: permissão ausente`,
      body: channelErr.userMessage,
      linkUrl: channelsPage(account),
      dedupeKey: `${channelErr.kind}:${account.id}`,
      dedupeWindowMinutes: 12 * 60,
    });
  }
}

export async function subscribeAccountWebhooks(accountId: string): Promise<boolean> {
  const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt) return false;
  const driver = getDriver(account.channel);
  try {
    await driver.subscribeWebhooks(account);
    await db
      .update(channelAccounts)
      .set({ webhookSubscribedAt: new Date(), webhookError: null, updatedAt: new Date() })
      .where(eq(channelAccounts.id, account.id));
    return true;
  } catch (err) {
    const channelErr = driver.toChannelError(err);
    const message = channelErr.kind === "unknown" ? "Falha ao ativar o recebimento de mensagens." : channelErr.userMessage;
    await db.update(channelAccounts).set({ webhookError: message, updatedAt: new Date() }).where(eq(channelAccounts.id, account.id));
    await handleAccountError(account, err);
    await recordSystemError(`${account.channel}.subscribe_webhooks`, err, { workspaceId: account.workspaceId, details: { accountId } });
    if (channelErr.retryable) {
      await enqueue("channel.subscribe_webhooks", { accountId }, { delaySeconds: 60, dedupeKey: `subscribe:${accountId}:${Date.now()}` });
    }
    await notify({
      workspaceId: account.workspaceId,
      type: "webhook_error",
      severity: "error",
      title: `Não foi possível ativar o recebimento de mensagens (${accountLabel(account)})`,
      body: message,
      linkUrl: channelsPage(account),
      dedupeKey: `webhook_sub:${account.id}`,
    });
    return false;
  }
}

export async function disconnectAccount(accountId: string, opts: { userId?: string; reason?: string } = {}): Promise<void> {
  const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt) return;
  try {
    await getDriver(account.channel).cleanup(account);
  } catch (err) {
    logger.warn({ err, accountId }, "não foi possível limpar a conta no provedor (seguindo com a desconexão)");
  }
  await db
    .update(channelAccounts)
    .set({ status: "disconnected", disconnectedAt: new Date(), accessTokenEnc: null, tokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(channelAccounts.id, accountId));
  await audit({
    workspaceId: account.workspaceId,
    userId: opts.userId,
    action: `${account.channel}.disconnected`,
    entityType: "channel_account",
    entityId: account.id,
    metadata: { reason: opts.reason ?? "user", handle: account.handle },
  });
  await publishEvent({ workspaceId: account.workspaceId, type: "channels.updated" });
}

/** Renova o token quando o canal exige (Instagram: token de longa duração de 60 dias). */
export async function refreshAccountToken(accountId: string): Promise<void> {
  const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt || !account.accessTokenEnc) return;
  const driver = getDriver(account.channel);
  if (!driver.refreshToken) return;
  try {
    await driver.refreshToken(account);
  } catch (err) {
    await handleAccountError(account, err);
    if (driver.toChannelError(err).retryable) throw err;
    await recordSystemError(`${account.channel}.refresh_token`, err, { workspaceId: account.workspaceId, details: { accountId } });
  }
}

/** Contas com token perto de expirar (ou já expirado) para renovação/alerta. */
export async function scanTokens(): Promise<void> {
  const now = Date.now();
  const accounts = await db.select().from(channelAccounts).where(isNull(channelAccounts.disconnectedAt));
  for (const account of accounts) {
    if (!account.tokenExpiresAt) continue;
    const msLeft = account.tokenExpiresAt.getTime() - now;
    if (msLeft <= 0) {
      if (account.status !== "token_expired") {
        await db.update(channelAccounts).set({ status: "token_expired", updatedAt: new Date() }).where(eq(channelAccounts.id, account.id));
        await notify({
          workspaceId: account.workspaceId,
          type: "token_expired",
          severity: "error",
          title: `A conexão do ${accountLabel(account)} expirou`,
          body: "Reconecte a conta para que as automações voltem a funcionar.",
          linkUrl: channelsPage(account),
          dedupeKey: `token_expired:${account.id}`,
          dedupeWindowMinutes: 24 * 60,
        });
      }
      continue;
    }
    // Renova quando faltam menos de 30 dias (o token precisa ter pelo menos 24h).
    const refreshedAgo = now - (account.tokenRefreshedAt?.getTime() ?? 0);
    if (msLeft < 30 * 86400_000 && refreshedAgo > 86400_000) {
      await enqueue("channel.refresh_token", { accountId: account.id }, { dedupeKey: `refresh:${account.id}:${new Date().toISOString().slice(0, 10)}` });
    }
  }
}
