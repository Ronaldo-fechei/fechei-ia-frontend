import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import {
  collectKeywordGroups,
  collectLinks,
  emptyFlow,
  getTemplate,
  getTriggerNode,
  keywordKey,
  parseFlow,
  quickAutomationSchema,
  quickToFlow,
  validateFlow,
  type Flow,
  type QuickAutomation,
  type TriggerEvent,
} from "@gatilho/shared";
import { db, type DbOrTx } from "../../db/client";
import { automationExecutions, automations, automationTriggers, instagramAccounts, links, tags } from "../../db/schema";
import { AppError, badRequest, notFound } from "../../lib/errors";
import { audit } from "../../services/audit";
import { assertLimit, hasFeature } from "../billing/limits";
import { ensureTrackedLink } from "../../engine/executor";

export type Automation = typeof automations.$inferSelect;
type Status = Automation["status"];

export async function getAutomationOrThrow(workspaceId: string, id: string, tx: DbOrTx = db): Promise<Automation> {
  const [row] = await tx
    .select()
    .from(automations)
    .where(and(eq(automations.id, id), eq(automations.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw notFound("Automação não encontrada.");
  return row;
}

/** Resolve referências "name:Tag" (modelos) para IDs reais de tags do espaço de trabalho. */
async function resolveTagNames(workspaceId: string, flow: Flow, tx: DbOrTx = db): Promise<Flow> {
  const out = structuredClone(flow);
  for (const node of out.nodes) {
    if (node.type !== "add_tag" && node.type !== "remove_tag") continue;
    const data = node.data as { tagId: string };
    if (!data.tagId?.startsWith("name:")) continue;
    const name = data.tagId.slice(5);
    const [existing] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.workspaceId, workspaceId), sql`lower(${tags.name}) = lower(${name})`))
      .limit(1);
    if (existing) data.tagId = existing.id;
    else {
      const [created] = await tx.insert(tags).values({ workspaceId, name }).returning({ id: tags.id });
      data.tagId = created.id;
    }
  }
  return out;
}

/** Garante que referências do fluxo (tags) pertencem ao espaço de trabalho. */
async function assertFlowOwnership(workspaceId: string, flow: Flow, tx: DbOrTx = db): Promise<void> {
  const tagIds = new Set<string>();
  for (const node of flow.nodes) {
    if (node.type === "add_tag" || node.type === "remove_tag") {
      const id = (node.data as { tagId: string }).tagId;
      if (id) tagIds.add(id);
    }
    if (node.type === "condition") {
      for (const rule of (node.data as { rules: { type: string; tagId?: string }[] }).rules) if (rule.tagId) tagIds.add(rule.tagId);
    }
  }
  if (!tagIds.size) return;
  const valid = [...tagIds].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const found = valid.length
    ? await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.workspaceId, workspaceId), inArray(tags.id, valid)))
    : [];
  if (found.length !== tagIds.size) throw badRequest("O fluxo usa uma tag que não existe mais. Escolha outra tag no bloco.");
}

export async function syncTriggers(tx: DbOrTx, automation: Pick<Automation, "id" | "workspaceId">, flow: Flow): Promise<void> {
  await tx.delete(automationTriggers).where(eq(automationTriggers.automationId, automation.id));
  const rows = collectKeywordGroups(flow).flatMap((g) =>
    g.rules.map((r) => ({
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      nodeId: g.nodeId,
      keyword: r.text,
      normalized: keywordKey(r),
      matchType: r.matchType,
      caseSensitive: !!r.caseSensitive,
      ignoreAccents: r.ignoreAccents !== false,
    })),
  );
  if (rows.length) await tx.insert(automationTriggers).values(rows);
}

function triggerEventOf(flow: Flow): TriggerEvent {
  return getTriggerNode(flow)?.data.event ?? "dm";
}

export interface CreateAutomationInput {
  name: string;
  description?: string;
  kind?: "standard" | "faq";
  mode: "quick" | "flow";
  quick?: unknown;
  flow?: unknown;
  triggerEvent?: TriggerEvent;
  faqQuestion?: string;
  priority?: number;
  cooldownSeconds?: number;
  instagramAccountId?: string | null;
  publish?: boolean;
}

