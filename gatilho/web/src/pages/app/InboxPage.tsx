import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CircleAlert, Hand, Headphones, Info, MessagesSquare, Play, Search, Send, Zap } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { CONTACT_SOURCES, LIMITS } from "@gatilho/shared";
import { OutboundContentView } from "../../components/automation/Bubbles";
import { skipReasonLabel } from "../../components/automation/badges";
import { Avatar, Badge, Button, ButtonLink, Callout, Drawer, EmptyState, Input, Skeleton, TagPill, Textarea } from "../../components/ui";
import { api, errorMessage, qs } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDate, formatDateTime, formatTime, relativeTime, shortStamp } from "../../lib/format";
import type { ConversationRow, MessageRow, TagItem } from "../../lib/types";
import { useTags } from "./automations/flow/NodeEditor";

type Filter = "all" | "unread" | "human" | "automation" | "closed";

interface ConversationDetail {
  conversation: { id: string; status: "open" | "closed"; mode: "automation" | "human"; humanSince: string | null; humanByName: string | null; unreadCount: number };
  contact: {
    id: string;
    igsid: string;
    username: string | null;
    name: string | null;
    profilePicUrl: string | null;
    source: string;
    isFollower: boolean | null;
    firstInteractionAt: string;
    lastInteractionAt: string;
    lastKeyword: string | null;
    tags: TagItem[];
  };
  window: { open: boolean; humanAgent: boolean; canReply: boolean; closesAt: string | null };
  account: { username: string; status: string } | null;
}

