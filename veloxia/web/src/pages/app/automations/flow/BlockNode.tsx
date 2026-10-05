import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CircleAlert } from "lucide-react";
import { createContext, memo, useContext } from "react";
import { getOutputHandles, MATCH_TYPE_LABELS, NODE_INFO, TRIGGER_EVENT_INFO, type NodeDataMap } from "@veloxia/shared";
import { cn } from "../../../../lib/cn";
import { formatDuration } from "../../../../lib/format";
import type { BlockNodeType } from "./convert";
import { NODE_STYLE } from "./meta";

export interface FlowUi {
  issues: Map<string, string[]>;
  tagNames: Map<string, string>;
  fieldLabels: Map<string, string>;
}

export const FlowUiContext = createContext<FlowUi>({ issues: new Map(), tagNames: new Map(), fieldLabels: new Map() });

function Summary({ node }: { node: BlockNodeType["data"]["node"] }) {
  const ui = useContext(FlowUiContext);
  const d = node.data as any;
  const clip = (s: string, n = 90) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
  switch (node.type) {
    case "trigger": {
      const info = TRIGGER_EVENT_INFO[(d as NodeDataMap["trigger"]).event];
      return (
        <p>
          {info.label}
          {d.event === "comment" && <span className="block text-zinc-400">{d.mediaIds.length ? `${d.mediaIds.length} publicação(ões)` : "Todas as publicações"}</span>}
        </p>
      );
    }
    case "keyword": {
      const kws = (d as NodeDataMap["keyword"]).keywords;
      return kws.length ? (
        <div>
          <div className="flex flex-wrap gap-1">
            {kws.slice(0, 6).map((k, i) => (
              <span key={i} className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                {k.text.toUpperCase()}
              </span>
            ))}
            {kws.length > 6 && <span className="text-[11px] text-zinc-400">+{kws.length - 6}</span>}
          </div>
          <p className="mt-1 text-[11px] text-zinc-400">{MATCH_TYPE_LABELS[kws[0].matchType]}</p>
        </div>
      ) : (
        <p className="text-zinc-400 italic">Adicione palavras-chave</p>
      );
    }
    case "message":
      return <p className="whitespace-pre-wrap">{clip(d.text) || <span className="text-zinc-400 italic">Escreva a mensagem</span>}</p>;
    case "image":
      return d.url ? <img src={d.url} alt="" className="max-h-20 rounded-md object-cover" /> : <p className="text-zinc-400 italic">Escolha a imagem</p>;
    case "video":
      return <p className="truncate">{d.url || <span className="text-zinc-400 italic">Informe a URL do vídeo</span>}</p>;
    case "link":
      return (
        <div>
          <p className="whitespace-pre-wrap">{clip(d.text, 60) || <span className="text-zinc-400 italic">Texto da mensagem</span>}</p>
          <p className="mt-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-center text-[11px] font-medium text-sky-800">{d.buttonTitle || "Botão"}</p>
        </div>
      );
    case "buttons":
      return <p className="whitespace-pre-wrap">{clip(d.text, 60) || <span className="text-zinc-400 italic">Texto da pergunta</span>}</p>;
    case "condition":
      return <p>{d.rules.length ? `${d.rules.length} regra(s) · ${d.logic === "all" ? "todas" : "qualquer uma"}` : <span className="text-zinc-400 italic">Configure as regras</span>}</p>;
    case "delay":
      return <p>Aguardar {formatDuration(d.seconds)}</p>;
    case "add_tag":
    case "remove_tag":
      return <p>{d.tagId ? ui.tagNames.get(d.tagId) ?? (String(d.tagId).startsWith("name:") ? d.tagId.slice(5) : "Tag removida") : <span className="text-zinc-400 italic">Escolha a tag</span>}</p>;
    case "capture":
      return (
        <div>
          <p className="whitespace-pre-wrap">{clip(d.question, 60) || <span className="text-zinc-400 italic">Pergunta</span>}</p>
          {d.fieldKey && <p className="mt-1 text-[11px] text-zinc-400">Salva em: {ui.fieldLabels.get(d.fieldKey) ?? d.fieldKey}</p>}
        </div>
      );
    case "handoff":
      return <p>{clip(d.message, 60) || "Pausa as automações e avisa a equipe"}</p>;
    case "end":
      return <p>Encerra o fluxo</p>;
  }
}

export const BlockNode = memo(function BlockNode({ data, selected }: NodeProps<BlockNodeType>) {
  const ui = useContext(FlowUiContext);
  const node = data.node;
  const style = NODE_STYLE[node.type];
  const handles = getOutputHandles(node);
  const issues = ui.issues.get(node.id) ?? [];
  return (
    <div
      className={cn(
        "w-60 rounded-xl border bg-white text-xs shadow-card transition-shadow",
        selected ? "border-brand-500 ring-2 ring-brand-200" : issues.length ? "border-red-300" : "border-zinc-200",
      )}
    >
      {node.type !== "trigger" && <Handle type="target" position={Position.Top} className="!bg-zinc-400" />}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
        <span className={cn("flex size-6 items-center justify-center rounded-md [&>svg]:size-3.5", style.bg, style.color)}>{style.icon}</span>
        <span className="flex-1 truncate text-[13px] font-semibold text-zinc-900">{NODE_INFO[node.type].label}</span>
        {issues.length > 0 && <CircleAlert className="size-4 text-red-500" aria-label={issues.join(" ")} />}
      </div>
      <div className="px-3 py-2.5 leading-relaxed text-zinc-700">
        <Summary node={node} />
      </div>
      {handles.length > 0 &&
        (handles.length === 1 && handles[0].id === "out" ? (
          <Handle type="source" id="out" position={Position.Bottom} className="!bg-brand-500" />
        ) : (
          <div className="flex justify-around gap-1 border-t border-zinc-100 px-2 pt-1.5 pb-3">
            {handles.map((h) => (
              <div key={h.id} className="relative flex flex-1 justify-center">
                <span
                  className={cn(
                    "max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-medium",
                    h.id === "false" || h.id === "failed" ? "bg-red-50 text-red-700" : h.id === "true" || h.id === "captured" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700",
                  )}
                >
                  {h.label}
                </span>
                <Handle type="source" id={h.id} position={Position.Bottom} className="!-bottom-3.5 !bg-brand-500" />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
});
