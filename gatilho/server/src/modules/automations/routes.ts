import { and, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AUTOMATION_STATUSES,
  keywordKey,
  MATCH_TYPES,
  parseFlow,
  TEMPLATES,
  TRIGGER_EVENTS,
  type Flow,
} from "@gatilho/shared";
import { db } from "../../db/client";
import {
  automationExecutions,
  automations,
  automationTriggers,
  commentEvents,
  contacts,
  instagramAccounts,
  links,
  messages,
  tags,
} from "../../db/schema";
import { notFound } from "../../lib/errors";
import { pagination, parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { simulate } from "../../engine/simulator";
import type { CandidateAutomation } from "../../engine/matching";
import {
  createAutomation,
  createFromTemplate,
  deleteAutomation,
  duplicateAutomation,
  getAutomationOrThrow,
  listAutomations,
  publishAutomation,
  serializeAutomation,
  setAutomationStatus,
  updateAutomation,
} from "./service";

const createSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para a automação").max(80),
  description: z.string().max(300).optional(),
  kind: z.enum(["standard", "faq"]).optional(),
  mode: z.enum(["quick", "flow"]).default("quick"),
  quick: z.record(z.string(), z.unknown()).optional(),
  flow: z.unknown().optional(),
  triggerEvent: z.enum(TRIGGER_EVENTS).optional(),
  faqQuestion: z.string().max(300).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  cooldownSeconds: z.number().int().min(0).max(30 * 86400).optional(),
  instagramAccountId: z.string().uuid().nullable().optional(),
  publish: z.boolean().optional(),
});

const updateSchema = createSchema
  .omit({ mode: true, flow: true, triggerEvent: true, kind: true })
  .partial()
  .extend({ draftFlow: z.unknown().optional() });

const simulateSchema = z.object({
  message: z.string().max(1000).default(""),
  event: z.enum(["dm", "comment", "story_reply", "story_mention"]).default("dm"),
  useDraft: z.boolean().default(true),
  contact: z
    .object({
      name: z.string().max(80).optional(),
      username: z.string().max(60).optional(),
      tagIds: z.array(z.string()).max(50).optional(),
      fields: z.record(z.string(), z.string().max(500)).optional(),
      isFollower: z.boolean().nullable().optional(),
    })
    .optional(),
  resume: z
    .object({
      state: z.object({
        currentNodeId: z.string().nullable(),
        context: z.record(z.string(), z.unknown()),
        steps: z.array(z.record(z.string(), z.unknown())).max(200),
      }),
      reply: z.object({ text: z.string().max(1000).optional(), payload: z.string().max(300).optional() }),
    })
    .optional(),
});

async function tagNameMap(workspaceId: string) {
  const rows = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.workspaceId, workspaceId));
  return new Map(rows.map((t) => [t.id, t.name]));
}

async function primaryUsername(workspaceId: string): Promise<string | null> {
  const [acc] = await db
    .select({ username: instagramAccounts.username })
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.workspaceId, workspaceId), isNull(instagramAccounts.disconnectedAt)))
    .limit(1);
  return acc?.username ?? null;
}

