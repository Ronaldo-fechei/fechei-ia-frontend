import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageOff, LayoutTemplate, MessageCircle, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { StatusBadge } from "../../../components/automation/badges";
import { Badge, Button, ButtonLink, Callout, Card, CardTitle, EmptyState, PageHeader, Skeleton } from "../../../components/ui";
import { useAutomations } from "../../../hooks/useAutomations";
import { api, errorMessage } from "../../../lib/api";
import { formatNumber, relativeTime } from "../../../lib/format";
import type { InstagramAccount } from "../../../lib/types";

interface MediaSummary {
  mediaId: string | null;
  mediaProductType: string | null;
  comments: number;
  matched: number;
  dmsSent: number;
  dmsFailed: number;
  conversions: number;
  lastAt: string;
  keywords: string[];
}

interface CommentRow {
  id: string;
  text: string | null;
  fromUsername: string | null;
  matchedKeyword: string | null;
  privateReplyStatus: "none" | "sent" | "failed" | "skipped";
  publicReplyStatus: "none" | "sent" | "failed";
  convertedAt: string | null;
  createdAt: string;
  automationName: string | null;
}

interface Media {
  id: string;
  caption?: string;
  media_url?: string;
  thumbnail_url?: string;
  media_type?: string;
  permalink?: string;
}

const DM_STATUS: Record<CommentRow["privateReplyStatus"], { label: string; tone: "green" | "red" | "gray" }> = {
  sent: { label: "DM enviada", tone: "green" },
  failed: { label: "DM falhou", tone: "red" },
  skipped: { label: "Ignorado", tone: "gray" },
  none: { label: "Sem automação", tone: "gray" },
};

