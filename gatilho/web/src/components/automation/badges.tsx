import { CircleAlert, MessageCircle, MessagesSquare, Radio, UserPlus, Zap } from "lucide-react";
import {
  AUTOMATION_STATUS_LABELS,
  EXECUTION_STATUS_LABELS,
  SKIP_REASON_LABELS,
  TRIGGER_EVENT_INFO,
  type AutomationStatus,
  type ExecutionStatus,
  type TriggerEvent,
} from "@gatilho/shared";
import { Badge, Tooltip, type BadgeTone } from "../ui";

const STATUS_TONES: Record<AutomationStatus, BadgeTone> = { draft: "gray", active: "green", paused: "yellow", error: "red", archived: "gray" };

export function StatusBadge({ status }: { status: AutomationStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {AUTOMATION_STATUS_LABELS[status].toUpperCase()}
    </Badge>
  );
}

const TRIGGER_ICONS: Record<string, typeof Zap> = { dm: MessagesSquare, comment: MessageCircle, story_reply: Zap, story_mention: Radio, new_follower: UserPlus };

export function TriggerBadge({ event }: { event: string }) {
  const info = TRIGGER_EVENT_INFO[event as TriggerEvent];
  const Icon = TRIGGER_ICONS[event] ?? Zap;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600">
      <Icon className="size-3.5 text-brand-600" />
      {info?.label ?? event}
    </span>
  );
}

const EXEC_TONES: Record<ExecutionStatus, BadgeTone> = {
  running: "blue",
  waiting: "blue",
  completed: "green",
  failed: "red",
  skipped: "gray",
  cancelled: "gray",
};

export function ExecutionBadge({ status, skipReason }: { status: ExecutionStatus; skipReason?: string | null }) {
  const label = status === "completed" && skipReason === "no_reply" ? "Sem resposta" : EXECUTION_STATUS_LABELS[status];
  const badge = (
    <Badge tone={EXEC_TONES[status]}>
      {status === "failed" && <CircleAlert className="size-3" />}
      {label.toUpperCase()}
    </Badge>
  );
  if (skipReason && SKIP_REASON_LABELS[skipReason]) {
    return (
      <Tooltip content={SKIP_REASON_LABELS[skipReason]}>
        <span>{badge}</span>
      </Tooltip>
    );
  }
  return badge;
}

export function skipReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return SKIP_REASON_LABELS[reason] ?? (reason === "superseded" ? "Substituído por outro fluxo" : reason === "automation_inactive" ? "Automação pausada" : reason);
}
