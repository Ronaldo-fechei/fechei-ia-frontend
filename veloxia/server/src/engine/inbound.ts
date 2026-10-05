/**
 * Pipeline de eventos recebidos, comum a todos os canais:
 *
 * evento → conta do canal → espaço de trabalho → contato → mensagem
 * (idempotente) → correspondência → prioridade → cooldown / regras →
 * criação da execução → fila "execution.run".
 *
 * Cada canal só traduz o seu webhook para `InboundMessage` (ver
 * channels/*-webhook.ts). Cada item roda em uma transação que bloqueia a linha
 * do contato, serializando mensagens simultâneas da mesma pessoa.
 */
import { and, desc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { parseFlow, type NodeDataMap } from "@veloxia/shared";
import { db, type DbOrTx, type Tx } from "../db/client";
import { automationExecutions, automations, commentEvents, contacts, conversations, messages, type ExecutionContext, type MessageSource } from "../db/schema";
import { logger } from "../lib/logger";
import { checkLimit, isInCurrentMonth } from "../modules/billing/limits";
import { track } from "../services/analytics";
import { publishEvent } from "../services/events";
import { notify } from "../services/notifications";
import { enqueue } from "../queue/queue";
import { getDriver } from "../channels/registry";
import type { ChannelAccount, ContactRow, InboundEventKind } from "../channels/types";
import { findMatches, type AutomationMatch, type CandidateAutomation } from "./matching";
import { parseButtonPayload } from "./runner";

type Conversation = typeof conversations.$inferSelect;

/** Mensagem recebida, já traduzida do formato do canal. */
export interface InboundMessage {
  externalId: string | null;
  type: string;
  text: string;
  payload: Record<string, unknown> | null;
  event: InboundEventKind;
  /** Payload de botão/lista tocado pelo contato (identifica o fluxo que aguarda). */
  buttonPayload?: string;
  /** Origem do contato (dm, story_reply, referral, whatsapp…). */
  source: string;
}

/* ------------------------------------------------------------------ */
/* Contatos e conversas                                                */
/* ------------------------------------------------------------------ */

export interface ContactIdentity {
  externalId: string;
  username?: string | null;
  name?: string | null;
  phone?: string | null;
}

export async function upsertContact(
  tx: Tx,
  account: ChannelAccount,
  identity: ContactIdentity,
  opts: { inbound: boolean; at: Date; source: string },
): Promise<{ contact: ContactRow; created: boolean; previousInboundAt: Date | null }> {
  // Bloqueia o contato (se existir) e guarda a última mensagem anterior (limite mensal de contatos ativos).
  const [before] = await tx
    .select({ lastInboundAt: contacts.lastInboundAt })
    .from(contacts)
    .where(and(eq(contacts.channelAccountId, account.id), eq(contacts.externalId, identity.externalId)))
    .for("update")
    .limit(1);

  const rows = await tx.execute(sql`
    insert into contacts (workspace_id, channel_account_id, channel, external_id, username, name, phone, source, first_interaction_at, last_interaction_at, last_inbound_at)
    values (${account.workspaceId}, ${account.id}, ${account.channel}, ${identity.externalId}, ${identity.username ?? null}, ${identity.name ?? null},
            ${identity.phone ?? null}, ${opts.source}, ${opts.at.toISOString()}::timestamptz, ${opts.at.toISOString()}::timestamptz,
            ${opts.inbound ? opts.at.toISOString() : null}::timestamptz)
    on conflict (channel_account_id, external_id) do update set
      last_interaction_at = greatest(contacts.last_interaction_at, excluded.last_interaction_at),
      last_inbound_at = case when ${opts.inbound} then greatest(coalesce(contacts.last_inbound_at, excluded.last_inbound_at), excluded.last_inbound_at) else contacts.last_inbound_at end,
      username = coalesce(contacts.username, excluded.username),
      name = coalesce(excluded.name, contacts.name),
      phone = coalesce(contacts.phone, excluded.phone),
      updated_at = now()
    returning id, (xmax = 0) as inserted
  `);
  const row = rows.rows[0] as { id: string; inserted: boolean };
  const [contact] = await tx.select().from(contacts).where(eq(contacts.id, row.id)).limit(1);
  return { contact, created: row.inserted, previousInboundAt: before?.lastInboundAt ?? null };
}

export async function upsertConversation(
  tx: Tx,
  account: ChannelAccount,
  contact: ContactRow,
  update?: { at: Date; preview: string; direction: "inbound" | "outbound" },
): Promise<{ conversation: Conversation; created: boolean }> {
  const preview = update?.preview.slice(0, 200) ?? null;
  const rows = await tx.execute(sql`
    insert into conversations (workspace_id, channel_account_id, channel, contact_id, last_message_at, last_message_preview, last_message_direction, unread_count)
    values (${account.workspaceId}, ${account.id}, ${account.channel}, ${contact.id}, ${update ? update.at.toISOString() : null}::timestamptz, ${preview},
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

export function previewFor(p: { type: string; text: string }): string {
  if (p.text) return p.text;
  const labels: Record<string, string> = {
    image: "📷 Imagem",
    video: "🎬 Vídeo",
    audio: "🎤 Áudio",
    file: "📎 Arquivo",
    document: "📎 Documento",
    sticker: "💟 Figurinha",
    location: "📍 Localização",
    contacts: "👤 Contato",
    share: "🔗 Compartilhamento",
    story_mention: "📣 Mencionou você em um Story",
    story_reply: "💬 Respondeu ao seu Story",
    ig_reel: "🎞️ Reel",
    reel: "🎞️ Reel",
    reaction: "Reagiu a uma mensagem",
    unsupported: "Mensagem não suportada",
  };
  return labels[p.type] ?? "Mensagem";
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

/** Mensagem enviada pela própria conta fora do Veloxia (app oficial), recebida por eco. */
export async function recordEcho(
  tx: Tx,
  account: ChannelAccount,
  identity: ContactIdentity,
  parsed: InboundMessage,
  at: Date,
  source: MessageSource = "native_app",
): Promise<void> {
  const { contact } = await upsertContact(tx, account, identity, { inbound: false, at, source: parsed.source });
  const { conversation } = await upsertConversation(tx, account, contact, { at, preview: previewFor(parsed), direction: "outbound" });
  await tx
    .insert(messages)
    .values({
      workspaceId: account.workspaceId,
      conversationId: conversation.id,
      contactId: contact.id,
      channelAccountId: account.id,
      direction: "outbound",
      source,
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
}

/** Registra a mensagem do contato e decide qual automação (se alguma) responde. */
export async function handleInboundMessage(tx: Tx, account: ChannelAccount, identity: ContactIdentity, parsed: InboundMessage, at: Date): Promise<void> {
  const { contact, created: contactCreated, previousInboundAt } = await upsertContact(tx, account, identity, { inbound: true, at, source: parsed.source });
  const { conversation, created: convCreated } = await upsertConversation(tx, account, contact, { at, preview: previewFor(parsed), direction: "inbound" });

  const inserted = await tx
    .insert(messages)
    .values({
      workspaceId: account.workspaceId,
      conversationId: conversation.id,
      contactId: contact.id,
      channelAccountId: account.id,
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
  await track(account.workspaceId, `messages_in_${account.channel}`, { at }, tx);
  const driver = getDriver(account.channel);
  if (driver.fetchProfile) {
    if (contactCreated) {
      await enqueue("contact.fetch_profile", { contactId: contact.id }, { dedupeKey: `profile:${contact.id}` }, tx);
    } else if (!contact.profileFetchedAt || Date.now() - contact.profileFetchedAt.getTime() > 3 * 86400_000) {
      // Nome e foto podem mudar (e as URLs de foto expiram): atualiza a cada poucos dias.
      await enqueue("contact.fetch_profile", { contactId: contact.id }, { dedupeKey: `profile:${contact.id}:${at.toISOString().slice(0, 10)}` }, tx);
    }
  }
  if (contactCreated) await track(account.workspaceId, "contacts_new", { at }, tx);
  if (convCreated) await track(account.workspaceId, "conversations_new", { at }, tx);

  // Quem comentou e depois respondeu no Direct conta como conversão.
  if (account.channel === "instagram") {
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
  }

  const newActiveContact = !(await isInCurrentMonth(account.workspaceId, previousInboundAt, tx));
  await decideAutomation(tx, { account, contact, contactCreated, newActiveContact, conversation, messageId: inserted[0].id, parsed });
  await publishEvent({ workspaceId: account.workspaceId, type: "message.created", ids: { conversationId: conversation.id } }, tx);
}

interface DecideInput {
  account: ChannelAccount;
  contact: ContactRow;
  contactCreated: boolean;
  newActiveContact: boolean;
  conversation: Conversation;
  messageId: string;
  parsed: InboundMessage;
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
    ? await tx
        .select()
        .from(automationExecutions)
        .where(and(waitingFilter, eq(automationExecutions.id, btn.executionId), eq(automationExecutions.channelAccountId, account.id)))
        .limit(1)
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

  // 2. Correspondência de palavras-chave.
  const candidates = await loadActiveAutomations(tx, account);
  if (!candidates.length) return;
  const match = findMatches({ kind: parsed.event, text: parsed.text }, candidates)[0];
  if (!match) return;

  await createExecution(tx, {
    account,
    contact,
    contactCreated: input.contactCreated,
    newActiveContact: input.newActiveContact,
    conversation,
    match,
    triggerEvent: parsed.event,
    inboundText: parsed.text,
    triggerMessageId: input.messageId,
    context: { origin: parsed.event, channel: account.channel, inboundText: parsed.text },
  });
}

function isInputFor(execution: typeof automationExecutions.$inferSelect, parsed: InboundMessage): boolean {
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
export type Candidate = CandidateAutomation & { row: AutomationRow };

/** Automações ativas que respondem neste canal/conta. */
export async function loadActiveAutomations(tx: Tx, account: ChannelAccount): Promise<Candidate[]> {
  const rows = await tx
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, account.workspaceId),
        eq(automations.status, "active"),
        sql`${account.channel} = any(${automations.channels})`,
        or(isNull(automations.channelAccountId), eq(automations.channelAccountId, account.id)),
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

export interface CreateExecutionInput {
  account: ChannelAccount;
  contact: ContactRow;
  contactCreated: boolean;
  /** Primeira mensagem do contato neste mês (conta para o limite de contatos ativos). */
  newActiveContact: boolean;
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
  const scope = getDriver(account.channel).requiredScope(input.triggerEvent);
  if (scope && !account.scopes.includes(scope)) return "missing_permission";

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

  // Contatos ativos no mês: quem já conversou neste mês continua sendo atendido.
  if (input.newActiveContact) {
    // O contato atual já foi contado (a mensagem acabou de ser registrada): compara sem somar.
    const contactsLimit = await checkLimit(account.workspaceId, "active_contacts_per_month", 0, tx);
    if (!contactsLimit.ok) {
      await notify(
        {
          workspaceId: account.workspaceId,
          type: "limit_reached",
          severity: "warning",
          title: "Limite de contatos ativos do mês atingido",
          body: `${contactsLimit.message} Novos contatos não recebem respostas automáticas até o próximo mês ou até você mudar de plano.`,
          linkUrl: "/app/configuracoes?aba=plano",
          dedupeKey: "limit:active_contacts",
          dedupeWindowMinutes: 24 * 60,
        },
        tx,
      );
      return "limit_reached";
    }
  }
  return null;
}

export async function createExecution(tx: Tx, input: CreateExecutionInput): Promise<string | null> {
  const candidate = input.match.automation as Candidate;
  const automation = candidate.row;
  const reason = await skipReason(tx, input, automation);
  const base = {
    workspaceId: input.account.workspaceId,
    automationId: automation.id,
    automationName: automation.name,
    channelAccountId: input.account.id,
    channel: input.account.channel,
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

/** Encerra fluxos que esperam resposta há mais tempo que a janela permitida. */
export async function expireWaitingExecutions(tx: DbOrTx = db): Promise<number> {
  const result = await tx
    .update(automationExecutions)
    .set({ status: "completed", skipReason: "no_reply", currentNodeId: null, waitType: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(automationExecutions.status, "waiting"), eq(automationExecutions.waitType, "input"), sql`${automationExecutions.waitUntil} < now()`))
    .returning({ id: automationExecutions.id });
  return result.length;
}

/** Cancela fluxos em andamento de um contato (ex.: atendimento humano assumiu). */
export async function cancelContactExecutions(contactId: string, reason: string, tx: DbOrTx = db): Promise<void> {
  await tx
    .update(automationExecutions)
    .set({ status: "cancelled", skipReason: reason, finishedAt: new Date(), updatedAt: new Date(), waitType: null })
    .where(and(eq(automationExecutions.contactId, contactId), inArray(automationExecutions.status, ["waiting"])));
}