export default function CommentsPage() {
  const navigate = useNavigate();
  const { data: automations, isLoading } = useAutomations({ triggerEvent: "comment" });
  const summary = useQuery({ queryKey: ["comments", "summary"], queryFn: () => api.get<{ media: MediaSummary[] }>("/comments/summary?days=30") });
  const recent = useQuery({ queryKey: ["comments", "recent"], queryFn: () => api.get<{ comments: CommentRow[] }>("/comments?pageSize=15") });
  const accounts = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api.get<{ accounts: InstagramAccount[] }>("/instagram/accounts") });
  const account = accounts.data?.accounts[0];
  const media = useQuery({
    queryKey: ["instagram-media", account?.id],
    queryFn: () => api.get<{ media: Media[] }>(`/instagram/accounts/${account!.id}/media`),
    enabled: !!account && account.status === "connected" && !!summary.data?.media.length,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const mediaById = useMemo(() => new Map((media.data?.media ?? []).map((m) => [m.id, m])), [media.data]);

  const useTemplate = async () => {
    try {
      const { automation } = await api.post<{ automation: { id: string } }>("/automations/from-template", { templateId: "comentario-dm" });
      navigate(`/app/automacoes/${automation.id}/fluxo`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comentários → DM"
        description="“Comente LINK para receber”: quem comentar a palavra recebe a mensagem no Direct pela resposta privada oficial."
        actions={
          <>
            <Button variant="secondary" icon={<LayoutTemplate className="size-4" />} onClick={useTemplate}>
              Usar modelo
            </Button>
            <ButtonLink to="/app/automacoes/nova?gatilho=comment" icon={<Plus className="size-4" />}>
              Nova automação de comentário
            </ButtonLink>
          </>
        }
      />
      {account && !account.permissions.comments && (
        <Callout tone="warning" title="Permissão de comentários não concedida">
          Reconecte o Instagram e autorize “instagram_business_manage_comments” para usar este recurso.
        </Callout>
      )}
      <Callout tone="info">
        Regras da Meta: 1 resposta privada por comentário, em até 7 dias. As próximas mensagens só são entregues depois que a pessoa responder no Direct —
        por isso a primeira mensagem deve conter o link ou um botão para continuar.
      </Callout>

      <Card>
        <CardTitle title="Automações de comentário" />
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : !automations?.automations.length ? (
          <EmptyState icon={<MessageCircle className="size-6" />} title="Nenhuma automação de comentário" description="Crie uma para transformar comentários em conversas no Direct." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {automations.automations.map((a) => (
              <li key={a.id}>
                <Link to={`/app/automacoes/${a.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-zinc-50">
                  <span className="min-w-0 flex-1 font-medium">{a.name}</span>
                  <span className="flex flex-wrap gap-1">
                    {a.keywords.length ? a.keywords.slice(0, 4).map((k) => <Badge key={k} tone="brand">{k.toUpperCase()}</Badge>) : <Badge>Qualquer comentário</Badge>}
                  </span>
                  <span className="text-sm text-zinc-500">{formatNumber(a.executionsCount)} disparos</span>
                  <StatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardTitle title="Desempenho por publicação" description="Últimos 30 dias" />
        </div>
        {summary.isLoading ? (
          <Skeleton className="m-5 h-40" />
        ) : !summary.data?.media.length ? (
          <p className="px-5 pb-6 text-sm text-zinc-500">Nenhum comentário recebido nos últimos 30 dias.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-zinc-200 bg-zinc-50 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase">
                <tr>
                  <th className="px-5 py-3">Publicação</th>
                  <th className="px-4 py-3">Palavras-chave</th>
                  <th className="px-4 py-3 text-right">Comentários</th>
                  <th className="px-4 py-3 text-right">DMs enviadas</th>
                  <th className="px-4 py-3 text-right">Conversões</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {summary.data.media.map((m) => {
                  const info = m.mediaId ? mediaById.get(m.mediaId) : undefined;
                  const img = info?.thumbnail_url ?? (info?.media_type !== "VIDEO" ? info?.media_url : undefined);
                  return (
                    <tr key={m.mediaId ?? "sem-midia"}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100">
                            {img ? <img src={img} alt="" className="size-full object-cover" /> : <ImageOff className="size-5 text-zinc-400" />}
                          </span>
                          <div className="min-w-0">
                            <p className="line-clamp-2 max-w-xs text-sm">{info?.caption ?? (m.mediaProductType === "REELS" ? "Reel" : "Publicação")}</p>
                            <p className="text-xs text-zinc-400">
                              último comentário {relativeTime(m.lastAt)}
                              {info?.permalink && (
                                <a href={info.permalink} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-brand-700 hover:underline">
                                  abrir <ExternalLink className="size-3" />
                                </a>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {m.keywords.length ? m.keywords.map((k) => <Badge key={k} tone="brand">{k.toUpperCase()}</Badge>) : <span className="text-zinc-400">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatNumber(m.comments)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatNumber(m.dmsSent)}
                        {m.dmsFailed > 0 && <span className="block text-xs text-red-600">{m.dmsFailed} falha(s)</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatNumber(m.conversions)}
                        {m.dmsSent > 0 && <span className="block text-xs text-zinc-400">{Math.round((m.conversions / m.dmsSent) * 100)}%</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 text-xs text-zinc-400">Conversão = pessoa que respondeu no Direct ou clicou no link após receber a DM.</p>
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardTitle title="Comentários recentes" />
        </div>
        {!recent.data?.comments.length ? (
          <p className="px-5 pb-6 text-sm text-zinc-500">Nenhum comentário recebido ainda.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {recent.data.comments.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">@{c.fromUsername ?? "usuário"}</span> <span className="text-zinc-600">“{c.text}”</span>
                  </p>
                  <p className="text-xs text-zinc-400">
                    {relativeTime(c.createdAt)}
                    {c.automationName && ` · ${c.automationName}`}
                    {c.matchedKeyword && ` · palavra ${c.matchedKeyword.toUpperCase()}`}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Badge tone={DM_STATUS[c.privateReplyStatus].tone}>{DM_STATUS[c.privateReplyStatus].label}</Badge>
                  {c.publicReplyStatus === "sent" && <Badge tone="blue">Respondido no post</Badge>}
                  {c.convertedAt && <Badge tone="violet">Converteu</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
