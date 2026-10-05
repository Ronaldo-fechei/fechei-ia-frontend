/**
 * Eventos em tempo real para o painel (nova mensagem, conversa atualizada…).
 * Usa LISTEN/NOTIFY do PostgreSQL para funcionar com vários processos
 * (API e worker separados).
 */
import { sql } from "drizzle-orm";
import pg from "pg";
import { env } from "../config/env";
import { db, type DbOrTx } from "../db/client";
import { logger } from "../lib/logger";

export const EVENTS_CHANNEL = "veloxia_events";

export type WorkspaceEventType =
  | "message.created"
  | "message.updated"
  | "conversation.updated"
  | "contact.updated"
  | "execution.updated"
  | "notification.created"
  | "channels.updated"
  | "templates.updated"
  | "billing.updated";

export interface WorkspaceEvent {
  workspaceId: string;
  type: WorkspaceEventType;
  ids?: Record<string, string>;
}

export async function publishEvent(event: WorkspaceEvent, tx: DbOrTx = db): Promise<void> {
  try {
    await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
  } catch (err) {
    logger.warn({ err }, "falha ao publicar evento em tempo real");
  }
}

type Listener = (event: WorkspaceEvent) => void;
const listeners = new Set<Listener>();
let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;

async function ensureListening(): Promise<void> {
  if (client) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
    c.on("notification", (msg) => {
      if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as WorkspaceEvent;
        for (const l of listeners) l(event);
      } catch {
        /* ignora payload inválido */
      }
    });
    c.on("error", (err) => {
      logger.warn({ err }, "conexão de eventos perdida; reconectando");
      client = null;
      setTimeout(() => listeners.size && ensureListening().catch(() => undefined), 2000);
    });
    await c.connect();
    await c.query(`LISTEN ${EVENTS_CHANNEL}`);
    client = c;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

export async function subscribeEvents(listener: Listener): Promise<() => void> {
  listeners.add(listener);
  await ensureListening();
  return () => {
    listeners.delete(listener);
  };
}

export async function closeEvents(): Promise<void> {
  listeners.clear();
  if (client) {
    const c = client;
    client = null;
    await c.end().catch(() => undefined);
  }
}
