import { CircleCheck, FlaskConical, RotateCcw, Send, Zap } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { NODE_INFO, type NodeType } from "@veloxia/shared";
import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { SimulationResult, SimOutput } from "../../lib/types";
import { Badge, Button, Callout, Input, Segmented } from "../ui";
import { Bubble, OutboundContentView } from "./Bubbles";

type Entry =
  | { kind: "user"; text: string }
  | { kind: "result"; result: SimulationResult; resumed: boolean }
  | { kind: "error"; text: string };

const EVENTS = [
  { value: "dm", label: "Direct" },
  { value: "comment", label: "Comentário" },
  { value: "story_reply", label: "Story" },
  { value: "story_mention", label: "Menção" },
] as const;

/**
 * Simulador ("Testar automação"): roda o motor real em modo de teste, sem enviar mensagens.
 * Com `automationId` testa uma automação; sem ele, testa qual automação ativa responderia.
 */
export function Simulator({ automationId, defaultEvent = "dm", className, useDraft = true }: { automationId?: string; defaultEvent?: string; className?: string; useDraft?: boolean }) {
  const [message, setMessage] = useState("");
  const [event, setEvent] = useState(defaultEvent);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<SimulationResult | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvent(defaultEvent);
  }, [defaultEvent]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries]);

  const run = async (text: string, reply?: { text?: string; payload?: string }) => {
    setLoading(true);
    setEntries((e) => [...e, { kind: "user", text: text || (event === "story_mention" ? "📣 (menção em Story)" : "") }]);
    try {
      const body =
        reply && pending?.state
          ? { message: text, event, useDraft, resume: { state: pending.state, reply } }
          : { message: text, event, useDraft };
      const { result } = automationId
        ? await api.post<{ result: SimulationResult }>(`/automations/${automationId}/test`, body)
        : await api.post<{ result: SimulationResult }>(`/automations/test-match`, { message: text, event });
      setEntries((e) => [...e, { kind: "result", result, resumed: !!reply }]);
      setPending(result.status === "waiting" ? result : null);
    } catch (err) {
      setEntries((e) => [...e, { kind: "error", text: errorMessage(err) }]);
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() && event !== "story_mention") return;
    const text = message.trim();
    setMessage("");
    if (pending?.waiting) run(text, { text });
    else run(text);
  };

  const reset = () => {
    setEntries([]);
    setPending(null);
  };

  return (
    <div className={cn("flex flex-col rounded-xl border border-zinc-200 bg-white", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-brand-600" />
          <p className="text-sm font-semibold">Testar automação</p>
          <Badge tone="gray">nada é enviado</Badge>
        </div>
        <div className="flex items-center gap-2">
          {!pending && (
            <Segmented
              value={event}
              onChange={(v) => {
                setEvent(v);
                reset();
              }}
              items={EVENTS.map((e) => ({ value: e.value, label: e.label }))}
            />
          )}
          {entries.length > 0 && (
            <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={reset}>
              Limpar
            </Button>
          )}
        </div>
      </div>
      <div className="scrollbar-thin min-h-48 flex-1 space-y-3 overflow-y-auto bg-zinc-50/60 p-4">
        {entries.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500">
            Digite uma mensagem como se fosse um seguidor, por exemplo: <span className="font-medium text-zinc-700">“Quero o link”</span>.
          </p>
        )}
        {entries.map((entry, i) => {
          if (entry.kind === "user") return entry.text ? <Bubble key={i} side="right" tone="default" className="bg-ink-800">{entry.text}</Bubble> : null;
          if (entry.kind === "error") return <Callout key={i} tone="error">{entry.text}</Callout>;
          const r = entry.result;
          if (!r.matched) {
            return (
              <Callout key={i} tone="warning" title="Nenhuma automação respondeu">
                Nenhuma palavra-chave correspondeu a esta mensagem. Ajuste as palavras-chave ou o tipo de correspondência.
              </Callout>
            );
          }
          const last = i === entries.length - 1;
          return (
            <div key={i} className="space-y-2">
              {!entry.resumed && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {r.matchedKeyword && (
                    <Badge tone="brand">
                      <Zap className="size-3" /> Palavra detectada: {r.matchedKeyword.toUpperCase()}
                    </Badge>
                  )}
                  {r.automationName && <Badge tone="violet">Automação: {r.automationName}</Badge>}
                </div>
              )}
              {r.outputs.map((o: SimOutput, j) => (
                <div key={j} className="space-y-0.5">
                  {o.privateReply && <p className="text-left text-[11px] text-zinc-400">Resposta privada ao comentário</p>}
                  <OutboundContentView
                    content={o.content}
                    side="left"
                    onQuickReply={last && r.status === "waiting" ? (title, payload) => run(title, { text: title, payload }) : undefined}
                  />
                </div>
              ))}
              {r.error && <Callout tone="error">{r.error}</Callout>}
              {r.alternatives.length > 0 && (
                <p className="text-xs text-zinc-500">Também correspondem (com prioridade menor): {r.alternatives.map((a) => a.automationName).join(", ")}</p>
              )}
              <details className="text-xs text-zinc-500">
                <summary className="cursor-pointer select-none hover:text-zinc-800">Ver etapas ({r.steps.length})</summary>
                <ol className="mt-2 space-y-1 border-l border-zinc-200 pl-3">
                  {r.steps.map((s, k) => (
                    <li key={k} className="flex gap-1.5">
                      <CircleCheck className={cn("mt-0.5 size-3.5 shrink-0", s.status === "error" ? "text-red-500" : s.status === "waiting" ? "text-sky-500" : "text-emerald-500")} />
                      <span>
                        <span className="font-medium text-zinc-700">{NODE_INFO[s.type as NodeType]?.label ?? s.type}</span>
                        {s.detail ? ` — ${s.detail}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
              {last && r.status === "waiting" && r.waiting?.type === "capture" && (
                <p className="text-xs font-medium text-sky-700">Aguardando a resposta do contato — digite abaixo para continuar.</p>
              )}
              {last && r.status === "waiting" && r.waiting?.type === "buttons" && <p className="text-xs font-medium text-sky-700">Toque em uma opção para continuar.</p>}
              {r.status === "completed" && <p className="text-xs text-emerald-700">Fluxo concluído.</p>}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-100 p-3">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={pending?.waiting?.type === "capture" ? "Resposta do contato…" : event === "story_mention" ? "Menções não têm texto — clique em enviar" : "Mensagem de teste…"}
          aria-label="Mensagem de teste"
        />
        <Button type="submit" loading={loading} icon={<Send className="size-4" />}>
          <span className="hidden sm:inline">Testar</span>
        </Button>
      </form>
    </div>
  );
}
