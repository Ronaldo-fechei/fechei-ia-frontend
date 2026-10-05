import type { AutomationStatus, Flow, FlowValidation, PlanLimitKey, QuickAutomationInput, Tone } from "@veloxia/shared";

export interface Me {
  user: { id: string; email: string; name: string; role: "user" | "admin" };
  workspace: {
    id: string;
    name: string;
    timezone: string;
    tone: Tone;
    brandInstructions: string;
    defaultCooldownSeconds: number;
    onboardingCompletedAt: string | null;
    role: "owner" | "admin" | "agent";
  };
  plan: { id: string; name: string; limits: Partial<Record<PlanLimitKey, number | null>>; features: Record<string, boolean> };
  subscription: { status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
  usage: Record<PlanLimitKey, number>;
}

export interface SystemStatus {
  appName: string;
  emailEnabled: boolean;
  instagramEnabled: boolean;
  aiEnabled: boolean;
  supportEmail: string | null;
  setup?: {
    meta: {
      appConfigured: boolean;
      webhookConfigured: boolean;
      graphApiVersion: string;
      scopes: string[];
      webhookFields: string[];
      oauthRedirectUrl: string;
      webhookUrl: string;
      deauthorizeUrl: string;
      dataDeletionUrl: string;
      privacyPolicyUrl: string;
      termsUrl: string;
      humanAgentEnabled: boolean;
      httpsOk: boolean;
    };
    email: { configured: boolean };
    ai: { configured: boolean; model: string | null };
  };
}

export interface InstagramAccount {
  id: string;
  igUserId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  accountType: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  scopes: string[];
  status: "connected" | "token_expired" | "error" | "disconnected";
  tokenExpiresAt: string | null;
  webhookSubscribedAt: string | null;
  webhookError: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastWebhookAt: string | null;
  connectedAt: string;
  permissions: { messages: boolean; comments: boolean };
}

export interface AutomationSummary {
  id: string;
  name: string;
  description: string;
  kind: "standard" | "faq";
  mode: "quick" | "flow";
  status: AutomationStatus;
  triggerEvent: string;
  priority: number;
  cooldownSeconds: number;
  instagramAccountId: string | null;
  keywords: string[];
  actions: string[];
  executionsCount: number;
  lastTriggeredAt: string | null;
  linkClicks: number;
  hasUnpublishedChanges: boolean;
  publishedAt: string | null;
  errorMessage: string | null;
  faqQuestion: string | null;
  quickConfig?: Record<string, unknown> | null;
  updatedAt: string;
  createdAt: string;
}

export interface AutomationFull {
  id: string;
  name: string;
  description: string;
  kind: "standard" | "faq";
  mode: "quick" | "flow";
  status: AutomationStatus;
  triggerEvent: string;
  priority: number;
  cooldownSeconds: number;
  instagramAccountId: string | null;
  flow: Flow | null;
  draftFlow: Flow;
  quickConfig: (QuickAutomationInput & Record<string, unknown>) | null;
  faqQuestion: string | null;
  version: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  errorMessage: string | null;
  executionsCount: number;
  lastTriggeredAt: string | null;
  validation: FlowValidation;
  createdAt: string;
  updatedAt: string;
}

export interface TagItem {
  id: string;
  name: string;
  color: string;
  contactsCount?: number;
}

export interface FieldItem {
  id: string;
  key: string;
  label: string;
  type: string;
  isSystem: boolean;
}

export interface SimOutput {
  nodeId: string;
  privateReply: boolean;
  content:
    | { kind: "text"; text: string; quickReplies?: { title: string; payload: string }[] }
    | { kind: "image"; url: string }
    | { kind: "video"; url: string }
    | { kind: "buttons"; text: string; buttons: ({ type: "url"; title: string; url: string } | { type: "postback"; title: string; payload: string })[] };
}

export interface ExecutionStep {
  nodeId: string;
  type: string;
  at: string;
  status: "ok" | "error" | "skipped" | "waiting";
  detail?: string;
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
  state?: { currentNodeId: string | null; context: Record<string, unknown>; steps: ExecutionStep[] };
}

export interface ContactRow {
  id: string;
  igsid: string;
  username: string | null;
  name: string | null;
  profilePicUrl: string | null;
  source: string;
  status: "active" | "opted_out" | "blocked";
  isFollower: boolean | null;
  firstInteractionAt: string;
  lastInteractionAt: string;
  lastInboundAt: string | null;
  lastKeyword: string | null;
  tags: TagItem[];
}

export interface ConversationRow {
  id: string;
  status: "open" | "closed";
  mode: "automation" | "human";
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  contactId: string;
  contactName: string | null;
  contactUsername: string | null;
  contactPic: string | null;
  lastKeyword: string | null;
  lastAutomationName: string | null;
  tags: TagItem[];
}

export interface MessageRow {
  id: string;
  direction: "inbound" | "outbound";
  source: "contact" | "automation" | "agent" | "instagram_app" | "system";
  type: string;
  text: string | null;
  payload: Record<string, any> | null;
  status: "received" | "sending" | "sent" | "failed" | "deleted";
  errorMessage: string | null;
  createdAt: string;
  automationName: string | null;
  sentByName: string | null;
  trigger: { automationName: string; keyword: string | null; status: string; skipReason: string | null } | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ExecutionRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "waiting" | "completed" | "failed" | "skipped" | "cancelled";
  skipReason: string | null;
  triggerEvent: string;
  inboundText: string | null;
  matchedKeyword: string | null;
  automationId: string | null;
  automationName: string;
  errorMessage: string | null;
  contactId: string | null;
  contactUsername: string | null;
  contactName: string | null;
  conversationId: string | null;
  sentText: string | null;
  sentCount: number;
}
