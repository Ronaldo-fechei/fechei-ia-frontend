import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleAlert, Copy, MousePointerClick, Pause, Pencil, Play, Rocket, Send, Trash, TriangleAlert, Workflow, Zap } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { COOLDOWN_PRESETS, getTriggerNode, NODE_INFO, type Flow, type NodeType } from "@veloxia/shared";
import { BarList, TrendChart } from "../../../components/charts";
import { ExecutionBadge } from "../../../components/automation/badges";
import { ExecutionDrawer } from "../../../components/automation/ExecutionDrawer";
import { Simulator } from "../../../components/automation/Simulator";
import { StatusBadge, TriggerBadge } from "../../../components/automation/badges";
import { StatCard } from "../../../components/StatCard";
import { Badge, Button, ButtonLink, Callout, Card, CardTitle, EmptyState, PageHeader, Skeleton } from "../../../components/ui";
import { useAutomation, useAutomationActions } from "../../../hooks/useAutomations";
import { api } from "../../../lib/api";
import { formatDateTime, formatDuration, formatNumber, relativeTime } from "../../../lib/format";
import type { ExecutionRow } from "../../../lib/types";

interface Stats {
  byStatus: { status: string; n: number }[];
  byDay: { day: string; n: number }[];
  keywords: { keyword: string; n: number }[];
  links: { title: string; url: string; clicks: number }[];
  messagesSent: number;
}

