import { matchKeyword, type ConditionRule } from "@gatilho/shared";
import { localClock } from "../lib/time";

export interface ConditionContext {
  tagIds: Set<string>;
  fields: Record<string, string>;
  inboundText: string;
  isFollower: boolean | null;
  now: Date;
  timezone: string;
  hasReceivedAutomation: (automationId: string) => Promise<boolean>;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export async function evaluateRule(rule: ConditionRule, ctx: ConditionContext): Promise<boolean> {
  switch (rule.type) {
    case "has_tag":
      return ctx.tagIds.has(rule.tagId);
    case "not_has_tag":
      return !ctx.tagIds.has(rule.tagId);
    case "received_automation":
      return ctx.hasReceivedAutomation(rule.automationId);
    case "not_received_automation":
      return !(await ctx.hasReceivedAutomation(rule.automationId));
    case "message_contains":
      return !!matchKeyword(ctx.inboundText, { text: rule.text, matchType: "contains_word", ignoreAccents: true });
    case "time_between": {
      const { minutes } = localClock(ctx.now, ctx.timezone);
      const start = toMinutes(rule.start);
      const end = toMinutes(rule.end);
      // Suporta intervalos que atravessam a meia-noite (ex.: 22:00–06:00).
      return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
    }
    case "weekday":
      return rule.days.includes(localClock(ctx.now, ctx.timezone).weekday);
    case "field": {
      const value = (ctx.fields[rule.fieldKey] ?? "").trim();
      const expected = (rule.value ?? "").trim().toLocaleLowerCase("pt-BR");
      switch (rule.operator) {
        case "is_set":
          return value !== "";
        case "is_not_set":
          return value === "";
        case "equals":
          return value.toLocaleLowerCase("pt-BR") === expected;
        case "not_equals":
          return value.toLocaleLowerCase("pt-BR") !== expected;
        case "contains":
          return expected !== "" && value.toLocaleLowerCase("pt-BR").includes(expected);
      }
      return false;
    }
    case "is_follower":
      return ctx.isFollower === true;
    case "not_follower":
      return ctx.isFollower === false;
  }
}

export async function evaluateCondition(logic: "all" | "any", rules: ConditionRule[], ctx: ConditionContext): Promise<boolean> {
  if (rules.length === 0) return false;
  for (const rule of rules) {
    const ok = await evaluateRule(rule, ctx);
    if (logic === "any" && ok) return true;
    if (logic === "all" && !ok) return false;
  }
  return logic === "all";
}
