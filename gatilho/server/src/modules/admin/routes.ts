/** Painel administrativo (apenas usuários com papel "admin"): erros, fila e webhooks. */
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client";
import { instagramAccounts, jobs, plans, subscriptions, systemErrors, users, webhookEvents, workspaces } from "../../db/schema";
import { badRequest, notFound } from "../../lib/errors";
import { parse, uuidParam } from "../../lib/validation";
import { requireAdmin } from "../../plugins/auth";
import { audit } from "../../services/audit";
import { enqueue } from "../../queue/queue";

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/overview", async (req) => {
    requireAdmin(req);
    const count = async (q: ReturnType<typeof sql>) => ((await db.execute(q)).rows[0] as { n: number }).n;
    return {
      users: await count(sql`select count(*)::int as n from users`),
      workspaces: await count(sql`select count(*)::int as n from workspaces`),
      instagramAccounts: await count(sql`select count(*)::int as n from instagram_accounts where disconnected_at is null`),
      jobs: (await db.execute(sql`select status, count(*)::int as n from jobs group by status`)).rows,
      webhooks24h: (await db.execute(sql`select status, count(*)::int as n from webhook_events where received_at > now() - interval '24 hours' group by status`)).rows,
      errors24h: await count(sql`select count(*)::int as n from system_errors where created_at > now() - interval '24 hours'`),
    };
  });

  app.get("/admin/errors", async (req) => {
    requireAdmin(req);
    const rows = await db.select().from(systemErrors).orderBy(desc(systemErrors.createdAt)).limit(200);
    return { errors: rows };
  });

  app.get("/admin/jobs", async (req) => {
    requireAdmin(req);
    const { status } = parse(z.object({ status: z.enum(["pending", "running", "done", "failed", "dead"]).default("dead") }), req.query);
    const rows = await db.select().from(jobs).where(eq(jobs.status, status)).orderBy(desc(jobs.updatedAt)).limit(200);
    return { jobs: rows };
  });

  app.post("/admin/jobs/:id/retry", async (req) => {
    const auth = requireAdmin(req);
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const [row] = await db
      .update(jobs)
      .set({ status: "pending", runAt: new Date(), attempts: 0, lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(eq(jobs.id, id))
      .returning();
    if (!row) throw notFound("Job não encontrado.");
    await db.execute(sql`select pg_notify('gatilho_jobs', ${row.type})`);
    await audit({ userId: auth.user.id, action: "admin.job_retry", entityType: "job", entityId: String(id) });
    return { ok: true };
  });

  app.get("/admin/webhooks", async (req) => {
    requireAdmin(req);
    const { status } = parse(z.object({ status: z.enum(["pending", "processed", "failed", "ignored"]).optional() }), req.query);
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(status ? eq(webhookEvents.status, status) : sql`true`)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(100);
    return { events: rows };
  });

  app.post("/admin/webhooks/:id/reprocess", async (req) => {
    const auth = requireAdmin(req);
    const { id } = parse(uuidParam, req.params);
    const [row] = await db.update(webhookEvents).set({ status: "pending", error: null }).where(eq(webhookEvents.id, id)).returning();
    if (!row) throw notFound("Evento não encontrado.");
    await enqueue("webhook.process", { eventId: id }, { dedupeKey: `webhook:${id}:${Date.now()}` });
    await audit({ userId: auth.user.id, action: "admin.webhook_reprocess", entityType: "webhook_event", entityId: id });
    return { ok: true };
  });

  app.get("/admin/workspaces", async (req) => {
    requireAdmin(req);
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdAt: workspaces.createdAt,
        ownerEmail: users.email,
        planId: subscriptions.planId,
        status: subscriptions.status,
        accounts: sql<number>`(select count(*)::int from instagram_accounts ia where ia.workspace_id = ${workspaces.id} and ia.disconnected_at is null)`,
      })
      .from(workspaces)
      .innerJoin(users, eq(users.id, workspaces.ownerId))
      .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
      .orderBy(desc(workspaces.createdAt))
      .limit(500);
    return { workspaces: rows, plans: await db.select({ id: plans.id, name: plans.name }).from(plans) };
  });

  /** Mudança manual de plano (enquanto não há gateway de pagamento). */
  app.post("/admin/workspaces/:id/plan", async (req) => {
    const auth = requireAdmin(req);
    const { id } = parse(uuidParam, req.params);
    const input = parse(z.object({ planId: z.string().max(40), status: z.enum(["active", "trialing", "canceled"]).default("active"), trialDays: z.number().int().min(1).max(90).optional() }), req.body);
    const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) throw badRequest("Plano inexistente.");
    await db
      .insert(subscriptions)
      .values({ workspaceId: id, planId: plan.id, status: input.status, provider: "manual", trialEndsAt: input.trialDays ? new Date(Date.now() + input.trialDays * 86400_000) : null, currentPeriodStart: new Date() })
      .onConflictDoUpdate({
        target: subscriptions.workspaceId,
        set: { planId: plan.id, status: input.status, provider: "manual", trialEndsAt: input.trialDays ? new Date(Date.now() + input.trialDays * 86400_000) : null, updatedAt: new Date() },
      });
    await audit({ workspaceId: id, userId: auth.user.id, action: "admin.plan_changed", metadata: { planId: plan.id, status: input.status } });
    return { ok: true };
  });

  app.get("/admin/instagram-accounts", async (req) => {
    requireAdmin(req);
    const rows = await db
      .select({
        id: instagramAccounts.id,
        username: instagramAccounts.username,
        status: instagramAccounts.status,
        webhookError: instagramAccounts.webhookError,
        lastError: instagramAccounts.lastError,
        lastWebhookAt: instagramAccounts.lastWebhookAt,
        tokenExpiresAt: instagramAccounts.tokenExpiresAt,
        workspaceId: instagramAccounts.workspaceId,
      })
      .from(instagramAccounts)
      .orderBy(desc(instagramAccounts.updatedAt))
      .limit(500);
    return { accounts: rows };
  });
}
