import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { automationExecutions, channelAccounts, contacts, messages, notifications, whatsappTemplates } from "../src/db/schema";
import {
  api,
  connectTestAccount,
  connectTestWhatsApp,
  dmPayload,
  drain,
  fastForwardJobs,
  getApp,
  mockGraph,
  postWebhook,
  postWhatsAppWebhook,
  resetDb,
  setPlan,
  signup,
  waPayload,
  waStatusPayload,
  type Session,
} from "./helpers";

let s: Session;
let graph: ReturnType<typeof mockGraph>;
let wa: Awaited<ReturnType<typeof connectTestWhatsApp>>;

beforeEach(async () => {
  await resetDb();
  s = await signup();
  graph = mockGraph();
  wa = await connectTestWhatsApp(s.workspaceId);
});
afterEach(() => graph.restore());
afterAll(async () => {
  await (await getApp()).close();
});

async function createQuick(name: string, keywords: string[], message: string, extra: Record<string, unknown> = {}) {
  const res = await api(s, "POST", "/api/automations", {
    name,
    mode: "quick",
    quick: { keywords: keywords.map((text) => ({ text })), message, ...extra },
    publish: true,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().automation;
}

describe("WhatsApp: webhook", () => {
  it("valida a assinatura com a chave do app da Meta (não a do Instagram)", async () => {
    const payload = waPayload(wa.externalId, "5511988887777", { type: "text", text: { body: "oi" } });
    const bad = await postWhatsAppWebhook(payload, { signature: "sha256=deadbeef" });
    expect(bad.statusCode).toBe(401);
    const ok = await postWhatsAppWebhook(payload);
    expect(ok.statusCode).toBe(200);
    // Verificação do endpoint
    const verify = await (await getApp()).inject({
      method: "GET",
      url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=123",
    });
    expect(verify.body).toBe("123");
  });

  it("mensagem com palavra-chave → resposta pelo WhatsApp com botão de link, contato com nome e telefone", async () => {
    await createQuick("Preço", ["preço"], "Oi, {{primeiro_nome}}! Seu número é {{telefone}}.", {
      channels: ["whatsapp"],
      linkUrl: "https://exemplo.com/precos",
      buttonTitle: "Ver preços",
    });
    await postWhatsAppWebhook(waPayload(wa.externalId, "5511988887777", { type: "text", text: { body: "qual o preço?" } }, { name: "Bruno Cliente" }));
    await drain();

    const sends = graph.waSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].url.pathname).toBe(`/v25.0/${wa.externalId}/messages`);
    expect(sends[0].headers.Authorization).toBe("Bearer EAAG-wa-test-token");
    expect(sends[0].body.to).toBe("5511988887777");
    expect(sends[0].body.type).toBe("interactive");
    expect(sends[0].body.interactive.type).toBe("cta_url");
    expect(sends[0].body.interactive.body.text).toBe("Oi, Bruno! Seu número é +55 11 98888-7777.");
    expect(sends[0].body.interactive.action.parameters.display_text).toBe("Ver preços");
    expect(sends[0].body.interactive.action.parameters.url).toMatch(/^https:\/\/app\.test\.local\/r\//);

    const [contact] = await db.select().from(contacts);
    expect(contact.channel).toBe("whatsapp");
    expect(contact.phone).toBe("5511988887777");
    expect(contact.name).toBe("Bruno Cliente");
    const out = await db.select().from(messages).where(eq(messages.direction, "outbound"));
    expect(out[0].externalId).toBe("wamid.out.1");
    expect(graph.sends()).toHaveLength(0); // nada foi para o Instagram
  });

  it("automação só de Instagram não responde no WhatsApp; a de dois canais responde nos dois", async () => {
    const ig = await connectTestAccount(s.workspaceId);
    await setPlan(s.workspaceId, "pro");
    await createQuick("Só IG", ["catalogo"], "Catálogo no Instagram");
    await postWhatsAppWebhook(waPayload(wa.externalId, "5511911112222", { type: "text", text: { body: "catalogo" } }));
    await drain();
    expect(graph.waSends()).toHaveLength(0);

    await createQuick("Dois canais", ["horário"], "Abrimos às 9h", { channels: ["instagram", "whatsapp"] });
    await postWhatsAppWebhook(waPayload(wa.externalId, "5511911112222", { type: "text", text: { body: "qual o horário?" } }));
    await postWebhook(dmPayload(ig.externalId, "IG-USER-1", "qual o horário?"));
    await drain();
    expect(graph.waSends().map((c) => c.body.text?.body)).toEqual(["Abrimos às 9h"]);
    expect(graph.sends().map((c) => c.body.message.text)).toEqual(["Abrimos às 9h"]);
  });

  it("automação nos dois canais exige plano com esse recurso", async () => {
    const res = await api(s, "POST", "/api/automations", {
      name: "Dois canais",
      mode: "quick",
      quick: { keywords: [{ text: "oi" }], message: "Olá", channels: ["instagram", "whatsapp"] },
      publish: true,
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.message).toContain("Pro");
  });

  it("botões viram botões interativos; a resposta do contato continua o fluxo", async () => {
    const flow = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "dm", channels: ["whatsapp"] } },
        { id: "k", type: "keyword", position: { x: 0, y: 1 }, data: { keywords: [{ text: "menu" }] } },
        {
          id: "b",
          type: "buttons",
          position: { x: 0, y: 2 },
          data: { text: "Escolha:", buttons: [{ id: "a", title: "Entrega", kind: "reply" }, { id: "c", title: "Pagamento", kind: "reply" }] },
        },
        { id: "m1", type: "message", position: { x: 0, y: 3 }, data: { text: "Entregamos em 2 dias." } },
        { id: "m2", type: "message", position: { x: 1, y: 3 }, data: { text: "Aceitamos PIX." } },
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "out", target: "k" },
        { id: "e2", source: "k", sourceHandle: "out", target: "b" },
        { id: "e3", source: "b", sourceHandle: "btn:a", target: "m1" },
        { id: "e4", source: "b", sourceHandle: "btn:c", target: "m2" },
      ],
    };
    const created = await api(s, "POST", "/api/automations", { name: "Menu", mode: "flow", flow, publish: true });
    expect(created.statusCode, created.body).toBe(201);

    await postWhatsAppWebhook(waPayload(wa.externalId, "5511933334444", { type: "text", text: { body: "menu" } }));
    await drain();
    const first = graph.waSends()[0].body;
    expect(first.type).toBe("interactive");
    expect(first.interactive.type).toBe("button");
    expect(first.interactive.action.buttons.map((b: any) => b.reply.title)).toEqual(["Entrega", "Pagamento"]);
    const payload = first.interactive.action.buttons[1].reply.id;

    await postWhatsAppWebhook(
      waPayload(wa.externalId, "5511933334444", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: payload, title: "Pagamento" } } }),
    );
    await drain();
    expect(graph.waSends()[1].body.text.body).toBe("Aceitamos PIX.");
    const [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("completed");
    expect(ex.channel).toBe("whatsapp");
  });
});

