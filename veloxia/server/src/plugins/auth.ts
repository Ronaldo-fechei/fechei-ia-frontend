/**
 * Sessões seguras: token aleatório em cookie HttpOnly (SameSite=Lax),
 * apenas o hash SHA-256 é guardado no banco. Toda rota protegida usa
 * `requireAuth`, que injeta o espaço de trabalho do usuário — base do
 * isolamento entre clientes.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { cookieSecure, env } from "../config/env";
import { db } from "../db/client";
import { sessions, users, workspaceMembers, workspaces } from "../db/schema";
import { forbidden, unauthorized } from "../lib/errors";
import { hashToken, randomToken } from "../lib/crypto";

export const SESSION_COOKIE = "veloxia_session";

export interface AuthContext {
  sessionId: string;
  user: { id: string; email: string; name: string; role: "user" | "admin" };
  workspace: typeof workspaces.$inferSelect;
  memberRole: "owner" | "admin" | "agent";
}

export async function createSession(userId: string, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 86400_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: req.ip,
    userAgent: req.headers["user-agent"]?.slice(0, 300),
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, secure: cookieSecure, sameSite: "lax" });
}

async function loadAuth(req: FastifyRequest): Promise<AuthContext | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({ session: sessions, user: users, workspace: workspaces, member: workspaceMembers })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(workspaceMembers.createdAt)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > 10 * 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  }
  return {
    sessionId: row.session.id,
    user: { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role },
    workspace: row.workspace,
    memberRole: row.member.role,
  };
}

/** Exige sessão válida e devolve o contexto (tipado, nunca nulo). */
export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireAdmin(req: FastifyRequest): AuthContext {
  const auth = requireAuth(req);
  if (auth.user.role !== "admin") throw forbidden();
  return auth;
}

/** Rotas sem proteção CSRF por cabeçalho (assinadas pela Meta ou redirecionamentos GET). */
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/", "/api/meta/"];

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    // Proteção CSRF: requisições que alteram dados precisam do cabeçalho customizado,
    // que navegadores só enviam em chamadas same-origin ou CORS autorizadas.
    const method = req.method.toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !CSRF_EXEMPT_PREFIXES.some((p) => req.url.startsWith(p))) {
      if (req.headers["x-requested-with"] !== "veloxia") throw forbidden("Requisição bloqueada por segurança (CSRF).");
    }
    req.auth = await loadAuth(req);
  });
});