async function assertAccount(workspaceId: string, accountId: string | null | undefined, tx: DbOrTx) {
  if (!accountId) return;
  const [row] = await tx
    .select({ id: instagramAccounts.id })
    .from(instagramAccounts)
    .where(and(eq(instagramAccounts.id, accountId), eq(instagramAccounts.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw badRequest("Conta do Instagram inválida.");
}

export function compileQuick(input: unknown): { quick: QuickAutomation; flow: Flow } {
  const parsed = quickAutomationSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(400, "validation_error", issue?.message ?? "Dados inválidos.", {
      fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])),
    });
  }
  return { quick: parsed.data, flow: quickToFlow(parsed.data) };
}

export async function createAutomation(workspaceId: string, userId: string, input: CreateAutomationInput): Promise<Automation> {
  const automation = await db.transaction(async (tx) => {
    await assertAccount(workspaceId, input.instagramAccountId, tx);
    let flow: Flow;
    let quickConfig: Record<string, unknown> | null = null;
    if (input.mode === "quick") {
      const compiled = compileQuick({ ...(input.quick as object), name: input.name });
      flow = compiled.flow;
      quickConfig = compiled.quick as unknown as Record<string, unknown>;
    } else {
      flow = input.flow ? parseFlow(input.flow) : emptyFlow(input.triggerEvent ?? "dm");
      flow = await resolveTagNames(workspaceId, flow, tx);
    }
    await assertFlowOwnership(workspaceId, flow, tx);
    // "Criar e publicar" é tudo ou nada: valida antes de gravar para não deixar rascunhos duplicados.
    if (input.publish) await assertPublishable(workspaceId, flow, null, tx);
    const [ws] = await tx.execute(sql`select default_cooldown_seconds from workspaces where id = ${workspaceId}`).then((r) => r.rows as { default_cooldown_seconds: number }[]);
    const [row] = await tx
      .insert(automations)
      .values({
        workspaceId,
        instagramAccountId: input.instagramAccountId ?? null,
        name: input.name.trim().slice(0, 80),
        description: input.description?.slice(0, 300) ?? "",
        kind: input.kind ?? "standard",
        mode: input.mode,
        status: "draft",
        triggerEvent: triggerEventOf(flow),
        priority: input.priority ?? 0,
        cooldownSeconds: input.cooldownSeconds ?? ws?.default_cooldown_seconds ?? 60,
        draftFlow: flow,
        quickConfig,
        faqQuestion: input.faqQuestion?.slice(0, 300) ?? null,
        createdByUserId: userId,
      })
      .returning();
    await syncTriggers(tx, row, flow);
    return row;
  });
  await audit({ workspaceId, userId, action: "automation.created", entityType: "automation", entityId: automation.id, metadata: { name: automation.name } });
  if (input.publish) return publishAutomation(workspaceId, userId, automation.id);
  return automation;
}

export async function createFromTemplate(workspaceId: string, userId: string, templateId: string, name?: string): Promise<Automation> {
  const template = getTemplate(templateId);
  if (!template) throw notFound("Modelo não encontrado.");
  return createAutomation(workspaceId, userId, {
    name: name?.trim() || template.automationName,
    description: template.description,
    mode: "flow",
    flow: template.build(),
    kind: template.id === "faq" ? "standard" : "standard",
  });
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  priority?: number;
  cooldownSeconds?: number;
  instagramAccountId?: string | null;
  quick?: unknown;
  draftFlow?: unknown;
  faqQuestion?: string;
  publish?: boolean;
}

