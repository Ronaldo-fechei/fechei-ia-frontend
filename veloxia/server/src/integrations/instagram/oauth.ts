/**
 * Business Login for Instagram (OAuth 2.0 oficial).
 *
 * 1. Usuário autoriza em https://www.instagram.com/oauth/authorize
 * 2. Código → token de curta duração (1h) em https://api.instagram.com/oauth/access_token
 * 3. Token curto → token de longa duração (60 dias) em graph.instagram.com/access_token
 * 4. Renovação antes de expirar em graph.instagram.com/refresh_access_token
 */
import { env, urls } from "../../config/env";
import { httpFetch } from "../http";
import { GraphApiError, parseGraphResponse } from "./client";

export function buildAuthorizeUrl(state: string): string {
  const u = new URL(env.META_OAUTH_AUTHORIZE_URL);
  u.searchParams.set("client_id", env.INSTAGRAM_APP_ID);
  u.searchParams.set("redirect_uri", urls.oauthCallback());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", env.META_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("force_reauth", "true");
  return u.toString();
}

export interface ShortLivedToken {
  accessToken: string;
  userId: string;
  permissions: string[];
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await httpFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new GraphApiError(`Falha de rede na autenticação do Instagram: ${(err as Error).message}`, 0);
  }
  return parseGraphResponse<T>(res);
}

export async function exchangeCodeForToken(code: string): Promise<ShortLivedToken> {
  const form = new URLSearchParams({
    client_id: env.INSTAGRAM_APP_ID,
    client_secret: env.INSTAGRAM_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: urls.oauthCallback(),
    // O Instagram pode anexar "#_" ao código no redirecionamento.
    code: code.replace(/#_$/, ""),
  });
  const body = await call<any>(env.META_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  // A resposta pode vir como { data: [ {...} ] } ou como objeto simples.
  const item = Array.isArray(body?.data) ? body.data[0] : body;
  if (!item?.access_token) throw new GraphApiError("Resposta de token inválida do Instagram", 400);
  const perms = item.permissions;
  return {
    accessToken: String(item.access_token),
    userId: String(item.user_id ?? ""),
    permissions: Array.isArray(perms) ? perms.map(String) : typeof perms === "string" ? perms.split(",").map((p) => p.trim()).filter(Boolean) : [],
  };
}

export interface LongLivedToken {
  accessToken: string;
  expiresAt: Date;
}

function toLongLived(body: any): LongLivedToken {
  if (!body?.access_token) throw new GraphApiError("Resposta de token inválida do Instagram", 400);
  const seconds = Number(body.expires_in ?? 60 * 86400);
  return { accessToken: String(body.access_token), expiresAt: new Date(Date.now() + seconds * 1000) };
}

export async function exchangeForLongLivedToken(shortToken: string): Promise<LongLivedToken> {
  const u = new URL(`${env.META_GRAPH_BASE_URL}/access_token`);
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", env.INSTAGRAM_APP_SECRET);
  u.searchParams.set("access_token", shortToken);
  return toLongLived(await call<any>(u.toString(), { method: "GET" }));
}

export async function refreshLongLivedToken(token: string): Promise<LongLivedToken> {
  const u = new URL(`${env.META_GRAPH_BASE_URL}/refresh_access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  return toLongLived(await call<any>(u.toString(), { method: "GET" }));
}
