import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client";
import { instagramAccounts } from "../../db/schema";
import { badRequest } from "../../lib/errors";
import { parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { GraphApiError } from "../../integrations/instagram/client";
import {
  clientFor,
  completeOAuth,
  disconnectAccount,
  getAccountForWorkspace,
  handleAccountGraphError,
  publicAccount,
  startOAuth,
  subscribeAccountWebhooks,
} from "./service";

export async function instagramRoutes(app: FastifyInstance) {
  app.get("/instagram/accounts", async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select()
      .from(instagramAccounts)
      .where(and(eq(instagramAccounts.workspaceId, auth.workspace.id), isNull(instagramAccounts.disconnectedAt)))
      .orderBy(desc(instagramAccounts.connectedAt));
    return { accounts: rows.map(publicAccount) };
  });

  /** Inicia o OAuth oficial: devolve a URL de autorização do Instagram. */
  app.post("/instagram/connect", async (req) => {
    const auth = requireAuth(req);
    const { returnTo } = parse(z.object({ returnTo: z.string().max(200).optional() }), req.body ?? {});
    return { url: await startOAuth(auth.workspace.id, auth.user.id, returnTo) };
  });

  /** Retorno do Instagram (redirect_uri). Não exige sessão: o "state" identifica o pedido. */
  app.get("/instagram/callback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const result = await completeOAuth(req.query as Record<string, string | undefined>);
    const target = new URL(result.returnTo, "http://placeholder");
    target.searchParams.set("instagram", result.status);
    if (result.message) target.searchParams.set("mensagem", result.message);
    return reply.redirect(`${target.pathname}${target.search}`, 302);
  });

  app.post("/instagram/accounts/:id/disconnect", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await getAccountForWorkspace(auth.workspace.id, id);
    await disconnectAccount(id, { userId: auth.user.id });
    return { ok: true };
  });

  app.post("/instagram/accounts/:id/resubscribe", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await getAccountForWorkspace(auth.workspace.id, id);
    const ok = await subscribeAccountWebhooks(id);
    const account = await getAccountForWorkspace(auth.workspace.id, id);
    return { ok, account: publicAccount(account) };
  });

  /** Publicações e Reels da conta (para escolher onde o Comentário → DM funciona). */
  app.get("/instagram/accounts/:id/media", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const { after } = parse(z.object({ after: z.string().max(200).optional() }), req.query);
    const account = await getAccountForWorkspace(auth.workspace.id, id);
    try {
      const res = await clientFor(account).listMedia(24, after);
      return { media: res.data ?? [], nextCursor: res.paging?.next ? res.paging.cursors?.after ?? null : null };
    } catch (err) {
      if (err instanceof GraphApiError) {
        await handleAccountGraphError(account, err);
        throw badRequest(err.userMessage);
      }
      throw err;
    }
  });
}
