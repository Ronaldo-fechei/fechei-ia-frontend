/** CRM: contatos, tags e campos personalizados. */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FIELD_TYPES, slugifyKey, SYSTEM_VARIABLES } from "@veloxia/shared";
import { db } from "../../db/client";
import {
  automationExecutions,
  contacts,
  contactTags,
  conversations,
  customFields,
  customFieldValues,
  channelAccounts,
  messages,
  tags,
} from "../../db/schema";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { pagination, parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { audit } from "../../services/audit";
import { publishEvent } from "../../services/events";
import { cancelContactExecutions } from "../../engine/processor";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida");

async function contactOrThrow(workspaceId: string, id: string) {
  const [row] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId))).limit(1);
  if (!row) throw notFound("Contato não encontrado.");
  return row;
}

async function tagOrThrow(workspaceId: string, id: string) {
  const [row] = await db.select().from(tags).where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId))).limit(1);
  if (!row) throw notFound("Tag não encontrada.");
  return row;
}

async function tagsFor(contactIds: string[]) {
  if (!contactIds.length) return new Map<string, { id: string; name: string; color: string }[]>();
  const rows = await db
    .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name, color: tags.color })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tagId))
    .where(inArray(contactTags.contactId, contactIds))
    .orderBy(asc(tags.name));
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  for (const r of rows) {
    if (!map.has(r.contactId)) map.set(r.contactId, []);
    map.get(r.contactId)!.push({ id: r.id, name: r.name, color: r.color });
  }
  return map;
}

