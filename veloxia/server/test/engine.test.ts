import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client";
import { analyticsDaily, automationExecutions, commentEvents, contacts, conversations, messages, webhookEvents } from "../src/db/schema";
import { api, connectTestAccount, dmPayload, drain, fastForwardJobs, getApp, mockGraph, postWebhook, resetDb, signup, type Session } from "./helpers";

let s: Session;
let account: Awaited<ReturnType<typeof connectTestAccount>>;
let graph: ReturnType<typeof mockGraph>;

beforeEach(async () => {
  await resetDb();
  s = await signup();
  account = await connectTestAccount(s.workspaceId);
  graph = mockGraph();
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
    cooldownSeconds: 60,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().automation;
}

describe("webhook", () => {
  it("verifica o endpoint com o token correto", async () => {
    const app = await getApp();
    const ok = await app.inject({ method: "GET", url: "/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=abc123" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("abc123");
    const bad = await app.inject({ method: "GET", url: "/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=abc" });
    expect(bad.statusCode).toBe(403);
  });

  it("rejeita assinatura inválida e não registra o evento", async () => {
    const res = await postWebhook(dmPayload(account.externalId, "111", "link"), { signature: "sha256=deadbeef" });
    expect(res.statusCode).toBe(401);
    expect(await db.select().from(webhookEvents)).toHaveLength(0);
  });

  it("entrega duplicada do mesmo corpo é registrada uma única vez", async () => {
    const payload = dmPayload(account.externalId, "111", "oi", "mid.dup.1");
    expect((await postWebhook(payload)).statusCode).toBe(200);
    expect((await postWebhook(payload)).statusCode).toBe(200);
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
  });
});

describe("motor de automação", () => {
  it("fluxo completo: mensagem real → palavra-chave → resposta enviada → logs, inbox e métricas", async () => {
    const automation = await createQuick("Link Produto", ["link", "quero", "onde comprar"], "Claro, {{primeiro_nome|tudo bem}}! 😊 Aqui está:", {
      linkUrl: "https://exemplo.com/produto",
      buttonTitle: "Ver produto",
    });

    const res = await postWebhook(dmPayload(account.externalId, "IGSID-ANA", "Você tem o LINK?", "mid.in.1"));
    expect(res.statusCode).toBe(200);
    await drain();

    const sends = graph.sends();
    expect(sends).toHaveLength(1);
    const body = sends[0].body;
    expect(sends[0].url.pathname).toBe("/v25.0/me/messages");
    expect(sends[0].headers.Authorization).toBe("Bearer IGAA-test-token");
    expect(body.recipient).toEqual({ id: "IGSID-ANA" });
    expect(body.message.attachment.payload.template_type).toBe("button");
    expect(body.message.attachment.payload.text).toBe("Claro, Ana! 😊 Aqui está:");
    const button = body.message.attachment.payload.buttons[0];
    expect(button.title).toBe("Ver produto");
    expect(button.url).toMatch(/^https:\/\/app\.test\.local\/r\/[A-Za-z0-9]+\?e=/);

    const [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("completed");
    expect(ex.matchedKeyword).toBe("link");
    expect(ex.automationId).toBe(automation.id);

    const msgs = await db.select().from(messages).orderBy(messages.createdAt);
    expect(msgs.map((m) => [m.direction, m.status])).toEqual([
      ["inbound", "received"],
      ["outbound", "sent"],
    ]);
    const [contact] = await db.select().from(contacts);
    expect(contact.username).toBe("ana.cliente");
    expect(contact.lastKeyword).toBe("link");
    const [conv] = await db.select().from(conversations);
    expect(conv.lastMessageDirection).toBe("outbound");

    const metrics = await db.select().from(analyticsDaily).where(eq(analyticsDaily.dimension, ""));
    const byMetric = Object.fromEntries(metrics.map((m) => [m.metric, m.value]));
    expect(byMetric.messages_in).toBe(1);
    expect(byMetric.messages_out_auto).toBe(1);
    expect(byMetric.executions).toBe(1);
    expect(byMetric.contacts_new).toBe(1);

    // Logs pela API
    const logs = await api(s, "GET", "/api/executions");
    expect(logs.json().executions[0]).toMatchObject({ status: "completed", matchedKeyword: "link", inboundText: "Você tem o LINK?", contactUsername: "ana.cliente" });

    // Clique no link rastreado
    const app = await getApp();
    const url = new URL(button.url);
    const click = await app.inject({ method: "GET", url: `${url.pathname}${url.search}`, headers: { "user-agent": "Mozilla/5.0 (iPhone)" } });
    expect(click.statusCode).toBe(302);
    expect(click.headers.location).toBe("https://exemplo.com/produto");
  });

  it("a automação mais específica tem prioridade; prioridade manual se sobrepõe", async () => {
    await createQuick("Genérica", ["link"], "Resposta genérica");
    const specific = await createQuick("Específica", ["link produto"], "Resposta específica");
    await postWebhook(dmPayload(account.externalId, "U1", "me manda o link produto"));
    await drain();
    expect(graph.sends()[0].body.message.text).toBe("Resposta específica");

    const generic = (await api(s, "GET", "/api/automations")).json().automations.find((a: any) => a.name === "Genérica");
    await api(s, "PATCH", `/api/automations/${generic.id}`, { priority: 10 });
    await postWebhook(dmPayload(account.externalId, "U2", "me manda o link produto"));
    await drain();
    expect(graph.sends()[1].body.message.text).toBe("Resposta genérica");
    expect(specific.id).toBeTruthy();
  });

  it("anti-duplicidade: mensagens repetidas em sequência disparam o fluxo uma vez (cooldown)", async () => {
    await createQuick("Link", ["link"], "Aqui está o link");
    for (let i = 0; i < 3; i++) await postWebhook(dmPayload(account.externalId, "SPAM", "LINK", `mid.spam.${i}`));
    await drain();
    expect(graph.sends()).toHaveLength(1);
    const execs = await db.select().from(automationExecutions);
    expect(execs.filter((e) => e.status === "completed")).toHaveLength(1);
    expect(execs.filter((e) => e.skipReason === "cooldown")).toHaveLength(2);
  });

  it("automações pausadas não disparam; atendimento humano pausa o contato", async () => {
    const a = await createQuick("Preço", ["preço"], "O preço está no site");
    await api(s, "POST", `/api/automations/${a.id}/status`, { status: "paused" });
    await postWebhook(dmPayload(account.externalId, "P1", "qual o preco?"));
    await drain();
    expect(graph.sends()).toHaveLength(0);

    await api(s, "POST", `/api/automations/${a.id}/status`, { status: "active" });
    await postWebhook(dmPayload(account.externalId, "P1", "qual o preco?"));
    await drain();
    expect(graph.sends()).toHaveLength(1);
  });

  it("editar mantém a versão publicada até publicar de novo; excluir interrompe fluxos em andamento", async () => {
    const a = await createQuick("Cupom", ["cupom"], "Cupom: OLA10");
    const edited = await api(s, "PATCH", `/api/automations/${a.id}`, { quick: { keywords: [{ text: "cupom" }], message: "Cupom: VOLTA15" } });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().automation.hasUnpublishedChanges).toBe(true);

    await postWebhook(dmPayload(account.externalId, "E1", "tem cupom?"));
    await drain();
    expect(graph.sends().at(-1)!.body.message.text).toBe("Cupom: OLA10");

    await api(s, "POST", `/api/automations/${a.id}/publish`);
    await postWebhook(dmPayload(account.externalId, "E2", "tem cupom?"));
    await drain();
    expect(graph.sends().at(-1)!.body.message.text).toBe("Cupom: VOLTA15");

    // Uma execução aguardando um bloco "Aguardar" não envia nada depois da exclusão.
    const delayed = await createQuick("Brinde", ["brinde"], "Seu brinde chegou", { delaySeconds: 60 });
    await postWebhook(dmPayload(account.externalId, "E3", "quero o brinde"));
    await drain();
    const sendsBefore = graph.sends().length;
    const [waiting] = await db.select().from(automationExecutions).where(eq(automationExecutions.automationId, delayed.id));
    expect(waiting.status).toBe("waiting");

    expect((await api(s, "DELETE", `/api/automations/${delayed.id}`)).statusCode).toBe(200);
    expect((await api(s, "GET", `/api/automations/${delayed.id}`)).statusCode).toBe(404);
    await fastForwardJobs();
    await drain();
    expect(graph.sends()).toHaveLength(sendsBefore);
    const [after] = await db.select().from(automationExecutions).where(eq(automationExecutions.id, waiting.id));
    expect(after.status).toBe("cancelled");
    expect(after.automationId).toBeNull(); // o histórico continua nos logs
    expect(after.automationName).toBe("Brinde");
  });

  it("aguardar + botões + captura de e-mail + condição por tag", async () => {
    const tags = (await api(s, "GET", "/api/tags")).json().tags as { id: string; name: string }[];
    const lead = tags.find((t) => t.name === "Lead")!;
    const flow = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "dm" } },
        { id: "k", type: "keyword", position: { x: 0, y: 0 }, data: { keywords: [{ text: "catálogo" }] } },
        { id: "hi", type: "message", position: { x: 0, y: 0 }, data: { text: "Oi! Já vou ver isso." } },
        { id: "wait", type: "delay", position: { x: 0, y: 0 }, data: { seconds: 3 } },
        { id: "ask", type: "buttons", position: { x: 0, y: 0 }, data: { text: "Quer receber o catálogo?", buttons: [{ id: "sim", title: "SIM", kind: "reply" }, { id: "nao", title: "NÃO", kind: "reply" }] } },
        { id: "cap", type: "capture", position: { x: 0, y: 0 }, data: { question: "Qual é o seu melhor e-mail?", fieldKey: "email", validation: "email", retryMessage: "E-mail inválido, tente de novo.", maxAttempts: 2 } },
        { id: "tag", type: "add_tag", position: { x: 0, y: 0 }, data: { tagId: lead.id } },
        { id: "cond", type: "condition", position: { x: 0, y: 0 }, data: { logic: "all", rules: [{ type: "has_tag", tagId: lead.id }] } },
        { id: "ok", type: "message", position: { x: 0, y: 0 }, data: { text: "Enviamos para {{email}} ✅" } },
        { id: "no", type: "message", position: { x: 0, y: 0 }, data: { text: "Tudo bem!" } },
      ],
      edges: [
        { id: "1", source: "t", sourceHandle: "out", target: "k" },
        { id: "2", source: "k", sourceHandle: "out", target: "hi" },
        { id: "3", source: "hi", sourceHandle: "out", target: "wait" },
        { id: "4", source: "wait", sourceHandle: "out", target: "ask" },
        { id: "5", source: "ask", sourceHandle: "btn:sim", target: "cap" },
        { id: "6", source: "ask", sourceHandle: "btn:nao", target: "no" },
        { id: "7", source: "cap", sourceHandle: "captured", target: "tag" },
        { id: "8", source: "tag", sourceHandle: "out", target: "cond" },
        { id: "9", source: "cond", sourceHandle: "true", target: "ok" },
      ],
    };
    const created = await api(s, "POST", "/api/automations", { name: "Catálogo", mode: "flow", flow, publish: true });
    expect(created.statusCode, created.body).toBe(201);

    await postWebhook(dmPayload(account.externalId, "LEAD1", "quero o catalogo"));
    await drain();
    expect(graph.sends().map((c) => c.body.message.text)).toEqual(["Oi! Já vou ver isso."]);

    // O bloco "Aguardar" foi agendado na fila; antecipamos o horário.
    let [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("waiting");
    expect(ex.waitType).toBe("delay");
    await fastForwardJobs();
    await drain();
    const quick = graph.sends()[1].body.message;
    expect(quick.text).toBe("Quer receber o catálogo?");
    expect(quick.quick_replies.map((q: any) => q.title)).toEqual(["SIM", "NÃO"]);

    // Contato toca em "SIM" (quick reply)
    await postWebhook(dmPayload(account.externalId, "LEAD1", "SIM", "mid.qr.1", { quick_reply: { payload: quick.quick_replies[0].payload } }));
    await drain();
    expect(graph.sends()[2].body.message.text).toBe("Qual é o seu melhor e-mail?");

    await postWebhook(dmPayload(account.externalId, "LEAD1", "não sei", "mid.cap.1"));
    await drain();
    expect(graph.sends()[3].body.message.text).toBe("E-mail inválido, tente de novo.");

    await postWebhook(dmPayload(account.externalId, "LEAD1", "Ana@Exemplo.com", "mid.cap.2"));
    await drain();
    expect(graph.sends()[4].body.message.text).toBe("Enviamos para ana@exemplo.com ✅");
    [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("completed");

    const contact = (await api(s, "GET", "/api/contacts")).json().contacts?.[0];
    if (contact) {
      expect(contact.tags.map((t: any) => t.name)).toContain("Lead");
    }
  });

  it("Comentário → DM: resposta privada, resposta pública e conversão", async () => {
    const res = await api(s, "POST", "/api/automations", {
      name: "Comente LINK",
      mode: "quick",
      quick: {
        triggerEvent: "comment",
        keywords: [{ text: "link" }],
        message: "Oi! 😊 Vi que você pediu o link. Aqui está:",
        linkUrl: "https://exemplo.com/p",
        buttonTitle: "Ver produto",
        publicReplyEnabled: true,
        publicReplies: ["Te enviei no Direct! 📩"],
      },
      publish: true,
    });
    expect(res.statusCode, res.body).toBe(201);

    const comment = {
      object: "instagram",
      entry: [
        {
          id: account.externalId,
          time: Date.now(),
          changes: [{ field: "comments", value: { id: "C1", text: "LINK", from: { id: "COMMENTER-1", username: "joao" }, media: { id: "M1", media_product_type: "REELS" } } }],
        },
      ],
    };
    await postWebhook(comment);
    await drain();
    const send = graph.sends()[0];
    expect(send.body.recipient).toEqual({ comment_id: "C1" });
    const reply = graph.calls.find((c) => c.url.pathname.endsWith("/C1/replies"));
    expect(reply?.url.searchParams.get("message")).toBe("Te enviei no Direct! 📩");
    const [ev] = await db.select().from(commentEvents);
    expect(ev.privateReplyStatus).toBe("sent");
    expect(ev.publicReplyStatus).toBe("sent");

    // Nosso próprio comentário (resposta pública) não dispara automação.
    await postWebhook({
      object: "instagram",
      entry: [{ id: account.externalId, time: Date.now(), changes: [{ field: "comments", value: { id: "C2", text: "link", from: { id: account.externalId, username: "minhaloja" }, media: { id: "M1" } } }] }],
    });
    await drain();
    expect(graph.sends()).toHaveLength(1);

    // Pessoa responde no Direct → conversão
    await postWebhook(dmPayload(account.externalId, "COMMENTER-1", "obrigado!"));
    await drain();
    const [after] = await db.select().from(commentEvents).where(eq(commentEvents.commentId, "C1"));
    expect(after.convertedAt).not.toBeNull();

    const summary = (await api(s, "GET", "/api/comments/summary")).json().media[0];
    expect(summary).toMatchObject({ mediaId: "M1", comments: 1, dmsSent: 1, conversions: 1 });
  });

  it("erros da API: token expirado marca a conta, notifica e registra a falha", async () => {
    graph.restore();
    graph = mockGraph((call) =>
      call.url.pathname.endsWith("/me/messages")
        ? { status: 400, body: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } } }
        : undefined,
    );
    await createQuick("Link", ["link"], "Aqui");
    await postWebhook(dmPayload(account.externalId, "X1", "link"));
    await drain();
    const [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("failed");
    expect(ex.errorMessage).toContain("Reconecte");
    const accounts = (await api(s, "GET", "/api/instagram/accounts")).json().accounts;
    expect(accounts[0].status).toBe("token_expired");
    const failed = await db.select().from(messages).where(eq(messages.status, "failed"));
    expect(failed).toHaveLength(1);
  });

  it("falha temporária (5xx) é reenviada automaticamente", async () => {
    let attempts = 0;
    graph.restore();
    graph = mockGraph((call) => {
      if (call.url.pathname.endsWith("/me/messages") && attempts++ === 0) return { status: 500, body: { error: { message: "Service unavailable", code: 2 } } };
      return undefined;
    });
    await createQuick("Link", ["link"], "Aqui está");
    await postWebhook(dmPayload(account.externalId, "R1", "link"));
    await drain();
    let [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("waiting");
    expect(ex.waitType).toBe("retry");
    await fastForwardJobs();
    await drain();
    [ex] = await db.select().from(automationExecutions);
    expect(ex.status).toBe("completed");
    expect(graph.sends()).toHaveLength(2);
  });

  it("isolamento entre clientes: outro usuário não acessa a automação", async () => {
    const a = await createQuick("Privada", ["segredo"], "x");
    const other = await signup();
    expect((await api(other, "GET", `/api/automations/${a.id}`)).statusCode).toBe(404);
    expect((await api(other, "DELETE", `/api/automations/${a.id}`)).statusCode).toBe(404);
    expect((await api(other, "GET", "/api/automations")).json().automations).toHaveLength(0);
  });
});
