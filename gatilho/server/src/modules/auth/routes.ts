import { and, desc, eq, gt, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { APP_NAME } from "@gatilho/shared";
import { adminEmails, emailConfigured, env } from "../../config/env";
import { db } from "../../db/client";
import { instagramAccounts, passwordResetTokens, sessions, users, workspaces } from "../../db/schema";
import { hashPassword, hashToken, randomToken, verifyPassword } from "../../lib/crypto";
import { AppError, badRequest, conflict, tooMany, unauthorized } from "../../lib/errors";
import { emailSchema, parse, passwordSchema, uuidParam } from "../../lib/validation";
import { audit, recordSystemError } from "../../services/audit";
import { layoutEmail, sendEmail } from "../../services/email";
import { clearSessionCookie, createSession, requireAuth } from "../../plugins/auth";
import { getUsage, getWorkspacePlan } from "../billing/limits";
import { createWorkspaceForUser } from "../workspaces/bootstrap";
import { disconnectAccount } from "../instagram/service";

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(80),
  email: emailSchema,
  password: passwordSchema,
  workspaceName: z.string().trim().max(80).optional(),
  acceptTerms: z.literal(true, { error: "Aceite os termos de uso e a política de privacidade" }),
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Informe a senha").max(128) });

export async function authRoutes(app: FastifyInstance) {
  const authLimit = { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } };

  app.post("/auth/signup", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const input = parse(signupSchema, req.body);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing.length) throw conflict("Já existe uma conta com este e-mail. Faça login ou recupere sua senha.");

    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash,
          acceptedTermsAt: new Date(),
          role: adminEmails.has(input.email) ? "admin" : "user",
        })
        .returning();
      await createWorkspaceForUser(tx, u.id, input.workspaceName || `${input.name.split(" ")[0]} — ${APP_NAME}`);
      return u;
    });
    await createSession(user.id, req, reply);
    await audit({ userId: user.id, action: "auth.signup", ip: req.ip, userAgent: req.headers["user-agent"] });
    return reply.code(201).send({ ok: true });
  });

  app.post("/auth/login", authLimit, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw tooMany(`Muitas tentativas de login. Tente novamente em alguns minutos ou redefina sua senha.`);
    }
    const valid = user ? await verifyPassword(input.password, user.passwordHash) : await verifyPassword(input.password, DUMMY_HASH);
    if (!user || !valid) {
      if (user) {
        const failed = user.failedLoginCount + 1;
        await db
          .update(users)
          .set({ failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
          .where(eq(users.id, user.id));
        await audit({ userId: user.id, action: "auth.login_failed", ip: req.ip, userAgent: req.headers["user-agent"] });
      }
      throw unauthorized("E-mail ou senha incorretos.");
    }
    await db
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(adminEmails.has(user.email) && user.role !== "admin" ? { role: "admin" as const } : {}),
      })
      .where(eq(users.id, user.id));
    await createSession(user.id, req, reply);
    await audit({ userId: user.id, action: "auth.login", ip: req.ip, userAgent: req.headers["user-agent"] });
    return { ok: true };
  });

  app.post("/auth/logout", async (req, reply) => {
    if (req.auth) {
      await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, req.auth.sessionId));
      await audit({ userId: req.auth.user.id, workspaceId: req.auth.workspace.id, action: "auth.logout", ip: req.ip });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const auth = requireAuth(req);
    const { plan, subscription } = await getWorkspacePlan(auth.workspace.id);
    const usage = await getUsage(auth.workspace.id);
    return {
      user: auth.user,
      workspace: {
        id: auth.workspace.id,
        name: auth.workspace.name,
        timezone: auth.workspace.timezone,
        tone: auth.workspace.tone,
        brandInstructions: auth.workspace.brandInstructions,
        defaultCooldownSeconds: auth.workspace.defaultCooldownSeconds,
        onboardingCompletedAt: auth.workspace.onboardingCompletedAt,
        role: auth.memberRole,
      },
      plan: { id: plan.id, name: plan.name, limits: plan.limits, features: plan.features },
      subscription: subscription
        ? { status: subscription.status, trialEndsAt: subscription.trialEndsAt, currentPeriodEnd: subscription.currentPeriodEnd }
        : null,
      usage,
    };
  });

  app.post("/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Resposta idêntica exista ou não a conta (evita descobrir e-mails cadastrados).
    const response = { ok: true, emailEnabled: emailConfigured() || env.NODE_ENV !== "production" };
    if (!user) return response;
    const token = randomToken(32);
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60_000),
      ip: req.ip,
    });
    const url = `${env.APP_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
    const mail = layoutEmail(
      "Redefinição de senha",
      [`Olá, ${user.name.split(" ")[0]}!`, `Recebemos um pedido para redefinir a senha da sua conta no ${APP_NAME}. O link vale por 1 hora.`],
      { label: "Criar nova senha", url },
    );
    try {
      await sendEmail({ to: user.email, subject: `${APP_NAME}: redefinição de senha`, ...mail });
    } catch (err) {
      await recordSystemError("email.password_reset", err, { details: { userId: user.id } });
    }
    await audit({ userId: user.id, action: "auth.password_reset_requested", ip: req.ip });
    return response;
  });

  app.post("/auth/reset-password", authLimit, async (req, reply) => {
    const input = parse(z.object({ token: z.string().min(10).max(200), password: passwordSchema }), req.body);
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(input.token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!row) throw badRequest("Este link de redefinição é inválido ou expirou. Solicite um novo.");
    const passwordHash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, row.userId));
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.userId, row.userId));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
    });
    clearSessionCookie(reply);
    await audit({ userId: row.userId, action: "auth.password_reset", ip: req.ip });
    return { ok: true };
  });

  app.post("/auth/change-password", authLimit, async (req) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, auth.user.id)).limit(1);
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw badRequest("A senha atual está incorreta.");
    await db.update(users).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(users.id, user.id));
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), ne(sessions.id, auth.sessionId), isNull(sessions.revokedAt)));
    await audit({ userId: user.id, workspaceId: auth.workspace.id, action: "auth.password_changed", ip: req.ip });
    return { ok: true };
  });

  app.patch("/auth/profile", async (req) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
    await db.update(users).set({ name: input.name, updatedAt: new Date() }).where(eq(users.id, auth.user.id));
    return { ok: true };
  });

  app.get("/auth/sessions", async (req) => {
    const auth = requireAuth(req);
    const rows = await db
      .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt })
      .from(sessions)
      .where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    return { sessions: rows.map((s) => ({ ...s, current: s.id === auth.sessionId })) };
  });

  app.delete("/auth/sessions/:id", async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(uuidParam, req.params);
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, id), eq(sessions.userId, auth.user.id)));
    return { ok: true };
  });

  app.post("/auth/logout-all", async (req, reply) => {
    const auth = requireAuth(req);
    await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt)));
    clearSessionCookie(reply);
    await audit({ userId: auth.user.id, workspaceId: auth.workspace.id, action: "auth.logout_all", ip: req.ip });
    return { ok: true };
  });

  /** Exclusão de conta (LGPD): remove usuário, espaço de trabalho e todos os dados. */
  app.post("/auth/delete-account", authLimit, async (req, reply) => {
    const auth = requireAuth(req);
    const input = parse(z.object({ password: z.string().min(1), confirm: z.literal("EXCLUIR", { error: 'Digite EXCLUIR para confirmar' }) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, auth.user.id)).limit(1);
    if (!(await verifyPassword(input.password, user.passwordHash))) throw badRequest("Senha incorreta.");
    if (auth.memberRole !== "owner") throw new AppError(403, "forbidden", "Apenas o dono do espaço de trabalho pode excluir a conta.");
    const accounts = await db.select().from(instagramAccounts).where(eq(instagramAccounts.workspaceId, auth.workspace.id));
    for (const account of accounts) {
      if (!account.disconnectedAt) await disconnectAccount(account.id, { userId: user.id, reason: "account_deleted" }).catch(() => undefined);
    }
    await db.transaction(async (tx) => {
      await tx.delete(workspaces).where(eq(workspaces.ownerId, user.id));
      await tx.delete(users).where(eq(users.id, user.id));
    });
    await audit({ action: "auth.account_deleted", metadata: { email: user.email }, ip: req.ip });
    clearSessionCookie(reply);
    return { ok: true };
  });
}

/** Hash fixo usado para equalizar o tempo de resposta quando o e-mail não existe. */
const DUMMY_HASH = "scrypt$32768$8$1$c2FsdHNhbHRzYWx0c2FsdA==$" + Buffer.alloc(64, 1).toString("base64");
