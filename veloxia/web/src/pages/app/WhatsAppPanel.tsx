import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, CreditCard, FileCheck2, Lock, Plus, RefreshCw, ShieldCheck, Trash, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { WHATSAPP_PRICING_LABELS, WHATSAPP_TEMPLATE_STATUS_LABELS, type WhatsAppPricingCategory } from "@veloxia/shared";
import { WhatsAppGlyph } from "../../components/brand/Logo";
import { Badge, Button, Callout, Card, CardTitle, Checkbox, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea, useConfirm } from "../../components/ui";
import { useChannelAccounts } from "../../hooks/useChannels";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatNumber, relativeTime } from "../../lib/format";
import type { ChannelAccount, WhatsAppTemplate, WhatsAppUsage } from "../../lib/types";
import { runEmbeddedSignup, SignupCancelled } from "../../lib/whatsappSignup";

interface WhatsAppConfig {
  enabled: boolean;
  appId: string | null;
  configId: string | null;
  graphApiVersion: string;
}

const QUALITY: Record<string, { label: string; tone: "green" | "yellow" | "red" | "gray" }> = {
  GREEN: { label: "Alta", tone: "green" },
  YELLOW: { label: "Média", tone: "yellow" },
  RED: { label: "Baixa", tone: "red" },
};

const TIERS: Record<string, string> = {
  TIER_250: "250 conversas iniciadas por dia",
  TIER_1K: "1.000 conversas iniciadas por dia",
  TIER_10K: "10.000 conversas iniciadas por dia",
  TIER_100K: "100.000 conversas iniciadas por dia",
  TIER_UNLIMITED: "Sem limite diário",
};

const brl = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

function useWhatsAppConfig() {
  return useQuery({ queryKey: ["whatsapp-config"], queryFn: () => api.get<WhatsAppConfig>("/whatsapp/config"), staleTime: 5 * 60_000 });
}

