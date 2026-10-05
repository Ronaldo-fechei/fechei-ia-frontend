import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { billingPayments, subscriptions } from "../src/db/schema";
import { applyPromoEnds } from "../src/modules/billing/service";
import { getWorkspacePlan } from "../src/modules/billing/limits";
import { api, drain, getApp, mockGraph, resetDb, signup, type GraphCall, type Session } from "./helpers";

let s: Session;
let graph: ReturnType<typeof mockGraph>;
/** Estado simulado do Mercado Pago. */
let mp: { preapprovals: Map<string, any>; payments: Map<string, any>; authorized: Map<string, any>; counter: number };

function mpResponder(call: GraphCall) {
  if (!call.url.hostname.includes("mercadopago")) return undefined;
  const path = call.url.pathname;
  if (call.method === "POST" && path === "/preapproval") {
    const id = `pre_${++mp.counter}`;
    const pre = { id, status: "pending", external_reference: call.body.external_reference, auto_recurring: call.body.auto_recurring, init_point: `https://mp.test/subscriptions/checkout?preapproval_id=${id}` };
    mp.preapprovals.set(id, pre);
    return { status: 201, body: pre };
  }
  const pre = path.match(/^\/preapproval\/(.+)$/);
  if (pre) {
    const current = mp.preapprovals.get(pre[1]);
    if (!current) return { status: 404, body: { message: "not found" } };
    if (call.method === "PUT") {
      if (call.body.status) current.status = call.body.status;
      if (call.body.auto_recurring) current.auto_recurring = { ...current.auto_recurring, ...call.body.auto_recurring };
    }
    return { body: current };
  }
  if (call.method === "POST" && path === "/checkout/preferences") {
    const id = `pref_${++mp.counter}`;
    mp.payments.set(`ref:${call.body.external_reference}`, call.body);
    return { status: 201, body: { id, init_point: `https://mp.test/checkout?pref_id=${id}` } };
  }
  const pay = path.match(/^\/v1\/payments\/(.+)$/);
  if (pay) return { body: mp.payments.get(pay[1]) };
  const ap = path.match(/^\/authorized_payments\/(.+)$/);
  if (ap) return { body: mp.authorized.get(ap[1]) };
  return { status: 404, body: { message: "rota MP não simulada" } };
}

