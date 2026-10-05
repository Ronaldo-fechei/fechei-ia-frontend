/**
 * Tradução dos webhooks do WhatsApp (objeto "whatsapp_business_account") para o
 * pipeline comum: mensagens recebidas, status de entrega (com a cobrança da Meta
 * por mensagem) e mudanças de status dos modelos.
 */
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { WHATSAPP_PRICING_CATEGORIES, type WhatsAppPricingCategory } from "@veloxia/shared";
import { db } from "../db/client";
import { channelAccounts, messages, whatsappTemplates } from "../db/schema";
import { classifyWhatsAppError, WhatsAppApiError } from "../integrations/whatsapp/client";
import { track } from "../services/analytics";
import { publishEvent } from "../services/events";
import { handleInboundMessage, recordEcho, type InboundMessage } from "../engine/inbound";
import { handleAccountError } from "./accounts";
import type { ChannelAccount } from "./types";

interface WaInboundMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string; description?: string } };
  button?: { payload?: string; text?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; filename?: string };
  audio?: { id?: string };
  sticker?: { id?: string };
  location?: Record<string, unknown>;
  contacts?: unknown[];
  reaction?: { message_id?: string; emoji?: string };
  referral?: Record<string, unknown>;
  context?: { from?: string; id?: string };
}

interface WaStatus {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
  pricing?: { billable?: boolean; pricing_model?: string; category?: string; type?: string };
}

interface WaMessagesValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaInboundMessage[];
  statuses?: WaStatus[];
  /** Coexistência: mensagens enviadas pelo app WhatsApp Business. */
  message_echoes?: (WaInboundMessage & { to?: string })[];
}

export async function findWhatsAppAccount(phoneNumberId: string): Promise<ChannelAccount | null> {
  if (!phoneNumberId) return null;
  const [account] = await db
    .select(getTableColumns(channelAccounts))
    .from(channelAccounts)
    .where(and(eq(channelAccounts.channel, "whatsapp"), eq(channelAccounts.externalId, phoneNumberId), isNull(channelAccounts.disconnectedAt)))
    .limit(1);
  return account ?? null;
}

/** Processa uma "entry" do webhook do WhatsApp. Retorna quantas mudanças foram tratadas. */
export async function handleWhatsAppEntry(entry: { id?: string; changes?: { field?: string; value?: unknown }[] }): Promise<number> {
  let handled = 0;
  for (const change of entry.changes ?? []) {
    if (change.field === "messages" || change.field === "smb_message_echoes") {
      const value = (change.value ?? {}) as WaMessagesValue;
      const account = await findWhatsAppAccount(value.metadata?.phone_number_id ?? "");
      if (!account) continue;
      handled++;
      await db.update(channelAccounts).set({ lastWebhookAt: new Date() }).where(eq(channelAccounts.id, account.id));
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
      for (const m of value.messages ?? []) await handleMessage(account, m, names.get(m.from ?? "") ?? null);
      for (const st of value.statuses ?? []) await handleStatus(account, st);
      for (const echo of value.message_echoes ?? []) await handleEcho(account, echo);
    } else if (change.field === "message_template_status_update") {
      handled += await handleTemplateStatus(String(entry.id ?? ""), (change.value ?? {}) as Record<string, unknown>);
    }
  }
  return handled;
}

/* ------------------------------------------------------------------ */
/* Mensagens recebidas                                                 */
/* ------------------------------------------------------------------ */

export function parseWhatsAppMessage(m: WaInboundMessage): InboundMessage | null {
  const base = { externalId: m.id ?? null, event: "dm" as const, source: m.referral ? "referral" : "whatsapp" };
  const payload: Record<string, unknown> = {};
  if (m.context?.id) payload.replyTo = m.context;
  if (m.referral) payload.referral = m.referral;
  const withPayload = (extra: Record<string, unknown> = {}) => {
    const p = { ...payload, ...extra };
    return Object.keys(p).length ? p : null;
  };

  switch (m.type) {
    case "text":
      return { ...base, type: "text", text: m.text?.body ?? "", payload: withPayload() };
    case "interactive": {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (!reply) return null;
      return { ...base, type: "quick_reply", text: reply.title ?? "", payload: withPayload({ interactive: m.interactive }), buttonPayload: reply.id };
    }
    case "button":
      // Botão de resposta rápida de um modelo.
      return { ...base, type: "quick_reply", text: m.button?.text ?? "", payload: withPayload({ button: m.button }), buttonPayload: m.button?.payload };
    case "image":
    case "video":
    case "document":
      return { ...base, type: m.type, text: (m[m.type] as { caption?: string } | undefined)?.caption ?? "", payload: withPayload({ media: m[m.type] }) };
    case "audio":
    case "sticker":
    case "location":
    case "contacts":
      return { ...base, type: m.type, text: "", payload: withPayload({ [m.type]: m[m.type as "audio"] }) };
    case "reaction":
    case "system":
    case "ephemeral":
      return null; // sem ação de automação
    default:
      return { ...base, type: "unsupported", text: "", payload: withPayload() };
  }
}

