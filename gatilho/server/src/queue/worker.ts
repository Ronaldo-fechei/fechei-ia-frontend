import { randomUUID } from "node:crypto";
import pg from "pg";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { recordSystemError } from "../services/audit";
import { claimJobs, completeJob, failJob, JOBS_CHANNEL, type Job, type JobType } from "./queue";

export type JobHandler = (payload: any, job: Job) => Promise<void>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export interface WorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  onDead?: (job: Job, err: unknown) => Promise<void>;
}

/** Executa jobs com concorrência limitada; acorda por NOTIFY ou polling. */
export class QueueWorker {
  readonly id = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  private running = false;
  private active = new Set<Promise<void>>();
  private wake: (() => void) | null = null;
  private listener: pg.Client | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly handlers: JobHandlers,
    private readonly opts: WorkerOptions = {},
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.listen().catch((err) => logger.warn({ err }, "worker sem LISTEN; usando apenas polling"));
    this.loopPromise = this.loop();
    logger.info({ worker: this.id }, "worker de fila iniciado");
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
    client.on("notification", () => this.wake?.());
    client.on("error", (err) => {
      logger.warn({ err }, "conexão LISTEN da fila perdida");
      this.listener = null;
      if (this.running) setTimeout(() => this.listen().catch(() => undefined), 3000);
    });
    await client.connect();
    await client.query(`LISTEN ${JOBS_CHANNEL}`);
    this.listener = client;
  }

  private async loop(): Promise<void> {
    const concurrency = this.opts.concurrency ?? env.WORKER_CONCURRENCY;
    while (this.running) {
      const free = concurrency - this.active.size;
      let claimed: Job[] = [];
      if (free > 0) {
        try {
          claimed = await claimJobs(this.id, free, Object.keys(this.handlers) as JobType[]);
        } catch (err) {
          logger.error({ err }, "falha ao buscar jobs");
        }
      }
      for (const job of claimed) {
        const p = this.process(job).finally(() => {
          this.active.delete(p);
          this.wake?.();
        });
        this.active.add(p);
      }
      if (claimed.length === 0 || this.active.size >= concurrency) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.opts.pollIntervalMs ?? 1000);
          this.wake = () => {
            clearTimeout(timer);
            this.wake = null;
            resolve();
          };
        });
      }
    }
  }

  async process(job: Job): Promise<void> {
    const handler = this.handlers[job.type as JobType];
    const log = logger.child({ jobId: job.id, type: job.type, attempt: job.attempts });
    if (!handler) {
      await failJob(job, new Error(`Sem handler para ${job.type}`));
      return;
    }
    try {
      await handler(job.payload, job);
      await completeJob(job.id);
    } catch (err) {
      const status = await failJob(job, err);
      log.warn({ err, status }, "job falhou");
      if (status === "dead") {
        await recordSystemError(`job.${job.type}`, err, { details: { jobId: job.id, payload: job.payload, attempts: job.attempts } });
        await this.opts.onDead?.(job, err).catch(() => undefined);
      }
    }
  }

  async stop(timeoutMs = 10_000): Promise<void> {
    this.running = false;
    this.wake?.();
    await Promise.race([Promise.allSettled([...this.active]), new Promise((r) => setTimeout(r, timeoutMs))]);
    await this.loopPromise?.catch(() => undefined);
    if (this.listener) await this.listener.end().catch(() => undefined);
    logger.info({ worker: this.id }, "worker de fila encerrado");
  }
}

/** Processa todos os jobs vencidos de forma síncrona (usado em testes e scripts). */
export async function drainJobs(handlers: JobHandlers, maxIterations = 200): Promise<number> {
  const worker = new QueueWorker(handlers);
  let processed = 0;
  for (let i = 0; i < maxIterations; i++) {
    const [job] = await claimJobs(worker.id, 1, Object.keys(handlers) as JobType[]);
    if (!job) break;
    await worker.process(job);
    processed++;
  }
  return processed;
}
