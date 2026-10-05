/** Planos, assinatura e pagamento (Mercado Pago). */
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BILLING_CYCLES } from "@veloxia/shared";
import { env, paymentsConfigured } from "../../config/env";
import { db } from "../../db/client";
import { plans } from "../../db/schema";
import { forbidden } from "../../lib/errors";
import { emailSchema, parse } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { getUsage, getWorkspacePlan } from "./limits";
import { billingHistory, cancelSubscription, promoEligible, startCheckout } from "./service";

/** Dados do plano para a tabela de preços (sem campos internos). */
export function publicPlan(p: typeof plans.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    annualPriceCents: p.annualPriceCents,
    promoPriceCents: p.promoPriceCents,
    promoMonths: p.promoMonths,
    currency: p.currency,
    limits: p.limits,
    features: p.features,
    perks: p.perks,
    highlighted: p.highlighted,
    isDefault: p.isDefault,
  };
}

export async function billingRoutes(app: FastifyInstance) {
  /** Tabela de preços pública (página inicial). */
  app.get("/plans", async () => {
    const rows = await db.select().from(plans).where(eq(plans.isPublic, true)).orderBy(asc(plans.sortOrder));
    return { plans: rows.map(publicPlan) };
  });

  app.get("/billing", async (req) => {
    const auth = requireAuth(req);
    const { plan, subscription } = await getWorkspacePlan(auth.workspace.id);
    const all = await db.select().from(plans).orderBy(asc(plans.sortOrder));
    return {
      currentPlanId: plan.id,
      subscription: subscription
        ? {
            planId: subscription.planId,
            status: subscription.status,
            provider: subscription.provider,
            billingCycle: subscription.billingCycle,
            amountCents: subscription.amountCents,
            promoEndsAt: subscription.promoEndsAt,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            trialEndsAt: subscription.trialEndsAt,
          }
        : null,
      usage: await getUsage(auth.workspace.id),
      plans: all.filter((p) => p.isPublic || p.id === plan.id).map(publicPlan),
      promoEligible: await promoEligible(auth.workspace.id),
      history: await billingHistory(auth.workspace.id),
      payments: {
        enabled: paymentsConfigured(),
        provider: "Mercado Pago",
        message: paymentsConfigured() ? null : "O pagamento online ainda não está disponível. Para mudar de plano, fale com o suporte.",
        supportEmail: env.SUPPORT_EMAIL || null,
      },
    };
  });

  /** Abre o checkout do Mercado Pago (mensal recorrente ou anual à vista). */
  app.post("/billing/checkout", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requireAuth(req);
    if (auth.memberRole !== "owner") throw forbidden("Apenas o dono da conta pode mudar o plano.");
    const input = parse(
      z.object({
        planId: z.string().max(40),
        cycle: z.enum(BILLING_CYCLES).default("monthly"),
        /** E-mail da conta do Mercado Pago que vai pagar (padrão: e-mail do usuário). */
        payerEmail: emailSchema.optional(),
      }),
      req.body,
    );
    return startCheckout({ workspaceId: auth.workspace.id, userId: auth.user.id, planId: input.planId, cycle: input.cycle, payerEmail: input.payerEmail ?? auth.user.email });
  });

  app.post("/billing/cancel", async (req) => {
    const auth = requireAuth(req);
    if (auth.memberRole !== "owner") throw forbidden("Apenas o dono da conta pode cancelar a assinatura.");
    await cancelSubscription(auth.workspace.id, auth.user.id);
    return { ok: true };
  });
}
