/**
 * Webhooks da Meta (Instagram).
 * - GET: verificação do endpoint (hub.challenge).
 * - POST: valida X-Hub-Signature-256 sobre o corpo bruto, grava o evento e
 *   enfileira o processamento na mesma transação; responde 200 rapidamente.
 *   Se o banco falhar, responde 500 e a Meta reenvia (nenhum evento se perde).
 */
import type { FastifyInstance } from "fastify";
import { env, webhookConfigured } from "../../config/env";
import { db } from "../../db/client";
import { webhookEvents } from "../../db/schema";
import { safeEqual, sha256, verifyMetaSignature } from "../../lib/crypto";
import { enqueue } from "../../queue/queue";

export async function webhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/webhooks/instagram", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (
      q["hub.mode"] === "subscribe" &&
      env.META_WEBHOOK_VERIFY_TOKEN &&
      q["hub.verify_token"] &&
      safeEqual(q["hub.verify_token"], env.META_WEBHOOK_VERIFY_TOKEN)
    ) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send({ error: { code: "forbidden", message: "Token de verificação inválido." } });
  });

  app.post("/webhooks/instagram", { config: { rateLimit: false } }, async (req, reply) => {
    if (!webhookConfigured()) return reply.code(503).send({ error: { code: "not_configured", message: "Webhook não configurado." } });
    const raw = req.rawBody ?? Buffer.alloc(0);
    if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, env.INSTAGRAM_APP_SECRET)) {
      req.log.warn("webhook com assinatura inválida rejeitado");
      return reply.code(401).send({ error: { code: "invalid_signature", message: "Assinatura inválida." } });
    }
    const body = req.body as { object?: string };
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookEvents)
        .values({ object: String(body?.object ?? "unknown"), payload: body as Record<string, unknown>, bodySha256: sha256(raw) })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (inserted.length) {
        await enqueue("webhook.process", { eventId: inserted[0].id }, { dedupeKey: `webhook:${inserted[0].id}`, maxAttempts: 10 }, tx);
      }
    });
    return reply.code(200).type("text/plain").send("EVENT_RECEIVED");
  });
}
