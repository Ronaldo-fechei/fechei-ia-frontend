/**
 * Fila de processamento durável no PostgreSQL.
 *
 * - Jobs gravados na mesma transação que os dados (ex.: webhook recebido).
 * - Vários workers em paralelo com FOR UPDATE SKIP LOCKED.
 * - Retentativas com backoff exponencial; após o limite o job vira "dead"
 *   e fica visível no painel administrativo (nada é perdido silenciosamente).
 * - Agendamento (run_at) usado para os blocos "Aguardar" do fluxo.
 */
import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db/client";
import type { jobs } from "../db/schema";

export const JOBS_CHANNEL = "veloxia_jobs";

export type JobType =
  | "webhook.process"
  | "execution.run"
  | "contact.fetch_profile"
  | "channel.subscribe_webhooks"
  | "channel.refresh_token"
  | "whatsapp.sync_templates"
  | "billing.promo_end"
  | "maintenance.tick";

export type Job = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  runAt?: Date;
  delaySeconds?: number;
  maxAttempts?: number;
  /** Chave única: se já existir um job com a mesma chave, nada é criado. */
  dedupeKey?: string;
}

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: EnqueueOptions = {}, tx: DbOrTx = db): Promise<number | null> {
  const runAt = opts.runAt ?? new Date(Date.now() + (opts.delaySeconds ?? 0) * 1000);
  const result = await tx.execute(sql`
    insert into jobs (type, payload, run_at, max_attempts, dedupe_key)
    values (${type}, ${JSON.stringify(payload)}::jsonb, ${runAt.toISOString()}::timestamptz, ${opts.maxAttempts ?? 8}, ${opts.dedupeKey ?? null})
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id
  `);
  await tx.execute(sql`select pg_notify(${JOBS_CHANNEL}, ${type})`);
  const row = result.rows[0] as { id: string | number } | undefined;
  return row ? Number(row.id) : null;
}

export async function claimJobs(workerId: string, limit: number, types?: JobType[]): Promise<Job[]> {
  const typeFilter = types?.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const result = await db.execute(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId}, attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs
      where status = 'pending' and run_at <= now() ${typeFilter}
      order by run_at, id
      limit ${limit}
      for update skip locked
    )
    returning id, type, payload, status, run_at as "runAt", attempts, max_attempts as "maxAttempts", last_error as "lastError",
              locked_at as "lockedAt", locked_by as "lockedBy", dedupe_key as "dedupeKey", created_at as "createdAt",
              updated_at as "updatedAt", finished_at as "finishedAt"
  `);
  return (result.rows as any[]).map((r) => ({ ...r, id: Number(r.id) })) as Job[];
}

export async function completeJob(id: number): Promise<void> {
  await db.execute(sql`update jobs set status = 'done', finished_at = now(), updated_at = now(), locked_at = null where id = ${id}`);
}

/** Erro que não deve ser retentado (dados inválidos, recurso removido…). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Pede nova tentativa após um intervalo específico (ex.: limite de taxa). */
export class RetryLaterError extends Error {
  constructor(
    message: string,
    readonly delaySeconds: number,
  ) {
    super(message);
    this.name = "RetryLaterError";
  }
}

export function backoffSeconds(attempt: number): number {
  const base = Math.min(5 * 2 ** Math.max(0, attempt - 1), 3600);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Registra falha: reagenda com backoff ou marca como "dead". Retorna o novo status. */
export async function failJob(job: Job, err: unknown): Promise<"pending" | "dead"> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const permanent = err instanceof PermanentJobError;
  const exhausted = job.attempts >= job.maxAttempts;
  if (permanent || exhausted) {
    await db.execute(sql`update jobs set status = 'dead', last_error = ${message}, finished_at = now(), updated_at = now(), locked_at = null where id = ${job.id}`);
    return "dead";
  }
  const delay = err instanceof RetryLaterError ? err.delaySeconds : backoffSeconds(job.attempts);
  await db.execute(sql`
    update jobs set status = 'pending', last_error = ${message}, run_at = now() + make_interval(secs => ${delay}),
      updated_at = now(), locked_at = null, locked_by = null
    where id = ${job.id}
  `);
  return "pending";
}

/** Recupera jobs de workers que morreram no meio do processamento. */
export async function recoverStaleJobs(staleMinutes = 10): Promise<number> {
  const r = await db.execute(sql`
    update jobs set status = 'pending', locked_at = null, locked_by = null, updated_at = now(),
      last_error = coalesce(last_error, '') || ' [recuperado após travamento do worker]'
    where status = 'running' and locked_at < now() - make_interval(mins => ${staleMinutes})
  `);
  return r.rowCount ?? 0;
}

export async function cleanupFinishedJobs(olderThanDays = 7): Promise<void> {
  await db.execute(sql`delete from jobs where status = 'done' and finished_at < now() - make_interval(days => ${olderThanDays})`);
}
