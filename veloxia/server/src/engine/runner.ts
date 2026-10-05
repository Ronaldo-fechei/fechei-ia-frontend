/**
 * Interpretador de fluxos (independente de banco de dados e de canal).
 *
 * Executa blocos em sequência até: terminar, precisar esperar (bloco
 * "Aguardar", resposta do contato ou nova tentativa de envio) ou falhar.
 * Todo efeito colateral passa pelo `EngineRuntime`, o que permite rodar o
 * mesmo fluxo em produção (banco + canal real) e no simulador (memória).
 */
import {
  CHANNEL_INFO,
  formatPhone,
  LIMITS,
  NODE_INFO,
  nextNodeId,
  renderVariables,
  formatDateParts,
  type Flow,
  type FlowNode,
  type NodeDataMap,
  type Channel,
} from "@veloxia/shared";
import type { ExecutionContext, ExecutionStep } from "../db/schema";
import { ChannelError, type OutboundContent, type SendOutcome } from "./channel";
import { evaluateCondition } from "./conditions";

export interface RuntimeContact {
  id: string;
  externalId: string;
  name: string | null;
  username: string | null;
  /** WhatsApp: telefone com DDI. */
  phone: string | null;
  isFollower: boolean | null;
  lastInboundAt: Date | null;
  tagIds: Set<string>;
  fields: Record<string, string>;
}

export interface EngineRuntime {
  executionId: string;
  automationId: string | null;
  timezone: string;
  /** Canal desta execução. */
  channel: Channel;
  /** Como a conta aparece em {{conta}}: "@loja" no Instagram, nome/número no WhatsApp. */
  accountDisplay: string | null;
  contact: RuntimeContact;
  now(): Date;
  /** Envia conteúdo e registra a mensagem. Lança ChannelError em falhas. */
  send(content: OutboundContent, opts: { commentId?: string; nodeId: string }): Promise<SendOutcome & { messageId?: string }>;
  addTag(tagId: string): Promise<void>;
  removeTag(tagId: string): Promise<void>;
  setField(fieldKey: string, value: string): Promise<void>;
  hasReceivedAutomation(automationId: string): Promise<boolean>;
  handoff(): Promise<void>;
  /** URL rastreável para cliques (ou a própria URL quando não rastreada). */
  trackedUrl(nodeId: string, buttonId: string | undefined, url: string, track: boolean): Promise<string>;
  /** Link wa.me de um número do WhatsApp conectado (null = nenhum conectado). */
  whatsappLink(accountId: string, prefill: string): Promise<string | null>;
  /** Persistência intermediária após cada bloco (evita reenvios após falhas). */
  checkpoint?(state: ExecState): Promise<void>;
}

export interface ExecState {
  currentNodeId: string | null;
  context: ExecutionContext;
  steps: ExecutionStep[];
}

export type ResumeInput =
  | { kind: "start" }
  | { kind: "delay" }
  | { kind: "retry" }
  | { kind: "input"; text?: string; payload?: string };

export type RunResult =
  | { status: "completed"; state: ExecState }
  | { status: "waiting"; waitType: "delay" | "input" | "retry"; waitUntil: Date; state: ExecState }
  | { status: "failed"; errorCode: string; errorMessage: string; state: ExecState };

const MAX_SEND_RETRIES = 3;
const INPUT_WAIT_HOURS = LIMITS.messagingWindowHours;

/** Payload dos botões de resposta: identifica execução, bloco e botão. */
export function buttonPayload(executionId: string, nodeId: string, buttonId: string): string {
  return `g1|${executionId}|${nodeId}|${buttonId}`;
}

