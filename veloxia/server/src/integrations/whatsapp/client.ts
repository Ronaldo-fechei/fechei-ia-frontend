/**
 * Cliente da API oficial do WhatsApp (WhatsApp Cloud API, hospedada pela Meta).
 * Host: graph.facebook.com — o token é o do usuário de sistema da integração
 * criado no cadastro incorporado ("Embedded Signup"), nunca a senha do cliente.
 *
 * Referência: developers.facebook.com/documentation/business-messaging/whatsapp
 */
import { env } from "../../config/env";
import { httpFetch } from "../http";

export type WhatsAppErrorKind =
  | "auth"
  | "permission"
  | "rate_limit"
  | "window"
  | "user_unavailable"
  | "payment"
  | "invalid"
  | "transient"
  | "unknown";

const USER_MESSAGES: Record<WhatsAppErrorKind, string> = {
  auth: "A conexão com o WhatsApp expirou ou foi removida. Conecte o número novamente.",
  permission: "Permissão do WhatsApp não concedida para esta ação. Conecte o número novamente e autorize todas as permissões.",
  rate_limit: "Limite temporário de envios do WhatsApp atingido. Vamos tentar novamente em instantes.",
  window:
    "Fora da janela de 24h: o WhatsApp só permite mensagens comuns até 24h após a última mensagem do contato. Use um modelo aprovado.",
  user_unavailable: "Este número não pode receber mensagens do WhatsApp agora (número inválido, sem WhatsApp ou fora da lista de teste).",
  payment:
    "A Meta recusou o envio por falta de forma de pagamento. Cadastre um cartão na sua conta do WhatsApp Business (WhatsApp Manager → Pagamentos).",
  invalid: "O WhatsApp recusou esta mensagem. Verifique o conteúdo (texto, link, imagem, botões ou modelo).",
  transient: "Instabilidade temporária no WhatsApp. Vamos tentar novamente.",
  unknown: "Não foi possível concluir a ação no WhatsApp.",
};

export class WhatsAppApiError extends Error {
  readonly kind: WhatsAppErrorKind;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    readonly details?: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
    this.kind = classifyWhatsAppError(status, code, message);
    this.retryable = this.kind === "rate_limit" || this.kind === "transient";
    this.userMessage = USER_MESSAGES[this.kind];
  }

  get errorCode(): string {
    return `${this.kind}${this.code !== undefined ? `:${this.code}` : ""}`;
  }
}

/** Códigos de erro do WhatsApp Cloud API (ver "Error codes" na documentação da Meta). */
export function classifyWhatsAppError(status: number, code: number | undefined, message = ""): WhatsAppErrorKind {
  const msg = message.toLowerCase();
  if (status === 0 || status >= 500 || code === 1 || code === 2 || code === 131000 || code === 133004) return "transient";
  if (code === 4 || code === 80007 || code === 130429 || code === 131048 || code === 131056) return "rate_limit";
  if (code === 190 || code === 102 || code === 0) return "auth";
  if (code === 131047 || msg.includes("re-engagement")) return "window";
  if (code === 131042) return "payment";
  if (code === 131026 || code === 131030 || code === 131021) return "user_unavailable";
  if (code === 10 || code === 200 || code === 3 || code === 131031 || code === 131005) return "permission";
  if (code === 100 || code === 131008 || code === 131009 || code === 131051 || code === 131053 || (code !== undefined && code >= 132000 && code < 133000) || status === 400)
    return "invalid";
  return "unknown";
}

export interface WaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  messaging_limit_tier?: string;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components?: Record<string, unknown>[];
  rejected_reason?: string;
}

export interface WaSendResult {
  messaging_product?: string;
  contacts?: { input?: string; wa_id?: string }[];
  messages?: { id: string; message_status?: string }[];
}

/** Corpo aceito por POST /{phone_number_id}/messages (sem os campos comuns). */
export type WaOutboundMessage =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "image"; image: { link: string; caption?: string } }
  | { type: "video"; video: { link: string; caption?: string } }
  | {
      type: "interactive";
      interactive:
        | { type: "button"; body: { text: string }; action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] } }
        | {
            type: "list";
            body: { text: string };
            action: { button: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] };
          }
        | { type: "cta_url"; body: { text: string }; action: { name: "cta_url"; parameters: { display_text: string; url: string } } };
    }
  | {
      type: "template";
      template: { name: string; language: { code: string }; components?: Record<string, unknown>[] };
    };