export async function updateAutomation(workspaceId: string, userId: string, id: string, input: UpdateAutomationInput): Promise<Automation> {
  const updated = await db.transaction(async (tx) => {
    const current = await getAutomationOrThrow(workspaceId, id, tx);
    if (current.status === "archived" && (input.quick || input.draftFlow)) throw badRequest("Restaure a automação antes de editá-la.");
    await assertAccount(workspaceId, input.instagramAccountId, tx);
    const patch: Partial<typeof automations.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name.trim().slice(0, 80);
    if (input.description !== undefined) patch.description = input.description.slice(0, 300);
    if (input.priority !== undefined) patch.priority = Math.max(-100, Math.min(100, Math.round(input.priority)));
    if (input.cooldownSeconds !== undefined) patch.cooldownSeconds = Math.max(0, Math.min(30 * 86400, Math.round(input.cooldownSeconds)));
    if (input.instagramAccountId !== undefined) patch.instagramAccountId = input.instagramAccountId;
    if (input.faqQuestion !== undefined) patch.faqQuestion = input.faqQuestion.slice(0, 300);

    let draft: Flow | null = null;
    if (input.quick !== undefined) {
      if (current.mode !== "quick") throw badRequest("Esta automação foi editada no construtor visual. Continue editando por lá.");
      const compiled = compileQuick({ ...(input.quick as object), name: input.name ?? current.name });
      draft = compiled.flow;
      patch.quickConfig = compiled.quick as unknown as Record<string, unknown>;
    } else if (input.draftFlow !== undefined) {
      draft = await resolveTagNames(workspaceId, parseFlow(input.draftFlow), tx);
      if (current.mode === "quick") {
        patch.mode = "flow";
        patch.quickConfig = null;
      }
    }
    if (draft) {
      await assertFlowOwnership(workspaceId, draft, tx);
      patch.draftFlow = draft;
      patch.hasUnpublishedChanges = true;
      if (current.status === "draft") patch.triggerEvent = triggerEventOf(draft);
    }
    const [row] = await tx.update(automations).set(patch).where(eq(automations.id, id)).returning();
    // O índice de palavras-chave reflete o publicado (ou o rascunho, se nunca publicado).
    if (draft && !row.flow) await syncTriggers(tx, row, draft);
    return row;
  });
  if (input.publish) return publishAutomation(workspaceId, userId, id);
  return updated;
}

/** Verifica se um fluxo pode ser publicado (validação, recursos do plano e limite de automações ativas). */
async function assertPublishable(workspaceId: string, flow: Flow, current: Automation | null, tx: DbOrTx = db): Promise<void> {
  const validation = validateFlow(flow);
  if (!validation.valid) {
    throw new AppError(422, "invalid_flow", validation.errors[0]?.message ?? "O fluxo tem erros.", { errors: validation.errors, warnings: validation.warnings });
  }
  if (triggerEventOf(flow) === "comment" && !(await hasFeature(workspaceId, "comment_automations", tx))) {
    throw new AppError(402, "limit_reached", "Seu plano não inclui automações de comentários.");
  }
  if (current?.status !== "active") await assertLimit(workspaceId, "active_automations", 1, tx);
}

export async function publishAutomation(workspaceId: string, userId: string, id: string): Promise<Automation> {
  const automation = await getAutomationOrThrow(workspaceId, id);
  const flow = parseFlow(automation.draftFlow);
  await assertFlowOwnership(workspaceId, flow);
  await assertPublishable(workspaceId, flow, automation);
  const event = triggerEventOf(flow);

  const published = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(automations)
      .set({
        flow,
        status: "active",
        triggerEvent: event,
        version: sql`${automations.version} + 1`,
        publishedAt: new Date(),
        hasUnpublishedChanges: false,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, id))
      .returning();
    await syncTriggers(tx, row, flow);
    return row;
  });
  for (const link of collectLinks(flow)) {
    await ensureTrackedLink(workspaceId, id, link.nodeId, link.buttonId, link.url, link.title);
  }
  await audit({ workspaceId, userId, action: "automation.published", entityType: "automation", entityId: id, metadata: { version: published.version } });
  return published;
}

export async function setAutomationStatus(workspaceId: string, userId: string, id: string, status: Status): Promise<Automation> {
  const automation = await getAutomationOrThrow(workspaceId, id);
  if (status === "active") {
    if (!automation.flow || automation.hasUnpublishedChanges) return publishAutomation(workspaceId, userId, id);
    await assertLimit(workspaceId, "active_automations");
  }
  if (status === "error") throw badRequest("Status inválido.");
  const [row] = await db
    .update(automations)
    .set({ status, updatedAt: new Date(), ...(status === "active" ? { errorMessage: null } : {}) })
    .where(eq(automations.id, id))
    .returning();
  if (status !== "active") {
    // Fluxos que aguardavam resposta deixam de continuar.
    await db
      .update(automationExecutions)
      .set({ status: "cancelled", skipReason: "automation_inactive", finishedAt: new Date(), waitType: null })
      .where(and(eq(automationExecutions.automationId, id), eq(automationExecutions.status, "waiting")));
  }
  await audit({ workspaceId, userId, action: `automation.${status}`, entityType: "automation", entityId: id });
  return row;
}

