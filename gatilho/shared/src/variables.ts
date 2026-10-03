/**
 * Variáveis de mensagem: {{nome}}, {{username}}, {{data}}…
 * Suporta valor padrão: {{nome|amigo}} → "amigo" quando o nome não é conhecido.
 */

export interface VariableDefinition {
  key: string;
  label: string;
  description: string;
  example: string;
}

export const SYSTEM_VARIABLES: VariableDefinition[] = [
  { key: "nome", label: "Nome", description: "Nome do contato (capturado ou do perfil do Instagram).", example: "Maria Souza" },
  { key: "primeiro_nome", label: "Primeiro nome", description: "Primeiro nome do contato.", example: "Maria" },
  { key: "username", label: "@username", description: "Usuário do Instagram do contato, com @.", example: "@maria.souza" },
  { key: "nome_instagram", label: "Nome no Instagram", description: "Nome exibido no perfil do Instagram do contato.", example: "Maria Souza" },
  { key: "data", label: "Data", description: "Data atual (fuso do seu espaço de trabalho).", example: "03/10/2026" },
  { key: "hora", label: "Hora", description: "Hora atual (fuso do seu espaço de trabalho).", example: "08:21" },
  { key: "link", label: "Link principal", description: "Link principal configurado na automação.", example: "https://exemplo.com/produto" },
  { key: "conta", label: "Sua conta", description: "O @ da sua conta do Instagram conectada.", example: "@sualoja" },
];

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g;

export type VariableContext = Record<string, string | null | undefined>;

/** Substitui as variáveis do texto pelos valores do contexto. */
export function renderVariables(text: string, context: VariableContext): string {
  return (text ?? "").replace(VARIABLE_PATTERN, (_all, key: string, fallback?: string) => {
    const value = context[key.toLowerCase()];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
    return (fallback ?? "").trim();
  });
}

/** Lista as variáveis usadas em um texto. */
export function extractVariables(text: string): string[] {
  const found = new Set<string>();
  for (const m of (text ?? "").matchAll(VARIABLE_PATTERN)) found.add(m[1].toLowerCase());
  return [...found];
}

/** Formata data/hora em um fuso horário IANA (padrão: America/Sao_Paulo). */
export function formatDateParts(date: Date, timeZone = "America/Sao_Paulo"): { data: string; hora: string } {
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return { data, hora };
}

/** Transforma um rótulo em chave de variável: "Produto de interesse" → "produto_de_interesse". */
export function slugifyKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}
