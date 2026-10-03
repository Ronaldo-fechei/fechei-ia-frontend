/**
 * Execução de fluxos em produção: carrega a execução, monta o runtime com
 * banco de dados + canal do Instagram, roda o interpretador e persiste o
 * resultado (agendando esperas e novas tentativas na fila).
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getTriggerNode, parseFlow, renderVariables, type Flow } from "@gatilho/shared";
import { env } from "../config/env";
import { db } from "../db/client";
import {
  automationExecutions,
  automations,
  commentEvents,
  contactTags,
  contacts,
  conversations,
  customFields,
  customFieldValues,
  instagramAccounts,
  links,
  messages,
  tags,
  type ExecutionContext,
} from "../db/schema";
import { hmac, shortCode } from "../lib/crypto";
import { logger } from "../lib/logger";
import { GraphApiError } from "../integrations/instagram/client";
import { InstagramChannel, toChannelError } from "../integrations/instagram/adapter";
import { clientFor, handleAccountGraphError } from "../modules/instagram/service";
import { incrementUsage, USAGE_METRICS } from "../modules/billing/limits";
import { track, workspaceTimezone } from "../services/analytics";
import { publishEvent } from "../services/events";
import { notify } from "../services/notifications";
import { recordSystemError } from "../services/audit";
import { enqueue, RetryLaterError } from "../queue/queue";
import { ChannelError, contentPreview, type ChannelAdapter, type OutboundContent } from "./channel";
import { runFlow, type EngineRuntime, type ExecState, type ResumeInput, type RunResult, type RuntimeContact } from "./runner";

type Execution = typeof automationExecutions.$inferSelect;
type Account = typeof instagramAccounts.$inferSelect;

export interface RunExecutionPayload {
  executionId: string;
  resume: ResumeInput & { nodeId?: string };
}

/* ------------------------------------------------------------------ */
/* Links rastreados                                                    */
/* ------------------------------------------------------------------ */

export async function ensureTrackedLink(workspaceId: string, automationId: string, nodeId: string, buttonId: string | undefined, url: string, title = ""): Promise<string> {
  const result = await db.execute(sql`
    insert into links (workspace_id, automation_id, node_id, button_id, code, url, title)
    values (${workspaceId}, ${automationId}, ${nodeId}, ${buttonId ?? null}, ${shortCode(8)}, ${url}, ${title})
    on conflict (automation_id, node_id, coalesce(button_id, '')) do update set url = excluded.url, title = excluded.title, updated_at = now()
    returning code
  `);
  return (result.rows[0] as { code: string }).code;
}

export function trackedLinkUrl(code: string, executionId?: string): string {
  if (!executionId) return `${env.APP_URL}/r/${code}`;
  const sig = hmac(`${code}.${executionId}`).slice(0, 12);
  return `${env.APP_URL}/r/${code}?e=${executionId}.${sig}`;
}

export function verifyTrackedParam(code: string, param: string | undefined): string | null {
  if (!param) return null;
  const [executionId, sig] = param.split(".");
  if (!executionId || !sig) return null;
  return hmac(`${code}.${executionId}`).slice(0, 12) === sig ? executionId : null;
}

/* ------------------------------------------------------------------ */
/* Runtime de produção                                                 */
/* ------------------------------------------------------------------ */

async function loadContactRuntime(contactId: string, workspaceId: string): Promise<{ contact: typeof contacts.$inferSelect; rt: RuntimeContact }> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact) throw new Error("Contato não encontrado");
  const tagRows = await db.select({ tagId: contactTags.tagId }).from(contactTags).where(eq(contactTags.contactId, contactId));
  const fieldRows = await db
    .select({ key: customFields.key, value: customFieldValues.value })
    .from(customFieldValues)
    .innerJoin(customFields, eq(customFields.id, customFieldValues.fieldId))
    .where(and(eq(customFieldValues.contactId, contactId), eq(customFields.workspaceId, workspaceId)));
  return {
    contact,
    rt: {
      id: contact.id,
      externalId: contact.igsid,
      name: contact.name,
      username: contact.username,
      isFollower: contact.isFollower,
      lastInboundAt: contact.lastInboundAt,
      tagIds: new Set(tagRows.map((t) => t.tagId)),
      fields: Object.fromEntries(fieldRows.map((f) => [f.key, f.value])),
    },
  };
}

class DbRuntime implements EngineRuntime {
  executionId: string;
  automationId: string | null;
  timezone: string;
  accountUsername: string | null;

