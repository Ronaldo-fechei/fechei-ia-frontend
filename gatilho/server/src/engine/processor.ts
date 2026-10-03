/**
 * Pipeline de eventos recebidos (seção "Motor de automação"):
 *
 * evento → conta Instagram → espaço de trabalho → contato → mensagem
 * (idempotente) → normalização/correspondência → prioridade → cooldown /
 * regras → criação da execução → fila "execution.run".
 *
 * Cada item é processado em uma transação que bloqueia a linha do contato,
 * serializando mensagens simultâneas da mesma pessoa (anti-duplicidade).
 */
import { and, desc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { getTriggerNode, parseFlow, type Flow, type NodeDataMap } from "@gatilho/shared";
import { db, type Tx } from "../db/client";
import {
  automationExecutions,
  automations,
  commentEvents,
  contacts,
  conversations,
  instagramAccounts,
  messages,
  webhookEvents,
  type ExecutionContext,
} from "../db/schema";
import { logger } from "../lib/logger";
import { checkLimit } from "../modules/billing/limits";
import { track } from "../services/analytics";
import { publishEvent } from "../services/events";
import { notify } from "../services/notifications";
import { enqueue, PermanentJobError } from "../queue/queue";
import { findMatches, type AutomationMatch, type CandidateAutomation, type InboundEventKind } from "./matching";
import { parseButtonPayload } from "./runner";

type Account = typeof instagramAccounts.$inferSelect;
type Contact = typeof contacts.$inferSelect;
type Conversation = typeof conversations.$inferSelect;

/* ------------------------------------------------------------------ */
/* Tipos do payload de webhook (Instagram)                             */
/* ------------------------------------------------------------------ */

interface IgAttachment {
  type?: string;
  payload?: { url?: string; title?: string; reel_video_id?: string };
}

interface IgMessage {
  mid?: string;
  text?: string;
  attachments?: IgAttachment[];
  quick_reply?: { payload?: string };
  reply_to?: { mid?: string; story?: { id?: string; url?: string } };
  is_echo?: boolean;
  is_deleted?: boolean;
  is_unsupported?: boolean;
  referral?: Record<string, unknown>;
}

interface IgMessagingItem {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: IgMessage;
  postback?: { mid?: string; title?: string; payload?: string };
  read?: unknown;
  reaction?: unknown;
  referral?: Record<string, unknown>;
}

interface IgCommentValue {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
}

interface ParsedInbound {
  externalId: string | null;
  type: string;
  text: string;
  payload: Record<string, unknown> | null;
  event: InboundEventKind;
  buttonPayload?: string;
  source: string;
}

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export async function processWebhookEvent(eventId: string): Promise<void> {
  const [ev] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).limit(1);
  if (!ev) throw new PermanentJobError("Evento de webhook não encontrado");
  if (ev.status === "processed" || ev.status === "ignored") return;

  const payload = ev.payload as { object?: string; entry?: any[] };
  await db.update(webhookEvents).set({ attempts: sql`${webhookEvents.attempts} + 1` }).where(eq(webhookEvents.id, ev.id));

  if (payload.object !== "instagram") {
    await db.update(webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(webhookEvents.id, ev.id));
    return;
  }

  let handled = 0;
  try {
    for (const entry of payload.entry ?? []) {
      const account = await findAccount(String(entry?.id ?? ""));
      if (!account) {
        logger.info({ igId: entry?.id }, "webhook para conta não conectada — ignorado");
        continue;
      }
      handled++;
      await db.update(instagramAccounts).set({ lastWebhookAt: new Date() }).where(eq(instagramAccounts.id, account.id));
      for (const item of (entry.messaging ?? []) as IgMessagingItem[]) await handleMessaging(account, item);
      for (const change of (entry.changes ?? []) as { field?: string; value?: IgCommentValue }[]) {
        if ((change.field === "comments" || change.field === "live_comments") && change.value) await handleComment(account, change.value);
      }
    }
  } catch (err) {
    await db
      .update(webhookEvents)
      .set({ status: "failed", error: (err as Error).message?.slice(0, 1000) })
      .where(eq(webhookEvents.id, ev.id));
    throw err;
  }
  await db
    .update(webhookEvents)
    .set({ status: handled ? "processed" : "ignored", processedAt: new Date(), error: null })
    .where(eq(webhookEvents.id, ev.id));
}

