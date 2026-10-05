/**
 * Modelo de fluxo de automação (blocos + conexões).
 *
 * Um fluxo é um grafo direcionado: um único bloco "Gatilho" inicia o fluxo;
 * blocos "Palavra-chave" ligados ao gatilho definem quais mensagens o ativam;
 * os demais blocos são executados em sequência seguindo as conexões.
 */
import { z } from "zod";
import { CHANNELS, CHANNEL_INFO, type Channel } from "./channels";
import { MATCH_TYPES, type KeywordRule } from "./keywords";

/* ------------------------------------------------------------------------ */
/* Limites das plataformas (APIs oficiais da Meta)                           */
/* ------------------------------------------------------------------------ */

export const LIMITS = {
  textMaxLength: 1000,
  buttonTitleMaxLength: 20,
  maxTemplateButtons: 3,
  maxQuickReplies: 10,
  maxKeywordsPerNode: 50,
  /** Espera máxima dentro da janela de 24h. */
  maxDelaySeconds: 23 * 3600,
  /** Sequências (WhatsApp, com modelos aprovados): até 30 dias. */
  maxSequenceDelaySeconds: 30 * 86400,
  /** Variáveis no corpo de um modelo do WhatsApp. */
  maxTemplateParams: 10,
  maxStepsPerExecution: 60,
  maxNodes: 80,
  /** Janela padrão de mensagens após a última mensagem do contato. */
  messagingWindowHours: 24,
  /** Respostas privadas a comentários: 1 por comentário, até 7 dias. */
  privateReplyWindowDays: 7,
} as const;

/* ------------------------------------------------------------------------ */
/* Gatilhos                                                                  */
/* ------------------------------------------------------------------------ */

export const TRIGGER_EVENTS = ["dm", "comment", "story_reply", "story_mention", "new_follower"] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export const TRIGGER_EVENT_INFO: Record<
  TriggerEvent,
  { label: string; description: string; available: boolean; unavailableReason?: string; permission: string; channels: Channel[] }
> = {
  dm: {
    label: "Mensagem direta",
    description: "Quando alguém envia uma mensagem no Direct do Instagram ou no WhatsApp contendo uma palavra-chave.",
    available: true,
    permission: "instagram_business_manage_messages",
    channels: ["instagram", "whatsapp"],
  },
  comment: {
    label: "Comentário → Direct",
    description: "Quando alguém comenta em uma publicação ou Reel. A primeira mensagem é enviada como resposta privada.",
    available: true,
    permission: "instagram_business_manage_comments",
    channels: ["instagram"],
  },
  story_reply: {
    label: "Resposta ao Story",
    description: "Quando alguém responde a um dos seus Stories pelo Direct.",
    available: true,
    permission: "instagram_business_manage_messages",
    channels: ["instagram"],
  },
  story_mention: {
    label: "Menção em Story",
    description: "Quando alguém menciona sua conta em um Story (a menção chega no Direct).",
    available: true,
    permission: "instagram_business_manage_messages",
    channels: ["instagram"],
  },
  new_follower: {
    label: "Novo seguidor",
    description: "Quando alguém começa a seguir sua conta.",
    available: false,
    unavailableReason:
      "A API oficial do Instagram não envia eventos de novos seguidores. Este gatilho será liberado somente se a Meta disponibilizar o evento oficialmente.",
    permission: "—",
    channels: ["instagram"],
  },
};

/* ------------------------------------------------------------------------ */
/* Blocos                                                                    */
/* ------------------------------------------------------------------------ */

