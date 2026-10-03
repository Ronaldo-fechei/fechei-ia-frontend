import { ArrowLeft, Clock, MessageCircle, MessagesSquare, Radio, Rocket, Save, UserPlus, Workflow, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { COOLDOWN_PRESETS, DELAY_PRESETS, TRIGGER_EVENT_INFO, type MatchType, type TriggerEvent } from "@gatilho/shared";
import { KeywordEditor, type KeywordValue } from "../../../components/automation/KeywordEditor";
import { ImageField } from "../../../components/automation/ImageField";
import { MediaPicker } from "../../../components/automation/MediaPicker";
import { MessageEditor } from "../../../components/automation/MessageEditor";
import { PhonePreview, previewText } from "../../../components/automation/PhonePreview";
import { Simulator } from "../../../components/automation/Simulator";
import { StatusBadge } from "../../../components/automation/badges";
import { Button, ButtonLink, Callout, Card, CardTitle, Field, Input, PageHeader, Select, Skeleton, Switch } from "../../../components/ui";
import { useAutomation, useAutomationActions } from "../../../hooks/useAutomations";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { cn } from "../../../lib/cn";
import type { AutomationFull, SimOutput } from "../../../lib/types";

type QuickEvent = "dm" | "comment" | "story_reply" | "story_mention";

interface FormState {
  name: string;
  triggerEvent: QuickEvent;
  keywords: KeywordValue[];
  message: string;
  linkUrl: string;
  buttonTitle: string;
  imageUrl: string;
  delaySeconds: number;
  mediaScope: "all" | "specific";
  mediaIds: string[];
  publicReplyEnabled: boolean;
  publicReplies: string[];
  cooldownSeconds: number;
  priority: number;
}

const EMPTY: FormState = {
  name: "",
  triggerEvent: "dm",
  keywords: [],
  message: "",
  linkUrl: "",
  buttonTitle: "",
  imageUrl: "",
  delaySeconds: 0,
  mediaScope: "all",
  mediaIds: [],
  publicReplyEnabled: false,
  publicReplies: ["Te enviei no Direct! 📩"],
  cooldownSeconds: 60,
  priority: 0,
};

const TRIGGER_OPTIONS: { value: TriggerEvent; icon: ReactNode }[] = [
  { value: "dm", icon: <MessagesSquare className="size-5" /> },
  { value: "comment", icon: <MessageCircle className="size-5" /> },
  { value: "story_reply", icon: <Zap className="size-5" /> },
  { value: "story_mention", icon: <Radio className="size-5" /> },
  { value: "new_follower", icon: <UserPlus className="size-5" /> },
];

function fromAutomation(a: AutomationFull): FormState {
  const q = (a.quickConfig ?? {}) as Record<string, any>;
  return {
    ...EMPTY,
    name: a.name,
    triggerEvent: (q.triggerEvent ?? a.triggerEvent) as QuickEvent,
    keywords: (q.keywords ?? []).map((k: any) => ({ text: k.text, matchType: k.matchType ?? "contains_word", caseSensitive: !!k.caseSensitive, ignoreAccents: k.ignoreAccents !== false })),
    message: q.message ?? "",
    linkUrl: q.linkUrl ?? "",
    buttonTitle: q.buttonTitle ?? "",
    imageUrl: q.imageUrl ?? "",
    delaySeconds: q.delaySeconds ?? 0,
    mediaScope: q.mediaIds?.length ? "specific" : "all",
    mediaIds: q.mediaIds ?? [],
    publicReplyEnabled: !!q.publicReplyEnabled,
    publicReplies: q.publicReplies?.length ? q.publicReplies : EMPTY.publicReplies,
    cooldownSeconds: a.cooldownSeconds,
    priority: a.priority,
  };
}

function readAiDraft(): Partial<FormState> | null {
  try {
    const raw = sessionStorage.getItem("gatilho:ai-draft");
    if (!raw) return null;
    sessionStorage.removeItem("gatilho:ai-draft");
    const s = JSON.parse(raw);
    return {
      name: s.name,
      triggerEvent: s.triggerEvent,
      keywords: (s.keywords ?? []).map((text: string) => ({ text, matchType: (s.matchType ?? "contains_word") as MatchType, caseSensitive: false, ignoreAccents: true })),
      message: s.message,
      buttonTitle: s.needsLink ? s.buttonTitle || "Ver link" : "",
    };
  } catch {
    return null;
  }
}

function Section({ step, title, description, children }: { step: number; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="flex gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{step}</span>
        <div className="min-w-0 flex-1">
          <CardTitle title={title} description={description} className="mb-4" />
          {children}
        </div>
      </div>
    </Card>
  );
}

export default function AutomationForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data, isLoading } = useAutomation(id);
  const { invalidate } = useAutomationActions();
  const automation = data?.automation;

  const [form, setForm] = useState<FormState>(() => {
    if (editing) return EMPTY;
    const initial = { ...EMPTY };
    const trigger = params.get("gatilho") as QuickEvent | null;
    if (trigger && ["dm", "comment", "story_reply", "story_mention"].includes(trigger)) initial.triggerEvent = trigger;
    if (initial.triggerEvent === "comment") initial.publicReplyEnabled = true;
    if (params.get("origem") === "ia") Object.assign(initial, readAiDraft() ?? {});
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<"draft" | "publish" | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (automation && automation.mode === "quick") setForm(fromAutomation(automation));
  }, [automation]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const isComment = form.triggerEvent === "comment";
  const isMention = form.triggerEvent === "story_mention";

  const previewOutputs = useMemo<SimOutput["content"][]>(() => {
    const out: SimOutput["content"][] = [];
    if (form.imageUrl && !isComment) out.push({ kind: "image", url: form.imageUrl });
    const text = previewText(form.message || "Sua resposta aparece aqui…", form.linkUrl);
    if (form.linkUrl) out.push({ kind: "buttons", text, buttons: [{ type: "url", title: form.buttonTitle || "Abrir link", url: form.linkUrl }] });
    else out.push({ kind: "text", text });
    return out;
  }, [form.imageUrl, form.message, form.linkUrl, form.buttonTitle, isComment]);

  if (editing && isLoading) return <Skeleton className="h-96" />;
  if (editing && automation && automation.mode === "flow") {
    return (
      <div className="mx-auto max-w-2xl">
        <Callout
          tone="info"
          title="Esta automação usa o construtor visual"
          action={
            <ButtonLink to={`/app/automacoes/${id}/fluxo`} icon={<Workflow className="size-4" />}>
              Abrir no construtor visual
            </ButtonLink>
          }
        >
          Ela foi criada ou editada como fluxo, por isso é editada no construtor visual.
        </Callout>
      </div>
    );
  }

  const submit = async (publish: boolean) => {
    setErrors({});
    setSaving(publish ? "publish" : "draft");
    const quick = {
      triggerEvent: form.triggerEvent,
      keywords: isMention ? [] : form.keywords,
      message: form.message,
      linkUrl: form.linkUrl.trim(),
      buttonTitle: form.linkUrl.trim() ? form.buttonTitle.trim() || "Abrir link" : "",
      imageUrl: isComment ? "" : form.imageUrl.trim(),
      delaySeconds: form.delaySeconds,
      mediaIds: isComment && form.mediaScope === "specific" ? form.mediaIds : [],
      publicReplyEnabled: isComment && form.publicReplyEnabled,
      publicReplies: form.publicReplies.filter((r) => r.trim()),
    };
    try {
      const body = { name: form.name.trim() || "Nova automação", quick, cooldownSeconds: form.cooldownSeconds, priority: form.priority, publish };
      const res = editing
        ? await api.patch<{ automation: AutomationFull }>(`/automations/${id}`, body)
        : await api.post<{ automation: AutomationFull }>("/automations", { ...body, mode: "quick" });
      invalidate(res.automation.id);
      toast.success(publish ? "Automação publicada! 🚀" : "Rascunho salvo", {
        description: publish ? "Ela já responde às novas mensagens." : "Publique quando estiver pronta.",
      });
      navigate(`/app/automacoes/${res.automation.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fields;
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(fields)) mapped[k.replace(/^quick\./, "").split(".")[0]] = v;
        setErrors(mapped);
        if (err.code === "invalid_flow") {
          const list = (err.data.errors as { message: string }[]) ?? [];
          toast.error("Corrija antes de publicar", { description: list.map((e) => e.message).join("\n") });
        } else toast.error(err.message);
      } else toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <PageHeader
        back={
          <Link to={editing ? `/app/automacoes/${id}` : "/app/automacoes"} className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        }
        title={editing ? "Editar automação" : "Nova automação"}
        description="Defina quando responder e o que enviar. Você pode testar antes de publicar."
        actions={automation && <StatusBadge status={automation.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Section step={1} title="Nome da automação" description="Só você vê o nome. Ex.: “Link da Shopee”.">
            <Field error={errors.name}>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Link do produto" maxLength={80} invalid={!!errors.name} />
            </Field>
          </Section>

          <Section step={2} title="Quando responder?" description="Escolha o que ativa esta automação.">
            <div className="grid gap-2 sm:grid-cols-2">
              {TRIGGER_OPTIONS.map(({ value, icon }) => {
                const info = TRIGGER_EVENT_INFO[value];
                const selected = form.triggerEvent === value;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={!info.available}
                    onClick={() => {
                      set("triggerEvent", value as QuickEvent);
                      if (value === "comment") set("publicReplyEnabled", true);
                    }}
                    className={cn(
                      "flex gap-3 rounded-xl border p-3 text-left transition",
                      selected ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-zinc-200 hover:border-zinc-300",
                      !info.available && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span className={cn("mt-0.5", selected ? "text-brand-600" : "text-zinc-400")}>{icon}</span>
                    <span>
                      <span className="block text-sm font-medium">{info.label}</span>
                      <span className="block text-xs text-zinc-500">{info.available ? info.description : info.unavailableReason}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          {!isMention && (
            <Section
              step={3}
              title="Palavras-chave"
              description={
                form.triggerEvent === "dm"
                  ? "Quando a mensagem tiver uma destas palavras, a resposta é enviada. Adicione variações (link, LINK, me passa o link…)."
                  : "Opcional: deixe vazio para responder a qualquer " + (isComment ? "comentário." : "resposta ao Story.")
              }
            >
              <KeywordEditor value={form.keywords} onChange={(v) => set("keywords", v)} invalid={!!errors.keywords} />
              {errors.keywords && <p className="mt-1.5 text-xs text-red-600">{errors.keywords}</p>}
            </Section>
          )}

          {isComment && (
            <Section step={isMention ? 3 : 4} title="Publicações e resposta pública" description="A primeira mensagem é enviada como resposta privada (regra da Meta: 1 por comentário, até 7 dias).">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={form.mediaScope === "all"} onChange={() => set("mediaScope", "all")} className="accent-brand-600" />
                    Todas as publicações e Reels
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={form.mediaScope === "specific"} onChange={() => set("mediaScope", "specific")} className="accent-brand-600" />
                    Publicações específicas
                  </label>
                </div>
                {form.mediaScope === "specific" && <MediaPicker value={form.mediaIds} onChange={(v) => set("mediaIds", v)} />}
                <div className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Responder também no comentário</p>
                      <p className="text-xs text-zinc-500">Uma resposta pública curta, sorteada entre as opções abaixo.</p>
                    </div>
                    <Switch checked={form.publicReplyEnabled} onCheckedChange={(v) => set("publicReplyEnabled", v)} label="Resposta pública" />
                  </div>
                  {form.publicReplyEnabled && (
                    <div className="mt-3 space-y-2">
                      {form.publicReplies.map((r, i) => (
                        <Input
                          key={i}
                          value={r}
                          maxLength={300}
                          onChange={(e) => set("publicReplies", form.publicReplies.map((x, j) => (j === i ? e.target.value : x)))}
                          placeholder="Te enviei no Direct! 📩"
                        />
                      ))}
                      {form.publicReplies.length < 5 && (
                        <Button size="xs" variant="ghost" onClick={() => set("publicReplies", [...form.publicReplies, ""])}>
                          + Adicionar variação
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}

          <Section step={isComment ? 5 : isMention ? 3 : 4} title="Resposta" description="Use emojis, quebras de linha e variáveis como {{primeiro_nome}}.">
            <Field error={errors.message}>
              <MessageEditor
                value={form.message}
                onChange={(v) => set("message", v)}
                invalid={!!errors.message}
                placeholder={"Claro! 😊\nAqui está o link para você conferir o produto 👇"}
                rows={5}
              />
            </Field>
            <p className="mt-2 text-xs text-zinc-500">O Instagram não suporta negrito/itálico no Direct; quebras de linha e emojis funcionam normalmente.</p>
          </Section>

          <Section step={isComment ? 6 : isMention ? 4 : 5} title="Link, imagem e atraso" description="Tudo opcional.">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
              <Field label="Link (URL)" optional error={errors.linkUrl} hint="Mercado Livre, Shopee, Amazon, Kabum, WhatsApp, seu site… Cliques são contados.">
                <Input value={form.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} placeholder="https://" invalid={!!errors.linkUrl} inputMode="url" />
              </Field>
              <Field label="Texto do botão" error={errors.buttonTitle} hint="Até 20 caracteres.">
                <Input value={form.buttonTitle} onChange={(e) => set("buttonTitle", e.target.value)} placeholder="Ver produto" maxLength={20} disabled={!form.linkUrl} />
              </Field>
            </div>
            {!isComment && (
              <Field label="Imagem" optional className="mt-4" error={errors.imageUrl} hint="Enviada antes do texto.">
                <ImageField value={form.imageUrl} onChange={(v) => set("imageUrl", v)} invalid={!!errors.imageUrl} />
              </Field>
            )}
            <Field label="Atraso antes de responder" optional className="mt-4" hint="Um pequeno atraso deixa a conversa mais natural.">
              <Select value={form.delaySeconds} onChange={(e) => set("delaySeconds", Number(e.target.value))} className="sm:max-w-xs">
                <option value={0}>Sem atraso</option>
                {DELAY_PRESETS.map((d) => (
                  <option key={d.seconds} value={d.seconds}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          <Card>
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setAdvanced((a) => !a)}>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-zinc-500" /> Configurações avançadas
              </span>
              <span className="text-xs text-zinc-500">{advanced ? "ocultar" : "repetição e prioridade"}</span>
            </button>
            {advanced && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Não repetir para a mesma pessoa por" hint="Evita respostas repetidas se a pessoa mandar “LINK” várias vezes.">
                  <Select value={form.cooldownSeconds} onChange={(e) => set("cooldownSeconds", Number(e.target.value))}>
                    {COOLDOWN_PRESETS.map((c) => (
                      <option key={c.seconds} value={c.seconds}>
                        {c.label}
                      </option>
                    ))}
                    {!COOLDOWN_PRESETS.some((c) => c.seconds === form.cooldownSeconds) && <option value={form.cooldownSeconds}>{form.cooldownSeconds} s</option>}
                  </Select>
                </Field>
                <Field label="Prioridade manual" hint="Maior vence quando duas automações combinam. Em empate, vence a palavra mais específica.">
                  <Input type="number" min={-100} max={100} value={form.priority} onChange={(e) => set("priority", Number(e.target.value) || 0)} />
                </Field>
              </div>
            )}
          </Card>

          <div className="sticky bottom-20 z-10 flex flex-wrap justify-end gap-2 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-pop backdrop-blur lg:bottom-4">
            {(!automation || automation.status !== "active") && (
              <Button variant="secondary" icon={<Save className="size-4" />} loading={saving === "draft"} disabled={!!saving} onClick={() => submit(false)}>
                Salvar rascunho
              </Button>
            )}
            <Button icon={<Rocket className="size-4" />} loading={saving === "publish"} disabled={!!saving} onClick={() => submit(true)}>
              {automation?.status === "active" ? "Salvar e publicar" : "Publicar automação"}
            </Button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <PhonePreview
            incoming={isMention ? "📣 Mencionou você em um Story" : form.keywords[0] ? `Oi! Me manda o ${form.keywords[0].text}?` : isComment ? "(comentou na sua publicação)" : undefined}
            outputs={previewOutputs}
            footer={form.delaySeconds ? `Enviada após ${DELAY_PRESETS.find((d) => d.seconds === form.delaySeconds)?.label ?? `${form.delaySeconds}s`}` : undefined}
          />
          {editing && automation ? (
            <Simulator automationId={automation.id} defaultEvent={form.triggerEvent} />
          ) : (
            <p className="text-center text-xs text-zinc-500">Salve como rascunho para testar com o simulador antes de publicar.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
