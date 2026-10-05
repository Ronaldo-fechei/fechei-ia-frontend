/** Eventos em tempo real para o painel (Server-Sent Events). */
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../plugins/auth";
import { subscribeEvents } from "../../services/events";

export async function eventRoutes(app: FastifyInstance) {
  app.get("/events/stream", async (req, reply) => {
    const auth = requireAuth(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 5000\n\n`);
    const unsubscribe = await subscribeEvents((event) => {
      if (event.workspaceId !== auth.workspace.id) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify({ type: event.type, ids: event.ids ?? {} })}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
