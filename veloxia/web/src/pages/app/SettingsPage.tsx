import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Laptop, Pencil, Plus, Trash } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { COOLDOWN_PRESETS, FIELD_TYPES, PLAN_LIMIT_LABELS, TONE_LABELS, TONES, formatBRL, type BillingCycle, type PlanLimitKey, type Tone } from "@veloxia/shared";
import { CycleToggle, PlanCards, PlanPrice } from "../../components/billing/PlanCards";
import { Badge, Button, Callout, Card, CardTitle, Field, IconButton, Input, Modal, ProgressBar, Select, Skeleton, Tabs, TagPill, Textarea, useConfirm } from "../../components/ui";
import { PageHeader } from "../../components/ui";
import { useAuth, useMe } from "../../hooks/useAuth";
import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDateTime, formatMoney, formatNumber, relativeTime } from "../../lib/format";
import type { BillingInfo, FieldItem, PublicPlan, TagItem } from "../../lib/types";

type Tab = "perfil" | "seguranca" | "tom" | "tags" | "campos" | "plano" | "conta";

const TIMEZONES = ["America/Sao_Paulo", "America/Manaus", "America/Belem", "America/Fortaleza", "America/Recife", "America/Cuiaba", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha", "Europe/Lisbon", "UTC"];

function ProfileTab() {
  const me = useMe();
  const { refresh } = useAuth();
  const [name, setName] = useState(me.user.name);
  const [ws, setWs] = useState({ name: me.workspace.name, timezone: me.workspace.timezone, defaultCooldownSeconds: me.workspace.defaultCooldownSeconds });
  const [saving, setSaving] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (name !== me.user.name) await api.patch("/auth/profile", { name });
      await api.patch("/workspace", ws);
      await refresh();
      toast.success("Configurações salvas");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <form onSubmit={save} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Seu nome">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="E-mail" hint="O e-mail de acesso não pode ser alterado por aqui.">
          <Input value={me.user.email} disabled />
        </Field>
        <Field label="Nome do espaço de trabalho">
          <Input value={ws.name} onChange={(e) => setWs({ ...ws, name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Fuso horário" hint="Usado em {{data}}, {{hora}}, condições de horário e relatórios.">
          <Select value={ws.timezone} onChange={(e) => setWs({ ...ws, timezone: e.target.value })}>
            {[...new Set([ws.timezone, ...TIMEZONES])].map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Intervalo padrão de repetição" hint="Aplicado às novas automações.">
          <Select value={ws.defaultCooldownSeconds} onChange={(e) => setWs({ ...ws, defaultCooldownSeconds: Number(e.target.value) })}>
            {COOLDOWN_PRESETS.map((c) => (
              <option key={c.seconds} value={c.seconds}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SecurityTab() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<{ sessions: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }>("/auth/sessions"),
  });
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) return toast.error("As senhas não conferem.");
    setSaving(true);
    try {
      await api.post("/auth/change-password", { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.success("Senha alterada. As outras sessões foram encerradas.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const revoke = async (id: string) => {
    await api.del(`/auth/sessions/${id}`).catch((err) => toast.error(errorMessage(err)));
    qc.invalidateQueries({ queryKey: ["sessions"] });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle title="Alterar senha" />
        <form onSubmit={change} className="space-y-3">
          <Field label="Senha atual">
            <Input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
            <Input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <Field label="Confirme a nova senha">
            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          <Button type="submit" loading={saving} disabled={!pw.currentPassword || !pw.newPassword}>
            Alterar senha
          </Button>
        </form>
      </Card>
      <Card>
        <CardTitle
          title="Sessões ativas"
          description="Dispositivos conectados à sua conta."
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await api.post("/auth/logout-all");
                await logout();
                navigate("/login");
              }}
            >
              Sair de todos
            </Button>
          }
        />
        {sessions.isLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sessions.data?.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
                <Laptop className="size-5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{s.userAgent ?? "Navegador desconhecido"}</p>
                  <p className="text-xs text-zinc-500">
                    {s.ip ?? "IP desconhecido"} · ativo {relativeTime(s.lastSeenAt)}
                  </p>
                </div>
                {s.current ? (
                  <Badge tone="green">Esta sessão</Badge>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => revoke(s.id)}>
                    Encerrar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ToneTab() {
  const me = useMe();
  const { refresh } = useAuth();
  const [tone, setTone] = useState<Tone>(me.workspace.tone);
  const [instructions, setInstructions] = useState(me.workspace.brandInstructions);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/workspace", { tone, brandInstructions: instructions });
      await refresh();
      toast.success("Tom de voz salvo");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardTitle title="Personalidade das respostas" description="Usado pela IA ao sugerir automações e ao melhorar textos." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TONES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTone(t)}
            className={cn("rounded-xl border p-4 text-left transition", tone === t ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-zinc-200 hover:border-zinc-300")}
          >
            <p className="flex items-center justify-between font-medium">
              {TONE_LABELS[t].label}
              {tone === t && <Check className="size-4 text-brand-600" />}
            </p>
            <p className="mt-1 text-sm text-zinc-500">{TONE_LABELS[t].description}</p>
          </button>
        ))}
      </div>
      <Field label="Escreva como sua marca" className="mt-5" hint="Ex.: “Somos uma loja de cosméticos veganos. Tratamos clientes por ‘você’, usamos no máximo 2 emojis e sempre agradecemos.”">
        <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} rows={5} />
      </Field>
      <Button className="mt-4" onClick={save} loading={saving}>
        Salvar tom de voz
      </Button>
    </Card>
  );
}

function TagsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["tags"], queryFn: () => api.get<{ tags: TagItem[] }>("/tags") });
  const [edit, setEdit] = useState<{ id?: string; name: string; color: string } | null>(null);
  const COLORS = ["#16a34a", "#2563eb", "#f59e0b", "#059669", "#7c3aed", "#db2777", "#dc2626", "#0891b2", "#64748b", "#ea580c"];
  const save = async () => {
    if (!edit?.name.trim()) return;
    try {
      if (edit.id) await api.patch(`/tags/${edit.id}`, { name: edit.name, color: edit.color });
      else await api.post("/tags", { name: edit.name, color: edit.color });
      qc.invalidateQueries({ queryKey: ["tags"] });
      setEdit(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (t: TagItem) => {
    if (!(await confirm({ title: `Excluir a tag “${t.name}”?`, description: "Ela será removida de todos os contatos. Blocos que usam esta tag precisarão ser ajustados.", confirmLabel: "Excluir", danger: true }))) return;
    await api.del(`/tags/${t.id}`).catch((err) => toast.error(errorMessage(err)));
    qc.invalidateQueries({ queryKey: ["tags"] });
  };
  return (
    <Card>
      <CardTitle title="Tags" description="Organize contatos: Cliente, Lead, VIP…" action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: "", color: COLORS[0] })}>Nova tag</Button>} />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data?.tags.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <TagPill name={t.name} color={t.color} />
              <span className="flex-1 text-sm text-zinc-500">{formatNumber(t.contactsCount ?? 0)} contato(s)</span>
              <IconButton label="Editar" onClick={() => setEdit({ id: t.id, name: t.name, color: t.color })}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label="Excluir" onClick={() => remove(t)}>
                <Trash className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? "Editar tag" : "Nova tag"} size="sm" footer={<Button onClick={save}>Salvar</Button>}>
        {edit && (
          <div className="space-y-4">
            <Field label="Nome">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={40} autoFocus />
            </Field>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} className={cn("size-7 rounded-full ring-offset-2", edit.color === c && "ring-2 ring-zinc-900")} style={{ backgroundColor: c }} aria-label={`Cor ${c}`} />
              ))}
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function FieldsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["fields"], queryFn: () => api.get<{ fields: FieldItem[] }>("/fields") });
  const [form, setForm] = useState<{ label: string; type: string } | null>(null);
  const create = async () => {
    if (!form?.label.trim()) return;
    try {
      await api.post("/fields", form);
      qc.invalidateQueries({ queryKey: ["fields"] });
      setForm(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (f: FieldItem) => {
    if (!(await confirm({ title: `Excluir o campo “${f.label}”?`, description: "Os valores salvos nos contatos serão apagados.", confirmLabel: "Excluir", danger: true }))) return;
    await api.del(`/fields/${f.id}`).catch((err) => toast.error(errorMessage(err)));
    qc.invalidateQueries({ queryKey: ["fields"] });
  };
  const typeLabels: Record<string, string> = { text: "Texto", email: "E-mail", phone: "Telefone", number: "Número", date: "Data" };
  return (
    <Card>
      <CardTitle
        title="Campos personalizados"
        description="Informações capturadas nas conversas. Use como variável: {{chave}}."
        action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setForm({ label: "", type: "text" })}>Novo campo</Button>}
      />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data?.fields.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="flex-1 font-medium">{f.label}</span>
              <code className="text-xs text-brand-700">{`{{${f.key}}}`}</code>
              <Badge>{typeLabels[f.type] ?? f.type}</Badge>
              {f.isSystem ? (
                <Badge tone="gray">padrão</Badge>
              ) : (
                <IconButton label="Excluir" onClick={() => remove(f)}>
                  <Trash className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!form} onOpenChange={(o) => !o && setForm(null)} title="Novo campo" size="sm" footer={<Button onClick={create}>Criar campo</Button>}>
        {form && (
          <div className="space-y-4">
            <Field label="Nome do campo">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Cidade" maxLength={40} autoFocus />
            </Field>
            <Field label="Tipo">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {typeLabels[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

const SUB_STATUS: Record<string, { label: string; tone: "green" | "yellow" | "red" | "gray" }> = {
  active: { label: "Ativa", tone: "green" },
  trialing: { label: "Em teste", tone: "green" },
  past_due: { label: "Pagamento pendente", tone: "yellow" },
  canceled: { label: "Cancelada", tone: "gray" },
  expired: { label: "Expirada", tone: "red" },
};
const PAYMENT_STATUS: Record<string, string> = {
  pending: "Aguardando pagamento",
  approved: "Pago",
  rejected: "Recusado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  charged_back: "Estornado",
  in_process: "Em análise",
  authorized: "Autorizado",
};

function PlanTab() {
  const qc = useQueryClient();
  const me = useMe();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: ["billing"], queryFn: () => api.get<BillingInfo>("/billing") });
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [choosing, setChoosing] = useState<PublicPlan | null>(null);
  const [payerEmail, setPayerEmail] = useState(me.user.email);
  const [loading, setLoading] = useState(false);
  const isOwner = me.workspace.role === "owner";

  useEffect(() => {
    if (params.get("checkout") === "retorno") {
      toast.info("Pagamento recebido pelo Mercado Pago. O plano é ativado assim que a confirmação chegar — normalmente em poucos segundos.");
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      params.delete("checkout");
      setParams(params, { replace: true });
    }
  }, [params, setParams, qc]);

  if (isLoading || !data) return <Skeleton className="h-80" />;
  const current = data.plans.find((p) => p.id === data.currentPlanId);
  const sub = data.subscription;
  const paid = sub && sub.provider === "mercadopago" && current && current.priceCents > 0;

  const checkout = async () => {
    if (!choosing) return;
    setLoading(true);
    try {
      const { url } = await api.post<{ url: string }>("/billing/checkout", { planId: choosing.id, cycle, payerEmail });
      window.location.assign(url);
    } catch (err) {
      toast.error(errorMessage(err));
      setLoading(false);
    }
  };
  const cancel = async () => {
    const ok = await confirm({
      title: "Cancelar a assinatura?",
      description: sub?.currentPeriodEnd
        ? `Você continua com o plano ${current?.name} até ${formatDateTime(sub.currentPeriodEnd)}. Depois disso a conta volta para o plano gratuito.`
        : "As próximas cobranças são canceladas no Mercado Pago e a conta volta para o plano gratuito no fim do período pago.",
      confirmLabel: "Cancelar assinatura",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post("/billing/cancel");
      qc.invalidateQueries({ queryKey: ["billing"] });
      toast.success("Assinatura cancelada. Nenhuma nova cobrança será feita.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          title={
            <span className="flex flex-wrap items-center gap-2">
              Plano atual: {current?.name ?? data.currentPlanId}
              {sub && current && current.priceCents > 0 && <Badge tone={SUB_STATUS[sub.status]?.tone ?? "gray"}>{SUB_STATUS[sub.status]?.label ?? sub.status}</Badge>}
            </span>
          }
          description={
            sub?.status === "trialing" && sub.trialEndsAt
              ? `Período de teste até ${formatDateTime(sub.trialEndsAt)}`
              : paid && sub.currentPeriodEnd
                ? sub.status === "canceled" || sub.cancelAtPeriodEnd
                  ? `Cancelada — o plano vale até ${formatDateTime(sub.currentPeriodEnd)}.`
                  : `${sub.billingCycle === "annual" ? "Anual" : "Mensal"}${sub.amountCents ? ` · ${formatBRL(sub.amountCents)}` : ""} · válido até ${formatDateTime(sub.currentPeriodEnd)}${sub.promoEndsAt ? ` · preço de lançamento até ${formatDateTime(sub.promoEndsAt)}` : ""}`
                : current?.description
          }
          action={
            paid && isOwner && sub.status !== "canceled" && !sub.cancelAtPeriodEnd ? (
              <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={cancel}>
                Cancelar assinatura
              </Button>
            ) : undefined
          }
        />
        {sub?.status === "past_due" && (
          <Callout tone="warning" className="mb-5" title="Não conseguimos confirmar o último pagamento">
            O Mercado Pago tenta cobrar de novo automaticamente. Confira o cartão na sua conta do Mercado Pago para não perder o plano.
          </Callout>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          {(Object.keys(PLAN_LIMIT_LABELS) as PlanLimitKey[])
            .filter((k) => k !== "flow_max_nodes" && current?.limits[k] !== 0)
            .map((k) => {
              const limit = current?.limits[k];
              const used = data.usage[k] ?? 0;
              return (
                <div key={k}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-zinc-600">{PLAN_LIMIT_LABELS[k]}</span>
                    <span className="font-medium tabular-nums">
                      {formatNumber(used)} / {limit === null || limit === undefined ? "ilimitado" : formatNumber(limit)}
                    </span>
                  </div>
                  <ProgressBar value={used} max={limit ?? null} />
                </div>
              );
            })}
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Contato ativo = pessoa que mandou mensagem para você no mês, em qualquer canal. As mensagens do WhatsApp são cobradas pela Meta, direto no seu
          cartão cadastrado na Meta — não estão incluídas no plano.
        </p>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Planos</h2>
        <CycleToggle value={cycle} onChange={setCycle} />
      </div>
      {!data.payments.enabled && (
        <Callout tone="info">
          {data.payments.message}
          {data.payments.supportEmail && (
            <a className="ml-1 font-medium underline" href={`mailto:${data.payments.supportEmail}`}>
              {data.payments.supportEmail}
            </a>
          )}
        </Callout>
      )}
      <PlanCards
        plans={data.plans}
        cycle={cycle}
        promoEligible={data.promoEligible}
        currentPlanId={data.currentPlanId}
        action={(p) =>
          p.id === data.currentPlanId || p.priceCents <= 0 || !data.payments.enabled || !isOwner ? null : (
            <Button className="w-full" variant={p.highlighted ? "primary" : "secondary"} onClick={() => setChoosing(p)} disabled={cycle === "annual" && !p.annualPriceCents}>
              {current && current.priceCents > 0 ? `Mudar para ${p.name}` : `Assinar ${p.name}`}
            </Button>
          )
        }
      />

      {data.history.length > 0 && (
        <Card padded={false} className="overflow-x-auto">
          <div className="px-5 pt-5">
            <CardTitle title="Histórico de pagamentos" />
          </div>
          <table className="w-full text-sm">
            <thead className="border-y border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500 uppercase">
              <tr>
                <th className="px-5 py-2.5">Data</th>
                <th className="px-5 py-2.5">Plano</th>
                <th className="px-5 py-2.5">Valor</th>
                <th className="px-5 py-2.5">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td className="px-5 py-2.5">{formatDateTime(h.paidAt ?? h.createdAt)}</td>
                  <td className="px-5 py-2.5">
                    {data.plans.find((p) => p.id === h.planId)?.name ?? h.planId} · {h.billingCycle === "annual" ? "anual" : "mensal"}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums">{formatBRL(h.amountCents)}</td>
                  <td className="px-5 py-2.5">{PAYMENT_STATUS[h.status] ?? h.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={!!choosing}
        onOpenChange={(o) => !o && setChoosing(null)}
        title={`Assinar o plano ${choosing?.name ?? ""}`}
        size="sm"
        footer={
          <Button onClick={checkout} loading={loading} disabled={!payerEmail}>
            Ir para o Mercado Pago
          </Button>
        }
      >
        {choosing && (
          <div className="space-y-4">
            <PlanPrice plan={choosing} cycle={cycle} promoEligible={data.promoEligible} />
            <p className="text-sm text-zinc-600">
              {cycle === "annual"
                ? "Pagamento único para 12 meses, por PIX, cartão ou boleto, no ambiente seguro do Mercado Pago."
                : "Assinatura mensal no cartão, renovada automaticamente pelo Mercado Pago. Você pode cancelar aqui a qualquer momento."}
            </p>
            <Field label="E-mail da sua conta do Mercado Pago" hint="O Mercado Pago pede que seja o mesmo e-mail usado para pagar.">
              <Input type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
            </Field>
            {current && current.priceCents > 0 && (
              <Callout tone="info">Ao confirmar o novo plano, a assinatura anterior é cancelada automaticamente no Mercado Pago.</Callout>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function AccountTab() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const remove = async () => {
    setLoading(true);
    try {
      await api.post("/auth/delete-account", { password, confirm: confirmText });
      qc.clear();
      toast.success("Conta excluída. Sentiremos sua falta.");
      navigate("/", { replace: true });
      window.location.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card className="border-red-200">
      <CardTitle title="Excluir conta" description="Apaga definitivamente sua conta, automações, contatos, conversas e métricas. Esta ação não pode ser desfeita." />
      <Button variant="danger" onClick={() => setOpen(true)}>
        Excluir minha conta
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Excluir conta definitivamente"
        size="sm"
        footer={
          <Button variant="danger" onClick={remove} loading={loading} disabled={confirmText !== "EXCLUIR" || !password}>
            Excluir tudo
          </Button>
        }
      >
        <div className="space-y-3">
          <Callout tone="error">Sua conta do Instagram será desconectada e todos os dados serão apagados.</Callout>
          <Field label="Sua senha">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label='Digite "EXCLUIR" para confirmar'>
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("aba") as Tab) ?? "perfil";
  const setTab = (t: Tab) => setParams({ aba: t }, { replace: true });
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);
  return (
    <div>
      <PageHeader title="Configurações" />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-6"
        items={[
          { value: "perfil", label: "Perfil" },
          { value: "seguranca", label: "Segurança" },
          { value: "tom", label: "Tom de voz" },
          { value: "tags", label: "Tags" },
          { value: "campos", label: "Campos" },
          { value: "plano", label: "Plano e uso" },
          { value: "conta", label: "Conta" },
        ]}
      />
      {tab === "perfil" && <ProfileTab />}
      {tab === "seguranca" && <SecurityTab />}
      {tab === "tom" && <ToneTab />}
      {tab === "tags" && <TagsTab />}
      {tab === "campos" && <FieldsTab />}
      {tab === "plano" && <PlanTab />}
      {tab === "conta" && <AccountTab />}
    </div>
  );
}
