/**
 * Normalização de texto e correspondência de palavras-chave.
 *
 * Este módulo é puro (sem I/O) e é usado tanto pelo motor de automação no
 * servidor quanto pelo painel (pré-visualização e detecção de conflitos).
 */

export const MATCH_TYPES = [
  "contains_word",
  "contains_phrase",
  "exact",
  "starts_with",
  "ends_with",
] as const;

export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  contains_word: "Contém a palavra",
  contains_phrase: "Contém a frase",
  exact: "Correspondência exata",
  starts_with: "Mensagem começa com",
  ends_with: "Mensagem termina com",
};

export const MATCH_TYPE_HELP: Record<MatchType, string> = {
  contains_word:
    'A palavra aparece inteira em qualquer parte da mensagem. "link" responde a "me passa o link", mas não a "linkedin".',
  contains_phrase:
    'O trecho aparece em qualquer parte da mensagem, mesmo dentro de outras palavras. "onde compr" responde a "onde compro?".',
  exact: 'A mensagem é exatamente a palavra-chave (ignorando pontuação). "link" responde a "Link!", mas não a "quero o link".',
  starts_with: 'A mensagem começa com a palavra-chave. "quero" responde a "quero o link".',
  ends_with: 'A mensagem termina com a palavra-chave. "link" responde a "me manda o link".',
};

export interface KeywordRule {
  text: string;
  matchType: MatchType;
  caseSensitive?: boolean;
  ignoreAccents?: boolean;
}

export interface NormalizeOptions {
  caseSensitive?: boolean;
  ignoreAccents?: boolean;
}

/** Remove acentos/diacríticos: "preço" → "preco". */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
}

/** Normaliza para comparação: Unicode NFC, acentos e caixa conforme opções, espaços colapsados. */
export function normalizeText(value: string, options: NormalizeOptions = {}): string {
  let text = (value ?? "").normalize("NFC");
  if (options.ignoreAccents) text = stripAccents(text);
  if (!options.caseSensitive) text = text.toLocaleLowerCase("pt-BR");
  return text.replace(/\s+/g, " ").trim();
}

/** Quebra em palavras (letras e números), descartando pontuação e emojis. */
export function tokenize(value: string): string[] {
  return value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function indexOfSequence(haystack: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const MATCH_TYPE_WEIGHT: Record<MatchType, number> = {
  exact: 50,
  starts_with: 30,
  ends_with: 30,
  contains_word: 20,
  contains_phrase: 10,
};

export interface KeywordMatch {
  keyword: string;
  matchType: MatchType;
  /** Quanto maior, mais específica é a correspondência (usado para prioridade). */
  specificity: number;
}

/**
 * Verifica se uma mensagem corresponde a uma regra de palavra-chave.
 * Retorna `null` quando não há correspondência.
 */
export function matchKeyword(message: string, rule: KeywordRule): KeywordMatch | null {
  const opts: NormalizeOptions = {
    caseSensitive: !!rule.caseSensitive,
    ignoreAccents: rule.ignoreAccents !== false,
  };
  const msgTokens = tokenize(normalizeText(message, opts));
  const kwTokens = tokenize(normalizeText(rule.text, opts));
  if (kwTokens.length === 0 || msgTokens.length === 0) return null;

  let matched = false;
  switch (rule.matchType) {
    case "exact":
      matched = msgTokens.join(" ") === kwTokens.join(" ");
      break;
    case "contains_word":
      matched = indexOfSequence(msgTokens, kwTokens) >= 0;
      break;
    case "contains_phrase":
      matched = msgTokens.join(" ").includes(kwTokens.join(" "));
      break;
    case "starts_with":
      matched = indexOfSequence(msgTokens.slice(0, kwTokens.length), kwTokens) === 0;
      break;
    case "ends_with":
      matched = indexOfSequence(msgTokens.slice(-kwTokens.length), kwTokens) === 0;
      break;
  }
  if (!matched) return null;

  const joined = kwTokens.join(" ");
  return {
    keyword: rule.text,
    matchType: rule.matchType,
    specificity: kwTokens.length * 1000 + joined.length * 10 + MATCH_TYPE_WEIGHT[rule.matchType],
  };
}

/** Retorna a correspondência mais específica dentre várias regras. */
export function bestKeywordMatch(message: string, rules: KeywordRule[]): KeywordMatch | null {
  let best: KeywordMatch | null = null;
  for (const rule of rules) {
    const m = matchKeyword(message, rule);
    if (m && (!best || m.specificity > best.specificity)) best = m;
  }
  return best;
}

/** Chave canônica de uma palavra-chave, usada para detectar duplicidades/conflitos. */
export function keywordKey(rule: Pick<KeywordRule, "text" | "caseSensitive" | "ignoreAccents">): string {
  return tokenize(
    normalizeText(rule.text, { caseSensitive: !!rule.caseSensitive, ignoreAccents: rule.ignoreAccents !== false }),
  ).join(" ");
}

export interface RankableCandidate {
  priority: number;
  specificity: number;
  /** Desempate final estável (ex.: data de criação em ms; menor vence). */
  tiebreaker: number;
}

/**
 * Ordena candidatos: prioridade manual (maior primeiro) e, em empate,
 * a correspondência mais específica. Depois, o mais antigo.
 */
export function compareCandidates(a: RankableCandidate, b: RankableCandidate): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.specificity !== b.specificity) return b.specificity - a.specificity;
  return a.tiebreaker - b.tiebreaker;
}
