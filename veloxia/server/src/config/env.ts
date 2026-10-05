/**
 * Configuração por variáveis de ambiente, validada na inicialização.
 * Integrações externas são opcionais: quando ausentes, o painel mostra
 * exatamente o que precisa ser configurado (veja /api/system/status).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";

// Desenvolvimento: lê server/.env (ou veloxia/.env). Variáveis já definidas no ambiente têm prioridade.
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
  DATABASE_URL: z.string().min(1).default("postgres://veloxia:veloxia@localhost:5432/veloxia"),
  DATABASE_SSL: bool(false),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  /** Segredo para assinaturas internas (links rastreados, códigos). */
  APP_SECRET: z.string().default(""),
  /** Chave AES-256 (32 bytes em base64) para criptografar tokens dos canais (Instagram, WhatsApp). */
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

  // Meta / WhatsApp (Cloud API + cadastro incorporado "Embedded Signup")
  /** ID e chave secreta do app da Meta (Configurações do app → Básico). */
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  /** ID da configuração do Login do Facebook para Empresas usada no cadastro incorporado do WhatsApp. */
  WHATSAPP_CONFIG_ID: z.string().default(""),
  META_GRAPH_FACEBOOK_URL: z.string().default("https://graph.facebook.com"),
  /**
   * Tabela de preços da Meta em reais por mensagem cobrada, por categoria (JSON).
   * Usada só para ESTIMAR o consumo do cliente — quem cobra é a Meta, no cartão do cliente.
   * Atualize quando a Meta publicar novos valores.
   */
  WHATSAPP_RATES_BRL: z.string().default('{"marketing":0.3217,"utility":0.035,"authentication":0.035,"service":0.035}'),

  // Pagamentos (Mercado Pago)
  MP_ACCESS_TOKEN: z.string().default(""),
  /** Assinatura secreta dos webhooks (Suas integrações → Webhooks). */
  MP_WEBHOOK_SECRET: z.string().default(""),
  MP_API_URL: z.string().default("https://api.mercadopago.com"),

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
  // No Render, o endereço público vem pronto em RENDER_EXTERNAL_URL (dispensa configurar APP_URL).
  if (!process.env.APP_URL && process.env.RENDER_EXTERNAL_URL) env.APP_URL = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production") {
    const missing: string[] = [];
    if (env.APP_SECRET.length < 32) missing.push("APP_SECRET (mínimo 32 caracteres)");
    if (!validEncryptionKey(env.ENCRYPTION_KEY)) missing.push("ENCRYPTION_KEY (32 bytes em base64 — openssl rand -base64 32 — ou um segredo aleatório com 32+ caracteres)");
    if (!env.APP_URL.startsWith("https://")) missing.push("APP_URL com https://");
    if (missing.length) throw new Error(`Variáveis obrigatórias em produção ausentes: ${missing.join(", ")}`);
  }
  if (!env.APP_SECRET) env.APP_SECRET = "dev-only-secret-change-me-dev-only-secret";
  if (!env.ENCRYPTION_KEY) env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); // apenas desenvolvimento/testes
  return env;
}

function validEncryptionKey(value: string): boolean {
  return Buffer.from(value, "base64").length === 32 || value.length >= 32;
}

/**
 * Chave AES-256 a partir de ENCRYPTION_KEY: 32 bytes em base64 são usados diretamente;
 * qualquer outro segredo com 32+ caracteres (ex.: gerado pelo Render) passa por SHA-256.
 */
export function encryptionKeyBytes(): Buffer {
  const raw = Buffer.from(env.ENCRYPTION_KEY, "base64");
  if (raw.length === 32) return raw;
  if (env.ENCRYPTION_KEY.length >= 32) return createHash("sha256").update(env.ENCRYPTION_KEY, "utf8").digest();
  throw new Error("ENCRYPTION_KEY inválida: use 32 bytes em base64 (openssl rand -base64 32) ou um segredo aleatório com 32+ caracteres");
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
export const whatsappConfigured = () => !!(env.META_APP_ID && env.META_APP_SECRET && env.WHATSAPP_CONFIG_ID);
export const whatsappWebhookConfigured = () => !!(env.META_WEBHOOK_VERIFY_TOKEN && env.META_APP_SECRET);
export const paymentsConfigured = () => !!env.MP_ACCESS_TOKEN;

/** Preços da Meta por mensagem (R$) para estimar o consumo do WhatsApp. */
export function whatsappRates(): Record<string, number> {
  try {
    const parsed = JSON.parse(env.WHATSAPP_RATES_BRL) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "number")) as Record<string, number>;
  } catch {
    return {};
  }
}
export const emailConfigured = () => !!(env.SMTP_HOST && env.SMTP_FROM);
export const aiConfigured = () => !!env.ANTHROPIC_API_KEY;

export const urls = {
  oauthCallback: () => `${env.APP_URL}/api/instagram/callback`,
  webhook: () => `${env.APP_URL}/api/webhooks/instagram`,
  whatsappWebhook: () => `${env.APP_URL}/api/webhooks/whatsapp`,
  mercadoPagoWebhook: () => `${env.APP_URL}/api/webhooks/mercadopago`,
  deauthorize: () => `${env.APP_URL}/api/meta/deauthorize`,
  dataDeletion: () => `${env.APP_URL}/api/meta/data-deletion`,
  app: (path = "") => `${env.APP_URL}${path}`,
};
