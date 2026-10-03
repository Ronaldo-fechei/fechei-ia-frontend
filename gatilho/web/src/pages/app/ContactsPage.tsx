import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Contact as ContactIcon, Download, MessagesSquare, Search, Trash, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { CONTACT_SOURCES } from "@gatilho/shared";
import { ExecutionBadge } from "../../components/automation/badges";
import { Avatar, Badge, Button, ButtonLink, Card, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, TagPill, useConfirm } from "../../components/ui";
import { api, errorMessage, qs } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDate, formatDateTime, formatNumber, relativeTime } from "../../lib/format";
import type { ContactRow, ExecutionRow, TagItem } from "../../lib/types";
import { useTags } from "./automations/flow/NodeEditor";

interface ContactDetail {
  contact: ContactRow & { followerCount: number | null };
  fields: { id: string; key: string; label: string; type: string; isSystem: boolean; value: string | null }[];
  automations: { automationId: string | null; automationName: string; count: number; lastAt: string }[];
  conversation: { id: string; mode: string } | null;
  accountUsername: string | null;
  counts: { inbound: number; outbound: number };
}

function ContactDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["contact", id], queryFn: () => api.get<ContactDetail>(`/contacts/${id}`), enabled: !!id });
  const executions = useQuery({ queryKey: ["executions", { contactId: id }], queryFn: () => api.get<{ executions: ExecutionRow[] }>(`/executions?contactId=${id}&pageSize=15`), enabled: !!id });
  const { data: tags } = useTags();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.fields.map((f) => [f.key, f.value ?? ""])));
  }, [data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["contact", id] });
    qc.invalidateQueries({ queryKey: ["contacts"] });
  };

  const toggleTag = async (tag: TagItem, add: boolean) => {
    try {
      if (add) await api.post(`/contacts/${id}/tags`, { tagId: tag.id });
      else await api.del(`/contacts/${id}/tags/${tag.id}`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const saveFields = async () => {
    setSaving(true);
    try {
      await api.put(`/contacts/${id}/fields`, { values });
      refresh();
      toast.success("Informações salvas");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (active: boolean) => {
    try {
      await api.patch(`/contacts/${id}`, { status: active ? "active" : "opted_out" });
      refresh();
      toast.success(active ? "Automações liberadas para este contato" : "Automações bloqueadas para este contato");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!data) return;
    const ok = await confirm({
      title: "Excluir contato?",
      description: "O contato, a conversa e todo o histórico de mensagens dele serão apagados definitivamente.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/contacts/${id}`);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contato excluído");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const c = data?.contact;
  const has = new Set(c?.tags.map((t) => t.id) ?? []);
  return (
    <Drawer open={!!id} onOpenChange={(o) => !o && onClose()} title={c ? c.name ?? (c.username ? `@${c.username}` : "Contato") : "Contato"} width="max-w-lg">
      {isLoading || !data || !c ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar src={c.profilePicUrl} name={c.name ?? c.username} size={64} />
            <div className="min-w-0">
              <p className="text-lg font-semibold">{c.name ?? "Sem nome"}</p>
              {c.username && (
                <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline">
                  @{c.username}
                </a>
              )}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge>{CONTACT_SOURCES[c.source] ?? c.source}</Badge>
                {c.isFollower !== null && <Badge tone={c.isFollower ? "green" : "gray"}>{c.isFollower ? "Segue você" : "Não segue"}</Badge>}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-zinc-50 p-4 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Instagram ID</dt>
              <dd className="truncate font-mono text-xs">{c.igsid}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Primeira interação</dt>
              <dd>{formatDate(c.firstInteractionAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Última interação</dt>
              <dd>{relativeTime(c.lastInteractionAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Última palavra-chave</dt>
              <dd>{c.lastKeyword ? c.lastKeyword.toUpperCase() : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Mensagens recebidas</dt>
              <dd>{formatNumber(data.counts.inbound)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Mensagens enviadas</dt>
              <dd>{formatNumber(data.counts.outbound)}</dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3">
            <div>
              <p className="text-sm font-medium">Receber respostas automáticas</p>
              <p className="text-xs text-zinc-500">Desative para que nenhuma automação responda este contato.</p>
            </div>
            <Switch checked={c.status === "active"} onCheckedChange={setStatus} label="Respostas automáticas" />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {(tags?.tags ?? []).map((t) => (
                <button key={t.id} type="button" onClick={() => toggleTag(t, !has.has(t.id))} className={cn(!has.has(t.id) && "opacity-40 hover:opacity-80")}>
                  <TagPill name={t.name} color={t.color} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold">Informações do contato</p>
            <div className="space-y-3">
              {data.fields.map((f) => (
                <Field key={f.id} label={f.label}>
                  <Input
                    value={values[f.key] ?? ""}
                    type={f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
              <Button size="sm" onClick={saveFields} loading={saving}>
                Salvar informações
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Automações acionadas</p>
            {data.automations.length ? (
              <ul className="space-y-1.5 text-sm">
                {data.automations.map((a) => (
                  <li key={`${a.automationId}-${a.automationName}`} className="flex items-center justify-between gap-2">
                    {a.automationId ? (
                      <Link to={`/app/automacoes/${a.automationId}`} className="truncate text-brand-700 hover:underline">
                        {a.automationName}
                      </Link>
                    ) : (
                      <span className="truncate">{a.automationName}</span>
                    )}
                    <span className="shrink-0 text-xs text-zinc-500">
                      {a.count}× · {relativeTime(a.lastAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Nenhuma automação acionada.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Histórico</p>
            {executions.data?.executions.length ? (
              <ul className="space-y-2">
                {executions.data.executions.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-100 p-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">“{e.inboundText}”</p>
                      <p className="text-xs text-zinc-500">
                        {e.automationName} · {formatDateTime(e.startedAt)}
                      </p>
                    </div>
                    <ExecutionBadge status={e.status} skipReason={e.skipReason} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Sem histórico de automações.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
            {data.conversation && (
              <ButtonLink to={`/app/conversas/${data.conversation.id}`} variant="secondary" icon={<MessagesSquare className="size-4" />}>
                Abrir conversa
              </ButtonLink>
            )}
            <Button variant="ghost" icon={<Trash className="size-4" />} onClick={remove} className="text-red-600 hover:bg-red-50">
              Excluir contato
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function ContactsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tagId, setTagId] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const { data: tags } = useTags();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useQuery({
    queryKey: ["contacts", { q: debounced, tagId, source, page }],
    queryFn: () => api.get<{ contacts: ContactRow[]; total: number; hasMore: boolean }>(`/contacts${qs({ q: debounced, tagId, source, page, pageSize: 25 })}`),
    placeholderData: (prev) => prev,
  });

  return (
    <div>
      <PageHeader
        title="Contatos"
        description={data ? `${formatNumber(data.total)} contato(s) capturado(s) pelo Direct, comentários e Stories.` : "Pessoas que interagiram com sua conta."}
        actions={
          <a href="/api/contacts/export.csv" className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50">
            <Download className="size-4" /> Exportar CSV
          </a>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, @ ou ID" className="pl-9" aria-label="Buscar contatos" />
        </div>
        <Select value={tagId} onChange={(e) => { setTagId(e.target.value); setPage(1); }} aria-label="Filtrar por tag">
          <option value="">Todas as tags</option>
          {tags?.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} aria-label="Filtrar por origem">
          <option value="">Todas as origens</option>
          {Object.entries(CONTACT_SOURCES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      <Card padded={false} className="overflow-hidden">
        {isLoading ? (
          <Skeleton className="m-4 h-64" />
        ) : !data?.contacts.length ? (
          <EmptyState icon={<ContactIcon className="size-6" />} title="Nenhum contato" description={debounced || tagId || source ? "Nada encontrado com esses filtros." : "Quem enviar mensagens, comentar ou responder Stories aparece aqui automaticamente."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Contato</th>
                  <th className="hidden px-4 py-3 md:table-cell">Tags</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Última palavra</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Origem</th>
                  <th className="px-4 py-3">Última interação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.contacts.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => navigate(`/app/contatos/${c.id}`)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={c.profilePicUrl} name={c.name ?? c.username} size={34} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{c.name ?? (c.username ? `@${c.username}` : "Contato")}</p>
                          <p className="truncate text-xs text-zinc-500">
                            {c.username ? `@${c.username}` : c.igsid}
                            {c.status !== "active" && <span className="ml-1 text-red-600">· automações bloqueadas</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <TagPill key={t.id} name={t.name} color={t.color} />
                        ))}
                        {c.tags.length > 3 && <span className="text-xs text-zinc-400">+{c.tags.length - 3}</span>}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      {c.lastKeyword ? (
                        <Badge tone="brand">
                          <Zap className="size-3" />
                          {c.lastKeyword.toUpperCase()}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-zinc-600 sm:table-cell">{CONTACT_SOURCES[c.source] ?? c.source}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600">{relativeTime(c.lastInteractionAt)}</td>
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
      <ContactDrawer id={id ?? null} onClose={() => navigate("/app/contatos")} />
    </div>
  );
}
