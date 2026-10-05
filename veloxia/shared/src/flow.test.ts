import { describe, expect, it } from "vitest";
import { collectKeywordGroups, flowChannels, parseFlow, validateFlow, type Flow } from "./flow";
import { quickAutomationSchema, quickToFlow } from "./quick";
import { TEMPLATES } from "./templates";
import { renderVariables } from "./variables";

describe("variáveis", () => {
  it("substitui variáveis e aplica valor padrão", () => {
    expect(renderVariables("Oi, {{nome}}! Link: {{ link }}", { nome: "Ana", link: "https://x.com" })).toBe("Oi, Ana! Link: https://x.com");
    expect(renderVariables("Oi, {{nome|amigo}}!", {})).toBe("Oi, amigo!");
    expect(renderVariables("Oi{{desconhecida}}!", {})).toBe("Oi!");
  });
});

describe("criação rápida", () => {
  it("gera um fluxo válido com link e atraso", () => {
    const input = quickAutomationSchema.parse({
      name: "Link da Shopee",
      keywords: [{ text: "shopee" }, { text: "link" }],
      message: "Claro! 🛍️ Aqui está o link:",
      linkUrl: "https://shopee.com.br/produto",
      buttonTitle: "Ver produto",
      delaySeconds: 3,
    });
    const flow = quickToFlow(input);
    const v = validateFlow(flow);
    expect(v.errors).toEqual([]);
    expect(collectKeywordGroups(flow)[0].rules.map((r) => r.text)).toEqual(["shopee", "link"]);
    expect(flow.nodes.map((n) => n.type)).toEqual(["trigger", "keyword", "delay", "link", "end"]);
  });

  it("exige palavra-chave para Direct", () => {
    const r = quickAutomationSchema.safeParse({ name: "x", keywords: [], message: "oi" });
    expect(r.success).toBe(false);
  });
});

describe("validação de fluxo", () => {
  it("rejeita ciclos", () => {
    const flow = parseFlow({
      nodes: [
        { id: "t", type: "trigger", data: { event: "dm" } },
        { id: "k", type: "keyword", data: { keywords: [{ text: "oi" }] } },
        { id: "a", type: "message", data: { text: "a" } },
        { id: "b", type: "message", data: { text: "b" } },
      ],
      edges: [
        { id: "1", source: "t", sourceHandle: "out", target: "k" },
        { id: "2", source: "k", sourceHandle: "out", target: "a" },
        { id: "3", source: "a", sourceHandle: "out", target: "b" },
        { id: "4", source: "b", sourceHandle: "out", target: "a" },
      ],
    });
    expect(validateFlow(flow).errors.some((e) => e.message.includes("ciclo"))).toBe(true);
  });

  it("em comentários permite só 1 mensagem antes de a pessoa responder", () => {
    const flow = parseFlow({
      nodes: [
        { id: "t", type: "trigger", data: { event: "comment" } },
        { id: "a", type: "message", data: { text: "Oi!" } },
        { id: "b", type: "message", data: { text: "Segunda" } },
      ],
      edges: [
        { id: "1", source: "t", sourceHandle: "out", target: "a" },
        { id: "2", source: "a", sourceHandle: "out", target: "b" },
      ],
    });
    const v = validateFlow(flow);
    expect(v.valid).toBe(false);
    expect(v.errors[0].nodeId).toBe("b");

    const ok = parseFlow({
      nodes: [
        { id: "t", type: "trigger", data: { event: "comment" } },
        { id: "a", type: "buttons", data: { text: "Quer o link?", buttons: [{ id: "s", title: "Quero!", kind: "reply" }] } },
        { id: "b", type: "message", data: { text: "Aqui está" } },
        { id: "c", type: "message", data: { text: "Mais uma" } },
      ],
      edges: [
        { id: "1", source: "t", sourceHandle: "out", target: "a" },
        { id: "2", source: "a", sourceHandle: "btn:s", target: "b" },
        { id: "3", source: "b", sourceHandle: "out", target: "c" },
      ],
    });
    expect(validateFlow(ok).errors).toEqual([]);
  });

  it("gatilho de novo seguidor é indisponível", () => {
    const flow: Flow = parseFlow({
      nodes: [
        { id: "t", type: "trigger", data: { event: "new_follower" } },
        { id: "a", type: "message", data: { text: "Obrigado por seguir!" } },
      ],
      edges: [{ id: "1", source: "t", sourceHandle: "out", target: "a" }],
    });
    expect(validateFlow(flow).valid).toBe(false);
  });

  it("todos os modelos são estruturalmente válidos (exceto URLs a preencher)", () => {
    for (const tpl of TEMPLATES) {
      const v = validateFlow(parseFlow(tpl.build()));
      const structural = v.errors.filter((e) => !/URL|modelo aprovado/i.test(e.message));
      expect(structural, tpl.id).toEqual([]);
    }
  });
});

describe("canais", () => {
  const base = (triggerData: Record<string, unknown>, extraNodes: any[] = [], extraEdges: any[] = []) =>
    parseFlow({
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: triggerData },
        { id: "k", type: "keyword", position: { x: 0, y: 1 }, data: { keywords: [{ text: "oi" }] } },
        { id: "m", type: "message", position: { x: 0, y: 2 }, data: { text: "Olá" } },
        ...extraNodes,
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "out", target: "k" },
        { id: "e2", source: "k", sourceHandle: "out", target: "m" },
        ...extraEdges,
      ],
    });

  it("fluxos antigos (sem canais) continuam no Instagram", () => {
    expect(flowChannels(base({ event: "dm" }))).toEqual(["instagram"]);
  });

  it("comentários só existem no Instagram", () => {
    const v = validateFlow(base({ event: "comment", channels: ["instagram", "whatsapp"] }));
    expect(v.errors.some((e) => e.message.includes("não existe no WhatsApp"))).toBe(true);
  });

  it("bloco de modelo exige WhatsApp no gatilho; Levar para o WhatsApp exige Instagram", () => {
    const tpl = { id: "w", type: "whatsapp_template", position: { x: 0, y: 3 }, data: { templateName: "x", bodyText: "Oi" } };
    const edge = { id: "e3", source: "m", sourceHandle: "out", target: "w" };
    expect(validateFlow(base({ event: "dm", channels: ["instagram"] }, [tpl], [edge])).errors.some((e) => e.message.includes("só funciona no WhatsApp"))).toBe(true);
    expect(validateFlow(base({ event: "dm", channels: ["whatsapp"] }, [tpl], [edge])).valid).toBe(true);
    const handoff = { id: "w", type: "whatsapp_handoff", position: { x: 0, y: 3 }, data: {} };
    expect(validateFlow(base({ event: "dm", channels: ["whatsapp"] }, [handoff], [edge])).errors.some((e) => e.message.includes("só funciona no Instagram"))).toBe(true);
  });

  it("espera maior que 23h só no WhatsApp", () => {
    const delay = { id: "d", type: "delay", position: { x: 0, y: 3 }, data: { seconds: 2 * 86400 } };
    const edge = { id: "e3", source: "m", sourceHandle: "out", target: "d" };
    expect(validateFlow(base({ event: "dm", channels: ["instagram"] }, [delay], [edge])).valid).toBe(false);
    expect(validateFlow(base({ event: "dm", channels: ["whatsapp"] }, [delay], [edge])).valid).toBe(true);
  });
});
