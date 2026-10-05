import type { FastifyInstance } from "fastify";
import { adminRoutes } from "./modules/admin/routes";
import { aiRoutes } from "./modules/ai/routes";
import { analyticsRoutes } from "./modules/analytics/routes";
import { authRoutes } from "./modules/auth/routes";
import { automationRoutes } from "./modules/automations/routes";
import { crmRoutes } from "./modules/crm/routes";
import { eventRoutes } from "./modules/events/routes";
import { inboxRoutes } from "./modules/inbox/routes";
import { channelRoutes } from "./modules/channels/routes";
import { instagramRoutes } from "./modules/instagram/routes";
import { mediaRoutes } from "./modules/media/routes";
import { metaRoutes } from "./modules/meta/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { settingsRoutes } from "./modules/settings/routes";
import { systemRoutes } from "./modules/system/routes";
import { webhookRoutes } from "./modules/webhooks/routes";
import { whatsappRoutes } from "./modules/whatsapp/routes";

/** API interna, organizada por domínio. */
export async function apiRoutes(app: FastifyInstance) {
  // Rotas assinadas pela Meta (escopos próprios para o parser do corpo bruto).
  await app.register(webhookRoutes);
  await app.register(metaRoutes);

  await app.register(systemRoutes);
  await app.register(authRoutes);
  await app.register(channelRoutes);
  await app.register(instagramRoutes);
  await app.register(whatsappRoutes);
  await app.register(automationRoutes);
  await app.register(crmRoutes);
  await app.register(inboxRoutes);
  await app.register(analyticsRoutes);
  await app.register(notificationRoutes);
  await app.register(settingsRoutes);
  await app.register(mediaRoutes);
  await app.register(aiRoutes);
  await app.register(eventRoutes);
  await app.register(adminRoutes);
}