  constructor(
    private readonly execution: Execution,
    private readonly account: Account,
    public contact: RuntimeContact,
    private readonly channel: ChannelAdapter,
    timezone: string,
  ) {
    this.executionId = execution.id;
    this.automationId = execution.automationId;
    this.timezone = timezone;
    this.accountUsername = account.username;
  }

  now(): Date {
    return new Date();
  }

  async send(content: OutboundContent, opts: { commentId?: string; nodeId: string }) {
    const ex = this.execution;
    const [row] = await db
      .insert(messages)
      .values({
        workspaceId: ex.workspaceId,
        conversationId: ex.conversationId!,
        contactId: this.contact.id,
        instagramAccountId: this.account.id,
        direction: "outbound",
        source: "automation",
        type: content.kind === "buttons" ? "template" : content.kind,
        text: contentPreview(content),
        payload: { content, nodeId: opts.nodeId, ...(opts.commentId ? { privateReplyTo: opts.commentId } : {}) },
        status: "sending",
        executionId: ex.id,
      })
      .returning({ id: messages.id });

    try {
      const outcome = await this.channel.send({ contactExternalId: this.contact.externalId, commentId: opts.commentId }, content);
      if (outcome.externalMessageId) {
        // Se o eco do webhook chegou antes, remove a cópia e mantém o registro da automação.
        await db
          .delete(messages)
          .where(
            and(
              eq(messages.instagramAccountId, this.account.id),
              eq(messages.externalId, outcome.externalMessageId),
              ne(messages.id, row.id),
              eq(messages.source, "instagram_app"),
            ),
          );
      }
      const sentAt = new Date();
      await db.update(messages).set({ status: "sent", externalId: outcome.externalMessageId ?? null, sentAt }).where(eq(messages.id, row.id));
      await db
        .update(conversations)
        .set({ lastMessageAt: sentAt, lastMessagePreview: contentPreview(content).slice(0, 200), lastMessageDirection: "outbound", updatedAt: sentAt })
        .where(eq(conversations.id, ex.conversationId!));
      await db.update(contacts).set({ lastInteractionAt: sentAt, updatedAt: sentAt }).where(eq(contacts.id, this.contact.id));
      await incrementUsage(ex.workspaceId, USAGE_METRICS.messages);
      await track(ex.workspaceId, "messages_out_auto", { automationId: ex.automationId });

      if (opts.commentId) {
        await db.update(commentEvents).set({ privateReplyStatus: "sent", privateReplyAt: sentAt }).where(eq(commentEvents.commentId, opts.commentId));
        await track(ex.workspaceId, "comment_dms", { automationId: ex.automationId });
        await this.adoptRecipientId(outcome.recipientExternalId);
      }
      await publishEvent({ workspaceId: ex.workspaceId, type: "message.created", ids: { conversationId: ex.conversationId! } });
      return { ...outcome, messageId: row.id };
    } catch (err) {
      const channelErr = toChannelError(err);
      await db
        .update(messages)
        .set({ status: "failed", errorCode: channelErr.code, errorMessage: channelErr.userMessage })
        .where(eq(messages.id, row.id));
      if (opts.commentId && !channelErr.retryable) {
        await db.update(commentEvents).set({ privateReplyStatus: "failed" }).where(eq(commentEvents.commentId, opts.commentId));
      }
      if (channelErr.cause instanceof GraphApiError) await handleAccountGraphError(this.account, channelErr.cause);
      await publishEvent({ workspaceId: ex.workspaceId, type: "message.updated", ids: { conversationId: ex.conversationId! } });
      throw channelErr;
    }
  }

