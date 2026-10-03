import { APP_NAME } from "@gatilho/shared";
import { cn } from "../../lib/cn";

/** Marca provisória: balão de mensagem com um raio (o "gatilho" que dispara a resposta). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#cc3f17" />
      <path d="M16 18a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H30l-9 8v-8h1a6 6 0 0 1-6-6z" fill="#fff" />
      <path d="M35 15 25 31h7l-3 12 11-17h-7z" fill="#cc3f17" />
    </svg>
  );
}

export function Logo({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cn("text-lg font-bold tracking-tight", dark ? "text-white" : "text-zinc-900")}>{APP_NAME}</span>
    </span>
  );
}

/** Ícone genérico de câmera para representar o Instagram (sem usar a marca registrada). */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("size-4", className)} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
