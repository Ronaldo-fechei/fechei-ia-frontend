import { Camera, ChevronLeft, Image as ImageIcon, Mic, Phone, Plus, Smile, Video, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "../../hooks/useReducedMotion";
import { cn } from "../../lib/cn";
import { WhatsAppGlyph } from "../brand/Logo";

/**
 * Celular ilustrativo da página inicial: uma conversa de exemplo que se
 * responde sozinha, alternando entre o Direct do Instagram e o WhatsApp.
 */

interface Scenario {
  channel: "instagram" | "whatsapp";
  contact: string;
  initials: string;
  incoming: string;
  reply: string;
  button: string;
  keyword: string;
}

const SCENARIOS: Scenario[] = [
  {
    channel: "instagram",
    contact: "Ana Souza",
    initials: "AS",
    incoming: "Me manda o link? 😍",
    reply: "Claro! 😊 Aqui está o link para você conferir o produto 👇",
    button: "Ver produto",
    keyword: "link",
  },
  {
    channel: "whatsapp",
    contact: "Carlos Lima",
    initials: "CL",
    incoming: "Oi! Qual o preço do kit?",
    reply: "Oi, Carlos! Te mandei a tabela com todos os valores aqui embaixo 👇",
    button: "Ver preços",
    keyword: "preço",
  },
];

const STEP_TIMES = [400, 1300, 2700]; // mensagem recebida → digitando → resposta
const SCENARIO_MS = 7000;

export function PhoneMockup() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(reduced ? 3 : 0);

  useEffect(() => {
    if (reduced) {
      setStep(3);
      return;
    }
    setStep(0);
    const timers = STEP_TIMES.map((ms, i) => window.setTimeout(() => setStep(i + 1), ms));
    timers.push(window.setTimeout(() => setIndex((i) => (i + 1) % SCENARIOS.length), SCENARIO_MS));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [index, reduced]);

  const s = SCENARIOS[index];
  const wa = s.channel === "whatsapp";

  return (
    <div className="relative mx-auto w-fit">
      {/* Brilho atrás do aparelho */}
      <div aria-hidden="true" className="absolute -inset-10 rounded-full bg-gradient-to-br from-brand-500/40 via-fuchsia-500/15 to-amber-400/10 blur-3xl" />

      {/* Etiquetas flutuantes */}
      <Chip className="top-32 right-full -mr-5 motion-safe:animate-float" icon={<Zap className="size-3.5 text-amber-300" />}>
        Palavra detectada: <strong className="font-semibold">{s.keyword}</strong>
      </Chip>
      <Chip className="bottom-36 left-full -ml-5 motion-safe:animate-float [animation-delay:-3s]" icon={<span className="size-2 rounded-full bg-emerald-400" />}>
        Respondido em segundos
      </Chip>

      {/* Aparelho */}
      <div className="relative h-[570px] w-[290px] rounded-[3.2rem] bg-gradient-to-b from-zinc-700 via-zinc-900 to-black p-[11px] shadow-[0_40px_80px_-20px_rgb(0_0_0/0.7)] ring-1 ring-white/15">
        {/* Botões laterais */}
        <span aria-hidden="true" className="absolute top-28 -left-[3px] h-8 w-[3px] rounded-l bg-zinc-700" />
        <span aria-hidden="true" className="absolute top-40 -left-[3px] h-12 w-[3px] rounded-l bg-zinc-700" />
        <span aria-hidden="true" className="absolute top-36 -right-[3px] h-16 w-[3px] rounded-r bg-zinc-700" />

        <div className={cn("relative flex h-full flex-col overflow-hidden rounded-[2.5rem] transition-colors duration-700", wa ? "bg-[#efeae2]" : "bg-white")}>
          {/* Barra de status + ilha */}
          <div className={cn("relative flex h-11 shrink-0 items-center justify-between px-7 pt-1 text-[13px] font-semibold transition-colors duration-700", wa ? "bg-[#075e54] text-white" : "text-zinc-900")}>
            <span>9:41</span>
            <span aria-hidden="true" className="absolute top-2.5 left-1/2 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
            <StatusIcons />
          </div>

          {/* Cabeçalho do app */}
          {wa ? (
            <div className="flex shrink-0 items-center gap-2 bg-[#075e54] px-3 pt-1 pb-2.5 text-white">
              <ChevronLeft className="size-5 shrink-0" />
              <Avatar initials={s.initials} className="bg-emerald-200 text-emerald-900" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[14px] font-semibold">{s.contact}</p>
                <p className="text-[11px] text-white/70">{step === 2 ? "digitando…" : "online"}</p>
              </div>
              <Video className="size-5" />
              <Phone className="ml-3 size-[18px]" />
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 pb-2.5">
              <ChevronLeft className="size-6 shrink-0 text-zinc-900" />
              <span className="rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600 p-[2px]">
                <Avatar initials={s.initials} className="border-2 border-white bg-brand-100 text-brand-800" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[14px] font-semibold text-zinc-900">{s.contact}</p>
                <p className="text-[11px] text-zinc-500">{step === 2 ? "digitando…" : "Ativo(a) agora"}</p>
              </div>
              <Phone className="size-[18px] text-zinc-900" />
              <Video className="ml-3 size-5 text-zinc-900" />
            </div>
          )}

          {/* Conversa */}
          <div key={index} className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-3 py-4 text-[13.5px] leading-snug" aria-live="polite">
            <p className={cn("mb-auto self-center rounded-md px-2 py-0.5 text-[10.5px]", wa ? "bg-white/80 text-zinc-500 shadow-sm" : "text-zinc-400")}>Exemplo ilustrativo</p>

            {step >= 1 && (
              <div className="flex items-end gap-1.5 self-start motion-safe:animate-bubble">
                {!wa && <Avatar initials={s.initials} className="size-6 bg-brand-100 text-[9px] text-brand-800" />}
                <div className={cn("max-w-[200px] px-3 py-2", wa ? "rounded-lg rounded-tl-none bg-white text-zinc-900 shadow-sm" : "rounded-3xl bg-zinc-100 text-zinc-900")}>
                  {s.incoming}
                  {wa && <span className="ml-2 align-bottom text-[10px] text-zinc-400">9:41</span>}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className={cn("flex w-fit items-center gap-1 self-end px-3.5 py-3 motion-safe:animate-bubble", wa ? "rounded-lg bg-[#d9fdd3] shadow-sm" : "rounded-3xl bg-gradient-to-r from-brand-600 to-fuchsia-500")} aria-label="Digitando">
                {[0, 150, 300].map((d) => (
                  <span key={d} className={cn("size-1.5 rounded-full motion-safe:animate-typing", wa ? "bg-emerald-700" : "bg-white")} style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            )}

            {step >= 3 && (
              <div className="flex max-w-[220px] flex-col items-end gap-1.5 self-end motion-safe:animate-bubble">
                <div className={cn("px-3 py-2", wa ? "rounded-lg rounded-tr-none bg-[#d9fdd3] text-zinc-900 shadow-sm" : "rounded-3xl bg-gradient-to-r from-brand-600 to-fuchsia-500 text-white")}>
                  {s.reply}
                  {wa && <span className="ml-2 align-bottom text-[10px] text-emerald-800/60">9:41 ✓✓</span>}
                </div>
                <span
                  className={cn(
                    "w-full rounded-xl px-3 py-2 text-center text-[13px] font-semibold",
                    wa ? "bg-white text-[#027eb5] shadow-sm" : "border border-zinc-200 bg-white text-zinc-900",
                  )}
                >
                  {s.button}
                </span>
                <span className="flex items-center gap-1 text-[10.5px] text-zinc-400">
                  <Zap className="size-3 text-amber-500" /> Enviado pelo Veloxia
                </span>
              </div>
            )}
          </div>

          {/* Campo de mensagem */}
          {wa ? (
            <div className="flex shrink-0 items-center gap-1.5 px-2 pt-1 pb-7">
              <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2 text-[13px] text-zinc-400 shadow-sm">
                <Smile className="size-5" />
                <span className="flex-1">Mensagem</span>
                <Camera className="size-5" />
              </div>
              <span className="grid size-10 place-items-center rounded-full bg-[#00a884] text-white">
                <Mic className="size-5" />
              </span>
            </div>
          ) : (
            <div className="shrink-0 px-3 pt-1 pb-7">
              <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-1.5 py-1.5 text-[13px] text-zinc-400">
                <span className="grid size-7 place-items-center rounded-full bg-brand-600 text-white">
                  <Camera className="size-4" />
                </span>
                <span className="flex-1">Mensagem…</span>
                <Mic className="size-5 text-zinc-800" />
                <ImageIcon className="size-5 text-zinc-800" />
                <Plus className="mr-1 size-5 text-zinc-800" />
              </div>
            </div>
          )}

          {/* Indicador de início */}
          <span aria-hidden="true" className={cn("absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full", wa ? "bg-zinc-800/70" : "bg-zinc-900")} />
        </div>
      </div>

      {/* Indicador do canal */}
      <div className="relative mt-6 flex justify-center gap-2">
        {SCENARIOS.map((sc, i) => (
          <button
            key={sc.channel}
            type="button"
            onClick={() => setIndex(i)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              i === index ? "bg-white text-zinc-900" : "bg-white/10 text-zinc-300 hover:bg-white/20",
            )}
          >
            {sc.channel === "whatsapp" ? <WhatsAppGlyph className="size-3.5" /> : <Camera className="size-3.5" />}
            {sc.channel === "whatsapp" ? "WhatsApp" : "Instagram"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Avatar({ initials, className }: { initials: string; className?: string }) {
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold", className)}>{initials}</span>;
}

function StatusIcons() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {/* sinal */}
      <span className="flex items-end gap-[2px]">
        {[4, 6, 8, 10].map((h) => (
          <span key={h} className="w-[3px] rounded-sm bg-current" style={{ height: h }} />
        ))}
      </span>
      {/* wi-fi */}
      <svg viewBox="0 0 16 12" className="h-3 w-4 fill-current">
        <path d="M8 11.5 5.6 9.1a3.4 3.4 0 0 1 4.8 0zM3.5 7a6.4 6.4 0 0 1 9 0l-1.4 1.4a4.4 4.4 0 0 0-6.2 0zM1.2 4.7a9.6 9.6 0 0 1 13.6 0l-1.4 1.4a7.6 7.6 0 0 0-10.8 0z" />
      </svg>
      {/* bateria */}
      <span className="relative ml-0.5 flex h-[11px] w-[22px] items-center rounded-[3px] border border-current/50 p-[1.5px]">
        <span className="h-full w-4/5 rounded-[1.5px] bg-current" />
        <span className="absolute top-1/2 -right-[3px] h-1 w-[2px] -translate-y-1/2 rounded-r bg-current/50" />
      </span>
    </span>
  );
}

function Chip({ className, icon, children }: { className?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cn(
        "absolute z-10 hidden items-center gap-1.5 rounded-full border border-white/15 bg-ink-900/85 px-3 py-1.5 text-xs whitespace-nowrap text-white shadow-lg shadow-black/30 backdrop-blur sm:inline-flex",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