export const NODE_TYPES = [
  "trigger",
  "keyword",
  "message",
  "image",
  "video",
  "link",
  "buttons",
  "condition",
  "delay",
  "add_tag",
  "remove_tag",
  "capture",
  "whatsapp_template",
  "whatsapp_handoff",
  "handoff",
  "end",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type NodeGroup = "inicio" | "mensagens" | "canais" | "logica" | "contato" | "fim";

export const NODE_INFO: Record<NodeType, { label: string; description: string; group: NodeGroup }> = {
  trigger: { label: "Gatilho", description: "Onde a automação começa.", group: "inicio" },
  keyword: { label: "Palavra-chave", description: "Palavras ou frases que ativam este caminho.", group: "inicio" },
  message: { label: "Mensagem", description: "Envia um texto com emojis e variáveis.", group: "mensagens" },
  image: { label: "Imagem", description: "Envia uma imagem.", group: "mensagens" },
  video: { label: "Vídeo", description: "Envia um vídeo.", group: "mensagens" },
  link: { label: "Link", description: "Envia um texto com botão que abre um link.", group: "mensagens" },
  buttons: { label: "Botões", description: "Envia opções para o contato tocar (até 3 botões).", group: "mensagens" },
  condition: { label: "Condição", description: "Segue caminhos diferentes conforme regras.", group: "logica" },
  delay: { label: "Aguardar", description: "Espera um tempo antes de continuar.", group: "logica" },
  add_tag: { label: "Adicionar tag", description: "Adiciona uma tag ao contato.", group: "contato" },
  remove_tag: { label: "Remover tag", description: "Remove uma tag do contato.", group: "contato" },
  capture: { label: "Capturar informação", description: "Pergunta e salva a resposta em um campo do contato.", group: "contato" },
  whatsapp_template: {
    label: "Modelo do WhatsApp",
    description: "Envia um modelo aprovado pela Meta. É o único tipo de mensagem permitido após 24h sem resposta.",
    group: "canais",
  },
  whatsapp_handoff: {
    label: "Levar para o WhatsApp",
    description: "Envia no Direct um botão que abre uma conversa com o seu WhatsApp.",
    group: "canais",
  },
  handoff: { label: "Atendimento humano", description: "Pausa as automações e encaminha para um atendente.", group: "fim" },
  end: { label: "Finalizar fluxo", description: "Encerra a automação.", group: "fim" },
};

/** Blocos que enviam mensagem ao contato. */
export const SEND_NODE_TYPES: NodeType[] = ["message", "image", "video", "link", "buttons", "capture", "whatsapp_template", "whatsapp_handoff"];

/** Blocos que só funcionam em alguns canais (os demais funcionam em todos). */
export const NODE_CHANNELS: Partial<Record<NodeType, Channel[]>> = {
  whatsapp_template: ["whatsapp"],
  whatsapp_handoff: ["instagram"],
};

const httpUrl = z
  .string()
  .trim()
  .url("Informe uma URL válida (começando com https://)")
  .refine((u) => /^https?:\/\//i.test(u), "A URL deve começar com http:// ou https://");

export const keywordRuleSchema = z.object({
  text: z.string().trim().min(1, "Palavra-chave vazia").max(100, "Palavra-chave muito longa"),
  matchType: z.enum(MATCH_TYPES).default("contains_word"),
  caseSensitive: z.boolean().default(false),
  ignoreAccents: z.boolean().default(true),
});

export const triggerDataSchema = z.object({
  event: z.enum(TRIGGER_EVENTS).default("dm"),
  /** Canais em que a automação responde (Mensagem direta pode usar vários). */
  channels: z.array(z.enum(CHANNELS)).min(1).default(["instagram"]),
  /** Comentário → Direct: publicações monitoradas (vazio = todas). */
  mediaIds: z.array(z.string()).default([]),
  /** Comentário → Direct: respostas públicas ao comentário (uma é sorteada). */
  publicReplyEnabled: z.boolean().default(false),
  publicReplies: z.array(z.string().max(300)).default([]),
});

export const conditionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("has_tag"), tagId: z.string().min(1) }),
  z.object({ type: z.literal("not_has_tag"), tagId: z.string().min(1) }),
  z.object({ type: z.literal("received_automation"), automationId: z.string().min(1) }),
  z.object({ type: z.literal("not_received_automation"), automationId: z.string().min(1) }),
  z.object({ type: z.literal("message_contains"), text: z.string().min(1) }),
  z.object({ type: z.literal("time_between"), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ type: z.literal("weekday"), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({
    type: z.literal("field"),
    fieldKey: z.string().min(1),
    operator: z.enum(["equals", "not_equals", "contains", "is_set", "is_not_set"]),
    value: z.string().optional(),
  }),
  z.object({ type: z.literal("is_follower") }),
  z.object({ type: z.literal("not_follower") }),
]);
export type ConditionRule = z.infer<typeof conditionRuleSchema>;