async function findAccount(igId: string): Promise<Account | null> {
  if (!igId) return null;
  const [account] = await db
    .select()
    .from(instagramAccounts)
    .where(and(or(eq(instagramAccounts.igUserId, igId), eq(instagramAccounts.igScopedId, igId)), isNull(instagramAccounts.disconnectedAt)))
    .limit(1);
  return account ?? null;
}

/* ------------------------------------------------------------------ */
/* Contatos e conversas                                                */
/* ------------------------------------------------------------------ */

export async function upsertContact(
  tx: Tx,
  account: Account,
  igsid: string,
  opts: { inbound: boolean; at: Date; source: string; username?: string | null },
): Promise<{ contact: Contact; created: boolean }> {
  const rows = await tx.execute(sql`
    insert into contacts (workspace_id, instagram_account_id, igsid, username, source, first_interaction_at, last_interaction_at, last_inbound_at)
    values (${account.workspaceId}, ${account.id}, ${igsid}, ${opts.username ?? null}, ${opts.source}, ${opts.at.toISOString()}::timestamptz,
            ${opts.at.toISOString()}::timestamptz, ${opts.inbound ? opts.at.toISOString() : null}::timestamptz)
    on conflict (instagram_account_id, igsid) do update set
      last_interaction_at = greatest(contacts.last_interaction_at, excluded.last_interaction_at),
      last_inbound_at = case when ${opts.inbound} then greatest(coalesce(contacts.last_inbound_at, excluded.last_inbound_at), excluded.last_inbound_at) else contacts.last_inbound_at end,
      username = coalesce(contacts.username, excluded.username),
      updated_at = now()
    returning id, (xmax = 0) as inserted
  `);
  const row = rows.rows[0] as { id: string; inserted: boolean };
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, row.id)).limit(1);
  return { contact, created: row.inserted };
}

export async function upsertConversation(
  tx: Tx,
  account: Account,
  contact: Contact,
  update?: { at: Date; preview: string; direction: "inbound" | "outbound" },
): Promise<{ conversation: Conversation; created: boolean }> {
  const preview = update?.preview.slice(0, 200) ?? null;
  const rows = await tx.execute(sql`
    insert into conversations (workspace_id, instagram_account_id, contact_id, last_message_at, last_message_preview, last_message_direction, unread_count)
    values (${account.workspaceId}, ${account.id}, ${contact.id}, ${update ? update.at.toISOString() : null}::timestamptz, ${preview},
            ${update?.direction ?? null}, ${update?.direction === "inbound" ? 1 : 0})
    on conflict (contact_id) do update set
      last_message_at = case when ${!!update} then excluded.last_message_at else conversations.last_message_at end,
      last_message_preview = case when ${!!update} then excluded.last_message_preview else conversations.last_message_preview end,
      last_message_direction = case when ${!!update} then excluded.last_message_direction else conversations.last_message_direction end,
      unread_count = conversations.unread_count + case when ${update?.direction === "inbound"} then 1 else 0 end,
      status = case when ${update?.direction === "inbound"} then 'open' else conversations.status end,
      updated_at = now()
    returning id, (xmax = 0) as inserted
  `);
  const row = rows.rows[0] as { id: string; inserted: boolean };
  const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, row.id)).limit(1);
  return { conversation, created: row.inserted };
}

/* ------------------------------------------------------------------ */
/* Mensagens do Direct                                                  */
/* ------------------------------------------------------------------ */

function parseInbound(item: IgMessagingItem): ParsedInbound | null {
  if (item.postback) {
    return {
      externalId: item.postback.mid ?? null,
      type: "postback",
      text: item.postback.title ?? "",
      payload: { postback: item.postback },
      event: "dm",
      buttonPayload: item.postback.payload,
      source: "postback",
    };
  }
  const m = item.message;
  if (!m) return null;
  const attachments = m.attachments ?? [];
  const first = attachments[0];
  const payload: Record<string, unknown> = {};
  if (attachments.length) payload.attachments = attachments;
  if (m.reply_to) payload.replyTo = m.reply_to;
  if (m.referral) payload.referral = m.referral;

  if (first?.type === "story_mention") {
    return { externalId: m.mid ?? null, type: "story_mention", text: m.text ?? "", payload, event: "story_mention", source: "story_mention" };
  }
  if (m.reply_to?.story) {
    return { externalId: m.mid ?? null, type: "story_reply", text: m.text ?? "", payload, event: "story_reply", source: "story_reply" };
  }
  if (m.quick_reply?.payload) {
    return {
      externalId: m.mid ?? null,
      type: "quick_reply",
      text: m.text ?? "",
      payload: { ...payload, quickReply: m.quick_reply },
      event: "dm",
      buttonPayload: m.quick_reply.payload,
      source: "dm",
    };
  }
  if (m.is_unsupported) return { externalId: m.mid ?? null, type: "unsupported", text: "", payload, event: "dm", source: "dm" };
  const type = m.text ? "text" : first?.type ?? "text";
  return { externalId: m.mid ?? null, type, text: m.text ?? "", payload: Object.keys(payload).length ? payload : null, event: "dm", source: m.referral ? "referral" : "dm" };
}

