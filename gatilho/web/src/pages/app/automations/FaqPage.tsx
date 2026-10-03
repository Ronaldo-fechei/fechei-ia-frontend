import { CircleQuestionMark, MessageCircleQuestionMark, Pencil, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { normalizeText, tokenize } from "@gatilho/shared";
import { KeywordEditor, type KeywordValue } from "../../../components/automation/KeywordEditor";
import { MessageEditor } from "../../../components/automation/MessageEditor";
import { StatusBadge } from "../../../components/automation/badges";
import { Badge, Button, Callout, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader, Skeleton, Switch } from "../../../components/ui";
import { useAutomationActions, useAutomations } from "../../../hooks/useAutomations";
import { api, ApiError, errorMessage } from "../../../lib/api";
import { formatNumber } from "../../../lib/format";
import type { AutomationSummary } from "../../../lib/types";

const STOPWORDS = new Set(["voces", "voce", "vcs", "vc", "tem", "para", "pra", "por", "com", "como", "qual", "quais", "que", "quando", "isso", "esse", "essa", "esta", "este", "uma", "uns", "umas", "dos", "das", "nos", "nas", "meu", "minha", "seu", "sua", "pode", "posso", "fazer", "sobre", "ainda", "mais", "muito"]);

/** Sugere palavras-chave a partir da pergunta ("Vocês entregam?" → "entregam"). */
function suggestKeywords(question: string): KeywordValue[] {
  const words = tokenize(normalizeText(question, { ignoreAccents: true })).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 4).map((text) => ({ text, matchType: "contains_word", caseSensitive: false, ignoreAccents: true }));
}

interface FaqForm {
  id?: string;
  question: string;
  keywords: KeywordValue[];
  message: string;
  linkUrl: string;
  buttonTitle: string;
  active: boolean;
}

const EMPTY: FaqForm = { question: "", keywords: [], message: "", linkUrl: "", buttonTitle: "", active: true };

function fromSummary(a: AutomationSummary): FaqForm {
  const q = (a.quickConfig ?? {}) as Record<string, any>;
  return {
    id: a.id,
    question: a.faqQuestion ?? a.name,
    keywords: (q.keywords ?? []).map((k: any) => ({ text: k.text, matchType: k.matchType ?? "contains_word", caseSensitive: !!k.caseSensitive, ignoreAccents: k.ignoreAccents !== false })),
    message: q.message ?? "",
    linkUrl: q.linkUrl ?? "",
    buttonTitle: q.buttonTitle ?? "",
    active: a.status === "active",
  };
}

export default function FaqPage() {
  const { data, isLoading } = useAutomations({ kind: "faq" });
  const { invalidate, remove, setStatus } = useAutomationActions();
  const [form, setForm] = useState<FaqForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = data?.automations ?? [];

  const save = async () => {
    if (!form) return;
    setErrors({});
    if (!form.question.trim()) return setErrors({ question: "Escreva a pergunta" });
    setSaving(true);
    const quick = {
      triggerEvent: "dm",
      keywords: form.keywords.length ? form.keywords : suggestKeywords(form.question),
      message: form.message,
      linkUrl: form.linkUrl.trim(),
      buttonTitle: form.linkUrl.trim() ? form.buttonTitle.trim() || "Abrir link" : "",
    };
    try {
      const body = { name: form.question.trim().slice(0, 80), faqQuestion: form.question.trim(), quick, publish: form.active };
      if (form.id) {
        await api.patch(`/automations/${form.id}`, body);
        if (!form.active) await api.post(`/automations/${form.id}/status`, { status: "paused" });
      } else await api.post("/automations", { ...body, kind: "faq", mode: "quick" });
      invalidate(form.id);
      toast.success("Resposta salva");
      setForm(null);
    } catch (err) {
      if (err instanceof ApiError) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.replace(/^quick\./, ""), v])));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Respostas automáticas"
        description="Cadastre perguntas frequentes e a resposta que deve ser enviada quando alguém perguntar no Direct."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setForm({ ...EMPTY })}>
            Nova pergunta
          </Button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !list.length ? (
        <Card>
          <EmptyState
            icon={<MessageCircleQuestionMark className="size-6" />}
            title="Nenhuma pergunta cadastrada"
            description="Ex.: “Vocês entregam?” → “Sim! A entrega depende da loja e da região…”"
            action={
              <Button icon={<Plus className="size-4" />} onClick={() => setForm({ ...EMPTY })}>
                Cadastrar primeira pergunta
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const f = fromSummary(a);
            return (
              <Card key={a.id} className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <CircleQuestionMark className="mt-0.5 hidden size-5 shrink-0 text-brand-500 sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{f.question}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="mt-1.5 text-sm whitespace-pre-wrap text-zinc-600">{f.message}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {a.keywords.map((k) => (
                      <Badge key={k} tone="brand">
                        {k.toUpperCase()}
                      </Badge>
                    ))}
                    <span className="text-xs text-zinc-400">· {formatNumber(a.executionsCount)} respostas enviadas</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={a.status === "active"} onCheckedChange={(v) => setStatus.mutate({ id: a.id, status: v ? "active" : "paused" })} label="Ativar resposta" />
                  <IconButton label="Editar" onClick={() => setForm(f)}>
                    <Pencil className="size-4" />
                  </IconButton>
                  <IconButton label="Excluir" onClick={() => remove(a.id, f.question)}>
                    <Trash className="size-4" />
                  </IconButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        size="lg"
        title={form?.id ? "Editar resposta" : "Nova resposta automática"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Pergunta" error={errors.question} hint="Como as pessoas costumam perguntar.">
              <Input
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                onBlur={() => !form.keywords.length && form.question.trim() && setForm((f) => (f ? { ...f, keywords: suggestKeywords(f.question) } : f))}
                placeholder="Vocês entregam?"
                maxLength={300}
              />
            </Field>
            <Field label="Palavras que identificam a pergunta" error={errors.keywords} hint="Sugerimos a partir da pergunta; adicione variações como “entrega”, “frete”.">
              <KeywordEditor value={form.keywords} onChange={(keywords) => setForm({ ...form, keywords })} />
            </Field>
            <Field label="Resposta" error={errors.message}>
              <MessageEditor value={form.message} onChange={(message) => setForm({ ...form, message })} rows={4} placeholder="Sim! A entrega depende da loja e da região…" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Field label="Link" optional error={errors.linkUrl}>
                <Input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} placeholder="https://" />
              </Field>
              <Field label="Texto do botão">
                <Input value={form.buttonTitle} onChange={(e) => setForm({ ...form, buttonTitle: e.target.value })} maxLength={20} disabled={!form.linkUrl} placeholder="Ver detalhes" />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-zinc-200 p-3">
              <span className="text-sm font-medium">Ativa</span>
              <Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} />
            </div>
            <Callout tone="info">Se uma mensagem combinar com uma pergunta e com outra automação, vale a regra de prioridade (veja Palavras-chave).</Callout>
          </div>
        )}
      </Modal>
    </div>
  );
}
