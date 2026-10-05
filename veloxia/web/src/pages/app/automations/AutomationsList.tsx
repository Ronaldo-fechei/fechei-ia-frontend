import {
  Archive,
  Copy,
  Ellipsis,
  Eye,
  LayoutTemplate,
  MousePointerClick,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { NODE_INFO, type AutomationStatus, type NodeType } from "@veloxia/shared";
import { AiGenerateModal } from "../../../components/automation/AiGenerateModal";
import { StatusBadge, TriggerBadge } from "../../../components/automation/badges";
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PageHeader,
  Skeleton,
  Switch,
  Tabs,
  Tooltip,
} from "../../../components/ui";
import { useAutomationActions, useAutomations } from "../../../hooks/useAutomations";
import { formatNumber, relativeTime } from "../../../lib/format";
import type { AutomationSummary } from "../../../lib/types";
import { api } from "../../../lib/api";
import { toast } from "sonner";

export function NewAutomationMenu({ label = "Nova automação" }: { label?: string }) {
  const navigate = useNavigate();
  const [aiOpen, setAiOpen] = useState(false);
  const createFlow = async () => {
    try {
      const { automation } = await api.post<{ automation: { id: string } }>("/automations", { name: "Nova automação", mode: "flow", triggerEvent: "dm" });
      navigate(`/app/automacoes/${automation.id}/fluxo`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button icon={<Plus className="size-4" />}>{label}</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<Zap />} onSelect={() => navigate("/app/automacoes/nova")}>
            <div>
              <p className="font-medium">Criação rápida</p>
              <p className="text-xs text-zinc-500">Palavra-chave → resposta, em um formulário</p>
            </div>
          </MenuItem>
          <MenuItem icon={<Workflow />} onSelect={createFlow}>
            <div>
              <p className="font-medium">Construtor visual</p>
              <p className="text-xs text-zinc-500">Fluxos com botões, condições e esperas</p>
            </div>
          </MenuItem>
          <MenuItem icon={<LayoutTemplate />} onSelect={() => navigate("/app/modelos")}>
            <div>
              <p className="font-medium">Usar um modelo</p>
              <p className="text-xs text-zinc-500">Link, FAQ, captura de lead e mais</p>
            </div>
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Sparkles />} onSelect={() => setAiOpen(true)}>
            <div>
              <p className="font-medium">Gerar automação com IA</p>
              <p className="text-xs text-zinc-500">Descreva e revise antes de publicar</p>
            </div>
          </MenuItem>
        </MenuContent>
      </Menu>
      <AiGenerateModal open={aiOpen} onOpenChange={setAiOpen} />
    </>
  );
}

