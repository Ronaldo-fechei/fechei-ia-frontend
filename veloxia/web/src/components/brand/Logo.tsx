import { useId } from "react";
import { APP_NAME } from "@veloxia/shared";
import { cn } from "../../lib/cn";

/** Marca Veloxia: balão de conversa com um "V" e linhas de velocidade. */
export function LogoMark({ className }: { className?: string }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8", className)} aria-hidden="true">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c4dff"/><stop offset="1" stopColor="#4821a7"/></linearGradient></defs><rect width="64" height="64" rx="16" fill={`url(#${gid})`}/><path d="M14 20a8 8 0 0 1 8-8h22a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H31l-10 8v-8a8 8 0 0 1-7-8z" fill="#fff"/><path d="M22 19h6l5 13 5-13h6l-8.5 19h-5z" fill="#6834f0"/><path d="M8 25h5M6 31h7M9 37h4" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".7"/>
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
