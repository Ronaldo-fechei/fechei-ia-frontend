/**
 * Contratos de canal: o motor de automação não conhece Instagram nem WhatsApp.
 *
 * - `ChannelAdapter`: envia conteúdo para um contato (implementado por canal).
 * - `ChannelDriver` (ver channels/registry.ts): tudo que o restante do sistema
 *   precisa saber sobre um canal (adaptador, perfil do contato, erros, desconexão).
 */
import type { Channel } from "@veloxia/shared";

export type OutboundContent =
  | { kind: "text"; text: string; quickReplies?: { title: string; payload: string }[] }
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | {
      kind: "buttons";
      text: string;
      buttons: ({ type: "url"; title: string; url: string } | { type: "postback"; title: string; payload: string })[];
    }
  | {
      /** Modelo aprovado pela Meta (WhatsApp) — permitido fora da janela de 24h. */
      kind: "template";
      name: string;
      language: string;
      /** Texto já renderizado (para histórico e pré-visualização). */
      previewText: string;
      bodyParams: string[];
      headerImageUrl?: string;
    };

export interface SendTarget {
  /** ID do contato no canal (IGSID no Instagram, wa_id no WhatsApp). */
  contactExternalId: string;
  /** Quando presente, envia como resposta privada a um comentário (Instagram). */
  commentId?: string;
}

export interface SendOutcome {
  externalMessageId?: string;
  /** ID do destinatário retornado pelo canal (útil em respostas privadas). */
  recipientExternalId?: string;
}

export type ChannelErrorKind =
  | "auth"
  | "permission"
  | "rate_limit"
  | "window"
  | "user_unavailable"
  | "already_replied"
  | "payment"
  | "invalid"
  | "transient"
  | "unknown";

export class ChannelError extends Error {
  constructor(
    readonly kind: ChannelErrorKind,
    readonly retryable: boolean,
    readonly userMessage: string,
    readonly code: string,
    override readonly cause?: unknown,
  ) {
    super(userMessage);
    this.name = "ChannelError";
  }
}

export interface ChannelAdapter {
  readonly channel: Channel;
  send(target: SendTarget, content: OutboundContent): Promise<SendOutcome>;
  replyToComment?(commentId: string, text: string): Promise<{ id: string }>;
}

/** Texto curto para listas/prévia de conversa. */
export function contentPreview(content: OutboundContent): string {
  switch (content.kind) {
    case "text":
      return content.text;
    case "image":
      return "📷 Imagem";
    case "video":
      return "🎬 Vídeo";
    case "buttons":
      return content.text;
    case "template":
      return content.previewText || `Modelo: ${content.name}`;
  }
}
