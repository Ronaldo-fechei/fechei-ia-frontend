import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { EXECUTION_STATUS_LABELS, EXECUTION_STATUSES } from "@gatilho/shared";
import { ExecutionBadge, skipReasonLabel } from "../../../components/automation/badges";
import { ExecutionDrawer } from "../../../components/automation/ExecutionDrawer";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from "../../../components/ui";
import { useAutomations } from "../../../hooks/useAutomations";
import { api, qs } from "../../../lib/api";
import { formatDate, formatTime } from "../../../lib/format";
import type { ExecutionRow } from "../../../lib/types";

export default function LogsPage() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [automationId, setAutomationId] = useState(params.get("automacao") ?? "");
  const [days, setDays] = useState("7");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const executionId = params.get("execucao");
  const { data: automations } = useAutomations({});

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading } = useQuery({
    queryKey: ["executions", { status, automationId, days, q: debounced, page }],
    queryFn: () => api.get<{ executions: ExecutionRow[]; hasMore: boolean }>(`/executions${qs({ status, automationId, days, q: debounced, page, pageSize: 30 })}`),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });

  const open = (id: string | null) => {
    if (id) params.set("execucao", id);
    else params.delete("execucao");
    setParams(params, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Logs" description="Histórico de execuções: o que chegou, qual palavra foi detectada, o que foi enviado e por quê." />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_220px_160px]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar mensagem, @ ou automação" className="pl-9" aria-label="Buscar nos logs" />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">Todos os status</option>
          {EXECUTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EXECUTION_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select value={automationId} onChange={(e) => { setAutomationId(e.target.value); setPage(1); }} aria-label="Automação">
          <option value="">Todas as automações</option>
          {automations?.automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={days} onChange={(e) => { setDays(e.target.value); setPage(1); }} aria-label="Período">
          <option value="1">Últimas 24 horas</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
        </Select>
      </div>

      <Card padded={false} className="overflow-hidden">
        {isLoading ? (
          <Skeleton className="m-4 h-72" />
        ) : !data?.executions.length ? (
          <EmptyState icon={<ScrollText className="size-6" />} title="Nenhuma execução no período" description="Quando uma mensagem acionar uma automação, o registro aparece aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Contato</th>
                  <th className="px-4 py-3">Mensagem recebida</th>
                  <th className="hidden px-4 py-3 md:table-cell">Palavra</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Automação</th>
                  <th className="hidden px-4 py-3 xl:table-cell">Mensagem enviada</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.executions.map((e) => (
                  <tr key={e.id} className="cursor-pointer align-top hover:bg-zinc-50" onClick={() => open(e.id)}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p>{formatDate(e.startedAt)}</p>
                      <p className="text-xs text-zinc-500">{formatTime(e.startedAt)}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{e.contactUsername ? `@${e.contactUsername}` : e.contactName ?? "—"}</td>
                    <td className="max-w-56 px-4 py-3">
                      <p className="line-clamp-2">“{e.inboundText || "—"}”</p>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{e.matchedKeyword ? <Badge tone="brand">{e.matchedKeyword.toUpperCase()}</Badge> : <span className="text-zinc-400">—</span>}</td>
                    <td className="hidden px-4 py-3 lg:table-cell">{e.automationName}</td>
                    <td className="hidden max-w-64 px-4 py-3 xl:table-cell">
                      <p className="line-clamp-2 text-zinc-600">{e.sentText ?? "—"}</p>
                      {e.sentCount > 1 && <p className="text-xs text-zinc-400">+{e.sentCount - 1} mensagem(ns)</p>}
                    </td>
                    <td className="px-4 py-3">
                      <ExecutionBadge status={e.status} skipReason={e.skipReason} />
                      {(e.errorMessage || (e.skipReason && e.status === "skipped")) && (
                        <p className="mt-1 max-w-48 text-xs text-zinc-500">{e.errorMessage ?? skipReasonLabel(e.skipReason)}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (page > 1 || data.hasMore) && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-sm">
            <span className="text-zinc-500">Página {page}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="secondary" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ExecutionDrawer id={executionId} onClose={() => open(null)} />
    </div>
  );
}