export const CONDITION_RULE_LABELS: Record<ConditionRule["type"], string> = {
  has_tag: "Contato possui a tag",
  not_has_tag: "Contato não possui a tag",
  received_automation: "Já recebeu a automação",
  not_received_automation: "Nunca recebeu a automação",
  message_contains: "Mensagem contém",
  time_between: "Horário entre",
  weekday: "Dia da semana é",
  field: "Campo personalizado",
  is_follower: "Contato segue sua conta",
  not_follower: "Contato não segue sua conta",
};

export const buttonSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "Botão sem texto").max(LIMITS.buttonTitleMaxLength, "Texto do botão com mais de 20 caracteres"),
  kind: z.enum(["reply", "url"]).default("reply"),
  url: z.string().optional(),
});

export const nodeDataSchemas = {
  trigger: triggerDataSchema,
  keyword: z.object({ keywords: z.array(keywordRuleSchema).default([]) }),
  message: z.object({ text: z.string().default("") }),
  image: z.object({ url: z.string().default(""), caption: z.string().optional() }),
  video: z.object({ url: z.string().default("") }),
  link: z.object({
    text: z.string().default(""),
    buttonTitle: z.string().default("Abrir link"),
    url: z.string().default(""),
    track: z.boolean().default(true),
  }),
  buttons: z.object({ text: z.string().default(""), buttons: z.array(buttonSchema).default([]) }),
  condition: z.object({ logic: z.enum(["all", "any"]).default("all"), rules: z.array(conditionRuleSchema).default([]) }),
  delay: z.object({ seconds: z.number().int().default(3) }),
  add_tag: z.object({ tagId: z.string().default("") }),
  remove_tag: z.object({ tagId: z.string().default("") }),
  capture: z.object({
    question: z.string().default(""),
    fieldKey: z.string().default(""),
    validation: z.enum(["text", "email", "phone", "number"]).default("text"),
    retryMessage: z.string().default("Não consegui entender. Pode enviar novamente?"),
    maxAttempts: z.number().int().min(1).max(5).default(2),
  }),
  whatsapp_template: z.object({
    templateName: z.string().default(""),
    language: z.string().default("pt_BR"),
    category: z.string().default(""),
    /** Texto do modelo (cópia para pré-visualização e simulador). */
    bodyText: z.string().default(""),
    /** Valores de {{1}}, {{2}}… (aceitam variáveis como {{nome}}). */
    bodyParams: z.array(z.string()).default([]),
    /** Imagem do cabeçalho, quando o modelo tem cabeçalho de imagem. */
    headerImageUrl: z.string().default(""),
  }),
  whatsapp_handoff: z.object({
    text: z.string().default("Prefere continuar pelo WhatsApp? Toque no botão abaixo 👇"),
    buttonTitle: z.string().default("Abrir WhatsApp"),
    /** Mensagem que já aparece digitada para o contato no WhatsApp. */
    prefill: z.string().default("Olá! Vim pelo Instagram 👋"),
    /** Número conectado (vazio = primeiro número do WhatsApp conectado). */
    accountId: z.string().default(""),
  }),
  handoff: z.object({ message: z.string().default("") }),
  end: z.object({}).passthrough(),
} satisfies Record<NodeType, z.ZodTypeAny>;

export type NodeDataMap = { [K in NodeType]: z.infer<(typeof nodeDataSchemas)[K]> };

export interface FlowNode<T extends NodeType = NodeType> {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: NodeDataMap[T];
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
}

export interface Flow {
  version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
  data: z.record(z.string(), z.unknown()).default({}),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1),
  sourceHandle: z.string().min(1).default("out"),
  target: z.string().min(1),
});

export const flowSchema = z.object({
  version: z.literal(1).default(1),
  nodes: z.array(nodeSchema).max(LIMITS.maxNodes, `Limite de ${LIMITS.maxNodes} blocos por fluxo`),
  edges: z.array(edgeSchema).max(LIMITS.maxNodes * 4),
});

/**
 * Converte qualquer entrada em um Flow bem formado (aplicando padrões nos dados
 * de cada bloco). Lança ZodError para estruturas inválidas.
 */
