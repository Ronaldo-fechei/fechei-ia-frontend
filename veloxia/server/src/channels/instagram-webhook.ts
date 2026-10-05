/** Tradução dos webhooks do Instagram (mensagens, postbacks e comentários) para o pipeline comum. */
import { and, eq, getTableColumns, isNull, or } from "drizzle-orm";
import { getTriggerNode } from "@veloxia/shared";
import { db } from "../db/client";
import { channelAccounts, commentEvents, messages } from "../db/schema";
import { track } from "../services/analytics";
import { publishEvent } from "../services/events";
import { createExecution, handleInboundMessage, loadActiveAutomations, recordEcho, upsertContact, upsertConversation, type InboundMessage } from "../engine/inbound";
import { findMatches } from "../engine/matching";
import { isInCurrentMonth } from "../modules/billing/limits";
import type { ChannelAccount } from "./types";

interface IgAttachment {
  type?: string;
  payload?: { url?: string; title?: string; reel_video_id?: string };
}

interface IgMessage {
  mid?: string;
  text?: string;
  attachments?: IgAttachment[];
  quick_reply?: { payload?: string };
  reply_to?: { mid?: string; story?: { id?: string; url?: string } };
  is_echo?: boolean;
  is_deleted?: boolean;
  is_unsupported?: boolean;
  referral?: Record<string, unknown>;
}

interface IgMessagingItem {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: IgMessage;
  postback?: { mid?: string; title?: string; payload?: string };
  read?: unknown;
  reaction?: unknown;
  referral?: Record<string, unknown>;
}

interface IgCommentValue {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
}

export async function findInstagramAccount(igId: string): Promise<ChannelAccount | null> {
  if (!igId) return null;
  const [account] = await db
    .select(getTableColumns(channelAccounts))
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channel, "instagram"),
        or(eq(channelAccounts.externalId, igId), eq(channelAccounts.scopedId, igId)),
        isNull(channelAccounts.disconnectedAt),
      ),
    )
    .limit(1);
  return account ?? null;
}

/** Processa uma "entry" do webhook do Instagram. Retorna false se a conta não está conectada. */
export async function handleInstagramEntry(entry: { id?: string; messaging?: unknown[]; changes?: unknown[] }): Promise<boolean> {
  const account = await findInstagramAccount(String(entry?.id ?? ""));
  if (!account) return false;
  await db.update(channelAccounts).set({ lastWebhookAt: new Date() }).where(eq(channelAccounts.id, account.id));
  for (const item of (entry.messaging ?? []) as IgMessagingItem[]) await handleMessaging(account, item);
  for (const change of (entry.changes ?? []) as { field?: string; value?: IgCommentValue }[]) {
    if ((change.field === "comments" || change.field === "live_comments") && change.value) await handleComment(account, change.value);
  }
  return true;
}

function parseInbound(item: IgMessagingItem): InboundMessage | null {
  if (item.postback) {
    return {
      externalId: item.postback.mid ?? null,
      type: "postback",
      text: item.postback.title ?? "",
      payload: { postback: item.postback },
      event: "dm",
      buttonPayload: item.postback.payload,
      source: "postback",
    };
  }
  const m = item.message;
  if (!m) return null;
  const attachments = m.attachments ?? [];
  const first = attachments[0];
  const payload: Record<string, unknown> = {};
  if (attachments.length) payload.attachments = attachments;
  if (m.reply_to) payload.replyTo = m.reply_to;
  if (m.referral) payload.referral = m.referral;

  if (first?.type === "story_mention") {
    return { externalId: m.mid ?? null, type: "story_mention", text: m.text ?? "", payload, event: "story_mention", source: "story_mention" };
  }
  if (m.reply_to?.story) {
    return { externalId: m.mid ?? null, type: "story_reply", text: m.text ?? "", payload, event: "story_reply", source: "story_reply" };
  }
  if (m.quick_reply?.payload) {
    return {
      externalId: m.mid ?? null,
      type: "quick_reply",
      text: m.text ?? "",
      payload: { ...payload, quickReply: m.quick_reply },
      event: "dm",
      buttonPayload: m.quick_reply.payload,
      source: "dm",
    };
  }
  if (m.is_unsupported) return { externalId: m.mid ?? null, type: "unsupported", text: "", payload, event: "dm", source: "dm" };
  const type = m.text ? "text" : first?.type ?? "text";
  return {
    externalId: m.mid ?? null,
    type,
    text: m.text ?? "",
    payload: Object.keys(payload).length ? payload : null,
    event: "dm",
    source: m.referral ? "referral" : "dm",
  };
}

