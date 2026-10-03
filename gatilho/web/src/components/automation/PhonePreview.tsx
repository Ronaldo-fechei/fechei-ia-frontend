import { renderVariables, SYSTEM_VARIABLES } from "@gatilho/shared";
import type { ReactNode } from "react";
import type { SimOutput } from "../../lib/types";
import { Bubble, OutboundContentView } from "./Bubbles";

const EXAMPLE_VARS = Object.fromEntries(SYSTEM_VARIABLES.map((v) => [v.key, v.example]));

export function previewText(text: string, link?: string) {
  return renderVariables(text, { ...EXAMPLE_VARS, ...(link ? { link } : {}) });
}

/** Pré-visualização estilo celular do que o contato vai receber. */
export function PhonePreview({ incoming, outputs, footer }: { incoming?: string; outputs: SimOutput["content"][]; footer?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[2rem] bg-ink-900 p-2.5 shadow-pop">
      <div className="overflow-hidden rounded-[1.5rem] bg-white">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-amber-100 text-[11px] font-bold text-brand-800">SC</span>
          <div>
            <p className="text-xs font-semibold">Sua conta</p>
            <p className="text-[10px] text-zinc-400">Como o seguidor vê a resposta</p>
          </div>
        </div>
        <div className="min-h-64 space-y-2 p-3">
          {incoming && <Bubble side="right" className="bg-zinc-100 text-zinc-900">{incoming}</Bubble>}
          {outputs.map((c, i) => (
            <OutboundContentView key={i} content={c} side="left" />
          ))}
        </div>
        {footer && <div className="border-t border-zinc-100 px-3 py-2 text-[11px] text-zinc-500">{footer}</div>}
      </div>
    </div>
  );
}
