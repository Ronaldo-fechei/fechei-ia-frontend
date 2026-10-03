import { z } from "zod";
import { AppError } from "./errors";

/** Valida dados de entrada e lança 400 com mensagens por campo. */
export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = result.error.issues[0];
    throw new AppError(400, "validation_error", first?.message ?? "Dados inválidos.", { fields });
  }
  return result.data;
}

export const uuidParam = z.object({ id: z.string().uuid("Identificador inválido") });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Informe um e-mail válido")
  .max(254);

const COMMON_PASSWORDS = new Set(["12345678", "123456789", "1234567890", "password", "senha123", "senha1234", "qwerty123", "abcdefgh", "11111111", "00000000"]);

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres")
  .max(128, "A senha pode ter no máximo 128 caracteres")
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), "Essa senha é muito comum. Escolha outra.");