function previewFor(p: { type: string; text: string }): string {
  if (p.text) return p.text;
  const labels: Record<string, string> = {
    image: "📷 Imagem",
    video: "🎬 Vídeo",
    audio: "🎤 Áudio",
    file: "📎 Arquivo",
    share: "🔗 Compartilhamento",
    story_mention: "📣 Mencionou você em um Story",
    story_reply: "💬 Respondeu ao seu Story",
    ig_reel: "🎞️ Reel",
    reel: "🎞️ Reel",
    unsupported: "Mensagem não suportada",
  };
  return labels[p.type] ?? "Mensagem";
}

async function handleMessaging(account: Account, item: IgMessagingItem): Promise<void> {
  const msg = item.message;
  if (!msg && !item.postback) return; // leitura, reação, referral isolado: sem ação

  const isEcho = !!msg?.is_echo || item.sender?.id === account.igUserId || item.sender?.id === account.igScopedId;
  const igsid = isEcho ? item.recipient?.id : item.sender?.id;
  if (!igsid) return;
  const at = item.timestamp ? new Date(item.timestamp) : new Date();

  if (msg?.is_deleted) {
    if (msg.mid) {
      await db
        .update(messages)
        .set({ status: "deleted", text: null, payload: null })
        .where(and(eq(messages.instagramAccountId, account.id), eq(messages.externalId, msg.mid)));
      await publishEvent({ workspaceId: account.workspaceId, type: "message.updated" });
    }
    return;
  }

  const parsed = parseInbound(item);
  if (!parsed) return;

  await db.transaction(async (tx) => {
    const { contact, created: contactCreated } = await upsertContact(tx, account, igsid, { inbound: !isEcho, at, source: parsed.source });
    const { conversation, created: convCreated } = await upsertConversation(tx, account, contact, {
      at,
      preview: previewFor(parsed),
      direction: isEcho ? "outbound" : "inbound",
    });

    if (isEcho) {
      // Mensagem enviada pela própria conta (app do Instagram ou nosso envio).
      await tx
        .insert(messages)
        .values({
          workspaceId: account.workspaceId,
          conversationId: conversation.id,
          contactId: contact.id,
          instagramAccountId: account.id,
          direction: "outbound",
          source: "instagram_app",
          type: parsed.type,
          text: parsed.text || null,
          payload: parsed.payload,
          externalId: parsed.externalId,
          status: "sent",
          createdAt: at,
          sentAt: at,
        })
        .onConflictDoNothing();
      await publishEvent({ workspaceId: account.workspaceId, type: "message.created", ids: { conversationId: conversation.id } }, tx);
      return;
    }

    const inserted = await tx
      .insert(messages)
      .values({
        workspaceId: account.workspaceId,
        conversationId: conversation.id,
        contactId: contact.id,
        instagramAccountId: account.id,
        direction: "inbound",
        source: "contact",
        type: parsed.type,
        text: parsed.text || null,
        payload: parsed.payload,
        externalId: parsed.externalId,
        status: "received",
        createdAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (!inserted.length) return; // entrega duplicada do webhook: já processada

    await track(account.workspaceId, "messages_in", { at }, tx);
    if (contactCreated) {
      await track(account.workspaceId, "contacts_new", { at }, tx);
      await enqueue("contact.fetch_profile", { contactId: contact.id }, { dedupeKey: `profile:${contact.id}` }, tx);
    }
    if (convCreated) await track(account.workspaceId, "conversations_new", { at }, tx);

    // Quem comentou e depois respondeu no Direct conta como conversão.
    await tx
      .update(commentEvents)
      .set({ convertedAt: at })
      .where(
        and(
          eq(commentEvents.contactId, contact.id),
          isNull(commentEvents.convertedAt),
          eq(commentEvents.privateReplyStatus, "sent"),
          gt(commentEvents.createdAt, new Date(at.getTime() - 7 * 86400_000)),
        ),
      );

    await decideAutomation(tx, { account, contact, contactCreated, conversation, messageId: inserted[0].id, parsed });
    await publishEvent({ workspaceId: account.workspaceId, type: "message.created", ids: { conversationId: conversation.id } }, tx);
  });
}

interface DecideInput {
  account: Account;
  contact: Contact;
  contactCreated: boolean;
  conversation: Conversation;
  messageId: string;
  parsed: ParsedInbound;
}

async function decideAutomation(tx: Tx, input: DecideInput): Promise<void> {
  const { account, contact, conversation, parsed } = input;

  // 1. Resposta a um fluxo que aguarda o contato (botões / captura).
  const waitingFilter = and(
    eq(automationExecutions.workspaceId, account.workspaceId),
    eq(automationExecutions.status, "waiting"),
    eq(automationExecutions.waitType, "input"),
    gt(automationExecutions.waitUntil, new Date()),
  );
  const btn = parseButtonPayload(parsed.buttonPayload);
  let [waiting] = btn
    ? await tx.select().from(automationExecutions).where(and(waitingFilter, eq(automationExecutions.id, btn.executionId))).limit(1)
    : [];
  if (!waiting) {
    [waiting] = await tx
      .select()
      .from(automationExecutions)
      .where(and(waitingFilter, eq(automationExecutions.contactId, contact.id)))
      .orderBy(desc(automationExecutions.startedAt))
      .limit(1);
  }

  if (waiting && conversation.mode === "automation" && isInputFor(waiting, parsed)) {
    if (waiting.contactId !== contact.id) {
      // Ex.: fluxo iniciado por comentário e respondido no Direct com outro identificador.
      const [clash] = await tx
        .select({ id: automationExecutions.id })
        .from(automationExecutions)
        .where(
          and(
            eq(automationExecutions.contactId, contact.id),
            eq(automationExecutions.automationId, waiting.automationId ?? "00000000-0000-0000-0000-000000000000"),
            inArray(automationExecutions.status, ["running", "waiting"]),
          ),
        )
        .limit(1);
      if (!clash) {
        await tx
          .update(automationExecutions)
          .set({ contactId: contact.id, conversationId: conversation.id, updatedAt: new Date() })
          .where(eq(automationExecutions.id, waiting.id));
        await tx.update(commentEvents).set({ contactId: contact.id }).where(eq(commentEvents.executionId, waiting.id));
      }
    }
    await enqueue(
      "execution.run",
      { executionId: waiting.id, resume: { kind: "input", text: parsed.text, payload: parsed.buttonPayload } },
      { dedupeKey: `input:${input.messageId}` },
      tx,
    );
    return;
  }

  // 2. Correspondência de palavras-chave (botões de fluxos encerrados usam o próprio texto do botão).
  const candidates = await loadActiveAutomations(tx, account);
  if (!candidates.length) return;
  const matches = findMatches({ kind: parsed.event, text: parsed.text }, candidates);
  const match = matches[0];
  if (!match) return;

  await createExecution(tx, {
    account,
    contact,
    contactCreated: input.contactCreated,
    conversation,
    match,
    triggerEvent: parsed.event,
    inboundText: parsed.text,
    triggerMessageId: input.messageId,
    context: { origin: parsed.event, inboundText: parsed.text },
  });
}

function isInputFor(execution: typeof automationExecutions.$inferSelect, parsed: ParsedInbound): boolean {
  const flow = execution.flowSnapshot;
  const node = flow?.nodes.find((n) => n.id === execution.currentNodeId);
  if (!node) return false;
  if (node.type === "capture") return !!parsed.text.trim();
  if (node.type === "buttons") {
    const btn = parseButtonPayload(parsed.buttonPayload);
    if (btn) return btn.executionId === execution.id && btn.nodeId === node.id;
    const text = parsed.text.trim().toLocaleLowerCase("pt-BR");
    return (node.data as NodeDataMap["buttons"]).buttons.some((b) => b.kind === "reply" && b.title.trim().toLocaleLowerCase("pt-BR") === text);
  }
  return false;
}

type AutomationRow = typeof automations.$inferSelect;
type Candidate = CandidateAutomation & { row: AutomationRow };

async function loadActiveAutomations(tx: Tx, account: Account): Promise<Candidate[]> {
  const rows = await tx
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, account.workspaceId),
        eq(automations.status, "active"),
        or(isNull(automations.instagramAccountId), eq(automations.instagramAccountId, account.id)),
      ),
    );
  const out: Candidate[] = [];
  for (const row of rows) {
    if (!row.flow) continue;
    try {
      out.push({ id: row.id, name: row.name, priority: row.priority, createdAt: row.createdAt, triggerEvent: row.triggerEvent, flow: parseFlow(row.flow), row });
    } catch (err) {
      logger.warn({ err, automationId: row.id }, "fluxo publicado inválido — ignorado");
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Criação da execução (com proteções)                                  */
/* ------------------------------------------------------------------ */

interface CreateExecutionInput {
  account: Account;
  contact: Contact;
  contactCreated: boolean;
  conversation: Conversation;
  match: AutomationMatch;
  triggerEvent: InboundEventKind;
  inboundText: string;
  triggerMessageId?: string;
  triggerCommentId?: string;
  context: ExecutionContext;
}

async function skipReason(tx: Tx, input: CreateExecutionInput, automation: AutomationRow): Promise<string | null> {
  const { account, contact, conversation } = input;
  if (account.status !== "connected") return "account_disconnected";
  if (contact.status !== "active") return "opted_out";
  if (conversation.mode === "human") return "human_takeover";
  if (input.triggerEvent === "comment" && !account.scopes.includes("instagram_business_manage_comments")) return "missing_permission";
  if (input.triggerEvent !== "comment" && !account.scopes.includes("instagram_business_manage_messages")) return "missing_permission";

  if (automation.cooldownSeconds > 0) {
    const since = new Date(Date.now() - automation.cooldownSeconds * 1000);
    const [recent] = await tx
      .select({ id: automationExecutions.id })
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.automationId, automation.id),
          eq(automationExecutions.contactId, contact.id),
          notInArray(automationExecutions.status, ["skipped", "cancelled"]),
          gt(automationExecutions.startedAt, since),
        ),
      )
      .limit(1);
    if (recent) return "cooldown";
  }

  const messagesLimit = await checkLimit(account.workspaceId, "messages_per_month", 1, tx);
  if (!messagesLimit.ok) {
    await notify(
      {
        workspaceId: account.workspaceId,
        type: "limit_reached",
        severity: "warning",
        title: "Limite mensal de mensagens atingido",
        body: `${messagesLimit.message} As automações voltam no próximo mês ou ao mudar de plano.`,
        linkUrl: "/app/configuracoes?aba=plano",
        dedupeKey: "limit:messages",
        dedupeWindowMinutes: 24 * 60,
      },
      tx,
    );
    return "limit_reached";
  }
  if (input.contactCreated) {
    const contactsLimit = await checkLimit(account.workspaceId, "contacts", 0, tx);
    if (!contactsLimit.ok) {
      await notify(
        {
          workspaceId: account.workspaceId,
          type: "limit_reached",
          severity: "warning",
          title: "Limite de contatos atingido",
          body: `${contactsLimit.message} Novos contatos não recebem respostas automáticas.`,
          linkUrl: "/app/configuracoes?aba=plano",
          dedupeKey: "limit:contacts",
          dedupeWindowMinutes: 24 * 60,
        },
        tx,
      );
      return "limit_reached";
    }
  }
  return null;
}