export function parseButtonPayload(payload: string | undefined | null): { executionId: string; nodeId: string; buttonId: string } | null {
  if (!payload) return null;
  const [v, executionId, nodeId, buttonId] = payload.split("|");
  if (v !== "g1" || !executionId || !nodeId || !buttonId) return null;
  return { executionId, nodeId, buttonId };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateCapture(value: string, validation: NodeDataMap["capture"]["validation"]): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (validation) {
    case "email": {
      const email = v.toLowerCase();
      return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
    }
    case "phone": {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 15 ? digits : null;
    }
    case "number": {
      const n = Number(v.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? String(n) : null;
    }
    default:
      return v.slice(0, 1000);
  }
}

function variablesFor(rt: EngineRuntime, extra: Record<string, string>): Record<string, string> {
  const { data, hora } = formatDateParts(rt.now(), rt.timezone);
  const c = rt.contact;
  const igName = c.name ?? "";
  const nome = c.fields.nome || igName || (c.username ?? "");
  return {
    ...c.fields,
    nome,
    primeiro_nome: nome.split(/\s+/)[0] ?? "",
    nome_instagram: igName,
    username: c.username ? `@${c.username}` : "",
    telefone: c.phone ? formatPhone(c.phone) : "",
    data,
    hora,
    conta: rt.accountDisplay ?? "",
    ...extra,
  };
}

async function mainLinkVariable(flow: Flow, rt: EngineRuntime): Promise<Record<string, string>> {
  const linkNode = flow.nodes.find((n) => n.type === "link") as FlowNode<"link"> | undefined;
  if (!linkNode?.data.url) return {};
  return { link: await rt.trackedUrl(linkNode.id, undefined, linkNode.data.url, linkNode.data.track) };
}

/** Executa o fluxo a partir do estado atual. */
export async function runFlow(flow: Flow, initial: ExecState, rt: EngineRuntime, input: ResumeInput): Promise<RunResult> {
  const state: ExecState = { currentNodeId: initial.currentNodeId, context: { ...initial.context }, steps: [...initial.steps] };
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const step = (node: FlowNode, status: ExecutionStep["status"], detail?: string, messageId?: string) =>
    state.steps.push({ nodeId: node.id, type: node.type, at: rt.now().toISOString(), status, detail, messageId });

  let vars: Record<string, string> | null = null;
  const getVars = async () => (vars ??= variablesFor(rt, await mainLinkVariable(flow, rt)));
  const render = async (text: string) => renderVariables(text, await getVars());

  const send = async (node: FlowNode, content: OutboundContent): Promise<RunResult | null> => {
    const usePrivateReply = state.context.origin === "comment" && !state.context.privateReplyUsed && !!state.context.commentId;
    // Modelos aprovados do WhatsApp podem ser enviados fora da janela de 24h.
    if (!usePrivateReply && content.kind !== "template") {
      const last = rt.contact.lastInboundAt;
      if (!last || rt.now().getTime() - last.getTime() > CHANNEL_INFO[rt.channel].messagingWindowHours * 3600_000) {
        const message =
          state.context.origin === "comment"
            ? "A pessoa ainda não respondeu à resposta privada; a Meta só permite novas mensagens depois que ela responder."
            : rt.channel === "whatsapp"
              ? "Fora da janela de 24h: no WhatsApp, depois de 24h sem resposta só é possível enviar um modelo aprovado."
              : "Fora da janela de 24h: o Instagram só permite responder até 24h após a última mensagem do contato.";
        step(node, "error", message);
        return { status: "failed", errorCode: "window_closed", errorMessage: message, state };
      }
    }
    try {
      const result = await rt.send(content, { commentId: usePrivateReply ? state.context.commentId : undefined, nodeId: node.id });
      if (usePrivateReply) state.context.privateReplyUsed = true;
      state.context.retryCount = 0;
      step(node, "ok", undefined, result.messageId);
      return null;
    } catch (err) {
      if (err instanceof ChannelError) {
        const retries = state.context.retryCount ?? 0;
        if (err.retryable && retries < MAX_SEND_RETRIES) {
          state.context.retryCount = retries + 1;
          state.currentNodeId = node.id;
          step(node, "waiting", `${err.userMessage} (nova tentativa ${retries + 1}/${MAX_SEND_RETRIES})`);
          const delay = err.kind === "rate_limit" ? 60 * (retries + 1) : 10 * 2 ** retries;
          return { status: "waiting", waitType: "retry", waitUntil: new Date(rt.now().getTime() + delay * 1000), state };
        }
        step(node, "error", err.userMessage);
        return { status: "failed", errorCode: err.code, errorMessage: err.userMessage, state };
      }
      throw err;
    }
  };

  // Retomada de uma espera
  let nodeId: string | null = state.currentNodeId;
  if (input.kind === "delay" && nodeId) {
    const node = byId.get(nodeId);
    if (node) step(node, "ok", "Espera concluída");
    nodeId = nextNodeId(flow, nodeId, "out");
  } else if (input.kind === "input" && nodeId) {
    const node = byId.get(nodeId);
    if (!node) return { status: "failed", errorCode: "node_missing", errorMessage: "Bloco não encontrado no fluxo.", state };
    if (node.type === "buttons") {
      const data = node.data as NodeDataMap["buttons"];
      const parsed = parseButtonPayload(input.payload);
      const normalized = (input.text ?? "").trim().toLocaleLowerCase("pt-BR");
      const button =
        data.buttons.find((b) => parsed && b.id === parsed.buttonId && parsed.nodeId === node.id) ??
        data.buttons.find((b) => b.kind === "reply" && b.title.trim().toLocaleLowerCase("pt-BR") === normalized);
      if (!button) {
        return { status: "waiting", waitType: "input", waitUntil: new Date(rt.now().getTime() + INPUT_WAIT_HOURS * 3600_000), state };
      }
      state.context.inboundText = input.text ?? button.title;
      step(node, "ok", `Contato escolheu "${button.title}"`);
      nodeId = nextNodeId(flow, node.id, `btn:${button.id}`);
    } else if (node.type === "capture") {
      const data = node.data as NodeDataMap["capture"];
      const value = validateCapture(input.text ?? "", data.validation);
      const attempts = { ...(state.context.captureAttempts ?? {}) };
      if (value !== null) {
        await rt.setField(data.fieldKey, value);
        rt.contact.fields[data.fieldKey] = value;
        vars = null;
        step(node, "ok", `Resposta salva em "${data.fieldKey}"`);
        nodeId = nextNodeId(flow, node.id, "captured");
      } else {
        attempts[node.id] = (attempts[node.id] ?? 0) + 1;
        state.context.captureAttempts = attempts;
        if (attempts[node.id] < data.maxAttempts) {
          const failed = await send(node, { kind: "text", text: await render(data.retryMessage) });
          if (failed) return failed;
          return { status: "waiting", waitType: "input", waitUntil: new Date(rt.now().getTime() + INPUT_WAIT_HOURS * 3600_000), state };
        }
        step(node, "skipped", "Resposta inválida após as tentativas");
        nodeId = nextNodeId(flow, node.id, "failed");
      }
    } else {
      nodeId = nextNodeId(flow, node.id, "out");
    }
  }
  // "start" e "retry" executam o bloco atual.

  let executed = 0;
  while (nodeId) {
    if (++executed > LIMITS.maxStepsPerExecution) {
      return { status: "failed", errorCode: "too_many_steps", errorMessage: "O fluxo excedeu o número máximo de etapas.", state };
    }
    const node = byId.get(nodeId);
    if (!node) return { status: "failed", errorCode: "node_missing", errorMessage: "Conexão para um bloco inexistente.", state };
    state.currentNodeId = node.id;
    let next: string | null = null;

    switch (node.type) {
      case "trigger":
      case "keyword":
        next = nextNodeId(flow, node.id, "out");
        break;

      case "message": {
        const d = node.data as NodeDataMap["message"];
        const failed = await send(node, { kind: "text", text: await render(d.text) });
        if (failed) return failed;
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "image":
      case "video": {
        const d = node.data as NodeDataMap["image"];
        const failed = await send(node, { kind: node.type, url: d.url });
        if (failed) return failed;
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "link": {
        const d = node.data as NodeDataMap["link"];
        const url = await rt.trackedUrl(node.id, undefined, d.url, d.track);
        const failed = await send(node, { kind: "buttons", text: await render(d.text), buttons: [{ type: "url", title: d.buttonTitle, url }] });
        if (failed) return failed;
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "buttons": {
        const d = node.data as NodeDataMap["buttons"];
        const text = await render(d.text);
        const hasUrl = d.buttons.some((b) => b.kind === "url");
        let content: OutboundContent;
        if (hasUrl) {
          const buttons: Extract<OutboundContent, { kind: "buttons" }>["buttons"] = [];
          for (const b of d.buttons) {
            if (b.kind === "url") buttons.push({ type: "url", title: b.title, url: await rt.trackedUrl(node.id, b.id, b.url ?? "", true) });
            else buttons.push({ type: "postback", title: b.title, payload: buttonPayload(rt.executionId, node.id, b.id) });
          }
          content = { kind: "buttons", text, buttons };
        } else {
          content = {
            kind: "text",
            text,
            quickReplies: d.buttons.map((b) => ({ title: b.title, payload: buttonPayload(rt.executionId, node.id, b.id) })),
          };
        }
        const failed = await send(node, content);
        if (failed) return failed;
        if (d.buttons.some((b) => b.kind === "reply")) {
          state.steps[state.steps.length - 1].status = "waiting";
          await rt.checkpoint?.(state);
          return { status: "waiting", waitType: "input", waitUntil: new Date(rt.now().getTime() + INPUT_WAIT_HOURS * 3600_000), state };
        }
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "condition": {
        const d = node.data as NodeDataMap["condition"];
        const result = await evaluateCondition(d.logic, d.rules, {
          tagIds: rt.contact.tagIds,
          fields: rt.contact.fields,
          inboundText: state.context.inboundText ?? "",
          isFollower: rt.contact.isFollower,
          now: rt.now(),
          timezone: rt.timezone,
          hasReceivedAutomation: (id) => rt.hasReceivedAutomation(id),
        });
        step(node, "ok", result ? "Condição verdadeira" : "Condição falsa");
        next = nextNodeId(flow, node.id, result ? "true" : "false");
        break;
      }

      case "delay": {
        const d = node.data as NodeDataMap["delay"];
        const max = rt.channel === "whatsapp" ? LIMITS.maxSequenceDelaySeconds : LIMITS.maxDelaySeconds;
        const seconds = Math.min(Math.max(1, d.seconds), max);
        step(node, "waiting", `Aguardando ${formatDuration(seconds)}`);
        await rt.checkpoint?.(state);
        return { status: "waiting", waitType: "delay", waitUntil: new Date(rt.now().getTime() + seconds * 1000), state };
      }

      case "add_tag":
      case "remove_tag": {
        const d = node.data as NodeDataMap["add_tag"];
        if (node.type === "add_tag") {
          await rt.addTag(d.tagId);
          rt.contact.tagIds.add(d.tagId);
        } else {
          await rt.removeTag(d.tagId);
          rt.contact.tagIds.delete(d.tagId);
        }
        step(node, "ok");
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "capture": {
        const d = node.data as NodeDataMap["capture"];
        const failed = await send(node, { kind: "text", text: await render(d.question) });
        if (failed) return failed;
        state.steps[state.steps.length - 1].status = "waiting";
        await rt.checkpoint?.(state);
        return { status: "waiting", waitType: "input", waitUntil: new Date(rt.now().getTime() + INPUT_WAIT_HOURS * 3600_000), state };
      }

      case "whatsapp_template": {
        const d = node.data as NodeDataMap["whatsapp_template"];
        if (rt.channel !== "whatsapp") {
          step(node, "skipped", "Modelo do WhatsApp não se aplica a este canal");
          next = nextNodeId(flow, node.id, "out");
          break;
        }
        const params: string[] = [];
        for (const p of d.bodyParams) params.push(await render(p));
        let previewText = d.bodyText;
        params.forEach((value, i) => (previewText = previewText.split(`{{${i + 1}}}`).join(value)));
        const failed = await send(node, {
          kind: "template",
          name: d.templateName,
          language: d.language || "pt_BR",
          previewText: previewText || `Modelo: ${d.templateName}`,
          bodyParams: params,
          headerImageUrl: d.headerImageUrl || undefined,
        });
        if (failed) return failed;
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "whatsapp_handoff": {
        const d = node.data as NodeDataMap["whatsapp_handoff"];
        if (rt.channel === "whatsapp") {
          step(node, "skipped", "O contato já está no WhatsApp");
          next = nextNodeId(flow, node.id, "out");
          break;
        }
        const waUrl = await rt.whatsappLink(d.accountId, await render(d.prefill));
        if (!waUrl) {
          const message = "Nenhum número do WhatsApp conectado para o bloco \"Levar para o WhatsApp\". Conecte um número em Canais.";
          step(node, "error", message);
          return { status: "failed", errorCode: "invalid_config:whatsapp_missing", errorMessage: message, state };
        }
        const url = await rt.trackedUrl(node.id, undefined, waUrl, true);
        const failed = await send(node, { kind: "buttons", text: await render(d.text), buttons: [{ type: "url", title: d.buttonTitle, url }] });
        if (failed) return failed;
        next = nextNodeId(flow, node.id, "out");
        break;
      }

      case "handoff": {
        const d = node.data as NodeDataMap["handoff"];
        if (d.message?.trim()) {
          const failed = await send(node, { kind: "text", text: await render(d.message) });
          if (failed) return failed;
        }
        await rt.handoff();
        step(node, "ok", "Conversa encaminhada para atendimento humano");
        state.currentNodeId = null;
        return { status: "completed", state };
      }

      case "end":
        step(node, "ok", "Fluxo finalizado");
        state.currentNodeId = null;
        return { status: "completed", state };

      default:
        step(node, "skipped", `Bloco "${NODE_INFO[(node as FlowNode).type]?.label ?? "desconhecido"}" ignorado`);
        next = nextNodeId(flow, (node as FlowNode).id, "out");
    }

    await rt.checkpoint?.({ ...state, currentNodeId: next });
    nodeId = next;
  }

  state.currentNodeId = null;
  return { status: "completed", state };
}

/** "45s", "5 min", "2 h", "3 dias". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round((seconds / 3600) * 10) / 10} h`.replace(".", ",");
  const days = Math.round((seconds / 86400) * 10) / 10;
  return `${String(days).replace(".", ",")} ${days === 1 ? "dia" : "dias"}`;
}
