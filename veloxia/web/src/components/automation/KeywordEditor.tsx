import { Plus, Settings2, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { keywordKey, MATCH_TYPE_HELP, MATCH_TYPE_LABELS, MATCH_TYPES, type MatchType } from "@veloxia/shared";
import { cn } from "../../lib/cn";
import { Button, Checkbox, Input, Select } from "../ui";

export interface KeywordValue {
  text: string;
  matchType: MatchType;
  caseSensitive: boolean;
  ignoreAccents: boolean;
}

export function KeywordEditor({ value, onChange, invalid }: { value: KeywordValue[]; onChange: (v: KeywordValue[]) => void; invalid?: boolean }) {
  const [draft, setDraft] = useState("");
  const [advanced, setAdvanced] = useState(() => value.some((k) => k.matchType !== (value[0]?.matchType ?? "contains_word") || k.caseSensitive));
  const defaults = {
    matchType: value[0]?.matchType ?? ("contains_word" as MatchType),
    caseSensitive: value[0]?.caseSensitive ?? false,
    ignoreAccents: value[0]?.ignoreAccents ?? true,
  };

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    const existing = new Set(value.map((k) => keywordKey(k)));
    const next = [...value];
    for (const text of parts) {
      const kw = { text: text.slice(0, 100), ...defaults };
      if (!existing.has(keywordKey(kw))) {
        next.push(kw);
        existing.add(keywordKey(kw));
      }
    }
    onChange(next);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const setAll = (patch: Partial<KeywordValue>) => onChange(value.map((k) => ({ ...k, ...patch })));
  const update = (i: number, patch: Partial<KeywordValue>) => onChange(value.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5 shadow-xs focus-within:border-brand-400 focus-within:ring-3 focus-within:ring-brand-100",
          invalid ? "border-red-400" : "border-zinc-200",
        )}
      >
        {value.map((k, i) => (
          <span key={`${k.text}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-brand-50 py-1 pr-1 pl-2 text-sm font-medium text-brand-800 ring-1 ring-brand-200 ring-inset">
            {k.text}
            <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="rounded p-0.5 hover:bg-brand-100" aria-label={`Remover ${k.text}`}>
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
          placeholder={value.length ? "Adicionar outra…" : "Digite uma palavra e pressione Enter"}
          className="h-8 min-w-40 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-zinc-400"
          aria-label="Nova palavra-chave"
        />
        {draft && (
          <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onMouseDown={(e) => e.preventDefault()} onClick={() => add(draft)}>
            Adicionar
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div>
          <Select value={defaults.matchType} onChange={(e) => setAll({ matchType: e.target.value as MatchType })} aria-label="Tipo de correspondência">
            {MATCH_TYPES.map((m) => (
              <option key={m} value={m}>
                {MATCH_TYPE_LABELS[m]}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-zinc-500">{MATCH_TYPE_HELP[defaults.matchType]}</p>
        </div>
        <Button variant="ghost" size="sm" icon={<Settings2 className="size-4" />} onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Ocultar avançado" : "Avançado"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={defaults.ignoreAccents} onChange={(v) => setAll({ ignoreAccents: v })} label="Ignorar acentos" description="“preço” = “preco”" />
        <Checkbox checked={!defaults.caseSensitive} onChange={(v) => setAll({ caseSensitive: !v })} label="Ignorar maiúsculas" description="“LINK” = “link” (recomendado)" />
      </div>

      {advanced && value.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="mb-2 text-xs font-medium text-zinc-600">Correspondência por palavra-chave</p>
          <div className="space-y-2">
            {value.map((k, i) => (
              <div key={`${k.text}-adv-${i}`} className="flex flex-wrap items-center gap-2">
                <Input value={k.text} onChange={(e) => update(i, { text: e.target.value })} className="h-8 max-w-48" aria-label="Palavra-chave" />
                <Select value={k.matchType} onChange={(e) => update(i, { matchType: e.target.value as MatchType })} className="h-8 max-w-56">
                  {MATCH_TYPES.map((m) => (
                    <option key={m} value={m}>
                      {MATCH_TYPE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