  /** Resposta privada: a API devolve o IGSID real do comentarista. */
  private async adoptRecipientId(recipientId: string | undefined): Promise<void> {
    if (!recipientId || recipientId === this.contact.externalId) return;
    const [clash] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.instagramAccountId, this.account.id), eq(contacts.igsid, recipientId)))
      .limit(1);
    if (clash) return;
    await db.update(contacts).set({ igsid: recipientId, updatedAt: new Date() }).where(eq(contacts.id, this.contact.id));
    this.contact.externalId = recipientId;
  }

  async addTag(tagId: string): Promise<void> {
    const [tag] = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.id, tagId), eq(tags.workspaceId, this.execution.workspaceId))).limit(1);
    if (!tag) return;
    await db
      .insert(contactTags)
      .values({ contactId: this.contact.id, tagId, workspaceId: this.execution.workspaceId, addedBy: "automation" })
      .onConflictDoNothing();
    await publishEvent({ workspaceId: this.execution.workspaceId, type: "contact.updated", ids: { contactId: this.contact.id } });
  }

  async removeTag(tagId: string): Promise<void> {
    await db.delete(contactTags).where(and(eq(contactTags.contactId, this.contact.id), eq(contactTags.tagId, tagId)));
    await publishEvent({ workspaceId: this.execution.workspaceId, type: "contact.updated", ids: { contactId: this.contact.id } });
  }

  async setField(fieldKey: string, value: string): Promise<void> {
    const [field] = await db
      .select({ id: customFields.id })
      .from(customFields)
      .where(and(eq(customFields.workspaceId, this.execution.workspaceId), eq(customFields.key, fieldKey)))
      .limit(1);
    if (!field) return;
    await db
      .insert(customFieldValues)
      .values({ contactId: this.contact.id, fieldId: field.id, workspaceId: this.execution.workspaceId, value })
      .onConflictDoUpdate({ target: [customFieldValues.contactId, customFieldValues.fieldId], set: { value, updatedAt: new Date() } });
    await publishEvent({ workspaceId: this.execution.workspaceId, type: "contact.updated", ids: { contactId: this.contact.id } });
  }

  async hasReceivedAutomation(automationId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: automationExecutions.id })
      .from(automationExecutions)
      .where(
        and(
          eq(automationExecutions.automationId, automationId),
          eq(automationExecutions.contactId, this.contact.id),
          inArray(automationExecutions.status, ["completed", "waiting", "running"]),
          ne(automationExecutions.id, this.executionId),
        ),
      )
      .limit(1);
    return !!row;
  }

  async handoff(): Promise<void> {
    const ex = this.execution;
    await db
      .update(conversations)
      .set({ mode: "human", humanSince: new Date(), status: "open", updatedAt: new Date() })
      .where(eq(conversations.id, ex.conversationId!));
    await notify({
      workspaceId: ex.workspaceId,
      type: "handoff_requested",
      severity: "info",
      title: `${this.contact.username ? "@" + this.contact.username : "Um contato"} pediu atendimento humano`,
      body: `Encaminhado pela automação "${ex.automationName}". As automações estão pausadas para este contato.`,
      linkUrl: `/app/conversas/${ex.conversationId}`,
    });
    await publishEvent({ workspaceId: ex.workspaceId, type: "conversation.updated", ids: { conversationId: ex.conversationId! } });
  }

  async trackedUrl(nodeId: string, buttonId: string | undefined, url: string, track: boolean): Promise<string> {
    if (!track || !this.execution.automationId || !/^https?:\/\//i.test(url)) return url;
    const code = await ensureTrackedLink(this.execution.workspaceId, this.execution.automationId, nodeId, buttonId, url);
    return trackedLinkUrl(code, this.executionId);
  }

  async checkpoint(state: ExecState): Promise<void> {
    await db
      .update(automationExecutions)
      .set({ currentNodeId: state.currentNodeId, context: state.context, steps: state.steps, updatedAt: new Date() })
      .where(eq(automationExecutions.id, this.executionId));
  }
}

/* ------------------------------------------------------------------ */
/* Job: execution.run                                                  */
/* ------------------------------------------------------------------ */

async function claim(executionId: string): Promise<Execution | null> {
  const [row] = await db
    .update(automationExecutions)
    .set({ lockedUntil: sql`now() + interval '3 minutes'` })
    .where(
      and(
        eq(automationExecutions.id, executionId),
        inArray(automationExecutions.status, ["running", "waiting"]),
        or(isNull(automationExecutions.lockedUntil), sql`${automationExecutions.lockedUntil} < now()`),
      ),
    )
    .returning();
  return row ?? null;
}

async function finish(executionId: string, values: Partial<typeof automationExecutions.$inferInsert>): Promise<void> {
  await db
    .update(automationExecutions)
    .set({ ...values, lockedUntil: null, updatedAt: new Date() })
    .where(eq(automationExecutions.id, executionId));
}

