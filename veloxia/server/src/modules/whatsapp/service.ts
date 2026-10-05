/**
 * WhatsApp: conexão pelo cadastro incorporado da Meta ("Embedded Signup"),
 * modelos de mensagem e estimativa de consumo.
 *
 * Cobrança das mensagens: o cliente cadastra a forma de pagamento na própria
 * conta do WhatsApp Business (a Meta cobra direto dele). O Veloxia só estima
 * o consumo a partir dos status de entrega que a Meta envia por webhook.
 */
import { randomInt } from "node:crypto";
import { and, eq, gte, isNull, like, ne, sql } from "drizzle-orm";
import { APP_NAME, formatPhone, phoneDigits, templateParamCount, WHATSAPP_PRICING_CATEGORIES, type WhatsAppPricingCategory } from "@veloxia/shared";
import { whatsappConfigured, whatsappRates } from "../../config/env";
import { db } from "../../db/client";
import { analyticsDaily, channelAccounts, whatsappTemplates } from "../../db/schema";
import { encrypt } from "../../lib/crypto";
import { badRequest, conflict, unavailable } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { localDay } from "../../lib/time";
import { exchangeEmbeddedSignupCode, WhatsAppApiError, WhatsAppClient, type WaTemplate } from "../../integrations/whatsapp/client";
import { audit, recordSystemError } from "../../services/audit";
import { workspaceTimezone } from "../../services/analytics";
import { publishEvent } from "../../services/events";
import { enqueue } from "../../queue/queue";
import { handleAccountError, subscribeAccountWebhooks } from "../../channels/accounts";
import type { ChannelAccount } from "../../channels/types";
import { wabaIdOf, whatsappClient } from "../../channels/whatsapp";
import { assertCanConnect } from "../billing/limits";

export interface ConnectInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
  /** Número que continua no app WhatsApp Business (coexistência): não precisa registrar. */
  coexistence?: boolean;
}

/** Conclui o cadastro incorporado: troca o código, registra o número, inscreve webhooks e salva a conta. */
export async function connectWhatsApp(workspaceId: string, userId: string, input: ConnectInput): Promise<ChannelAccount> {
  if (!whatsappConfigured()) {
    throw unavailable("A integração com o WhatsApp ainda não foi configurada neste servidor (META_APP_ID, META_APP_SECRET e WHATSAPP_CONFIG_ID).");
  }

  const [other] = await db
    .select({ id: channelAccounts.id })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channel, "whatsapp"),
        eq(channelAccounts.externalId, input.phoneNumberId),
        isNull(channelAccounts.disconnectedAt),
        ne(channelAccounts.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (other) throw conflict(`Este número já está conectado a outro usuário do ${APP_NAME}. Desconecte-o lá antes de conectar aqui.`);

  const [existing] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.workspaceId, workspaceId), eq(channelAccounts.channel, "whatsapp"), eq(channelAccounts.externalId, input.phoneNumberId)))
    .orderBy(channelAccounts.createdAt)
    .limit(1);
  if (!existing || existing.disconnectedAt) await assertCanConnect(workspaceId, "whatsapp");

  let token: string;
  try {
    token = await exchangeEmbeddedSignupCode(input.code);
  } catch (err) {
    await recordSystemError("whatsapp.exchange_code", err, { workspaceId });
    throw badRequest(err instanceof WhatsAppApiError ? err.userMessage : "Não foi possível concluir a conexão com o WhatsApp. Tente novamente.");
  }
  const client = new WhatsAppClient(token);

  let phone;
  try {
    phone = await client.getPhoneNumber(input.phoneNumberId);
  } catch (err) {
    await recordSystemError("whatsapp.get_phone", err, { workspaceId });
    throw badRequest(err instanceof WhatsAppApiError ? err.userMessage : "Não foi possível ler os dados do número do WhatsApp.");
  }

  // Números novos precisam ser registrados na Cloud API; em coexistência o número já está ativo no app.
  if (!input.coexistence) {
    const pin = String(randomInt(100000, 1000000));
    try {
      await client.registerPhone(input.phoneNumberId, pin);
    } catch (err) {
      // Número já registrado (ex.: reconexão) não impede a conexão.
      logger.warn({ err, workspaceId }, "registro do número do WhatsApp não concluído");
      if (err instanceof WhatsAppApiError && (err.kind === "auth" || err.kind === "permission")) {
        throw badRequest(err.userMessage);
      }
    }
  }

  const values = {
    channel: "whatsapp" as const,
    externalId: input.phoneNumberId,
    handle: phoneDigits(phone.display_phone_number ?? "") || input.phoneNumberId,
    name: phone.verified_name ?? null,
    metadata: {
      wabaId: input.wabaId,
      businessId: input.businessId,
      displayPhoneNumber: phone.display_phone_number,
      qualityRating: phone.quality_rating,
      messagingLimitTier: phone.messaging_limit_tier,
      nameStatus: phone.name_status,
      coexistence: !!input.coexistence,
    },
    accessTokenEnc: encrypt(token),
    tokenExpiresAt: null,
    tokenRefreshedAt: new Date(),
    scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
    status: "connected" as const,
    lastError: null,
    lastErrorAt: null,
    disconnectedAt: null,
    connectedAt: new Date(),
    connectedByUserId: userId,
    updatedAt: new Date(),
  };

  let account: ChannelAccount;
  if (existing) {
    [account] = await db.update(channelAccounts).set(values).where(eq(channelAccounts.id, existing.id)).returning();
  } else {
    [account] = await db.insert(channelAccounts).values({ ...values, workspaceId }).returning();
  }

  await subscribeAccountWebhooks(account.id);
  await enqueue("whatsapp.sync_templates", { accountId: account.id }, { dedupeKey: `wa_templates:${account.id}:${Date.now()}` });
  await audit({
    workspaceId,
    userId,
    action: existing ? "whatsapp.reconnected" : "whatsapp.connected",
    entityType: "channel_account",
    entityId: account.id,
    metadata: { phone: formatPhone(account.handle), wabaId: input.wabaId },
  });
  await publishEvent({ workspaceId, type: "channels.updated" });
  return account;
}

