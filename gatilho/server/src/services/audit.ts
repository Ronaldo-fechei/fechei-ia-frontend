import { db, type DbOrTx } from "../db/client";
import { auditLogs, systemErrors } from "../db/schema";
import { logger } from "../lib/logger";

export interface AuditInput {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function audit(input: AuditInput, tx: DbOrTx = db): Promise<void> {
  try {
    await tx.insert(auditLogs).values({
      workspaceId: input.workspaceId ?? null,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 300),
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, "falha ao registrar auditoria");
  }
}

/** Registra detalhes técnicos de um erro (visíveis apenas no painel administrativo). */
export async function recordSystemError(
  context: string,
  err: unknown,
  extra: { workspaceId?: string | null; details?: Record<string, unknown> } = {},
): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: e, context, ...extra.details }, `erro: ${context}`);
  try {
    await db.insert(systemErrors).values({
      workspaceId: extra.workspaceId ?? null,
      context,
      message: e.message.slice(0, 2000),
      details: { stack: e.stack?.slice(0, 8000), ...(extra.details ?? {}) },
    });
  } catch (dbErr) {
    logger.error({ err: dbErr }, "falha ao registrar erro do sistema");
  }
}
