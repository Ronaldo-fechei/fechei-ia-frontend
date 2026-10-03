import { describe, expect, it } from "vitest";
import { bestKeywordMatch, compareCandidates, keywordKey, matchKeyword, normalizeText, stripAccents } from "./keywords";

describe("normalização", () => {
  it("remove acentos e ignora caixa", () => {
    expect(stripAccents("preço ação")).toBe("preco acao");
    expect(normalizeText("  PREÇO   do  Produto ", { ignoreAccents: true })).toBe("preco do produto");
    expect(normalizeText("PREÇO", { caseSensitive: true })).toBe("PREÇO");
  });
});

describe("matchKeyword", () => {
  const rule = (text: string, matchType: any, extra = {}) => ({ text, matchType, ...extra });

  it("contém a palavra respeita fronteiras de palavra", () => {
    expect(matchKeyword("Me passa o LINK?", rule("link", "contains_word"))).not.toBeNull();
    expect(matchKeyword("me segue no linkedin", rule("link", "contains_word"))).toBeNull();
    expect(matchKeyword("onde compro isso", rule("onde compro", "contains_word"))).not.toBeNull();
  });

  it("contém a frase aceita trechos dentro de palavras", () => {
    expect(matchKeyword("me segue no linkedin", rule("link", "contains_phrase"))).not.toBeNull();
    expect(matchKeyword("onde compro?", rule("onde compr", "contains_phrase"))).not.toBeNull();
  });

  it("exata ignora pontuação e emojis", () => {
    expect(matchKeyword("Link! 🙏", rule("link", "exact"))).not.toBeNull();
    expect(matchKeyword("quero o link", rule("link", "exact"))).toBeNull();
  });

  it("começa e termina com", () => {
    expect(matchKeyword("Quero o link", rule("quero", "starts_with"))).not.toBeNull();
    expect(matchKeyword("eu quero", rule("quero", "starts_with"))).toBeNull();
    expect(matchKeyword("me manda o link", rule("link", "ends_with"))).not.toBeNull();
    expect(matchKeyword("link por favor", rule("link", "ends_with"))).toBeNull();
  });

  it("acentos: equivalentes apenas quando a opção está ativa", () => {
    expect(matchKeyword("qual o preco?", rule("preço", "contains_word", { ignoreAccents: true }))).not.toBeNull();
    expect(matchKeyword("qual o preco?", rule("preço", "contains_word", { ignoreAccents: false }))).toBeNull();
  });

  it("maiúsculas: sensível somente quando configurado", () => {
    expect(matchKeyword("PREÇO", rule("preço", "exact"))).not.toBeNull();
    expect(matchKeyword("preço", rule("PREÇO", "exact", { caseSensitive: true }))).toBeNull();
    expect(matchKeyword("PREÇO", rule("PREÇO", "exact", { caseSensitive: true }))).not.toBeNull();
  });

  it("a correspondência mais específica vence", () => {
    const m = bestKeywordMatch("me manda o link produto", [rule("link", "contains_word"), rule("link produto", "contains_word")]);
    expect(m?.keyword).toBe("link produto");
    const a = matchKeyword("me manda o link produto", rule("link", "contains_word"))!;
    const b = matchKeyword("me manda o link produto", rule("link produto", "contains_word"))!;
    const sorted = [
      { name: "A", priority: 0, specificity: a.specificity, tiebreaker: 1 },
      { name: "B", priority: 0, specificity: b.specificity, tiebreaker: 2 },
    ].sort(compareCandidates);
    expect(sorted[0].name).toBe("B");
  });

  it("prioridade manual se sobrepõe à especificidade", () => {
    const sorted = [
      { name: "específica", priority: 0, specificity: 9000, tiebreaker: 1 },
      { name: "prioritária", priority: 10, specificity: 100, tiebreaker: 2 },
    ].sort(compareCandidates);
    expect(sorted[0].name).toBe("prioritária");
  });

  it("keywordKey detecta duplicidades", () => {
    expect(keywordKey({ text: "LINK!" })).toBe(keywordKey({ text: "link" }));
    expect(keywordKey({ text: "Preço" })).toBe(keywordKey({ text: "preco" }));
  });
});
