/** Configurações do espaço de trabalho, tom de voz, plano e uso. */
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TONES } from "@veloxia/shared";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { plans, workspaces } from "../../db/schema";
import { badRequest, forbidden } from "../../lib/errors";
import { isValidTimeZone } from "../../lib/time";
import { parse } from "../../lib/validation";
import { requireAuth } from "../../plugins/auth";
import { audit } from "../../services/audit";
import { invalidateTimezone } from "../../services/analytics";
import { getUsage, getWorkspacePlan } from "../billing/limits";

export async function settingsRoutes(app: FastifyInstance) {
  app.patch("/workspace", async (req) => {
    const auth = requireAuth(req);
    if (auth.memberRole === "agent") throw forbidden();
    const input = parse(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        timezone: z.string().max(60).optional(),
        tone: z.enum(TONES).optional(),
        brandInstructions: z.string().max(2000).optional(),
        defaultCooldownSeconds: z.number().int().min(0).max(30 * 86400).optional(),
      }),
      req.body,
    );
    if (input.timezone && !isValidTimeZone(input.timezone)) throw badRequest("Fuso horário inválido.");
    const [row] = await db
      .update(workspaces)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(workspaces.id, auth.workspace.id))
      .returning();
    invalidateTimezone(auth.workspace.id);
    await audit({ workspaceId: auth.workspace.id, userId: auth.user.id, action: "workspace.updated", metadata: Object.keys(input).reduce((a, k) => ({ ...a, [k]: true }), {}) });
    return { workspace: row };
  });

  app.post("/workspace/onboarding", async (req) => {
    const auth = requireAuth(req);
    const { completed } = parse(z.object({ completed: z.boolean() }), req.body);
    await db.update(workspaces).set({ onboardingCompletedAt: completed ? new Date() : null }).where(eq(workspaces.id, auth.workspace.id));
    return { ok: true };
  });

  /** Planos, assinatura atual e uso. Pagamento online ainda não é oferecido. */
}
