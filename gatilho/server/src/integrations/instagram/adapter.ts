/** Adaptador de canal do Instagram para o motor de automação. */
import { LIMITS } from "@gatilho/shared";
import { ChannelError, type ChannelAdapter, type OutboundContent, type SendOutcome, type SendTarget } from "../../engine/channel";
import { GraphApiError, type InstagramClient, type OutboundMessage } from "./client";

export function toInstagramMessage(content: OutboundContent): OutboundMessage {
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  switch (content.kind) {
    case "text":
      return content.quickReplies?.length
        ? {
            text: clip(content.text, LIMITS.textMaxLength),
            quick_replies: content.quickReplies.map((q) => ({ content_type: "text" as const, title: clip(q.title, 20), payload: q.payload })),
          }
        : { text: clip(content.text, LIMITS.textMaxLength) };
    case "image":
      return { attachment: { type: "image", payload: { url: content.url } } };
    case "video":
      return { attachment: { type: "video", payload: { url: content.url } } };
    case "buttons":
      return {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            // O texto do modelo de botão aceita até 640 caracteres.
            text: clip(content.text, 640),
            buttons: content.buttons.map((b) =>
              b.type === "url"
                ? { type: "web_url" as const, url: b.url, title: clip(b.title, 20) }
                : { type: "postback" as const, title: clip(b.title, 20), payload: b.payload },
            ),
          },
        },
      };
  }
}

export function toChannelError(err: unknown): ChannelError {
  if (err instanceof ChannelError) return err;
  if (err instanceof GraphApiError) return new ChannelError(err.kind, err.retryable, err.userMessage, err.errorCode, err);
  return new ChannelError("unknown", true, "Erro inesperado ao enviar a mensagem.", "unknown", err);
}

export class InstagramChannel implements ChannelAdapter {
  readonly channel = "instagram";

  constructor(private readonly client: InstagramClient) {}

  async send(target: SendTarget, content: OutboundContent): Promise<SendOutcome> {
    try {
      const recipient = target.commentId ? { comment_id: target.commentId } : { id: target.contactExternalId };
      const result = await this.client.sendMessage(recipient, toInstagramMessage(content));
      return { externalMessageId: result.message_id, recipientExternalId: result.recipient_id };
    } catch (err) {
      throw toChannelError(err);
    }
  }

  async replyToComment(commentId: string, text: string): Promise<{ id: string }> {
    try {
      return await this.client.replyToComment(commentId, text);
    } catch (err) {
      throw toChannelError(err);
    }
  }
}