/* ------------------------------------------------------------------ */
/* Modelos de mensagem                                                 */
/* ------------------------------------------------------------------ */

function bodyTextOf(components: Record<string, unknown>[] | undefined): string {
  const body = (components ?? []).find((c) => String(c.type).toUpperCase() === "BODY");
  return typeof body?.text === "string" ? body.text : "";
}

export function publicTemplate(t: typeof whatsappTemplates.$inferSelect) {
  const header = t.components.find((c) => String(c.type).toUpperCase() === "HEADER");
  return {
    id: t.id,
    channelAccountId: t.channelAccountId,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    rejectedReason: t.rejectedReason,
    bodyText: t.bodyText,
    headerFormat: header ? String(header.format ?? "TEXT").toUpperCase() : null,
    headerText: header && typeof header.text === "string" ? header.text : null,
    paramsCount: templateParamCount(t.bodyText),
    components: t.components,
    updatedAt: t.updatedAt,
  };
}

/** Busca os modelos na conta do WhatsApp Business e atualiza a cópia local. */
export async function syncTemplates(accountId: string): Promise<number> {
  const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, accountId)).limit(1);
  if (!account || account.disconnectedAt || account.channel !== "whatsapp") return 0;
  const client = whatsappClient(account);
  const wabaId = wabaIdOf(account);
  const all: WaTemplate[] = [];
  try {
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await client.listTemplates(wabaId, after);
      all.push(...(res.data ?? []));
      after = res.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
    }
  } catch (err) {
    await handleAccountError(account, err);
    throw err;
  }
  const seen = new Set<string>();
  for (const t of all) {
    seen.add(`${t.name}|${t.language}`);
    const values = {
      externalId: t.id,
      category: t.category,
      status: t.status,
      rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      components: t.components ?? [],
      bodyText: bodyTextOf(t.components),
      syncedAt: new Date(),
      updatedAt: new Date(),
    };
    await db
      .insert(whatsappTemplates)
      .values({ workspaceId: account.workspaceId, channelAccountId: account.id, wabaId, name: t.name, language: t.language, ...values })
      .onConflictDoUpdate({ target: [whatsappTemplates.channelAccountId, whatsappTemplates.name, whatsappTemplates.language], set: values });
  }
  // Modelos excluídos no WhatsApp Manager somem daqui também.
  const local = await db.select({ id: whatsappTemplates.id, name: whatsappTemplates.name, language: whatsappTemplates.language }).from(whatsappTemplates).where(eq(whatsappTemplates.channelAccountId, account.id));
  for (const t of local) if (!seen.has(`${t.name}|${t.language}`)) await db.delete(whatsappTemplates).where(eq(whatsappTemplates.id, t.id));
  await publishEvent({ workspaceId: account.workspaceId, type: "templates.updated" });
  return all.length;
}

export interface CreateTemplateInput {
  name: string;
  category: "MARKETING" | "UTILITY";
  language: string;
  headerText?: string;
  body: string;
  /** Exemplos para {{1}}, {{2}}… (a Meta exige exemplos para aprovar). */
  examples: string[];
  footer?: string;
  quickReplies: string[];
}

