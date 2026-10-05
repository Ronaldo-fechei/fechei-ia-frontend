/** Rotas comuns a todos os canais conectados. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CHANNELS } from "@veloxia/shared";
import { parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { disconnectAccount, getAccountForWorkspace, listActiveAccounts, publicAccount, subscribeAccountWebhooks } from "../../channels/accounts";

export async function channelRoutes(app: FastifyInstance) {
  app.get("/channels/accounts", async (req) => {
    const auth = requireAuth(req);
    const { channel } = parse(z.object({ channel: z.enum(CHANNELS).optional() }), req.query);
    const rows = await listActiveAccounts(auth.workspace.id, channel);
    return { accounts: rows.map(publicAccount) };
  });

  app.post("/channels/accounts/:id/disconnect", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await getAccountForWorkspace(auth.workspace.id, id);
    await disconnectAccount(id, { userId: auth.user.id });
    return { ok: true };
  });

  /** Reativa o recebimento de mensagens (webhooks) da conta. */
  app.post("/channels/accounts/:id/resubscribe", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await getAccountForWorkspace(auth.workspace.id, id);
    const ok = await subscribeAccountWebhooks(id);
    const account = await getAccountForWorkspace(auth.workspace.id, id);
    return { ok, account: publicAccount(account) };
  });
}
