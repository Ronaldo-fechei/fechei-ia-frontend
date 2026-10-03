import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Search, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { MATCH_TYPE_HELP, MATCH_TYPE_LABELS, MATCH_TYPES, TRIGGER_EVENT_INFO, type AutomationStatus, type MatchType, type TriggerEvent } from "@gatilho/shared";
import { StatusBadge } from "../../components/automation/badges";
import { Simulator } from "../../components/automation/Simulator";
import { Badge, ButtonLink, Callout, Card, CardTitle, EmptyState, IconButton, Input, PageHeader, Select, Skeleton, Tooltip, useConfirm } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { formatNumber } from "../../lib/format";

interface KeywordRow {
  id: string;
  keyword: string;
  normalized: string;
  matchType: MatchType;
  caseSensitive: boolean;
  ignoreAccents: boolean;
  automationId: string;
  automationName: string;
  automationStatus: AutomationStatus;
  automationMode: "quick" | "flow";
  triggerEvent: string;
  priority: number;
  hits: number;
  conflict: boolean;
}

export default function KeywordsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["keywords"], queryFn: () => api.get<{ keywords: KeywordRow[] }>("/keywords") });
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.keywords ?? []).filter((k) => !term || k.keyword.toLowerCase().includes(term) || k.automationName.toLowerCase().includes(term));
  }, [data, q]);
  const conflicts = (data?.keywords ?? []).filter((k) => k.conflict);

  const update = async (row: KeywordRow, patch: Partial<Pick<KeywordRow, "matchType" | "caseSensitive" | "ignoreAccents">> & { remove?: boolean }) => {
    try {
      await api.patch(`/keywords/${row.id}`, patch);
      qc.invalidateQueries({ queryKey: ["keywords"] });
      qc.invalidateQueries({ queryKey: ["automations"] });
      toast.success(patch.remove ? "Palavra-chave removida" : "Palavra-chave atualizada", {
        description: row.automationStatus === "active" ? "A automação foi republicada com a alteração." : undefined,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async (row: KeywordRow) => {
    const ok = await confirm({ title: `Remover “${row.keyword}”?`, description: `A palavra deixa de acionar a automação “${row.automationName}”.`, confirmLabel: "Remover", danger: true });
    if (ok) update(row, { remove: true });
  };

  return (
    <div>
      <PageHeader title="Palavras-chave" description="Todas as palavras e frases que acionam suas automações, em um só lugar." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          {conflicts.length > 0 && (
            <Callout tone="warning" title="Palavras repetidas em automações ativas">
              {[...new Set(conflicts.map((c) => c.keyword.toUpperCase()))].join(", ")} aparecem em mais de uma automação. Só uma responde: vence a de maior
              prioridade manual e, em empate, a palavra mais específica.
            </Callout>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar palavra ou automação" className="pl-9" aria-label="Buscar palavra-chave" />
          </div>
          <Card padded={false} className="overflow-hidden">
            {isLoading ? (
              <Skeleton className="m-4 h-64" />
            ) : !rows.length ? (
              <EmptyState
                icon={<KeyRound className="size-6" />}
                title={q ? "Nada encontrado" : "Nenhuma palavra-chave ainda"}
                description={q ? undefined : "Crie uma automação e defina as palavras que vão acionar a resposta."}
                action={!q ? <ButtonLink to="/app/automacoes/nova">Nova automação</ButtonLink> : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase">
                    <tr>
                      <th className="px-4 py-3">Palavra-chave</th>
                      <th className="px-4 py-3">Correspondência</th>
                      <th className="hidden px-4 py-3 md:table-cell">Automação</th>
                      <th className="px-4 py-3 text-right">Acionamentos</th>
                      <th className="px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {rows.map((k) => (
                      <tr key={k.id} className="align-middle">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Badge tone="brand">{k.keyword.toUpperCase()}</Badge>
                            {k.conflict && (
                              <Tooltip content="Também está em outra automação ativa">
                                <TriangleAlert className="size-4 text-amber-500" />
                              </Tooltip>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-zinc-400">
                            {k.ignoreAccents ? "ignora acentos" : "considera acentos"} · {k.caseSensitive ? "diferencia maiúsculas" : "ignora maiúsculas"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Tooltip content={MATCH_TYPE_HELP[k.matchType]}>
                            <Select value={k.matchType} onChange={(e) => update(k, { matchType: e.target.value as MatchType })} className="h-8 min-w-44 text-xs" aria-label="Tipo de correspondência">
                              {MATCH_TYPES.map((m) => (
                                <option key={m} value={m}>
                                  {MATCH_TYPE_LABELS[m]}
                                </option>
                              ))}
                            </Select>
                          </Tooltip>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <Link to={`/app/automacoes/${k.automationId}`} className="font-medium hover:text-brand-700">
                            {k.automationName}
                          </Link>
                          <div className="mt-1 flex items-center gap-2">
                            <StatusBadge status={k.automationStatus} />
                            <span className="text-[11px] text-zinc-400">{TRIGGER_EVENT_INFO[k.triggerEvent as TriggerEvent]?.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{formatNumber(k.hits)}</td>
                        <td className="px-2 py-3">
                          <IconButton label="Remover palavra-chave" onClick={() => remove(k)}>
                            <X className="size-4" />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Simulator className="h-[460px]" />
          <Card>
            <CardTitle title="Como a prioridade funciona" />
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-600">
              <li>Automações com palavra-chave vencem as que respondem a qualquer mensagem.</li>
              <li>Gatilhos específicos (ex.: resposta ao Story) vêm antes do Direct comum.</li>
              <li>Maior prioridade manual vence (defina na automação).</li>
              <li>Em empate, vence a palavra mais específica: “link produto” vence “link”.</li>
              <li>Cada mensagem aciona no máximo uma automação.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
