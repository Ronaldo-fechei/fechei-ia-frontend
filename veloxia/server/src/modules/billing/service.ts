/**
 * Cobrança das assinaturas da plataforma via Mercado Pago.
 *
 * - Mensal: assinatura recorrente (cartão). Preço promocional nos primeiros
 *   meses quando o plano tem promoção e o cliente nunca pagou antes; depois o
 *   valor passa automaticamente ao preço de tabela.
 * - Anual: pagamento único pelo Checkout Pro (PIX, cartão ou boleto).
 *
 * Os webhooks só dizem "algo mudou": o estado real é sempre buscado na API do
 * Mercado Pago, e cada pagamento é aplicado uma única vez.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, lt, ne, sql } from "drizzle-orm";
import { APP_NAME, formatBRL, type BillingCycle } from "@veloxia/shared";
import { paymentsConfigured, urls } from "../../config/env";
import { db } from "../../db/client";
import { billingPayments, plans, subscriptions } from "../../db/schema";
import { badRequest, notFound, unavailable } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { mercadoPago, MercadoPagoError } from "../../integrations/mercadopago/client";
import { audit, recordSystemError } from "../../services/audit";
import { publishEvent } from "../../services/events";
import { notify } from "../../services/notifications";

const PROVIDER = "mercadopago";
type Plan = typeof plans.$inferSelect;
type Subscription = typeof subscriptions.$inferSelect;

const addMonths = (date: Date, months: number) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};
const reais = (cents: number) => Math.round(cents) / 100;

/** O preço promocional vale só para quem nunca teve um pagamento aprovado. */
export async function promoEligible(workspaceId: string): Promise<boolean> {
  const [paid] = await db
    .select({ id: billingPayments.id })
    .from(billingPayments)
    .where(and(eq(billingPayments.workspaceId, workspaceId), eq(billingPayments.status, "approved")))
    .limit(1);
  return !paid;
}

export function priceFor(plan: Plan, cycle: BillingCycle, promo: boolean): { amountCents: number; promoMonths: number } {
  if (cycle === "annual") {
    if (!plan.annualPriceCents) throw badRequest("Este plano não tem opção anual.");
    return { amountCents: plan.annualPriceCents, promoMonths: 0 };
  }
  if (promo && plan.promoPriceCents && plan.promoMonths > 0) return { amountCents: plan.promoPriceCents, promoMonths: plan.promoMonths };
  return { amountCents: plan.priceCents, promoMonths: 0 };
}

const returnUrl = () => urls.app("/app/configuracoes?aba=plano&checkout=retorno");

/** Cria o checkout no Mercado Pago e devolve a URL para onde o cliente deve ir. */
export async function startCheckout(input: { workspaceId: string; userId: string; planId: string; cycle: BillingCycle; payerEmail: string }) {
  if (!paymentsConfigured()) throw unavailable("O pagamento online ainda não foi configurado neste servidor (MP_ACCESS_TOKEN).");
  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!plan || !plan.isPublic) throw notFound("Plano não encontrado.");
  if (plan.priceCents <= 0) throw badRequest("Este plano é gratuito: não há o que pagar.");
  const { amountCents } = priceFor(plan, input.cycle, input.cycle === "monthly" && (await promoEligible(input.workspaceId)));
  const reference = `vx_${randomUUID()}`;

  const [row] = await db
    .insert(billingPayments)
    .values({
      workspaceId: input.workspaceId,
      provider: PROVIDER,
      reference,
      kind: input.cycle === "monthly" ? "subscription" : "one_time",
      planId: plan.id,
      billingCycle: input.cycle,
      amountCents,
      createdByUserId: input.userId,
    })
    .returning();

  try {
    if (input.cycle === "monthly") {
      const pre = await mercadoPago.createPreapproval({
        reason: `${APP_NAME} ${plan.name} (mensal)`,
        externalReference: reference,
        payerEmail: input.payerEmail,
        amount: reais(amountCents),
        backUrl: returnUrl(),
      });
      await db.update(billingPayments).set({ providerId: pre.id, checkoutUrl: pre.init_point ?? null, updatedAt: new Date() }).where(eq(billingPayments.id, row.id));
      if (!pre.init_point) throw new MercadoPagoError("O Mercado Pago não devolveu o link de pagamento.", 502);
      return { url: pre.init_point, reference };
    }
    const pref = await mercadoPago.createPreference({
      title: `${APP_NAME} ${plan.name} (anual)`,
      externalReference: reference,
      amount: reais(amountCents),
      payerEmail: input.payerEmail,
      backUrl: returnUrl(),
      notificationUrl: urls.mercadoPagoWebhook(),
    });
    await db.update(billingPayments).set({ providerId: pref.id, checkoutUrl: pref.init_point, updatedAt: new Date() }).where(eq(billingPayments.id, row.id));
    return { url: pref.init_point, reference };
  } catch (err) {
    await db.update(billingPayments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(billingPayments.id, row.id));
    await recordSystemError("billing.checkout", err, { workspaceId: input.workspaceId });
    const detail = err instanceof MercadoPagoError && err.status === 400 ? ` (${err.message})` : "";
    throw badRequest(`Não foi possível abrir o pagamento no Mercado Pago${detail}. Confira o e-mail da sua conta do Mercado Pago e tente novamente.`);
  }
}

