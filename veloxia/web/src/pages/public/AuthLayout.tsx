import { KeyRound, MessageCircle, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ChannelGlyph, Logo } from "../../components/brand/Logo";
import { usePrefersReducedMotion } from "../../hooks/useReducedMotion";
import { cn } from "../../lib/cn";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative flex flex-col overflow-hidden px-6 py-8 sm:px-12">
        {/* Fundo: grade de pontos que some nas bordas e um brilho violeta suave. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgb(124_77_255/0.14)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute -top-40 -left-40 size-[28rem] rounded-full bg-brand-300/25 blur-3xl" />

        <Link to="/" className="relative w-fit">
          <Logo size="lg" />
        </Link>

        <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <div className="motion-safe:animate-rise rounded-2xl border border-zinc-200/80 bg-white/85 p-7 shadow-pop backdrop-blur sm:p-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full rounded-full bg-brand-400 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
              </span>
              Conexão oficial com a Meta
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-zinc-500">{subtitle}</p>}
            <div className="mt-7">{children}</div>
            {footer && <div className="mt-6 text-center text-sm text-zinc-500">{footer}</div>}
          </div>

          <ul className="mt-6 grid grid-cols-1 gap-2 text-xs text-zinc-500 motion-safe:animate-rise [animation-delay:120ms] sm:grid-cols-3">
            {[
              { icon: KeyRound, text: "Nunca pedimos sua senha" },
              { icon: ShieldCheck, text: "Dados protegidos (LGPD)" },
              { icon: Zap, text: "Respostas em segundos" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center justify-center gap-1.5 rounded-lg bg-white/60 px-2 py-1.5 ring-1 ring-zinc-200/70">
                <Icon className="size-3.5 text-brand-600" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-center text-xs text-zinc-400">
          <Link to="/privacidade" className="hover:underline">
            Privacidade
          </Link>{" "}
          ·{" "}
          <Link to="/termos" className="hover:underline">
            Termos de uso
          </Link>
        </p>
      </div>

      <ShowcasePanel />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Painel ilustrativo: uma conversa de exemplo que se "responde sozinha",
 * alternando entre Direct, comentário e WhatsApp.
 * ------------------------------------------------------------------------- */

interface Scenario {
  channel: "instagram" | "whatsapp";
  label: string;
  contact: string;
  incoming: string;
  reply: string;
  trigger: string;
  action?: string;
}

const SCENARIOS: Scenario[] = [
  {
    channel: "instagram",
    label: "Direct do Instagram",
    contact: "Ana",
    incoming: "Oi! Qual o valor do kit? 😍",
    reply: "Oi, Ana! O kit está no link abaixo, com todas as cores disponíveis. Quer que eu te avise das novidades?",
    trigger: "Palavra-chave: “valor”",
    action: "Ver o kit",
  },
  {
    channel: "instagram",
    label: "Comentário no post",
    contact: "Bruno",
    incoming: "EU QUERO 🙋‍♂️",
    reply: "Oba, Bruno! Acabei de te mandar o link no Direct 📩",
    trigger: "Comentário com “quero”",
  },
  {
    channel: "whatsapp",
    label: "WhatsApp",
    contact: "Carla",
    incoming: "Vocês abrem no sábado?",
    reply: "Abrimos sim, Carla! Sábado das 9h às 14h. Quer agendar um horário?",
    trigger: "Palavra-chave: “sábado”",
    action: "Agendar",
  },
];

const STEP_TIMES = [250, 1000, 2300]; // mensagem recebida → digitando → resposta
const SCENARIO_MS = 6500;

function ShowcasePanel() {
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
    <div className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20">
      {/* Aurora animada + grade fina */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -right-24 size-[34rem] rounded-full bg-brand-600/35 blur-3xl motion-safe:animate-aurora" />
        <div className="absolute -bottom-48 -left-32 size-[30rem] rounded-full bg-fuchsia-500/15 blur-3xl motion-safe:animate-aurora [animation-delay:-6s]" />
        <div className="absolute top-1/3 left-1/2 size-72 rounded-full bg-emerald-400/10 blur-3xl motion-safe:animate-aurora [animation-delay:-12s]" />
        <div className="absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.04)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>

      <div className="relative mx-auto w-full max-w-lg">
        <h2 className="text-[2rem] leading-[1.15] font-semibold tracking-tight text-white xl:text-4xl">
          Responda{" "}
          <span className="bg-gradient-to-r from-brand-300 via-fuchsia-300 to-amber-200 bg-clip-text text-transparent">Instagram e WhatsApp</span>{" "}
          automaticamente.
        </h2>
        <p className="mt-3 text-base text-zinc-400">Na hora certa e com a mensagem certa — enquanto você cuida do seu negócio.</p>

        {/* Conversa de exemplo */}
        <div className="relative mt-10">
          <FloatingChip className="-top-5 -right-3 motion-safe:animate-float" icon={<Sparkles className="size-3.5 text-amber-300" />}>
            {s.trigger}
          </FloatingChip>
          <FloatingChip className="-bottom-5 -left-4 motion-safe:animate-float [animation-delay:-3s]" icon={<Zap className="size-3.5 text-emerald-300" />}>
            Respondido automaticamente
          </FloatingChip>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-xl">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full text-white transition-colors duration-500",
                  wa ? "bg-emerald-500" : "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400",
                )}
              >
                <ChannelGlyph channel={s.channel} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{s.contact}</p>
                <p className="text-xs text-zinc-400">{s.label}</p>
              </div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-300 uppercase">Exemplo</span>
            </div>

            <div key={index} className="flex min-h-[13rem] flex-col gap-3 px-4 py-5" aria-live="polite">
              {step >= 1 && (
                <div className="max-w-[80%] self-start rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm text-zinc-100 motion-safe:animate-bubble">
                  {s.incoming}
                </div>
              )}
              {step === 2 && (
                <div className="flex w-fit items-center gap-1 self-end rounded-2xl rounded-br-md bg-brand-600/60 px-3.5 py-3 motion-safe:animate-bubble" aria-label="Digitando">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="size-1.5 rounded-full bg-white motion-safe:animate-typing" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              )}
              {step >= 3 && (
                <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end motion-safe:animate-bubble">
                  <div className={cn("rounded-2xl rounded-br-md px-3.5 py-2 text-sm text-white shadow-lg", wa ? "bg-emerald-600 shadow-emerald-900/30" : "bg-brand-600 shadow-brand-900/40")}>
                    {s.reply}
                  </div>
                  {s.action && (
                    <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white">{s.action}</span>
                  )}
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <Zap className="size-3 text-amber-300" /> Automação Veloxia
                  </span>
                </div>
              )}
            </div>

            {/* Progresso entre os exemplos */}
            <div className="flex gap-1.5 px-4 pb-4">
              {SCENARIOS.map((sc, i) => (
                <button
                  key={sc.label}
                  type="button"
                  onClick={() => setIndex(i)}
                  className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
                  aria-label={`Ver exemplo: ${sc.label}`}
                >
                  {i === index && !reduced && (
                    <span key={index} className="block h-full origin-left rounded-full bg-white/60 motion-safe:animate-progress" style={{ animationDuration: `${SCENARIO_MS}ms` }} />
                  )}
                  {(i < index || (reduced && i === index)) && <span className="block h-full rounded-full bg-white/40" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <ul className="mt-12 grid grid-cols-3 gap-3 text-sm">
          {[
            { icon: MessageCircle, title: "Direct e comentários", text: "Stories e WhatsApp também" },
            { icon: ShieldCheck, title: "API oficial", text: "Sem senha, sem gambiarra" },
            { icon: Sparkles, title: "Tudo num lugar", text: "Caixa de entrada e métricas" },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.08]">
              <Icon className="size-4 text-brand-300" />
              <p className="mt-2 font-medium text-white">{title}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FloatingChip({ className, icon, children }: { className?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cn(
        "absolute z-10 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-ink-900/80 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-black/30 backdrop-blur",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
