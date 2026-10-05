export const APP_NAME = "Veloxia";
/** Slogan da marca. */
export const APP_SLOGAN = "Automação de conversas para negócios";
export const APP_TAGLINE = "Responda Instagram e WhatsApp automaticamente, na hora certa e com a mensagem certa.";

export const AUTOMATION_STATUSES = ["draft", "active", "paused", "error", "archived"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const AUTOMATION_STATUS_LABELS: Record<AutomationStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  error: "Erro",
  archived: "Arquivada",
};

export const EXECUTION_STATUSES = ["running", "waiting", "completed", "failed", "skipped", "cancelled"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  running: "Executando",
  waiting: "Aguardando",
  completed: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
  cancelled: "Cancelado",
};

export const SKIP_REASON_LABELS: Record<string, string> = {
  cooldown: "Em intervalo de repetição (cooldown)",
  already_running: "Fluxo já em andamento para este contato",
  human_takeover: "Conversa em atendimento humano",
  limit_reached: "Limite do plano atingido",
  window_closed: "Fora da janela de 24h da Meta",
  account_disconnected: "Instagram desconectado",
  opted_out: "Contato pediu para não receber mensagens",
  missing_permission: "Permissão do Instagram não concedida",
};

export const COOLDOWN_PRESETS = [
  { label: "Sem intervalo", seconds: 0 },
  { label: "1 minuto", seconds: 60 },
  { label: "5 minutos", seconds: 300 },
  { label: "1 hora", seconds: 3600 },
  { label: "24 horas", seconds: 86400 },
] as const;

export const DELAY_PRESETS = [
  { label: "1 segundo", seconds: 1 },
  { label: "3 segundos", seconds: 3 },
  { label: "5 segundos", seconds: 5 },
  { label: "10 segundos", seconds: 10 },
  { label: "30 segundos", seconds: 30 },
  { label: "1 minuto", seconds: 60 },
  { label: "5 minutos", seconds: 300 },
  { label: "1 hora", seconds: 3600 },
] as const;

export const TONES = ["friendly", "professional", "informal", "sales", "minimal", "custom"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, { label: string; description: string }> = {
  friendly: { label: "Amigável", description: "Próximo, caloroso e com emojis na medida." },
  professional: { label: "Profissional", description: "Claro, educado e objetivo." },
  informal: { label: "Informal", description: "Descontraído, como conversa entre amigos." },
  sales: { label: "Vendas", description: "Persuasivo, com chamadas para ação." },
  minimal: { label: "Minimalista", description: "Curto e direto ao ponto." },
  custom: { label: "Personalizado", description: "Siga as instruções da sua marca." },
};

export const DEFAULT_TAGS = [
  { name: "Cliente", color: "#16a34a" },
  { name: "Lead", color: "#2563eb" },
  { name: "Interessado", color: "#f59e0b" },
  { name: "Comprou", color: "#059669" },
  { name: "Produto A", color: "#7c3aed" },
  { name: "Produto B", color: "#db2777" },
  { name: "VIP", color: "#dc2626" },
];

export const SYSTEM_FIELDS = [
  { key: "nome", label: "Nome", type: "text" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "telefone", label: "Telefone", type: "phone" },
  { key: "produto_interesse", label: "Produto de interesse", type: "text" },
  { key: "observacao", label: "Observação", type: "text" },
] as const;

export const FIELD_TYPES = ["text", "email", "phone", "number", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const CONTACT_SOURCES: Record<string, string> = {
  dm: "Direct",
  comment: "Comentário",
  story_reply: "Resposta ao Story",
  story_mention: "Menção em Story",
  postback: "Botão",
  referral: "Link de indicação",
};

/** Métricas de uso controladas pelos planos (limites ficam no banco de dados). */
export const PLAN_LIMIT_KEYS = [
  "instagram_accounts",
  "active_automations",
  "contacts",
  "messages_per_month",
  "ai_generations_per_month",
] as const;
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const PLAN_FEATURE_KEYS = ["flow_builder", "advanced_analytics", "ai", "comment_automations", "remove_branding"] as const;
export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];

export interface PlanLimits {
  limits: Partial<Record<PlanLimitKey, number | null>>;
  features: Partial<Record<PlanFeatureKey, boolean>>;
}

export const NOTIFICATION_TYPES = [
  "instagram_disconnected",
  "token_expired",
  "webhook_error",
  "send_failed",
  "automation_paused",
  "limit_reached",
  "config_error",
  "handoff_requested",
  "info",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