/** Envia um novo modelo para aprovação da Meta. */
export async function createTemplate(account: ChannelAccount, input: CreateTemplateInput) {
  const params = (input.body.match(/\{\{(\d+)\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));
  const expected = params.length ? Math.max(...params) : 0;
  // As variáveis precisam ser {{1}}…{{n}} sem lacunas (podem se repetir).
  if (new Set(params).size !== expected || params.some((n) => n < 1)) throw badRequest("Use variáveis em sequência: {{1}}, {{2}}, {{3}}…");
  if (input.examples.filter((e) => e.trim()).length < expected) throw badRequest("Informe um exemplo para cada variável — a Meta exige exemplos para aprovar o modelo.");

  const components: Record<string, unknown>[] = [];
  if (input.headerText?.trim()) components.push({ type: "HEADER", format: "TEXT", text: input.headerText.trim() });
  components.push({
    type: "BODY",
    text: input.body,
    ...(expected ? { example: { body_text: [input.examples.slice(0, expected).map((e) => e.trim())] } } : {}),
  });
  if (input.footer?.trim()) components.push({ type: "FOOTER", text: input.footer.trim() });
  const replies = input.quickReplies.map((q) => q.trim()).filter(Boolean);
  if (replies.length) components.push({ type: "BUTTONS", buttons: replies.map((text) => ({ type: "QUICK_REPLY", text })) });

  const client = whatsappClient(account);
  const wabaId = wabaIdOf(account);
  try {
    const created = await client.createTemplate(wabaId, { name: input.name, language: input.language, category: input.category, components });
    const [row] = await db
      .insert(whatsappTemplates)
      .values({
        workspaceId: account.workspaceId,
        channelAccountId: account.id,
        wabaId,
        externalId: created.id,
        name: input.name,
        language: input.language,
        category: created.category ?? input.category,
        status: created.status ?? "PENDING",
        components,
        bodyText: input.body,
      })
      .onConflictDoUpdate({
        target: [whatsappTemplates.channelAccountId, whatsappTemplates.name, whatsappTemplates.language],
        set: { externalId: created.id, status: created.status ?? "PENDING", components, bodyText: input.body, updatedAt: new Date() },
      })
      .returning();
    await publishEvent({ workspaceId: account.workspaceId, type: "templates.updated" });
    return row;
  } catch (err) {
    if (err instanceof WhatsAppApiError) {
      await handleAccountError(account, err);
      // A Meta explica o motivo da recusa (nome repetido, conteúdo, categoria).
      throw badRequest(err.kind === "invalid" ? `A Meta recusou o modelo: ${err.message}` : err.userMessage);
    }
    throw err;
  }
}

export async function deleteTemplate(account: ChannelAccount, templateId: string): Promise<void> {
  const [t] = await db
    .select()
    .from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.id, templateId), eq(whatsappTemplates.channelAccountId, account.id)))
    .limit(1);
  if (!t) return;
  try {
    await whatsappClient(account).deleteTemplate(wabaIdOf(account), t.name);
  } catch (err) {
    if (err instanceof WhatsAppApiError) throw badRequest(err.userMessage);
    throw err;
  }
  await db.delete(whatsappTemplates).where(eq(whatsappTemplates.id, t.id));
  await publishEvent({ workspaceId: account.workspaceId, type: "templates.updated" });
}

/* ------------------------------------------------------------------ */
/* Consumo (estimativa)                                                 */
/* ------------------------------------------------------------------ */

export interface WhatsAppUsage {
  from: string;
  to: string;
  categories: { category: WhatsAppPricingCategory; messages: number; rateBRL: number | null; estimatedBRL: number | null }[];
  totalMessages: number;
  estimatedTotalBRL: number;
  /** Mensagens de atendimento grátis por número a cada mês (regra da Meta). */
  freeServicePerNumber: number;
}

/** Mensagens cobradas pela Meta neste mês (por número ou de todos) e o valor estimado. */
export async function whatsappUsage(workspaceId: string, accountId?: string): Promise<WhatsAppUsage> {
  const tz = await workspaceTimezone(workspaceId);
  const today = localDay(new Date(), tz);
  const from = `${today.slice(0, 8)}01`;
  const rows = await db
    .select({ metric: analyticsDaily.metric, value: sql<number>`sum(${analyticsDaily.value})::int` })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.workspaceId, workspaceId),
        gte(analyticsDaily.day, from),
        like(analyticsDaily.metric, "wa_billable_%"),
        accountId ? eq(analyticsDaily.dimension, `c:${accountId}`) : eq(analyticsDaily.dimension, ""),
      ),
    )
    .groupBy(analyticsDaily.metric);
  const counts = new Map(rows.map((r) => [r.metric.replace("wa_billable_", ""), r.value]));
  const rates = whatsappRates();
  const categories = WHATSAPP_PRICING_CATEGORIES.map((category) => {
    const messages = counts.get(category) ?? 0;
    const rate = rates[category] ?? null;
    return { category, messages, rateBRL: rate, estimatedBRL: rate === null ? null : Math.round(messages * rate * 100) / 100 };
  });
  return {
    from,
    to: today,
    categories,
    totalMessages: categories.reduce((n, c) => n + c.messages, 0),
    estimatedTotalBRL: Math.round(categories.reduce((n, c) => n + (c.estimatedBRL ?? 0), 0) * 100) / 100,
    freeServicePerNumber: 1000,
  };
}