describe("WhatsApp: status de entrega e consumo", () => {
  it("atualiza o status e conta só mensagens cobradas, uma vez cada", async () => {
    await createQuick("Oi", ["oi"], "Olá!", { channels: ["whatsapp"] });
    await postWhatsAppWebhook(waPayload(wa.externalId, "5511955556666", { type: "text", text: { body: "oi" } }));
    await drain();
    const pricing = { billable: true, pricing_model: "PMP", category: "service", type: "regular" };
    await postWhatsAppWebhook(waStatusPayload(wa.externalId, "wamid.out.1", "sent", pricing));
    await postWhatsAppWebhook(waStatusPayload(wa.externalId, "wamid.out.1", "delivered", pricing));
    await postWhatsAppWebhook(waStatusPayload(wa.externalId, "wamid.out.1", "read"));
    await drain();
    const [msg] = await db.select().from(messages).where(eq(messages.externalId, "wamid.out.1"));
    expect(msg.status).toBe("read");

    const usage = (await api(s, "GET", `/api/whatsapp/usage?accountId=${wa.id}`)).json().usage;
    const service = usage.categories.find((c: any) => c.category === "service");
    expect(service.messages).toBe(1);
    expect(service.estimatedBRL).toBeCloseTo(0.035);
    expect(usage.totalMessages).toBe(1);
  });

  it("falha por falta de pagamento na Meta marca a mensagem e avisa o cliente", async () => {
    await createQuick("Oi", ["oi"], "Olá!", { channels: ["whatsapp"] });
    await postWhatsAppWebhook(waPayload(wa.externalId, "5511955556666", { type: "text", text: { body: "oi" } }));
    await drain();
    await postWhatsAppWebhook(waStatusPayload(wa.externalId, "wamid.out.1", "failed", undefined, [{ code: 131042, title: "Business eligibility payment issue" }]));
    await drain();
    const [msg] = await db.select().from(messages).where(eq(messages.externalId, "wamid.out.1"));
    expect(msg.status).toBe("failed");
    expect(msg.errorMessage).toContain("forma de pagamento");
    const notes = await db.select().from(notifications).where(eq(notifications.type, "billing"));
    expect(notes).toHaveLength(1);
  });
});

