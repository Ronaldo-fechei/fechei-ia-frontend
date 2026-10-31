/**
 * IA opcional (Claude): sugere automações e reescreve textos no tom da marca.
 * A IA apenas sugere — nada é publicado nem enviado sem revisão do usuário.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CHANNELS, LIMITS, MATCH_TYPES, TONE_LABELS, type Channel, type Tone } from "@veloxia/shared";
import { listActiveAccounts } from "../../channels/accounts";
import { aiConfigured, env } from "../../config/env";
import { db } from "../../db/client";
import { aiGenerations } from "../../db/schema";
import { AppError, unavailable } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { recordSystemError } from "../../services/audit";
import { assertLimit, hasFeature, incrementUsage, USAGE_METRICS } from "../billing/limits";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!aiConfigured()) throw unavailable("A IA não está configurada neste servidor (defina ANTHROPIC_API_KEY).");
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  return client;
}

export const suggestionSchema = z.object({
  name: z.string(),
  channels: z.array(z.enum(CHANNELS)),
  triggerEvent: z.enum(["dm", "comment", "story_reply", "story_mention"]),
  keywords: z.array(z.string()),
  matchType: z.enum(MATCH_TYPES),
  message: z.string(),
  needsLink: z.boolean(),
  buttonTitle: z.string(),
  explanation: z.string(),
});
export type AutomationSuggestion = z.infer<typeof suggestionSchema>;

const rewriteSchema = z.object({ text: z.string() });

interface WorkspaceVoice {
  id: string;
  tone: string;
  brandInstructions: string;
}

function voiceInstructions(ws: WorkspaceVoice): string {
  const tone = TONE_LABELS[(ws.tone as Tone) ?? "friendly"] ?? TONE_LABELS.friendly;
  const brand = ws.brandInstructions.trim();
  return [
    `Tom de voz da marca: ${tone.label} — ${tone.description}`,
    brand ? `Instruções da marca (escreva como a marca):\n${brand}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const SYSTEM_PROMPT = `Você ajuda criadores, lojas e afiliados brasileiros a configurar respostas automáticas oficiais para o Instagram (Direct, comentários e Stories) e para o WhatsApp.
O usuário descreve o que quer e você propõe UMA automação simples para ele revisar antes de publicar.

Canais (channels):
- "instagram": aceita todos os gatilhos (triggerEvent): "dm" (mensagem no Direct), "comment" (comentário em post ou Reels), "story_reply" (resposta a Story) e "story_mention" (menção em Story).
- "whatsapp": só aceita o gatilho "dm" (mensagem recebida no WhatsApp). Comentários e Stories não existem no WhatsApp.
- Use os dois canais juntos (["instagram", "whatsapp"]) só com o gatilho "dm" e só quando o pedido fizer sentido nos dois.
- Escolha o canal pelo que o usuário pediu. Se ele não disser, prefira um canal que esteja conectado (informado abaixo).

Regras da plataforma (respeite sempre):
- Mensagens com no máximo ${LIMITS.textMaxLength} caracteres, em português do Brasil, naturais e curtas.
- No WhatsApp, *negrito* e _itálico_ funcionam; no Instagram não. Se a automação incluir o Instagram, não use essa formatação.
- Texto de botão com no máximo ${LIMITS.buttonTitleMaxLength} caracteres.
- Palavras-chave: de 2 a 8 palavras ou expressões curtas que as pessoas realmente digitariam (ex.: "link", "quero", "preço", "onde comprar"), sem duplicatas.
- Em automações de comentário ("comment"), a resposta é uma única mensagem privada.
- Variáveis disponíveis: {{primeiro_nome}}, {{nome}}, {{username}}, {{data}}, {{hora}}. Use no máximo uma, com valor padrão, ex.: {{primeiro_nome|tudo bem}}. No WhatsApp {{username}} fica vazio: não use essa variável se a automação incluir o WhatsApp.
- Nunca invente URLs, preços, prazos ou promessas. Se a resposta precisar de um link, marque needsLink = true e não escreva a URL no texto: o usuário vai preencher.
- matchType: use "contains_word" na maioria dos casos; "exact" só para palavras de comando únicas.
- explanation: 1 ou 2 frases explicando a sugestão para o usuário.`;

async function logGeneration(ws: WorkspaceVoice, userId: string, prompt: string, result: unknown, response: { model: string; usage?: { input_tokens?: number; output_tokens?: number } }) {
  await db.insert(aiGenerations).values({
    workspaceId: ws.id,
    userId,
    prompt: prompt.slice(0, 2000),
    result: result as Record<string, unknown>,
    model: response.model,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
  });
  await incrementUsage(ws.id, USAGE_METRICS.ai);
}

/** Canais válidos para o gatilho: WhatsApp só existe para mensagens ("dm"). */
export function suggestionChannels(channels: Channel[], triggerEvent: AutomationSuggestion["triggerEvent"]): Channel[] {
  const unique = [...new Set(channels)].filter((c) => (CHANNELS as readonly string[]).includes(c));
  if (triggerEvent !== "dm") return ["instagram"];
  return unique.length ? unique : ["instagram"];
}

