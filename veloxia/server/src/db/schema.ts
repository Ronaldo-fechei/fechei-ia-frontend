/**
 * Esquema do banco de dados (PostgreSQL, multi-tenant por espaço de trabalho).
 *
 * Toda tabela com dados de clientes possui `workspace_id`; as consultas da API
 * sempre filtram por ele (ver plugins/auth.ts e os serviços de cada módulo).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Flow, PlanLimits } from "@veloxia/shared";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/* ------------------------------------------------------------------ */
/* Usuários, espaços de trabalho e sessões                             */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<"user" | "admin">().notNull().default("user"),
  emailVerifiedAt: ts("email_verified_at"),
  acceptedTermsAt: ts("accepted_terms_at"),
  lastLoginAt: ts("last_login_at"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  tone: text("tone").notNull().default("friendly"),
  brandInstructions: text("brand_instructions").notNull().default(""),
  defaultCooldownSeconds: integer("default_cooldown_seconds").notNull().default(60),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"owner" | "admin" | "agent">().notNull().default("owner"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("password_reset_user_idx").on(t.userId)],
);

export const oauthStates = pgTable("oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateHash: text("state_hash").notNull().unique(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  returnTo: text("return_to").notNull().default("/app/instagram"),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Planos e assinaturas                                                */
/* ------------------------------------------------------------------ */

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("BRL"),
  interval: text("interval").$type<"month" | "year">().notNull().default("month"),
  limits: jsonb("limits").$type<PlanLimits["limits"]>().notNull().default({}),
  features: jsonb("features").$type<PlanLimits["features"]>().notNull().default({}),
  isPublic: boolean("is_public").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  status: text("status").$type<"trialing" | "active" | "past_due" | "canceled" | "expired">().notNull().default("active"),
  trialEndsAt: ts("trial_ends_at"),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: ts("canceled_at"),
  provider: text("provider"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const usageCounters = pgTable(
  "usage_counters",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    metric: text("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.period, t.metric] })],
);

/* ------------------------------------------------------------------ */
/* Instagram                                                           */
/* ------------------------------------------------------------------ */

export type InstagramAccountStatus = "connected" | "token_expired" | "error" | "disconnected";

export const instagramAccounts = pgTable(
  "instagram_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** ID da conta profissional (usado nos webhooks e no envio de mensagens). */
    igUserId: text("ig_user_id").notNull(),
    /** ID com escopo do app retornado em /me (id). */
    igScopedId: text("ig_scoped_id"),
    username: text("username").notNull(),
    name: text("name"),
    profilePictureUrl: text("profile_picture_url"),
    accountType: text("account_type"),
    followersCount: integer("followers_count"),
    mediaCount: integer("media_count"),
    accessTokenEnc: text("access_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    tokenRefreshedAt: ts("token_refreshed_at"),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").$type<InstagramAccountStatus>().notNull().default("connected"),
    webhookSubscribedAt: ts("webhook_subscribed_at"),
    webhookError: text("webhook_error"),
    lastError: text("last_error"),
    lastErrorAt: ts("last_error_at"),
    lastWebhookAt: ts("last_webhook_at"),
    connectedAt: ts("connected_at").notNull().defaultNow(),
    disconnectedAt: ts("disconnected_at"),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("instagram_accounts_active_ig_user_uq").on(t.igUserId).where(sql`${t.disconnectedAt} is null`),
    index("instagram_accounts_workspace_idx").on(t.workspaceId),
    index("instagram_accounts_scoped_idx").on(t.igScopedId),
  ],
);

/* ------------------------------------------------------------------ */
/* CRM: contatos, tags e campos                                        */
/* ------------------------------------------------------------------ */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "cascade" }),
    /** ID do usuário com escopo do Instagram (IGSID). */
    igsid: text("igsid").notNull(),
    username: text("username"),
    name: text("name"),
    profilePicUrl: text("profile_pic_url"),
    followerCount: integer("follower_count"),
    isFollower: boolean("is_follower"),
    isFollowedByBusiness: boolean("is_followed_by_business"),
    profileFetchedAt: ts("profile_fetched_at"),
    source: text("source").notNull().default("dm"),
    status: text("status").$type<"active" | "opted_out" | "blocked">().notNull().default("active"),
    firstInteractionAt: ts("first_interaction_at").notNull().defaultNow(),
    lastInteractionAt: ts("last_interaction_at").notNull().defaultNow(),
    /** Última mensagem enviada PELO contato (define a janela de 24h). */
    lastInboundAt: ts("last_inbound_at"),
    lastKeyword: text("last_keyword"),
    lastAutomationId: uuid("last_automation_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contacts_account_igsid_uq").on(t.instagramAccountId, t.igsid),
    index("contacts_workspace_last_idx").on(t.workspaceId, t.lastInteractionAt),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748b"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_workspace_name_uq").on(t.workspaceId, sql`lower(${t.name})`)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    addedBy: text("added_by").$type<"automation" | "user">().notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tags_tag_idx").on(t.tagId)],
);

