import { renderVariables, SYSTEM_VARIABLES } from "@veloxia/shared";
import { BatteryFull, Camera, ChevronLeft, Image, Mic, Paperclip, Phone, Signal, Smile, Sticker, Video, Wifi } from "lucide-react";
import type { Channel } from "@veloxia/shared";
import type { ReactNode } from "react";
import type { SimOutput } from "../../lib/types";
import { Bubble, OutboundContentView } from "./Bubbles";

const EXAMPLE_VARS = Object.fromEntries(SYSTEM_VARIABLES.map((v) => [v.key, v.example]));

export function previewText(text: string, link?: string) {
  return renderVariables(text, { ...EXAMPLE_VARS, ...(link ? { link } : {}) });
}

/** Avatar com o anel em degradê das contas do Instagram. */
function StoryAvatar({ label, size }: { label: string; size: "sm" | "lg" }) {
  return (
    <span className={`shrink-0 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 ${size === "lg" ? "p-[2px]" : "p-[1.5px]"}`}>
      <span
        className={`flex items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-brand-100 to-amber-100 font-bold text-brand-800 ${
          size === "lg" ? "size-8 text-[10px]" : "size-5 text-[7px]"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * Pré-visualização do que o contato vê (Direct do Instagram ou WhatsApp), dentro de um celular.
 * Ilustrativa: o layout real depende do aparelho e da versão do app.
 */
export function PhonePreview({
  incoming,
  outputs,
  footer,
  accountName = "sua_conta",
  channel = "instagram",
}: {
  incoming?: string;
  outputs: SimOutput["content"][];
  footer?: ReactNode;
  accountName?: string;
  channel?: Channel;
}) {
  if (channel === "whatsapp") return <WhatsAppPreview incoming={incoming} outputs={outputs} footer={footer} accountName={accountName} />;
  const initials = accountName.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "SC";
  return (
    <figure className="mx-auto w-full max-w-[300px]">
      <div className="relative rounded-[2.75rem] bg-ink-900 p-[9px] shadow-pop ring-1 ring-black/10">
        {/* Botões laterais */}
        <span aria-hidden className="absolute top-24 -left-[3px] h-8 w-[3px] rounded-l bg-ink-800" />
        <span aria-hidden className="absolute top-36 -left-[3px] h-12 w-[3px] rounded-l bg-ink-800" />
        <span aria-hidden className="absolute top-32 -right-[3px] h-16 w-[3px] rounded-r bg-ink-800" />

        <div className="relative flex aspect-[9/19] flex-col overflow-hidden rounded-[2.2rem] bg-white text-zinc-900">
          {/* Barra de status + ilha */}
          <div className="relative flex h-9 shrink-0 items-center justify-between px-6 pt-1 text-[11px] font-semibold">
            <span>9:41</span>
            <span aria-hidden className="absolute top-2 left-1/2 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-ink-900" />
            <span className="flex items-center gap-1" aria-hidden>
              <Signal className="size-3" strokeWidth={2.5} />
              <Wifi className="size-3" strokeWidth={2.5} />
              <BatteryFull className="size-4" strokeWidth={2} />
            </span>
          </div>

          {/* Cabeçalho da conversa no Direct */}
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-2.5 py-2">
            <ChevronLeft className="size-5 text-zinc-800" aria-hidden />
            <StoryAvatar label={initials} size="lg" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12px] font-semibold">{accountName}</p>
              <p className="text-[10px] text-zinc-500">Ativo(a) agora</p>
            </div>
            <Phone className="size-[18px] text-zinc-800" aria-hidden />
            <Video className="ml-2 size-5 text-zinc-800" aria-hidden />
          </div>

          {/* Conversa */}
          <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-2.5 py-3 text-[13px]">
            <p className="pb-1 text-center text-[10px] font-medium text-zinc-400">Hoje 9:41</p>
            {incoming && (
              <Bubble side="right" className="bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white">
                {incoming}
              </Bubble>
            )}
            {outputs.length > 0 && (
              <div className="flex items-end gap-1.5">
                <StoryAvatar label={initials} size="sm" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {outputs.map((c, i) => (
                    <OutboundContentView key={i} content={c} side="left" />
                  ))}
                </div>
              </div>
            )}
            {!incoming && outputs.length === 0 && <p className="pt-10 text-center text-[11px] text-zinc-400">A resposta aparece aqui enquanto você escreve.</p>}
          </div>

          {/* Campo de mensagem */}
          <div className="shrink-0 px-2.5 pb-1.5">
            <div className="flex items-center gap-2 rounded-full bg-zinc-100 py-1.5 pr-3 pl-1.5" aria-hidden>
              <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white">
                <Camera className="size-3.5" />
              </span>
              <span className="flex-1 text-[12px] text-zinc-400">Mensagem…</span>
              <Mic className="size-4 text-zinc-700" />
              <Image className="size-4 text-zinc-700" />
              <Sticker className="size-4 text-zinc-700" />
            </div>
          </div>
          {/* Indicador de início */}
          <span aria-hidden className="mx-auto mb-1.5 h-1 w-24 shrink-0 rounded-full bg-zinc-900" />
        </div>
      </div>
      <figcaption className="mt-2.5 text-center text-[11px] text-zinc-500">{footer ?? "Prévia ilustrativa de como o seguidor recebe a resposta."}</figcaption>
    </figure>
  );
}

/** Variação com a aparência de uma conversa de WhatsApp (ilustrativa, sem a marca). */
function WhatsAppPreview({ incoming, outputs, footer, accountName }: { incoming?: string; outputs: SimOutput["content"][]; footer?: ReactNode; accountName: string }) {
  const name = accountName === "sua_conta" ? "Sua empresa" : accountName;
  return (
    <figure className="mx-auto w-full max-w-[300px]">
      <div className="relative rounded-[2.75rem] bg-ink-900 p-[9px] shadow-pop ring-1 ring-black/10">
        <span aria-hidden className="absolute top-24 -left-[3px] h-8 w-[3px] rounded-l bg-ink-800" />
        <span aria-hidden className="absolute top-36 -left-[3px] h-12 w-[3px] rounded-l bg-ink-800" />
        <span aria-hidden className="absolute top-32 -right-[3px] h-16 w-[3px] rounded-r bg-ink-800" />
        <div className="relative flex aspect-[9/19] flex-col overflow-hidden rounded-[2.2rem] bg-[#efe7dd] text-zinc-900">
          <div className="relative flex h-9 shrink-0 items-center justify-between bg-white px-6 pt-1 text-[11px] font-semibold">
            <span>9:41</span>
            <span aria-hidden className="absolute top-2 left-1/2 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-ink-900" />
            <span className="flex items-center gap-1" aria-hidden>
              <Signal className="size-3" strokeWidth={2.5} />
              <Wifi className="size-3" strokeWidth={2.5} />
              <BatteryFull className="size-4" strokeWidth={2} />
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-2.5 py-2">
            <ChevronLeft className="size-5 text-emerald-700" aria-hidden />
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">
              {name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "SE"}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[12px] font-semibold">{name}</p>
              <p className="text-[10px] text-zinc-500">Conta comercial</p>
            </div>
            <Video className="size-5 text-emerald-700" aria-hidden />
            <Phone className="ml-2 size-[18px] text-emerald-700" aria-hidden />
          </div>
          <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-2.5 py-3 text-[13px]">
            <p className="mx-auto w-fit rounded-md bg-white/80 px-2 py-0.5 text-center text-[10px] font-medium text-zinc-500">Hoje</p>
            {incoming && (
              <Bubble side="right" className="rounded-lg bg-[#d9fdd3] text-zinc-900">
                {incoming}
              </Bubble>
            )}
            {outputs.length > 0 && (
              <div className="space-y-1.5 [&_.rounded-2xl]:rounded-lg">
                {outputs.map((c, i) => (
                  <OutboundContentView key={i} content={c} side="left" />
                ))}
              </div>
            )}
            {!incoming && outputs.length === 0 && <p className="pt-10 text-center text-[11px] text-zinc-500">A resposta aparece aqui enquanto você escreve.</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 px-2 pb-1.5" aria-hidden>
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white py-1.5 pr-3 pl-2.5">
              <Smile className="size-4 text-zinc-500" />
              <span className="flex-1 text-[12px] text-zinc-400">Mensagem</span>
              <Paperclip className="size-4 text-zinc-500" />
              <Camera className="size-4 text-zinc-500" />
            </div>
            <span className="flex size-8 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Mic className="size-4" />
            </span>
          </div>
          <span aria-hidden className="mx-auto mb-1.5 h-1 w-24 shrink-0 rounded-full bg-zinc-900" />
        </div>
      </div>
      <figcaption className="mt-2.5 text-center text-[11px] text-zinc-500">{footer ?? "Prévia ilustrativa de como o cliente recebe a resposta no WhatsApp."}</figcaption>
    </figure>
  );
}