function ConversationList({ activeId }: { activeId?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useQuery({
    queryKey: ["conversations", { filter, q: debounced }],
    queryFn: () => api.get<{ conversations: ConversationRow[]; counts: { unread: number; human: number } }>(`/conversations${qs({ filter, q: debounced, pageSize: 60 })}`),
    refetchInterval: 30_000,
  });
  const filters: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "Todas" },
    { value: "unread", label: "Não lidas", count: data?.counts.unread },
    { value: "human", label: "Humano", count: data?.counts.human },
    { value: "automation", label: "Robô" },
    { value: "closed", label: "Fechadas" },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-zinc-200 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome, @ ou mensagem" className="pl-9" aria-label="Buscar conversas" />
        </div>
        <div className="scrollbar-thin flex gap-1 overflow-x-auto">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn("flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", filter === f.value ? "bg-ink-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200")}
            >
              {f.label}
              {!!f.count && <span className={cn("rounded-full px-1 text-[10px]", filter === f.value ? "bg-white/20" : "bg-white")}>{f.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : !data?.conversations.length ? (
          <EmptyState icon={<MessagesSquare className="size-6" />} title="Nenhuma conversa" description={filter === "all" && !debounced ? "As mensagens recebidas no Direct aparecem aqui." : "Nada encontrado com esse filtro."} />
        ) : (
          <ul>
            {data.conversations.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/app/conversas/${c.id}`}
                  className={cn("flex gap-3 border-b border-zinc-100 px-3 py-3 transition-colors", activeId === c.id ? "bg-brand-50/70" : "hover:bg-zinc-50")}
                >
                  <Avatar src={c.contactPic} name={c.contactName ?? c.contactUsername} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={cn("truncate text-sm", c.unreadCount ? "font-semibold text-zinc-900" : "font-medium text-zinc-800")}>
                        {c.contactName ?? (c.contactUsername ? `@${c.contactUsername}` : "Contato")}
                      </p>
                      <span className="shrink-0 text-[11px] text-zinc-400">{shortStamp(c.lastMessageAt)}</span>
                    </div>
                    {c.contactName && c.contactUsername && <p className="truncate text-xs text-zinc-400">@{c.contactUsername}</p>}
                    <p className={cn("truncate text-sm", c.unreadCount ? "text-zinc-800" : "text-zinc-500")}>
                      {c.lastMessageDirection === "outbound" && <span className="text-zinc-400">Você: </span>}
                      {c.lastMessagePreview}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {c.mode === "human" ? (
                        <Badge tone="violet">
                          <Headphones className="size-3" /> humano
                        </Badge>
                      ) : (
                        c.lastAutomationName && (
                          <Badge tone="gray">
                            <Zap className="size-3" /> {c.lastAutomationName}
                          </Badge>
                        )
                      )}
                      {c.tags.slice(0, 2).map((t) => (
                        <TagPill key={t.id} name={t.name} color={t.color} />
                      ))}
                    </div>
                  </div>
                  {c.unreadCount > 0 && <span className="mt-1 h-fit rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{c.unreadCount}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function sourceLabel(m: MessageRow): string {
  if (m.source === "automation") return m.automationName ? `Automação · ${m.automationName}` : "Automação";
  if (m.source === "agent") return m.sentByName ? `Você · ${m.sentByName}` : "Atendente";
  if (m.source === "instagram_app") return "Enviada pelo app do Instagram";
  return "";
}

function MessageItem({ m }: { m: MessageRow }) {
  const outbound = m.direction === "outbound";
  const content = m.payload?.content;
  const attachments: { type?: string; payload?: { url?: string } }[] = m.payload?.attachments ?? [];
  const storyReply = m.payload?.replyTo?.story;
  return (
    <div className={cn("flex flex-col gap-1", outbound ? "items-end" : "items-start")}>
      {storyReply && <p className="text-[11px] text-zinc-400">Respondeu ao seu Story</p>}
      {m.status === "deleted" ? (
        <div className="rounded-2xl bg-zinc-100 px-3.5 py-2 text-sm text-zinc-400 italic">Mensagem apagada</div>
      ) : content && outbound ? (
        <div className="w-full">
          <OutboundContentView content={content} side="right" />
        </div>
      ) : (
        <>
          {attachments
            .filter((a) => a.type === "image" && a.payload?.url)
            .map((a, i) => (
              <img key={i} src={a.payload!.url} alt="Imagem recebida" className="max-h-56 max-w-[70%] rounded-2xl ring-1 ring-zinc-200" />
            ))}
          {(m.text || !attachments.length) && (
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap",
                outbound ? (m.source === "automation" ? "rounded-br-md bg-brand-600 text-white" : "rounded-br-md bg-ink-800 text-white") : "rounded-bl-md bg-white text-zinc-900 ring-1 ring-zinc-200",
              )}
            >
              {m.text || (m.type === "story_mention" ? "📣 Mencionou você em um Story" : `[${m.type}]`)}
            </div>
          )}
        </>
      )}
      <div className={cn("flex items-center gap-1.5 text-[11px] text-zinc-400", outbound && "flex-row-reverse")}>
        <span>{formatTime(m.createdAt)}</span>
        {outbound && sourceLabel(m) && <span>· {sourceLabel(m)}</span>}
        {m.status === "failed" && (
          <span className="flex items-center gap-1 text-red-600">
            <CircleAlert className="size-3" /> {m.errorMessage ?? "Falha no envio"}
          </span>
        )}
        {m.status === "sending" && <span>· enviando…</span>}
      </div>
      {m.trigger && (
        <p className="flex items-center gap-1 text-[11px] text-zinc-500">
          <Zap className="size-3 text-brand-500" />
          {m.trigger.status === "skipped" ? `Não respondida: ${skipReasonLabel(m.trigger.skipReason)}` : `Acionou “${m.trigger.automationName}”`}
          {m.trigger.keyword && ` · palavra ${m.trigger.keyword.toUpperCase()}`}
        </p>
      )}
    </div>
  );
}

function Thread({ id, onShowInfo }: { id: string; onShowInfo: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`) });
  const messages = useInfiniteQuery({
    queryKey: ["messages", id],
    queryFn: ({ pageParam }) => api.get<{ messages: MessageRow[]; hasMore: boolean }>(`/conversations/${id}/messages${qs({ before: pageParam, limit: 50 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.createdAt : undefined),
  });
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (messages.data?.pages ?? []).slice().reverse().flatMap((p) => p.messages), [messages.data]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [all.length, id]);

  useEffect(() => {
    if (detail.data?.conversation.unreadCount) {
      api.post(`/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ["conversations"] })).catch(() => undefined);
    }
  }, [detail.data?.conversation.unreadCount, id, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };
  const takeover = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/takeover`),
    onSuccess: () => {
      refresh();
      toast.success("Você assumiu a conversa", { description: "As automações estão pausadas para este contato." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resume = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/resume`),
    onSuccess: () => {
      refresh();
      toast.success("Automação retomada", { description: "As automações voltam a responder este contato." });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setStatus = useMutation({
    mutationFn: (status: "open" | "closed") => api.post(`/conversations/${id}/status`, { status }),
    onSuccess: refresh,
  });
  const send = useMutation({
    mutationFn: (body: string) => api.post(`/conversations/${id}/messages`, { text: body }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: ["messages", id] });
    },
  });

  if (detail.isLoading) return <Skeleton className="m-4 h-96" />;
  if (detail.isError || !detail.data) return <EmptyState title="Conversa não encontrada" />;
  const { conversation, contact, window: win } = detail.data;
  const human = conversation.mode === "human";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) send.mutate(text.trim());
  };

  let lastDay = "";
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2.5 sm:px-4">
        <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden" onClick={() => navigate("/app/conversas")} aria-label="Voltar">
          <ArrowLeft className="size-5" />
        </button>
        <Avatar src={contact.profilePicUrl} name={contact.name ?? contact.username} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{contact.name ?? (contact.username ? `@${contact.username}` : "Contato")}</p>
          <p className="truncate text-xs text-zinc-500">
            {contact.username && `@${contact.username} · `}
            {human ? `Atendimento humano${conversation.humanByName ? ` (${conversation.humanByName})` : ""}` : "Automação ativa"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {human ? (
            <Button size="sm" variant="secondary" icon={<Play className="size-4" />} loading={resume.isPending} onClick={() => resume.mutate()}>
              <span className="hidden sm:inline">Retomar automação</span>
            </Button>
          ) : (
            <Button size="sm" icon={<Hand className="size-4" />} loading={takeover.isPending} onClick={() => takeover.mutate()}>
              <span className="hidden sm:inline">Assumir conversa</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => setStatus.mutate(conversation.status === "open" ? "closed" : "open")}>
            {conversation.status === "open" ? "Fechar" : "Reabrir"}
          </Button>
          <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 xl:hidden" onClick={onShowInfo} aria-label="Informações do contato">
            <Info className="size-5" />
          </button>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto bg-zinc-50 px-3 py-4 sm:px-6">
        {messages.hasNextPage && (
          <div className="text-center">
            <Button size="xs" variant="secondary" onClick={() => messages.fetchNextPage()} loading={messages.isFetchingNextPage}>
              Carregar mensagens anteriores
            </Button>
          </div>
        )}
        {messages.isLoading && <Skeleton className="h-40" />}
        {all.map((m) => {
          const day = formatDate(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={m.id}>
              {showDay && (
                <div className="flex justify-center py-1">
                  <span className="rounded-full bg-white px-3 py-0.5 text-[11px] text-zinc-500 ring-1 ring-zinc-200">{day}</span>
                </div>
              )}
              <MessageItem m={m} />
            </Fragment>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-zinc-200 bg-white p-3">
        {!human ? (
          <div className="flex flex-col items-start gap-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              <Bot className="size-4 text-brand-600" /> As automações estão respondendo este contato.
            </span>
            <Button size="sm" icon={<Hand className="size-4" />} onClick={() => takeover.mutate()} loading={takeover.isPending}>
              Assumir conversa
            </Button>
          </div>
        ) : !win.canReply ? (
          <Callout tone="warning">
            A janela de 24h da Meta para responder este contato terminou. Você poderá responder quando ele enviar uma nova mensagem.
          </Callout>
        ) : (
          <form onSubmit={submit} className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim()) send.mutate(text.trim());
                }
              }}
              rows={1}
              maxLength={LIMITS.textMaxLength}
              placeholder="Escreva uma mensagem…  (Enter envia, Shift+Enter quebra linha)"
              className="max-h-40 min-h-11 resize-none"
              aria-label="Mensagem"
            />
            <Button type="submit" loading={send.isPending} disabled={!text.trim()} icon={<Send className="size-4" />} className="h-11">
              <span className="hidden sm:inline">Enviar</span>
            </Button>
          </form>
        )}
        {human && win.canReply && win.closesAt && (
          <p className="mt-1.5 text-[11px] text-zinc-400">
            {win.humanAgent ? "Fora das 24h: envio com a etiqueta HUMAN_AGENT da Meta" : "Janela de resposta aberta"} até {formatDateTime(win.closesAt)}.
          </p>
        )}
      </div>
    </div>
  );
}

function ContactPanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`) });
  const { data: tags } = useTags();
  if (!detail.data) return <Skeleton className="m-4 h-60" />;
  const { contact } = detail.data;
  const has = new Set(contact.tags.map((t) => t.id));
  const toggleTag = async (tagId: string, add: boolean) => {
    try {
      if (add) await api.post(`/contacts/${contact.id}/tags`, { tagId });
      else await api.del(`/contacts/${contact.id}/tags/${tagId}`);
      qc.invalidateQueries({ queryKey: ["conversation", id] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-col items-center text-center">
        <Avatar src={contact.profilePicUrl} name={contact.name ?? contact.username} size={64} />
        <p className="mt-2 font-semibold">{contact.name ?? "Sem nome"}</p>
        {contact.username && (
          <a href={`https://instagram.com/${contact.username}`} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline">
            @{contact.username}
          </a>
        )}
        {contact.isFollower !== null && <Badge tone={contact.isFollower ? "green" : "gray"} className="mt-2">{contact.isFollower ? "Segue você" : "Não segue você"}</Badge>}
      </div>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-500">Origem</dt>
          <dd>{CONTACT_SOURCES[contact.source] ?? contact.source}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-500">Primeira interação</dt>
          <dd>{formatDate(contact.firstInteractionAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-500">Última interação</dt>
          <dd>{relativeTime(contact.lastInteractionAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-500">Última palavra-chave</dt>
          <dd>{contact.lastKeyword ? contact.lastKeyword.toUpperCase() : "—"}</dd>
        </div>
      </dl>
      <div>
        <p className="mb-2 text-sm font-medium">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {(tags?.tags ?? []).map((t) => (
            <button key={t.id} type="button" onClick={() => toggleTag(t.id, !has.has(t.id))} className={cn("rounded-full transition-opacity", !has.has(t.id) && "opacity-40 hover:opacity-80")} title={has.has(t.id) ? "Remover tag" : "Adicionar tag"}>
              <TagPill name={t.name} color={t.color} />
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-zinc-400">Clique para adicionar ou remover.</p>
      </div>
      <ButtonLink to={`/app/contatos/${contact.id}`} variant="secondary" className="w-full">
        Ver contato completo
      </ButtonLink>
    </div>
  );
}

export default function InboxPage() {
  const { id } = useParams();
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="flex h-[calc(100dvh-4rem-4.5rem)] bg-white lg:h-[calc(100dvh-4rem)]">
      <aside className={cn("w-full shrink-0 border-r border-zinc-200 md:w-80 lg:w-96", id && "hidden md:block")}>
        <ConversationList activeId={id} />
      </aside>
      <section className={cn("min-w-0 flex-1", !id && "hidden md:block")}>
        {id ? (
          <Thread key={id} id={id} onShowInfo={() => setInfoOpen(true)} />
        ) : (
          <div className="flex h-full items-center justify-center bg-zinc-50">
            <EmptyState icon={<MessagesSquare className="size-6" />} title="Selecione uma conversa" description="O histórico completo e as informações do contato aparecem aqui." />
          </div>
        )}
      </section>
      {id && (
        <aside className="scrollbar-thin hidden w-80 shrink-0 overflow-y-auto border-l border-zinc-200 xl:block">
          <ContactPanel id={id} />
        </aside>
      )}
      {id && (
        <div className="xl:hidden">
          <Drawer open={infoOpen} onOpenChange={setInfoOpen} title="Contato" width="max-w-sm">
            <ContactPanel id={id} />
          </Drawer>
        </div>
      )}
    </div>
  );
}
