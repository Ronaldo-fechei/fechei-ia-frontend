/**
 * Cliente da API oficial do Instagram (Instagram API with Instagram Login).
 * Host: graph.instagram.com — sem senha do Instagram, apenas tokens OAuth.
 *
 * Referência: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */
import { env } from "../../config/env";
import { httpFetch } from "../http";

export type GraphErrorKind =
  | "auth"
  | "permission"
  | "rate_limit"
  | "window"
  | "user_unavailable"
  | "already_replied"
  | "invalid"
  | "transient"
  | "unknown";

const USER_MESSAGES: Record<GraphErrorKind, string> = {
  auth: "A conexão com o Instagram expirou ou foi revogada. Reconecte sua conta.",
  permission: "Permissão do Instagram não concedida para esta ação. Reconecte a conta e autorize todas as permissões.",
  rate_limit: "Limite temporário de envios da Meta atingido. Vamos tentar novamente em instantes.",
  window: "Fora da janela de 24h: o Instagram só permite responder até 24h após a última mensagem do contato.",
  user_unavailable: "Este usuário não está disponível para receber mensagens no momento.",
  already_replied: "Este comentário já recebeu uma resposta privada (a Meta permite apenas uma por comentário).",
  invalid: "O Instagram recusou esta mensagem. Verifique o conteúdo (link, imagem ou botões).",
  transient: "Instabilidade temporária no Instagram. Vamos tentar novamente.",
  unknown: "Não foi possível concluir a ação no Instagram.",
};

export class GraphApiError extends Error {
  readonly kind: GraphErrorKind;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = "GraphApiError";
    this.kind = classify(status, code, subcode, message);
    this.retryable = this.kind === "rate_limit" || this.kind === "transient";
    this.userMessage = USER_MESSAGES[this.kind];
  }

  get errorCode(): string {
    return `${this.kind}${this.code !== undefined ? `:${this.code}` : ""}${this.subcode ? `/${this.subcode}` : ""}`;
  }
}

function classify(status: number, code: number | undefined, subcode: number | undefined, message: string): GraphErrorKind {
  const msg = message.toLowerCase();
  if (status === 0 || status >= 500 || code === 1 || code === 2) return "transient";
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== undefined && code >= 80000 && code < 80100)) return "rate_limit";
  if (code === 190 || code === 102 || code === 463 || code === 467) return "auth";
  if (subcode === 2534022 || msg.includes("outside of allowed window") || msg.includes("outside the allowed window")) return "window";
  if (msg.includes("already") && msg.includes("repl")) return "already_replied";
  if (code === 551 || subcode === 2534014 || msg.includes("isn't available") || msg.includes("is not available")) return "user_unavailable";
  if (code === 10 || (code !== undefined && code >= 200 && code < 300) || code === 3) return "permission";
  if (code === 100 || status === 400) return "invalid";
  return "unknown";
}

export interface IgProfile {
  id: string;
  user_id?: string;
  username: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
}

export interface IgUserProfile {
  name?: string;
  username?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
}

export type MessageRecipient = { id: string } | { comment_id: string };

export interface SendResult {
  recipient_id?: string;
  message_id?: string;
}

/** Corpo de mensagem aceito pelo endpoint /me/messages. */
export type OutboundMessage =
  | { text: string; quick_replies?: { content_type: "text"; title: string; payload: string }[] }
  | { attachment: { type: "image" | "video" | "audio" | "file"; payload: { url: string } } }
  | {
      attachment: {
        type: "template";
        payload: {
          template_type: "button";
          text: string;
          buttons: ({ type: "web_url"; url: string; title: string } | { type: "postback"; title: string; payload: string })[];
        };
      };
    };

export class InstagramClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl = env.META_GRAPH_BASE_URL,
    private readonly version = env.META_GRAPH_API_VERSION,
  ) {}

  private url(path: string, query?: Record<string, string | number | undefined>): string {
    const u = new URL(`${this.baseUrl}/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, opts: { query?: Record<string, string | number | undefined>; json?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await httpFetch(this.url(path, opts.query), {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new GraphApiError(`Falha de rede ao chamar a API do Instagram: ${(err as Error).message}`, 0);
    }
    return parseGraphResponse<T>(res);
  }

  getMe(): Promise<IgProfile> {
    return this.request("GET", "me", {
      query: { fields: "id,user_id,username,name,account_type,profile_picture_url,followers_count,media_count" },
    });
  }

  /** Perfil de quem conversa com a conta (exige que a pessoa tenha enviado mensagem). */
  getUserProfile(igsid: string): Promise<IgUserProfile> {
    return this.request("GET", encodeURIComponent(igsid), {
      query: { fields: "name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user" },
    });
  }

  sendMessage(recipient: MessageRecipient, message: OutboundMessage, opts: { humanAgent?: boolean } = {}): Promise<SendResult> {
    return this.request("POST", "me/messages", {
      json: {
        recipient,
        message,
        ...(opts.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
      },
    });
  }

  /** Resposta pública a um comentário. */
  replyToComment(commentId: string, text: string): Promise<{ id: string }> {
    return this.request("POST", `${encodeURIComponent(commentId)}/replies`, { query: { message: text } });
  }

  subscribeWebhooks(fields: string[]): Promise<{ success: boolean }> {
    return this.request("POST", "me/subscribed_apps", { query: { subscribed_fields: fields.join(",") } });
  }

  unsubscribeWebhooks(): Promise<{ success: boolean }> {
    return this.request("DELETE", "me/subscribed_apps");
  }

  listMedia(limit = 24, after?: string): Promise<{ data: IgMedia[]; paging?: { cursors?: { after?: string }; next?: string } }> {
    return this.request("GET", "me/media", {
      query: {
        fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count",
        limit,
        after,
      },
    });
  }
}

export async function parseGraphResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    const message = e.error_user_msg || e.message || e.error_message || `HTTP ${res.status}`;
    throw new GraphApiError(String(message), res.status, e.code ?? body?.code, e.error_subcode, e.fbtrace_id);
  }
  return body as T;
}
