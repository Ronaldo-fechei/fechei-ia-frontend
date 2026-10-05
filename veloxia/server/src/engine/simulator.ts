/**
 * Simulador ("Testar automação"): executa o mesmo motor em memória, sem
 * enviar mensagens nem alterar dados. Esperas são apenas relatadas.
 */
import { flowChannels, formatPhone, phoneDigits, type Channel, type Flow } from "@veloxia/shared";
import type { ExecutionContext, ExecutionStep } from "../db/schema";
import type { OutboundContent } from "./channel";
import { findMatches, type CandidateAutomation, type InboundEventKind } from "./matching";
import { runFlow, type EngineRuntime, type ExecState, type ResumeInput } from "./runner";

export interface SimOutput {
  nodeId: string;
  content: OutboundContent;
  privateReply: boolean;
}

export interface SimulationResult {
  matched: boolean;
  automationId?: string;
  automationName?: string;
  matchedKeyword?: string | null;
  alternatives: { automationId: string; automationName: string; matchedKeyword: string | null }[];
  outputs: SimOutput[];
  steps: ExecutionStep[];
  status?: "completed" | "waiting" | "failed";
  waiting?: { nodeId: string; type: "buttons" | "capture"; options: string[]; question?: string };
  error?: string;
  /** Estado para continuar a simulação após uma resposta. */
  state?: ExecState;
}

export interface SimulationContactInput {
  name?: string;
  username?: string;
  tagIds?: string[];
  fields?: Record<string, string>;
  isFollower?: boolean | null;
}

class SimRuntime implements EngineRuntime {
  executionId = "simulacao";
  accountDisplay: string | null;
  outputs: SimOutput[] = [];
  contact;
  /** Relógio virtual: esperas avançam o tempo (para simular a janela de 24h). */
  offsetMs = 0;

  constructor(
    readonly automationId: string | null,
    readonly timezone: string,
    readonly channel: Channel,
    accountDisplay: string | null,
    contact: SimulationContactInput,
    private readonly tagNames: Map<string, string>,
    origin: ExecutionContext["origin"],
    private readonly whatsappNumber: string | null,
  ) {
    this.accountDisplay = accountDisplay;
    this.contact = {
      id: "contato-teste",
      externalId: "contato-teste",
      name: contact.name ?? "Contato de Teste",
      username: channel === "instagram" ? (contact.username ?? "contato.teste") : null,
      phone: channel === "whatsapp" ? "5511988887777" : null,
      isFollower: contact.isFollower ?? null,
      // Em comentários a janela de 24h ainda não está aberta.
      lastInboundAt: origin === "comment" ? null : new Date(),
      tagIds: new Set(contact.tagIds ?? []),
      fields: { ...(contact.fields ?? {}) },
    };
  }

  now() {
    return new Date(Date.now() + this.offsetMs);
  }

  async send(content: OutboundContent, opts: { commentId?: string; nodeId: string }) {
    this.outputs.push({ nodeId: opts.nodeId, content, privateReply: !!opts.commentId });
    return { messageId: `sim-${this.outputs.length}` };
  }
  async addTag() {}
  async removeTag() {}
  async setField() {}
  async hasReceivedAutomation() {
    return false;
  }
  async handoff() {}
  async trackedUrl(_n: string, _b: string | undefined, url: string) {
    return url;
  }
  async whatsappLink(_accountId: string, prefill: string) {
    if (!this.whatsappNumber) return null;
    return `https://wa.me/${phoneDigits(this.whatsappNumber)}${prefill.trim() ? `?text=${encodeURIComponent(prefill.trim())}` : ""}`;
  }
  tagName(id: string) {
    return this.tagNames.get(id) ?? id;
  }
}

export interface SimulateInput {
  automations: CandidateAutomation[];
  event: InboundEventKind;
  /** Canal simulado (padrão: Instagram). */
  channel?: Channel;
  message: string;
  mediaId?: string;
  timezone: string;
  /** {{conta}} — "@loja" no Instagram ou o nome/número no WhatsApp. */
  accountDisplay: string | null;
  /** Número do WhatsApp conectado (para o bloco "Levar para o WhatsApp"). */
  whatsappNumber?: string | null;
  contact?: SimulationContactInput;
  tagNames?: Map<string, string>;
  /** Continuação: automação, estado salvo e resposta do contato. */
  resume?: { automationId: string; state: ExecState; reply: { text?: string; payload?: string } };
}