export async function crmRoutes(app: FastifyInstance) {
  /* ------------------------------ Tags ------------------------------ */

  app.get("/tags", async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdAt: tags.createdAt,
        contactsCount: sql<number>`(select count(*)::int from contact_tags ct where ct.tag_id = ${tags.id})`,
      })
      .from(tags)
      .where(eq(tags.workspaceId, auth.workspace.id))
      .orderBy(asc(tags.name));
    return { tags: rows };
  });

  app.post("/tags", async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ name: z.string().trim().min(1, "Informe o nome").max(40), color: colorSchema.optional() }), req.body);
    try {
      const [row] = await db.insert(tags).values({ workspaceId: auth.workspace.id, name: input.name, color: input.color ?? "#64748b" }).returning();
      return reply.code(201).send({ tag: row });
    } catch (err: any) {
      if (err?.code === "23505" || err?.cause?.code === "23505") throw conflict("Já existe uma tag com esse nome.");
      throw err;
    }
  });

  app.patch("/tags/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), color: colorSchema.optional() }), req.body);
    await tagOrThrow(auth.workspace.id, id);
    try {
      const [row] = await db.update(tags).set(input).where(eq(tags.id, id)).returning();
      return { tag: row };
    } catch (err: any) {
      if (err?.code === "23505" || err?.cause?.code === "23505") throw conflict("Já existe uma tag com esse nome.");
      throw err;
    }
  });

  app.delete("/tags/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await tagOrThrow(auth.workspace.id, id);
    // Automações publicadas que usam a tag continuam funcionando sem ela (o bloco é ignorado).
    await db.delete(tags).where(eq(tags.id, id));
    return { ok: true };
  });

  /* ------------------------------ Campos ------------------------------ */

  app.get("/fields", async (req) => {
    const auth = requireAuth(req);
    const rows = await db.select().from(customFields).where(eq(customFields.workspaceId, auth.workspace.id)).orderBy(desc(customFields.isSystem), asc(customFields.label));
    return { fields: rows, systemVariables: SYSTEM_VARIABLES };
  });

  app.post("/fields", async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ label: z.string().trim().min(1, "Informe o nome do campo").max(40), type: z.enum(FIELD_TYPES).default("text") }), req.body);
    const key = slugifyKey(input.label);
    if (!key) throw badRequest("Nome de campo inválido.");
    if (SYSTEM_VARIABLES.some((v) => v.key === key)) throw conflict(`"${key}" é uma variável do sistema. Escolha outro nome.`);
    const [exists] = await db.select({ id: customFields.id }).from(customFields).where(and(eq(customFields.workspaceId, auth.workspace.id), eq(customFields.key, key))).limit(1);
    if (exists) throw conflict("Já existe um campo com esse nome.");
    const [row] = await db.insert(customFields).values({ workspaceId: auth.workspace.id, key, label: input.label, type: input.type }).returning();
    return reply.code(201).send({ field: row });
  });

  app.patch("/fields/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(z.object({ label: z.string().trim().min(1).max(40) }), req.body);
    const [row] = await db
      .update(customFields)
      .set({ label: input.label })
      .where(and(eq(customFields.id, id), eq(customFields.workspaceId, auth.workspace.id)))
      .returning();
    if (!row) throw notFound("Campo não encontrado.");
    return { field: row };
  });

  app.delete("/fields/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const [field] = await db.select().from(customFields).where(and(eq(customFields.id, id), eq(customFields.workspaceId, auth.workspace.id))).limit(1);
    if (!field) throw notFound("Campo não encontrado.");
    if (field.isSystem) throw badRequest("Campos padrão não podem ser excluídos.");
    await db.delete(customFields).where(eq(customFields.id, id));
    return { ok: true };
  });

  /* ------------------------------ Contatos ------------------------------ */

  app.get("/contacts", async (req) => {
    const auth = requireAuth(req);
    const q = parse(
      pagination.extend({
        q: z.string().max(80).optional(),
        tagId: z.string().uuid().optional(),
        source: z.string().max(30).optional(),
        status: z.enum(["active", "opted_out", "blocked"]).optional(),
      }),
      req.query,
    );
    const where: SQL[] = [eq(contacts.workspaceId, auth.workspace.id)];
    if (q.q) {
      const term = `%${q.q.replace(/[%_@]/g, "")}%`;
      const digits = q.q.replace(/\D/g, "");
      where.push(
        or(
          ilike(contacts.username, term),
          ilike(contacts.name, term),
          eq(contacts.externalId, q.q),
          ...(digits.length >= 4 ? [ilike(contacts.phone, `%${digits}%`)] : []),
        ) as SQL,
      );
    }
    if (q.tagId) where.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${q.tagId})`);
    if (q.source) where.push(eq(contacts.source, q.source));
    if (q.status) where.push(eq(contacts.status, q.status));
    const rows = await db
      .select()
      .from(contacts)
      .where(and(...where))
      .orderBy(desc(contacts.lastInteractionAt))
      .limit(q.pageSize + 1)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(and(...where));
    const page = rows.slice(0, q.pageSize);
    const tagMap = await tagsFor(page.map((c) => c.id));
    return {
      contacts: page.map((c) => ({ ...c, tags: tagMap.get(c.id) ?? [] })),
      total,
      hasMore: rows.length > q.pageSize,
    };
  });

  app.get("/contacts/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const contact = await contactOrThrow(auth.workspace.id, id);
    const tagMap = await tagsFor([id]);
    const fields = await db
      .select({ id: customFields.id, key: customFields.key, label: customFields.label, type: customFields.type, isSystem: customFields.isSystem, value: customFieldValues.value })
      .from(customFields)
      .leftJoin(customFieldValues, and(eq(customFieldValues.fieldId, customFields.id), eq(customFieldValues.contactId, id)))
      .where(eq(customFields.workspaceId, auth.workspace.id))
      .orderBy(desc(customFields.isSystem), asc(customFields.label));
    const automationsTriggered = await db
      .select({
        automationId: automationExecutions.automationId,
        automationName: automationExecutions.automationName,
        count: sql<number>`count(*)::int`,
        lastAt: sql<Date>`max(${automationExecutions.startedAt})`,
      })
      .from(automationExecutions)
      .where(and(eq(automationExecutions.contactId, id), inArray(automationExecutions.status, ["completed", "waiting", "running", "failed"])))
      .groupBy(automationExecutions.automationId, automationExecutions.automationName)
      .orderBy(desc(sql`max(${automationExecutions.startedAt})`));
    const [conversation] = await db.select().from(conversations).where(eq(conversations.contactId, id)).limit(1);
    const [account] = await db
      .select({ handle: channelAccounts.handle, channel: channelAccounts.channel, name: channelAccounts.name })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, contact.channelAccountId))
      .limit(1);
    const [counts] = await db
      .select({ inbound: sql<number>`count(*) filter (where ${messages.direction} = 'inbound')::int`, outbound: sql<number>`count(*) filter (where ${messages.direction} = 'outbound')::int` })
      .from(messages)
      .where(eq(messages.contactId, id));
    return {
      contact: { ...contact, tags: tagMap.get(id) ?? [] },
      fields,
      automations: automationsTriggered,
      conversation: conversation ?? null,
      accountUsername: account?.handle ?? null,
      account: account ?? null,
      counts,
    };
  });

  app.patch("/contacts/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(z.object({ status: z.enum(["active", "opted_out", "blocked"]).optional(), name: z.string().trim().max(80).optional() }), req.body);
    await contactOrThrow(auth.workspace.id, id);
    const [row] = await db.update(contacts).set({ ...input, updatedAt: new Date() }).where(eq(contacts.id, id)).returning();
    if (input.status && input.status !== "active") await cancelContactExecutions(id, "opted_out");
    await publishEvent({ workspaceId: auth.workspace.id, type: "contact.updated", ids: { contactId: id } });
    return { contact: row };
  });

  app.put("/contacts/:id/fields", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { values } = parse(z.object({ values: z.record(z.string(), z.string().max(1000)) }), req.body);
    await contactOrThrow(auth.workspace.id, id);
    const fields = await db.select().from(customFields).where(eq(customFields.workspaceId, auth.workspace.id));
    for (const [key, value] of Object.entries(values)) {
      const field = fields.find((f) => f.key === key);
      if (!field) continue;
      if (value.trim() === "") {
        await db.delete(customFieldValues).where(and(eq(customFieldValues.contactId, id), eq(customFieldValues.fieldId, field.id)));
      } else {
        await db
          .insert(customFieldValues)
          .values({ contactId: id, fieldId: field.id, workspaceId: auth.workspace.id, value: value.trim() })
          .onConflictDoUpdate({ target: [customFieldValues.contactId, customFieldValues.fieldId], set: { value: value.trim(), updatedAt: new Date() } });
      }
    }
    await publishEvent({ workspaceId: auth.workspace.id, type: "contact.updated", ids: { contactId: id } });
    return { ok: true };
  });

  app.post("/contacts/:id/tags", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { tagId } = parse(z.object({ tagId: z.string().uuid() }), req.body);
    await contactOrThrow(auth.workspace.id, id);
    await tagOrThrow(auth.workspace.id, tagId);
    await db.insert(contactTags).values({ contactId: id, tagId, workspaceId: auth.workspace.id, addedBy: "user" }).onConflictDoNothing();
    await publishEvent({ workspaceId: auth.workspace.id, type: "contact.updated", ids: { contactId: id } });
    return { ok: true };
  });

  app.delete("/contacts/:id/tags/:tagId", async (req) => {
    const auth = requireAuth(req);
    const { id, tagId } = parse(z.object({ id: z.string().uuid(), tagId: z.string().uuid() }), req.params);
    await contactOrThrow(auth.workspace.id, id);
    await db.delete(contactTags).where(and(eq(contactTags.contactId, id), eq(contactTags.tagId, tagId)));
    await publishEvent({ workspaceId: auth.workspace.id, type: "contact.updated", ids: { contactId: id } });
    return { ok: true };
  });

  app.delete("/contacts/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const contact = await contactOrThrow(auth.workspace.id, id);
    await db.delete(contacts).where(eq(contacts.id, id));
    await audit({ workspaceId: auth.workspace.id, userId: auth.user.id, action: "contact.deleted", entityType: "contact", entityId: id, metadata: { username: contact.username } });
    return { ok: true };
  });

  /** Exportação CSV dos contatos (com tags e campos). */
  app.get("/contacts/export.csv", async (req, reply) => {
    const auth = requireAuth(req);
    const rows = await db.select().from(contacts).where(eq(contacts.workspaceId, auth.workspace.id)).orderBy(desc(contacts.lastInteractionAt)).limit(50000);
    const tagMap = await tagsFor(rows.map((r) => r.id));
    const fields = await db.select().from(customFields).where(eq(customFields.workspaceId, auth.workspace.id)).orderBy(asc(customFields.label));
    const values = rows.length
      ? await db.select().from(customFieldValues).where(inArray(customFieldValues.contactId, rows.map((r) => r.id)))
      : [];
    const valueMap = new Map(values.map((v) => [`${v.contactId}:${v.fieldId}`, v.value]));
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // evita injeção de fórmulas em planilhas
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = ["nome", "canal", "username", "telefone", "id_no_canal", "origem", "status", "primeira_interacao", "ultima_interacao", "ultima_palavra_chave", "tags", ...fields.map((f) => f.key)];
    const lines = [header.map(esc).join(",")];
    for (const c of rows) {
      lines.push(
        [
          c.name,
          c.channel,
          c.username,
          c.phone,
          c.externalId,
          c.source,
          c.status,
          c.firstInteractionAt,
          c.lastInteractionAt,
          c.lastKeyword,
          (tagMap.get(c.id) ?? []).map((t) => t.name).join("; "),
          ...fields.map((f) => valueMap.get(`${c.id}:${f.id}`) ?? ""),
        ]
          .map(esc)
          .join(","),
      );
    }
    await audit({ workspaceId: auth.workspace.id, userId: auth.user.id, action: "contacts.exported", metadata: { count: rows.length } });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="contatos.csv"`)
      .send("\uFEFF" + lines.join("\n"));
  });
}
