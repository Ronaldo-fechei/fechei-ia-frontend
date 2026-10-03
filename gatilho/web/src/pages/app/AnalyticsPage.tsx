import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Contact, Lock, MessageSquare, MousePointerClick, Percent, Send, Zap } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { BarList, BarsChart, TrendChart } from "../../components/charts";
import { StatCard } from "../../components/StatCard";
import { ButtonLink, Callout, Card, CardTitle, Input, PageHeader, Segmented, Skeleton } from "../../components/ui";
import { useMe } from "../../hooks/useAuth";
import { api, ApiError, qs } from "../../lib/api";
import { formatNumber, formatPercent } from "../../lib/format";

type Range = "today" | "7d" | "30d" | "90d" | "custom";

interface AnalyticsData {
  range: { from: string; to: string; days: number };
  advanced: boolean;
  totals: Record<string, number>;
  previous: Record<string, number>;
  rates: { responseRate: number | null; interactionRate: number | null; failureRate: number | null };
  series: ({ day: string } & Record<string, number>)[];
  topAutomations: { id: string; name: string; executions: number; link_clicks: number }[];
  topKeywords: { keyword: string; n: number }[];
  topLinks: { id: string; title: string; url: string; clicks: number; automationName: string | null }[];
  byHour: { hour: number; n: number }[] | null;
  byWeekday: { weekday: number; n: number }[] | null;
  peakHour: { hour: number; n: number } | null;
  peakDay: { weekday: number; n: number } | null;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function LockedCard({ title }: { title: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Lock className="size-5 text-zinc-400" />
      <p className="font-medium">{title}</p>
      <p className="max-w-xs text-sm text-zinc-500">Disponível no Analytics avançado dos planos pagos.</p>
      <ButtonLink to="/app/configuracoes?aba=plano" size="sm" variant="secondary">
        Ver planos
      </ButtonLink>
    </Card>
  );
}

export default function AnalyticsPage() {
  const me = useMe();
  const advancedPlan = me.plan.features.advanced_analytics !== false;
  const [range, setRange] = useState<Range>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ready = range !== "custom" || (from && to);
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", range, from, to],
    queryFn: () => api.get<AnalyticsData>(`/analytics${qs({ range, from: range === "custom" ? from : undefined, to: range === "custom" ? to : undefined })}`),
    enabled: !!ready,
    placeholderData: (prev) => prev,
  });
  const t = data?.totals;
  const p = data?.previous;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Resultados reais das suas automações."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={range}
              onChange={setRange}
              size="md"
              items={[
                { value: "today", label: "Hoje" },
                { value: "7d", label: "7 dias" },
                { value: "30d", label: "30 dias" },
                { value: "90d", label: "90 dias" },
                { value: "custom", label: "Personalizado" },
              ]}
            />
          </div>
        }
      />
      {range === "custom" && (
        <Card className="flex flex-wrap items-end gap-3">
          <CalendarDays className="mb-2.5 size-5 text-zinc-400" />
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600">De</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-600">Até</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} />
          </label>
        </Card>
      )}
      {error instanceof ApiError && (
        <Callout tone={error.status === 402 ? "info" : "error"} action={error.status === 402 ? <ButtonLink to="/app/configuracoes?aba=plano" size="sm" variant="secondary">Ver planos</ButtonLink> : undefined}>
          {error.message}
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Mensagens recebidas" value={formatNumber(t?.messages_in)} current={t?.messages_in} previous={p?.messages_in} icon={<MessageSquare />} loading={isLoading} hint="vs. período anterior" />
        <StatCard label="Respostas automáticas" value={formatNumber(t?.messages_out_auto)} current={t?.messages_out_auto} previous={p?.messages_out_auto} icon={<Send />} loading={isLoading} />
        <StatCard label="Automações executadas" value={formatNumber(t?.executions)} current={t?.executions} previous={p?.executions} icon={<Zap />} loading={isLoading} hint={t?.executions_failed ? `${formatNumber(t.executions_failed)} com falha` : undefined} />
        <StatCard label="Total de contatos" value={formatNumber(t?.contactsTotal)} icon={<Contact />} loading={isLoading} hint={t ? `+${formatNumber(t.contacts_new)} no período` : undefined} />
        <StatCard label="Cliques em links" value={formatNumber(t?.link_clicks)} current={t?.link_clicks} previous={p?.link_clicks} icon={<MousePointerClick />} loading={isLoading} />
        <StatCard label="Taxa de interação" value={formatPercent(data?.rates.interactionRate)} icon={<Percent />} loading={isLoading} info="Cliques em links ÷ respostas automáticas enviadas." />
        <StatCard label="Taxa de resposta" value={formatPercent(data?.rates.responseRate)} icon={<Percent />} loading={isLoading} info="Mensagens e comentários que acionaram uma automação com sucesso." />
        <StatCard label="Comentários recebidos" value={formatNumber(t?.comments_in)} icon={<MessageSquare />} loading={isLoading} hint={t ? `${formatNumber(t.comment_dms)} DMs enviadas` : undefined} />
      </div>

      <Card>
        <CardTitle title="Mensagens por dia" description={data ? `${data.range.from.split("-").reverse().join("/")} a ${data.range.to.split("-").reverse().join("/")}` : undefined} />
        {isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <TrendChart
            data={data.series}
            height={260}
            series={[
              { key: "messages_in", label: "Recebidas", color: "#94a3b8" },
              { key: "messages_out_auto", label: "Automáticas", color: "#ef5a2f" },
              { key: "link_clicks", label: "Cliques", color: "#0ea5e9" },
            ]}
          />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardTitle title="Automação mais utilizada" />
          <BarList items={(data?.topAutomations ?? []).slice(0, 6).map((a) => ({ label: a.name, value: a.executions, hint: a.link_clicks ? `${formatNumber(a.link_clicks)} cliques` : undefined }))} />
        </Card>
        <Card>
          <CardTitle title="Palavra-chave mais acionada" />
          <BarList items={(data?.topKeywords ?? []).map((k) => ({ label: k.keyword.toUpperCase(), value: k.n }))} />
        </Card>
        <Card>
          <CardTitle title="Links mais clicados" />
          <BarList items={(data?.topLinks ?? []).map((l) => ({ label: l.title || l.url, value: l.clicks, hint: l.automationName ?? undefined }))} />
        </Card>
      </div>

      {data?.advanced && data.byHour && data.byWeekday ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle title="Horário de maior volume" description={data.peakHour ? `Pico às ${String(data.peakHour.hour).padStart(2, "0")}h (${formatNumber(data.peakHour.n)} mensagens)` : "Sem mensagens no período"} />
            <BarsChart data={data.byHour} xKey="hour" yKey="n" label="Mensagens" xFormatter={(h) => `${String(h).padStart(2, "0")}h`} />
          </Card>
          <Card>
            <CardTitle title="Dia de maior volume" description={data.peakDay ? `${WEEKDAYS[data.peakDay.weekday]} (${formatNumber(data.peakDay.n)} mensagens)` : "Sem mensagens no período"} />
            <BarsChart data={data.byWeekday} xKey="weekday" yKey="n" label="Mensagens" color="#8b5cf6" xFormatter={(d) => WEEKDAYS[d]?.slice(0, 3) ?? d} />
          </Card>
        </div>
      ) : (
        !advancedPlan && (
          <div className="grid gap-6 lg:grid-cols-2">
            <LockedCard title="Horário de maior volume" />
            <LockedCard title="Dia de maior volume" />
          </div>
        )
      )}
      <p className="text-xs text-zinc-400">
        Os dados são contados pelo sistema a partir dos eventos oficiais recebidos. Cliques são registrados pelos links rastreados.{" "}
        <Link to="/app/automacoes/logs" className="underline">
          Ver logs detalhados
        </Link>
        .
      </p>
    </div>
  );
}
