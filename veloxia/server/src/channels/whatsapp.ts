/** Driver do WhatsApp (Cloud API com cadastro incorporado). */
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import { channelAccounts } from "../db/schema";
import { decrypt } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { toWhatsAppChannelError, WhatsAppChannel } from "../integrations/whatsapp/adapter";
import { WhatsAppClient } from "../integrations/whatsapp/client";
import type { ChannelAccount, ChannelDriver } from "./types";

export function whatsappClient(account: ChannelAccount): WhatsAppClient {
  if (account.channel !== "whatsapp") throw new Error("Conta não é do WhatsApp");
  if (!account.accessTokenEnc || account.disconnectedAt) {
    throw new AppError(409, "channel_disconnected", "O número do WhatsApp está desconectado. Conecte novamente para continuar.");
  }
  return new WhatsAppClient(decrypt(account.accessTokenEnc));
}

export function wabaIdOf(account: ChannelAccount): string {
  const wabaId = account.metadata?.wabaId;
  if (!wabaId) throw new AppError(409, "channel_misconfigured", "Conta do WhatsApp Business não identificada. Conecte o número novamente.");
  return wabaId;
}

export const whatsappDriver: ChannelDriver = {
  channel: "whatsapp",

  adapter: (account) => new WhatsAppChannel(whatsappClient(account), account.externalId),

  toChannelError: toWhatsAppChannelError,

  // As permissões do WhatsApp são concedidas no cadastro incorporado (sem escopos por evento).
  requiredScope: () => null,

  async subscribeWebhooks(account) {
    await whatsappClient(account).subscribeApp(wabaIdOf(account));
  },

  async cleanup(account) {
    const wabaId = account.metadata?.wabaId;
    if (!wabaId || !account.accessTokenEnc) return;
    // Outro número da mesma conta do WhatsApp Business continua conectado: mantém a inscrição.
    const [other] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.channel, "whatsapp"),
          isNull(channelAccounts.disconnectedAt),
          ne(channelAccounts.id, account.id),
          sql`${channelAccounts.metadata}->>'wabaId' = ${wabaId}`,
        ),
      )
      .limit(1);
    if (!other) await whatsappClient(account).unsubscribeApp(wabaId);
  },
};
