import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { Braces, SmilePlus, WandSparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { LIMITS, SYSTEM_VARIABLES } from "@veloxia/shared";
import { api, errorMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { FieldItem } from "../../lib/types";
import { useAuth, useSystemStatus } from "../../hooks/useAuth";
import { Button, Textarea } from "../ui";

const EMOJIS = ["😊", "😍", "🥰", "😉", "🙌", "👏", "🙏", "❤️", "💜", "🔥", "✨", "🎉", "🎁", "🛍️", "🛒", "💳", "💰", "📦", "🚚", "📩", "📲", "👇", "👉", "✅", "⭐", "⚡", "💡", "📍", "⏰", "🤩", "😎", "💬"];

export function useFields() {
  return useQuery({ queryKey: ["fields"], queryFn: () => api.get<{ fields: FieldItem[] }>("/fields"), staleTime: 60_000 });
}

export function MessageEditor({
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength = LIMITS.textMaxLength,
  invalid,
  id,
  allowLinkVariable = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  invalid?: boolean;
  id?: string;
  allowLinkVariable?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { data: fields } = useFields();
  const { data: system } = useSystemStatus();
  const { me } = useAuth();
  const [rewriting, setRewriting] = useState(false);
  const aiAvailable = !!system?.aiEnabled && me?.plan.features.ai !== false;

  const insert = (text: string) => {
    const el = ref.current;
    if (!el) return onChange(value + text);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const rewrite = async () => {
    if (!value.trim()) return;
    setRewriting(true);
    try {
      const { text } = await api.post<{ text: string }>("/ai/rewrite", { text: value });
      onChange(text);
      toast.success("Texto reescrito no tom da sua marca. Revise antes de publicar.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRewriting(false);
    }
  };

  const variables = [
    ...SYSTEM_VARIABLES.filter((v) => allowLinkVariable || v.key !== "link"),
    ...(fields?.fields ?? []).filter((f) => !SYSTEM_VARIABLES.some((v) => v.key === f.key)).map((f) => ({ key: f.key, label: f.label, description: "Campo personalizado do contato", example: "" })),
  ];

  return (
    <div className={cn("rounded-lg border bg-white shadow-xs focus-within:border-brand-400 focus-within:ring-3 focus-within:ring-brand-100", invalid ? "border-red-400" : "border-zinc-200")}>
      <Textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y border-0 shadow-none focus:ring-0"
      />
      <div className="flex flex-wrap items-center gap-1 border-t border-zinc-100 px-2 py-1.5">
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="ghost" size="xs" icon={<SmilePlus className="size-3.5" />}>
              Emoji
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content sideOffset={6} align="start" className="z-50 grid w-64 grid-cols-8 gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-pop">
              {EMOJIS.map((e) => (
                <Popover.Close key={e} asChild>
                  <button type="button" className="rounded-md p-1 text-lg hover:bg-zinc-100" onClick={() => insert(e)}>
                    {e}
                  </button>
                </Popover.Close>
              ))}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button variant="ghost" size="xs" icon={<Braces className="size-3.5" />}>
              Variável
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content sideOffset={6} align="start" className="scrollbar-thin z-50 max-h-72 w-72 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-pop">
              {variables.map((v) => (
                <Popover.Close key={v.key} asChild>
                  <button type="button" onClick={() => insert(`{{${v.key}}}`)} className="flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-zinc-100">
                    <span className="font-mono text-xs text-brand-700">{`{{${v.key}}}`}</span>
                    <span className="text-xs text-zinc-500">{v.description}</span>
                  </button>
                </Popover.Close>
              ))}
              <p className="px-2.5 py-2 text-[11px] text-zinc-400">
                Dica: use um valor padrão, ex.: <span className="font-mono">{"{{primeiro_nome|tudo bem}}"}</span>
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {aiAvailable && (
          <Button variant="ghost" size="xs" icon={<WandSparkles className="size-3.5" />} onClick={rewrite} loading={rewriting} disabled={!value.trim()}>
            Melhorar com IA
          </Button>
        )}
        <span className={cn("ml-auto text-xs tabular-nums", value.length > maxLength ? "font-medium text-red-600" : "text-zinc-400")}>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}
