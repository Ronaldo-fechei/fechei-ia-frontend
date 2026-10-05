/** Redirecionamento de links rastreados: registra o clique e envia para a URL final. */
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/client";
import { automationExecutions, commentEvents, linkClicks, links } from "../../db/schema";
import { sha256 } from "../../lib/crypto";
import { track } from "../../services/analytics";
import { verifyTrackedParam } from "../../engine/executor";
import { and, isNull } from "drizzle-orm";

const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slackbot|discordbot|telegrambot/i;

export async function linkRedirectRoutes(app: FastifyInstance) {
  app.get("/r/:code", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const [link] = await db.select().from(links).where(eq(links.code, String(code).slice(0, 32))).limit(1);
    if (!link) return reply.code(404).type("text/html").send("<h1>Link não encontrado</h1>");

    const ua = String(req.headers["user-agent"] ?? "");
    if (!BOT_UA.test(ua)) {
      const executionId = verifyTrackedParam(link.code, (req.query as Record<string, string>).e);
      let contactId: string | null = null;
      if (executionId) {
        const [ex] = await db
          .select({ contactId: automationExecutions.contactId, workspaceId: automationExecutions.workspaceId })
          .from(automationExecutions)
          .where(eq(automationExecutions.id, executionId))
          .limit(1);
        if (ex?.workspaceId === link.workspaceId) contactId = ex.contactId;
      }
      await db.insert(linkClicks).values({
        linkId: link.id,
        workspaceId: link.workspaceId,
        contactId,
        executionId: contactId ? executionId : null,
        userAgent: ua.slice(0, 300),
        ipHash: sha256(`${req.ip}:${link.id}`).slice(0, 32),
      });
      await db.update(links).set({ clicksCount: sql`${links.clicksCount} + 1` }).where(eq(links.id, link.id));
      await track(link.workspaceId, "link_clicks", { automationId: link.automationId });
      if (contactId) {
        await db
          .update(commentEvents)
          .set({ convertedAt: new Date() })
          .where(and(eq(commentEvents.contactId, contactId), isNull(commentEvents.convertedAt)));
      }
    }
    return reply.redirect(link.url, 302);
  });
}