describe("WhatsApp: conexão pelo cadastro incorporado", () => {
  it("troca o código, registra o número, ativa webhooks e respeita o plano", async () => {
    await db.delete(channelAccounts);
    const res = await api(s, "POST", "/api/whatsapp/connect", { code: "AQBcode-from-meta-1234", wabaId: "555000111", phoneNumberId: "777000222" });
    expect(res.statusCode, res.body).toBe(200);
    const account = res.json().account;
    expect(account.channel).toBe("whatsapp");
    expect(account.displayHandle).toBe("+55 11 98888-0000");
    expect(account.name).toBe("Loja Nova");
    expect(JSON.stringify(account)).not.toContain("EAAG");

    const paths = graph.calls.map((c) => `${c.method} ${c.url.pathname}`);
    expect(paths).toContain("GET /v25.0/oauth/access_token");
    expect(paths).toContain("POST /v25.0/777000222/register");
    expect(paths).toContain("POST /v25.0/555000111/subscribed_apps");
    const exchange = graph.calls.find((c) => c.url.pathname.endsWith("/oauth/access_token"))!;
    expect(exchange.url.searchParams.get("client_secret")).toBe("test-meta-secret");

    // Plano gratuito: 1 tipo de canal. Com WhatsApp conectado, o Instagram fica bloqueado.
    const ig = await api(s, "POST", "/api/instagram/connect", {});
    expect(ig.statusCode).toBe(200); // a URL é gerada; o bloqueio acontece ao concluir a conexão
    const { assertCanConnect } = await import("../src/modules/billing/limits");
    await expect(assertCanConnect(s.workspaceId, "instagram")).rejects.toThrow(/Instagram e WhatsApp juntos/);
    await setPlan(s.workspaceId, "pro");
    await expect(assertCanConnect(s.workspaceId, "instagram")).resolves.toBeUndefined();
  });

  it("número já conectado em outra conta do Veloxia é recusado", async () => {
    const other = await signup();
    const res = await api(other, "POST", "/api/whatsapp/connect", { code: "AQBcode-from-meta-1234", wabaId: "102290129340398", phoneNumberId: wa.externalId });
    expect(res.statusCode).toBe(409);
  });
});

