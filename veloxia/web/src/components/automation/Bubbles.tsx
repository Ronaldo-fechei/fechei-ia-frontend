import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { SimOutput } from "../../lib/types";

/** Bolhas no estilo de Direct, usadas no simulador, pré-visualização e caixa de entrada. */
export function Bubble({ side, children, tone = "default", className }: { side: "left" | "right"; children: ReactNode; tone?: "default" | "brand" | "muted" | "error"; className?: string }) {
  const tones = {
    default: side === "right" ? "bg-brand-600 text-white" : "bg-zinc-100 text-zinc-900",
    brand: "bg-brand-600 text-white",
    muted: "bg-zinc-100 text-zinc-500 italic",
    error: "bg-red-50 text-red-800 ring-1 ring-red-200",
  };
  return (
    <div className={cn("flex", side === "right" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap",
          side === "right" ? "rounded-br-md" : "rounded-bl-md",
          tones[tone],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function OutboundContentView({
  content,
  side = "right",
  onQuickReply,
}: {
  content: SimOutput["content"];
  side?: "left" | "right";
  onQuickReply?: (title: string, payload?: string) => void;
}) {
  const justify = side === "right" ? "justify-end" : "justify-start";
  switch (content.kind) {
    case "text":
      return (
        <div className="space-y-1.5">
          <Bubble side={side}>{content.text}</Bubble>
          {content.quickReplies?.length ? (
            <div className={cn("flex flex-wrap gap-1.5", justify)}>
              {content.quickReplies.map((q) => (
                <button
                  key={q.payload}
                  type="button"
                  disabled={!onQuickReply}
                  onClick={() => onQuickReply?.(q.title, q.payload)}
                  className="rounded-full border border-brand-300 bg-white px-3 py-1 text-sm font-medium text-brand-700 enabled:hover:bg-brand-50 disabled:cursor-default"
                >
                  {q.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    case "image":
      return (
        <div className={cn("flex", justify)}>
          <img src={content.url} alt="Imagem enviada" className="max-h-56 max-w-[70%] rounded-2xl object-cover ring-1 ring-zinc-200" />
        </div>
      );
    case "video":
      return (
        <div className={cn("flex", justify)}>
          <video src={content.url} controls className="max-h-56 max-w-[70%] rounded-2xl ring-1 ring-zinc-200" />
        </div>
      );
    case "buttons":
      return (
        <div className={cn("flex", justify)}>
          <div className="w-64 max-w-[85%] overflow-hidden rounded-2xl ring-1 ring-zinc-200">
            <p className="bg-zinc-50 px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-zinc-900">{content.text}</p>
            {content.buttons.map((b) =>
              b.type === "url" ? (
                <a
                  key={b.title + b.url}
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 border-t border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  {b.title} <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <button
                  key={b.title + b.payload}
                  type="button"
                  disabled={!onQuickReply}
                  onClick={() => onQuickReply?.(b.title, b.payload)}
                  className="block w-full border-t border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 enabled:hover:bg-brand-50"
                >
                  {b.title}
                </button>
              ),
            )}
          </div>
        </div>
      );
    case "template":
      return (
        <div className={cn("flex", justify)}>
          <div className="w-64 max-w-[85%] overflow-hidden rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
            {content.headerImageUrl && <img src={content.headerImageUrl} alt="" className="max-h-32 w-full object-cover" />}
            <p className="px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-zinc-900">{content.previewText}</p>
            <p className="border-t border-emerald-200 px-3.5 py-1.5 text-[11px] text-emerald-800">Modelo do WhatsApp · {content.name}</p>
          </div>
        </div>
      );
  }
}
