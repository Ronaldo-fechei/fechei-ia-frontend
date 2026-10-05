/**
 * Cliente da API do Mercado Pago (assinaturas e Checkout Pro).
 * Referência: mercadopago.com.br/developers (Assinaturas sem plano associado; Checkout Pro; Webhooks).
 */
import { createHmac, randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { safeEqual } from "../../lib/crypto";
import { httpFetch } from "../http";

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "MercadoPagoError";
  }
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface MpPreapproval {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled" | string;
  external_reference?: string;
  payer_email?: string;
  init_point?: string;
  next_payment_date?: string;
  auto_recurring?: { frequency?: number; frequency_type?: string; transaction_amount?: number; currency_id?: string };
}

export interface MpPayment {
  id: number | string;
  status: "approved" | "pending" | "in_process" | "rejected" | "cancelled" | "refunded" | "charged_back" | string;
  external_reference?: string;
  transaction_amount?: number;
  date_approved?: string;
}

export interface MpAuthorizedPayment {
  id: number | string;
  preapproval_id?: string;
  status?: string;
  transaction_amount?: number;
  payment?: { id?: number | string; status?: string };
  date_created?: string;
}

export interface MpPreference {
  id: string;
  init_point: string;
}

async function request<T>(method: "GET" | "POST" | "PUT", path: string, json?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await httpFetch(`${env.MP_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method === "POST" ? { "X-Idempotency-Key": randomUUID() } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new MercadoPagoError(`Falha de rede ao chamar o Mercado Pago: ${(err as Error).message}`, 0);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) throw new MercadoPagoError(String(body?.message ?? body?.error ?? `HTTP ${res.status}`), res.status, body);
  return body as T;
}

export const mercadoPago = {
  /** Assinatura recorrente sem plano associado (o cliente autoriza no checkout do Mercado Pago). */
  createPreapproval(input: {
    reason: string;
    externalReference: string;
    payerEmail: string;
    amount: number;
    backUrl: string;
  }): Promise<MpPreapproval> {
    return request("POST", "/preapproval", {
      reason: input.reason,
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: input.amount, currency_id: "BRL" },
      back_url: input.backUrl,
      status: "pending",
    });
  },

  getPreapproval(id: string): Promise<MpPreapproval> {
    return request("GET", `/preapproval/${encodeURIComponent(id)}`);
  },

  /** Muda o valor das próximas cobranças (ex.: fim do preço promocional). */
  updatePreapprovalAmount(id: string, amount: number): Promise<MpPreapproval> {
    return request("PUT", `/preapproval/${encodeURIComponent(id)}`, { auto_recurring: { transaction_amount: amount, currency_id: "BRL" } });
  },

  cancelPreapproval(id: string): Promise<MpPreapproval> {
    return request("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
  },

  getAuthorizedPayment(id: string): Promise<MpAuthorizedPayment> {
    return request("GET", `/authorized_payments/${encodeURIComponent(id)}`);
  },

  /** Checkout Pro: pagamento único (PIX, cartão ou boleto). */
  createPreference(input: {
    title: string;
    externalReference: string;
    amount: number;
    payerEmail: string;
    backUrl: string;
    notificationUrl: string;
  }): Promise<MpPreference> {
    return request("POST", "/checkout/preferences", {
      items: [{ id: input.externalReference, title: input.title, quantity: 1, unit_price: input.amount, currency_id: "BRL" }],
      payer: { email: input.payerEmail },
      external_reference: input.externalReference,
      back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
      auto_return: "approved",
      notification_url: input.notificationUrl,
      statement_descriptor: "VELOXIA",
    });
  },

  getPayment(id: string): Promise<MpPayment> {
    return request("GET", `/v1/payments/${encodeURIComponent(id)}`);
  },
};

/**
 * Valida a assinatura do webhook (cabeçalho x-signature: "ts=...,v1=...").
 * Manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com HMAC-SHA256 da chave secreta.
 */
export function verifyMercadoPagoSignature(opts: { signature?: string; requestId?: string; dataId?: string; secret: string }): boolean {
  if (!opts.signature || !opts.secret) return false;
  const parts = Object.fromEntries(
    opts.signature.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  let manifest = "";
  if (opts.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(opts.dataId) ? opts.dataId.toLowerCase() : opts.dataId};`;
  if (opts.requestId) manifest += `request-id:${opts.requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac("sha256", opts.secret).update(manifest).digest("hex");
  return safeEqual(expected, v1);
}