export async function runExecutionJob(payload: RunExecutionPayload): Promise<void> {
  const ex = await claim(payload.executionId);
  if (!ex) {
    const [current] = await db
      .select({ status: automationExecutions.status })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, payload.executionId))
      .limit(1);
    if (!current || !["running", "waiting"].includes(current.status)) return; // já finalizada/cancelada
    throw new RetryLaterError("Execução em andamento em outro worker", 3);
  }

  const resume = payload.resume ?? { kind: "start" };
  try {
    // Ignora jobs antigos que não correspondem mais ao estado da execução.
    if (resume.kind === "start" && ex.status !== "running") return finish(ex.id, {});
    if ((resume.kind === "delay" || resume.kind === "retry") && (ex.status !== "waiting" || ex.waitType !== resume.kind || ex.currentNodeId !== resume.nodeId)) {
      return finish(ex.id, {});
    }
    if (resume.kind === "input" && (ex.status !== "waiting" || ex.waitType !== "input")) return finish(ex.id, {});

    const [account] = ex.instagramAccountId
      ? await db.select().from(instagramAccounts).where(eq(instagramAccounts.id, ex.instagramAccountId)).limit(1)
      : [];
    if (!account || account.disconnectedAt || account.status !== "connected") {
      return failExecution(ex, "account_disconnected", "A conta do Instagram está desconectada ou com token expirado.");
    }

    const [automation] = ex.automationId ? await db.select().from(automations).where(eq(automations.id, ex.automationId)).limit(1) : [];
    if (!automation || automation.status !== "active") {
      return finish(ex.id, { status: "cancelled", skipReason: "automation_inactive", finishedAt: new Date(), waitType: null });
    }

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, ex.conversationId!)).limit(1);
    if (conversation?.mode === "human" && resume.kind !== "start") {
      return finish(ex.id, { status: "cancelled", skipReason: "human_takeover", finishedAt: new Date(), waitType: null });
    }

    const flow: Flow = parseFlow(ex.flowSnapshot ?? automation.flow);
    const client = clientFor(account);
    const channel = new InstagramChannel(client);
    let { contact, rt: contactRt } = await loadContactRuntime(ex.contactId!, ex.workspaceId);

    // Primeiro envio: busca o perfil para personalizar {{nome}} (melhor esforço).
    if (!contact.profileFetchedAt && (ex.context as ExecutionContext).origin !== "comment") {
      await fetchContactProfile(contact.id).catch(() => undefined);
      ({ contact, rt: contactRt } = await loadContactRuntime(ex.contactId!, ex.workspaceId));
    }

    const timezone = await workspaceTimezone(ex.workspaceId);
    const runtime = new DbRuntime(ex, account, contactRt, channel, timezone);
    const state: ExecState = { currentNodeId: ex.currentNodeId, context: ex.context as ExecutionContext, steps: ex.steps };
    const result = await runFlow(flow, state, runtime, resume);

    await maybePublicReply(ex, flow, result, channel, runtime);
    await persistResult(ex, result);
  } catch (err) {
    await finish(ex.id, {});
    throw err;
  }
}

async function maybePublicReply(ex: Execution, flow: Flow, result: RunResult, channel: ChannelAdapter, rt: DbRuntime): Promise<void> {
  const ctx = result.state.context;
  if (ctx.origin !== "comment" || ctx.publicReplyDone || !ctx.commentId || !ctx.privateReplyUsed || !channel.replyToComment) return;
  const trigger = getTriggerNode(flow);
  if (!trigger?.data.publicReplyEnabled) return;
  const options = trigger.data.publicReplies.map((r) => r.trim()).filter(Boolean);
  if (!options.length) return;
  ctx.publicReplyDone = true;
  const text = renderVariables(options[Math.floor(Math.random() * options.length)], {
    username: rt.contact.username ? `@${rt.contact.username}` : "",
    nome: rt.contact.fields.nome || rt.contact.name || "",
  });
  try {
    const reply = await channel.replyToComment(ctx.commentId, text);
    await db.update(commentEvents).set({ publicReplyStatus: "sent", publicReplyId: reply.id }).where(eq(commentEvents.commentId, ctx.commentId));
    result.state.steps.push({ nodeId: trigger.id, type: "trigger", at: new Date().toISOString(), status: "ok", detail: "Resposta pública publicada no comentário" });
  } catch (err) {
    const e = err instanceof ChannelError ? err : toChannelError(err);
    await db.update(commentEvents).set({ publicReplyStatus: "failed" }).where(eq(commentEvents.commentId, ctx.commentId));
    result.state.steps.push({ nodeId: trigger.id, type: "trigger", at: new Date().toISOString(), status: "error", detail: `Resposta pública: ${e.userMessage}` });
  }
}

