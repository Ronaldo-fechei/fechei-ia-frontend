/**
 * Simulador ("Testar automação"): executa o mesmo motor em memória, sem
 * enviar mensagens nem alterar dados. Esperas são apenas relatadas.
 */
import { type Flow } from "@gatilho/shared";
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
  accountUsername: string | null;
  outputs: SimOutput[] = [];
  contact;

  constructor(
    readonly automationId: string | null,
    readonly timezone: string,
    accountUsername: string | null,
    contact: SimulationContactInput,
    private readonly tagNames: Map<string, string>,
    origin: ExecutionContext["origin"],
  ) {
    this.accountUsername = accountUsername;
    this.contact = {
      id: "contato-teste",
      externalId: "contato-teste",
      name: contact.name ?? "Contato de Teste",
      username: contact.username ?? "contato.teste",
      isFollower: contact.isFollower ?? null,
      // Em comentários a janela de 24h ainda não está aberta.
      lastInboundAt: origin === "comment" ? null : new Date(),
      tagIds: new Set(contact.tagIds ?? []),
      fields: { ...(contact.fields ?? {}) },
    };
  }

  now() {
    return new Date();
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
  tagName(id: string) {
    return this.tagNames.get(id) ?? id;
  }
}

export interface SimulateInput {
  automations: CandidateAutomation[];
  event: InboundEventKind;
  message: string;
  mediaId?: string;
  timezone: string;
  accountUsername: string | null;
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

  if (input.resume) {
    automation = input.automations.find((a) => a.id === input.resume!.automationId);
    if (!automation) return { matched: false, alternatives: [], outputs: [], steps: [], error: "Automação não encontrada para continuar o teste." };
    state = input.resume.state;
    resume = { kind: "input", text: input.resume.reply.text, payload: input.resume.reply.payload };
  } else {
    const matches = findMatches({ kind: input.event, text: input.message, mediaId: input.mediaId }, input.automations);
    alternatives = matches.slice(1).map((m) => ({ automationId: m.automation.id, automationName: m.automation.name, matchedKeyword: m.matchedKeyword }));
    const best = matches[0];
    if (!best) return { matched: false, alternatives: [], outputs: [], steps: [] };
    automation = best.automation;
    matchedKeyword = best.matchedKeyword;
    state = {
      currentNodeId: best.startNodeId,
      context: { origin, inboundText: input.message, ...(origin === "comment" ? { commentId: "comentario-teste" } : {}) },
      steps: [],
    };
    resume = { kind: "start" };
  }

  const rt = new SimRuntime(automation.id, input.timezone, input.accountUsername, input.contact ?? {}, tagNames, state.context.origin);
  // Ao responder, o contato abre a janela de 24h (inclusive em fluxos de comentário).
  if (input.resume) rt.contact.lastInboundAt = new Date();
  const flow: Flow = automation.flow;
  let result = await runFlow(flow, state, rt, resume);

  // Esperas de tempo são puladas na simulação (e anotadas nos passos).
  for (let i = 0; i < 20 && result.status === "waiting" && (result.waitType === "delay" || result.waitType === "retry"); i++) {
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
