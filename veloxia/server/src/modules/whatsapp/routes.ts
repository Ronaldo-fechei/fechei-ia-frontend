/** Rotas do WhatsApp: conexão (cadastro incorporado), modelos e consumo. */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WHATSAPP_TEMPLATE_CATEGORIES } from "@veloxia/shared";
import { env, whatsappConfigured } from "../../config/env";
import { db } from "../../db/client";
import { whatsappTemplates } from "../../db/schema";
import { badRequest } from "../../lib/errors";
import { parse, uuidParam } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { getAccountForWorkspace, publicAccount } from "../../channels/accounts";
import { WhatsAppApiError } from "../../integrations/whatsapp/client";
import { connectWhatsApp, createTemplate, deleteTemplate, publicTemplate, syncTemplates, whatsappUsage } from "./service";

const idWithTemplate = z.object({ id: z.string().uuid(), templateId: z.string().uuid() });

export async function whatsappRoutes(app: FastifyInstance) {
  /** Dados públicos para abrir o cadastro incorporado no navegador (sem segredos). */
  app.get("/whatsapp/config", async (req) => {
    requireAuth(req);
    return {
      enabled: whatsappConfigured(),
      appId: env.META_APP_ID || null,
      configId: env.WHATSAPP_CONFIG_ID || null,
      graphApiVersion: env.META_GRAPH_API_VERSION,
    };
  });

  /** Conclui a conexão após o cadastro incorporado (código + IDs devolvidos pela Meta). */
  app.post("/whatsapp/connect", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requireAuth(req);
    const input = parse(
      z.object({
        code: z.string().min(10).max(2000),
        wabaId: z.string().regex(/^\d+$/, "ID da conta do WhatsApp Business inválido"),
        phoneNumberId: z.string().regex(/^\d+$/, "ID do número inválido"),
        businessId: z.string().regex(/^\d+$/).optional(),
        coexistence: z.boolean().optional(),
      }),
      req.body,
    );
    const account = await connectWhatsApp(auth.workspace.id, auth.user.id, input);
    return { account: publicAccount(account) };
  });

  /** Modelos de todos os números (para o construtor de fluxos e a caixa de entrada). */
  app.get("/whatsapp/templates", async (req) => {
    const auth = requireAuth(req);
    const { status } = parse(z.object({ status: z.enum(["approved", "all"]).default("all") }), req.query);
    const rows = await db
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.workspaceId, auth.workspace.id), status === "approved" ? inArray(whatsappTemplates.status, ["APPROVED"]) : undefined))
      .orderBy(asc(whatsappTemplates.name));
    return { templates: rows.map(publicTemplate) };
  });

  app.post("/whatsapp/accounts/:id/templates/sync", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await getAccountForWorkspace(auth.workspace.id, id, "whatsapp");
    try {
      return { count: await syncTemplates(id) };
    } catch (err) {
      if (err instanceof WhatsAppApiError) throw badRequest(err.userMessage);
      throw err;
    }
  });

  app.post("/whatsapp/accounts/:id/templates", async (req, reply) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    const account = await getAccountForWorkspace(auth.workspace.id, id, "whatsapp");
    const input = parse(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, "Dê um nome ao modelo")
          .max(512)
          .regex(/^[a-z0-9_]+$/, "O nome do modelo deve ter só letras minúsculas, números e _ (ex.: retomar_conversa)"),
        category: z.enum(WHATSAPP_TEMPLATE_CATEGORIES),
        language: z.string().trim().min(2).max(10).default("pt_BR"),
        headerText: z.string().trim().max(60, "Cabeçalho com no máximo 60 caracteres").optional(),
        body: z.string().trim().min(1, "Escreva o texto do modelo").max(1024, "Texto com no máximo 1024 caracteres"),
        examples: z.array(z.string().max(200)).max(10).default([]),
        footer: z.string().trim().max(60, "Rodapé com no máximo 60 caracteres").optional(),
        quickReplies: z.array(z.string().trim().max(25, "Botões com no máximo 25 caracteres")).max(3).default([]),
      }),
      req.body,
    );
    const row = await createTemplate(account, input);
    return reply.code(201).send({ template: publicTemplate(row) });
  });

  app.delete("/whatsapp/accounts/:id/templates/:templateId", async (req) => {
    const auth = requireAuth(req);
    const { id, templateId } = parse(idWithTemplate, req.params);
    const account = await getAccountForWorkspace(auth.workspace.id, id, "whatsapp");
    await deleteTemplate(account, templateId);
    return { ok: true };
  });

  /** Mensagens cobradas pela Meta neste mês e valor estimado (pago pelo cliente direto à Meta). */
  app.get("/whatsapp/usage", async (req) => {
    const auth = requireAuth(req);
    const { accountId } = parse(z.object({ accountId: z.string().uuid().optional() }), req.query);
    if (accountId) await getAccountForWorkspace(auth.workspace.id, accountId, "whatsapp");
    return { usage: await whatsappUsage(auth.workspace.id, accountId) };
  });
}