async function currentSubscription(workspaceId: string): Promise<Subscription | null> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
  return sub ?? null;
}

/** Aplica o plano pago ao espaço de trabalho. */
async function activate(
  payment: typeof billingPayments.$inferSelect,
  opts: { providerSubscriptionId?: string | null; periodEnd: Date; promoEndsAt?: Date | null; providerStatus?: string },
): Promise<void> {
  const previous = await currentSubscription(payment.workspaceId);
  const values = {
    planId: payment.planId,
    status: "active" as const,
    provider: PROVIDER,
    providerSubscriptionId: opts.providerSubscriptionId ?? null,
    providerStatus: opts.providerStatus ?? null,
    billingCycle: payment.billingCycle,
    amountCents: payment.amountCents,
    promoEndsAt: opts.promoEndsAt ?? null,
    currentPeriodStart: new Date(),
    currentPeriodEnd: opts.periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialEndsAt: null,
    lastPaymentAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(subscriptions).values({ workspaceId: payment.workspaceId, ...values }).onConflictDoUpdate({ target: subscriptions.workspaceId, set: values });

  // Trocou de plano ou de ciclo: a assinatura recorrente anterior é cancelada no Mercado Pago.
  if (previous?.provider === PROVIDER && previous.providerSubscriptionId && previous.providerSubscriptionId !== opts.providerSubscriptionId) {
    await mercadoPago.cancelPreapproval(previous.providerSubscriptionId).catch((err) => logger.warn({ err }, "não foi possível cancelar a assinatura anterior"));
  }

  const [plan] = await db.select({ name: plans.name }).from(plans).where(eq(plans.id, payment.planId)).limit(1);
  await notify({
    workspaceId: payment.workspaceId,
    type: "billing",
    severity: "success",
    title: `Plano ${plan?.name ?? payment.planId} ativado`,
    body: `Pagamento confirmado pelo Mercado Pago (${formatBRL(payment.amountCents)}). Obrigado!`,
    linkUrl: "/app/configuracoes?aba=plano",
  });
  await audit({ workspaceId: payment.workspaceId, action: "billing.activated", metadata: { planId: payment.planId, cycle: payment.billingCycle, reference: payment.reference } });
  await publishEvent({ workspaceId: payment.workspaceId, type: "billing.updated" });
}

/** Registra um pagamento do provedor uma única vez. Retorna false se já tinha sido aplicado. */
async function markPaymentId(paymentRowId: string, providerPaymentId: string): Promise<boolean> {
  const updated = await db
    .update(billingPayments)
    .set({ providerPaymentIds: sql`array_append(${billingPayments.providerPaymentIds}, ${providerPaymentId})`, updatedAt: new Date() })
    .where(and(eq(billingPayments.id, paymentRowId), sql`not (${providerPaymentId} = any(${billingPayments.providerPaymentIds}))`))
    .returning({ id: billingPayments.id });
  return updated.length > 0;
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/** Assinatura recorrente criada/alterada (autorizada, pausada, cancelada). */
export async function syncPreapproval(preapprovalId: string): Promise<void> {
  const pre = await mercadoPago.getPreapproval(preapprovalId);
  const [payment] = pre.external_reference
    ? await db.select().from(billingPayments).where(eq(billingPayments.reference, pre.external_reference)).limit(1)
    : [];
  if (!payment) {
    logger.info({ preapprovalId }, "assinatura do Mercado Pago sem pedido correspondente — ignorada");
    return;
  }
  const sub = await currentSubscription(payment.workspaceId);

  if (pre.status === "authorized") {
    const already = sub?.provider === PROVIDER && sub.providerSubscriptionId === pre.id && sub.status === "active";
    await db.update(billingPayments).set({ status: "approved", paidAt: payment.paidAt ?? new Date(), updatedAt: new Date() }).where(eq(billingPayments.id, payment.id));
    if (!already) {
      const [plan] = await db.select().from(plans).where(eq(plans.id, payment.planId)).limit(1);
      const promoMonths = plan?.promoPriceCents === payment.amountCents && plan.promoMonths > 0 ? plan.promoMonths : 0;
      await activate(payment, {
        providerSubscriptionId: pre.id,
        providerStatus: pre.status,
        periodEnd: pre.next_payment_date ? new Date(pre.next_payment_date) : addMonths(new Date(), 1),
        promoEndsAt: promoMonths ? addMonths(new Date(), promoMonths) : null,
      });
    }
    return;
  }

  if (pre.status === "cancelled" || pre.status === "paused") {
    if (payment.status === "pending") await db.update(billingPayments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(billingPayments.id, payment.id));
    if (sub?.providerSubscriptionId === pre.id && sub.status !== "canceled") {
      // Mantém o plano até o fim do período já pago.
      await db
        .update(subscriptions)
        .set({ status: "canceled", providerStatus: pre.status, cancelAtPeriodEnd: true, canceledAt: new Date(), updatedAt: new Date() })
        .where(eq(subscriptions.workspaceId, payment.workspaceId));
      await notify({
        workspaceId: payment.workspaceId,
        type: "billing",
        severity: "warning",
        title: "Assinatura cancelada",
        body: sub.currentPeriodEnd
          ? `Seu plano continua ativo até ${sub.currentPeriodEnd.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Depois, a conta volta para o plano gratuito.`
          : "A conta volta para o plano gratuito.",
        linkUrl: "/app/configuracoes?aba=plano",
      });
      await publishEvent({ workspaceId: payment.workspaceId, type: "billing.updated" });
    }
  }
}

/** Cobrança mensal de uma assinatura (aprovada ou recusada). */
export async function syncAuthorizedPayment(authorizedPaymentId: string): Promise<void> {
  const ap = await mercadoPago.getAuthorizedPayment(authorizedPaymentId);
  if (!ap.preapproval_id) return;
  const [payment] = await db.select().from(billingPayments).where(eq(billingPayments.providerId, ap.preapproval_id)).limit(1);
  if (!payment) return;
  const status = ap.payment?.status ?? ap.status;
  const sub = await currentSubscription(payment.workspaceId);
  if (!sub || sub.providerSubscriptionId !== ap.preapproval_id) {
    // A assinatura ainda não foi ativada: sincroniza pelo estado da própria assinatura.
    await syncPreapproval(ap.preapproval_id);
    return;
  }
  if (status === "approved") {
    if (!(await markPaymentId(payment.id, `ap:${ap.id}`))) return;
    const base = sub.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    await db
      .update(subscriptions)
      .set({ status: "active", lastPaymentAt: new Date(), currentPeriodEnd: addMonths(base, 1), updatedAt: new Date() })
      .where(eq(subscriptions.workspaceId, payment.workspaceId));
    await publishEvent({ workspaceId: payment.workspaceId, type: "billing.updated" });
  } else if (status === "rejected") {
    await db.update(subscriptions).set({ status: "past_due", updatedAt: new Date() }).where(eq(subscriptions.workspaceId, payment.workspaceId));
    await notify({
      workspaceId: payment.workspaceId,
      type: "billing",
      severity: "error",
      title: "Pagamento da assinatura recusado",
      body: "O Mercado Pago não conseguiu cobrar o cartão. Atualize a forma de pagamento no Mercado Pago para não perder os recursos do plano.",
      linkUrl: "/app/configuracoes?aba=plano",
      dedupeKey: `billing_rejected:${payment.workspaceId}`,
      dedupeWindowMinutes: 24 * 60,
    });
    await publishEvent({ workspaceId: payment.workspaceId, type: "billing.updated" });
  }
}

/** Pagamento único (plano anual pelo Checkout Pro). */
export async function syncPayment(paymentId: string): Promise<void> {
  const p = await mercadoPago.getPayment(paymentId);
  if (!p.external_reference) return;
  const [payment] = await db.select().from(billingPayments).where(eq(billingPayments.reference, p.external_reference)).limit(1);
  if (!payment || payment.kind !== "one_time") return;
  if (p.status === "approved") {
    if (!(await markPaymentId(payment.id, `p:${p.id}`))) return;
    await db.update(billingPayments).set({ status: "approved", paidAt: new Date(), updatedAt: new Date() }).where(eq(billingPayments.id, payment.id));
    const sub = await currentSubscription(payment.workspaceId);
    // Renovação antecipada do mesmo plano soma 12 meses ao período atual.
    const base = sub?.planId === payment.planId && sub.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    await activate({ ...payment, status: "approved" }, { providerSubscriptionId: null, periodEnd: addMonths(base, 12) });
  } else if (p.status === "rejected" || p.status === "cancelled") {
    await db.update(billingPayments).set({ status: p.status === "rejected" ? "rejected" : "cancelled", updatedAt: new Date() }).where(eq(billingPayments.id, payment.id));
  } else if (p.status === "refunded" || p.status === "charged_back") {
    await db.update(billingPayments).set({ status: "refunded", updatedAt: new Date() }).where(eq(billingPayments.id, payment.id));
    await db
      .update(subscriptions)
      .set({ status: "canceled", currentPeriodEnd: new Date(), canceledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(subscriptions.workspaceId, payment.workspaceId), eq(subscriptions.planId, payment.planId)));
    await publishEvent({ workspaceId: payment.workspaceId, type: "billing.updated" });
  }
}

/** Trata uma notificação do Mercado Pago (tipo + id do recurso). */
export async function handleMercadoPagoNotification(type: string, id: string): Promise<void> {
  if (!id) return;
  if (type === "subscription_preapproval" || type === "preapproval") return syncPreapproval(id);
  if (type === "subscription_authorized_payment" || type === "authorized_payment") return syncAuthorizedPayment(id);
  if (type === "payment") return syncPayment(id);
}

/* ------------------------------------------------------------------ */
/* Cancelamento e manutenção                                           */
/* ------------------------------------------------------------------ */

export async function cancelSubscription(workspaceId: string, userId: string): Promise<void> {
  const sub = await currentSubscription(workspaceId);
  if (!sub || sub.provider !== PROVIDER || sub.status === "canceled") throw badRequest("Não há assinatura paga ativa para cancelar.");
  if (sub.providerSubscriptionId) {
    try {
      await mercadoPago.cancelPreapproval(sub.providerSubscriptionId);
    } catch (err) {
      await recordSystemError("billing.cancel", err, { workspaceId });
      throw badRequest("Não foi possível cancelar no Mercado Pago agora. Tente novamente em alguns minutos.");
    }
  }
  await db
    .update(subscriptions)
    .set({ status: "canceled", cancelAtPeriodEnd: true, canceledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.workspaceId, workspaceId));
  await audit({ workspaceId, userId, action: "billing.canceled" });
  await publishEvent({ workspaceId, type: "billing.updated" });
}

/** Fim do preço promocional: as próximas cobranças passam ao preço de tabela. */
export async function applyPromoEnds(): Promise<number> {
  const due = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(subscriptions.provider, PROVIDER),
        eq(subscriptions.status, "active"),
        eq(subscriptions.billingCycle, "monthly"),
        isNotNull(subscriptions.providerSubscriptionId),
        isNotNull(subscriptions.promoEndsAt),
        lt(subscriptions.promoEndsAt, new Date()),
        ne(subscriptions.amountCents, plans.priceCents),
      ),
    );
  let changed = 0;
  for (const { sub, plan } of due) {
    try {
      await mercadoPago.updatePreapprovalAmount(sub.providerSubscriptionId!, reais(plan.priceCents));
      await db.update(subscriptions).set({ amountCents: plan.priceCents, promoEndsAt: null, updatedAt: new Date() }).where(eq(subscriptions.id, sub.id));
      await notify({
        workspaceId: sub.workspaceId,
        type: "billing",
        severity: "info",
        title: "Fim do preço de lançamento",
        body: `A partir da próxima cobrança, o plano ${plan.name} passa a ${formatBRL(plan.priceCents)}/mês.`,
        linkUrl: "/app/configuracoes?aba=plano",
      });
      changed++;
    } catch (err) {
      await recordSystemError("billing.promo_end", err, { workspaceId: sub.workspaceId });
    }
  }
  return changed;
}

export async function billingHistory(workspaceId: string) {
  return db
    .select({
      id: billingPayments.id,
      planId: billingPayments.planId,
      billingCycle: billingPayments.billingCycle,
      amountCents: billingPayments.amountCents,
      status: billingPayments.status,
      kind: billingPayments.kind,
      createdAt: billingPayments.createdAt,
      paidAt: billingPayments.paidAt,
    })
    .from(billingPayments)
    .where(and(eq(billingPayments.workspaceId, workspaceId), ne(billingPayments.status, "cancelled")))
    .orderBy(desc(billingPayments.createdAt))
    .limit(24);
}