async function createExecution(tx: Tx, input: CreateExecutionInput): Promise<string | null> {
  const candidate = input.match.automation as Candidate;
  const automation = candidate.row;
  const reason = await skipReason(tx, input, automation);
  const base = {
    workspaceId: input.account.workspaceId,
    automationId: automation.id,
    automationName: automation.name,
    instagramAccountId: input.account.id,
    contactId: input.contact.id,
    conversationId: input.conversation.id,
    triggerEvent: input.triggerEvent,
    triggerMessageId: input.triggerMessageId,
    triggerCommentId: input.triggerCommentId,
    inboundText: input.inboundText?.slice(0, 1000),
    matchedKeyword: input.match.matchedKeyword,
    startNodeId: input.match.startNodeId,
    flowVersion: automation.version,
  };

  if (reason) {
    await tx.insert(automationExecutions).values({ ...base, status: "skipped", skipReason: reason, finishedAt: new Date() });
    return null;
  }

  const inserted = await tx
    .insert(automationExecutions)
    .values({
      ...base,
      status: "running",
      currentNodeId: input.match.startNodeId,
      context: input.context,
      flowSnapshot: candidate.flow,
    })
    .onConflictDoNothing()
    .returning({ id: automationExecutions.id });

  if (!inserted.length) {
    await tx.insert(automationExecutions).values({ ...base, status: "skipped", skipReason: "already_running", finishedAt: new Date() });
    return null;
  }
  const executionId = inserted[0].id;

  // Um novo fluxo substitui fluxos que aguardavam resposta deste contato.
  await tx
    .update(automationExecutions)
    .set({ status: "cancelled", skipReason: "superseded", finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(automationExecutions.contactId, input.contact.id),
        eq(automationExecutions.status, "waiting"),
        eq(automationExecutions.waitType, "input"),
        sql`${automationExecutions.id} <> ${executionId}`,
      ),
    );

  await tx
    .update(automations)
    .set({ executionsCount: sql`${automations.executionsCount} + 1`, lastTriggeredAt: new Date() })
    .where(eq(automations.id, automation.id));
  await tx
    .update(contacts)
    .set({ lastKeyword: input.match.matchedKeyword ?? contacts.lastKeyword, lastAutomationId: automation.id, updatedAt: new Date() })
    .where(eq(contacts.id, input.contact.id));
  await track(input.account.workspaceId, "executions", { automationId: automation.id }, tx);
  await enqueue("execution.run", { executionId, resume: { kind: "start" } }, { dedupeKey: `run:${executionId}:start` }, tx);
  return executionId;
}

