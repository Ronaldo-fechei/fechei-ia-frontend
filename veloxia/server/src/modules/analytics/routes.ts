/** Dashboard e Analytics (somente dados reais registrados pelo sistema). */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client";
import {
  analyticsDaily,
  automationExecutions,
  automations,
  contacts,
  conversations,
  channelAccounts,
  links,
  messages,
} from "../../db/schema";
import { AppError, badRequest } from "../../lib/errors";
import { parse } from "../../lib/validation";
import { localDay } from "../../lib/time";
import { requireAuth } from "../../plugins/auth";
import { hasFeature } from "../billing/limits";

const METRICS = [
  "messages_in",
  "messages_out_auto",
  "messages_out_agent",
  "executions",
  "executions_failed",
  "contacts_new",
  "conversations_new",
  "link_clicks",
  "comments_in",
  "comment_dms",
] as const;
type MetricName = (typeof METRICS)[number];
type Totals = Record<MetricName, number>;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400_000) + 1;
}

export function resolveRange(range: string, tz: string, from?: string, to?: string): { from: string; to: string; days: number } {
  const today = localDay(new Date(), tz);
  if (range === "custom") {
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      throw badRequest("Período personalizado inválido.");
    }
    const days = daysBetween(from, to);
    if (days > 366) throw badRequest("O período máximo é de 1 ano.");
    return { from, to, days };
  }
  const days = range === "today" ? 1 : Number(range.replace("d", ""));
  return { from: addDays(today, -(days - 1)), to: today, days };
}

async function totals(workspaceId: string, from: string, to: string): Promise<Totals> {
  const rows = await db
    .select({ metric: analyticsDaily.metric, value: sql<number>`coalesce(sum(${analyticsDaily.value}), 0)::int` })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.workspaceId, workspaceId), eq(analyticsDaily.dimension, ""), gte(analyticsDaily.day, from), lte(analyticsDaily.day, to)))
    .groupBy(analyticsDaily.metric);
  const out = Object.fromEntries(METRICS.map((m) => [m, 0])) as Totals;
  for (const r of rows) if (r.metric in out) out[r.metric as MetricName] = r.value;
  return out;
}

async function series(workspaceId: string, from: string, to: string) {
  const rows = await db
    .select({ day: analyticsDaily.day, metric: analyticsDaily.metric, value: analyticsDaily.value })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.workspaceId, workspaceId), eq(analyticsDaily.dimension, ""), gte(analyticsDaily.day, from), lte(analyticsDaily.day, to)));
  const byDay = new Map<string, Record<string, number>>();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, Object.fromEntries(METRICS.map((m) => [m, 0])));
  for (const r of rows) {
    const entry = byDay.get(r.day);
    if (entry) entry[r.metric] = r.value;
  }
  return [...byDay.entries()].map(([day, values]) => ({ day, ...(values as Record<MetricName, number>) }));
}

