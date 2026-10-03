import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIMITS } from "@gatilho/shared";
import { parse } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { rewriteText, suggestAutomation } from "./service";

export async function aiRoutes(app: FastifyInstance) {
  const limit = { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } };

  /** "Gerar automação com IA": devolve uma sugestão para revisão (não publica nada). */
  app.post("/ai/automation-suggestion", limit, async (req) => {
    const auth = requireAuth(req);
    const { prompt } = parse(z.object({ prompt: z.string().trim().min(10, "Descreva com um pouco mais de detalhe o que você quer").max(1000) }), req.body);
    return { suggestion: await suggestAutomation(auth.workspace, auth.user.id, prompt) };
  });

  app.post("/ai/rewrite", limit, async (req) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ text: z.string().trim().min(1).max(LIMITS.textMaxLength), goal: z.string().max(200).optional() }), req.body);
    return { text: await rewriteText(auth.workspace, auth.user.id, input.text, input.goal) };
  });
}