export function parseFlow(input: unknown): Flow {
  const raw = flowSchema.parse(input);
  return {
    version: 1,
    nodes: raw.nodes.map((n) => {
      const schema = nodeDataSchemas[n.type] as z.ZodTypeAny;
      const result = schema.safeParse(n.data ?? {});
      // Dados parcialmente inválidos são mantidos para que o editor mostre os erros.
      const data = result.success ? result.data : { ...(schema.safeParse({}).data ?? {}), ...(n.data as object) };
      return { id: n.id, type: n.type, position: n.position, data } as FlowNode;
    }),
    edges: raw.edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target })),
  };
}

export function emptyFlow(event: TriggerEvent = "dm", channels?: Channel[]): Flow {
  return {
    version: 1,
    nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: triggerDataSchema.parse({ event, channels }) }],
    edges: [],
  };
}

export function defaultNodeData<T extends NodeType>(type: T): NodeDataMap[T] {
  return (nodeDataSchemas[type] as z.ZodTypeAny).parse({}) as NodeDataMap[T];
}

/* ------------------------------------------------------------------------ */
/* Conexões                                                                  */
/* ------------------------------------------------------------------------ */

export interface OutputHandle {
  id: string;
  label: string;
}

/** Saídas disponíveis para um bloco. */
export function getOutputHandles(node: FlowNode): OutputHandle[] {
  switch (node.type) {
    case "condition":
      return [
        { id: "true", label: "Sim" },
        { id: "false", label: "Não" },
      ];
    case "buttons": {
      const data = node.data as NodeDataMap["buttons"];
      const replies = data.buttons.filter((b) => b.kind === "reply");
      if (replies.length === 0) return [{ id: "out", label: "Próximo" }];
      return replies.map((b) => ({ id: `btn:${b.id}`, label: b.title || "Botão" }));
    }
    case "capture":
      return [
        { id: "captured", label: "Respondeu" },
        { id: "failed", label: "Resposta inválida" },
      ];
    case "handoff":
    case "end":
      return [];
    default:
      return [{ id: "out", label: "Próximo" }];
  }
}

/** Canais em que o fluxo responde. */
export function flowChannels(flow: Flow): Channel[] {
  const trigger = getTriggerNode(flow);
  if (!trigger) return ["instagram"];
  const allowed = TRIGGER_EVENT_INFO[trigger.data.event].channels;
  const chosen = (trigger.data.channels ?? ["instagram"]).filter((c) => allowed.includes(c));
  return chosen.length ? chosen : ["instagram"];
}

/** Indica se o bloco pausa a execução esperando uma resposta do contato. */
export function waitsForInput(node: FlowNode): boolean {
  if (node.type === "capture") return true;
  if (node.type === "buttons") return (node.data as NodeDataMap["buttons"]).buttons.some((b) => b.kind === "reply");
  return false;
}

export function nextNodeId(flow: Flow, nodeId: string, handle: string): string | null {
  const edge = flow.edges.find((e) => e.source === nodeId && e.sourceHandle === handle);
  return edge ? edge.target : null;
}

export function getTriggerNode(flow: Flow): FlowNode<"trigger"> | undefined {
  return flow.nodes.find((n) => n.type === "trigger") as FlowNode<"trigger"> | undefined;
}

export interface FlowKeywordGroup {
  nodeId: string;
  rules: KeywordRule[];
}

/** Grupos de palavras-chave ligados ao gatilho. */
export function collectKeywordGroups(flow: Flow): FlowKeywordGroup[] {
  const trigger = getTriggerNode(flow);
  if (!trigger) return [];
  const keywordTargets = new Set(flow.edges.filter((e) => e.source === trigger.id).map((e) => e.target));
  return flow.nodes
    .filter((n) => n.type === "keyword" && keywordTargets.has(n.id))
    .map((n) => ({
      nodeId: n.id,
      rules: (n.data as NodeDataMap["keyword"]).keywords
        .filter((k) => k.text.trim())
        .map((k) => ({ text: k.text.trim(), matchType: k.matchType, caseSensitive: k.caseSensitive, ignoreAccents: k.ignoreAccents })),
    }));
}

