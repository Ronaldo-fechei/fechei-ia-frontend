import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { automationExecutions, channelAccounts, oauthStates } from "../src/db/schema";
import { api, connectTestAccount, dmPayload, drain, getApp, mockGraph, postWebhook, resetDb, signup, type Session } from "./helpers";

let s: Session;
let graph: ReturnType<typeof mockGraph>;

beforeEach(async () => {
  await resetDb();
  s = await signup();
  graph = mockGraph();
});
afterEach(() => graph.restore());
afterAll(async () => {
  await (await getApp()).close();
});

describe("conexão oficial com o Instagram (OAuth)", () => {
  it("conecta, salva token criptografado, inscreve webhooks e reconecta", async () => {
    graph.restore();
    graph = mockGraph((call) => {
      if (call.url.hostname === "api.instagram.com") {
        return { body: { data: [{ access_token: "SHORT", user_id: "9001", permissions: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments" }] } };
      }
      if (call.url.pathname === "/access_token") return { body: { access_token: "LONG-TOKEN", token_type: "bearer", expires_in: 5184000 } };
      if (call.url.pathname.endsWith("/me") && call.method === "GET") {
        return { body: { id: "9001", user_id: "17841499999999999", username: "lojateste", name: "Loja Teste", account_type: "BUSINESS", followers_count: 1234 } };
      }
      return undefined;
    });
    const start = await api(s, "POST", "/api/instagram/connect", {});
    expect(start.statusCode).toBe(200);
    const url = new URL(start.json().url);
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toContain("instagram_business_manage_messages");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test.local/api/instagram/callback");
    const state = url.searchParams.get("state")!;

    const app = await getApp();
    const cb = await app.inject({ method: "GET", url: `/api/instagram/callback?code=ABC&state=${state}#_` });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain("instagram=connected");

    const [account] = await db.select().from(channelAccounts);
    expect(account.handle).toBe("lojateste");
    expect(account.externalId).toBe("17841499999999999");
    expect(account.accessTokenEnc).not.toContain("LONG-TOKEN");
    expect(account.webhookSubscribedAt).not.toBeNull();
    const sub = graph.calls.find((c) => c.url.pathname.endsWith("/me/subscribed_apps"));
    expect(sub?.url.searchParams.get("subscribed_fields")).toContain("messages");

    // A API nunca expõe o token.
    const list = await api(s, "GET", "/api/instagram/accounts");
    expect(list.body).not.toContain("LONG-TOKEN");
    expect(list.json().accounts[0].permissions).toEqual({ messages: true, comments: true });

    // O mesmo "state" não pode ser reutilizado.
    const again = await app.inject({ method: "GET", url: `/api/instagram/callback?code=ABC&state=${state}` });
    expect(again.headers.location).toContain("instagram=error");

    // Reconectar atualiza a mesma conta.
    const start2 = await api(s, "POST", "/api/instagram/connect", {});
    const state2 = new URL(start2.json().url).searchParams.get("state")!;
    await app.inject({ method: "GET", url: `/api/instagram/callback?code=XYZ&state=${state2}` });
    expect(await db.select().from(channelAccounts)).toHaveLength(1);

    // Desconectar
    expect((await api(s, "POST", `/api/channels/accounts/${account.id}/disconnect`)).statusCode).toBe(200);
    expect((await api(s, "GET", "/api/instagram/accounts")).json().accounts).toHaveLength(0);
  });

  it("recusa conta pessoal e trata cancelamento do usuário", async () => {
    graph.restore();
    graph = mockGraph((call) => {
      if (call.url.hostname === "api.instagram.com") return { body: { access_token: "S", user_id: "1", permissions: [] } };
      if (call.url.pathname === "/access_token") return { body: { access_token: "L", expires_in: 100 } };
      if (call.url.pathname.endsWith("/me")) return { body: { id: "1", username: "pessoal", account_type: "PERSONAL" } };
      return undefined;
    });
    const app = await getApp();
    const st = new URL((await api(s, "POST", "/api/instagram/connect", {})).json().url).searchParams.get("state")!;
    const r = await app.inject({ method: "GET", url: `/api/instagram/callback?code=A&state=${st}` });
    expect(new URL(r.headers.location as string, "https://x").searchParams.get("mensagem")).toContain("não é profissional");
    const st2 = new URL((await api(s, "POST", "/api/instagram/connect", {})).json().url).searchParams.get("state")!;
    const denied = await app.inject({ method: "GET", url: `/api/instagram/callback?error=access_denied&error_reason=user_denied&state=${st2}` });
    expect(denied.headers.location).toContain("instagram=denied");
    expect(await db.select().from(oauthStates)).toHaveLength(2);
  });
});

describe("caixa de entrada e atendimento humano", () => {
  it("assumir conversa pausa automações, envio manual e retomada", async () => {
    const account = await connectTestAccount(s.workspaceId);
    await api(s, "POST", "/api/automations", { name: "Link", mode: "quick", quick: { keywords: [{ text: "link" }], message: "Aqui está" }, publish: true, cooldownSeconds: 0 });
    await postWebhook(dmPayload(account.externalId, "C1", "oi, tudo bem?"));
    await drain();
    const convs = (await api(s, "GET", "/api/conversations")).json();
    expect(convs.conversations).toHaveLength(1);
    expect(convs.conversations[0].unreadCount).toBe(1);
    const convId = convs.conversations[0].id;

    // Sem assumir, envio manual é bloqueado.
    expect((await api(s, "POST", `/api/conversations/${convId}/messages`, { text: "Olá!" })).statusCode).toBe(400);
    expect((await api(s, "POST", `/api/conversations/${convId}/takeover`)).statusCode).toBe(200);

    await postWebhook(dmPayload(account.externalId, "C1", "me manda o link"));
    await drain();
    expect(graph.sends()).toHaveLength(0);
    const skipped = await db.select().from(automationExecutions).where(eq(automationExecutions.skipReason, "human_takeover"));
    expect(skipped).toHaveLength(1);

    const sent = await api(s, "POST", `/api/conversations/${convId}/messages`, { text: "Oi! Sou a Maria, vou te ajudar." });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(graph.sends()[0].body).toMatchObject({ recipient: { id: "C1" }, message: { text: "Oi! Sou a Maria, vou te ajudar." } });

    const history = (await api(s, "GET", `/api/conversations/${convId}/messages`)).json().messages;
    expect(history.map((m: any) => m.source)).toEqual(["contact", "contact", "agent"]);
    expect(history[1].trigger.skipReason).toBe("human_takeover");

    await api(s, "POST", `/api/conversations/${convId}/resume`);
    await postWebhook(dmPayload(account.externalId, "C1", "link"));
    await drain();
    expect(graph.sends()).toHaveLength(2);
  });

  it("eco de mensagem enviada pelo app do Instagram aparece no histórico sem duplicar", async () => {
    const account = await connectTestAccount(s.workspaceId);
    await postWebhook(dmPayload(account.externalId, "C9", "olá"));
    await postWebhook({
      object: "instagram",
      entry: [{ id: account.externalId, time: Date.now(), messaging: [{ sender: { id: account.externalId }, recipient: { id: "C9" }, timestamp: Date.now(), message: { mid: "mid.echo.1", text: "Respondi pelo celular", is_echo: true } }] }],
    });
    await drain();
    const conv = (await api(s, "GET", "/api/conversations")).json().conversations[0];
    const msgs = (await api(s, "GET", `/api/conversations/${conv.id}/messages`)).json().messages;
    expect(msgs.map((m: any) => [m.direction, m.source])).toEqual([
      ["inbound", "contact"],
      ["outbound", "native_app"],
    ]);
  });
});

describe("stories, simulador, palavras-chave, dashboard e analytics", () => {
  it("resposta e menção em Story acionam os gatilhos corretos", async () => {
    const account = await connectTestAccount(s.workspaceId);
    await api(s, "POST", "/api/automations", { name: "Story", mode: "quick", quick: { triggerEvent: "story_reply", keywords: [], message: "Valeu por responder o Story!" }, publish: true });
    await api(s, "POST", "/api/automations", { name: "Menção", mode: "quick", quick: { triggerEvent: "story_mention", keywords: [], message: "Obrigado pela menção!" }, publish: true });
    await postWebhook(dmPayload(account.externalId, "S1", "amei!", "mid.sr", { reply_to: { story: { id: "st1", url: "https://cdn/x" } } }));
    await postWebhook(dmPayload(account.externalId, "S2", "", "mid.sm", { text: undefined, attachments: [{ type: "story_mention", payload: { url: "https://cdn/y" } }] }));
    // Mensagem comum no Direct não aciona a automação de Story.
    await postWebhook(dmPayload(account.externalId, "S3", "oi"));
    await drain();
    expect(graph.sends().map((c) => c.body.message.text).sort()).toEqual(["Obrigado pela menção!", "Valeu por responder o Story!"]);
  });

  it("simulador mostra palavra detectada, automação e resposta sem enviar nada", async () => {
    const created = await api(s, "POST", "/api/automations", {
      name: "Link Produto",
      mode: "quick",
      quick: { keywords: [{ text: "link" }], message: "Claro! Aqui está o link...", delaySeconds: 3 },
    });
    const id = created.json().automation.id;
    const test = await api(s, "POST", `/api/automations/${id}/test`, { message: "Quero o link" });
    const r = test.json().result;
    expect(r.matched).toBe(true);
    expect(r.matchedKeyword).toBe("link");
    expect(r.automationName).toBe("Link Produto");
    expect(r.outputs[0].content.text).toBe("Claro! Aqui está o link...");
    expect(r.steps.some((st: any) => st.detail?.includes("Aguardaria"))).toBe(true);
    expect(graph.sends()).toHaveLength(0);

    const none = (await api(s, "POST", `/api/automations/${id}/test`, { message: "bom dia" })).json().result;
    expect(none.matched).toBe(false);
  });

  it("gerenciador de palavras-chave detecta conflitos e permite editar", async () => {
    await api(s, "POST", "/api/automations", { name: "A", mode: "quick", quick: { keywords: [{ text: "LINK" }], message: "a" }, publish: true });
    await api(s, "POST", "/api/automations", { name: "B", mode: "quick", quick: { keywords: [{ text: "link!" }, { text: "preço" }], message: "b" }, publish: true });
    const kws = (await api(s, "GET", "/api/keywords")).json().keywords;
    expect(kws.filter((k: any) => k.conflict).map((k: any) => k.automationName).sort()).toEqual(["A", "B"]);
    const preco = kws.find((k: any) => k.keyword === "preço");
    const upd = await api(s, "PATCH", `/api/keywords/${preco.id}`, { matchType: "exact" });
    expect(upd.statusCode, upd.body).toBe(200);
    const after = (await api(s, "GET", "/api/keywords")).json().keywords.find((k: any) => k.keyword === "preço");
    expect(after.matchType).toBe("exact");
  });

  it("dashboard e analytics com dados reais", async () => {
    const account = await connectTestAccount(s.workspaceId);
    await api(s, "POST", "/api/automations", { name: "Link", mode: "quick", quick: { keywords: [{ text: "link" }], message: "ok" }, publish: true });
    await postWebhook(dmPayload(account.externalId, "D1", "link"));
    await postWebhook(dmPayload(account.externalId, "D2", "oi"));
    await drain();
    const d = (await api(s, "GET", "/api/dashboard")).json();
    expect(d.cards.messagesIn.value).toBe(2);
    expect(d.cards.messagesAutomated.value).toBe(1);
    expect(d.cards.activeAutomations.value).toBe(1);
    expect(d.cards.responseRate.value).toBe(50);
    expect(d.topAutomations[0].name).toBe("Link");
    expect(d.onboarding).toMatchObject({ instagramConnected: true, automationActive: true, firstMessageReceived: true });

    const a = (await api(s, "GET", "/api/analytics?range=7d")).json();
    expect(a.totals.messages_in).toBe(2);
    expect(a.topKeywords[0]).toEqual({ keyword: "link", n: 1 });
    // Plano gratuito: analytics avançado bloqueado para 90 dias.
    expect((await api(s, "GET", "/api/analytics?range=90d")).statusCode).toBe(402);
  });

  it("limite de automações ativas do plano gratuito", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await api(s, "POST", "/api/automations", { name: `A${i}`, mode: "quick", quick: { keywords: [{ text: `k${i}` }], message: "x" }, publish: true });
      expect(r.statusCode).toBe(201);
    }
    const r = await api(s, "POST", "/api/automations", { name: "A4", mode: "quick", quick: { keywords: [{ text: "k4" }], message: "x" }, publish: true });
    expect(r.statusCode).toBe(402);
    expect(r.json().error.message).toContain("2 automações ativas");
    // Criar e publicar é tudo ou nada: nenhum rascunho fica para trás.
    expect((await api(s, "GET", "/api/automations")).json().automations).toHaveLength(2);
    // Sem publicar, o rascunho pode ser salvo normalmente.
    const draft = await api(s, "POST", "/api/automations", { name: "A4", mode: "quick", quick: { keywords: [{ text: "k4" }], message: "x" } });
    expect(draft.statusCode).toBe(201);
  });

  it("callback oficial de exclusão de dados da Meta", async () => {
    const account = await connectTestAccount(s.workspaceId, { scopedId: "777" });
    const payload = Buffer.from(JSON.stringify({ user_id: "777", algorithm: "HMAC-SHA256" })).toString("base64url");
    const sig = createHmac("sha256", "test-app-secret").update(payload).digest("base64url");
    const app = await getApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${sig}.${payload}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().confirmation_code).toBeTruthy();
    expect(await db.select().from(channelAccounts).where(eq(channelAccounts.id, account.id))).toHaveLength(0);
    const bad = await app.inject({ method: "POST", url: "/api/meta/data-deletion", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: `signed_request=abc.${payload}` });
    expect(bad.statusCode).toBe(400);
  });
});
