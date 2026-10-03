import { and, eq, gt, sql } from "drizzle-orm";
import type { NotificationType } from "@gatilho/shared";
import { db, type DbOrTx } from "../db/client";
import { notifications } from "../db/schema";
import { publishEvent } from "./events";

export interface NotifyInput {
  workspaceId: string;
  type: NotificationType;
  severity?: "info" | "success" | "warning" | "error";
  title: string;
  body?: string;
  linkUrl?: string;
  /** Evita notificações repetidas: não cria outra com a mesma chave dentro da janela. */
  dedupeKey?: string;
  dedupeWindowMinutes?: number;
}

export async function notify(input: NotifyInput, tx: DbOrTx = db): Promise<void> {
  if (input.dedupeKey) {
    const windowStart = new Date(Date.now() - (input.dedupeWindowMinutes ?? 60) * 60_000);
    const existing = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, input.workspaceId),
          eq(notifications.dedupeKey, input.dedupeKey),
          gt(notifications.createdAt, windowStart),
        ),
      )
      .limit(1);
    if (existing.length) return;
  }
  await tx.insert(notifications).values({
    workspaceId: input.workspaceId,
    type: input.type,
    severity: input.severity ?? "info",
    title: input.title,
    body: input.body ?? "",
    linkUrl: input.linkUrl,
    dedupeKey: input.dedupeKey,
  });
  await publishEvent({ workspaceId: input.workspaceId, type: "notification.created" }, tx);
}

export async function unreadCount(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.workspaceId, workspaceId), sql`${notifications.readAt} is null`));
  return rows[0]?.count ?? 0;
}
