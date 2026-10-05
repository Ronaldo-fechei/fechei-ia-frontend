/**
 * Processamento de um webhook armazenado: identifica o canal pelo objeto do
 * payload e entrega cada "entry" ao tradutor do canal (que usa o pipeline
 * comum em engine/inbound.ts).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { webhookEvents } from "../db/schema";
import { logger } from "../lib/logger";
import { PermanentJobError } from "../queue/queue";
import { handleInstagramEntry } from "../channels/instagram-webhook";
import { handleWhatsAppEntry } from "../channels/whatsapp-webhook";

/** Tradutores por tipo de objeto do webhook da Meta. Retornam quantos itens foram tratados. */
const HANDLERS: Record<string, (entry: any) => Promise<number>> = {
  instagram: async (entry) => ((await handleInstagramEntry(entry)) ? 1 : 0),
  whatsapp_business_account: handleWhatsAppEntry,
};

export async function processWebhookEvent(eventId: string): Promise<void> {
  const [ev] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId)).limit(1);
  if (!ev) throw new PermanentJobError("Evento de webhook não encontrado");
  if (ev.status === "processed" || ev.status === "ignored") return;

  const payload = ev.payload as { object?: string; entry?: any[] };
  await db.update(webhookEvents).set({ attempts: sql`${webhookEvents.attempts} + 1` }).where(eq(webhookEvents.id, ev.id));

  const handler = HANDLERS[payload.object ?? ""];
  if (!handler) {
    await db.update(webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(webhookEvents.id, ev.id));
    return;
  }

  let handled = 0;
  try {
    for (const entry of payload.entry ?? []) {
      const n = await handler(entry);
      if (!n) logger.info({ object: payload.object, entryId: entry?.id }, "webhook para conta não conectada — ignorado");
      handled += n;
    }
  } catch (err) {
    await db
      .update(webhookEvents)
      .set({ status: "failed", error: (err as Error).message?.slice(0, 1000) })
      .where(eq(webhookEvents.id, ev.id));
    throw err;
  }
  await db
    .update(webhookEvents)
    .set({ status: handled ? "processed" : "ignored", processedAt: new Date(), error: null })
    .where(eq(webhookEvents.id, ev.id));
}

export { cancelContactExecutions, expireWaitingExecutions, upsertContact, upsertConversation } from "./inbound";
