/** Processo da API HTTP (opcionalmente também roda o worker: RUN_WORKER=true). */
import { buildApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { logger } from "./lib/logger";
import { jobHandlers, onDeadJob, startScheduler } from "./queue/handlers";
import { QueueWorker } from "./queue/worker";
import { closeEvents } from "./services/events";

async function main() {
  if (process.env.MIGRATE_ON_START !== "false") await runMigrations();
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });

  let worker: QueueWorker | null = null;
  let stopScheduler: (() => void) | null = null;
  if (env.RUN_WORKER) {
    worker = new QueueWorker(jobHandlers, { onDead: onDeadJob });
    await worker.start();
    stopScheduler = startScheduler();
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "encerrando");
    stopScheduler?.();
    await app.close();
    await worker?.stop();
    await closeEvents();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "falha ao iniciar a API");
  process.exit(1);
});