describe("Sequências e modelos", () => {
  async function approveTemplate(name = "retomar_conversa", body = "Oi {{1}}, ainda tem interesse no {{2}}?") {
    const [t] = await db
      .insert(whatsappTemplates)
      .values({ workspaceId: s.workspaceId, channelAccountId: wa.id, wabaId: "102290129340398", name, language: "pt_BR", category: "MARKETING", status: "APPROVED", bodyText: body, components: [{ type: "BODY", text: body }] })
      .returning();
    return t;
  }

  const sequenceFlow = (secondNode: Record<string, unknown>) => ({
    version: 1,
    nodes: [
      { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "dm", channels: ["whatsapp"] } },
      { id: "k", type: "keyword", position: { x: 0, y: 1 }, data: { keywords: [{ text: "preço" }] } },
      { id: "m", type: "message", position: { x: 0, y: 2 }, data: { text: "O valor é R$ 99." } },
      { id: "d", type: "delay", position: { x: 0, y: 3 }, data: { seconds: 86400 } },
      { id: "n", position: { x: 0, y: 4 }, ...secondNode },
    ],
    edges: [
      { id: "e1", source: "t", sourceHandle: "out", target: "k" },
      { id: "e2", source: "k", sourceHandle: "out", target: "m" },
      { id: "e3", source: "m", sourceHandle: "out", target: "d" },
      { id: "e4", source: "d", sourceHandle: "out", target: "n" },
    ],
  });

  it("depois de 1 dia, só um modelo aprovado pode retomar a conversa", async () => {
    await setPlan(s.workspaceId, "pro");
    // Mensagem comum após a espera longa: bloqueada na validação.
    const bad = await api(s, "POST", "/api/automations", {
      name: "Seq",
      mode: "flow",
      flow: sequenceFlow({ type: "message", data: { text: "Ainda quer?" } }),
      publish: true,
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toContain("Modelo do WhatsApp");

    // Modelo ainda não aprovado: bloqueado.
    const tplNode = { type: "whatsapp_template", data: { templateName: "retomar_conversa", language: "pt_BR", bodyText: "Oi {{1}}, ainda tem interesse no {{2}}?", bodyParams: ["{{primeiro_nome}}", "produto"] } };
    const notApproved = await api(s, "POST", "/api/automations", { name: "Seq", mode: "flow", flow: sequenceFlow(tplNode), publish: true });
    expect(notApproved.statusCode).toBe(422);

    await approveTemplate();
    const ok = await api(s, "POST", "/api/automations", { name: "Seq", mode: "flow", flow: sequenceFlow(tplNode), publish: true });
    expect(ok.statusCode, ok.body).toBe(201);

    await postWhatsAppWebhook(waPayload(wa.externalId, "5511977778888", { type: "text", text: { body: "qual o preço?" } }, { name: "Carla Souza" }));
    await drain();
    expect(graph.waSends()).toHaveLength(1);

    // Simula o dia seguinte: a janela de 24h fechou, mas o modelo pode ser enviado.
    await db.update(contacts).set({ lastInboundAt: new Date(Date.now() - 25 * 3600_000) });
    await fastForwardJobs();
    await drain();
    const sends = graph.waSends();
    expect(sends).toHaveLength(2);
    expect(sends[1].body.type).toBe("template");
    expect(sends[1].body.template.name).toBe("retomar_conversa");
    expect(sends[1].body.template.components[0].parameters.map((p: any) => p.text)).toEqual(["Carla", "produto"]);
    const [stored] = await db.select().from(messages).where(eq(messages.type, "template"));
    expect(stored.text).toBe("Oi Carla, ainda tem interesse no produto?");
  });

  it("sequência exige plano Pro", async () => {
    await approveTemplate();
    const res = await api(s, "POST", "/api/automations", {
      name: "Seq",
      mode: "flow",
      flow: sequenceFlow({ type: "whatsapp_template", data: { templateName: "retomar_conversa", language: "pt_BR", bodyText: "Oi", bodyParams: [] } }),
      publish: true,
    });
    expect(res.statusCode).toBe(402);
  });

  it("criação de modelo valida variáveis e envia para aprovação", async () => {
    const bad = await api(s, "POST", `/api/whatsapp/accounts/${wa.id}/templates`, { name: "promo_semana", category: "MARKETING", body: "Oi {{1}}, veja {{3}}", examples: ["Ana", "x"] });
    expect(bad.statusCode).toBe(400);
    const res = await api(s, "POST", `/api/whatsapp/accounts/${wa.id}/templates`, {
      name: "promo_semana",
      category: "MARKETING",
      body: "Oi {{1}}, a promoção de {{2}} começou!",
      examples: ["Ana", "inverno"],
      quickReplies: ["Quero ver"],
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().template.status).toBe("PENDING");
    const call = graph.calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/message_templates"))!;
    expect(call.body.components.find((c: any) => c.type === "BODY").example.body_text).toEqual([["Ana", "inverno"]]);
  });
});

describe("Instagram → WhatsApp", () => {
  it("envia no Direct um botão rastreado que abre o WhatsApp com a mensagem pronta", async () => {
    const ig = await connectTestAccount(s.workspaceId);
    await setPlan(s.workspaceId, "pro");
    const flow = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "dm", channels: ["instagram"] } },
        { id: "k", type: "keyword", position: { x: 0, y: 1 }, data: { keywords: [{ text: "whatsapp" }] } },
        { id: "w", type: "whatsapp_handoff", position: { x: 0, y: 2 }, data: { text: "Fale com a gente:", buttonTitle: "Abrir WhatsApp", prefill: "Vim do Instagram" } },
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "out", target: "k" },
        { id: "e2", source: "k", sourceHandle: "out", target: "w" },
      ],
    };
    const created = await api(s, "POST", "/api/automations", { name: "IG→WA", mode: "flow", flow, publish: true });
    expect(created.statusCode, created.body).toBe(201);
    await postWebhook(dmPayload(ig.externalId, "IG-9", "tem whatsapp?"));
    await drain();
    const send = graph.sends()[0].body;
    const button = send.message.attachment.payload.buttons[0];
    expect(button.title).toBe("Abrir WhatsApp");
    // Link rastreado que redireciona para o wa.me do número conectado.
    const code = new URL(button.url).pathname.split("/").pop();
    const redirect = await (await getApp()).inject({ method: "GET", url: `/r/${code}` });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("https://wa.me/5511999990000?text=Vim%20do%20Instagram");
  });

  it("simulador no canal WhatsApp mostra o que seria enviado", async () => {
    const a = await createQuick("Oi", ["oi"], "Olá do {{conta}}", { channels: ["whatsapp"] });
    const r = (await api(s, "POST", `/api/automations/${a.id}/test`, { message: "oi", channel: "whatsapp" })).json().result;
    expect(r.matched).toBe(true);
    expect(r.outputs[0].content.text).toBe("Olá do Minha Loja");
    const none = (await api(s, "POST", `/api/automations/${a.id}/test`, { message: "oi", channel: "instagram" })).json().result;
    expect(none.matched).toBe(false);
  });
});
