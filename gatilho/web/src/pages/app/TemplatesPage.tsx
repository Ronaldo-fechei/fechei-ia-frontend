import { useQuery } from "@tanstack/react-query";
import { CircleCheck, LayoutTemplate } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { NODE_INFO, type Flow, type NodeType } from "@gatilho/shared";
import { TriggerBadge } from "../../components/automation/badges";
import { Badge, Button, Card, EmptyState, PageHeader, Segmented, Skeleton } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  triggerEvent: string;
  highlights: string[];
  preview: Flow;
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState("Todos");
  const [using, setUsing] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["templates"], queryFn: () => api.get<{ templates: Template[] }>("/templates"), staleTime: Infinity });
  const categories = ["Todos", ...new Set((data?.templates ?? []).map((t) => t.category))];
  const list = (data?.templates ?? []).filter((t) => category === "Todos" || t.category === category);

  const use = async (t: Template) => {
    setUsing(t.id);
    try {
      const { automation } = await api.post<{ automation: { id: string } }>("/automations/from-template", { templateId: t.id });
      toast.success("Modelo copiado como rascunho", { description: "Revise os textos, preencha os links e publique." });
      navigate(`/app/automacoes/${automation.id}/fluxo`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUsing(null);
    }
  };

  return (
    <div>
      <PageHeader title="Modelos prontos" description="Comece com um fluxo pronto e ajuste do seu jeito. Nada é publicado sem a sua revisão." />
      <div className="mb-5 overflow-x-auto">
        <Segmented value={category} onChange={setCategory} items={categories.map((c) => ({ value: c, label: c }))} size="md" />
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-60" />
          ))}
        </div>
      ) : !list.length ? (
        <EmptyState icon={<LayoutTemplate className="size-6" />} title="Nenhum modelo nesta categoria" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const blocks = [...new Set(t.preview.nodes.filter((n) => n.type !== "trigger").map((n) => n.type))];
            return (
              <Card key={t.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{t.name}</h3>
                  <Badge tone="brand">{t.category}</Badge>
                </div>
                <TriggerBadge event={t.triggerEvent} />
                <p className="text-sm text-zinc-600">{t.description}</p>
                <ul className="space-y-1">
                  {t.highlights.map((h) => (
                    <li key={h} className="flex gap-1.5 text-sm text-zinc-600">
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                      {h}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-zinc-400">Blocos: {blocks.map((b) => NODE_INFO[b as NodeType].label).join(" · ")}</p>
                <Button className="mt-auto" onClick={() => use(t)} loading={using === t.id} disabled={!!using}>
                  Usar este modelo
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