async function handleMessaging(account: ChannelAccount, item: IgMessagingItem): Promise<void> {
  const msg = item.message;
  if (!msg && !item.postback) return; // leitura, reação, referral isolado: sem ação

  const isEcho = !!msg?.is_echo || item.sender?.id === account.externalId || item.sender?.id === account.scopedId;
  const igsid = isEcho ? item.recipient?.id : item.sender?.id;
  if (!igsid) return;
  const at = item.timestamp ? new Date(item.timestamp) : new Date();

  if (msg?.is_deleted) {
    if (msg.mid) {
      await db
        .update(messages)
        .set({ status: "deleted", text: null, payload: null })
        .where(and(eq(messages.channelAccountId, account.id), eq(messages.externalId, msg.mid)));
      await publishEvent({ workspaceId: account.workspaceId, type: "message.updated" });
    }
    return;
  }

  const parsed = parseInbound(item);
  if (!parsed) return;

  await db.transaction(async (tx) => {
    if (isEcho) await recordEcho(tx, account, { externalId: igsid }, parsed, at);
    else await handleInboundMessage(tx, account, { externalId: igsid }, parsed, at);
  });
}

/* ------------------------------------------------------------------ */
/* Comentários → Direct                                                 */
/* ------------------------------------------------------------------ */

async function handleComment(account: ChannelAccount, value: IgCommentValue): Promise<void> {
  const commentId = value.id;
  const fromId = value.from?.id;
  if (!commentId || !fromId) return;
  // Ignora comentários da própria conta (inclui nossas respostas públicas).
  if (fromId === account.externalId || fromId === account.scopedId || value.from?.username === account.handle) return;

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(commentEvents)
      .values({
        workspaceId: account.workspaceId,
        channelAccountId: account.id,
        commentId,
        mediaId: value.media?.id,
        mediaProductType: value.media?.media_product_type,
        parentId: value.parent_id,
        fromId,
        fromUsername: value.from?.username,
        text: value.text ?? "",
      })
      .onConflictDoNothing()
      .returning({ id: commentEvents.id });
    if (!inserted.length) return; // duplicado

    await track(account.workspaceId, "comments_in", {}, tx);

    const candidates = (await loadActiveAutomations(tx, account)).filter((c) => getTriggerNode(c.flow)?.data.event === "comment");
    const match = findMatches({ kind: "comment", text: value.text ?? "", mediaId: value.media?.id }, candidates)[0];
    if (!match) return;

    const { contact, created } = await upsertContact(
      tx,
      account,
      { externalId: fromId, username: value.from?.username ?? null },
      { inbound: false, at: new Date(), source: "comment" },
    );
    if (created) await track(account.workspaceId, "contacts_new", {}, tx);
    const { conversation, created: convCreated } = await upsertConversation(tx, account, contact);
    if (convCreated) await track(account.workspaceId, "conversations_new", {}, tx);

    const executionId = await createExecution(tx, {
      account,
      contact,
      contactCreated: created,
      // Quem comenta pela primeira vez no mês passa a contar como contato ativo.
      newActiveContact: !(await isInCurrentMonth(account.workspaceId, contact.lastInboundAt, tx)),
      conversation,
      match,
      triggerEvent: "comment",
      inboundText: value.text ?? "",
      triggerCommentId: commentId,
      context: { origin: "comment", channel: "instagram", commentId, inboundText: value.text ?? "", mediaId: value.media?.id },
    });

    await tx
      .update(commentEvents)
      .set({
        contactId: contact.id,
        automationId: match.automation.id,
        executionId,
        matchedKeyword: match.matchedKeyword,
        privateReplyStatus: executionId ? "none" : "skipped",
      })
      .where(eq(commentEvents.id, inserted[0].id));
    await publishEvent({ workspaceId: account.workspaceId, type: "execution.updated" }, tx);
  });
}