export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: text("type").notNull().default("text"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_fields_workspace_key_uq").on(t.workspaceId, t.key)],
);

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.fieldId] })],
);

/* ------------------------------------------------------------------ */
/* Conversas e mensagens                                               */
/* ------------------------------------------------------------------ */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .unique()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    mode: text("mode").$type<"automation" | "human">().notNull().default("automation"),
    humanSince: ts("human_since"),
    humanByUserId: uuid("human_by_user_id").references(() => users.id, { onDelete: "set null" }),
    lastMessageAt: ts("last_message_at"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageDirection: text("last_message_direction"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_workspace_last_idx").on(t.workspaceId, t.lastMessageAt)],
);

export type MessageDirection = "inbound" | "outbound";
export type MessageSource = "contact" | "automation" | "agent" | "instagram_app" | "system";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "cascade" }),
    direction: text("direction").$type<MessageDirection>().notNull(),
    source: text("source").$type<MessageSource>().notNull(),
    type: text("type").notNull().default("text"),
    text: text("text"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    externalId: text("external_id"),
    status: text("status").$type<"received" | "sending" | "sent" | "failed" | "deleted">().notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    executionId: uuid("execution_id"),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    uniqueIndex("messages_account_external_uq").on(t.instagramAccountId, t.externalId).where(sql`${t.externalId} is not null`),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    index("messages_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("messages_execution_idx").on(t.executionId),
  ],
);

/* ------------------------------------------------------------------ */
/* Automações                                                          */
/* ------------------------------------------------------------------ */

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Conta específica (null = todas as contas do espaço de trabalho). */
    instagramAccountId: uuid("instagram_account_id").references(() => instagramAccounts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").$type<"standard" | "faq">().notNull().default("standard"),
    mode: text("mode").$type<"quick" | "flow">().notNull().default("quick"),
    status: text("status").$type<"draft" | "active" | "paused" | "error" | "archived">().notNull().default("draft"),
    triggerEvent: text("trigger_event").notNull().default("dm"),
    priority: integer("priority").notNull().default(0),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(60),
    /** Fluxo publicado (o que o motor executa). */
    flow: jsonb("flow").$type<Flow>(),
    /** Rascunho do construtor (salvo automaticamente). */
    draftFlow: jsonb("draft_flow").$type<Flow>().notNull(),
    quickConfig: jsonb("quick_config").$type<Record<string, unknown>>(),
    faqQuestion: text("faq_question"),
    version: integer("version").notNull().default(0),
    publishedAt: ts("published_at"),
    hasUnpublishedChanges: boolean("has_unpublished_changes").notNull().default(true),
    errorMessage: text("error_message"),
    executionsCount: integer("executions_count").notNull().default(0),
    lastTriggeredAt: ts("last_triggered_at"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("automations_workspace_status_idx").on(t.workspaceId, t.status)],
);

/** Índice de palavras-chave (derivado do fluxo) para busca, conflitos e relatórios. */
export const automationTriggers = pgTable(
  "automation_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    nodeId: text("node_id").notNull(),
    keyword: text("keyword").notNull(),
    normalized: text("normalized").notNull(),
    matchType: text("match_type").notNull(),
    caseSensitive: boolean("case_sensitive").notNull().default(false),
    ignoreAccents: boolean("ignore_accents").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("automation_triggers_workspace_idx").on(t.workspaceId, t.normalized), index("automation_triggers_automation_idx").on(t.automationId)],
);

export interface ExecutionStep {
  nodeId: string;
  type: string;
  at: string;
  status: "ok" | "error" | "skipped" | "waiting";
  detail?: string;
  messageId?: string;
}

export interface ExecutionContext {
  origin: "dm" | "comment" | "story_reply" | "story_mention" | "postback" | "test";
  commentId?: string;
  privateReplyUsed?: boolean;
  publicReplyDone?: boolean;
  inboundText?: string;
  mediaId?: string;
  captureAttempts?: Record<string, number>;
  retryCount?: number;
  vars?: Record<string, string>;
}

