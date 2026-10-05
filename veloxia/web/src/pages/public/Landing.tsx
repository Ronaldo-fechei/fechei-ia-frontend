import {
  ArrowRight,
  ChartColumn,
  Contact,
  KeyRound,
  MessageCircle,
  MessagesSquare,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_NAME, APP_TAGLINE } from "@veloxia/shared";
import { Logo } from "../../components/brand/Logo";
import { ButtonLink } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <KeyRound />, title: "Direct por palavra-chave", text: "Alguém escreve “link”, “quero” ou “preço”? A resposta certa sai na hora, com botão para o seu link." },
  { icon: <MessageCircle />, title: "Comentário → Direct", text: "“Comente LINK para receber”: quem comentar recebe o link no Direct pela resposta privada oficial." },
  { icon: <Zap />, title: "Respostas a Stories", text: "Responda automaticamente quem reagir aos seus Stories ou mencionar sua conta." },
  { icon: <Workflow />, title: "Construtor visual", text: "Monte fluxos com mensagens, botões, esperas, condições, tags e captura de e-mail — sem programar." },
  { icon: <MessagesSquare />, title: "Caixa de entrada", text: "Veja todas as conversas, assuma o atendimento quando quiser e retome a automação com um clique." },
  { icon: <Contact />, title: "Contatos e tags", text: "Um CRM simples com histórico, tags, campos personalizados e exportação." },
  { icon: <ChartColumn />, title: "Métricas reais", text: "Mensagens, cliques nos links, palavras mais pedidas, horários de pico e desempenho por automação." },
  { icon: <Sparkles />, title: "IA que ajuda a criar", text: "Descreva o que você quer e receba uma automação pronta para revisar e publicar." },
];

const AUDIENCE = ["Afiliados", "Influenciadores", "Criadores de conteúdo", "Lojas e e-commerce", "Infoprodutores", "Prestadores de serviço", "Pequenas empresas"];

function ChatPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-gradient-to-br from-brand-500/30 via-amber-400/10 to-transparent blur-2xl" />
      <div className="relative rounded-[2rem] border border-white/10 bg-ink-900 p-3 shadow-2xl">
        <div className="rounded-[1.5rem] bg-white p-4 text-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-200 to-amber-200 text-xs font-bold text-brand-800">SL</span>
            <div>
              <p className="text-sm font-semibold">sualoja</p>
              <p className="text-[11px] text-zinc-400">Exemplo ilustrativo</p>
            </div>
          </div>
          <div className="space-y-2 py-4 text-sm">
            <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-zinc-100 px-3 py-2">Me manda o link? 😍</div>
            <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-brand-600 px-3 py-2 text-white">
              Claro! 😊 Aqui está o link para você conferir o produto 👇
            </div>
            <div className="w-fit rounded-xl border border-brand-200 px-4 py-2 text-center text-sm font-medium text-brand-700">Ver produto</div>
          </div>
          <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <Zap className="size-3.5 shrink-0" />
            <span>
              Palavra detectada: <strong>link</strong> · respondido em segundos
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { me } = useAuth();
  return (
    <div className="min-h-dvh bg-white">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo dark />
          <nav className="flex items-center gap-2 sm:gap-3">
            <a href="#como-funciona" className="hidden px-2 text-sm text-zinc-300 hover:text-white md:block">
              Como funciona
            </a>
            <a href="#recursos" className="hidden px-2 text-sm text-zinc-300 hover:text-white md:block">
              Recursos
            </a>
            {me ? (
              <ButtonLink to="/app" size="sm">
                Abrir painel
              </ButtonLink>
            ) : (
              <>
                <Link to="/login" className="px-2 text-sm font-medium text-zinc-200 hover:text-white">
                  Entrar
                </Link>
                <ButtonLink to="/cadastro" size="sm">
                  Criar conta grátis
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden bg-ink-950 text-white">
        <div className="absolute top-0 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-brand-600/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
              <ShieldCheck className="size-3.5 text-emerald-400" /> 100% API oficial da Meta
            </span>
            <h1 className="mt-5 text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">{APP_TAGLINE}</h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-300">
              Alguém comentou “LINK” ou pediu “onde comprar?” no Direct? O {APP_NAME} responde na hora com a mensagem e o link certos — enquanto você
              cuida do que importa.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to={me ? "/app" : "/cadastro"} size="lg" icon={<ArrowRight className="size-5" />} className="flex-row-reverse">
                {me ? "Ir para o painel" : "Começar grátis"}
              </ButtonLink>
              <a href="#como-funciona" className="inline-flex h-12 items-center rounded-xl border border-white/15 px-6 font-medium text-white hover:bg-white/5">
                Ver como funciona
              </a>
            </div>
            <p className="mt-4 text-sm text-zinc-400">Sem cartão de crédito. Sem senha do Instagram.</p>
          </div>
          <ChatPreview />
        </div>
      </section>

      <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Seu primeiro robô no ar em minutos</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-500">Não precisa saber programar. É só seguir os passos.</p>
        <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { n: 1, t: "Conecte o Instagram", d: "Login oficial do Instagram, em uma conta profissional. Nunca pedimos sua senha." },
            { n: 2, t: "Escolha as palavras", d: "“link”, “quero”, “preço”… Você decide o que ativa cada resposta." },
            { n: 3, t: "Escreva a resposta", d: "Texto com emojis, nome da pessoa e botão para o seu link." },
            { n: 4, t: "Publique", d: "Pronto: cada mensagem com a palavra-chave recebe a resposta automática." },
          ].map((s) => (
            <li key={s.n} className="card p-6">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{s.n}</span>
              <h3 className="mt-4 font-semibold">{s.t}</h3>
              <p className="mt-1.5 text-sm text-zinc-500">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="recursos" className="bg-zinc-50 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Tudo o que você precisa para vender pelo Direct</h2>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="card p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 [&>svg]:size-5">{f.icon}</span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Feito para quem vende e cria no Instagram</h2>
            <div className="mt-6 flex flex-wrap gap-2">
              {AUDIENCE.map((a) => (
                <span key={a} className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700">
                  {a}
                </span>
              ))}
            </div>
          </div>
          <div className="card space-y-4 p-6">
            <div className="flex gap-3">
              <ShieldCheck className="size-6 shrink-0 text-emerald-600" />
              <div>
                <h3 className="font-semibold">Seguro e dentro das regras da Meta</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Usamos apenas as APIs oficiais. Sem robôs de navegador, sem login com senha, sem atalhos que coloquem sua conta em risco. Quando um
                  recurso não existe oficialmente, nós avisamos.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <MousePointerClick className="size-6 shrink-0 text-brand-600" />
              <div>
                <h3 className="font-semibold">Saiba o que funciona</h3>
                <p className="mt-1 text-sm text-zinc-500">Cada envio, palavra detectada e clique fica registrado para você melhorar suas campanhas.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-ink-950 py-16 text-center text-white">
        <h2 className="text-3xl font-semibold tracking-tight">Comece agora — é grátis</h2>
        <p className="mt-3 text-zinc-400">Crie sua conta e publique sua primeira automação hoje.</p>
        <ButtonLink to={me ? "/app" : "/cadastro"} size="lg" className="mt-8">
          {me ? "Abrir painel" : "Criar minha conta"}
        </ButtonLink>
      </section>

      <footer className="border-t border-zinc-100 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-zinc-500 sm:flex-row sm:px-6">
          <Logo />
          <div className="flex gap-4">
            <Link to="/privacidade" className="hover:text-zinc-800">
              Privacidade
            </Link>
            <Link to="/termos" className="hover:text-zinc-800">
              Termos
            </Link>
            <Link to="/exclusao-de-dados" className="hover:text-zinc-800">
              Exclusão de dados
            </Link>
          </div>
          <p className="text-xs">Instagram é uma marca da Meta Platforms, Inc. O {APP_NAME} não é afiliado à Meta.</p>
        </div>
      </footer>
    </div>
  );
}
