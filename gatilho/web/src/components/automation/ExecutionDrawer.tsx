import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Clock, MessagesSquare } from "lucide-react";
import { Link } from "react-router";
import { NODE_INFO, TRIGGER_EVENT_INFO, type NodeType, type TriggerEvent } from "@gatilho/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";
import type { ExecutionStep } from "../../lib/types";
import { Avatar, ButtonLink, Callout, Drawer, Skeleton } from "../ui";
import { ExecutionBadge, skipReasonLabel } from "./badges";

interface ExecutionDetail {
  execution: {
    id: string;
    status: "running" | "waiting" | "completed" | "failed" | "skipped" | "cancelled";
    skipReason: string | null;
    automationId: string | null;
    automationName: string;
    triggerEvent: string;
    inboundText: string | null;
    matchedKeyword: string | null;
    errorMessage: string | null;
    steps: ExecutionStep[];
    startedAt: string;
    finishedAt: string | null;
    waitUntil: string | null;
    conversationId: string | null;
    origin: string;
  };
  contact: { id: string; username: string | null; name: string | null; profilePicUrl: string | null } | null;
  messages: { id: string; text: string | null; type: string; status: string; errorMessage: string | null; createdAt: string }[];
}

export function ExecutionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["execution", id], queryFn: () => api.get<ExecutionDetail>(`/executions/${id}`), enabled: !!id });
  const ex = data?.execution;
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title="Detalhes da execução" description={ex ? formatDateTime(ex.startedAt) : undefined}>
      {isLoading || !ex ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex items-center justify-between gap-3">
            {data?.contact ? (
              <Link to={`/app/contatos/${data.contact.id}`} className="flex items-center gap-2.5 hover:underline">
                <Avatar src={data.contact.profilePicUrl} name={data.contact.name ?? data.contact.username} />
                <div>
                  <p className="font-medium">{data.contact.username ? `@${data.contact.username}` : data.contact.name ?? "Contato"}</p>
                  {data.contact.name && <p className="text-xs text-zinc-500">{data.contact.name}</p>}
                </div>
              </Link>
            ) : (
              <span className="text-zinc-500">Contato removido</span>
            )}
            <ExecutionBadge status={ex.status} skipReason={ex.skipReason} />
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-4">
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500">Mensagem recebida</dt>
              <dd className="mt-0.5 font-medium whitespace-pre-wrap">{ex.inboundText || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Palavra detectada</dt>
              <dd className="mt-0.5 font-medium">{ex.matchedKeyword ? ex.matchedKeyword.toUpperCase() : "— (sem palavra-chave)"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Origem</dt>
              <dd className="mt-0.5">{TRIGGER_EVENT_INFO[ex.triggerEvent as TriggerEvent]?.label ?? ex.triggerEvent}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500">Automação</dt>
              <dd className="mt-0.5">
                {ex.automationId ? (
                  <Link to={`/app/automacoes/${ex.automationId}`} className="font-medium text-brand-700 hover:underline">
                    {ex.automationName}
                  </Link>
                ) : (
                  <span>{ex.automationName} (excluída)</span>
                )}
              </dd>
            </div>
          </dl>

          {ex.skipReason && ex.status !== "completed" && <Callout tone="info" title="Por que não foi enviada">{skipReasonLabel(ex.skipReason)}</Callout>}
          {ex.errorMessage && <Callout tone="error" title="Erro">{ex.errorMessage}</Callout>}
          {ex.status === "waiting" && ex.waitUntil && (
            <Callout tone="info">
              <span className="flex items-center gap-1.5">
                <Clock className="size-4" /> Aguardando até {formatDateTime(ex.waitUntil)}
              </span>
            </Callout>
          )}

          <div>
            <h4 className="mb-2 font-semibold">Mensagens enviadas</h4>
            {data!.messages.length === 0 ? (
              <p className="text-zinc-500">Nenhuma mensagem enviada.</p>
            ) : (
              <ul className="space-y-2">
                {data!.messages.map((m) => (
                  <li key={m.id} className={cn("rounded-lg border p-3", m.status === "failed" ? "border-red-200 bg-red-50" : "border-zinc-200")}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDateTime(m.createdAt)} · {m.status === "sent" ? "enviada" : m.status === "failed" ? `falhou: ${m.errorMessage}` : m.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-2 font-semibold">Etapas</h4>
            <ol className="space-y-2 border-l border-zinc-200 pl-4">
              {ex.steps.map((s, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1 -left-[23px] rounded-full bg-white">
                    {s.status === "error" ? <CircleAlert className="size-4 text-red-500" /> : s.status === "waiting" ? <Clock className="size-4 text-sky-500" /> : <CircleCheck className="size-4 text-emerald-500" />}
                  </span>
                  <p className="font-medium">{NODE_INFO[s.type as NodeType]?.label ?? s.type}</p>
                  {s.detail && <p className="text-xs text-zinc-500">{s.detail}</p>}
                  <p className="text-[11px] text-zinc-400">{formatDateTime(s.at)}</p>
                </li>
              ))}
              {ex.steps.length === 0 && <li className="text-zinc-500">Nenhuma etapa executada.</li>}
            </ol>
          </div>

          {ex.conversationId && (
            <ButtonLink to={`/app/conversas/${ex.conversationId}`} variant="secondary" icon={<MessagesSquare className="size-4" />}>
              Abrir conversa
            </ButtonLink>
          )}
        </div>
      )}
    </Drawer>
  );
}
