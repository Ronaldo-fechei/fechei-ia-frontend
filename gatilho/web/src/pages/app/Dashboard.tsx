import { useQuery } from "@tanstack/react-query";
import { Bot, CircleCheck, Circle, Contact, MessageSquare, MessagesSquare, MousePointerClick, Percent, Send, Sparkles, Zap } from "lucide-react";
import { Link } from "react-router";
import { TRIGGER_EVENT_INFO, type TriggerEvent } from "@gatilho/shared";
import { ExecutionBadge } from "../../components/automation/badges";
import { TrendChart } from "../../components/charts";
import { StatCard } from "../../components/StatCard";
import { Avatar, Badge, ButtonLink, Card, CardTitle, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import { useMe } from "../../hooks/useAuth";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatNumber, formatPercent, relativeTime, shortStamp } from "../../lib/format";
import { NewAutomationMenu } from "./automations/AutomationsList";

interface DashboardData {
  range: { from: string; to: string };
  cards: {
    messagesIn: { value: number; previous: number };
    messagesAutomated: { value: number; previous: number };
    activeAutomations: { value: number; total: number };
    contactsCaptured: { value: number; previous: number; total: number };
    linkClicks: { value: number; previous: number };
    responseRate: { value: number | null; previous: number | null };
    conversationsStarted: { value: number; previous: number };
  };
  performance: { day: string; messagesIn: number; automated: number; executions: number; clicks: number }[];
  topAutomations: { id: string; name: string; status: "active" | "paused" | "draft" | "error" | "archived"; triggerEvent: string; executions: number; link_clicks: number }[];
  recentActivity: {
    id: string;
    startedAt: string;
    status: "running" | "waiting" | "completed" | "failed" | "skipped" | "cancelled";
    skipReason: string | null;
    automationName: string;
    matchedKeyword: string | null;
    inboundText: string | null;
    triggerEvent: string;
    contactUsername: string | null;
    contactName: string | null;
  }[];
  latestConversations: {
    id: string;
    lastMessageAt: string;
    lastMessagePreview: string | null;
    lastMessageDirection: string | null;
    unreadCount: number;
    mode: "automation" | "human";
    contactUsername: string | null;
    contactName: string | null;
    contactPic: string | null;
  }[];
  onboarding: { instagramConnected: boolean; automationCreated: boolean; automationActive: boolean; firstMessageReceived: boolean; completed: boolean };
}

