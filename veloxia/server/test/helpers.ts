import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { db } from "../src/db/client";
import { channelAccounts, users, workspaceMembers } from "../src/db/schema";
import { encrypt } from "../src/lib/crypto";
import { setHttpFetch } from "../src/integrations/http";
import { jobHandlers } from "../src/queue/handlers";
import { drainJobs } from "../src/queue/worker";
import { eq } from "drizzle-orm";

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function resetDb(): Promise<void> {
  const rows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' and tablename <> 'plans'`);
  const tables = (rows.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`).join(", ");
  if (tables) await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}

export interface Session {
  cookie: string;
  userId: string;
  workspaceId: string;
}

export async function signup(email = `user${Math.random().toString(36).slice(2, 8)}@teste.com`, password = "senhaForte#2026"): Promise<Session> {
  const a = await getApp();
  const res = await a.inject({
    method: "POST",
    url: "/api/auth/signup",
    headers: { "x-requested-with": "veloxia" },
    payload: { name: "Maria Teste", email, password, acceptTerms: true },
  });
  if (res.statusCode !== 201) throw new Error(`signup falhou: ${res.statusCode} ${res.body}`);
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id));
  return { cookie, userId: user.id, workspaceId: member.workspaceId };
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api(session: Session | null, method: Method, url: string, payload?: unknown): Promise<LightMyRequestResponse & { json: () => any }> {
  const a = await getApp();
  const res = await a.inject({
    method,
    url,
    headers: { ...(session ? { cookie: session.cookie } : {}), "x-requested-with": "veloxia" },
    payload: payload as any,
  });
  return res as any;
}

export async function connectTestAccount(workspaceId: string, overrides: Partial<typeof channelAccounts.$inferInsert> = {}) {
  const [account] = await db
    .insert(channelAccounts)
    .values({
      workspaceId,
      channel: "instagram",
      externalId: overrides.externalId ?? "17841400000000001",
      scopedId: "9000000000000001",
      handle: "minhaloja",
      name: "Minha Loja",
      accountType: "BUSINESS",
      accessTokenEnc: encrypt("IGAA-test-token"),
      tokenExpiresAt: new Date(Date.now() + 50 * 86400_000),
      tokenRefreshedAt: new Date(),
      scopes: ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"],
      status: "connected",
      webhookSubscribedAt: new Date(),
      ...overrides,
    })
    .returning();
  return account;
}

/** Número do WhatsApp conectado para testes (Cloud API). */
export async function connectTestWhatsApp(workspaceId: string, overrides: Partial<typeof channelAccounts.$inferInsert> = {}) {
  const [account] = await db
    .insert(channelAccounts)
    .values({
      workspaceId,
      channel: "whatsapp",
      externalId: overrides.externalId ?? "106540352242922",
      handle: "5511999990000",
      name: "Minha Loja",
      metadata: { wabaId: "102290129340398", displayPhoneNumber: "+55 11 99999-0000" },
      accessTokenEnc: encrypt("EAAG-wa-test-token"),
      scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
      status: "connected",
      webhookSubscribedAt: new Date(),
      ...overrides,
    })
    .returning();
  return account;
}

export interface GraphCall {
  method: string;
  url: URL;
  body: any;
  headers: Record<string, string>;
}

/** Simula a API da Meta: registra chamadas e responde conforme as regras. */
export function mockGraph(responder?: (call: GraphCall) => { status?: number; body: unknown } | undefined) {
  const calls: GraphCall[] = [];
  let counter = 0;
  setHttpFetch(async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}));
    let body: any = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = Object.fromEntries(new URLSearchParams(body));
      }
    }
    const call: GraphCall = { method: init?.method ?? "GET", url, body, headers };
    calls.push(call);
    const custom = responder?.(call);
    if (custom) return new Response(JSON.stringify(custom.body), { status: custom.status ?? 200, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/me/messages")) {
      counter++;
      // Respostas privadas (recipient.comment_id) não devolvem recipient_id neste simulador.
      return Response.json({ ...(body?.recipient?.id ? { recipient_id: body.recipient.id } : {}), message_id: `mid.out.${counter}` });
    }
    if (url.pathname.match(/\/replies$/)) return Response.json({ id: `reply-${++counter}` });
    // WhatsApp Cloud API
    if (url.pathname.match(/\/\d+\/messages$/) && body?.messaging_product === "whatsapp") {
      if (body.status === "read") return Response.json({ success: true });
      counter++;
      return Response.json({ messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.out.${counter}` }] });
    }
    if (url.pathname.endsWith("/oauth/access_token") && url.hostname.includes("facebook")) return Response.json({ access_token: "EAAG-new-business-token" });
    if (url.pathname.match(/\/\d+\/register$/)) return Response.json({ success: true });
    if (url.pathname.endsWith("/message_templates") && (init?.method ?? "GET") === "GET") return Response.json({ data: [] });
    if (url.pathname.endsWith("/message_templates") && init?.method === "POST") return Response.json({ id: `tpl-${++counter}`, status: "PENDING", category: body?.category });
    if (url.searchParams.get("fields")?.includes("display_phone_number")) {
      return Response.json({ id: url.pathname.split("/").pop(), display_phone_number: "+55 11 98888-0000", verified_name: "Loja Nova", quality_rating: "GREEN", messaging_limit_tier: "TIER_250" });
    }
    if (url.pathname.endsWith("/subscribed_apps")) return Response.json({ success: true });
    if (url.searchParams.get("fields")?.includes("is_user_follow_business")) {
      return Response.json({ name: "Ana Cliente", username: "ana.cliente", profile_pic: "https://cdn.test/ana.jpg", is_user_follow_business: true, is_business_follow_user: false });
    }
    return Response.json({ error: { message: "rota não simulada", code: 100 } }, { status: 400 });
  });
  return {
    calls,
    sends: () => calls.filter((c) => c.url.pathname.endsWith("/me/messages")),
    waSends: () => calls.filter((c) => c.url.pathname.match(/\/\d+\/messages$/) && c.body?.messaging_product === "whatsapp" && !c.body?.status),
    restore: () => setHttpFetch(null),
  };
}

