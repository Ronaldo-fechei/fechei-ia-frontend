/**
 * Planos e limites. Os valores vêm da tabela `plans` (editável sem deploy).
 * `null` ou ausente = ilimitado.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { CHANNEL_INFO, type Channel, type Flow, type PlanFeatureKey, type PlanLimitKey } from "@veloxia/shared";
import { db, type DbOrTx } from "../../db/client";
import { automations, channelAccounts, contacts, plans, subscriptions, usageCounters } from "../../db/schema";
import { limitReached } from "../../lib/errors";
import { monthPeriod } from "../../lib/time";
import { workspaceTimezone } from "../../services/analytics";

export type Plan = typeof plans.$inferSelect;

export async function defaultPlan(tx: DbOrTx = db): Promise<Plan> {
  const rows = await tx.select().from(plans).where(eq(plans.isDefault, true)).limit(1);
  if (rows[0]) return rows[0];
  const free = await tx.select().from(plans).where(eq(plans.id, "free")).limit(1);
  if (!free[0]) throw new Error("Nenhum plano cadastrado. Rode as migrações (npm run db:migrate).");
  return free[0];
}

export async function getWorkspacePlan(workspaceId: string, tx: DbOrTx = db) {
  const rows = await tx
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  const now = new Date();
  // Planos pagos pelo Mercado Pago valem até o fim do período pago (+3 dias de tolerância para a cobrança).
  const paidExpired =
    row?.subscription.provider === "mercadopago" &&
    !!row.subscription.currentPeriodEnd &&
    row.subscription.currentPeriodEnd.getTime() + 3 * 86400_000 < now.getTime();
  const valid =
    row &&
    !paidExpired &&
    (row.subscription.status === "active" ||
      (row.subscription.status === "trialing" && (!row.subscription.trialEndsAt || row.subscription.trialEndsAt > now)) ||
      (row.subscription.status === "past_due" && (!row.subscription.currentPeriodEnd || row.subscription.currentPeriodEnd > now)) ||
      // Cancelada: mantém o plano até o fim do período já pago.
      (row.subscription.status === "canceled" && !!row.subscription.currentPeriodEnd && row.subscription.currentPeriodEnd > now));
  const plan = valid ? row.plan : await defaultPlan(tx);
  return { plan, subscription: row?.subscription ?? null, effectivePlanId: plan.id };
}

export const USAGE_METRICS = { messages: "messages_sent", ai: "ai_generations" } as const;

export async function incrementUsage(workspaceId: string, metric: string, value = 1, tx: DbOrTx = db): Promise<void> {
  const period = monthPeriod(new Date(), await workspaceTimezone(workspaceId, tx));
  await tx
    .insert(usageCounters)
    .values({ workspaceId, period, metric, value })
    .onConflictDoUpdate({
      target: [usageCounters.workspaceId, usageCounters.period, usageCounters.metric],
      set: { value: sql`${usageCounters.value} + ${value}` },
    });
}

export async function monthlyUsage(workspaceId: string, metric: string, tx: DbOrTx = db): Promise<number> {
  const period = monthPeriod(new Date(), await workspaceTimezone(workspaceId, tx));
  const rows = await tx
    .select({ value: usageCounters.value })
    .from(usageCounters)
    .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, period), eq(usageCounters.metric, metric)));
  return rows[0]?.value ?? 0;
}

/** Início do mês atual no fuso do espaço de trabalho (expressão SQL). */
function monthStartSql(timezone: string) {
  return sql`(date_trunc('month', now() at time zone ${timezone}) at time zone ${timezone})`;
}

/** Contatos que enviaram mensagem neste mês (fuso do espaço de trabalho). */
export async function activeContactsThisMonth(workspaceId: string, tx: DbOrTx = db): Promise<number> {
  const tz = await workspaceTimezone(workspaceId, tx);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.workspaceId, workspaceId), sql`${contacts.lastInboundAt} >= ${monthStartSql(tz)}`));
  return row?.n ?? 0;
}

/** Indica se uma data cai no mês atual do espaço de trabalho. */
export async function isInCurrentMonth(workspaceId: string, date: Date | null, tx: DbOrTx = db): Promise<boolean> {
  if (!date) return false;
  const tz = await workspaceTimezone(workspaceId, tx);
  return monthPeriod(date, tz) === monthPeriod(new Date(), tz);
}

async function activeChannelCounts(workspaceId: string, tx: DbOrTx): Promise<Record<Channel, number>> {
  const rows = await tx
    .select({ channel: channelAccounts.channel, n: sql<number>`count(*)::int` })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.workspaceId, workspaceId), isNull(channelAccounts.disconnectedAt)))
    .groupBy(channelAccounts.channel);
  const out = { instagram: 0, whatsapp: 0 } as Record<Channel, number>;
  for (const r of rows) out[r.channel] = r.n;
  return out;
}

export async function getUsage(workspaceId: string, tx: DbOrTx = db): Promise<Record<PlanLimitKey, number>> {
  const channels = await activeChannelCounts(workspaceId, tx);
  const [active] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.status, "active")));
  return {
    instagram_accounts: channels.instagram,
    whatsapp_accounts: channels.whatsapp,
    channel_types: Object.values(channels).filter((n) => n > 0).length,
    active_automations: active?.n ?? 0,
    active_contacts_per_month: await activeContactsThisMonth(workspaceId, tx),
    ai_generations_per_month: await monthlyUsage(workspaceId, USAGE_METRICS.ai, tx),
    flow_max_nodes: 0,
  };
}

