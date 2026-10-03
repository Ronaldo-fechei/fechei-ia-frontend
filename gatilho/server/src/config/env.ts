/**
 * Configuração por variáveis de ambiente, validada na inicialização.
 * Integrações externas são opcionais: quando ausentes, o painel mostra
 * exatamente o que precisa ser configurado (veja /api/system/status).
 */
import { existsSync } from "node:fs";
import { z } from "zod";

// Desenvolvimento: lê server/.env (ou gatilho/.env). Variáveis já definidas no ambiente têm prioridade.
if (process.env.NODE_ENV !== "test") {
  const file = [".env", "../.env"].find((f) => existsSync(f));
  if (file) process.loadEnvFile(file);
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3333),
  HOST: z.string().default("0.0.0.0"),
  /** URL pública do app (usada em OAuth, webhooks, links rastreados e e-mails). */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** Origens adicionais permitidas por CORS (separadas por vírgula). Em produção o ideal é servir web e API no mesmo domínio. */
  CORS_ORIGINS: z.string().default(""),
  DATABASE_URL: z.string().min(1).default("postgres://gatilho:gatilho@localhost:5432/gatilho"),
  DATABASE_SSL: bool(false),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  /** Segredo para assinaturas internas (links rastreados, códigos). */
  APP_SECRET: z.string().default(""),
  /** Chave AES-256 (32 bytes em base64) para criptografar tokens do Instagram. */
  ENCRYPTION_KEY: z.string().default(""),
  TRUST_PROXY: bool(true),
  COOKIE_SECURE: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().default(30),

  // Meta / Instagram (API do Instagram com login do Instagram)
  INSTAGRAM_APP_ID: z.string().default(""),
  INSTAGRAM_APP_SECRET: z.string().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().default(""),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().default("https://graph.instagram.com"),
  META_OAUTH_AUTHORIZE_URL: z.string().default("https://www.instagram.com/oauth/authorize"),
  META_OAUTH_TOKEN_URL: z.string().default("https://api.instagram.com/oauth/access_token"),
  META_SCOPES: z
    .string()
    .default("instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments"),
  META_WEBHOOK_FIELDS: z.string().default("messages,messaging_postbacks,messaging_referral,messaging_seen,comments"),
  /** Só ative se seu app tiver o recurso Human Agent aprovado pela Meta (permite responder até 7 dias). */
  META_HUMAN_AGENT_ENABLED: bool(false),

  // E-mail (SMTP)
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default(""),

  // IA (opcional)
  ANTHROPIC_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("claude-opus-5-5"),

  // Operação
  RUN_WORKER: bool(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  SUPPORT_EMAIL: z.string().default(""),
  ADMIN_EMAILS: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
  SERVE_WEB: bool(true),
  WEB_DIST_DIR: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const missing: string[] = [];
    if (env.APP_SECRET.length < 32) missing.push("APP_SECRET (mínimo 32 caracteres)");
    if (Buffer.from(env.ENCRYPTION_KEY, "base64").length !== 32) missing.push("ENCRYPTION_KEY (32 bytes em base64: openssl rand -base64 32)");
    if (!env.APP_URL.startsWith("https://")) missing.push("APP_URL com https://");
    if (missing.length) throw new Error(`Variáveis obrigatórias em produção ausentes: ${missing.join(", ")}`);
  }
  if (!env.APP_SECRET) env.APP_SECRET = "dev-only-secret-change-me-dev-only-secret";
  if (!env.ENCRYPTION_KEY) env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); // apenas desenvolvimento/testes
  return env;
}

export const env = load();

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

export const cookieSecure = env.COOKIE_SECURE !== undefined ? env.COOKIE_SECURE === "true" : env.APP_URL.startsWith("https://");

export const adminEmails = new Set(
  env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const metaConfigured = () => !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET);
export const webhookConfigured = () => !!(env.META_WEBHOOK_VERIFY_TOKEN && env.INSTAGRAM_APP_SECRET);
export const emailConfigured = () => !!(env.SMTP_HOST && env.SMTP_FROM);
export const aiConfigured = () => !!env.ANTHROPIC_API_KEY;

export const urls = {
  oauthCallback: () => `${env.APP_URL}/api/instagram/callback`,
  webhook: () => `${env.APP_URL}/api/webhooks/instagram`,
  deauthorize: () => `${env.APP_URL}/api/meta/deauthorize`,
  dataDeletion: () => `${env.APP_URL}/api/meta/data-deletion`,
  app: (path = "") => `${env.APP_URL}${path}`,
};