function Checklist({ o }: { o: DashboardData["onboarding"] }) {
  const steps = [
    { done: o.instagramConnected, label: "Conectar sua conta do Instagram", to: "/app/instagram" },
    { done: o.automationCreated, label: "Criar a primeira automação", to: "/app/automacoes/nova" },
    { done: o.automationActive, label: "Publicar uma automação", to: "/app/automacoes" },
    { done: o.firstMessageReceived, label: "Receber a primeira mensagem", to: "/app/ajuda" },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <Card className="border-brand-200 bg-gradient-to-br from-brand-50 to-white">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-brand-800">Primeiros passos · {done}/{steps.length}</p>
          <p className="mt-0.5 text-sm text-zinc-600">Complete a configuração para seu robô começar a responder.</p>
        </div>
        <ButtonLink to="/onboarding" size="sm">
          Continuar configuração
        </ButtonLink>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.label}>
            <Link to={s.to} className={cn("flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-zinc-200 hover:ring-brand-300", s.done && "text-zinc-400 line-through")}>
              {s.done ? <CircleCheck className="size-4 shrink-0 text-emerald-500" /> : <Circle className="size-4 shrink-0 text-zinc-300" />}
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Dashboard() {
  const me = useMe();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardData>("/dashboard"), refetchInterval: 60_000 });
  const c = data?.cards;
  const firstName = me.user.name.split(" ")[0];
  const hasActivity = !!data && (data.performance.some((d) => d.messagesIn || d.automated) || data.recentActivity.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={`Olá, ${firstName}! 👋`} description="Resumo dos últimos 30 dias." actions={<NewAutomationMenu />} />

      {data && <Checklist o={data.onboarding} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Mensagens recebidas" value={formatNumber(c?.messagesIn.value)} current={c?.messagesIn.value} previous={c?.messagesIn.previous} icon={<MessageSquare />} loading={isLoading} hint="vs. 30 dias anteriores" />
        <StatCard label="Mensagens automatizadas" value={formatNumber(c?.messagesAutomated.value)} current={c?.messagesAutomated.value} previous={c?.messagesAutomated.previous} icon={<Send />} loading={isLoading} />
        <StatCard label="Automações ativas" value={formatNumber(c?.activeAutomations.value)} icon={<Zap />} loading={isLoading} hint={c ? `de ${c.activeAutomations.total} criadas` : undefined} />
        <StatCard label="Contatos capturados" value={formatNumber(c?.contactsCaptured.value)} current={c?.contactsCaptured.value} previous={c?.contactsCaptured.previous} icon={<Contact />} loading={isLoading} hint={c ? `${formatNumber(c.contactsCaptured.total)} no total` : undefined} />
        <StatCard label="Cliques em links" value={formatNumber(c?.linkClicks.value)} current={c?.linkClicks.value} previous={c?.linkClicks.previous} icon={<MousePointerClick />} loading={isLoading} />
        <StatCard
          label="Taxa de resposta"
          value={formatPercent(c?.responseRate.value)}
          icon={<Percent />}
          loading={isLoading}
          info="Percentual de mensagens e comentários recebidos que acionaram uma automação com sucesso."
        />
        <StatCard label="Conversas iniciadas" value={formatNumber(c?.conversationsStarted.value)} current={c?.conversationsStarted.value} previous={c?.conversationsStarted.previous} icon={<MessagesSquare />} loading={isLoading} />
        <Card className="flex flex-col justify-between gap-3 bg-ink-950 text-white">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Sparkles className="size-4 text-brand-400" /> Dica
          </div>
          <p className="text-sm leading-relaxed">Adicione variações das palavras (“link”, “me passa o link”, “onde compro”) para responder mais gente.</p>
          <Link to="/app/palavras-chave" className="text-sm font-medium text-brand-300 hover:text-brand-200">
            Ver palavras-chave →
          </Link>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle title="Desempenho das automações" description="Últimos 14 dias" />
          {isLoading ? (
            <Skeleton className="h-60" />
          ) : hasActivity ? (
            <TrendChart
              data={data!.performance}
              series={[
                { key: "messagesIn", label: "Recebidas", color: "#94a3b8" },
                { key: "automated", label: "Automatizadas", color: "#ef5a2f" },
                { key: "clicks", label: "Cliques", color: "#0ea5e9" },
              ]}
            />
          ) : (
            <EmptyState
              icon={<Bot className="size-6" />}
              title="Ainda sem atividade"
              description="Quando seus seguidores enviarem mensagens, os números aparecem aqui em tempo real."
            />
          )}
        </Card>
        <Card>
          <CardTitle title="Automações mais utilizadas" action={<ButtonLink to="/app/automacoes" variant="ghost" size="sm">Ver todas</ButtonLink>} />
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : data!.topAutomations.length ? (
            <ul className="space-y-3">
              {data!.topAutomations.map((a) => (
                <li key={a.id}>
                  <Link to={`/app/automacoes/${a.id}`} className="flex items-center justify-between gap-3 rounded-lg p-1 hover:bg-zinc-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{a.name}</p>
                      <p className="text-xs text-zinc-500">{TRIGGER_EVENT_INFO[a.triggerEvent as TriggerEvent]?.label}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{formatNumber(a.executions)}</p>
                      <p className="text-xs text-zinc-400">disparos</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-zinc-500">Nenhum disparo nos últimos 30 dias.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-2">
            <CardTitle title="Atividade recente" action={<ButtonLink to="/app/automacoes/logs" variant="ghost" size="sm">Ver logs</ButtonLink>} className="mb-0" />
          </div>
          {isLoading ? (
            <Skeleton className="m-5 h-48" />
          ) : data!.recentActivity.length ? (
            <ul className="divide-y divide-zinc-100">
              {data!.recentActivity.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{e.contactUsername ? `@${e.contactUsername}` : e.contactName ?? "Contato"}</span>
                      <span className="text-zinc-500"> {e.triggerEvent === "comment" ? "comentou" : "enviou"} “{e.inboundText}”</span>
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {e.matchedKeyword && <Badge tone="brand" className="mr-1.5">{e.matchedKeyword.toUpperCase()}</Badge>}
                      {e.automationName} · {relativeTime(e.startedAt)}
                    </p>
                  </div>
                  <ExecutionBadge status={e.status} skipReason={e.skipReason} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-8 text-sm text-zinc-500">As execuções das automações aparecem aqui.</p>
          )}
        </Card>

        <Card padded={false}>
          <div className="p-5 pb-2">
            <CardTitle title="Últimas conversas" action={<ButtonLink to="/app/conversas" variant="ghost" size="sm">Abrir caixa de entrada</ButtonLink>} className="mb-0" />
          </div>
          {isLoading ? (
            <Skeleton className="m-5 h-48" />
          ) : data!.latestConversations.length ? (
            <ul className="divide-y divide-zinc-100">
              {data!.latestConversations.map((cv) => (
                <li key={cv.id}>
                  <Link to={`/app/conversas/${cv.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50">
                    <Avatar src={cv.contactPic} name={cv.contactName ?? cv.contactUsername} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{cv.contactUsername ? `@${cv.contactUsername}` : cv.contactName ?? "Contato"}</p>
                        {cv.mode === "human" && <Badge tone="violet">humano</Badge>}
                      </div>
                      <p className="truncate text-sm text-zinc-500">
                        {cv.lastMessageDirection === "outbound" && "Você: "}
                        {cv.lastMessagePreview}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-zinc-400">{shortStamp(cv.lastMessageAt)}</span>
                      {cv.unreadCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{cv.unreadCount}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-8 text-sm text-zinc-500">Nenhuma conversa ainda.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