async function connectedChannelsNote(workspaceId: string): Promise<string> {
  const accounts = await listActiveAccounts(workspaceId);
  const connected = [...new Set(accounts.map((a) => a.channel))];
  return connected.length
    ? `Canais conectados nesta conta: ${connected.join(", ")}.`
    : "Nenhum canal conectado ainda: escolha pelo pedido do usuário (na dúvida, \"instagram\").";
}

async function guard(ws: WorkspaceVoice): Promise<void> {
  if (!(await hasFeature(ws.id, "ai"))) {
    throw new AppError(402, "limit_reached", "A geração com IA está disponível nos planos pagos.");
  }
  await assertLimit(ws.id, "ai_generations_per_month");
}

function mapError(err: unknown): never {
  if (err instanceof AppError) throw err;
  if (err instanceof Anthropic.APIError) {
    // Nunca logar a chave (ela nem chega a fazer parte do erro: status/mensagem vêm da resposta do provedor).
    logger.warn({ status: err.status, message: err.message }, "[ai] erro do provedor");
  }
  if (err instanceof Anthropic.RateLimitError) throw new AppError(429, "ai_rate_limited", "A IA está ocupada no momento. Tente novamente em alguns segundos.");
  if (err instanceof Anthropic.AuthenticationError) throw unavailable("A chave da IA é inválida. Verifique ANTHROPIC_API_KEY.");
  if (err instanceof Anthropic.NotFoundError) throw unavailable("O modelo de IA configurado (AI_MODEL) não existe ou foi descontinuado.");
  if (err instanceof Anthropic.APIError) throw new AppError(502, "ai_error", "Não foi possível gerar a sugestão agora. Tente novamente.");
  throw err;
}

export async function suggestAutomation(ws: WorkspaceVoice, userId: string, prompt: string): Promise<AutomationSuggestion> {
  await guard(ws);
  try {
    const response = await getClient().beta.messages.parse({
      model: env.AI_MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: `${SYSTEM_PROMPT}\n\n${await connectedChannelsNote(ws.id)}\n\n${voiceInstructions(ws)}`,
      output_config: { effort: "low", format: betaZodOutputFormat(suggestionSchema) },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new AppError(422, "ai_refused", "Não consegui gerar uma sugestão para esse pedido. Tente descrever de outro jeito.");
    }
    const s = response.parsed_output;
    const keywords = [...new Set(s.keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 15).map((k) => k.slice(0, 100));
    const suggestion: AutomationSuggestion = {
      ...s,
      channels: suggestionChannels(s.channels, s.triggerEvent),
      name: s.name.trim().slice(0, 80) || "Nova automação",
      keywords: s.triggerEvent === "story_mention" ? [] : keywords,
      message: s.message.trim().slice(0, LIMITS.textMaxLength),
      buttonTitle: s.buttonTitle.trim().slice(0, LIMITS.buttonTitleMaxLength),
      explanation: s.explanation.trim().slice(0, 500),
    };
    await logGeneration(ws, userId, prompt, suggestion, response);
    return suggestion;
  } catch (err) {
    if (!(err instanceof AppError)) await recordSystemError("ai.suggest", err, { workspaceId: ws.id });
    mapError(err);
  }
}

export async function rewriteText(ws: WorkspaceVoice, userId: string, text: string, goal?: string): Promise<string> {
  await guard(ws);
  try {
    const response = await getClient().beta.messages.parse({
      model: env.AI_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: `Você reescreve mensagens de resposta automática do Instagram e do WhatsApp em português do Brasil, mantendo o sentido, links e variáveis no formato {{variavel}} exatamente como estão. Máximo de ${LIMITS.textMaxLength} caracteres. Não invente informações.\n\n${voiceInstructions(ws)}`,
      output_config: { effort: "low", format: betaZodOutputFormat(rewriteSchema) },
      messages: [{ role: "user", content: `${goal ? `Objetivo: ${goal}\n\n` : ""}Mensagem original:\n${text}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new AppError(422, "ai_refused", "Não consegui reescrever esse texto.");
    }
    const out = response.parsed_output.text.trim().slice(0, LIMITS.textMaxLength);
    await logGeneration(ws, userId, text, { text: out }, response);
    return out;
  } catch (err) {
    if (!(err instanceof AppError)) await recordSystemError("ai.rewrite", err, { workspaceId: ws.id });
    mapError(err);
  }
}
