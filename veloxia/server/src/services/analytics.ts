/**
 * Contadores diários (pré-agregados) para dashboard e analytics.
 * Cada evento incrementa o total do dia (dimension "") e, quando houver,
 * o total por automação (dimension "a:<id>").
 */
import { sql } from "drizzle-orm";
import type { Channel, WhatsAppPricingCategory } from "@veloxia/shared";
import { db, type DbOrTx } from "../db/client";
import { analyticsDaily, workspaces } from "../db/schema";
import { DEFAULT_TZ, localDay } from "../lib/time";
import { eq } from "drizzle-orm";

export type Metric =
  | "messages_in"
  | "messages_out_auto"
  | "messages_out_agent"
  | "executions"
  | "executions_failed"
  | "contacts_new"
  | "conversations_new"
  | "link_clicks"
  | "comments_in"
  | "comment_dms"
  /** Por canal (ex.: messages_in_whatsapp). */
  | `messages_in_${Channel}`
  | `messages_out_auto_${Channel}`
  /** WhatsApp: mensagens cobradas pela Meta por categoria (estimativa de consumo). */
  | `wa_billable_${WhatsAppPricingCategory}`;

const tzCache = new Map<string, { tz: string; at: number }>();

export async function workspaceTimezone(workspaceId: string, tx: DbOrTx = db): Promise<string> {
  const cached = tzCache.get(workspaceId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.tz;
  const rows = await tx.select({ tz: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const tz = rows[0]?.tz ?? DEFAULT_TZ;
  tzCache.set(workspaceId, { tz, at: Date.now() });
  return tz;
}

export function invalidateTimezone(workspaceId: string): void {
  tzCache.delete(workspaceId);
}

export async function track(
  workspaceId: string,
  metric: Metric,
  opts: { automationId?: string | null; value?: number; at?: Date; /** Dimensão extra (ex.: "c:<contaId>"). */ dimension?: string } = {},
  tx: DbOrTx = db,
): Promise<void> {
  const tz = await workspaceTimezone(workspaceId, tx);
  const day = localDay(opts.at ?? new Date(), tz);
  const value = opts.value ?? 1;
  const dims = [""];
  if (opts.automationId) dims.push(`a:${opts.automationId}`);
  if (opts.dimension) dims.push(opts.dimension);
  for (const dimension of dims) {
    await tx
      .insert(analyticsDaily)
      .values({ workspaceId, day, metric, dimension, value })
      .onConflictDoUpdate({
        target: [analyticsDaily.workspaceId, analyticsDaily.day, analyticsDaily.metric, analyticsDaily.dimension],
        set: { value: sql`${analyticsDaily.value} + ${value}` },
      });
  }
}
