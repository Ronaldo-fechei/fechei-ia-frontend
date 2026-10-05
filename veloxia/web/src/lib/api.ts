/**
 * Cliente HTTP da API interna. Sessão por cookie HttpOnly (mesmo domínio) e
 * cabeçalho anti-CSRF em todas as requisições.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get fields(): Record<string, string> {
    return (this.data.fields as Record<string, string>) ?? {};
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function request<T>(method: Method, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: {
        "X-Requested-With": "veloxia",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor. Verifique sua internet e tente novamente.", 0, "network_error");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error ?? {};
    const message = err.message ?? (res.status >= 500 ? "Algo deu errado do nosso lado. Tente novamente em instantes." : "Não foi possível concluir a ação.");
    if (res.status === 401 && path !== "/auth/me" && !path.startsWith("/auth/login")) {
      window.dispatchEvent(new CustomEvent("veloxia:unauthorized"));
    }
    throw new ApiError(message, res.status, err.code ?? "error", err);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Não foi possível concluir a ação.";
}
