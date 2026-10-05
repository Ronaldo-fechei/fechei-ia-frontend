/** Caixa de entrada: conversas, histórico, envio manual e atendimento humano. */
import { and, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIMITS } from "@veloxia/shared";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { automationExecutions, automations, contacts, contactTags, conversations, instagramAccounts, messages, tags, users } from "../../db/schema";
import { AppError, badRequest, notFound } from "../../lib/errors";
import { pagination, parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { GraphApiError } from "../../integrations/instagram/client";
import { clientFor, handleAccountGraphError } from "../instagram/service";
import { track } from "../../services/analytics";
import { audit } from "../../services/audit";
import { publishEvent } from "../../services/events";
import { cancelContactExecutions } from "../../engine/processor";

async function conversationOrThrow(workspaceId: string, id: string) {
  const [row] = await db
    .select({ conversation: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound("Conversa não encontrada.");
  return row;
}

function windowInfo(lastInboundAt: Date | null) {
  const now = Date.now();
  const last = lastInboundAt?.getTime() ?? 0;
  const standardEnds = last ? last + LIMITS.messagingWindowHours * 3600_000 : 0;
  const humanAgentEnds = last ? last + 7 * 86400_000 : 0;
  const open = standardEnds > now;
  const humanAgent = !open && env.META_HUMAN_AGENT_ENABLED && humanAgentEnds > now;
  return { open, humanAgent, canReply: open || humanAgent, closesAt: open ? new Date(standardEnds) : humanAgent ? new Date(humanAgentEnds) : null };
}

export async function inboxRoutes(app: FastifyInstance) {
  app.get("/conversations", async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      pagination.extend({
        filter: z.enum(["all", "unread", "human", "automation", "closed"]).default("all"),
        q: z.string().max(80).optional(),
        tagId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const where: SQL[] = [eq(conversations.workspaceId, auth.workspace.id), sql`${conversations.lastMessageAt} is not null`];
    if (q.filter === "unread") where.push(sql`${conversations.unreadCount} > 0`);
    if (q.filter === "human") where.push(eq(conversations.mode, "human"));
    if (q.filter === "automation") where.push(eq(conversations.mode, "automation"));
    if (q.filter === "closed") where.push(eq(conversations.status, "closed"));
    if (q.q) {
      const term = `%${q.q.replace(/[%_@]/g, "")}%`;
      where.push(or(ilike(contacts.username, term), ilike(contacts.name, term), ilike(conversations.lastMessagePreview, term)) as SQL);
    }
    if (q.tagId) where.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${q.tagId})`);
    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        unreadCount: conversations.unreadCount,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageDirection: conversations.lastMessageDirection,
        contactId: contacts.id,
        contactName: contacts.name,
        contactUsername: contacts.username,
        contactPic: contacts.profilePicUrl,
        lastKeyword: contacts.lastKeyword,
        lastAutomationName: automations.name,
        tags: sql<{ id: string; name: string; color: string }[]>`coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name) from contact_tags ct join tags t on t.id = ct.tag_id where ct.contact_id = ${contacts.id}), '[]'::json)`,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(automations, eq(automations.id, contacts.lastAutomationId))
      .where(and(...where))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(q.pageSize + 1)
      .offset((q.page - 1) * q.pageSize);
    const [counts] = await db
      .select({
        unread: sql<number>`count(*) filter (where ${conversations.unreadCount} > 0)::int`,
        human: sql<number>`count(*) filter (where ${conversations.mode} = 'human')::int`,
      })
      .from(conversations)
      .where(and(eq(conversations.workspaceId, auth.workspace.id), sql`${conversations.lastMessageAt} is not null`));
    return { conversations: rows.slice(0, q.pageSize), hasMore: rows.length > q.pageSize, counts };
  });

  app.get("/conversations/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { conversation, contact } = await conversationOrThrow(auth.workspace.id, id);
    const contactTagRows = await db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(contactTags)
      .innerJoin(tags, eq(tags.id, contactTags.tagId))
      .where(eq(contactTags.contactId, contact.id));
    const [humanBy] = conversation.humanByUserId
      ? await db.select({ name: users.name }).from(users).where(eq(users.id, conversation.humanByUserId)).limit(1)
      : [];
    const [account] = await db.select({ username: instagramAccounts.username, status: instagramAccounts.status }).from(instagramAccounts).where(eq(instagramAccounts.id, conversation.instagramAccountId)).limit(1);
    return {
      conversation: { ...conversation, humanByName: humanBy?.name ?? null },
      contact: { ...contact, tags: contactTagRows },
      window: windowInfo(contact.lastInboundAt),
      account: account ?? null,
    };
  });

  app.get("/conversations/:id/messages", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const q = parse(z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
    await conversationOrThrow(auth.workspace.id, id);
    const where: SQL[] = [eq(messages.conversationId, id)];
    if (q.before) where.push(lt(messages.createdAt, new Date(q.before)));
    const rows = await db
      .select({
        id: messages.id,
        direction: messages.direction,
        source: messages.source,
        type: messages.type,
        text: messages.text,
        payload: messages.payload,
        status: messages.status,
        errorMessage: messages.errorMessage,
        createdAt: messages.createdAt,
        sentAt: messages.sentAt,
        automationName: automationExecutions.automationName,
        executionId: messages.executionId,
        sentByName: users.name,
      })
      .from(messages)
      .leftJoin(automationExecutions, eq(automationExecutions.id, messages.executionId))
      .leftJoin(users, eq(users.id, messages.sentByUserId))
      .where(and(...where))
      .orderBy(desc(messages.createdAt))
      .limit(q.limit + 1);
    // Mensagens recebidas que acionaram automações
    const triggered = await db
      .select({ messageId: automationExecutions.triggerMessageId, automationName: automationExecutions.automationName, keyword: automationExecutions.matchedKeyword, status: automationExecutions.status, skipReason: automationExecutions.skipReason })
      .from(automationExecutions)
      .where(eq(automationExecutions.conversationId, id));
    const trigMap = new Map(triggered.filter((t) => t.messageId).map((t) => [t.messageId!, t]));
    const page = rows.slice(0, q.limit).reverse();
    return {
      messages: page.map((m) => ({ ...m, trigger: trigMap.get(m.id) ?? null })),
      hasMore: rows.length > q.limit,
    };
  });

  app.post("/conversations/:id/read", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await conversationOrThrow(auth.workspace.id, id);
    await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, id));
    await publishEvent({ workspaceId: auth.workspace.id, type: "conversation.updated", ids: { conversationId: id } });
    return { ok: true };
  });

  app.post("/conversations/:id/status", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { status } = parse(z.object({ status: z.enum(["open", "closed"]) }), req.body);
    await conversationOrThrow(auth.workspace.id, id);
    await db.update(conversations).set({ status, updatedAt: new Date() }).where(eq(conversations.id, id));
    await publishEvent({ workspaceId: auth.workspace.id, type: "conversation.updated", ids: { conversationId: id } });
    return { ok: true };
  });

  /** "Assumir conversa": pausa as automações para este contato. */
  app.post("/conversations/:id/takeover", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { contact } = await conversationOrThrow(auth.workspace.id, id);
    await db
      .update(conversations)
      .set({ mode: "human", humanSince: new Date(), humanByUserId: auth.user.id, status: "open", updatedAt: new Date() })
      .where(eq(conversations.id, id));
    await cancelContactExecutions(contact.id, "human_takeover");
    await audit({ workspaceId: auth.workspace.id, userId: auth.user.id, action: "conversation.takeover", entityType: "conversation", entityId: id });
    await publishEvent({ workspaceId: auth.workspace.id, type: "conversation.updated", ids: { conversationId: id } });
    return { ok: true };
  });

  /** "Retomar automação": as automações voltam a responder este contato. */
  app.post("/conversations/:id/resume", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await conversationOrThrow(auth.workspace.id, id);
    await db.update(conversations).set({ mode: "automation", humanSince: null, humanByUserId: null, updatedAt: new Date() }).where(eq(conversations.id, id));
    await audit({ workspaceId: auth.workspace.id, userId: auth.user.id, action: "conversation.resume_automation", entityType: "conversation", entityId: id });
    await publishEvent({ workspaceId: auth.workspace.id, type: "conversation.updated", ids: { conversationId: id } });
    return { ok: true };
  });

  /** Envio manual por um atendente (exige atendimento humano ativo). */
  app.post("/conversations/:id/messages", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { text } = parse(z.object({ text: z.string().trim().min(1, "Escreva uma mensagem").max(LIMITS.textMaxLength, `Máximo de ${LIMITS.textMaxLength} caracteres`) }), req.body);
    const { conversation, contact } = await conversationOrThrow(auth.workspace.id, id);
    if (conversation.mode !== "human") throw badRequest('Clique em "Assumir conversa" para responder manualmente.');
    const window = windowInfo(contact.lastInboundAt);
    if (!window.canReply) {
      throw new AppError(409, "window_closed", "A janela de 24h para responder este contato terminou. Você poderá responder quando ele enviar uma nova mensagem.");
    }
    const [account] = await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, conversation.instagramAccountId)).limit(1);
    if (!account || account.disconnectedAt || account.status !== "connected") {
      throw new AppError(409, "instagram_disconnected", "Não foi possível enviar esta mensagem. Verifique a conexão com o Instagram.");
    }

    const [row] = await db
      .insert(messages)
      .values({
        workspaceId: auth.workspace.id,
        conversationId: id,
        contactId: contact.id,
        instagramAccountId: account.id,
        direction: "outbound",
        source: "agent",
        type: "text",
        text,
        status: "sending",
        sentByUserId: auth.user.id,
      })
      .returning();
    try {
      const result = await clientFor(account).sendMessage({ id: contact.igsid }, { text }, { humanAgent: window.humanAgent });
      if (result.message_id) {
        await db
          .delete(messages)
          .where(and(eq(messages.instagramAccountId, account.id), eq(messages.externalId, result.message_id), eq(messages.source, "instagram_app")));
      }
      const sentAt = new Date();
      await db.update(messages).set({ status: "sent", externalId: result.message_id ?? null, sentAt }).where(eq(messages.id, row.id));
      await db
        .update(conversations)
        .set({ lastMessageAt: sentAt, lastMessagePreview: text.slice(0, 200), lastMessageDirection: "outbound", unreadCount: 0, updatedAt: sentAt })
        .where(eq(conversations.id, id));
      await track(auth.workspace.id, "messages_out_agent");
      await publishEvent({ workspaceId: auth.workspace.id, type: "message.created", ids: { conversationId: id } });
      return reply.code(201).send({ message: { ...row, status: "sent", sentAt } });
    } catch (err) {
      const userMessage = err instanceof GraphApiError ? err.userMessage : "Não foi possível enviar esta mensagem. Verifique a conexão com o Instagram.";
      await db.update(messages).set({ status: "failed", errorMessage: userMessage, errorCode: err instanceof GraphApiError ? err.errorCode : "unknown" }).where(eq(messages.id, row.id));
      if (err instanceof GraphApiError) await handleAccountGraphError(account, err);
      await publishEvent({ workspaceId: auth.workspace.id, type: "message.updated", ids: { conversationId: id } });
      throw badRequest(userMessage);
    }
  });
}