export function signWebhook(body: string, secret = "test-app-secret"): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function postWebhook(payload: unknown, opts: { signature?: string } = {}) {
  const a = await getApp();
  const body = JSON.stringify(payload);
  return a.inject({
    method: "POST",
    url: "/api/webhooks/instagram",
    headers: { "content-type": "application/json", "x-hub-signature-256": opts.signature ?? signWebhook(body) },
    payload: body,
  });
}

export function dmPayload(igUserId: string, senderId: string, text: string, mid = `mid.in.${Math.random().toString(36).slice(2)}`, extra: Record<string, unknown> = {}) {
  return {
    object: "instagram",
    entry: [
      {
        id: igUserId,
        time: Date.now(),
        messaging: [{ sender: { id: senderId }, recipient: { id: igUserId }, timestamp: Date.now(), message: { mid, text, ...extra } }],
      },
    ],
  };
}

export async function drain(): Promise<number> {
  return drainJobs(jobHandlers);
}

/** Antecipa jobs agendados (ex.: blocos "Aguardar") para rodarem agora. */
export async function fastForwardJobs(): Promise<void> {
  await db.execute(sql`update jobs set run_at = now() where status = 'pending'`);
}

/** Webhook do WhatsApp assinado com a chave do app da Meta. */
export async function postWhatsAppWebhook(payload: unknown, opts: { signature?: string } = {}) {
  const a = await getApp();
  const body = JSON.stringify(payload);
  return a.inject({
    method: "POST",
    url: "/api/webhooks/whatsapp",
    headers: { "content-type": "application/json", "x-hub-signature-256": opts.signature ?? signWebhook(body, "test-meta-secret") },
    payload: body,
  });
}

/** Mensagem recebida no WhatsApp (formato do webhook da Cloud API). */
export function waPayload(phoneNumberId: string, from: string, message: Record<string, unknown>, opts: { name?: string; wabaId?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: opts.wabaId ?? "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511999990000", phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name: opts.name ?? "Bruno Cliente" } }],
              messages: [{ from, id: `wamid.in.${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
            },
          },
        ],
      },
    ],
  };
}

/** Status de entrega do WhatsApp (com o objeto de cobrança da Meta). */
export function waStatusPayload(phoneNumberId: string, messageId: string, status: string, pricing?: Record<string, unknown>, errors?: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5511999990000", phone_number_id: phoneNumberId },
              statuses: [{ id: messageId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "5511988887777", ...(pricing ? { pricing } : {}), ...(errors ? { errors } : {}) }],
            },
          },
        ],
      },
    ],
  };
}