export async function simulate(input: SimulateInput): Promise<SimulationResult> {
  const tagNames = input.tagNames ?? new Map();
  let automation: CandidateAutomation | undefined;
  let state: ExecState;
  let resume: ResumeInput;
  let matchedKeyword: string | null = null;
  let alternatives: SimulationResult["alternatives"] = [];
  const origin: ExecutionContext["origin"] = input.event;
  const channel: Channel = input.channel ?? "instagram";
  const candidates = input.automations.filter((a) => flowChannels(a.flow).includes(channel));

  if (input.resume) {
    automation = candidates.find((a) => a.id === input.resume!.automationId);
    if (!automation) return { matched: false, alternatives: [], outputs: [], steps: [], error: "Automação não encontrada para continuar o teste." };
    state = input.resume.state;
    resume = { kind: "input", text: input.resume.reply.text, payload: input.resume.reply.payload };
  } else {
    const matches = findMatches({ kind: input.event, text: input.message, mediaId: input.mediaId }, candidates);
    alternatives = matches.slice(1).map((m) => ({ automationId: m.automation.id, automationName: m.automation.name, matchedKeyword: m.matchedKeyword }));
    const best = matches[0];
    if (!best) return { matched: false, alternatives: [], outputs: [], steps: [] };
    automation = best.automation;
    matchedKeyword = best.matchedKeyword;
    state = {
      currentNodeId: best.startNodeId,
      context: { origin, channel, inboundText: input.message, ...(origin === "comment" ? { commentId: "comentario-teste" } : {}) },
      steps: [],
    };
    resume = { kind: "start" };
  }

  const accountDisplay = input.accountDisplay ?? (channel === "whatsapp" ? formatPhone("5511999990000") : "@sua_conta");
  const rt = new SimRuntime(
    automation.id,
    input.timezone,
    channel,
    accountDisplay,
    input.contact ?? {},
    tagNames,
    state.context.origin,
    input.whatsappNumber ?? null,
  );
  // Ao responder, o contato abre a janela de 24h (inclusive em fluxos de comentário).
  if (input.resume) rt.contact.lastInboundAt = new Date();
  const flow: Flow = automation.flow;
  let result = await runFlow(flow, state, rt, resume);

  // Esperas de tempo são puladas na simulação (e anotadas nos passos).
  for (let i = 0; i < 20 && result.status === "waiting" && (result.waitType === "delay" || result.waitType === "retry"); i++) {
    if (result.waitType === "delay") rt.offsetMs += Math.max(0, result.waitUntil.getTime() - rt.now().getTime());
    result = await runFlow(flow, result.state, rt, { kind: result.waitType });
  }

  const steps = result.state.steps.map((s) => {
    const node = flow.nodes.find((n) => n.id === s.nodeId);
    if ((s.type === "add_tag" || s.type === "remove_tag") && node) {
      const tagId = (node.data as { tagId?: string }).tagId ?? "";
      return { ...s, detail: `${s.type === "add_tag" ? "Adicionaria" : "Removeria"} a tag "${rt.tagName(tagId)}"` };
    }
    if (s.type === "delay" && s.status === "waiting") return { ...s, status: "ok" as const, detail: s.detail?.replace("Aguardando", "Aguardaria") };
    return s;
  });

  const out: SimulationResult = {
    matched: true,
    automationId: automation.id,
    automationName: automation.name,
    matchedKeyword,
    alternatives,
    outputs: rt.outputs,
    steps,
    status: result.status,
    state: result.status === "waiting" ? result.state : undefined,
  };
  if (result.status === "failed") out.error = result.errorMessage;
  if (result.status === "waiting" && result.waitType === "input" && result.state.currentNodeId) {
    const node = flow.nodes.find((n) => n.id === result.state.currentNodeId);
    if (node?.type === "buttons") {
      const data = node.data as { buttons: { kind: string; title: string }[] };
      out.waiting = { nodeId: node.id, type: "buttons", options: data.buttons.filter((b) => b.kind === "reply").map((b) => b.title) };
    } else if (node?.type === "capture") {
      out.waiting = { nodeId: node.id, type: "capture", options: [], question: (node.data as { question: string }).question };
    }
  }
  return out;
}