function AutomationCard({ a }: { a: AutomationSummary }) {
  const navigate = useNavigate();
  const { setStatus, duplicate, remove } = useAutomationActions();
  const editPath = a.mode === "flow" ? `/app/automacoes/${a.id}/fluxo` : `/app/automacoes/${a.id}/editar`;
  const canToggle = a.status !== "archived";
  return (
    <Card className="flex flex-col gap-4 transition-shadow hover:shadow-pop" padded>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/app/automacoes/${a.id}`} className="block truncate text-base font-semibold text-zinc-900 hover:text-brand-700">
            {a.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            <TriggerBadge event={a.triggerEvent} />
            {a.hasUnpublishedChanges && a.publishedAt && <Badge tone="yellow">alterações não publicadas</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canToggle && (
            <Tooltip content={a.status === "active" ? "Pausar" : "Ativar"}>
              <span>
                <Switch
                  checked={a.status === "active"}
                  label={a.status === "active" ? "Pausar automação" : "Ativar automação"}
                  disabled={setStatus.isPending}
                  onCheckedChange={(v) => setStatus.mutate({ id: a.id, status: v ? "active" : "paused" })}
                />
              </span>
            </Tooltip>
          )}
          <Menu>
            <MenuTrigger asChild>
              <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="Mais ações">
                <Ellipsis className="size-5" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Eye />} onSelect={() => navigate(`/app/automacoes/${a.id}`)}>
                Visualizar
              </MenuItem>
              <MenuItem icon={<Pencil />} onSelect={() => navigate(editPath)}>
                Editar
              </MenuItem>
              {a.mode === "quick" && (
                <MenuItem icon={<Workflow />} onSelect={() => navigate(`/app/automacoes/${a.id}/fluxo`)}>
                  Abrir no construtor visual
                </MenuItem>
              )}
              <MenuItem icon={<Copy />} onSelect={() => duplicate.mutate(a.id)}>
                Duplicar
              </MenuItem>
              {a.status !== "archived" ? (
                <MenuItem icon={<Archive />} onSelect={() => setStatus.mutate({ id: a.id, status: "archived" })}>
                  Arquivar
                </MenuItem>
              ) : (
                <MenuItem icon={<Archive />} onSelect={() => setStatus.mutate({ id: a.id, status: "draft" })}>
                  Restaurar como rascunho
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem icon={<Trash />} danger onSelect={() => remove(a.id, a.name)}>
                Excluir
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      {a.status === "error" && a.errorMessage && <Callout tone="error">{a.errorMessage}</Callout>}

      <div>
        <p className="mb-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">Gatilhos</p>
        {a.keywords.length ? (
          <div className="flex flex-wrap gap-1.5">
            {a.keywords.slice(0, 8).map((k) => (
              <Badge key={k} tone="brand">
                {k.toUpperCase()}
              </Badge>
            ))}
            {a.keywords.length > 8 && <Badge>+{a.keywords.length - 8}</Badge>}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{a.triggerEvent === "story_mention" ? "Qualquer menção em Story" : "Qualquer mensagem (sem palavra-chave)"}</p>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">Ações</p>
        <p className="text-sm text-zinc-700">{a.actions.map((t) => NODE_INFO[t as NodeType]?.label ?? t).join(" · ") || "—"}</p>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-3 text-sm">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-zinc-700">
            <Zap className="size-4 text-brand-600" />
            <strong>{formatNumber(a.executionsCount)}</strong> disparos
          </span>
          <span className="flex items-center gap-1.5 text-zinc-700">
            <MousePointerClick className="size-4 text-sky-600" />
            <strong>{formatNumber(a.linkClicks)}</strong> cliques
          </span>
        </div>
        <span className="text-xs text-zinc-400">{a.lastTriggeredAt ? `último ${relativeTime(a.lastTriggeredAt)}` : "nunca disparou"}</span>
      </div>
    </Card>
  );
}

const TABS: { value: "all" | AutomationStatus; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "paused", label: "Pausadas" },
  { value: "draft", label: "Rascunhos" },
  { value: "error", label: "Com erro" },
  { value: "archived", label: "Arquivadas" },
];

export default function AutomationsList() {
  const [tab, setTab] = useState<"all" | AutomationStatus>("all");
  const [q, setQ] = useState("");
  const { data, isLoading } = useAutomations({ status: tab === "all" ? undefined : tab, q: q || undefined, kind: "standard" });
  const list = data?.automations ?? [];

  return (
    <div>
      <PageHeader
        title="Minhas automações"
        description="Cada automação responde automaticamente quando uma palavra-chave aparece no Direct, nos comentários ou nos Stories."
        actions={<NewAutomationMenu />}
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onChange={setTab} items={TABS} className="flex-1" />
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome" className="pl-9" aria-label="Buscar automação" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Zap className="size-6" />}
            title={q || tab !== "all" ? "Nenhuma automação encontrada" : "Crie sua primeira automação"}
            description={
              q || tab !== "all"
                ? "Tente outro filtro ou termo de busca."
                : "Escolha uma palavra-chave (como “link” ou “preço”) e a resposta que deve ser enviada automaticamente."
            }
            action={
              !q && tab === "all" ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <ButtonLink to="/app/automacoes/nova" icon={<Plus className="size-4" />}>
                    Nova automação
                  </ButtonLink>
                  <ButtonLink to="/app/modelos" variant="secondary" icon={<LayoutTemplate className="size-4" />}>
                    Ver modelos
                  </ButtonLink>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <AutomationCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
