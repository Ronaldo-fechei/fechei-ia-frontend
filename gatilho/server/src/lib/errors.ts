/**
 * Erros de aplicação com mensagem amigável (exibida ao usuário) separada
 * dos detalhes técnicos (registrados apenas nos logs/painel administrativo).
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    /** Mensagem simples, em português, segura para o usuário final. */
    public readonly publicMessage: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(publicMessage);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Faça login para continuar.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "Você não tem permissão para esta ação.") => new AppError(403, "forbidden", message);
export const notFound = (message = "Não encontrado.") => new AppError(404, "not_found", message);
export const conflict = (message: string, details?: Record<string, unknown>) => new AppError(409, "conflict", message, details);
export const limitReached = (message: string, details?: Record<string, unknown>) => new AppError(402, "limit_reached", message, details);
export const tooMany = (message = "Muitas tentativas. Aguarde alguns minutos e tente novamente.") => new AppError(429, "rate_limited", message);
export const unavailable = (message: string, details?: Record<string, unknown>) => new AppError(503, "not_configured", message, details);

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