async function topAutomations(workspaceId: string, from: string, to: string, limit = 5) {
  const rows = await db
    .select({
      dimension: analyticsDaily.dimension,
      metric: analyticsDaily.metric,
      value: sql<number>`sum(${analyticsDaily.value})::int`,
    })
    .from(analyticsDaily)
    .where(
      and(
        eq(analyticsDaily.workspaceId, workspaceId),
        sql`${analyticsDaily.dimension} like 'a:%'`,
        inArray(analyticsDaily.metric, ["executions", "messages_out_auto", "link_clicks", "executions_failed"]),
        gte(analyticsDaily.day, from),
        lte(analyticsDaily.day, to),
      ),
    )
    .groupBy(analyticsDaily.dimension, analyticsDaily.metric);
  type Counts = { executions: number; messages_out_auto: number; link_clicks: number; executions_failed: number };
  const map = new Map<string, Counts>();
  for (const r of rows) {
    const id = r.dimension.slice(2);
    if (!map.has(id)) map.set(id, { executions: 0, messages_out_auto: 0, link_clicks: 0, executions_failed: 0 });
    map.get(id)![r.metric as keyof Counts] = r.value;
  }
  const ids = [...map.keys()];
  if (!ids.length) return [];
  const names = await db
    .select({ id: automations.id, name: automations.name, status: automations.status, triggerEvent: automations.triggerEvent })
    .from(automations)
    .where(inArray(automations.id, ids));
  return names
    .map((a) => ({ ...a, ...map.get(a.id)! }))
    .sort((a, b) => b.executions - a.executions)
    .slice(0, limit);
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get("/dashboard", async (req) => {
    const auth = requireAuth(req);
    const ws = auth.workspace;
    const range = resolveRange("30d", ws.timezone);
    const prevRange = { from: addDays(range.from, -30), to: addDays(range.from, -1) };
    const [current, previous] = await Promise.all([totals(ws.id, range.from, range.to), totals(ws.id, prevRange.from, prevRange.to)]);
    const [activeAutomations] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(automations)
      .where(and(eq(automations.workspaceId, ws.id), eq(automations.status, "active")));
    const [totalAutomations] = await db.select({ n: sql<number>`count(*)::int` }).from(automations).where(eq(automations.workspaceId, ws.id));
    const [contactsTotal] = await db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.workspaceId, ws.id));
    const [accounts] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(channelAccounts)
      .where(and(eq(channelAccounts.workspaceId, ws.id), isNull(channelAccounts.disconnectedAt)));
    const [firstMessage] = await db.select({ id: messages.id }).from(messages).where(eq(messages.workspaceId, ws.id)).limit(1);

    const recentActivity = await db
      .select({
        id: automationExecutions.id,
        startedAt: automationExecutions.startedAt,
        status: automationExecutions.status,
        skipReason: automationExecutions.skipReason,
        automationName: automationExecutions.automationName,
        matchedKeyword: automationExecutions.matchedKeyword,
        inboundText: automationExecutions.inboundText,
        triggerEvent: automationExecutions.triggerEvent,
        contactUsername: contacts.username,
        contactName: contacts.name,
      })
      .from(automationExecutions)
      .leftJoin(contacts, eq(contacts.id, automationExecutions.contactId))
      .where(eq(automationExecutions.workspaceId, ws.id))
      .orderBy(desc(automationExecutions.startedAt))
      .limit(8);
    const latestConversations = await db
      .select({
        id: conversations.id,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        lastMessageDirection: conversations.lastMessageDirection,
        unreadCount: conversations.unreadCount,
        mode: conversations.mode,
        contactUsername: contacts.username,
        contactName: contacts.name,
        contactPic: contacts.profilePicUrl,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(eq(conversations.workspaceId, ws.id), sql`${conversations.lastMessageAt} is not null`))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(6);

    const executionsOk = current.executions - current.executions_failed;
    return {
      range,
      cards: {
        messagesIn: { value: current.messages_in, previous: previous.messages_in },
        messagesAutomated: { value: current.messages_out_auto, previous: previous.messages_out_auto },
        activeAutomations: { value: activeAutomations.n, total: totalAutomations.n },
        contactsCaptured: { value: current.contacts_new, previous: previous.contacts_new, total: contactsTotal.n },
        linkClicks: { value: current.link_clicks, previous: previous.link_clicks },
        responseRate: { value: pct(executionsOk, current.messages_in + current.comments_in), previous: pct(previous.executions - previous.executions_failed, previous.messages_in + previous.comments_in) },
        conversationsStarted: { value: current.conversations_new, previous: previous.conversations_new },
      },
      performance: (await series(ws.id, addDays(range.to, -13), range.to)).map((d) => ({
        day: d.day,
        messagesIn: d.messages_in,
        automated: d.messages_out_auto,
        executions: d.executions,
        clicks: d.link_clicks,
      })),
      topAutomations: await topAutomations(ws.id, range.from, range.to),
      recentActivity,
      latestConversations,
      onboarding: {
        instagramConnected: accounts.n > 0,
        automationCreated: totalAutomations.n > 0,
        automationActive: activeAutomations.n > 0,
        firstMessageReceived: !!firstMessage,
        completed: !!ws.onboardingCompletedAt,
      },
    };
  });

  app.get("/analytics", async (req) => {
    const auth = requireAuth(req);
    const ws = auth.workspace;
    const q = parse(
      z.object({
        range: z.enum(["today", "7d", "30d", "90d", "custom"]).default("30d"),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      req.query,
    );
    const advanced = await hasFeature(ws.id, "advanced_analytics");
    const range = resolveRange(q.range, ws.timezone, q.from, q.to);
    if (!advanced && (range.days > 30 || q.range === "custom")) {
      throw new AppError(402, "limit_reached", "Períodos acima de 30 dias e personalizados fazem parte do Analytics avançado (planos pagos).");
    }
    const prevTo = addDays(range.from, -1);
    const prevFrom = addDays(prevTo, -(range.days - 1));
    const [current, previous] = await Promise.all([totals(ws.id, range.from, range.to), totals(ws.id, prevFrom, prevTo)]);
    const [contactsTotal] = await db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(eq(contacts.workspaceId, ws.id));

    const fromTs = sql`(${range.from}::date)::timestamp at time zone ${ws.timezone}`;
    const toTs = sql`((${range.to}::date + 1)::timestamp at time zone ${ws.timezone})`;
    const topKeywords = await db
      .select({ keyword: sql<string>`lower(${automationExecutions.matchedKeyword})`, n: sql<number>`count(*)::int` })
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.workspaceId, ws.id),
          sql`${automationExecutions.matchedKeyword} is not null`,
          sql`${automationExecutions.status} <> 'skipped'`,
          sql`${automationExecutions.startedAt} >= ${fromTs}`,
          sql`${automationExecutions.startedAt} < ${toTs}`,
        ),
      )
      .groupBy(sql`lower(${automationExecutions.matchedKeyword})`)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    let byHour: { hour: number; n: number }[] | null = null;
    let byWeekday: { weekday: number; n: number }[] | null = null;
    if (advanced) {
      const hours = await db.execute(sql`
        select extract(hour from created_at at time zone ${ws.timezone})::int as hour, count(*)::int as n
        from messages where workspace_id = ${ws.id} and direction = 'inbound' and created_at >= ${fromTs} and created_at < ${toTs}
        group by 1 order by 1`);
      const map = new Map((hours.rows as { hour: number; n: number }[]).map((r) => [r.hour, r.n]));
      byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, n: map.get(hour) ?? 0 }));
      const days = await db.execute(sql`
        select extract(dow from created_at at time zone ${ws.timezone})::int as weekday, count(*)::int as n
        from messages where workspace_id = ${ws.id} and direction = 'inbound' and created_at >= ${fromTs} and created_at < ${toTs}
        group by 1 order by 1`);
      const dmap = new Map((days.rows as { weekday: number; n: number }[]).map((r) => [r.weekday, r.n]));
      byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, n: dmap.get(weekday) ?? 0 }));
    }
    const topLinks = await db
      .select({ id: links.id, title: links.title, url: links.url, clicks: sql<number>`count(lc.id)::int`, automationName: automations.name })
      .from(links)
      .leftJoin(automations, eq(automations.id, links.automationId))
      .leftJoin(sql`link_clicks lc`, sql`lc.link_id = ${links.id} and lc.clicked_at >= ${fromTs} and lc.clicked_at < ${toTs}`)
      .where(eq(links.workspaceId, ws.id))
      .groupBy(links.id, automations.name)
      .having(sql`count(lc.id) > 0`)
      .orderBy(desc(sql`count(lc.id)`))
      .limit(10);

    const peakHour = byHour && byHour.some((h) => h.n > 0) ? byHour.reduce((a, b) => (b.n > a.n ? b : a)) : null;
    const peakDay = byWeekday && byWeekday.some((d) => d.n > 0) ? byWeekday.reduce((a, b) => (b.n > a.n ? b : a)) : null;
    const top = await topAutomations(ws.id, range.from, range.to, 10);

    return {
      range,
      advanced,
      totals: { ...current, contactsTotal: contactsTotal.n },
      previous,
      rates: {
        responseRate: pct(current.executions - current.executions_failed, current.messages_in + current.comments_in),
        interactionRate: pct(current.link_clicks, current.messages_out_auto),
        failureRate: pct(current.executions_failed, current.executions),
      },
      series: await series(ws.id, range.from, range.to),
      topAutomations: top,
      topKeywords,
      topLinks,
      byHour,
      byWeekday,
      peakHour,
      peakDay,
    };
  });
}