function FlowSummary({ flow }: { flow: Flow }) {
  const ordered: { type: NodeType; detail: string }[] = [];
  const visited = new Set<string>();
  const trigger = getTriggerNode(flow);
  const walk = (id: string, depth: number) => {
    if (visited.has(id) || depth > 30) return;
    visited.add(id);
    const node = flow.nodes.find((n) => n.id === id);
    if (!node) return;
    const d = node.data as Record<string, any>;
    const detail =
      node.type === "keyword"
        ? d.keywords.map((k: any) => k.text.toUpperCase()).join(", ")
        : node.type === "message"
          ? d.text
          : node.type === "link"
            ? `${d.text} → [${d.buttonTitle}] ${d.url}`
            : node.type === "buttons"
              ? `${d.text} → ${d.buttons.map((b: any) => `[${b.title}]`).join(" ")}`
              : node.type === "delay"
                ? formatDuration(d.seconds)
                : node.type === "image" || node.type === "video"
                  ? d.url
                  : node.type === "capture"
                    ? `${d.question} → campo “${d.fieldKey}”`
                    : node.type === "handoff"
                      ? d.message || "Encaminha para atendimento humano"
                      : "";
    if (node.type !== "trigger") ordered.push({ type: node.type, detail });
    for (const e of flow.edges.filter((x) => x.source === id)) walk(e.target, depth + 1);
  };
  if (trigger) walk(trigger.id, 0);
  return (
    <ol className="space-y-2">
      {ordered.map((s, i) => (
        <li key={i} className="flex gap-3 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 text-sm">
          <span className="mt-0.5 shrink-0 text-xs font-semibold tracking-wide text-brand-700 uppercase">{NODE_INFO[s.type].label}</span>
          <span className="min-w-0 break-words whitespace-pre-wrap text-zinc-700">{s.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export default function AutomationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useAutomation(id);
  const { setStatus, publish, duplicate, remove } = useAutomationActions();
  const [executionId, setExecutionId] = useState<string | null>(null);
  const stats = useQuery({ queryKey: ["automation-stats", id], queryFn: () => api.get<Stats>(`/automations/${id}/stats?days=30`), enabled: !!id });
  const executions = useQuery({
    queryKey: ["executions", { automationId: id }],
    queryFn: () => api.get<{ executions: ExecutionRow[] }>(`/executions?automationId=${id}&pageSize=10`),
    enabled: !!id,
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !data) return <EmptyState title="Automação não encontrada" action={<ButtonLink to="/app/automacoes">Voltar</ButtonLink>} />;

  const a = data.automation;
  const flow = a.flow ?? a.draftFlow;
  const editPath = a.mode === "flow" ? `/app/automacoes/${a.id}/fluxo` : `/app/automacoes/${a.id}/editar`;
  const statusCount = (s: string) => stats.data?.byStatus.find((x) => x.status === s)?.n ?? 0;
  const totalRuns = (stats.data?.byStatus ?? []).filter((s) => s.status !== "skipped").reduce((acc, s) => acc + s.n, 0);
  const clicks = (stats.data?.links ?? []).reduce((acc, l) => acc + l.clicks, 0);
  const cooldownLabel = COOLDOWN_PRESETS.find((c) => c.seconds === a.cooldownSeconds)?.label ?? formatDuration(a.cooldownSeconds);

  return (
    <div>
      <PageHeader
        back={
          <Link to="/app/automacoes" className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Automações
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {a.name} <StatusBadge status={a.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-3">
            <TriggerBadge event={a.triggerEvent} />
            <span>Não repete para a mesma pessoa por: {cooldownLabel}</span>
            {a.priority !== 0 && <span>Prioridade {a.priority}</span>}
          </span>
        }
        actions={
          <>
            <ButtonLink to={editPath} variant="secondary" icon={a.mode === "flow" ? <Workflow className="size-4" /> : <Pencil className="size-4" />}>
              Editar
            </ButtonLink>
            <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => duplicate.mutate(a.id)} loading={duplicate.isPending}>
              Duplicar
            </Button>
            {a.status === "active" ? (
              <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => setStatus.mutate({ id: a.id, status: "paused" })} loading={setStatus.isPending}>
                Pausar
              </Button>
            ) : (
              <Button icon={<Play className="size-4" />} onClick={() => setStatus.mutate({ id: a.id, status: "active" })} loading={setStatus.isPending}>
                {a.publishedAt ? "Ativar" : "Publicar"}
              </Button>
            )}
            <Button variant="ghost" icon={<Trash className="size-4" />} onClick={() => remove(a.id, a.name, () => navigate("/app/automacoes"))} className="text-red-600 hover:bg-red-50 hover:text-red-700">
              Excluir
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        {a.status === "error" && a.errorMessage && (
          <Callout tone="error" title="Automação pausada por erro">
            {a.errorMessage} Corrija e publique novamente.
          </Callout>
        )}
        {a.hasUnpublishedChanges && a.publishedAt && (
          <Callout
            tone="warning"
            title="Há alterações não publicadas"
            action={
              <Button size="sm" icon={<Rocket className="size-4" />} onClick={() => publish.mutate(a.id)} loading={publish.isPending}>
                Publicar alterações
              </Button>
            }
          >
            A versão publicada continua respondendo até você publicar as alterações.
          </Callout>
        )}
        {a.validation.errors.length > 0 && (
          <Callout tone="warning" title="Itens a corrigir antes de publicar">
            <ul className="list-disc pl-5">
              {a.validation.errors.slice(0, 5).map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          </Callout>
        )}
        {a.validation.warnings.length > 0 && a.validation.errors.length === 0 && (
          <Callout tone="info">
            {a.validation.warnings.map((w) => w.message).join(" ")}
          </Callout>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Disparos (30 dias)" value={formatNumber(totalRuns)} icon={<Zap />} loading={stats.isLoading} hint={`${formatNumber(a.executionsCount)} no total`} />
        <StatCard label="Mensagens enviadas" value={formatNumber(stats.data?.messagesSent)} icon={<Send />} loading={stats.isLoading} />
        <StatCard label="Cliques no link" value={formatNumber(clicks)} icon={<MousePointerClick />} loading={stats.isLoading} />
        <StatCard label="Falhas" value={formatNumber(statusCount("failed"))} icon={<CircleAlert />} loading={stats.isLoading} hint={`${formatNumber(statusCount("skipped"))} ignoradas`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardTitle title="Desempenho" description="Disparos por dia nos últimos 30 dias" />
            {stats.data && stats.data.byDay.length > 0 ? (
              <TrendChart data={stats.data.byDay} series={[{ key: "n", label: "Disparos", color: "#7c4dff" }]} height={220} />
            ) : (
              <EmptyState title="Ainda sem disparos" description="Quando alguém enviar uma palavra-chave, os disparos aparecem aqui." />
            )}
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardTitle
                title="Últimas execuções"
                action={
                  <ButtonLink to={`/app/automacoes/logs?automacao=${a.id}`} variant="ghost" size="sm">
                    Ver logs
                  </ButtonLink>
                }
              />
            </div>
            {executions.data?.executions.length ? (
              <ul className="divide-y divide-zinc-100">
                {executions.data.executions.map((e) => (
                  <li key={e.id}>
                    <button className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-zinc-50" onClick={() => setExecutionId(e.id)}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          <span className="font-medium">{e.contactUsername ? `@${e.contactUsername}` : "Contato"}</span>
                          <span className="text-zinc-500"> · “{e.inboundText}”</span>
                        </p>
                        <p className="text-xs text-zinc-400">{formatDateTime(e.startedAt)}</p>
                      </div>
                      <ExecutionBadge status={e.status} skipReason={e.skipReason} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pb-6 text-sm text-zinc-500">Nenhuma execução ainda.</p>
            )}
          </Card>

          <Card>
            <CardTitle title={a.flow ? "Fluxo publicado" : "Fluxo (rascunho)"} description={a.publishedAt ? `Versão ${a.version} · publicada ${relativeTime(a.publishedAt)}` : "Ainda não publicado"} />
            <FlowSummary flow={flow} />
          </Card>
        </div>

        <div className="space-y-6">
          <Simulator automationId={a.id} defaultEvent={a.triggerEvent === "new_follower" ? "dm" : a.triggerEvent} className="h-[480px]" />
          <Card>
            <CardTitle title="Palavras mais acionadas" />
            <BarList items={(stats.data?.keywords ?? []).map((k) => ({ label: k.keyword.toUpperCase(), value: k.n }))} emptyText="Nenhuma palavra acionada ainda." />
          </Card>
          {(stats.data?.links.length ?? 0) > 0 && (
            <Card>
              <CardTitle title="Links" />
              <ul className="space-y-2 text-sm">
                {stats.data!.links.map((l) => (
                  <li key={l.url} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{l.title}</span>
                      <span className="block truncate text-xs text-zinc-500">{l.url}</span>
                    </span>
                    <Badge tone="blue">{formatNumber(l.clicks)} cliques</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {a.validation.warnings.length > 0 && a.validation.errors.length > 0 && (
            <Callout tone="info" title="Avisos">
              <span className="flex items-start gap-1">
                <TriangleAlert className="mt-0.5 size-3.5" />
                {a.validation.warnings.map((w) => w.message).join(" ")}
              </span>
            </Callout>
          )}
        </div>
      </div>
      <ExecutionDrawer id={executionId} onClose={() => setExecutionId(null)} />
    </div>
  );
}