export async function duplicateAutomation(workspaceId: string, userId: string, id: string): Promise<Automation> {
  const source = await getAutomationOrThrow(workspaceId, id);
  const [row] = await db
    .insert(automations)
    .values({
      workspaceId,
      instagramAccountId: source.instagramAccountId,
      name: `Cópia de ${source.name}`.slice(0, 80),
      description: source.description,
      kind: source.kind,
      mode: source.mode,
      status: "draft",
      triggerEvent: source.triggerEvent,
      priority: source.priority,
      cooldownSeconds: source.cooldownSeconds,
      draftFlow: source.draftFlow,
      quickConfig: source.quickConfig,
      faqQuestion: source.faqQuestion,
      createdByUserId: userId,
    })
    .returning();
  await syncTriggers(db, row, parseFlow(row.draftFlow));
  await audit({ workspaceId, userId, action: "automation.duplicated", entityType: "automation", entityId: row.id, metadata: { from: id } });
  return row;
}

export async function deleteAutomation(workspaceId: string, userId: string, id: string): Promise<void> {
  const automation = await getAutomationOrThrow(workspaceId, id);
  await db.delete(automations).where(eq(automations.id, id));
  await audit({ workspaceId, userId, action: "automation.deleted", entityType: "automation", entityId: id, metadata: { name: automation.name } });
}

export interface ListFilters {
  status?: Status;
  kind?: "standard" | "faq";
  q?: string;
  triggerEvent?: string;
}

export async function listAutomations(workspaceId: string, filters: ListFilters = {}) {
  const where: SQL[] = [eq(automations.workspaceId, workspaceId)];
  if (filters.status) where.push(eq(automations.status, filters.status));
  else where.push(sql`${automations.status} <> 'archived'`);
  if (filters.kind) where.push(eq(automations.kind, filters.kind));
  if (filters.triggerEvent) where.push(eq(automations.triggerEvent, filters.triggerEvent));
  if (filters.q) where.push(ilike(automations.name, `%${filters.q.replace(/[%_]/g, "")}%`));

  const rows = await db
    .select()
    .from(automations)
    .where(and(...where))
    .orderBy(desc(automations.priority), desc(automations.updatedAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const triggers = await db
    .select({ automationId: automationTriggers.automationId, keyword: automationTriggers.keyword })
    .from(automationTriggers)
    .where(inArray(automationTriggers.automationId, ids))
    .orderBy(asc(automationTriggers.createdAt));
  const clicks = await db
    .select({ automationId: links.automationId, clicks: sql<number>`coalesce(sum(${links.clicksCount}), 0)::int` })
    .from(links)
    .where(inArray(links.automationId, ids))
    .groupBy(links.automationId);
  const clickMap = new Map(clicks.map((c) => [c.automationId, c.clicks]));

  return rows.map((r) => {
    const flow = (r.flow ?? r.draftFlow) as Flow;
    const actions = [...new Set(flow.nodes.filter((n) => !["trigger", "keyword", "end"].includes(n.type)).map((n) => n.type))];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      mode: r.mode,
      status: r.status,
      triggerEvent: r.triggerEvent,
      priority: r.priority,
      cooldownSeconds: r.cooldownSeconds,
      instagramAccountId: r.instagramAccountId,
      keywords: triggers.filter((t) => t.automationId === r.id).map((t) => t.keyword),
      actions,
      executionsCount: r.executionsCount,
      lastTriggeredAt: r.lastTriggeredAt,
      linkClicks: clickMap.get(r.id) ?? 0,
      hasUnpublishedChanges: r.hasUnpublishedChanges,
      publishedAt: r.publishedAt,
      errorMessage: r.errorMessage,
      faqQuestion: r.faqQuestion,
      quickConfig: r.kind === "faq" ? r.quickConfig : undefined,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    };
  });
}

export function serializeAutomation(r: Automation) {
  const draft = parseFlow(r.draftFlow);
  return {
    ...r,
    draftFlow: draft,
    flow: r.flow ? parseFlow(r.flow) : null,
    validation: validateFlow(draft),
  };
}