/* ------------------------------------------------------------------ */
/* Comentários → Direct                                                 */
/* ------------------------------------------------------------------ */

async function handleComment(account: Account, value: IgCommentValue): Promise<void> {
  const commentId = value.id;
  const fromId = value.from?.id;
  if (!commentId || !fromId) return;
  // Ignora comentários da própria conta (inclui nossas respostas públicas).
  if (fromId === account.igUserId || fromId === account.igScopedId || value.from?.username === account.username) return;

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(commentEvents)
      .values({
        workspaceId: account.workspaceId,
        instagramAccountId: account.id,
        commentId,
        mediaId: value.media?.id,
        mediaProductType: value.media?.media_product_type,
        parentId: value.parent_id,
        fromId,
        fromUsername: value.from?.username,
        text: value.text ?? "",
      })
      .onConflictDoNothing()
      .returning({ id: commentEvents.id });
    if (!inserted.length) return; // duplicado

    await track(account.workspaceId, "comments_in", {}, tx);

    const candidates = (await loadActiveAutomations(tx, account)).filter((c) => getTriggerNode(c.flow)?.data.event === "comment");
    const match = findMatches({ kind: "comment", text: value.text ?? "", mediaId: value.media?.id }, candidates)[0];
    if (!match) return;

    const { contact, created } = await upsertContact(tx, account, fromId, {
      inbound: false,
      at: new Date(),
      source: "comment",
      username: value.from?.username ?? null,
    });
    if (created) await track(account.workspaceId, "contacts_new", {}, tx);
    const { conversation, created: convCreated } = await upsertConversation(tx, account, contact);
    if (convCreated) await track(account.workspaceId, "conversations_new", {}, tx);

    const executionId = await createExecution(tx, {
      account,
      contact,
      contactCreated: created,
      conversation,
      match,
      triggerEvent: "comment",
      inboundText: value.text ?? "",
      triggerCommentId: commentId,
      context: { origin: "comment", commentId, inboundText: value.text ?? "", mediaId: value.media?.id },
    });

    await tx
      .update(commentEvents)
      .set({
        contactId: contact.id,
        automationId: match.automation.id,
        executionId,
        matchedKeyword: match.matchedKeyword,
        privateReplyStatus: executionId ? "none" : "skipped",
      })
      .where(eq(commentEvents.id, inserted[0].id));
    await publishEvent({ workspaceId: account.workspaceId, type: "execution.updated" }, tx);
  });
}

/** Encerra fluxos que esperam resposta há mais tempo que a janela permitida. */
export async function expireWaitingExecutions(): Promise<number> {
  const result = await db
    .update(automationExecutions)
    .set({ status: "completed", skipReason: "no_reply", currentNodeId: null, waitType: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(automationExecutions.status, "waiting"), eq(automationExecutions.waitType, "input"), sql`${automationExecutions.waitUntil} < now()`))
    .returning({ id: automationExecutions.id });
  return result.length;
}

/** Cancela fluxos em andamento de um contato (ex.: atendimento humano assumiu). */
export async function cancelContactExecutions(contactId: string, reason: string, tx: Tx | typeof db = db): Promise<void> {
  await tx
    .update(automationExecutions)
    .set({ status: "cancelled", skipReason: reason, finishedAt: new Date(), updatedAt: new Date(), waitType: null })
    .where(and(eq(automationExecutions.contactId, contactId), inArray(automationExecutions.status, ["waiting"])));
}

export type { Flow };
