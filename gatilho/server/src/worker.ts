/** Processo dedicado do worker (fila de webhooks, automações e manutenção). */
import { pool } from "./db/client";
import { logger } from "./lib/logger";
import { jobHandlers, onDeadJob, startScheduler } from "./queue/handlers";
import { QueueWorker } from "./queue/worker";
import { closeEvents } from "./services/events";

async function main() {
  const worker = new QueueWorker(jobHandlers, { onDead: onDeadJob });
  await worker.start();
  const stopScheduler = startScheduler();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "encerrando worker");
    stopScheduler();
    await worker.stop();
    await closeEvents();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "falha ao iniciar o worker");
  process.exit(1);
});
