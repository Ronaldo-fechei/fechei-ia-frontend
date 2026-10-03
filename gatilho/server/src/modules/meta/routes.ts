/**
 * Callbacks obrigatórios do app da Meta:
 * - Desautorização: o usuário removeu o app no Instagram → desconecta a conta.
 * - Exclusão de dados: apaga os dados da conta e devolve código de confirmação.
 */
import { eq, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { dataDeletionRequests, instagramAccounts } from "../../db/schema";
import { parseSignedRequest, shortCode } from "../../lib/crypto";
import { audit } from "../../services/audit";
import { notify } from "../../services/notifications";
import { publishEvent } from "../../services/events";

export async function metaRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const accountsFor = async (igUserId: string) =>
    db
      .select()
      .from(instagramAccounts)
      .where(or(eq(instagramAccounts.igUserId, igUserId), eq(instagramAccounts.igScopedId, igUserId)));

  app.post("/meta/deauthorize", async (req, reply) => {
    const data = parseSignedRequest(String((req.body as Record<string, string>)?.signed_request ?? ""), env.INSTAGRAM_APP_SECRET);
    if (!data?.user_id) return reply.code(400).send({ error: { code: "invalid_request", message: "signed_request inválido" } });
    for (const account of await accountsFor(String(data.user_id))) {
      if (account.disconnectedAt) continue;
      await db
        .update(instagramAccounts)
        .set({ status: "disconnected", disconnectedAt: new Date(), accessTokenEnc: null, updatedAt: new Date() })
        .where(eq(instagramAccounts.id, account.id));
      await notify({
        workspaceId: account.workspaceId,
        type: "instagram_disconnected",
        severity: "error",
        title: `Instagram @${account.username} desconectado`,
        body: "O acesso do app foi removido nas configurações do Instagram. Reconecte para voltar a automatizar.",
        linkUrl: "/app/instagram",
      });
      await audit({ workspaceId: account.workspaceId, action: "instagram.deauthorized", entityType: "instagram_account", entityId: account.id });
      await publishEvent({ workspaceId: account.workspaceId, type: "instagram.updated" });
    }
    return { ok: true };
  });

  app.post("/meta/data-deletion", async (req, reply) => {
    const data = parseSignedRequest(String((req.body as Record<string, string>)?.signed_request ?? ""), env.INSTAGRAM_APP_SECRET);
    if (!data?.user_id) return reply.code(400).send({ error: { code: "invalid_request", message: "signed_request inválido" } });
    const igUserId = String(data.user_id);
    const code = shortCode(12);
    await db.insert(dataDeletionRequests).values({ confirmationCode: code, igUserId });
    for (const account of await accountsFor(igUserId)) {
      // Remove a conta e, em cascata, contatos, conversas, mensagens e comentários.
      await db.delete(instagramAccounts).where(eq(instagramAccounts.id, account.id));
      await notify({
        workspaceId: account.workspaceId,
        type: "instagram_disconnected",
        severity: "warning",
        title: `Dados do Instagram @${account.username} excluídos`,
        body: "Recebemos uma solicitação oficial de exclusão de dados pela Meta e removemos os dados desta conta.",
        linkUrl: "/app/instagram",
      });
      await audit({ workspaceId: account.workspaceId, action: "instagram.data_deleted", metadata: { igUserId } });
    }
    await db.update(dataDeletionRequests).set({ status: "completed", completedAt: new Date() }).where(eq(dataDeletionRequests.confirmationCode, code));
    return { url: `${env.APP_URL}/exclusao-de-dados?codigo=${code}`, confirmation_code: code };
  });

  app.get("/meta/data-deletion/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    const [row] = await db.select().from(dataDeletionRequests).where(eq(dataDeletionRequests.confirmationCode, String(code).slice(0, 40))).limit(1);
    if (!row) return reply.code(404).send({ error: { code: "not_found", message: "Solicitação não encontrada." } });
    return { code: row.confirmationCode, status: row.status, createdAt: row.createdAt, completedAt: row.completedAt };
  });
}