export class WhatsAppClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl = env.META_GRAPH_FACEBOOK_URL,
    private readonly version = env.META_GRAPH_API_VERSION,
  ) {}

  private url(path: string, query?: Record<string, string | number | undefined>): string {
    const u = new URL(`${this.baseUrl}/${this.version}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | number | undefined>; json?: unknown } = {},
  ): Promise<T> {
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
      throw new WhatsAppApiError(`Falha de rede ao chamar a API do WhatsApp: ${(err as Error).message}`, 0);
    }
    return parseWhatsAppResponse<T>(res);
  }

  getPhoneNumber(phoneNumberId: string): Promise<WaPhoneNumber> {
    return this.request("GET", encodeURIComponent(phoneNumberId), {
      query: { fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,messaging_limit_tier" },
    });
  }

  /** Inscreve o app nos webhooks da conta do WhatsApp Business (WABA). */
  subscribeApp(wabaId: string): Promise<{ success: boolean }> {
    return this.request("POST", `${encodeURIComponent(wabaId)}/subscribed_apps`);
  }

  unsubscribeApp(wabaId: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `${encodeURIComponent(wabaId)}/subscribed_apps`);
  }

  /** Registra o número na Cloud API (define o PIN de confirmação em duas etapas). */
  registerPhone(phoneNumberId: string, pin: string): Promise<{ success: boolean }> {
    return this.request("POST", `${encodeURIComponent(phoneNumberId)}/register`, { json: { messaging_product: "whatsapp", pin } });
  }

  sendMessage(phoneNumberId: string, to: string, message: WaOutboundMessage): Promise<WaSendResult> {
    return this.request("POST", `${encodeURIComponent(phoneNumberId)}/messages`, {
      json: { messaging_product: "whatsapp", recipient_type: "individual", to, ...message },
    });
  }

  /** Marca a mensagem recebida como lida (os dois tiques azuis). */
  markRead(phoneNumberId: string, messageId: string): Promise<{ success: boolean }> {
    return this.request("POST", `${encodeURIComponent(phoneNumberId)}/messages`, {
      json: { messaging_product: "whatsapp", status: "read", message_id: messageId },
    });
  }

  listTemplates(wabaId: string, after?: string): Promise<{ data: WaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }> {
    return this.request("GET", `${encodeURIComponent(wabaId)}/message_templates`, {
      query: { fields: "id,name,language,status,category,components,rejected_reason", limit: 100, after },
    });
  }

  createTemplate(
    wabaId: string,
    template: { name: string; language: string; category: string; components: Record<string, unknown>[] },
  ): Promise<{ id: string; status: string; category: string }> {
    return this.request("POST", `${encodeURIComponent(wabaId)}/message_templates`, { json: template });
  }

  deleteTemplate(wabaId: string, name: string): Promise<{ success: boolean }> {
    return this.request("DELETE", `${encodeURIComponent(wabaId)}/message_templates`, { query: { name } });
  }
}

/** Troca o código do cadastro incorporado pelo token da integração. */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const u = new URL(`${env.META_GRAPH_FACEBOOK_URL}/${env.META_GRAPH_API_VERSION}/oauth/access_token`);
  u.searchParams.set("client_id", env.META_APP_ID);
  u.searchParams.set("client_secret", env.META_APP_SECRET);
  u.searchParams.set("code", code);
  let res: Response;
  try {
    res = await httpFetch(u.toString(), { method: "GET", signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new WhatsAppApiError(`Falha de rede ao trocar o código do WhatsApp: ${(err as Error).message}`, 0);
  }
  const body = await parseWhatsAppResponse<{ access_token?: string }>(res);
  if (!body.access_token) throw new WhatsAppApiError("A Meta não devolveu o token da integração.", 400, 100);
  return body.access_token;
}

export async function parseWhatsAppResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    const message = e.error_user_msg || e.message || `HTTP ${res.status}`;
    throw new WhatsAppApiError(String(message), res.status, e.code, e.error_subcode, e.error_data?.details);
  }
  return body as T;
}
