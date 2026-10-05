import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client";
import { notifications } from "../../db/schema";
import { parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { unreadCount } from "../../services/notifications";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (req) => {
    const auth = requireAuth(req);
    const q = parse(z.object({ unread: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.workspaceId, auth.workspace.id), q.unread ? isNull(notifications.readAt) : sql`true`))
      .orderBy(desc(notifications.createdAt))
      .limit(q.limit);
    return { notifications: rows, unread: await unreadCount(auth.workspace.id) };
  });

  app.post("/notifications/:id/read", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.workspaceId, auth.workspace.id)));
    return { ok: true };
  });

  app.post("/notifications/read-all", async (req) => {
    const auth = requireAuth(req);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.workspaceId, auth.workspace.id), isNull(notifications.readAt)));
    return { ok: true };
  });
}
