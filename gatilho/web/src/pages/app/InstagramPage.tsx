import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, KeyRound, Lock, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { TRIGGER_EVENT_INFO, type TriggerEvent } from "@gatilho/shared";
import { InstagramGlyph } from "../../components/brand/Logo";
import { Avatar, Badge, Button, Callout, Card, CardTitle, PageHeader, Skeleton, useConfirm } from "../../components/ui";
import { useSystemStatus } from "../../hooks/useAuth";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime, formatNumber, relativeTime } from "../../lib/format";
import type { InstagramAccount } from "../../lib/types";
import { SetupGuide } from "./HelpPage";

export async function startInstagramConnect(returnTo = "/app/instagram") {
  const { url } = await api.post<{ url: string }>("/instagram/connect", { returnTo });
  window.location.assign(url);
}

function ConnectButton({ label = "Conectar com o Instagram", returnTo, variant = "primary" as const }: { label?: string; returnTo?: string; variant?: "primary" | "secondary" }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant={variant}
      size="lg"
      loading={loading}
      icon={<InstagramGlyph className="size-5" />}
      onClick={async () => {
        setLoading(true);
        try {
          await startInstagramConnect(returnTo);
        } catch (err) {
          toast.error(errorMessage(err));
          setLoading(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

const ACCOUNT_TYPES: Record<string, string> = { BUSINESS: "Comercial", MEDIA_CREATOR: "Criador de conteúdo", CREATOR: "Criador de conteúdo" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-sm font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

function AccountCard({ account }: { account: InstagramAccount }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const resubscribe = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>(`/instagram/accounts/${account.id}/resubscribe`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["instagram-accounts"] });
      r.ok ? toast.success("Recebimento de mensagens ativado") : toast.error("Ainda não foi possível ativar. Veja o erro na tela.");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const disconnect = async () => {
    const ok = await confirm({
      title: `Desconectar @${account.username}?`,
      description: "As automações param de responder até você conectar novamente. Seus contatos, conversas e automações continuam salvos.",
      confirmLabel: "Desconectar",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/instagram/accounts/${account.id}/disconnect`);
      qc.invalidateQueries({ queryKey: ["instagram-accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Conta desconectada");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const statusBadge =
    account.status === "connected" ? (
      <Badge tone="green" dot>CONECTADA</Badge>
    ) : account.status === "token_expired" ? (
      <Badge tone="red" dot>TOKEN EXPIRADO</Badge>
    ) : (
      <Badge tone="red" dot>COM ERRO</Badge>
    );
  const events: TriggerEvent[] = ["dm", "comment", "story_reply", "story_mention", "new_follower"];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar src={account.profilePictureUrl} name={account.name ?? account.username} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{account.name ?? account.username}</h2>
              {statusBadge}
            </div>
            <p className="text-zinc-500">@{account.username}</p>
            {account.followersCount !== null && <p className="mt-1 text-sm text-zinc-500">{formatNumber(account.followersCount)} seguidores</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectButton label="Reconectar" variant="secondary" />
            <Button variant="ghost" size="lg" icon={<Unplug className="size-4" />} onClick={disconnect} className="text-red-600 hover:bg-red-50">
              Desconectar
            </Button>
          </div>
        </div>

        {account.status === "token_expired" && (
          <Callout tone="error" className="mt-5" title="Reconecte sua conta" action={<ConnectButton label="Reconectar agora" />}>
            A autorização expirou ou foi removida nas configurações do Instagram. As automações estão paradas até a reconexão.
          </Callout>
        )}
        {account.webhookError && (
          <Callout
            tone="error"
            className="mt-5"
            title="O recebimento de mensagens não está ativo"
            action={
              <Button size="sm" icon={<RefreshCw className="size-4" />} loading={resubscribe.isPending} onClick={() => resubscribe.mutate()}>
                Tentar novamente
              </Button>
            }
          >
            {account.webhookError}
          </Callout>
        )}

        <dl className="mt-6 divide-y divide-zinc-100">
          <Row label="Tipo da conta">{ACCOUNT_TYPES[account.accountType ?? ""] ?? account.accountType ?? "Profissional"}</Row>
          <Row label="Conectada em">{formatDate(account.connectedAt)}</Row>
          <Row label="Recebimento de eventos (webhooks)">
            {account.webhookSubscribedAt ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CircleCheck className="size-4" /> Ativo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-600">
                <CircleX className="size-4" /> Inativo
              </span>
            )}
          </Row>
          <Row label="Último evento recebido">{account.lastWebhookAt ? relativeTime(account.lastWebhookAt) : "Nenhum ainda"}</Row>
          <Row label="Autorização válida até">{account.tokenExpiresAt ? `${formatDate(account.tokenExpiresAt)} (renovada automaticamente)` : "—"}</Row>
          {account.lastError && <Row label="Último erro">{`${account.lastError}${account.lastErrorAt ? ` · ${formatDateTime(account.lastErrorAt)}` : ""}`}</Row>}
        </dl>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
          <Lock className="size-3.5" /> O token de acesso fica criptografado no servidor e nunca é exibido.
        </p>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardTitle title="Recursos disponíveis" description="Conforme a API oficial e as permissões concedidas." />
          <ul className="space-y-3">
            {events.map((ev) => {
              const info = TRIGGER_EVENT_INFO[ev];
              const permitted = ev === "comment" ? account.permissions.comments : ev === "new_follower" ? false : account.permissions.messages;
              const ok = info.available && permitted;
              return (
                <li key={ev} className="flex gap-2.5 text-sm">
                  {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-zinc-300" />}
                  <div>
                    <p className={ok ? "font-medium" : "font-medium text-zinc-500"}>{info.label}</p>
                    {!info.available ? (
                      <p className="text-xs text-zinc-500">{info.unavailableReason}</p>
                    ) : !permitted ? (
                      <p className="text-xs text-amber-700">Permissão “{info.permission}” não concedida. Reconecte e autorize todas as permissões.</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardTitle title="Permissões concedidas" />
          <div className="flex flex-wrap gap-1.5">
            {account.scopes.map((s) => (
              <Badge key={s} tone="gray">
                <KeyRound className="size-3" /> {s}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function InstagramPage() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api.get<{ accounts: InstagramAccount[] }>("/instagram/accounts") });
  const { data: system } = useSystemStatus();
  const result = params.get("instagram");
  const message = params.get("mensagem");

  useEffect(() => {
    if (result === "connected") toast.success("Instagram conectado com sucesso! 🎉");
  }, [result]);

  const clearResult = () => {
    params.delete("instagram");
    params.delete("mensagem");
    setParams(params, { replace: true });
  };

  const account = data?.accounts[0];

  return (
    <div>
      <PageHeader title="Conectar Instagram" description="Conexão oficial com a Meta para responder Direct, comentários e Stories." />
      {result && result !== "connected" && (
        <Callout tone={result === "denied" ? "warning" : "error"} className="mb-6" title={result === "denied" ? "Conexão cancelada" : "Não foi possível conectar"} action={<Button size="sm" variant="secondary" onClick={clearResult}>Fechar</Button>}>
          {message ?? "Tente novamente."}
        </Callout>
      )}

      {isLoading ? (
        <Skeleton className="h-72" />
      ) : account ? (
        <AccountCard account={account} />
      ) : !system?.instagramEnabled ? (
        <div className="space-y-6">
          <Callout tone="warning" title="A integração com a Meta ainda não foi configurada neste servidor">
            Para conectar contas do Instagram, o administrador precisa criar um app na Meta e configurar as variáveis <code>INSTAGRAM_APP_ID</code>,{" "}
            <code>INSTAGRAM_APP_SECRET</code> e <code>META_WEBHOOK_VERIFY_TOKEN</code>. O passo a passo está abaixo.
          </Callout>
          <SetupGuide />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="flex flex-col items-start gap-5 p-8">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <InstagramGlyph className="size-7" />
            </span>
            <div>
              <h2 className="text-xl font-semibold">Conecte sua conta profissional do Instagram</h2>
              <p className="mt-2 max-w-xl text-zinc-600">
                Você será levado ao Instagram para entrar e autorizar o acesso. Nós <strong>nunca</strong> pedimos sua senha — a conexão usa o login
                oficial da Meta.
              </p>
            </div>
            <ConnectButton />
            <ul className="space-y-2 text-sm text-zinc-600">
              {["Ler o perfil básico da conta (nome, @ e foto)", "Receber e enviar mensagens do Direct", "Ler comentários e enviar respostas privadas"].map((p) => (
                <li key={p} className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {p}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardTitle title="Antes de conectar" />
            <ol className="list-decimal space-y-3 pl-5 text-sm text-zinc-600">
              <li>
                A conta precisa ser <strong>profissional</strong> (Comercial ou Criador de conteúdo). No app: Configurações → Tipo de conta e
                ferramentas.
              </li>
              <li>
                Ative <strong>“Permitir acesso às mensagens”</strong>: Configurações → Mensagens e respostas aos stories → Ferramentas conectadas.
              </li>
              <li>Na tela da Meta, mantenha todas as permissões marcadas para liberar Direct e comentários.</li>
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
