import { Plus, Radio, UserPlus, Zap } from "lucide-react";
import { Link } from "react-router";
import { TRIGGER_EVENT_INFO } from "@veloxia/shared";
import { StatusBadge, TriggerBadge } from "../../../components/automation/badges";
import { Badge, ButtonLink, Callout, Card, CardTitle, EmptyState, PageHeader, Skeleton } from "../../../components/ui";
import { useAutomations } from "../../../hooks/useAutomations";
import { formatNumber } from "../../../lib/format";

export default function StoriesPage() {
  const replies = useAutomations({ triggerEvent: "story_reply" });
  const mentions = useAutomations({ triggerEvent: "story_mention" });
  const list = [...(replies.data?.automations ?? []), ...(mentions.data?.automations ?? [])];
  const loading = replies.isLoading || mentions.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stories"
        description="Responda automaticamente quem reagir aos seus Stories ou mencionar sua conta."
        actions={
          <>
            <ButtonLink to="/app/automacoes/nova?gatilho=story_mention" variant="secondary" icon={<Radio className="size-4" />}>
              Menção em Story
            </ButtonLink>
            <ButtonLink to="/app/automacoes/nova?gatilho=story_reply" icon={<Plus className="size-4" />}>
              Resposta ao Story
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        {(["story_reply", "story_mention", "new_follower"] as const).map((ev) => {
          const info = TRIGGER_EVENT_INFO[ev];
          return (
            <Card key={ev} className={info.available ? "" : "bg-zinc-50"}>
              <div className="flex items-center gap-2">
                {ev === "new_follower" ? <UserPlus className="size-5 text-zinc-400" /> : ev === "story_mention" ? <Radio className="size-5 text-brand-600" /> : <Zap className="size-5 text-brand-600" />}
                <p className="font-semibold">{info.label}</p>
                {!info.available && <Badge>Indisponível</Badge>}
              </div>
              <p className="mt-2 text-sm text-zinc-600">{info.available ? info.description : info.unavailableReason}</p>
            </Card>
          );
        })}
      </div>

      <Callout tone="info">
        Respostas a Stories e menções chegam como mensagens no Direct, então você pode enviar texto, links, botões, capturar contatos e encaminhar para
        atendimento humano normalmente (dentro da janela de 24h).
      </Callout>

      <Card>
        <CardTitle title="Automações de Stories" />
        {loading ? (
          <Skeleton className="h-24" />
        ) : !list.length ? (
          <EmptyState
            icon={<Zap className="size-6" />}
            title="Nenhuma automação de Stories"
            description="Ex.: quem responder ao Story recebe o link da oferta; quem mencionar sua conta recebe um agradecimento."
            action={<ButtonLink to="/app/modelos">Ver modelos de Story</ButtonLink>}
          />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {list.map((a) => (
              <li key={a.id}>
                <Link to={`/app/automacoes/${a.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-zinc-50">
                  <span className="min-w-0 flex-1 font-medium">{a.name}</span>
                  <TriggerBadge event={a.triggerEvent} />
                  <span className="text-sm text-zinc-500">{formatNumber(a.executionsCount)} disparos</span>
                  <StatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
