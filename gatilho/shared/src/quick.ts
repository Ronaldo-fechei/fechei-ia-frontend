/**
 * Criação rápida de automação: um formulário simples que é convertido em fluxo.
 * O motor de automação só conhece fluxos — o modo rápido é uma forma amigável
 * de montar o fluxo mais comum (palavra-chave → [espera] → [imagem] → resposta).
 */
import { z } from "zod";
import { keywordRuleSchema, LIMITS, triggerDataSchema, type Flow, type FlowEdge, type FlowNode } from "./flow";

export const QUICK_TRIGGER_EVENTS = ["dm", "comment", "story_reply", "story_mention"] as const;

export const quickAutomationSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome para a automação").max(80),
    triggerEvent: z.enum(QUICK_TRIGGER_EVENTS).default("dm"),
    keywords: z.array(keywordRuleSchema).max(LIMITS.maxKeywordsPerNode).default([]),
    message: z.string().trim().min(1, "Escreva a resposta").max(LIMITS.textMaxLength, `Máximo de ${LIMITS.textMaxLength} caracteres`),
    linkUrl: z.string().trim().optional().default(""),
    buttonTitle: z.string().trim().max(LIMITS.buttonTitleMaxLength, "Máximo de 20 caracteres").optional().default(""),
    imageUrl: z.string().trim().optional().default(""),
    delaySeconds: z.number().int().min(0).max(LIMITS.maxDelaySeconds).default(0),
    mediaIds: z.array(z.string()).default([]),
    publicReplyEnabled: z.boolean().default(false),
    publicReplies: z.array(z.string().max(300)).default([]),
  })
  .superRefine((value, ctx) => {
    const isUrl = (u: string) => /^https?:\/\/[^\s]+\.[^\s]+/i.test(u);
    if (value.triggerEvent !== "story_mention" && value.keywords.length === 0 && value.triggerEvent === "dm")
      ctx.addIssue({ code: "custom", path: ["keywords"], message: "Adicione pelo menos uma palavra-chave" });
    if (value.linkUrl && !isUrl(value.linkUrl)) ctx.addIssue({ code: "custom", path: ["linkUrl"], message: "URL inválida" });
    if (value.imageUrl && !isUrl(value.imageUrl)) ctx.addIssue({ code: "custom", path: ["imageUrl"], message: "URL de imagem inválida" });
    if (value.triggerEvent === "comment" && value.imageUrl)
      ctx.addIssue({
        code: "custom",
        path: ["imageUrl"],
        message: "Em automações de comentário só é possível enviar uma mensagem antes de a pessoa responder. Remova a imagem.",
      });
  });

export type QuickAutomationInput = z.input<typeof quickAutomationSchema>;
export type QuickAutomation = z.output<typeof quickAutomationSchema>;

/** Monta o fluxo equivalente ao formulário rápido. */
export function quickToFlow(input: QuickAutomation): Flow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let y = 0;
  const step = 180;
  const add = (node: Omit<FlowNode, "position">, from?: { id: string; handle?: string }) => {
    nodes.push({ ...node, position: { x: 0, y } } as FlowNode);
    y += step;
    if (from) edges.push({ id: `e-${from.id}-${node.id}`, source: from.id, sourceHandle: from.handle ?? "out", target: node.id });
    return node.id;
  };

  let prev = add({
    id: "trigger",
    type: "trigger",
    data: triggerDataSchema.parse({
      event: input.triggerEvent,
      mediaIds: input.mediaIds,
      publicReplyEnabled: input.publicReplyEnabled,
      publicReplies: input.publicReplies,
    }),
  });

  if (input.keywords.length > 0 && input.triggerEvent !== "story_mention") {
    prev = add({ id: "keywords", type: "keyword", data: { keywords: input.keywords } }, { id: prev });
  }
  if (input.delaySeconds > 0) {
    prev = add({ id: "delay", type: "delay", data: { seconds: input.delaySeconds } }, { id: prev });
  }
  if (input.imageUrl) {
    prev = add({ id: "image", type: "image", data: { url: input.imageUrl } }, { id: prev });
  }
  if (input.linkUrl) {
    prev = add(
      {
        id: "reply",
        type: "link",
        data: { text: input.message, url: input.linkUrl, buttonTitle: input.buttonTitle || "Abrir link", track: true },
      },
      { id: prev },
    );
  } else {
    prev = add({ id: "reply", type: "message", data: { text: input.message } }, { id: prev });
  }
  add({ id: "end", type: "end", data: {} }, { id: prev });

  return { version: 1, nodes, edges };
}
