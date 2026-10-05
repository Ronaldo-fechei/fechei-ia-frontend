/** Registro dos handlers da fila e tarefas periódicas de manutenção. */
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { automationExecutions, oauthStates, passwordResetTokens, sessions, webhookEvents } from "../db/schema";
import { expireWaitingExecutions } from "../engine/processor";
import { fetchContactProfile, runExecutionJob } from "../engine/executor";
import { processWebhookEvent } from "../engine/processor";
import { refreshAccountToken, scanTokens, subscribeAccountWebhooks } from "../modules/instagram/service";
import { logger } from "../lib/logger";
import { notify } from "../services/notifications";
import { eq, lt } from "drizzle-orm";
import { cleanupFinishedJobs, enqueue, recoverStaleJobs, type Job } from "./queue";
import type { JobHandlers } from "./worker";

export const jobHandlers: JobHandlers = {
  "webhook.process": async (p: { eventId: string }) => processWebhookEvent(p.eventId),
  "execution.run": async (p) => runExecutionJob(p),
  "contact.fetch_profile": async (p: { contactId: string }) => fetchContactProfile(p.contactId),
  "instagram.subscribe_webhooks": async (p: { accountId: string }) => {
    await subscribeAccountWebhooks(p.accountId);
  },
  "instagram.refresh_token": async (p: { accountId: string }) => refreshAccountToken(p.accountId),
  "maintenance.tick": async () => maintenanceTick(),
};

/** Chamado quando um job esgota as tentativas. */
export async function onDeadJob(job: Job, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  if (job.type === "execution.run") {
    const executionId = (job.payload as { executionId?: string }).executionId;
    if (!executionId) return;
    const [ex] = await db
      .update(automationExecutions)
      .set({ status: "failed", errorCode: "internal", errorMessage: "Erro interno ao executar a automação.", finishedAt: new Date(), lockedUntil: null })
      .where(eq(automationExecutions.id, executionId))
      .returning();
    if (ex) {
      await notify({
        workspaceId: ex.workspaceId,
        type: "send_failed",
        severity: "error",
        title: `Falha ao executar "${ex.automationName}"`,
        body: "Ocorreu um erro interno. Nossa equipe foi notificada.",
        linkUrl: `/app/automacoes/logs?execucao=${ex.id}`,
        dedupeKey: `internal:${ex.automationId}`,
      });
    }
  }
  if (job.type === "webhook.process") {
    const eventId = (job.payload as { eventId?: string }).eventId;
    if (eventId) await db.update(webhookEvents).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(webhookEvents.id, eventId));
  }
}

let lastHourly = 0;
let lastDaily = 0;

export async function maintenanceTick(): Promise<void> {
  const recovered = await recoverStaleJobs();
  if (recovered) logger.warn({ recovered }, "jobs travados recuperados");
  await expireWaitingExecutions();
  // Execuções presas (worker caiu sem liberar a trava).
  await db.execute(sql`update automation_executions set locked_until = null where locked_until < now() - interval '10 minutes'`);

  const now = Date.now();
  if (now - lastHourly > 3600_000) {
    lastHourly = now;
    await scanTokens();
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
  }
  if (now - lastDaily > 86400_000) {
    lastDaily = now;
    await cleanupFinishedJobs(7);
    await db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, new Date(now - 30 * 86400_000)));
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now - 7 * 86400_000)));
    await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, new Date(now - 86400_000)));
  }
}

/** Agenda a manutenção a cada minuto (a chave evita duplicidade entre workers). */
export function startScheduler(): () => void {
  const schedule = () => {
    const minute = new Date().toISOString().slice(0, 16);
    enqueue("maintenance.tick", {}, { dedupeKey: `tick:${minute}`, maxAttempts: 1 }).catch((err) => logger.warn({ err }, "falha ao agendar manutenção"));
  };
  schedule();
  const timer = setInterval(schedule, 60_000);
  return () => clearInterval(timer);
}