async function persistResult(ex: Execution, result: RunResult): Promise<void> {
  const base = { context: result.state.context, steps: result.state.steps };
  if (result.status === "completed") {
    await finish(ex.id, { ...base, status: "completed", currentNodeId: null, waitType: null, waitUntil: null, finishedAt: new Date() });
  } else if (result.status === "waiting") {
    await finish(ex.id, {
      ...base,
      status: "waiting",
      currentNodeId: result.state.currentNodeId,
      waitType: result.waitType,
      waitUntil: result.waitUntil,
    });
    if (result.waitType === "delay" || result.waitType === "retry") {
      await enqueue(
        "execution.run",
        { executionId: ex.id, resume: { kind: result.waitType, nodeId: result.state.currentNodeId } },
        { runAt: result.waitUntil, dedupeKey: `run:${ex.id}:${result.waitType}:${result.state.steps.length}` },
      );
    }
  } else {
    await failExecution(ex, result.errorCode, result.errorMessage, base);
    return;
  }
  await publishEvent({ workspaceId: ex.workspaceId, type: "execution.updated" });
}

async function failExecution(ex: Execution, code: string, message: string, extra: Partial<typeof automationExecutions.$inferInsert> = {}): Promise<void> {
  await finish(ex.id, { ...extra, status: "failed", errorCode: code, errorMessage: message, waitType: null, finishedAt: new Date() });
  await track(ex.workspaceId, "executions_failed", { automationId: ex.automationId });
  // Conteúdo recusado pelo Instagram (link, imagem ou botão inválido): a automação para até ser corrigida.
  if (code.startsWith("invalid") && ex.automationId) {
    const [paused] = await db
      .update(automations)
      .set({ status: "error", errorMessage: message, updatedAt: new Date() })
      .where(and(eq(automations.id, ex.automationId), eq(automations.status, "active")))
      .returning({ id: automations.id });
    if (paused) {
      await notify({
        workspaceId: ex.workspaceId,
        type: "automation_paused",
        severity: "error",
        title: `Automação "${ex.automationName}" pausada por erro`,
        body: `${message} Corrija a automação e publique novamente.`,
        linkUrl: `/app/automacoes/${ex.automationId}`,
      });
    }
  }
  if (code !== "window_closed") {
    await notify({
      workspaceId: ex.workspaceId,
      type: "send_failed",
      severity: "error",
      title: `Falha ao executar "${ex.automationName}"`,
      body: message,
      linkUrl: `/app/automacoes/logs?execucao=${ex.id}`,
      dedupeKey: `send_failed:${ex.automationId}:${code}`,
      dedupeWindowMinutes: 60,
    });
  }
  await publishEvent({ workspaceId: ex.workspaceId, type: "execution.updated" });
}

/* ------------------------------------------------------------------ */
/* Job: contact.fetch_profile                                          */
/* ------------------------------------------------------------------ */

export async function fetchContactProfile(contactId: string): Promise<void> {
  const [row] = await db
    .select({ contact: contacts, account: instagramAccounts })
    .from(contacts)
    .innerJoin(instagramAccounts, eq(instagramAccounts.id, contacts.instagramAccountId))
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!row || row.account.disconnectedAt || !row.account.accessTokenEnc) return;
  try {
    const profile = await clientFor(row.account).getUserProfile(row.contact.igsid);
    await db
      .update(contacts)
      .set({
        name: profile.name ?? row.contact.name,
        username: profile.username ?? row.contact.username,
        profilePicUrl: profile.profile_pic ?? row.contact.profilePicUrl,
        followerCount: profile.follower_count ?? row.contact.followerCount,
        isFollower: profile.is_user_follow_business ?? row.contact.isFollower,
        isFollowedByBusiness: profile.is_business_follow_user ?? row.contact.isFollowedByBusiness,
        profileFetchedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));
    await publishEvent({ workspaceId: row.contact.workspaceId, type: "contact.updated", ids: { contactId } });
  } catch (err) {
    if (err instanceof GraphApiError) {
      await handleAccountGraphError(row.account, err);
      if (err.retryable) throw err;
      // Perfil indisponível (ex.: usuário sem consentimento): não insiste.
      await db.update(contacts).set({ profileFetchedAt: new Date() }).where(eq(contacts.id, contactId));
      logger.info({ contactId, kind: err.kind }, "perfil do contato indisponível");
      return;
    }
    await recordSystemError("contact.fetch_profile", err, { workspaceId: row.contact.workspaceId });
    throw err;
  }
}