export function ConnectWhatsAppButton({ label = "Conectar WhatsApp", variant = "primary" as const, coexistence = false }: { label?: string; variant?: "primary" | "secondary"; coexistence?: boolean }) {
  const qc = useQueryClient();
  const { data: config } = useWhatsAppConfig();
  const [loading, setLoading] = useState(false);
  const start = async () => {
    if (!config?.enabled || !config.appId || !config.configId) return;
    setLoading(true);
    try {
      const result = await runEmbeddedSignup({ appId: config.appId, configId: config.configId, version: config.graphApiVersion, coexistence });
      await api.post("/whatsapp/connect", result);
      qc.invalidateQueries({ queryKey: ["channel-accounts"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("WhatsApp conectado com sucesso! 🎉");
    } catch (err) {
      if (err instanceof SignupCancelled) toast.info(err.message);
      else toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button variant={variant} size="lg" loading={loading} disabled={!config?.enabled} icon={<WhatsAppGlyph className="size-5" />} onClick={start}>
      {label}
    </Button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-sm font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

function NumberCard({ account }: { account: ChannelAccount }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const wa = account.whatsapp;
  const quality = QUALITY[wa?.qualityRating ?? ""];
  const resubscribe = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>(`/channels/accounts/${account.id}/resubscribe`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["channel-accounts"] });
      r.ok ? toast.success("Recebimento de mensagens ativado") : toast.error("Ainda não foi possível ativar. Veja o erro na tela.");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const disconnect = async () => {
    const ok = await confirm({
      title: `Desconectar ${account.displayHandle}?`,
      description:
        "As automações deste número param de responder. O número continua registrado na sua conta do WhatsApp Business na Meta; contatos, conversas e automações continuam salvos aqui.",
      confirmLabel: "Desconectar",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/channels/accounts/${account.id}/disconnect`);
      qc.invalidateQueries({ queryKey: ["channel-accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Número desconectado");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <WhatsAppGlyph className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{account.name ?? account.displayHandle}</h2>
            {account.status === "connected" ? (
              <Badge tone="green" dot>CONECTADO</Badge>
            ) : account.status === "token_expired" ? (
              <Badge tone="red" dot>RECONECTAR</Badge>
            ) : (
              <Badge tone="red" dot>COM ERRO</Badge>
            )}
            {wa?.coexistence && <Badge tone="gray">Também no app WhatsApp Business</Badge>}
          </div>
          <p className="text-zinc-500">{account.displayHandle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConnectWhatsAppButton label="Reconectar" variant="secondary" coexistence={!!wa?.coexistence} />
          <Button variant="ghost" size="lg" icon={<Unplug className="size-4" />} onClick={disconnect} className="text-red-600 hover:bg-red-50">
            Desconectar
          </Button>
        </div>
      </div>

      {account.status === "token_expired" && (
        <Callout tone="error" className="mt-5" title="Reconecte este número">
          A autorização foi removida ou expirou na Meta. As automações deste número estão paradas até a reconexão.
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
      {wa?.qualityRating === "RED" && (
        <Callout tone="warning" className="mt-5" title="Qualidade do número baixa">
          Muitas pessoas bloquearam ou denunciaram mensagens deste número. Reduza mensagens de marketing e envie só para quem pediu — a Meta pode limitar
          o número.
        </Callout>
      )}

      <dl className="mt-6 divide-y divide-zinc-100">
        <Row label="Qualidade (Meta)">{quality ? <Badge tone={quality.tone}>{quality.label}</Badge> : "Ainda sem avaliação"}</Row>
        <Row label="Limite de conversas iniciadas pela empresa">{TIERS[wa?.messagingLimitTier ?? ""] ?? "Informado pela Meta após o primeiro uso"}</Row>
        <Row label="Nome de exibição">{wa?.nameStatus === "APPROVED" ? "Aprovado" : wa?.nameStatus ? `Em análise (${wa.nameStatus.toLowerCase()})` : "—"}</Row>
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
        <Row label="Conectado em">{formatDate(account.connectedAt)}</Row>
      </dl>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
        <Lock className="size-3.5" /> O token de acesso fica criptografado no servidor e nunca é exibido.
      </p>
    </Card>
  );
}

function UsageCard() {
  const { data, isLoading } = useQuery({ queryKey: ["whatsapp-usage"], queryFn: () => api.get<{ usage: WhatsAppUsage }>("/whatsapp/usage") });
  const usage = data?.usage;
  return (
    <Card>
      <CardTitle
        title="Consumo do WhatsApp neste mês"
        description="Mensagens que a Meta informou como cobradas. O pagamento é feito por você direto à Meta, com o cartão cadastrado na sua conta do WhatsApp Business."
      />
      {isLoading || !usage ? (
        <Skeleton className="h-32" />
      ) : usage.totalMessages === 0 ? (
        <p className="text-sm text-zinc-500">
          Nenhuma mensagem cobrada neste mês. Respostas dentro de 24 h após a mensagem do cliente (atendimento) não são cobradas pela Meta.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 text-sm">
            {usage.categories.map((c) => (
              <li key={c.category} className="flex items-center justify-between py-2">
                <span>{WHATSAPP_PRICING_LABELS[c.category as WhatsAppPricingCategory] ?? c.category}</span>
                <span className="text-right">
                  {formatNumber(c.messages)} msg
                  {c.estimatedBRL !== null && <span className="ml-2 text-zinc-500">≈ {brl(c.estimatedBRL)}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3 text-sm font-semibold">
            <span>Estimativa do mês</span>
            <span>≈ {brl(usage.estimatedTotalBRL)}</span>
          </p>
        </>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Estimativa com a tabela de preços configurada no servidor. O valor oficial é o da fatura da Meta (Gerenciador do WhatsApp → Cobrança).
      </p>
    </Card>
  );
}

function CreateTemplateModal({ accounts, open, onOpenChange }: { accounts: ChannelAccount[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [headerText, setHeaderText] = useState("");
  const [body, setBody] = useState("Olá, {{1}}! Ainda podemos te ajudar com o seu pedido?");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState("");
  const [examples, setExamples] = useState<string[]>(["Maria"]);
  const paramCount = useMemo(() => {
    const nums = (body.match(/\{\{(\d+)\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));
    return nums.length ? Math.max(...nums) : 0;
  }, [body]);
  const create = useMutation({
    mutationFn: () =>
      api.post(`/whatsapp/accounts/${accountId}/templates`, {
        name: name.trim(),
        category,
        language: "pt_BR",
        headerText: headerText.trim() || undefined,
        body,
        examples: Array.from({ length: paramCount }, (_, i) => examples[i] ?? ""),
        footer: footer.trim() || undefined,
        quickReplies: buttons
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success("Modelo enviado para análise da Meta");
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Novo modelo de mensagem"
      description="Modelos são aprovados pela Meta e permitem falar com o cliente depois de 24 h sem resposta."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button loading={create.isPending} onClick={() => create.mutate()} disabled={!accountId || !name.trim() || !body.trim()}>
            Enviar para aprovação
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {accounts.length > 1 && (
          <Field label="Número">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ? `${a.name} · ${a.displayHandle}` : a.displayHandle}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do modelo" hint="Só letras minúsculas, números e _ (ex.: retomar_conversa)">
            <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "_"))} placeholder="retomar_conversa" />
          </Field>
          <Field label="Categoria" hint="Utilidade: avisos sobre algo que o cliente pediu. Marketing: ofertas e novidades (custa mais).">
            <Select value={category} onChange={(e) => setCategory(e.target.value as "UTILITY" | "MARKETING")}>
              <option value="UTILITY">Utilidade</option>
              <option value="MARKETING">Marketing</option>
            </Select>
          </Field>
        </div>
        <Field label="Cabeçalho (opcional)">
          <Input value={headerText} maxLength={60} onChange={(e) => setHeaderText(e.target.value)} />
        </Field>
        <Field label="Texto" hint="Use {{1}}, {{2}}… para trechos que mudam a cada envio (ex.: nome do cliente).">
          <Textarea rows={4} maxLength={1024} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {paramCount > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: paramCount }, (_, i) => (
              <Field key={i} label={`Exemplo para {{${i + 1}}}`} hint={i === 0 ? "A Meta exige um exemplo de cada variável." : undefined}>
                <Input
                  value={examples[i] ?? ""}
                  onChange={(e) => {
                    const next = [...examples];
                    next[i] = e.target.value;
                    setExamples(next);
                  }}
                />
              </Field>
            ))}
          </div>
        )}
        <Field label="Rodapé (opcional)">
          <Input value={footer} maxLength={60} onChange={(e) => setFooter(e.target.value)} placeholder="Responda SAIR para não receber mais" />
        </Field>
        <Field label="Botões de resposta rápida (opcional)" hint="Um por linha, até 3, com no máximo 25 caracteres.">
          <Textarea rows={3} value={buttons} onChange={(e) => setButtons(e.target.value)} placeholder={"Quero sim\nAgora não"} />
        </Field>
      </div>
    </Modal>
  );
}

const STATUS_TONE: Record<string, "green" | "yellow" | "red" | "gray"> = { APPROVED: "green", PENDING: "yellow", IN_APPEAL: "yellow", REJECTED: "red", PAUSED: "red", DISABLED: "red" };

function TemplatesCard({ accounts }: { accounts: ChannelAccount[] }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["whatsapp-templates", "all"], queryFn: () => api.get<{ templates: WhatsAppTemplate[] }>("/whatsapp/templates") });
  const sync = useMutation({
    mutationFn: async () => {
      let total = 0;
      for (const a of accounts) total += (await api.post<{ count: number }>(`/whatsapp/accounts/${a.id}/templates/sync`)).count;
      return total;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success(`${n} modelo(s) atualizados da Meta`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = async (t: WhatsAppTemplate) => {
    const ok = await confirm({
      title: `Excluir o modelo “${t.name}”?`,
      description: "Ele também é excluído na Meta. Automações que usam este modelo deixam de enviá-lo. Um nome excluído só pode ser reutilizado depois de 30 dias.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/whatsapp/accounts/${t.channelAccountId}/templates/${t.id}`);
      qc.invalidateQueries({ queryKey: ["whatsapp-templates"] });
      toast.success("Modelo excluído");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const templates = data?.templates ?? [];
  const numberOf = (id: string) => accounts.find((a) => a.id === id);
  return (
    <Card>
      <CardTitle
        title="Modelos de mensagem"
        description="Necessários para enviar mensagens depois de 24 h da última mensagem do cliente (ex.: sequências e lembretes)."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>
              Atualizar
            </Button>
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Novo modelo
            </Button>
          </div>
        }
      />
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : !templates.length ? (
        <EmptyState
          icon={<FileCheck2 />}
          title="Nenhum modelo ainda"
          description="Crie um modelo ou clique em Atualizar para trazer os modelos que você já tem na Meta."
        />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-medium">{t.name}</p>
                  <Badge tone={STATUS_TONE[t.status] ?? "gray"}>{WHATSAPP_TEMPLATE_STATUS_LABELS[t.status] ?? t.status}</Badge>
                  <Badge>{t.category === "MARKETING" ? "Marketing" : t.category === "UTILITY" ? "Utilidade" : t.category}</Badge>
                  <span className="text-xs text-zinc-400">{t.language}</span>
                  {accounts.length > 1 && <span className="text-xs text-zinc-500">{numberOf(t.channelAccountId)?.displayHandle}</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-600">{t.bodyText}</p>
                {t.rejectedReason && t.status === "REJECTED" && <p className="mt-1 text-xs text-red-600">Motivo informado pela Meta: {t.rejectedReason}</p>}
              </div>
              <Button size="sm" variant="ghost" icon={<Trash className="size-4" />} className="text-red-600 hover:bg-red-50" onClick={() => remove(t)}>
                Excluir
              </Button>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateTemplateModal accounts={accounts} open={creating} onOpenChange={setCreating} />}
    </Card>
  );
}

/** Painel do WhatsApp dentro da página "Canais". */
export function WhatsAppPanel() {
  const { whatsapp, isLoading } = useChannelAccounts();
  const { data: config, isLoading: loadingConfig } = useWhatsAppConfig();
  const [coexistence, setCoexistence] = useState(false);

  if (isLoading || loadingConfig) return <Skeleton className="h-72" />;

  if (whatsapp.length) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {whatsapp.map((a) => (
            <NumberCard key={a.id} account={a} />
          ))}
          <TemplatesCard accounts={whatsapp} />
        </div>
        <div className="space-y-6">
          <UsageCard />
          <Card>
            <CardTitle title="Como funciona a cobrança" />
            <ul className="space-y-2 text-sm text-zinc-600">
              <li className="flex gap-2">
                <CreditCard className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                A assinatura do Veloxia cobre a plataforma. As mensagens do WhatsApp são cobradas pela Meta, direto no cartão da sua conta do WhatsApp Business.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                Responder o cliente em até 24 h depois da mensagem dele é atendimento e não é cobrado pela Meta.
              </li>
              <li className="flex gap-2">
                <FileCheck2 className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                Depois de 24 h, só é possível enviar modelos aprovados — esses são cobrados por mensagem (marketing ou utilidade).
              </li>
            </ul>
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <ConnectWhatsAppButton label="Conectar outro número" variant="secondary" />
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!config?.enabled) {
    return (
      <Callout tone="warning" title="A integração com o WhatsApp ainda não foi configurada neste servidor">
        O administrador precisa configurar o app da Meta com o produto WhatsApp e as variáveis <code>META_APP_ID</code>, <code>META_APP_SECRET</code> e{" "}
        <code>WHATSAPP_CONFIG_ID</code>. Veja o passo a passo em{" "}
        <Link to="/app/ajuda" className="font-medium underline">
          Ajuda → Configuração
        </Link>
        .
      </Callout>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="flex flex-col items-start gap-5 p-8">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <WhatsAppGlyph className="size-7" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">Conecte o WhatsApp da sua empresa</h2>
          <p className="mt-2 max-w-xl text-zinc-600">
            Uma janela oficial da Meta vai abrir para você entrar com o Facebook, escolher a empresa e o número. Nós <strong>nunca</strong> pedimos senha
            nem código do WhatsApp para você digitar aqui.
          </p>
        </div>
        <Checkbox
          checked={coexistence}
          onChange={setCoexistence}
          label="Este número já é usado no app WhatsApp Business"
          description="Você continua usando o app no celular e o Veloxia responde pela API no mesmo número (se a Meta liberar para o seu número)."
        />
        <ConnectWhatsAppButton coexistence={coexistence} />
        <ul className="space-y-2 text-sm text-zinc-600">
          {["Receber e responder mensagens do WhatsApp", "Gerenciar modelos de mensagem", "Ver a qualidade e o limite do número"].map((p) => (
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
          <li>Tenha acesso de administrador ao Gerenciador de Negócios (Meta Business) da sua empresa — ou crie um durante a conexão.</li>
          <li>
            Use um número que receba SMS ou ligação para a verificação.{" "}
            {coexistence ? "No modo app + API, o número continua no app WhatsApp Business." : "Se ele estiver no app do WhatsApp, marque a opção ao lado."}
          </li>
          <li>
            <strong>Cadastre um cartão na Meta</strong> (Gerenciador do WhatsApp → Cobrança). As mensagens cobradas pela Meta vão direto para esse cartão —
            não passam pelo Veloxia.
          </li>
          <li>O nome de exibição passa por aprovação da Meta e pode levar algumas horas.</li>
        </ol>
      </Card>
    </div>
  );
}
