/**
 * Seleção da automação para um evento recebido.
 *
 * Ordem de decisão:
 *  1. Automações com palavra-chave correspondente vencem as "responde a tudo".
 *  2. Gatilhos específicos do evento (ex.: resposta ao Story) vêm antes dos de Direct.
 *  3. Prioridade manual (maior primeiro).
 *  4. Palavra-chave mais específica (mais palavras/caracteres, tipo exato > contém).
 *  5. Automação mais antiga.
 */
import {
  bestKeywordMatch,
  catchAllStartNode,
  collectKeywordGroups,
  getTriggerNode,
  nextNodeId,
  type Flow,
  type TriggerEvent,
} from "@gatilho/shared";

export type InboundEventKind = "dm" | "comment" | "story_reply" | "story_mention";

export interface InboundEvent {
  kind: InboundEventKind;
  text: string;
  mediaId?: string;
}

export interface CandidateAutomation {
  id: string;
  name: string;
  priority: number;
  createdAt: Date;
  triggerEvent: string;
  flow: Flow;
}

export interface AutomationMatch {
  automation: CandidateAutomation;
  /** Primeiro bloco a executar. */
  startNodeId: string;
  matchedKeyword: string | null;
  specificity: number;
  rank: number;
}

/** Quais gatilhos podem responder a cada tipo de evento, em ordem de preferência. */
const EVENT_TRIGGERS: Record<InboundEventKind, TriggerEvent[]> = {
  dm: ["dm"],
  story_reply: ["story_reply", "dm"],
  story_mention: ["story_mention"],
  comment: ["comment"],
};

export function findMatches(event: InboundEvent, automations: CandidateAutomation[]): AutomationMatch[] {
  const allowed = EVENT_TRIGGERS[event.kind];
  const matches: AutomationMatch[] = [];

  for (const automation of automations) {
    const flow = automation.flow;
    const trigger = getTriggerNode(flow);
    if (!trigger) continue;
    const triggerIndex = allowed.indexOf(trigger.data.event);
    if (triggerIndex < 0) continue;

    if (event.kind === "comment" && trigger.data.mediaIds.length > 0 && (!event.mediaId || !trigger.data.mediaIds.includes(event.mediaId))) {
      continue;
    }

    const groups = collectKeywordGroups(flow);
    let best: { nodeId: string; keyword: string; specificity: number } | null = null;
    for (const group of groups) {
      const m = bestKeywordMatch(event.text, group.rules);
      if (m && (!best || m.specificity > best.specificity)) best = { nodeId: group.nodeId, keyword: m.keyword, specificity: m.specificity };
    }

    if (best) {
      const start = nextNodeId(flow, best.nodeId, "out");
      if (!start) continue;
      matches.push({ automation, startNodeId: start, matchedKeyword: best.keyword, specificity: best.specificity, rank: triggerIndex * 2 });
      continue;
    }

    const catchAll = catchAllStartNode(flow);
    if (catchAll) {
      matches.push({ automation, startNodeId: catchAll, matchedKeyword: null, specificity: 0, rank: triggerIndex * 2 + 1 + 100 });
    }
  }

  return matches.sort((a, b) => {
    const aKeyword = a.matchedKeyword ? 0 : 1;
    const bKeyword = b.matchedKeyword ? 0 : 1;
    if (aKeyword !== bKeyword) return aKeyword - bKeyword;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.automation.priority !== b.automation.priority) return b.automation.priority - a.automation.priority;
    if (a.specificity !== b.specificity) return b.specificity - a.specificity;
    return a.automation.createdAt.getTime() - b.automation.createdAt.getTime();
  });
}
