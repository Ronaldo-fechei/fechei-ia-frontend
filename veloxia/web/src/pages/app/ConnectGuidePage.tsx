import { ArrowRight, BatteryFull, Check, ChevronLeft, ChevronRight, Clock, CreditCard, Hand, Lightbulb, MessageSquareText, ShieldCheck, Signal, Smartphone, TriangleAlert, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { APP_NAME, CHANNEL_INFO, type Channel } from "@veloxia/shared";
import { ChannelGlyph, Logo } from "../../components/brand/Logo";
import { ButtonLink, Card, PageHeader, Tabs } from "../../components/ui";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ */
/* Peças das ilustrações (telas desenhadas, sem marcas de terceiros)  */
/* ------------------------------------------------------------------ */

/** Celular em miniatura usado nas ilustrações dos passos. */
function MiniPhone({ title, children, back = true, tone = "light" }: { title?: ReactNode; children: ReactNode; back?: boolean; tone?: "light" | "brand" }) {
  return (
    <div className="mx-auto w-[184px] rounded-[1.6rem] bg-ink-900 p-[6px] shadow-card ring-1 ring-black/10">
      <div className={cn("flex h-[300px] flex-col overflow-hidden rounded-[1.25rem] text-[11px] text-zinc-800", tone === "brand" ? "bg-brand-50" : "bg-white")}>
        <div className="relative flex h-6 shrink-0 items-center justify-between px-4 text-[9px] font-semibold">
          <span>9:41</span>
          <span aria-hidden className="absolute top-1.5 left-1/2 h-3.5 w-14 -translate-x-1/2 rounded-full bg-ink-900" />
          <span className="flex items-center gap-0.5" aria-hidden>
            <Signal className="size-2.5" />
            <Wifi className="size-2.5" />
            <BatteryFull className="size-3" />
          </span>
        </div>
        {title && (
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-100 px-2.5 py-1.5 font-semibold">
            {back && <ChevronLeft className="size-3.5 text-zinc-500" aria-hidden />}
            <span className="truncate">{title}</span>
          </div>
        )}
        <div className="flex-1 space-y-1 overflow-hidden p-2">{children}</div>
      </div>
    </div>
  );
}

/** Linha de menu; `active` destaca onde tocar. */
function Row({ children, active, toggle, chevron = true }: { children: ReactNode; active?: boolean; toggle?: boolean; chevron?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-between gap-1 rounded-lg px-2 py-1.5",
        active ? "bg-brand-50 font-semibold text-brand-800 ring-2 ring-brand-500" : "text-zinc-600",
      )}
    >
      <span className="truncate">{children}</span>
      {toggle !== undefined ? (
        <span className={cn("flex h-3.5 w-6 shrink-0 items-center rounded-full p-0.5", toggle ? "justify-end bg-emerald-500" : "bg-zinc-300")}>
          <span className="size-2.5 rounded-full bg-white" />
        </span>
      ) : (
        chevron && <ChevronRight className="size-3 shrink-0 text-zinc-400" aria-hidden />
      )}
      {active && <Tap />}
    </div>
  );
}

/** Indicador de toque. */
function Tap({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("absolute -right-1 -bottom-3 flex size-6 items-center justify-center rounded-full bg-brand-600 text-white shadow-pop", className)}>
      <Hand className="size-3.5" />
    </span>
  );
}

function FakeButton({ children, tone = "brand", tap }: { children: ReactNode; tone?: "brand" | "green" | "blue"; tap?: boolean }) {
  const tones = { brand: "bg-brand-600", green: "bg-emerald-600", blue: "bg-sky-600" };
  return (
    <div className={cn("relative mt-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-center font-semibold text-white ring-2 ring-offset-1", tones[tone], tone === "brand" ? "ring-brand-300" : tone === "green" ? "ring-emerald-300" : "ring-sky-300")}>
      {children}
      {tap && <Tap />}
    </div>
  );
}

