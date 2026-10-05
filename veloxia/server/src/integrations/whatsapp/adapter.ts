/**
 * Adaptador de canal do WhatsApp: converte o conteúdo do motor para os formatos
 * da Cloud API (texto, mídia, botões de resposta, lista, botão de link, modelo).
 */
import { LIMITS } from "@veloxia/shared";
import { ChannelError, type ChannelAdapter, type OutboundContent, type SendOutcome, type SendTarget } from "../../engine/channel";
import { WhatsAppApiError, type WaOutboundMessage, type WhatsAppClient } from "./client";

/** Limites do WhatsApp para mensagens interativas. */
export const WA_LIMITS = {
  bodyMaxLength: 1024,
  textMaxLength: 4096,
  replyButtonTitle: 20,
  maxReplyButtons: 3,
  listRowTitle: 24,
  maxListRows: 10,
  ctaDisplayText: 20,
} as const;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function toWhatsAppMessage(content: OutboundContent): WaOutboundMessage {
  switch (content.kind) {
    case "text": {
      const options = content.quickReplies ?? [];
      if (!options.length) return { type: "text", text: { body: clip(content.text, WA_LIMITS.textMaxLength), preview_url: true } };
      if (options.length <= WA_LIMITS.maxReplyButtons) {
        return {
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: clip(content.text, WA_LIMITS.bodyMaxLength) },
            action: { buttons: options.map((o) => ({ type: "reply", reply: { id: o.payload, title: clip(o.title, WA_LIMITS.replyButtonTitle) } })) },
          },
        };
      }
      return {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: clip(content.text, WA_LIMITS.bodyMaxLength) },
          action: {
            button: "Ver opções",
            sections: [
              {
                title: "Opções",
                rows: options.slice(0, WA_LIMITS.maxListRows).map((o) => ({ id: o.payload, title: clip(o.title, WA_LIMITS.listRowTitle) })),
              },
            ],
          },
        },
      };
    }
    case "image":
      return { type: "image", image: { link: content.url } };
    case "video":
      return { type: "video", video: { link: content.url } };
    case "buttons": {
      const urls = content.buttons.filter((b) => b.type === "url") as { type: "url"; title: string; url: string }[];
      const replies = content.buttons.filter((b) => b.type === "postback") as { type: "postback"; title: string; payload: string }[];
      // Um único link: botão de link nativo do WhatsApp.
      if (urls.length === 1 && replies.length === 0) {
        return {
          type: "interactive",
          interactive: {
            type: "cta_url",
            body: { text: clip(content.text, WA_LIMITS.bodyMaxLength) },
            action: { name: "cta_url", parameters: { display_text: clip(urls[0].title, WA_LIMITS.ctaDisplayText), url: urls[0].url } },
          },
        };
      }
      // O WhatsApp não mistura links e respostas no mesmo bloco: os links vão no texto.
      const linkLines = urls.map((u) => `🔗 ${u.title}: ${u.url}`).join("\n");
      const body = linkLines ? `${content.text}\n\n${linkLines}` : content.text;
      if (!replies.length) return { type: "text", text: { body: clip(body, WA_LIMITS.textMaxLength), preview_url: true } };
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: clip(body, WA_LIMITS.bodyMaxLength) },
          action: {
            buttons: replies
              .slice(0, WA_LIMITS.maxReplyButtons)
              .map((r) => ({ type: "reply", reply: { id: r.payload, title: clip(r.title, WA_LIMITS.replyButtonTitle) } })),
          },
        },
      };
    }
    case "template": {
      const components: Record<string, unknown>[] = [];
      if (content.headerImageUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: content.headerImageUrl } }] });
      if (content.bodyParams.length) {
        components.push({
          type: "body",
          parameters: content.bodyParams.slice(0, LIMITS.maxTemplateParams).map((text) => ({ type: "text", text: text || "-" })),
        });
      }
      return {
        type: "template",
        template: { name: content.name, language: { code: content.language }, ...(components.length ? { components } : {}) },
      };
    }
  }
}

export function toWhatsAppChannelError(err: unknown): ChannelError {
  if (err instanceof ChannelError) return err;
  if (err instanceof WhatsAppApiError) return new ChannelError(err.kind, err.retryable, err.userMessage, err.errorCode, err);
  return new ChannelError("unknown", true, "Erro inesperado ao enviar a mensagem.", "unknown", err);
}

export class WhatsAppChannel implements ChannelAdapter {
  readonly channel = "whatsapp" as const;

  constructor(
    private readonly client: WhatsAppClient,
    private readonly phoneNumberId: string,
  ) {}

  async send(target: SendTarget, content: OutboundContent): Promise<SendOutcome> {
    try {
      const result = await this.client.sendMessage(this.phoneNumberId, target.contactExternalId, toWhatsAppMessage(content));
      return { externalMessageId: result.messages?.[0]?.id, recipientExternalId: result.contacts?.[0]?.wa_id };
    } catch (err) {
      throw toWhatsAppChannelError(err);
    }
  }
}
