/**
 * Planos e limites. Os valores vêm da tabela `plans` (editável sem deploy).
 * `null` ou ausente = ilimitado.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PlanFeatureKey, PlanLimitKey } from "@gatilho/shared";
import { db, type DbOrTx } from "../../db/client";
import { automations, contacts, instagramAccounts, plans, subscriptions, usageCounters } from "../../db/schema";
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
  const valid =
    row &&
    (row.subscription.status === "active" ||
      (row.subscription.status === "trialing" && (!row.subscription.trialEndsAt || row.subscription.trialEndsAt > now)) ||
      (row.subscription.status === "past_due" && (!row.subscription.currentPeriodEnd || row.subscription.currentPeriodEnd > now)));
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

async function monthlyUsage(workspaceId: string, metric: string, tx: DbOrTx): Promise<number> {
  const period = monthPeriod(new Date(), await workspaceTimezone(workspaceId, tx));
  const rows = await tx
    .select({ value: usageCounters.value })
    .from(usageCounters)
    .where(and(eq(usageCounters.workspaceId, workspaceId), eq(usageCounters.period, period), eq(usageCounters.metric, metric)));
  return rows[0]?.value ?? 0;
}

export async function getUsage(workspaceId: string, tx: DbOrTx = db): Promise<Record<PlanLimitKey, number>> {
  const [accounts] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.workspaceId, workspaceId), isNull(instagramAccounts.disconnectedAt)));
  const [active] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(automations)
    .where(and(eq(automations.workspaceId, workspaceId), eq(automations.status, "active")));
  const [contactCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.workspaceId, workspaceId));
  return {
    instagram_accounts: accounts?.n ?? 0,
    active_automations: active?.n ?? 0,
    contacts: contactCount?.n ?? 0,
    messages_per_month: await monthlyUsage(workspaceId, USAGE_METRICS.messages, tx),
    ai_generations_per_month: await monthlyUsage(workspaceId, USAGE_METRICS.ai, tx),
  };
}

const LIMIT_MESSAGES: Record<PlanLimitKey, string> = {
  instagram_accounts: "Seu plano permite {limit} conta(s) do Instagram.",
  active_automations: "Seu plano permite {limit} automações ativas. Pause outra automação ou mude de plano.",
  contacts: "Seu plano permite {limit} contatos.",
  messages_per_month: "Seu plano permite {limit} mensagens automáticas por mês.",
  ai_generations_per_month: "Seu plano permite {limit} gerações com IA por mês.",
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

export async function hasFeature(workspaceId: string, feature: PlanFeatureKey, tx: DbOrTx = db): Promise<boolean> {
  const { plan } = await getWorkspacePlan(workspaceId, tx);
  return plan.features[feature] !== false;
}
