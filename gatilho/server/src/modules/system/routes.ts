/** Estado das integrações: mostra ao usuário o que precisa ser configurado. */
import type { FastifyInstance } from "fastify";
import { APP_NAME } from "@gatilho/shared";
import { aiConfigured, emailConfigured, env, metaConfigured, urls, webhookConfigured } from "../../config/env";

export async function systemRoutes(app: FastifyInstance) {
  app.get("/system/status", async (req) => {
    const base = {
      appName: APP_NAME,
      emailEnabled: emailConfigured() || env.NODE_ENV !== "production",
      instagramEnabled: metaConfigured(),
      aiEnabled: aiConfigured(),
      supportEmail: env.SUPPORT_EMAIL || null,
    };
    if (!req.auth) return base;
    return {
      ...base,
      setup: {
        meta: {
          appConfigured: metaConfigured(),
          webhookConfigured: webhookConfigured(),
          graphApiVersion: env.META_GRAPH_API_VERSION,
          scopes: env.META_SCOPES.split(","),
          webhookFields: env.META_WEBHOOK_FIELDS.split(","),
          oauthRedirectUrl: urls.oauthCallback(),
          webhookUrl: urls.webhook(),
          deauthorizeUrl: urls.deauthorize(),
          dataDeletionUrl: urls.dataDeletion(),
          privacyPolicyUrl: urls.app("/privacidade"),
          termsUrl: urls.app("/termos"),
          humanAgentEnabled: env.META_HUMAN_AGENT_ENABLED,
          httpsOk: env.APP_URL.startsWith("https://"),
        },
        email: { configured: emailConfigured() },
        ai: { configured: aiConfigured(), model: aiConfigured() ? env.AI_MODEL : null },
      },
    };
  });
}
