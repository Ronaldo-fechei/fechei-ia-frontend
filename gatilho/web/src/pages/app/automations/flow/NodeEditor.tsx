import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CONDITION_RULE_LABELS,
  DELAY_PRESETS,
  LIMITS,
  NODE_INFO,
  TRIGGER_EVENT_INFO,
  type ConditionRule,
  type FlowNode,
  type NodeDataMap,
  type TriggerEvent,
} from "@gatilho/shared";
import { ImageField } from "../../../../components/automation/ImageField";
import { KeywordEditor } from "../../../../components/automation/KeywordEditor";
import { MediaPicker } from "../../../../components/automation/MediaPicker";
import { MessageEditor, useFields } from "../../../../components/automation/MessageEditor";
import { Button, Callout, Checkbox, Field, Input, Select, Switch } from "../../../../components/ui";
import { api, errorMessage } from "../../../../lib/api";
import { cn } from "../../../../lib/cn";
import type { TagItem } from "../../../../lib/types";
import { newId } from "./convert";

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: () => api.get<{ tags: TagItem[] }>("/tags"), staleTime: 60_000 });
}

function useAutomationOptions() {
  return useQuery({ queryKey: ["automations-options"], queryFn: () => api.get<{ automations: { id: string; name: string; status: string }[] }>("/automations-options") });
}

function TagSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useTags();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    try {
      const { tag } = await api.post<{ tag: TagItem }>("/tags", { name: name.trim() });
      await qc.invalidateQueries({ queryKey: ["tags"] });
      onChange(tag.id);
      setCreating(false);
      setName("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-2">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Escolha uma tag…</option>
        {data?.tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      {creating ? (
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da nova tag" maxLength={40} autoFocus onKeyDown={(e) => e.key === "Enter" && create()} />
          <Button size="sm" onClick={create}>
            Criar
          </Button>
        </div>
      ) : (
        <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          Nova tag
        </Button>
      )}
    </div>
  );
}

function RuleEditor({ rule, onChange, onRemove }: { rule: ConditionRule; onChange: (r: ConditionRule) => void; onRemove: () => void }) {
  const { data: fields } = useFields();
  const { data: automations } = useAutomationOptions();
  const setType = (type: ConditionRule["type"]) => {
    const defaults: Record<ConditionRule["type"], ConditionRule> = {
      has_tag: { type: "has_tag", tagId: "" },
      not_has_tag: { type: "not_has_tag", tagId: "" },
      received_automation: { type: "received_automation", automationId: "" },
      not_received_automation: { type: "not_received_automation", automationId: "" },
      message_contains: { type: "message_contains", text: "" },
      time_between: { type: "time_between", start: "09:00", end: "18:00" },
      weekday: { type: "weekday", days: [1, 2, 3, 4, 5] },
      field: { type: "field", fieldKey: "email", operator: "is_set" },
      is_follower: { type: "is_follower" },
      not_follower: { type: "not_follower" },
    };
    onChange(defaults[type]);
  };
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
      <div className="flex gap-2">
        <Select value={rule.type} onChange={(e) => setType(e.target.value as ConditionRule["type"])}>
          {Object.entries(CONDITION_RULE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remover regra">
          <X className="size-4" />
        </Button>
      </div>
      {(rule.type === "has_tag" || rule.type === "not_has_tag") && <TagSelect value={rule.tagId} onChange={(tagId) => onChange({ ...rule, tagId })} />}
      {(rule.type === "received_automation" || rule.type === "not_received_automation") && (
        <Select value={rule.automationId} onChange={(e) => onChange({ ...rule, automationId: e.target.value })}>
          <option value="">Escolha a automação…</option>
          {automations?.automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      )}
      {rule.type === "message_contains" && <Input value={rule.text} onChange={(e) => onChange({ ...rule, text: e.target.value })} placeholder="ex.: frete" />}
      {rule.type === "time_between" && (
        <div className="flex items-center gap-2">
          <Input type="time" value={rule.start} onChange={(e) => onChange({ ...rule, start: e.target.value })} />
          <span className="text-sm text-zinc-500">até</span>
          <Input type="time" value={rule.end} onChange={(e) => onChange({ ...rule, end: e.target.value })} />
        </div>
      )}
      {rule.type === "weekday" && (
        <div className="flex flex-wrap gap-1">
          {days.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => onChange({ ...rule, days: rule.days.includes(i) ? rule.days.filter((x) => x !== i) : [...rule.days, i].sort() })}
              className={cn("rounded-md px-2 py-1 text-xs font-medium ring-1", rule.days.includes(i) ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-zinc-600 ring-zinc-200")}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {rule.type === "field" && (
        <div className="grid gap-2">
          <Select value={rule.fieldKey} onChange={(e) => onChange({ ...rule, fieldKey: e.target.value })}>
            {fields?.fields.map((f) => (
              <option key={f.id} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
          <Select value={rule.operator} onChange={(e) => onChange({ ...rule, operator: e.target.value as typeof rule.operator })}>
            <option value="is_set">está preenchido</option>
            <option value="is_not_set">está vazio</option>
            <option value="equals">é igual a</option>
            <option value="not_equals">é diferente de</option>
            <option value="contains">contém</option>
          </Select>
          {["equals", "not_equals", "contains"].includes(rule.operator) && <Input value={rule.value ?? ""} onChange={(e) => onChange({ ...rule, value: e.target.value })} placeholder="valor" />}
        </div>
      )}
      {(rule.type === "is_follower" || rule.type === "not_follower") && (
        <p className="text-xs text-zinc-500">Informação oficial do perfil do contato (disponível depois que ele envia uma mensagem).</p>
      )}
    </div>
  );
}

function DelayEditor({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const unit = seconds % 3600 === 0 ? 3600 : seconds % 60 === 0 ? 60 : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {DELAY_PRESETS.map((p) => (
          <button
            key={p.seconds}
            type="button"
            onClick={() => onChange(p.seconds)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium ring-1", seconds === p.seconds ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-zinc-700 ring-zinc-200 hover:ring-zinc-300")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <Field label="Tempo personalizado" hint="Máximo de 23 horas (a janela de resposta da Meta é de 24h).">
        <div className="flex gap-2">
          <Input type="number" min={1} value={Math.round(seconds / unit)} onChange={(e) => onChange(Math.max(1, Math.min(LIMITS.maxDelaySeconds, (Number(e.target.value) || 1) * unit)))} />
          <Select value={unit} onChange={(e) => onChange(Math.min(LIMITS.maxDelaySeconds, Math.round(seconds / unit) * Number(e.target.value)))} className="w-36">
            <option value={1}>segundos</option>
            <option value={60}>minutos</option>
            <option value={3600}>horas</option>
          </Select>
        </div>
      </Field>
    </div>
  );
}

export function NodeEditor({
  node,
  onChange,
  onDelete,
  onDuplicate,
  issues,
}: {
  node: FlowNode;
  onChange: (data: FlowNode["data"]) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  issues: string[];
}) {
  const { data: fields } = useFields();
  const qc = useQueryClient();
  const d = node.data as any;
  const patch = (p: Record<string, unknown>) => onChange({ ...d, ...p });

  const createField = async (label: string) => {
    try {
      const { field } = await api.post<{ field: { key: string } }>("/fields", { label });
      await qc.invalidateQueries({ queryKey: ["fields"] });
      patch({ fieldKey: field.key });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-zinc-500">{NODE_INFO[node.type].description}</p>
        {issues.length > 0 && (
          <Callout tone="error" className="mt-3">
            <ul className="list-disc pl-4">
              {issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          </Callout>
        )}
      </div>

      {node.type === "trigger" && (
        <>
          <Field label="O que inicia esta automação?">
            <div className="space-y-2">
              {(["dm", "comment", "story_reply", "story_mention", "new_follower"] as TriggerEvent[]).map((ev) => {
                const info = TRIGGER_EVENT_INFO[ev];
                return (
                  <label key={ev} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", d.event === ev ? "border-brand-500 bg-brand-50/50" : "border-zinc-200", !info.available && "cursor-not-allowed opacity-60")}>
                    <input type="radio" disabled={!info.available} checked={d.event === ev} onChange={() => patch({ event: ev })} className="mt-1 accent-brand-600" />
                    <span>
                      <span className="block text-sm font-medium">{info.label}</span>
                      <span className="block text-xs text-zinc-500">{info.available ? info.description : info.unavailableReason}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>
          {d.event === "comment" && (
            <>
              <Field label="Publicações monitoradas" hint={d.mediaIds.length ? `${d.mediaIds.length} selecionada(s)` : "Nenhuma selecionada = todas as publicações e Reels."}>
                <MediaPicker value={d.mediaIds} onChange={(mediaIds) => patch({ mediaIds })} />
              </Field>
              <div className="rounded-lg border border-zinc-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Responder também no comentário</p>
                  <Switch checked={d.publicReplyEnabled} onCheckedChange={(v) => patch({ publicReplyEnabled: v, publicReplies: d.publicReplies.length ? d.publicReplies : ["Te enviei no Direct! 📩"] })} />
                </div>
                {d.publicReplyEnabled && (
                  <div className="mt-3 space-y-2">
                    {d.publicReplies.map((r: string, i: number) => (
                      <Input key={i} value={r} maxLength={300} onChange={(e) => patch({ publicReplies: d.publicReplies.map((x: string, j: number) => (j === i ? e.target.value : x)) })} />
                    ))}
                    <Button size="xs" variant="ghost" onClick={() => patch({ publicReplies: [...d.publicReplies, ""] })}>
                      + Variação
                    </Button>
                  </div>
                )}
              </div>
              <Callout tone="info">Antes de a pessoa responder, só é possível enviar 1 mensagem (resposta privada). Use “Botões” para continuar a conversa.</Callout>
            </>
          )}
          <p className="text-xs text-zinc-500">Ligue o gatilho a blocos de Palavra-chave para criar caminhos diferentes por palavra, ou diretamente a uma ação para responder a tudo.</p>
        </>
      )}

      {node.type === "keyword" && <KeywordEditor value={d.keywords} onChange={(keywords) => patch({ keywords })} />}

      {node.type === "message" && (
        <Field label="Mensagem">
          <MessageEditor value={d.text} onChange={(text) => patch({ text })} rows={6} />
        </Field>
      )}

      {node.type === "image" && (
        <Field label="Imagem" hint="JPG, PNG, GIF ou WEBP até 8 MB.">
          <ImageField value={d.url} onChange={(url) => patch({ url })} />
        </Field>
      )}

      {node.type === "video" && (
        <Field label="URL do vídeo" hint="URL pública de um arquivo de vídeo (MP4). Limite de 25 MB.">
          <Input value={d.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://…/video.mp4" />
        </Field>
      )}

      {node.type === "link" && (
        <>
          <Field label="Texto da mensagem">
            <MessageEditor value={d.text} onChange={(text) => patch({ text })} rows={4} maxLength={640} allowLinkVariable={false} />
          </Field>
          <Field label="URL" hint="Mercado Livre, Shopee, Amazon, Kabum, WhatsApp (wa.me), site, blog…">
            <Input value={d.url} onChange={(e) => patch({ url: e.target.value })} placeholder="https://" inputMode="url" />
          </Field>
          <Field label="Texto do botão" hint="Até 20 caracteres.">
            <Input value={d.buttonTitle} onChange={(e) => patch({ buttonTitle: e.target.value })} maxLength={20} />
          </Field>
          <Checkbox checked={d.track} onChange={(track) => patch({ track })} label="Contar cliques" description="O link passa pelo nosso redirecionador para registrar o clique." />
        </>
      )}

      {node.type === "buttons" && (
        <>
          <Field label="Texto">
            <MessageEditor value={d.text} onChange={(text) => patch({ text })} rows={3} maxLength={640} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">Botões</p>
            {d.buttons.map((b: NodeDataMap["buttons"]["buttons"][number], i: number) => (
              <div key={b.id} className="space-y-2 rounded-lg border border-zinc-200 p-2.5">
                <div className="flex gap-2">
                  <Input value={b.title} maxLength={20} placeholder="Texto do botão" onChange={(e) => patch({ buttons: d.buttons.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                  <Button variant="ghost" size="sm" aria-label="Remover botão" onClick={() => patch({ buttons: d.buttons.filter((_: any, j: number) => j !== i) })}>
                    <X className="size-4" />
                  </Button>
                </div>
                <Select value={b.kind} onChange={(e) => patch({ buttons: d.buttons.map((x: any, j: number) => (j === i ? { ...x, kind: e.target.value } : x)) })}>
                  <option value="reply">Resposta (abre um caminho no fluxo)</option>
                  <option value="url">Abrir link</option>
                </Select>
                {b.kind === "url" && (
                  <Input value={b.url ?? ""} placeholder="https://" onChange={(e) => patch({ buttons: d.buttons.map((x: any, j: number) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                )}
              </div>
            ))}
            {d.buttons.length < (d.buttons.some((b: any) => b.kind === "url") ? 3 : LIMITS.maxQuickReplies) && (
              <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => patch({ buttons: [...d.buttons, { id: newId("b"), title: "", kind: "reply" }] })}>
                Adicionar botão
              </Button>
            )}
            <p className="text-xs text-zinc-500">Só respostas: aparecem como opções rápidas (até 10). Com algum link: modelo com até 3 botões.</p>
          </div>
        </>
      )}

      {node.type === "condition" && (
        <>
          <Field label="Seguir pelo “Sim” quando">
            <Select value={d.logic} onChange={(e) => patch({ logic: e.target.value })}>
              <option value="all">todas as regras forem verdadeiras</option>
              <option value="any">qualquer regra for verdadeira</option>
            </Select>
          </Field>
          <div className="space-y-2">
            {d.rules.map((r: ConditionRule, i: number) => (
              <RuleEditor
                key={i}
                rule={r}
                onChange={(rule) => patch({ rules: d.rules.map((x: ConditionRule, j: number) => (j === i ? rule : x)) })}
                onRemove={() => patch({ rules: d.rules.filter((_: ConditionRule, j: number) => j !== i) })}
              />
            ))}
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => patch({ rules: [...d.rules, { type: "has_tag", tagId: "" }] })}>
              Adicionar regra
            </Button>
          </div>
        </>
      )}

      {node.type === "delay" && <DelayEditor seconds={d.seconds} onChange={(seconds) => patch({ seconds })} />}

      {(node.type === "add_tag" || node.type === "remove_tag") && (
        <Field label="Tag">
          <TagSelect value={d.tagId} onChange={(tagId) => patch({ tagId })} />
        </Field>
      )}

      {node.type === "capture" && (
        <>
          <Field label="Pergunta">
            <MessageEditor value={d.question} onChange={(question) => patch({ question })} rows={3} />
          </Field>
          <Field label="Salvar a resposta no campo">
            <Select
              value={d.fieldKey}
              onChange={(e) => {
                if (e.target.value === "__new") {
                  const label = window.prompt("Nome do novo campo (ex.: Cidade)");
                  if (label) createField(label);
                } else patch({ fieldKey: e.target.value });
              }}
            >
              <option value="">Escolha…</option>
              {fields?.fields.map((f) => (
                <option key={f.id} value={f.key}>
                  {f.label}
                </option>
              ))}
              <option value="__new">+ Criar campo personalizado…</option>
            </Select>
          </Field>
          <Field label="Validar como">
            <Select value={d.validation} onChange={(e) => patch({ validation: e.target.value })}>
              <option value="text">Texto livre</option>
              <option value="email">E-mail</option>
              <option value="phone">Telefone</option>
              <option value="number">Número</option>
            </Select>
          </Field>
          <Field label="Mensagem se a resposta for inválida">
            <Input value={d.retryMessage} onChange={(e) => patch({ retryMessage: e.target.value })} />
          </Field>
          <Field label="Tentativas">
            <Select value={d.maxAttempts} onChange={(e) => patch({ maxAttempts: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      {node.type === "handoff" && (
        <Field label="Mensagem para o contato" optional hint="As automações ficam pausadas para este contato e a conversa aparece na Caixa de entrada.">
          <MessageEditor value={d.message} onChange={(message) => patch({ message })} rows={3} />
        </Field>
      )}

      {node.type !== "trigger" && (
        <div className="flex gap-2 border-t border-zinc-100 pt-4">
          <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={onDuplicate}>
            Duplicar
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash className="size-4" />} onClick={onDelete} className="text-red-600 hover:bg-red-50">
            Excluir bloco
          </Button>
        </div>
      )}
    </div>
  );
}
