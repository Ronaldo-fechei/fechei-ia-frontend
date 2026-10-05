/** Caixa de entrada: conversas, histórico, envio manual e atendimento humano. */
import { and, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CHANNEL_INFO, CHANNELS, LIMITS, templateParamCount, type Channel } from "@veloxia/shared";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { automationExecutions, automations, channelAccounts, contacts, contactTags, conversations, messages, tags, users, whatsappTemplates } from "../../db/schema";
import { AppError, badRequest, notFound } from "../../lib/errors";
import { pagination, parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { accountLabel, handleAccountError, publicAccount } from "../../channels/accounts";
import { instagramClient } from "../../channels/instagram";
import { getDriver } from "../../channels/registry";
import { contentPreview, type OutboundContent } from "../../engine/channel";
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

/**
 * Janela de atendimento: 24h após a última mensagem do contato.
 * Instagram: com o recurso Human Agent aprovado, até 7 dias.
 * WhatsApp: fora da janela só modelos aprovados (templateRequired).
 */
function windowInfo(channel: Channel, lastInboundAt: Date | null) {
  const now = Date.now();
  const last = lastInboundAt?.getTime() ?? 0;
  const standardEnds = last ? last + CHANNEL_INFO[channel].messagingWindowHours * 3600_000 : 0;
  const humanAgentEnds = last ? last + 7 * 86400_000 : 0;
  const open = standardEnds > now;
  const humanAgent = channel === "instagram" && !open && env.META_HUMAN_AGENT_ENABLED && humanAgentEnds > now;
  return {
    open,
    humanAgent,
    canReply: open || humanAgent,
    templateRequired: !open && CHANNEL_INFO[channel].supportsTemplatesOutsideWindow,
    closesAt: open ? new Date(standardEnds) : humanAgent ? new Date(humanAgentEnds) : null,
  };
}

export async function inboxRoutes(app: FastifyInstance) {
  app.get("/conversations", async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      pagination.extend({
        filter: z.enum(["all", "unread", "human", "automation", "closed"]).default("all"),
        q: z.string().max(80).optional(),
        tagId: z.string().uuid().optional(),
        channel: z.enum(CHANNELS).optional(),
      }),
      req.query,
    );
    const where: SQL[] = [eq(conversations.workspaceId, auth.workspace.id), sql`${conversations.lastMessageAt} is not null`];
    if (q.channel) where.push(eq(conversations.channel, q.channel));
    if (q.filter === "unread") where.push(sql`${conversations.unreadCount} > 0`);
    if (q.filter === "human") where.push(eq(conversations.mode, "human"));
    if (q.filter === "automation") where.push(eq(conversations.mode, "automation"));
    if (q.filter === "closed") where.push(eq(conversations.status, "closed"));
    if (q.q) {
      const term = `%${q.q.replace(/[%_@]/g, "")}%`;
      where.push(
        or(ilike(contacts.username, term), ilike(contacts.name, term), ilike(contacts.phone, term), ilike(conversations.lastMessagePreview, term)) as SQL,
      );
    }
    if (q.tagId) where.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${q.tagId})`);
    const rows = await db
      .select({
        id: conversations.id,
        status: conversations.status,
        mode: conversations.mode,
        unreadCount: conversations.unreadCount,
        channel: conversations.channel,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageDirection: conversations.lastMessageDirection,
        contactId: contacts.id,
        contactName: contacts.name,
        contactUsername: contacts.username,
        contactPhone: contacts.phone,
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
    const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, conversation.channelAccountId)).limit(1);
    return {
      conversation: { ...conversation, humanByName: humanBy?.name ?? null },
      contact: { ...contact, tags: contactTagRows },
      window: windowInfo(conversation.channel, contact.lastInboundAt),
      account: account ? publicAccount(account) : null,
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

  /** Envio manual por um atendente (exige atendimento humano ativo). Texto ou, no WhatsApp, um modelo aprovado. */
  app.post("/conversations/:id/messages", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z
        .object({
          text: z.string().trim().max(LIMITS.textMaxLength, `Máximo de ${LIMITS.textMaxLength} caracteres`).optional(),
          template: z.object({ templateId: z.string().uuid(), params: z.array(z.string().max(500)).max(LIMITS.maxTemplateParams).default([]) }).optional(),
        })
        .refine((v) => !!v.text || !!v.template, "Escreva uma mensagem"),
      req.body,
    );
    const { conversation, contact } = await conversationOrThrow(auth.workspace.id, id);
    if (conversation.mode !== "human") throw badRequest('Clique em "Assumir conversa" para responder manualmente.');
    const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, conversation.channelAccountId)).limit(1);
    if (!account || account.disconnectedAt || account.status !== "connected") {
      throw new AppError(409, "channel_disconnected", "Não foi possível enviar esta mensagem. Verifique a conexão do canal em Canais.");
    }
    const window = windowInfo(account.channel, contact.lastInboundAt);

    let content: OutboundContent;
    if (input.template) {
      if (account.channel !== "whatsapp") throw badRequest("Modelos de mensagem existem só no WhatsApp.");
      const [tpl] = await db
        .select()
        .from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.id, input.template.templateId), eq(whatsappTemplates.channelAccountId, account.id)))
        .limit(1);
      if (!tpl || tpl.status !== "APPROVED") throw badRequest("Escolha um modelo aprovado pela Meta para este número.");
      const expected = templateParamCount(tpl.bodyText);
      if (input.template.params.filter((p) => p.trim()).length < expected) throw badRequest("Preencha todas as variáveis do modelo.");
      let previewText = tpl.bodyText;
      input.template.params.forEach((value, i) => (previewText = previewText.split(`{{${i + 1}}}`).join(value)));
      content = { kind: "template", name: tpl.name, language: tpl.language, previewText, bodyParams: input.template.params.slice(0, expected) };
    } else {
      if (!window.canReply) {
        throw new AppError(
          409,
          "window_closed",
          window.templateRequired
            ? "A janela de 24h terminou. No WhatsApp, envie um modelo aprovado para retomar a conversa."
            : "A janela de 24h para responder este contato terminou. Você poderá responder quando ele enviar uma nova mensagem.",
        );
      }
      content = { kind: "text", text: input.text! };
    }

    const [row] = await db
      .insert(messages)
      .values({
        workspaceId: auth.workspace.id,
        conversationId: id,
        contactId: contact.id,
        channelAccountId: account.id,
        direction: "outbound",
        source: "agent",
        type: content.kind,
        text: contentPreview(content),
        payload: content.kind === "template" ? { content } : null,
        status: "sending",
        sentByUserId: auth.user.id,
      })
      .returning();
    const driver = getDriver(account.channel);
    try {
      let externalId: string | undefined;
      if (account.channel === "instagram" && window.humanAgent && content.kind === "text") {
        // Instagram fora das 24h: só com o recurso Human Agent aprovado pela Meta.
        const result = await instagramClient(account).sendMessage({ id: contact.externalId }, { text: content.text }, { humanAgent: true });
        externalId = result.message_id;
      } else {
        externalId = (await driver.adapter(account).send({ contactExternalId: contact.externalId }, content)).externalMessageId;
      }
      if (externalId) {
        await db
          .delete(messages)
          .where(and(eq(messages.channelAccountId, account.id), eq(messages.externalId, externalId), eq(messages.source, "native_app")));
      }
      const sentAt = new Date();
      await db.update(messages).set({ status: "sent", externalId: externalId ?? null, sentAt }).where(eq(messages.id, row.id));
      await db
        .update(conversations)
        .set({ lastMessageAt: sentAt, lastMessagePreview: contentPreview(content).slice(0, 200), lastMessageDirection: "outbound", unreadCount: 0, updatedAt: sentAt })
        .where(eq(conversations.id, id));
      await track(auth.workspace.id, "messages_out_agent");
      await publishEvent({ workspaceId: auth.workspace.id, type: "message.created", ids: { conversationId: id } });
      return reply.code(201).send({ message: { ...row, status: "sent", sentAt } });
    } catch (err) {
      const channelErr = driver.toChannelError(err);
      const userMessage = channelErr.code === "unknown" ? `Não foi possível enviar esta mensagem. Verifique a conexão do ${accountLabel(account)}.` : channelErr.userMessage;
      await db.update(messages).set({ status: "failed", errorMessage: userMessage, errorCode: channelErr.code }).where(eq(messages.id, row.id));
      await handleAccountError(account, channelErr);
      await publishEvent({ workspaceId: auth.workspace.id, type: "message.updated", ids: { conversationId: id } });
      throw badRequest(userMessage);
    }
  });
}