export async function automationRoutes(app: FastifyInstance) {
  app.get("/templates", async (req) => {
    requireAuth(req);
    return {
      templates: TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        triggerEvent: t.triggerEvent,
        highlights: t.highlights,
        preview: t.build(),
      })),
    };
  });

  app.get("/automations", async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      z.object({
        status: z.enum(AUTOMATION_STATUSES).optional(),
        kind: z.enum(["standard", "faq"]).optional(),
        q: z.string().max(80).optional(),
        triggerEvent: z.enum(TRIGGER_EVENTS).optional(),
      }),
      req.query,
    );
    return { automations: await listAutomations(auth.workspace.id, q) };
  });

  app.post("/automations", async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(createSchema, req.body);
    const automation = await createAutomation(auth.workspace.id, auth.user.id, input);
    return reply.code(201).send({ automation: serializeAutomation(automation) });
  });

  app.post("/automations/from-template", async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ templateId: z.string().max(60), name: z.string().max(80).optional() }), req.body);
    const automation = await createFromTemplate(auth.workspace.id, auth.user.id, input.templateId, input.name);
    return reply.code(201).send({ automation: serializeAutomation(automation) });
  });

  app.get("/automations/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    return { automation: serializeAutomation(await getAutomationOrThrow(auth.workspace.id, id)) };
  });

  app.patch("/automations/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(updateSchema, req.body);
    return { automation: serializeAutomation(await updateAutomation(auth.workspace.id, auth.user.id, id, input)) };
  });

  /** Salvamento automático do construtor visual. */
  app.put("/automations/:id/draft", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { flow } = parse(z.object({ flow: z.unknown() }), req.body);
    const automation = await updateAutomation(auth.workspace.id, auth.user.id, id, { draftFlow: flow });
    return { automation: serializeAutomation(automation) };
  });

  app.post("/automations/:id/publish", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    return { automation: serializeAutomation(await publishAutomation(auth.workspace.id, auth.user.id, id)) };
  });

  app.post("/automations/:id/status", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { status } = parse(z.object({ status: z.enum(["active", "paused", "archived", "draft"]) }), req.body);
    return { automation: serializeAutomation(await setAutomationStatus(auth.workspace.id, auth.user.id, id, status)) };
  });

  app.post("/automations/:id/duplicate", async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    return reply.code(201).send({ automation: serializeAutomation(await duplicateAutomation(auth.workspace.id, auth.user.id, id)) });
  });

  app.delete("/automations/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await deleteAutomation(auth.workspace.id, auth.user.id, id);
    return { ok: true };
  });

  /** Simulador de uma automação (rascunho ou publicada). Não envia mensagens. */
  app.post("/automations/:id/test", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(simulateSchema, req.body);
    const automation = await getAutomationOrThrow(auth.workspace.id, id);
    const flow = parseFlow(input.useDraft || !automation.flow ? automation.draftFlow : automation.flow);
    const candidate: CandidateAutomation = {
      id: automation.id,
      name: automation.name,
      priority: automation.priority,
      createdAt: automation.createdAt,
      triggerEvent: automation.triggerEvent,
      flow,
    };
    const event = input.resume ? (input.resume.state.context.origin as typeof input.event) ?? input.event : input.event;
    return {
      result: await simulate({
        automations: [candidate],
        event,
        message: input.message,
        timezone: auth.workspace.timezone,
        accountUsername: await primaryUsername(auth.workspace.id),
        contact: input.contact,
        tagNames: await tagNameMap(auth.workspace.id),
        resume: input.resume ? { automationId: automation.id, state: input.resume.state as any, reply: input.resume.reply } : undefined,
      }),
    };
  });

  /** Qual automação ativa responderia a esta mensagem? (usa o motor real de correspondência) */
  app.post("/automations/test-match", async (req) => {
    const auth = requireAuth(req);
    const input = parse(simulateSchema.pick({ message: true, event: true }), req.body);
    const rows = await db
      .select()
      .from(automations)
      .where(and(eq(automations.workspaceId, auth.workspace.id), eq(automations.status, "active")));
    const candidates: CandidateAutomation[] = rows
      .filter((r) => r.flow)
      .map((r) => ({ id: r.id, name: r.name, priority: r.priority, createdAt: r.createdAt, triggerEvent: r.triggerEvent, flow: parseFlow(r.flow as Flow) }));
    return {
      result: await simulate({
        automations: candidates,
        event: input.event,
        message: input.message,
        timezone: auth.workspace.timezone,
        accountUsername: await primaryUsername(auth.workspace.id),
        tagNames: await tagNameMap(auth.workspace.id),
      }),
    };
  });

  app.get("/automations/:id/stats", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    await getAutomationOrThrow(auth.workspace.id, id);
    const since = new Date(Date.now() - days * 86400_000);
    const tz = auth.workspace.timezone;
    const byStatus = await db
      .select({ status: automationExecutions.status, n: sql<number>`count(*)::int` })
      .from(automationExecutions)
      .where(and(eq(automationExecutions.automationId, id), gte(automationExecutions.startedAt, since)))
      .groupBy(automationExecutions.status);
    const byDay = await db.execute(sql`
      select to_char(date_trunc('day', started_at at time zone ${tz}), 'YYYY-MM-DD') as day, count(*)::int as n
      from automation_executions where automation_id = ${id} and started_at >= ${since.toISOString()}::timestamptz and status <> 'skipped'
      group by 1 order by 1`);
    const keywords = await db
      .select({ keyword: automationExecutions.matchedKeyword, n: sql<number>`count(*)::int` })
      .from(automationExecutions)
      .where(and(eq(automationExecutions.automationId, id), gte(automationExecutions.startedAt, since), sql`${automationExecutions.matchedKeyword} is not null`))
      .groupBy(automationExecutions.matchedKeyword)
      .orderBy(desc(sql`count(*)`))
      .limit(10);
    const linkRows = await db.select({ title: links.title, url: links.url, clicks: links.clicksCount }).from(links).where(eq(links.automationId, id));
    const [sent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(automationExecutions, eq(automationExecutions.id, messages.executionId))
      .where(and(eq(automationExecutions.automationId, id), eq(messages.status, "sent"), gte(messages.createdAt, since)));
    return { byStatus, byDay: byDay.rows, keywords, links: linkRows, messagesSent: sent?.n ?? 0 };
  });

  /* ------------------------------ Palavras-chave ------------------------------ */

  app.get("/keywords", async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select({
        id: automationTriggers.id,
        keyword: automationTriggers.keyword,
        normalized: automationTriggers.normalized,
        matchType: automationTriggers.matchType,
        caseSensitive: automationTriggers.caseSensitive,
        ignoreAccents: automationTriggers.ignoreAccents,
        nodeId: automationTriggers.nodeId,
        automationId: automations.id,
        automationName: automations.name,
        automationStatus: automations.status,
        automationMode: automations.mode,
        triggerEvent: automations.triggerEvent,
        priority: automations.priority,
      })
      .from(automationTriggers)
      .innerJoin(automations, eq(automations.id, automationTriggers.automationId))
      .where(and(eq(automationTriggers.workspaceId, auth.workspace.id), sql`${automations.status} <> 'archived'`))
      .orderBy(automationTriggers.normalized);
    const hits = await db
      .select({ automationId: automationExecutions.automationId, keyword: automationExecutions.matchedKeyword, n: sql<number>`count(*)::int` })
      .from(automationExecutions)
      .where(and(eq(automationExecutions.workspaceId, auth.workspace.id), sql`${automationExecutions.matchedKeyword} is not null`))
      .groupBy(automationExecutions.automationId, automationExecutions.matchedKeyword);
    const hitMap = new Map(hits.map((h) => [`${h.automationId}::${h.keyword}`, h.n]));

    // Conflitos: mesma palavra-chave (normalizada) em mais de uma automação ativa do mesmo tipo de gatilho.
    const groups = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.automationStatus !== "active") continue;
      const key = `${r.triggerEvent}::${r.normalized}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)!.add(r.automationId);
    }
    return {
      keywords: rows.map((r) => ({
        ...r,
        hits: hitMap.get(`${r.automationId}::${r.keyword}`) ?? 0,
        conflict: r.automationStatus === "active" && (groups.get(`${r.triggerEvent}::${r.normalized}`)?.size ?? 0) > 1,
      })),
    };
  });

  /** Edita uma palavra-chave diretamente (atualiza o rascunho e, se ativa, republica). */
  app.patch("/keywords/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(
      z.object({
        text: z.string().trim().min(1).max(100).optional(),
        matchType: z.enum(MATCH_TYPES).optional(),
        caseSensitive: z.boolean().optional(),
        ignoreAccents: z.boolean().optional(),
        remove: z.boolean().optional(),
      }),
      req.body,
    );
    const [trigger] = await db
      .select()
      .from(automationTriggers)
      .where(and(eq(automationTriggers.id, id), eq(automationTriggers.workspaceId, auth.workspace.id)))
      .limit(1);
    if (!trigger) throw notFound("Palavra-chave não encontrada.");
    const automation = await getAutomationOrThrow(auth.workspace.id, trigger.automationId);
    const flow = parseFlow(automation.draftFlow);
    const node = flow.nodes.find((n) => n.id === trigger.nodeId && n.type === "keyword");
    if (!node) throw notFound("O bloco desta palavra-chave foi alterado. Abra a automação para editar.");
    const data = node.data as { keywords: { text: string; matchType: string; caseSensitive: boolean; ignoreAccents: boolean }[] };
    const idx = data.keywords.findIndex((k) => keywordKey(k) === keywordKey({ text: trigger.keyword, caseSensitive: trigger.caseSensitive, ignoreAccents: trigger.ignoreAccents }) && k.text === trigger.keyword);
    if (idx < 0) throw notFound("Palavra-chave não encontrada no rascunho.");
    if (input.remove) data.keywords.splice(idx, 1);
    else {
      const k = data.keywords[idx];
      data.keywords[idx] = {
        text: input.text ?? k.text,
        matchType: input.matchType ?? k.matchType,
        caseSensitive: input.caseSensitive ?? k.caseSensitive,
        ignoreAccents: input.ignoreAccents ?? k.ignoreAccents,
      };
    }
    let quick: Record<string, unknown> | undefined;
    if (automation.mode === "quick" && automation.quickConfig) quick = { ...automation.quickConfig, keywords: data.keywords };
    const updated = await updateAutomation(auth.workspace.id, auth.user.id, automation.id, {
      ...(quick ? { quick } : { draftFlow: flow }),
      publish: automation.status === "active",
    });
    return { automation: serializeAutomation(updated) };
  });

  /* ------------------------------ Logs de execução ------------------------------ */

  app.get("/executions", async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      pagination.extend({
        status: z.enum(["running", "waiting", "completed", "failed", "skipped", "cancelled"]).optional(),
        automationId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        q: z.string().max(80).optional(),
        days: z.coerce.number().int().min(1).max(365).optional(),
      }),
      req.query,
    );
    const where: SQL[] = [eq(automationExecutions.workspaceId, auth.workspace.id)];
    if (q.status) where.push(eq(automationExecutions.status, q.status));
    if (q.automationId) where.push(eq(automationExecutions.automationId, q.automationId));
    if (q.contactId) where.push(eq(automationExecutions.contactId, q.contactId));
    if (q.days) where.push(gte(automationExecutions.startedAt, new Date(Date.now() - q.days * 86400_000)));
    if (q.q) {
      const term = `%${q.q.replace(/[%_]/g, "")}%`;
      where.push(
        or(ilike(automationExecutions.inboundText, term), ilike(automationExecutions.automationName, term), ilike(contacts.username, term)) as SQL,
      );
    }
    const rows = await db
      .select({
        id: automationExecutions.id,
        startedAt: automationExecutions.startedAt,
        finishedAt: automationExecutions.finishedAt,
        status: automationExecutions.status,
        skipReason: automationExecutions.skipReason,
        triggerEvent: automationExecutions.triggerEvent,
        inboundText: automationExecutions.inboundText,
        matchedKeyword: automationExecutions.matchedKeyword,
        automationId: automationExecutions.automationId,
        automationName: automationExecutions.automationName,
        errorMessage: automationExecutions.errorMessage,
        contactId: contacts.id,
        contactUsername: contacts.username,
        contactName: contacts.name,
        conversationId: automationExecutions.conversationId,
        sentText: sql<string | null>`(select m.text from messages m where m.execution_id = ${automationExecutions.id} and m.status = 'sent' order by m.created_at limit 1)`,
        sentCount: sql<number>`(select count(*)::int from messages m where m.execution_id = ${automationExecutions.id} and m.status = 'sent')`,
      })
      .from(automationExecutions)
      .leftJoin(contacts, eq(contacts.id, automationExecutions.contactId))
      .where(and(...where))
      .orderBy(desc(automationExecutions.startedAt))
      .limit(q.pageSize + 1)
      .offset((q.page - 1) * q.pageSize);
    return { executions: rows.slice(0, q.pageSize), hasMore: rows.length > q.pageSize, page: q.page };
  });

  app.get("/executions/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const [row] = await db
      .select({ execution: automationExecutions, contact: contacts })
      .from(automationExecutions)
      .leftJoin(contacts, eq(contacts.id, automationExecutions.contactId))
      .where(and(eq(automationExecutions.id, id), eq(automationExecutions.workspaceId, auth.workspace.id)))
      .limit(1);
    if (!row) throw notFound("Execução não encontrada.");
    const sent = await db
      .select({ id: messages.id, text: messages.text, type: messages.type, status: messages.status, errorMessage: messages.errorMessage, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.executionId, id))
      .orderBy(messages.createdAt);
    const { flowSnapshot, context, ...execution } = row.execution;
    return {
      execution: { ...execution, origin: context.origin },
      contact: row.contact ? { id: row.contact.id, username: row.contact.username, name: row.contact.name, profilePicUrl: row.contact.profilePicUrl } : null,
      messages: sent,
      nodes: flowSnapshot?.nodes.map((n) => ({ id: n.id, type: n.type })) ?? [],
    };
  });

  /* ------------------------------ Comentários → DM ------------------------------ */

  app.get("/comments/summary", async (req) => {
    const auth = requireAuth(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await db
      .select({
        mediaId: commentEvents.mediaId,
        mediaProductType: commentEvents.mediaProductType,
        comments: sql<number>`count(*)::int`,
        matched: sql<number>`count(${commentEvents.automationId})::int`,
        dmsSent: sql<number>`count(*) filter (where ${commentEvents.privateReplyStatus} = 'sent')::int`,
        dmsFailed: sql<number>`count(*) filter (where ${commentEvents.privateReplyStatus} = 'failed')::int`,
        conversions: sql<number>`count(${commentEvents.convertedAt})::int`,
        lastAt: sql<Date>`max(${commentEvents.createdAt})`,
        keywords: sql<string[]>`array_remove(array_agg(distinct ${commentEvents.matchedKeyword}), null)`,
      })
      .from(commentEvents)
      .where(and(eq(commentEvents.workspaceId, auth.workspace.id), gte(commentEvents.createdAt, since)))
      .groupBy(commentEvents.mediaId, commentEvents.mediaProductType)
      .orderBy(desc(sql`max(${commentEvents.createdAt})`))
      .limit(100);
    return { media: rows };
  });

  app.get("/comments", async (req) => {
    const auth = requireAuth(req);
    const q = parse(pagination.extend({ mediaId: z.string().max(64).optional() }), req.query);
    const where: SQL[] = [eq(commentEvents.workspaceId, auth.workspace.id)];
    if (q.mediaId) where.push(eq(commentEvents.mediaId, q.mediaId));
    const rows = await db
      .select({
        id: commentEvents.id,
        commentId: commentEvents.commentId,
        mediaId: commentEvents.mediaId,
        text: commentEvents.text,
        fromUsername: commentEvents.fromUsername,
        matchedKeyword: commentEvents.matchedKeyword,
        privateReplyStatus: commentEvents.privateReplyStatus,
        publicReplyStatus: commentEvents.publicReplyStatus,
        convertedAt: commentEvents.convertedAt,
        createdAt: commentEvents.createdAt,
        automationId: commentEvents.automationId,
        automationName: automations.name,
        contactId: commentEvents.contactId,
      })
      .from(commentEvents)
      .leftJoin(automations, eq(automations.id, commentEvents.automationId))
      .where(and(...where))
      .orderBy(desc(commentEvents.createdAt))
      .limit(q.pageSize + 1)
      .offset((q.page - 1) * q.pageSize);
    return { comments: rows.slice(0, q.pageSize), hasMore: rows.length > q.pageSize };
  });

  /** Automações disponíveis para regras de condição ("já recebeu a automação"). */
  app.get("/automations-options", async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select({ id: automations.id, name: automations.name, status: automations.status })
      .from(automations)
      .where(and(eq(automations.workspaceId, auth.workspace.id), inArray(automations.status, ["draft", "active", "paused", "error"])))
      .orderBy(automations.name);
    return { automations: rows };
  });
}
