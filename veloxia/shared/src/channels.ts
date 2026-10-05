/**
 * Canais de mensagem suportados.
 *
 * Cada canal descreve aqui o que oferece (gatilhos, recursos e regras da
 * plataforma). O servidor implementa um "driver" por canal e o motor de
 * automação trabalha só com estas definições — para adicionar um canal novo
 * (ex.: Messenger, Telegram), basta registrá-lo aqui e criar o driver.
 */

export const CHANNELS = ["instagram", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface ChannelInfo {
  label: string;
  /** Como a conta é exibida: "@usuario" no Instagram, telefone no WhatsApp. */
  handlePrefix: "@" | "";
  /** Nome do lugar onde a conversa acontece. */
  inboxLabel: string;
  description: string;
  /** Janela de atendimento após a última mensagem do contato. */
  messagingWindowHours: number;
  /** Fora da janela só é possível enviar modelos aprovados pela Meta. */
  supportsTemplatesOutsideWindow: boolean;
  supportsComments: boolean;
  supportsStories: boolean;
  /** Botões de resposta por mensagem. */
  maxReplyButtons: number;
  /** Opções em lista (WhatsApp) ou respostas rápidas (Instagram). */
  maxListOptions: number;
  /** A Meta cobra por mensagem neste canal (pago pelo cliente direto à Meta). */
  metaChargesPerMessage: boolean;
}

export const CHANNEL_INFO: Record<Channel, ChannelInfo> = {
  instagram: {
    label: "Instagram",
    handlePrefix: "@",
    inboxLabel: "Direct",
    description: "Direct, comentários e Stories de contas profissionais do Instagram.",
    messagingWindowHours: 24,
    supportsTemplatesOutsideWindow: false,
    supportsComments: true,
    supportsStories: true,
    maxReplyButtons: 3,
    maxListOptions: 10,
    metaChargesPerMessage: false,
  },
  whatsapp: {
    label: "WhatsApp",
    handlePrefix: "",
    inboxLabel: "WhatsApp",
    description: "Números do WhatsApp Business conectados pela API oficial (Cloud API).",
    messagingWindowHours: 24,
    supportsTemplatesOutsideWindow: true,
    supportsComments: false,
    supportsStories: false,
    maxReplyButtons: 3,
    maxListOptions: 10,
    metaChargesPerMessage: true,
  },
};

/** Texto de exibição da conta: "@loja" ou "+55 11 99999-0000". */
export function formatChannelHandle(channel: Channel, handle: string | null | undefined): string {
  if (!handle) return "";
  return `${CHANNEL_INFO[channel].handlePrefix}${handle}`;
}

/** Categorias de cobrança da Meta no WhatsApp (modelo por mensagem). */
export const WHATSAPP_PRICING_CATEGORIES = ["marketing", "utility", "authentication", "service"] as const;
export type WhatsAppPricingCategory = (typeof WHATSAPP_PRICING_CATEGORIES)[number];

export const WHATSAPP_PRICING_LABELS: Record<WhatsAppPricingCategory, string> = {
  marketing: "Marketing",
  utility: "Utilidade",
  authentication: "Autenticação",
  service: "Atendimento (serviço)",
};

/** Categorias de modelos de mensagem do WhatsApp. */
export const WHATSAPP_TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY"] as const;
export type WhatsAppTemplateCategory = (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number];

export const WHATSAPP_TEMPLATE_STATUS_LABELS: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Recusado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  IN_APPEAL: "Em recurso",
  PENDING_DELETION: "Excluindo",
  DELETED: "Excluído",
  LIMIT_EXCEEDED: "Limite excedido",
};

/** Normaliza um telefone para dígitos com DDI (wa.me usa só dígitos). */
export function phoneDigits(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** Formata telefone brasileiro para exibição (+55 11 99999-0000). */
export function formatPhone(phone: string | null | undefined): string {
  const d = phoneDigits(phone ?? "");
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    const split = rest.length === 9 ? 5 : 4;
    return `+55 ${ddd} ${rest.slice(0, split)}-${rest.slice(split)}`;
  }
  return `+${d}`;
}