async function handleMessage(account: ChannelAccount, m: WaInboundMessage, profileName: string | null): Promise<void> {
  if (!m.from) return;
  const parsed = parseWhatsAppMessage(m);
  if (!parsed) return;
  const at = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
  await db.transaction(async (tx) => {
    await handleInboundMessage(tx, account, { externalId: m.from!, phone: m.from!, name: profileName }, parsed, at);
  });
}

async function handleEcho(account: ChannelAccount, echo: WaInboundMessage & { to?: string }): Promise<void> {
  if (!echo.to) return;
  const parsed = parseWhatsAppMessage(echo);
  if (!parsed) return;
  const at = echo.timestamp ? new Date(Number(echo.timestamp) * 1000) : new Date();
  await db.transaction(async (tx) => {
    await recordEcho(tx, account, { externalId: echo.to!, phone: echo.to! }, parsed, at);
  });
}

/* ------------------------------------------------------------------ */
/* Status de entrega e cobrança                                         */
/* ------------------------------------------------------------------ */

const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

async function handleStatus(account: ChannelAccount, st: WaStatus): Promise<void> {
  if (!st.id || !st.status) return;
  const [msg] = await db
    .select({ id: messages.id, status: messages.status, payload: messages.payload, conversationId: messages.conversationId, executionId: messages.executionId })
    .from(messages)
    .where(and(eq(messages.channelAccountId, account.id), eq(messages.externalId, st.id)))
    .limit(1);
  if (!msg) return; // mensagem enviada fora do Veloxia

  const update: Partial<typeof messages.$inferInsert> = {};
  if (st.status === "failed") {
    const err = st.errors?.[0];
    const apiErr = new WhatsAppApiError(err?.message ?? err?.title ?? "Falha na entrega", 400, err?.code);
    update.status = "failed";
    update.errorCode = apiErr.errorCode;
    update.errorMessage = apiErr.userMessage;
    if (classifyWhatsAppError(400, err?.code) === "payment" || classifyWhatsAppError(400, err?.code) === "auth") {
      await handleAccountError(account, apiErr);
    }
  } else if ((STATUS_RANK[st.status] ?? -1) > (STATUS_RANK[msg.status] ?? -1)) {
    update.status = st.status as "sent" | "delivered" | "read";
  }

  // Cobrança: conta cada mensagem cobrável uma única vez (a Meta repete o objeto pricing nos status).
  const pricing = st.pricing;
  const category = pricing?.category as WhatsAppPricingCategory | undefined;
  const payload = (msg.payload ?? {}) as Record<string, unknown>;
  if (pricing && !payload.pricing) {
    update.payload = { ...payload, pricing };
    if (pricing.billable && category && (WHATSAPP_PRICING_CATEGORIES as readonly string[]).includes(category)) {
      await track(account.workspaceId, `wa_billable_${category}`, { dimension: `c:${account.id}` });
    }
  }
  if (Object.keys(update).length) {
    await db.update(messages).set(update).where(eq(messages.id, msg.id));
    await publishEvent({ workspaceId: account.workspaceId, type: "message.updated", ids: { conversationId: msg.conversationId } });
  }
}

/* ------------------------------------------------------------------ */
/* Modelos de mensagem                                                 */
/* ------------------------------------------------------------------ */

async function handleTemplateStatus(wabaId: string, value: Record<string, unknown>): Promise<number> {
  const event = String(value.event ?? "");
  const name = String(value.message_template_name ?? "");
  const language = String(value.message_template_language ?? "");
  const externalId = value.message_template_id !== undefined ? String(value.message_template_id) : null;
  if (!event || (!name && !externalId)) return 0;
  const updated = await db
    .update(whatsappTemplates)
    .set({ status: event, rejectedReason: (value.reason as string | undefined) ?? null, updatedAt: new Date(), syncedAt: new Date() })
    .where(
      and(
        eq(whatsappTemplates.wabaId, wabaId),
        externalId ? eq(whatsappTemplates.externalId, externalId) : sql`${whatsappTemplates.name} = ${name} and ${whatsappTemplates.language} = ${language}`,
      ),
    )
    .returning({ workspaceId: whatsappTemplates.workspaceId });
  for (const row of new Set(updated.map((u) => u.workspaceId))) await publishEvent({ workspaceId: row, type: "templates.updated" });
  return updated.length ? 1 : 0;
}