/**
 * Bloco inicial quando o gatilho é ativado sem palavra-chave
 * (o gatilho liga diretamente a um bloco de ação).
 */
export function catchAllStartNode(flow: Flow): string | null {
  const trigger = getTriggerNode(flow);
  if (!trigger) return null;
  const targets = flow.edges.filter((e) => e.source === trigger.id).map((e) => e.target);
  const direct = targets.find((t) => flow.nodes.find((n) => n.id === t)?.type !== "keyword");
  return direct ?? null;
}

/** Links (URL) usados no fluxo: blocos Link e botões de URL. */
export function collectLinks(flow: Flow): { nodeId: string; buttonId?: string; url: string; title: string }[] {
  const links: { nodeId: string; buttonId?: string; url: string; title: string }[] = [];
  for (const node of flow.nodes) {
    if (node.type === "link") {
      const d = node.data as NodeDataMap["link"];
      if (d.url) links.push({ nodeId: node.id, url: d.url, title: d.buttonTitle });
    }
    if (node.type === "buttons") {
      const d = node.data as NodeDataMap["buttons"];
      for (const b of d.buttons) if (b.kind === "url" && b.url) links.push({ nodeId: node.id, buttonId: b.id, url: b.url, title: b.title });
    }
  }
  return links;
}

/* ------------------------------------------------------------------------ */
/* Validação                                                                 */
/* ------------------------------------------------------------------------ */

export interface FlowIssue {
  nodeId?: string;
  message: string;
}

export interface FlowValidation {
  valid: boolean;
  errors: FlowIssue[];
  warnings: FlowIssue[];
}

function isHttpUrl(value: string | undefined): boolean {
  return !!value && httpUrl.safeParse(value).success;
}