export const automationExecutions = pgTable(
  "automation_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    automationName: text("automation_name").notNull(),
    instagramAccountId: uuid("instagram_account_id").references(() => instagramAccounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    triggerEvent: text("trigger_event").notNull(),
    triggerMessageId: uuid("trigger_message_id"),
    triggerCommentId: text("trigger_comment_id"),
    inboundText: text("inbound_text"),
    matchedKeyword: text("matched_keyword"),
    startNodeId: text("start_node_id"),
    status: text("status").$type<"running" | "waiting" | "completed" | "failed" | "skipped" | "cancelled">().notNull(),
    skipReason: text("skip_reason"),
    currentNodeId: text("current_node_id"),
    waitType: text("wait_type").$type<"delay" | "input" | "retry" | null>(),
    waitUntil: ts("wait_until"),
    context: jsonb("context").$type<ExecutionContext>().notNull().default({ origin: "dm" }),
    steps: jsonb("steps").$type<ExecutionStep[]>().notNull().default([]),
    flowSnapshot: jsonb("flow_snapshot").$type<Flow>(),
    flowVersion: integer("flow_version").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Trava de execução: evita duas execuções simultâneas do mesmo fluxo. */
    lockedUntil: ts("locked_until"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("executions_workspace_started_idx").on(t.workspaceId, t.startedAt),
    index("executions_automation_contact_idx").on(t.automationId, t.contactId, t.startedAt),
    index("executions_contact_status_idx").on(t.contactId, t.status),
    index("executions_status_wait_idx").on(t.status, t.waitUntil),
    uniqueIndex("executions_active_uq")
      .on(t.automationId, t.contactId)
      .where(sql`${t.status} in ('running', 'waiting')`),
  ],
);

export const commentEvents = pgTable(
  "comment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    instagramAccountId: uuid("instagram_account_id")
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull().unique(),
    mediaId: text("media_id"),
    mediaProductType: text("media_product_type"),
    parentId: text("parent_id"),
    fromId: text("from_id"),
    fromUsername: text("from_username"),
    text: text("text"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    executionId: uuid("execution_id"),
    matchedKeyword: text("matched_keyword"),
    privateReplyStatus: text("private_reply_status").$type<"none" | "sent" | "failed" | "skipped">().notNull().default("none"),
    privateReplyAt: ts("private_reply_at"),
    publicReplyStatus: text("public_reply_status").$type<"none" | "sent" | "failed">().notNull().default("none"),
    publicReplyId: text("public_reply_id"),
    convertedAt: ts("converted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("comment_events_workspace_idx").on(t.workspaceId, t.createdAt), index("comment_events_media_idx").on(t.mediaId)],
);

/* ------------------------------------------------------------------ */
/* Links rastreados                                                    */
/* ------------------------------------------------------------------ */

export const links = pgTable(
  "links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "set null" }),
    nodeId: text("node_id"),
    buttonId: text("button_id"),
    code: text("code").notNull().unique(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    clicksCount: integer("clicks_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("links_automation_node_uq").on(t.automationId, t.nodeId, sql`coalesce(${t.buttonId}, '')`)],
);

export const linkClicks = pgTable(
  "link_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    executionId: uuid("execution_id"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    clickedAt: ts("clicked_at").notNull().defaultNow(),
  },
  (t) => [index("link_clicks_workspace_idx").on(t.workspaceId, t.clickedAt), index("link_clicks_link_idx").on(t.linkId)],
);

/* ------------------------------------------------------------------ */
/* Webhooks, fila, notificações, analytics e auditoria                 */
/* ------------------------------------------------------------------ */

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    object: text("object").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    bodySha256: text("body_sha256").notNull().unique(),
    status: text("status").$type<"pending" | "processed" | "failed" | "ignored">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [index("webhook_events_received_idx").on(t.receivedAt), index("webhook_events_status_idx").on(t.status)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"pending" | "running" | "done" | "failed" | "dead">().notNull().default("pending"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("jobs_pending_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_dedupe_uq").on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: text("severity").$type<"info" | "success" | "warning" | "error">().notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    linkUrl: text("link_url"),
    dedupeKey: text("dedupe_key"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    dimension: text("dimension").notNull().default(""),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.day, t.metric, t.dimension] })],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const systemErrors = pgTable(
  "system_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    context: text("context").notNull(),
    message: text("message").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("system_errors_created_idx").on(t.createdAt)],
);

export const mediaFiles = pgTable(
  "media_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("media_files_workspace_idx").on(t.workspaceId)],
);

export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    prompt: text("prompt").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_generations_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const dataDeletionRequests = pgTable("data_deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  confirmationCode: text("confirmation_code").notNull().unique(),
  igUserId: text("ig_user_id").notNull(),
  status: text("status").$type<"received" | "completed">().notNull().default("received"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});