function Line({ w = "w-full" }: { w?: string }) {
  return <div className={cn("h-1.5 rounded-full bg-zinc-200", w)} />;
}

function VeloxiaBar() {
  return (
    <div className="mb-1 flex items-center gap-1 rounded-md bg-ink-900 px-1.5 py-1 text-[10px] font-semibold text-white">
      <span className="flex size-3.5 items-center justify-center rounded bg-brand-600 text-[8px]">V</span>
      {APP_NAME}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estrutura de um passo                                               */
/* ------------------------------------------------------------------ */

interface Step {
  title: string;
  where: string;
  text: ReactNode;
  tip?: ReactNode;
  warn?: ReactNode;
  art: ReactNode;
}

function StepCard({ n, step, last }: { n: number; step: Step; last: boolean }) {
  return (
    <li className="relative">
      <Card className="flex h-full flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-sm">{n}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-zinc-900">{step.title}</h3>
            <p className="text-xs font-medium tracking-wide text-brand-700 uppercase">{step.where}</p>
          </div>
        </div>
        <div className="rounded-2xl bg-gradient-to-br from-zinc-50 to-brand-50/60 py-5">{step.art}</div>
        <div className="space-y-3 text-sm leading-relaxed text-zinc-600">
          <div>{step.text}</div>
          {step.tip && (
            <p className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
              <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{step.tip}</span>
            </p>
          )}
          {step.warn && (
            <p className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-800">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{step.warn}</span>
            </p>
          )}
        </div>
      </Card>
      {!last && (
        <span aria-hidden className="absolute top-1/2 -right-4 z-10 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full bg-white text-brand-600 shadow-card ring-1 ring-zinc-200 xl:flex">
          <ArrowRight className="size-3.5" />
        </span>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Instagram                                                           */
/* ------------------------------------------------------------------ */

const INSTAGRAM_STEPS: Step[] = [
  {
    title: "Use uma conta profissional",
    where: "No app do Instagram",
    text: (
      <>
        Perfil → <b>☰</b> → <b>Configurações e privacidade</b> → <b>Tipo de conta e ferramentas</b>. Se aparecer “Mudar para conta profissional”, toque e
        escolha <b>Empresa</b> ou <b>Criador de conteúdo</b>. É grátis.
      </>
    ),
    tip: "Se aparecer “Mudar para conta pessoal”, a sua conta já é profissional — pule este passo.",
    art: (
      <MiniPhone title="Configurações e privacidade">
        <Row>Central de Contas</Row>
        <Row>Notificações</Row>
        <Row>Privacidade da conta</Row>
        <Row active>Tipo de conta e ferramentas</Row>
        <div className="pt-3" />
        <Row>Ajuda</Row>
      </MiniPhone>
    ),
  },
  {
    title: "Permita o acesso às mensagens",
    where: "No app do Instagram",
    text: (
      <>
        <b>Configurações e privacidade</b> → <b>Mensagens e respostas aos stories</b> → <b>Ferramentas conectadas</b> → ligue <b>Permitir acesso às mensagens</b>.
      </>
    ),
    tip: "Sem essa opção ligada, o Instagram não entrega as mensagens do Direct para o robô.",
    art: (
      <MiniPhone title="Ferramentas conectadas">
        <div className="space-y-1.5 px-1 pt-1 pb-2">
          <Line w="w-11/12" />
          <Line w="w-8/12" />
        </div>
        <Row toggle active>
          Permitir acesso às mensagens
        </Row>
        <div className="space-y-1.5 px-1 pt-3">
          <Line w="w-10/12" />
          <Line w="w-7/12" />
        </div>
      </MiniPhone>
    ),
  },
  {
    title: `Clique em conectar no ${APP_NAME}`,
    where: `No ${APP_NAME}`,
    text: (
      <>
        No menu, abra <b>Canais</b> → aba <b>Instagram</b> → <b>Conectar com o Instagram</b>.
      </>
    ),
    art: (
      <MiniPhone title="Canais" back={false} tone="brand">
        <VeloxiaBar />
        <div className="flex gap-1 text-[10px]">
          <span className="rounded-md bg-white px-1.5 py-0.5 font-semibold text-brand-700 ring-1 ring-brand-200">Instagram</span>
          <span className="px-1.5 py-0.5 text-zinc-500">WhatsApp</span>
        </div>
        <div className="mt-1 space-y-1.5 rounded-lg bg-white p-2">
          <ChannelGlyph channel="instagram" className="size-5 text-brand-600" />
          <Line w="w-10/12" />
          <Line w="w-8/12" />
          <FakeButton tap>
            <ChannelGlyph channel="instagram" className="size-3" /> Conectar
          </FakeButton>
        </div>
      </MiniPhone>
    ),
  },
  {
    title: "Entre e toque em Permitir",
    where: "Na página oficial do Instagram",
    text: (
      <>
        Abre a página oficial do Instagram. Entre com a conta da sua empresa e toque em <b>Permitir</b>, mantendo todas as permissões marcadas.
      </>
    ),
    tip: (
      <>
        No celular, se o app do Instagram abrir e você não voltar para o {APP_NAME}, faça a conexão numa <b>aba anônima</b> do navegador (⋮ → Nova guia
        anônima).
      </>
    ),
    warn: <>Sua senha é digitada só na página do Instagram. O {APP_NAME} nunca pede sua senha.</>,
    art: (
      <MiniPhone title={`${APP_NAME} quer acessar`} back={false}>
        {["Seu perfil (nome, @ e foto)", "Mensagens do Direct", "Comentários"].map((p) => (
          <div key={p} className="flex items-center gap-1.5 px-1 py-1">
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-sky-600 text-white">
              <Check className="size-2.5" />
            </span>
            <span className="truncate text-zinc-700">{p}</span>
          </div>
        ))}
        <div className="pt-5" />
        <FakeButton tone="blue" tap>
          Permitir
        </FakeButton>
        <p className="pt-1 text-center text-[10px] text-zinc-400">Cancelar</p>
      </MiniPhone>
    ),
  },
  {
    title: "Pronto: conta conectada!",
    where: `De volta ao ${APP_NAME}`,
    text: (
      <>
        Você volta para o {APP_NAME} com o selo <b className="text-emerald-700">CONECTADA</b>. Agora crie sua primeira automação em{" "}
        <b>Automações → Nova automação</b>.
      </>
    ),
    art: (
      <MiniPhone title="Canais" back={false} tone="brand">
        <VeloxiaBar />
        <div className="space-y-1.5 rounded-lg bg-white p-2">
          <div className="flex items-center gap-1.5">
            <span className="size-7 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600" />
            <div className="min-w-0 flex-1 space-y-1">
              <Line w="w-10/12" />
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                ● CONECTADA
              </span>
            </div>
          </div>
          <div className="space-y-1 pt-1">
            {["Mensagem direta", "Comentário → Direct", "Stories"].map((r) => (
              <div key={r} className="flex items-center gap-1 text-[10px] text-zinc-600">
                <Check className="size-3 text-emerald-600" /> {r}
              </div>
            ))}
          </div>
        </div>
      </MiniPhone>
    ),
  },
];

/* ------------------------------------------------------------------ */
/* WhatsApp                                                            */
/* ------------------------------------------------------------------ */

const WHATSAPP_STEPS: Step[] = [
  {
    title: "Escolha o número da empresa",
    where: "Antes de começar",
    text: (
      <>
        Use um celular que receba <b>SMS ou ligação</b> para o código de verificação. Pode ser um chip novo ou o número que você já usa no app{" "}
        <b>WhatsApp Business</b>.
      </>
    ),
    warn: (
      <>
        Um número que está no <b>WhatsApp comum</b> (pessoal) sai do app do celular ao ser conectado. Prefira um chip novo ou passe o número para o app
        WhatsApp Business antes.
      </>
    ),
    art: (
      <MiniPhone title="Seu número" back={false}>
        <div className="flex flex-col items-center gap-2 pt-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Smartphone className="size-6" />
          </span>
          <div className="w-full rounded-lg bg-zinc-50 p-2 text-center font-semibold tracking-wide">+55 (11) 9 ••••-••••</div>
          <div className="w-full space-y-1 rounded-lg p-1.5 text-[10px] text-zinc-600 ring-1 ring-zinc-200">
            <div className="flex items-center gap-1">
              <Check className="size-3 text-emerald-600" /> Recebe SMS ou ligação
            </div>
            <div className="flex items-center gap-1">
              <Check className="size-3 text-emerald-600" /> Chip novo ou app Business
            </div>
          </div>
        </div>
      </MiniPhone>
    ),
  },
  {
    title: `Clique em conectar no ${APP_NAME}`,
    where: `No ${APP_NAME}`,
    text: (
      <>
        Abra <b>Canais</b> → aba <b>WhatsApp</b>. Se o número já está no app WhatsApp Business, marque <b>“Este número já é usado no app WhatsApp Business”</b>.
        Depois clique em <b>Conectar WhatsApp</b>.
      </>
    ),
    art: (
      <MiniPhone title="Canais" back={false} tone="brand">
        <VeloxiaBar />
        <div className="flex gap-1 text-[10px]">
          <span className="px-1.5 py-0.5 text-zinc-500">Instagram</span>
          <span className="rounded-md bg-white px-1.5 py-0.5 font-semibold text-brand-700 ring-1 ring-brand-200">WhatsApp</span>
        </div>
        <div className="mt-1 space-y-1.5 rounded-lg bg-white p-2">
          <ChannelGlyph channel="whatsapp" className="size-5 text-emerald-600" />
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <span className="size-2.5 rounded-sm ring-1 ring-zinc-400" /> Já uso o app Business
          </div>
          <FakeButton tap>
            <ChannelGlyph channel="whatsapp" className="size-3" /> Conectar
          </FakeButton>
        </div>
      </MiniPhone>
    ),
  },
  {
    title: "Entre com o Facebook e escolha a empresa",
    where: "Na janela oficial da Meta",
    text: (
      <>
        Abre uma janela da Meta. Entre com o seu Facebook e escolha o <b>portfólio empresarial</b> da sua empresa — ou crie um ali mesmo, com o nome da
        empresa.
      </>
    ),
    tip: "Se o navegador bloquear a janela, permita pop-ups para o site e clique em conectar de novo.",
    art: (
      <MiniPhone title="Escolha a empresa" back={false}>
        <div className="space-y-1.5 pt-1">
          <Row active chevron={false}>
            ● Minha Empresa
          </Row>
          <Row chevron={false}>○ Criar portfólio</Row>
          <div className="space-y-1.5 px-1 pt-3">
            <Line w="w-11/12" />
            <Line w="w-9/12" />
          </div>
        </div>
        <div className="pt-6" />
        <FakeButton tone="blue">Continuar</FakeButton>
      </MiniPhone>
    ),
  },
  {
    title: "Confirme o número com o código",
    where: "Na janela oficial da Meta",
    text: (
      <>
        Escolha ou adicione o número, informe o <b>nome que os clientes vão ver</b> e digite o código recebido por SMS ou ligação.
      </>
    ),
    tip: "O nome de exibição passa por uma revisão rápida da Meta. Use o nome real da sua empresa.",
    art: (
      <MiniPhone title="Verificar número" back={false}>
        <p className="px-1 pt-1 text-[10px] text-zinc-500">Digite o código enviado por SMS</p>
        <div className="flex justify-center gap-1 py-3">
          {["4", "8", "2", "6", "1", "9"].map((d, i) => (
            <span key={i} className="flex h-7 w-5 items-center justify-center rounded-md bg-zinc-50 font-bold ring-1 ring-zinc-300">
              {d}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1 px-1 text-[10px] text-zinc-600">
          <MessageSquareText className="size-3" /> Nome: Minha Empresa
        </div>
        <div className="pt-6" />
        <FakeButton tone="blue" tap>
          Concluir
        </FakeButton>
      </MiniPhone>
    ),
  },
  {
    title: "Cadastre um cartão na Meta",
    where: "No Gerenciador do WhatsApp (Meta)",
    text: (
      <>
        Em <b>Gerenciador do WhatsApp → Cobrança</b>, cadastre um cartão. A Meta cobra direto dele as mensagens do WhatsApp — não passa pelo {APP_NAME}.
      </>
    ),
    tip: "Responder o cliente em até 24 h depois da mensagem dele não é cobrado pela Meta. Só mensagens de modelo (lembretes, ofertas) são cobradas.",
    art: (
      <MiniPhone title="Cobrança" back={false}>
        <div className="mx-1 mt-2 rounded-xl bg-gradient-to-br from-zinc-700 to-ink-900 p-2.5 text-white shadow-card">
          <CreditCard className="size-4 opacity-80" />
          <p className="pt-3 font-mono text-[10px] tracking-widest">•••• •••• •••• 4242</p>
          <p className="pt-1 text-[9px] opacity-70">Sua empresa</p>
        </div>
        <div className="pt-6" />
        <FakeButton tone="blue" tap>
          Adicionar forma de pagamento
        </FakeButton>
      </MiniPhone>
    ),
  },
  {
    title: "Pronto: WhatsApp conectado!",
    where: `De volta ao ${APP_NAME}`,
    text: (
      <>
        O número aparece em <b>Canais → WhatsApp</b> como <b className="text-emerald-700">CONECTADO</b>, com a qualidade e o limite do número. Agora é só criar
        automações marcando o canal <b>WhatsApp</b>.
      </>
    ),
    art: (
      <MiniPhone title="Canais" back={false} tone="brand">
        <VeloxiaBar />
        <div className="space-y-1.5 rounded-lg bg-white p-2">
          <div className="flex items-center gap-1.5">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <ChannelGlyph channel="whatsapp" className="size-4" />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <Line w="w-10/12" />
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                ● CONECTADO
              </span>
            </div>
          </div>
          <div className="space-y-1 pt-1 text-[10px] text-zinc-600">
            <div className="flex justify-between">
              <span>Qualidade</span>
              <span className="font-semibold text-emerald-700">Alta</span>
            </div>
            <div className="flex justify-between">
              <span>Webhooks</span>
              <span className="font-semibold text-emerald-700">Ativo</span>
            </div>
          </div>
        </div>
      </MiniPhone>
    ),
  },
];

const NEEDS: Record<Channel, { time: string; items: string[] }> = {
  instagram: {
    time: "cerca de 3 minutos",
    items: ["Instagram da empresa (conta profissional)", "Acesso ao app do Instagram no celular", "Usuário e senha do Instagram (digitados só no Instagram)"],
  },
  whatsapp: {
    time: "cerca de 10 minutos",
    items: ["Conta no Facebook (para entrar na Meta)", "Um número que receba SMS ou ligação", "Cartão de crédito para cadastrar na Meta"],
  },
};

const PROBLEMS: Record<Channel, { q: string; a: ReactNode }[]> = {
  instagram: [
    { q: "Não acho “Permitir acesso às mensagens”", a: "Confira se a conta é profissional (passo 1). Em contas pessoais essa opção não aparece. Atualize o app do Instagram." },
    {
      q: "No celular, abriu o app do Instagram e não voltou",
      a: "Faça a conexão numa aba anônima do navegador, ou pelo computador. A página de autorização precisa abrir no navegador.",
    },
    { q: "Apareceu “Reconecte o Instagram”", a: "A autorização expirou ou foi removida no Instagram. Em Canais, clique em Reconectar e permita de novo." },
    { q: "Conectei, mas o robô não responde", a: "Confira se a automação está ATIVA e use o botão “Testar”. Em Automações → Logs aparece o motivo de cada mensagem não respondida." },
  ],
  whatsapp: [
    { q: "A janela da Meta não abriu", a: "O navegador bloqueou o pop-up. Permita pop-ups para este site e clique em Conectar WhatsApp de novo." },
    {
      q: "Meu número está no WhatsApp pessoal",
      a: "Ao conectar, ele sai do app do celular. Use um chip novo, ou instale o app WhatsApp Business, passe o número para ele e marque a opção de app Business ao conectar.",
    },
    { q: "Não recebi o código", a: "Escolha receber por ligação na janela da Meta e confira se o número está certo, com DDD." },
    { q: "Aparece aviso de pagamento", a: "Cadastre ou atualize o cartão no Gerenciador do WhatsApp → Cobrança. Sem forma de pagamento, a Meta bloqueia mensagens cobradas." },
  ],
};

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export default function ConnectGuidePage() {
  const [params, setParams] = useSearchParams();
  const channel: Channel = params.get("canal") === "whatsapp" ? "whatsapp" : "instagram";
  const steps = channel === "whatsapp" ? WHATSAPP_STEPS : INSTAGRAM_STEPS;
  const needs = NEEDS[channel];

  return (
    <div>
      <PageHeader
        title="Como conectar"
        description="Passo a passo ilustrado para conectar seu Instagram e seu WhatsApp. Leva poucos minutos e não precisa saber nada técnico."
        actions={
          <ButtonLink to={`/app/canais?canal=${channel}`} icon={<ChannelGlyph channel={channel} className="size-4" />}>
            Ir para Canais
          </ButtonLink>
        }
      />

      <Tabs
        className="mb-6"
        value={channel}
        onChange={(c) => setParams({ canal: c }, { replace: true })}
        items={(["instagram", "whatsapp"] as Channel[]).map((c) => ({
          value: c,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <ChannelGlyph channel={c} className="size-4" />
              {CHANNEL_INFO[c].label}
            </span>
          ),
        }))}
      />

      <div className="mb-8 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="flex items-center gap-4 bg-gradient-to-br from-brand-600 to-brand-800 text-white ring-0">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <Clock className="size-6" />
          </span>
          <div>
            <p className="text-sm text-white/80">Tempo estimado</p>
            <p className="text-xl font-semibold">{needs.time}</p>
            <p className="text-sm text-white/80">{steps.length} passos</p>
          </div>
        </Card>
        <Card>
          <p className="mb-3 font-semibold">Você vai precisar de</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {needs.items.map((i) => (
              <li key={i} className="flex gap-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                {i}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ol className={cn("grid gap-6 sm:grid-cols-2", channel === "whatsapp" ? "xl:grid-cols-3" : "xl:grid-cols-3 2xl:grid-cols-5")}>
        {steps.map((s, i) => (
          <StepCard key={s.title} n={i + 1} step={s} last={i === steps.length - 1} />
        ))}
      </ol>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <p className="mb-3 font-semibold">Deu algum problema?</p>
          <div className="divide-y divide-zinc-100">
            {PROBLEMS[channel].map((p) => (
              <details key={p.q} className="group py-3">
                <summary className="cursor-pointer list-none font-medium text-zinc-900 select-none">
                  <span className="mr-2 inline-block text-brand-600 transition-transform group-open:rotate-90">›</span>
                  {p.q}
                </summary>
                <p className="mt-2 pl-5 text-sm leading-relaxed text-zinc-600">{p.a}</p>
              </details>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col items-start gap-4 bg-ink-950 text-white ring-0">
          <Logo dark />
          <div>
            <p className="text-lg font-semibold">Pronto para conectar?</p>
            <p className="mt-1 text-sm text-zinc-300">
              <ShieldCheck className="mr-1 inline size-4 text-emerald-400" />
              Conexão oficial da Meta. Nunca pedimos sua senha.
            </p>
          </div>
          <ButtonLink to={`/app/canais?canal=${channel}`} className="w-full">
            Conectar {CHANNEL_INFO[channel].label} agora
          </ButtonLink>
        </Card>
      </div>
    </div>
  );
}
