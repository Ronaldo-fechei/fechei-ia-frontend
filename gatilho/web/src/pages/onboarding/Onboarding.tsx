import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, PartyPopper, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { InstagramGlyph, Logo } from "../../components/brand/Logo";
import { KeywordEditor, type KeywordValue } from "../../components/automation/KeywordEditor";
import { MessageEditor } from "../../components/automation/MessageEditor";
import { PhonePreview, previewText } from "../../components/automation/PhonePreview";
import { Simulator } from "../../components/automation/Simulator";
import { Avatar, Button, ButtonLink, Callout, Card, Field, Input } from "../../components/ui";
import { useAuth, useMe, useSystemStatus } from "../../hooks/useAuth";
import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { InstagramAccount } from "../../lib/types";
import { startInstagramConnect } from "../app/InstagramPage";

const STEPS = ["Conectar Instagram", "Primeira automação", "Palavra-chave", "Resposta", "Publicar"];

export default function Onboarding() {
  const me = useMe();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: system } = useSystemStatus();
  const accounts = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api.get<{ accounts: InstagramAccount[] }>("/instagram/accounts") });
  const account = accounts.data?.accounts[0];
  const [step, setStep] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [name, setName] = useState("Link do produto");
  const [keywords, setKeywords] = useState<KeywordValue[]>([
    { text: "link", matchType: "contains_word", caseSensitive: false, ignoreAccents: true },
    { text: "quero", matchType: "contains_word", caseSensitive: false, ignoreAccents: true },
  ]);
  const [message, setMessage] = useState("Claro! Aqui está o link 👇");
  const [url, setUrl] = useState("");
  const [buttonTitle, setButtonTitle] = useState("Ver produto");
  const [publishing, setPublishing] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    const result = params.get("instagram");
    if (result === "connected") toast.success("Instagram conectado! 🎉");
    else if (result) toast.error(params.get("mensagem") ?? "Não foi possível conectar o Instagram.");
  }, [params]);

  const connect = async () => {
    setConnecting(true);
    try {
      await startInstagramConnect("/onboarding");
    } catch (err) {
      toast.error(errorMessage(err));
      setConnecting(false);
    }
  };

  const finish = async (skip = false) => {
    await api.post("/workspace/onboarding", { completed: true }).catch(() => undefined);
    await refresh();
    if (skip) navigate("/app");
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const { automation } = await api.post<{ automation: { id: string } }>("/automations", {
        name,
        mode: "quick",
        quick: { triggerEvent: "dm", keywords, message, linkUrl: url.trim(), buttonTitle: url.trim() ? buttonTitle || "Abrir link" : "" },
        publish: true,
      });
      setCreatedId(automation.id);
      qc.invalidateQueries({ queryKey: ["automations"] });
      await finish();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPublishing(false);
    }
  };

  const canNext = [true, name.trim().length > 0, keywords.length > 0, message.trim().length > 0 && (!url || /^https?:\/\/.+\..+/.test(url)), true][step];
  const outputs = url
    ? [{ kind: "buttons" as const, text: previewText(message, url), buttons: [{ type: "url" as const, title: buttonTitle || "Abrir link", url }] }]
    : [{ kind: "text" as const, text: previewText(message) }];

  if (createdId) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-white px-6 py-12 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <PartyPopper className="size-8" />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Seu primeiro robô está ativo.</h1>
        <p className="mt-3 max-w-md text-zinc-600">
          {account
            ? `Quando alguém mandar “${keywords[0]?.text.toUpperCase()}” para @${account.username}, a resposta sai automaticamente.`
            : "Conecte o Instagram para que ele comece a responder as mensagens."}
        </p>
        <div className="mt-8 w-full max-w-md">
          <Simulator automationId={createdId} className="h-80 text-left" />
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {!account && (
            <Button icon={<InstagramGlyph className="size-4" />} onClick={connect} loading={connecting}>
              Conectar Instagram
            </Button>
          )}
          <ButtonLink to="/app" variant={account ? "primary" : "secondary"}>
            Ir para o painel
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <Logo />
        <button onClick={() => finish(true)} className="text-sm text-zinc-500 hover:text-zinc-800">
          Pular e ir para o painel
        </button>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Vamos configurar seu Instagram, {me.user.name.split(" ")[0]}!</h1>
        <p className="mt-1 text-zinc-500">Em poucos passos seu robô começa a responder as mensagens.</p>
        <ol className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm", i === step ? "bg-brand-600 text-white" : i < step ? "bg-emerald-100 text-emerald-800" : "bg-white text-zinc-500 ring-1 ring-zinc-200")}>
              <span className="flex size-5 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">{i < step ? <Check className="size-3.5" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="p-6">
            {step === 0 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">Etapa 1: Conectar Instagram</h2>
                {account ? (
                  <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4">
                    <Avatar src={account.profilePictureUrl} name={account.username} size={44} />
                    <div>
                      <p className="font-medium">@{account.username}</p>
                      <p className="text-sm text-emerald-700">Conectado com sucesso</p>
                    </div>
                  </div>
                ) : !system?.instagramEnabled ? (
                  <Callout tone="warning" title="Integração com a Meta ainda não configurada">
                    O servidor ainda não tem as credenciais do app da Meta. Você pode criar sua automação agora e conectar depois — veja o passo a passo em
                    Ajuda.
                  </Callout>
                ) : (
                  <>
                    <p className="text-zinc-600">
                      Use uma conta <strong>profissional</strong> (Comercial ou Criador). Você vai entrar pelo site oficial do Instagram — nunca pedimos
                      sua senha.
                    </p>
                    <Callout tone="info">No app do Instagram, ative: Configurações → Mensagens e respostas aos stories → Ferramentas conectadas → Permitir acesso às mensagens.</Callout>
                    <Button size="lg" icon={<InstagramGlyph className="size-5" />} onClick={connect} loading={connecting}>
                      Conectar com o Instagram
                    </Button>
                  </>
                )}
              </div>
            )}
            {step === 1 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">Etapa 2: Quer criar sua primeira automação?</h2>
                <p className="text-zinc-600">Vamos começar com a mais usada: enviar o link de um produto quando alguém pedir.</p>
                <Field label="Nome">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </Field>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">Etapa 3: Definir palavra-chave</h2>
                <p className="text-zinc-600">Quando a mensagem tiver uma destas palavras, a resposta é enviada.</p>
                <KeywordEditor value={keywords} onChange={setKeywords} />
              </div>
            )}
            {step === 3 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">Etapa 4: Definir resposta</h2>
                <Field label="Resposta">
                  <MessageEditor value={message} onChange={setMessage} rows={4} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <Field label="URL" optional hint="O link do produto (Shopee, Mercado Livre, Amazon, seu site…)">
                    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
                  </Field>
                  <Field label="Texto do botão">
                    <Input value={buttonTitle} onChange={(e) => setButtonTitle(e.target.value)} maxLength={20} disabled={!url} />
                  </Field>
                </div>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold">Etapa 5: Publicar</h2>
                <dl className="space-y-2 rounded-xl bg-zinc-50 p-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Nome</dt>
                    <dd className="font-medium">{name}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Palavras-chave</dt>
                    <dd className="text-right font-medium">{keywords.map((k) => k.text.toUpperCase()).join(", ")}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">Link</dt>
                    <dd className="truncate font-medium">{url || "—"}</dd>
                  </div>
                </dl>
                {!account && <Callout tone="warning">Sem Instagram conectado, a automação fica ativa mas só começa a responder depois da conexão.</Callout>}
                <Button size="lg" icon={<Rocket className="size-5" />} onClick={publish} loading={publishing}>
                  Ativar automação
                </Button>
              </div>
            )}

            <div className="mt-8 flex justify-between border-t border-zinc-100 pt-5">
              <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                Voltar
              </Button>
              {step < 4 && (
                <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="flex-row-reverse" icon={<ArrowRight className="size-4" />}>
                  {step === 0 && !account ? "Fazer depois" : step === 1 ? "Começar" : "Continuar"}
                </Button>
              )}
            </div>
          </Card>
          <div className="hidden lg:block">
            <PhonePreview incoming={keywords[0] ? `Oi! Me manda o ${keywords[0].text}?` : undefined} outputs={outputs} />
            <p className="mt-3 text-center text-xs text-zinc-500">Pré-visualização da resposta</p>
          </div>
        </div>
        <p className="mt-8 text-center text-xs text-zinc-400">
          Precisa de ajuda?{" "}
          <Link to="/app/ajuda" className="underline">
            Veja o guia
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