const LIMIT_MESSAGES: Record<PlanLimitKey, string> = {
  instagram_accounts: "Seu plano permite {limit} conta(s) do Instagram. Mude de plano para conectar mais.",
  whatsapp_accounts: "Seu plano permite {limit} número(s) do WhatsApp. Mude de plano para conectar mais.",
  channel_types:
    "Seu plano permite usar {limit} canal (Instagram ou WhatsApp). Para usar Instagram e WhatsApp juntos, mude para o plano Pro.",
  active_automations: "Seu plano permite {limit} automações ativas. Pause outra automação ou mude de plano.",
  active_contacts_per_month: "Seu plano permite {limit} contatos ativos por mês.",
  ai_generations_per_month: "Seu plano permite {limit} gerações com IA por mês.",
  flow_max_nodes: "Seu plano permite até {limit} blocos por fluxo. Mude de plano para fluxos maiores.",
};

export async function checkLimit(workspaceId: string, key: PlanLimitKey, adding = 1, tx: DbOrTx = db) {
  const { plan } = await getWorkspacePlan(workspaceId, tx);
  const limit = plan.limits[key];
  if (limit === null || limit === undefined) return { ok: true as const, limit: null, used: 0 };
  const used = (await getUsage(workspaceId, tx))[key];
  return { ok: used + adding <= limit, limit, used, message: LIMIT_MESSAGES[key].replace("{limit}", String(limit)) };
}

export async function assertLimit(workspaceId: string, key: PlanLimitKey, adding = 1, tx: DbOrTx = db): Promise<void> {
  const r = await checkLimit(workspaceId, key, adding, tx);
  if (!r.ok) throw limitReached(r.message ?? "Limite do plano atingido.", { key, limit: r.limit, used: r.used });
}

/** Valida se o plano permite conectar mais uma conta deste canal. */
export async function assertCanConnect(workspaceId: string, channel: Channel, tx: DbOrTx = db): Promise<void> {
  await assertLimit(workspaceId, channel === "instagram" ? "instagram_accounts" : "whatsapp_accounts", 1, tx);
  const counts = await activeChannelCounts(workspaceId, tx);
  if (counts[channel] === 0) {
    const { plan } = await getWorkspacePlan(workspaceId, tx);
    const limit = plan.limits.channel_types;
    const used = Object.values(counts).filter((n) => n > 0).length;
    if (limit !== null && limit !== undefined && used + 1 > limit) {
      const connected = (Object.keys(counts) as Channel[]).filter((c) => counts[c] > 0).map((c) => CHANNEL_INFO[c].label);
      throw limitReached(
        `Seu plano permite usar ${limit} tipo de canal e você já usa ${connected.join(" e ")}. Para usar Instagram e WhatsApp juntos, mude para o plano Pro.`,
        { key: "channel_types", limit, used },
      );
    }
  }
}

export async function hasFeature(workspaceId: string, feature: PlanFeatureKey, tx: DbOrTx = db): Promise<boolean> {
  const { plan } = await getWorkspacePlan(workspaceId, tx);
  return plan.features[feature] !== false;
}

const FEATURE_MESSAGES: Record<PlanFeatureKey, string> = {
  flow_builder: "O construtor visual não está incluído no seu plano.",
  multi_channel_automation: "Responder no Instagram e no WhatsApp com a mesma automação está disponível a partir do plano Pro.",
  sequences: "Sequências (esperas longas e modelos do WhatsApp) estão disponíveis a partir do plano Pro.",
  whatsapp_handoff: "O bloco \"Levar para o WhatsApp\" está disponível a partir do plano Pro.",
  comment_automations: "Automações de comentário não estão incluídas no seu plano.",
  advanced_analytics: "O analytics completo está disponível a partir do plano Pro.",
  ai: "Os recursos de IA estão disponíveis a partir do plano Pro.",
  export: "A exportação de contatos não está incluída no seu plano.",
};

export async function assertFeature(workspaceId: string, feature: PlanFeatureKey, tx: DbOrTx = db): Promise<void> {
  if (!(await hasFeature(workspaceId, feature, tx))) throw limitReached(FEATURE_MESSAGES[feature], { feature });
}

/** Recursos do plano exigidos por um fluxo (verificado ao publicar). */
export async function assertFlowAllowed(workspaceId: string, flow: Flow, tx: DbOrTx = db): Promise<void> {
  const { plan } = await getWorkspacePlan(workspaceId, tx);
  const maxNodes = plan.limits.flow_max_nodes;
  if (maxNodes !== null && maxNodes !== undefined && flow.nodes.length > maxNodes) {
    throw limitReached(LIMIT_MESSAGES.flow_max_nodes.replace("{limit}", String(maxNodes)), { key: "flow_max_nodes", limit: maxNodes });
  }
  const trigger = flow.nodes.find((n) => n.type === "trigger");
  const data = trigger?.data as { event?: string; channels?: Channel[] } | undefined;
  const need = (feature: PlanFeatureKey) => {
    if (plan.features[feature] === false) throw limitReached(FEATURE_MESSAGES[feature], { feature });
  };
  if (data?.event === "comment") need("comment_automations");
  if ((data?.channels?.length ?? 1) > 1) need("multi_channel_automation");
  if (flow.nodes.some((n) => n.type === "whatsapp_handoff")) need("whatsapp_handoff");
  if (flow.nodes.some((n) => n.type === "whatsapp_template" || (n.type === "delay" && (n.data as { seconds?: number }).seconds! > 23 * 3600)))
    need("sequences");
}