async function mpWebhook(type: string, dataId: string, opts: { badSignature?: boolean } = {}) {
  const ts = String(Date.now());
  const requestId = `req-${Math.random()}`;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = opts.badSignature ? "00" : createHmac("sha256", "test-mp-secret").update(manifest).digest("hex");
  return (await getApp()).inject({
    method: "POST",
    url: `/api/webhooks/mercadopago?data.id=${dataId}&type=${type}`,
    headers: { "content-type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    payload: JSON.stringify({ type, action: "updated", data: { id: dataId } }),
  });
}

beforeEach(async () => {
  await resetDb();
  s = await signup();
  mp = { preapprovals: new Map(), payments: new Map(), authorized: new Map(), counter: 0 };
  graph = mockGraph(mpResponder);
});
afterEach(() => graph.restore());
afterAll(async () => {
  await (await getApp()).close();
});

describe("planos", () => {
  it("tabela de preços pública com a escada Gratuito → Starter → Pro → Business", async () => {
    const res = await (await getApp()).inject({ method: "GET", url: "/api/plans" });
    const plans = res.json().plans;
    expect(plans.map((p: any) => [p.id, p.priceCents])).toEqual([
      ["free", 0],
      ["starter", 3990],
      ["pro", 7990],
      ["business", 14990],
    ]);
    const pro = plans.find((p: any) => p.id === "pro");
    expect(pro.highlighted).toBe(true);
    expect(pro.promoPriceCents).toBe(4990);
    expect(pro.promoMonths).toBe(3);
  });
});

describe("assinatura mensal (Mercado Pago)", () => {
  it("promoção de lançamento → ativação pelo webhook → preço de tabela após 3 meses", async () => {
    const checkout = await api(s, "POST", "/api/billing/checkout", { planId: "pro", cycle: "monthly", payerEmail: "comprador@exemplo.com" });
    expect(checkout.statusCode, checkout.body).toBe(200);
    expect(checkout.json().url).toContain("mp.test/subscriptions");
    const created = graph.calls.find((c) => c.method === "POST" && c.url.pathname === "/preapproval")!;
    expect(created.body.auto_recurring).toMatchObject({ frequency: 1, frequency_type: "months", transaction_amount: 49.9, currency_id: "BRL" });
    expect(created.body.payer_email).toBe("comprador@exemplo.com");
    expect(created.headers.Authorization).toBe("Bearer TEST-mp-token");

    // Assinatura inválida é recusada; sem webhook, nada muda.
    expect((await mpWebhook("subscription_preapproval", "pre_1", { badSignature: true })).statusCode).toBe(401);
    expect((await getWorkspacePlan(s.workspaceId)).plan.id).toBe("free");

    mp.preapprovals.get("pre_1").status = "authorized";
    mp.preapprovals.get("pre_1").next_payment_date = new Date(Date.now() + 30 * 86400_000).toISOString();
    expect((await mpWebhook("subscription_preapproval", "pre_1")).statusCode).toBe(200);
    await drain();
    expect((await getWorkspacePlan(s.workspaceId)).plan.id).toBe("pro");
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, s.workspaceId));
    expect(sub.amountCents).toBe(4990);
    expect(sub.promoEndsAt).not.toBeNull();

    // Cobrança mensal aprovada: estende o período (uma única vez por pagamento).
    mp.authorized.set("ap_1", { id: "ap_1", preapproval_id: "pre_1", payment: { id: 991, status: "approved" } });
    const before = sub.currentPeriodEnd!.getTime();
    await mpWebhook("subscription_authorized_payment", "ap_1");
    await drain();
    await mpWebhook("subscription_authorized_payment", "ap_1");
    await drain();
    const [after] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, s.workspaceId));
    const days = (after.currentPeriodEnd!.getTime() - before) / 86400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);

    // Fim da promoção: o valor das próximas cobranças passa a R$ 79,90.
    await db.update(subscriptions).set({ promoEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.workspaceId, s.workspaceId));
    expect(await applyPromoEnds()).toBe(1);
    expect(mp.preapprovals.get("pre_1").auto_recurring.transaction_amount).toBe(79.9);
    const [full] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, s.workspaceId));
    expect(full.amountCents).toBe(7990);

    // Quem já pagou não recebe a promoção de novo.
    const billing = (await api(s, "GET", "/api/billing")).json();
    expect(billing.promoEligible).toBe(false);
    expect(billing.currentPlanId).toBe("pro");
  });

  it("cancelamento mantém o plano até o fim do período e depois volta ao gratuito", async () => {
    await api(s, "POST", "/api/billing/checkout", { planId: "starter", cycle: "monthly" });
    mp.preapprovals.get("pre_1").status = "authorized";
    await mpWebhook("subscription_preapproval", "pre_1");
    await drain();
    expect((await getWorkspacePlan(s.workspaceId)).plan.id).toBe("starter");

    const res = await api(s, "POST", "/api/billing/cancel");
    expect(res.statusCode).toBe(200);
    expect(mp.preapprovals.get("pre_1").status).toBe("cancelled");
    expect((await getWorkspacePlan(s.workspaceId)).plan.id).toBe("starter");

    await db.update(subscriptions).set({ currentPeriodEnd: new Date(Date.now() - 4 * 86400_000) }).where(eq(subscriptions.workspaceId, s.workspaceId));
    expect((await getWorkspacePlan(s.workspaceId)).plan.id).toBe("free");
  });

  it("cobrança recusada deixa a assinatura em atraso (com aviso)", async () => {
    await api(s, "POST", "/api/billing/checkout", { planId: "pro", cycle: "monthly" });
    mp.preapprovals.get("pre_1").status = "authorized";
    await mpWebhook("subscription_preapproval", "pre_1");
    await drain();
    mp.authorized.set("ap_2", { id: "ap_2", preapproval_id: "pre_1", payment: { id: 992, status: "rejected" } });
    await mpWebhook("subscription_authorized_payment", "ap_2");
    await drain();
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, s.workspaceId));
    expect(sub.status).toBe("past_due");
    // Ainda dentro do período pago: os recursos continuam.
    expect((await getWorkspacePlan(s.workspaceId)).plan.id).toBe("pro");
  });
});

describe("plano anual (Checkout Pro)", () => {
  it("pagamento único aprovado ativa 12 meses", async () => {
    const checkout = await api(s, "POST", "/api/billing/checkout", { planId: "pro", cycle: "annual" });
    expect(checkout.statusCode, checkout.body).toBe(200);
    const pref = graph.calls.find((c) => c.url.pathname === "/checkout/preferences")!;
    expect(pref.body.items[0].unit_price).toBe(799);
    expect(pref.body.notification_url).toBe("https://app.test.local/api/webhooks/mercadopago");
    const [payment] = await db.select().from(billingPayments);
    mp.payments.set("123456", { id: 123456, status: "approved", external_reference: payment.reference, transaction_amount: 799 });

    await mpWebhook("payment", "123456");
    await drain();
    await mpWebhook("payment", "123456"); // reenvio: idempotente
    await drain();
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, s.workspaceId));
    expect(sub.planId).toBe("pro");
    expect(sub.billingCycle).toBe("annual");
    const months = (sub.currentPeriodEnd!.getTime() - Date.now()) / (30 * 86400_000);
    expect(months).toBeGreaterThan(11.5);
    expect(months).toBeLessThan(12.5);
  });

  it("plano gratuito não tem checkout", async () => {
    const res = await api(s, "POST", "/api/billing/checkout", { planId: "free", cycle: "monthly" });
    expect(res.statusCode).toBe(400);
  });
});
