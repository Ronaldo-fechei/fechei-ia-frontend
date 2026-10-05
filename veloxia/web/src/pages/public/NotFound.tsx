import { ButtonLink } from "../../components/ui";
import { Logo } from "../../components/brand/Logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="mt-6 text-3xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-zinc-500">O endereço pode ter mudado ou não existe.</p>
      <ButtonLink to="/">Voltar ao início</ButtonLink>
    </div>
  );
}
