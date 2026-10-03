import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { env, isTest } from "./config/env";
import { AppError } from "./lib/errors";
import { loggerOptions } from "./lib/logger";
import authPlugin from "./plugins/auth";
import { recordSystemError } from "./services/audit";
import { apiRoutes } from "./routes";
import { linkRedirectRoutes } from "./modules/links/routes";

function webDistDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [env.WEB_DIST_DIR, resolve(here, "../public"), resolve(here, "../../web/dist"), resolve(process.cwd(), "public")].filter(Boolean);
  return candidates.find((p) => existsSync(resolve(p, "index.html"))) ?? null;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cookie);
  const origins = [env.APP_URL, ...env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)];
  await app.register(cors, { origin: origins, credentials: true });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", allowList: () => isTest });
  await app.register(authPlugin);

  app.setErrorHandler(async (error: FastifyError | AppError | ZodError, req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.publicMessage, ...(error.details ?? {}) } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "validation_error", message: error.issues[0]?.message ?? "Dados inválidos." } });
    }
    const status = (error as FastifyError).statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: { code: "rate_limited", message: "Muitas requisições. Aguarde um momento e tente novamente." } });
    if (status < 500) {
      return reply.code(status).send({ error: { code: (error as FastifyError).code ?? "bad_request", message: "Requisição inválida." } });
    }
    await recordSystemError("api", error, { workspaceId: req.auth?.workspace.id, details: { url: req.url, method: req.method } });
    // Nunca expõe stack trace ao usuário final.
    return reply.code(500).send({ error: { code: "internal_error", message: "Algo deu errado do nosso lado. Tente novamente em instantes." } });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(apiRoutes, { prefix: "/api" });
  await app.register(linkRedirectRoutes);

  const dist = env.SERVE_WEB ? webDistDir() : null;
  if (dist) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: "/",
      wildcard: true,
      // Arquivos com hash no nome podem ser guardados em cache indefinidamente.
      setHeaders: (res, path) => {
        res.header("Cache-Control", path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0];
      // Rotas do SPA recebem o index.html; arquivos inexistentes (ex.: /assets/x.js) recebem 404 de verdade.
      if (req.method === "GET" && !path.startsWith("/api/") && !/\.[a-z0-9]+$/i.test(path)) {
        return reply.type("text/html").header("Cache-Control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "not_found", message: "Rota não encontrada." } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: "not_found", message: "Rota não encontrada." } }));
  }

  return app;
}
