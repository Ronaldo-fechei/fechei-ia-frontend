import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_TAGLINE } from "@veloxia/shared";
import { Logo } from "../../components/brand/Logo";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link to="/" className="w-fit">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-zinc-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-zinc-500">{footer}</div>}
        </div>
        <p className="text-center text-xs text-zinc-400">
          <Link to="/privacidade" className="hover:underline">
            Privacidade
          </Link>{" "}
          ·{" "}
          <Link to="/termos" className="hover:underline">
            Termos de uso
          </Link>
        </p>
      </div>
      <div className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-40 -left-20 size-96 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative max-w-md">
          <p className="text-3xl leading-tight font-semibold text-white">{APP_TAGLINE}</p>
          <ul className="mt-8 space-y-3 text-zinc-300">
            {[
              "Conexão oficial com a Meta — nunca pedimos sua senha do Instagram",
              "Responda Direct, comentários e Stories automaticamente",
              "Caixa de entrada, contatos e métricas em um só lugar",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
