import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { MATCH_TYPE_LABELS, TRIGGER_EVENT_INFO, type MatchType, type TriggerEvent } from "@gatilho/shared";
import { api, errorMessage } from "../../lib/api";
import { useAuth, useSystemStatus } from "../../hooks/useAuth";
import { Badge, Button, ButtonLink, Callout, Field, Modal, Textarea } from "../ui";

export interface AiSuggestion {
  name: string;
  triggerEvent: "dm" | "comment" | "story_reply" | "story_mention";
  keywords: string[];
  matchType: MatchType;
  message: string;
  needsLink: boolean;
  buttonTitle: string;
  explanation: string;
}

const EXAMPLES = [
  "Quero uma automação para quando alguém pedir o link de um produto.",
  "Quando comentarem EU QUERO no meu Reel, mandar o link do curso no Direct.",
  "Responder dúvidas sobre frete e prazo de entrega.",
];

/** "Gerar automação com IA" → Revisar → Editar → Publicar. A IA nunca publica sozinha. */
export function AiGenerateModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data: system } = useSystemStatus();
  const planAllows = me?.plan.features.ai !== false;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { suggestion } = await api.post<{ suggestion: AiSuggestion }>("/ai/automation-suggestion", { prompt });
      setSuggestion(suggestion);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const review = () => {
    if (!suggestion) return;
    sessionStorage.setItem("gatilho:ai-draft", JSON.stringify(suggestion));
    onOpenChange(false);
    navigate("/app/automacoes/nova?origem=ia");
  };

  const close = (v: boolean) => {
    if (!v) {
      setSuggestion(null);
      setError(null);
    }
    onOpenChange(v);
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-5 text-brand-600" /> Gerar automação com IA
        </span>
      }
      description="Descreva o que você quer. A IA sugere nome, palavras-chave e mensagem — você revisa e publica."
      footer={
        suggestion ? (
          <>
            <Button variant="secondary" onClick={() => setSuggestion(null)}>
              Gerar outra
            </Button>
            <Button onClick={review}>Revisar e editar</Button>
          </>
        ) : system?.aiEnabled && planAllows ? (
          <Button onClick={generate} loading={loading} disabled={prompt.trim().length < 10} icon={<Sparkles className="size-4" />}>
            Gerar sugestão
          </Button>
        ) : null
      }
    >
      {!system?.aiEnabled ? (
        <Callout tone="warning" title="IA não configurada">
          A geração com IA precisa da variável <code>ANTHROPIC_API_KEY</code> no servidor. Enquanto isso, use a criação rápida ou um modelo pronto.
        </Callout>
      ) : !planAllows ? (
        <Callout tone="info" title="Disponível nos planos pagos" action={<ButtonLink to="/app/configuracoes?aba=plano" size="sm" variant="secondary">Ver planos</ButtonLink>}>
          A geração de automações com IA faz parte dos planos Pro e Business.
        </Callout>
      ) : suggestion ? (
        <div className="space-y-4">
          <Callout tone="info">{suggestion.explanation}</Callout>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-zinc-500">Nome</dt>
              <dd className="font-medium">{suggestion.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Gatilho</dt>
              <dd>{TRIGGER_EVENT_INFO[suggestion.triggerEvent as TriggerEvent]?.label}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-zinc-500">Palavras-chave ({MATCH_TYPE_LABELS[suggestion.matchType]})</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {suggestion.keywords.map((k) => (
                  <Badge key={k} tone="brand">
                    {k.toUpperCase()}
                  </Badge>
                ))}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-zinc-500">Mensagem</dt>
              <dd className="mt-1 rounded-lg bg-zinc-50 p-3 whitespace-pre-wrap">{suggestion.message}</dd>
            </div>
            {suggestion.needsLink && (
              <div className="sm:col-span-2">
                <Callout tone="warning">Você vai informar o link (URL) na próxima etapa{suggestion.buttonTitle ? `, no botão “${suggestion.buttonTitle}”` : ""}.</Callout>
              </div>
            )}
          </dl>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Callout tone="error">{error}</Callout>}
          <Field label="O que a automação deve fazer?" htmlFor="ai-prompt">
            <Textarea id="ai-prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={EXAMPLES[0]} maxLength={1000} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:border-brand-300 hover:text-brand-700">
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