/** Valida o fluxo antes de publicar. Mensagens em português, prontas para o usuário. */
export function validateFlow(flow: Flow): FlowValidation {
  const errors: FlowIssue[] = [];
  const warnings: FlowIssue[] = [];
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));

  const triggers = flow.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) {
    errors.push({ message: triggers.length === 0 ? "O fluxo precisa de um bloco Gatilho." : "O fluxo só pode ter um bloco Gatilho." });
    return { valid: false, errors, warnings };
  }
  const trigger = triggers[0] as FlowNode<"trigger">;
  const event = trigger.data.event;
  const eventInfo = TRIGGER_EVENT_INFO[event];
  if (!eventInfo.available) errors.push({ nodeId: trigger.id, message: eventInfo.unavailableReason ?? "Gatilho indisponível." });

  if (new Set(flow.nodes.map((n) => n.id)).size !== flow.nodes.length) errors.push({ message: "Há blocos com identificadores duplicados." });

  // Canais
  const chosenChannels = trigger.data.channels ?? ["instagram"];
  if (chosenChannels.length === 0) errors.push({ nodeId: trigger.id, message: "Escolha pelo menos um canal para a automação." });
  for (const c of chosenChannels) {
    if (!eventInfo.channels.includes(c))
      errors.push({ nodeId: trigger.id, message: `"${eventInfo.label}" não existe no ${CHANNEL_INFO[c].label}. Remova este canal do gatilho.` });
  }
  const channels = flowChannels(flow);
  for (const node of flow.nodes) {
    const only = NODE_CHANNELS[node.type];
    if (only && !only.some((c) => channels.includes(c))) {
      errors.push({
        nodeId: node.id,
        message: `O bloco "${NODE_INFO[node.type].label}" só funciona no ${only.map((c) => CHANNEL_INFO[c].label).join(" e ")}. Inclua esse canal no gatilho ou remova o bloco.`,
      });
    }
  }

  // Conexões
  const usedHandles = new Set<string>();
  for (const edge of flow.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      errors.push({ message: "Há uma conexão ligada a um bloco que não existe." });
      continue;
    }
    if (target.type === "trigger") errors.push({ nodeId: source.id, message: "Nenhum bloco pode se conectar ao Gatilho." });
    if (target.type === "keyword" && source.type !== "trigger")
      errors.push({ nodeId: target.id, message: "Blocos de Palavra-chave devem estar ligados diretamente ao Gatilho." });
    const handles = getOutputHandles(source).map((h) => h.id);
    if (source.type !== "trigger" && !handles.includes(edge.sourceHandle))
      errors.push({ nodeId: source.id, message: `Conexão inválida a partir de "${NODE_INFO[source.type].label}".` });
    const key = `${edge.source}::${edge.sourceHandle}`;
    if (source.type !== "trigger" && usedHandles.has(key))
      errors.push({ nodeId: source.id, message: `A saída de "${NODE_INFO[source.type].label}" só pode seguir para um bloco.` });
    usedHandles.add(key);
  }

  const triggerEdges = flow.edges.filter((e) => e.source === trigger.id);
  if (triggerEdges.length === 0) errors.push({ nodeId: trigger.id, message: "Conecte o Gatilho a uma Palavra-chave ou a uma ação." });
  const directActions = triggerEdges.filter((e) => byId.get(e.target)?.type !== "keyword");
  if (directActions.length > 1)
    errors.push({ nodeId: trigger.id, message: "O Gatilho só pode ter uma ação direta. Use blocos de Palavra-chave para criar caminhos diferentes." });
  const keywordEdges = triggerEdges.filter((e) => byId.get(e.target)?.type === "keyword");

  if (event === "story_mention" && keywordEdges.length > 0)
    errors.push({ nodeId: trigger.id, message: "Menções em Stories não têm texto. Remova os blocos de Palavra-chave deste gatilho." });
  if ((event === "dm" || event === "story_reply") && keywordEdges.length === 0 && directActions.length > 0)
    warnings.push({
      nodeId: trigger.id,
      message: "Sem palavra-chave, esta automação responde a qualquer mensagem que não acionar outra automação.",
    });
  if (event === "comment" && keywordEdges.length === 0 && directActions.length > 0)
    warnings.push({ nodeId: trigger.id, message: "Sem palavra-chave, a automação responde a qualquer comentário nas publicações selecionadas." });
  if (event === "comment" && trigger.data.publicReplyEnabled && trigger.data.publicReplies.filter((r) => r.trim()).length === 0)
    errors.push({ nodeId: trigger.id, message: "Escreva pelo menos uma resposta pública ou desative essa opção." });

  // Dados de cada bloco
  for (const node of flow.nodes) {
    const label = NODE_INFO[node.type].label;
    const schema = nodeDataSchemas[node.type] as z.ZodTypeAny;
    if (!schema.safeParse(node.data).success && node.type !== "keyword" && node.type !== "buttons" && node.type !== "condition") {
      errors.push({ nodeId: node.id, message: `Configuração inválida no bloco "${label}".` });
    }
    const textIssue = (text: string | undefined, what = "o texto") => {
      if (!text || !text.trim()) errors.push({ nodeId: node.id, message: `Preencha ${what} do bloco "${label}".` });
      else if (text.length > LIMITS.textMaxLength)
        errors.push({ nodeId: node.id, message: `O texto do bloco "${label}" passa de ${LIMITS.textMaxLength} caracteres.` });
    };
    switch (node.type) {
      case "keyword": {
        const d = node.data as NodeDataMap["keyword"];
        const valid = d.keywords.filter((k) => k.text && k.text.trim());
        if (valid.length === 0) errors.push({ nodeId: node.id, message: "Adicione pelo menos uma palavra-chave." });
        if (d.keywords.length > LIMITS.maxKeywordsPerNode)
          errors.push({ nodeId: node.id, message: `Máximo de ${LIMITS.maxKeywordsPerNode} palavras-chave por bloco.` });
        for (const k of d.keywords) {
          if (!keywordRuleSchema.safeParse(k).success) errors.push({ nodeId: node.id, message: `Palavra-chave inválida: "${k.text ?? ""}".` });
        }
        break;
      }
      case "message":
        textIssue((node.data as NodeDataMap["message"]).text);
        break;
      case "image":
      case "video": {
        const d = node.data as NodeDataMap["image"];
        if (!isHttpUrl(d.url)) errors.push({ nodeId: node.id, message: `Informe uma URL pública válida no bloco "${label}".` });
        break;
      }
      case "link": {
        const d = node.data as NodeDataMap["link"];
        textIssue(d.text);
        if (!isHttpUrl(d.url)) errors.push({ nodeId: node.id, message: "Informe uma URL válida no bloco Link." });
        if (!d.buttonTitle?.trim() || d.buttonTitle.length > LIMITS.buttonTitleMaxLength)
          errors.push({ nodeId: node.id, message: "O texto do botão do Link deve ter de 1 a 20 caracteres." });
        break;
      }
      case "buttons": {
        const d = node.data as NodeDataMap["buttons"];
        textIssue(d.text);
        if (d.buttons.length === 0) errors.push({ nodeId: node.id, message: "Adicione pelo menos um botão." });
        const hasUrl = d.buttons.some((b) => b.kind === "url");
        const max = hasUrl ? LIMITS.maxTemplateButtons : LIMITS.maxQuickReplies;
        if (d.buttons.length > max)
          errors.push({
            nodeId: node.id,
            message: hasUrl
              ? "Com botões de link, o máximo é 3 botões."
              : `Máximo de ${LIMITS.maxQuickReplies} opções de resposta.`,
          });
        for (const b of d.buttons) {
          const r = buttonSchema.safeParse(b);
          if (!r.success) errors.push({ nodeId: node.id, message: r.error.issues[0]?.message ?? "Botão inválido." });
          if (b.kind === "url" && !isHttpUrl(b.url)) errors.push({ nodeId: node.id, message: `O botão "${b.title}" precisa de uma URL válida.` });
        }
        break;
      }
      case "condition": {
        const d = node.data as NodeDataMap["condition"];
        if (d.rules.length === 0) errors.push({ nodeId: node.id, message: "Adicione pelo menos uma regra na Condição." });
        for (const rule of d.rules) {
          if (!conditionRuleSchema.safeParse(rule).success)
            errors.push({ nodeId: node.id, message: "Há uma regra incompleta na Condição." });
        }
        break;
      }
      case "delay": {
        const d = node.data as NodeDataMap["delay"];
        const max = channels.includes("whatsapp") ? LIMITS.maxSequenceDelaySeconds : LIMITS.maxDelaySeconds;
        if (!Number.isInteger(d.seconds) || d.seconds < 1 || d.seconds > max)
          errors.push({
            nodeId: node.id,
            message: channels.includes("whatsapp")
              ? "O tempo de espera deve ficar entre 1 segundo e 30 dias."
              : "No Instagram, o tempo de espera deve ficar entre 1 segundo e 23 horas (regra da janela de 24h).",
          });
        break;
      }
      case "whatsapp_template": {
        const d = node.data as NodeDataMap["whatsapp_template"];
        if (!d.templateName) errors.push({ nodeId: node.id, message: "Escolha um modelo aprovado do WhatsApp." });
        if (d.bodyParams.length > LIMITS.maxTemplateParams) errors.push({ nodeId: node.id, message: "Muitas variáveis no modelo." });
        const expected = (d.bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
        if (expected > 0 && d.bodyParams.filter((p) => p.trim()).length < expected)
          errors.push({ nodeId: node.id, message: "Preencha todas as variáveis do modelo do WhatsApp." });
        break;
      }
      case "whatsapp_handoff": {
        const d = node.data as NodeDataMap["whatsapp_handoff"];
        textIssue(d.text);
        if (!d.buttonTitle?.trim() || d.buttonTitle.length > LIMITS.buttonTitleMaxLength)
          errors.push({ nodeId: node.id, message: "O texto do botão deve ter de 1 a 20 caracteres." });
        if (d.prefill.length > 500) errors.push({ nodeId: node.id, message: "A mensagem pré-preenchida passa de 500 caracteres." });
        break;
      }
      case "add_tag":
      case "remove_tag":
        if (!(node.data as NodeDataMap["add_tag"]).tagId) errors.push({ nodeId: node.id, message: `Escolha a tag do bloco "${label}".` });
        break;
      case "capture": {
        const d = node.data as NodeDataMap["capture"];
        textIssue(d.question, "a pergunta");
        if (!d.fieldKey) errors.push({ nodeId: node.id, message: "Escolha em qual campo salvar a resposta." });
        break;
      }
      case "handoff": {
        const d = node.data as NodeDataMap["handoff"];
        if (d.message && d.message.length > LIMITS.textMaxLength)
          errors.push({ nodeId: node.id, message: `O texto passa de ${LIMITS.textMaxLength} caracteres.` });
        break;
      }
    }
  }

  // Alcance e ciclos
  const reachable = new Set<string>();
  const stack = [trigger.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of flow.edges) if (e.source === id) stack.push(e.target);
  }
  for (const node of flow.nodes) {
    if (!reachable.has(node.id)) warnings.push({ nodeId: node.id, message: `O bloco "${NODE_INFO[node.type].label}" não está conectado e não será executado.` });
  }

  const visiting = new Set<string>();
  const done = new Set<string>();
  let cycleAt: string | null = null;
  const visit = (id: string) => {
    if (cycleAt) return;
    if (visiting.has(id)) {
      cycleAt = id;
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const e of flow.edges) if (e.source === id) visit(e.target);
    visiting.delete(id);
    done.add(id);
  };
  visit(trigger.id);
  if (cycleAt) errors.push({ nodeId: cycleAt, message: "O fluxo não pode voltar para um bloco anterior (ciclo detectado)." });

  // Comentário → Direct: só 1 mensagem antes de o contato responder.
  if (event === "comment" && !cycleAt) {
    const flagged = new Set<string>();
    const walk = (id: string, sendsBeforeReply: number, windowOpen: boolean) => {
      const node = byId.get(id);
      if (!node) return;
      let count = sendsBeforeReply;
      const sends = SEND_NODE_TYPES.includes(node.type) || (node.type === "handoff" && !!(node.data as NodeDataMap["handoff"]).message);
      if (sends && !windowOpen) {
        if (count >= 1 && !flagged.has(node.id)) {
          flagged.add(node.id);
          errors.push({
            nodeId: node.id,
            message:
              "Em automações de comentário, só 1 mensagem pode ser enviada antes de a pessoa responder (regra da Meta para respostas privadas). Use um bloco Botões com opções de resposta antes deste bloco.",
          });
        }
        count += 1;
      }
      for (const e of flow.edges.filter((x) => x.source === id)) {
        // Depois que o contato responde (toca um botão ou responde a pergunta), a janela de 24h fica aberta.
        const opens = waitsForInput(node) && (e.sourceHandle.startsWith("btn:") || node.type === "capture");
        walk(e.target, count, windowOpen || opens);
      }
    };
    walk(trigger.id, 0, false);
  }

  // Sequências: depois de uma espera longa a janela de 24h pode ter fechado.
  if (!cycleAt) {
    const flagged = new Set<string>();
    const walk = (id: string, windowMayBeClosed: boolean) => {
      const node = byId.get(id);
      if (!node) return;
      let closed = windowMayBeClosed;
      if (node.type === "delay" && (node.data as NodeDataMap["delay"]).seconds > LIMITS.maxDelaySeconds) closed = true;
      const sends = SEND_NODE_TYPES.includes(node.type) || (node.type === "handoff" && !!(node.data as NodeDataMap["handoff"]).message);
      if (closed && sends && node.type !== "whatsapp_template" && !flagged.has(node.id)) {
        flagged.add(node.id);
        errors.push({
          nodeId: node.id,
          message:
            "Depois de esperar mais de 23 horas, a janela de 24h da Meta pode ter fechado: use um bloco \"Modelo do WhatsApp\" (modelo aprovado) para retomar a conversa.",
        });
      }
      for (const e of flow.edges.filter((x) => x.source === id)) {
        // Uma resposta do contato reabre a janela.
        const reopens = waitsForInput(node) && (e.sourceHandle.startsWith("btn:") || node.type === "capture");
        walk(e.target, closed && !reopens);
      }
    };
    walk(trigger.id, false);
    if (flagged.size === 0 && channels.length > 1 && flow.nodes.some((n) => n.type === "delay" && (n.data as NodeDataMap["delay"]).seconds > LIMITS.maxDelaySeconds)) {
      warnings.push({ message: "No Instagram, mensagens após 24h sem resposta não são entregues; a sequência continua só no WhatsApp." });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
