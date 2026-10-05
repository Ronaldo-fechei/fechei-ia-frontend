/**
 * Driver de canal: tudo que o sistema precisa saber sobre um canal.
 * Para adicionar um canal (Messenger, Telegram…), implemente este contrato
 * e registre-o em channels/registry.ts.
 */
import type { Channel } from "@veloxia/shared";
import type { channelAccounts, contacts } from "../db/schema";
import type { ChannelAdapter, ChannelError } from "../engine/channel";

export type ChannelAccount = typeof channelAccounts.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;

/** Campos do perfil do contato que um canal consegue preencher. */
export type ContactProfileUpdate = Partial<
  Pick<ContactRow, "name" | "username" | "profilePicUrl" | "followerCount" | "isFollower" | "isFollowedByBusiness" | "phone">
>;

export type InboundEventKind = "dm" | "comment" | "story_reply" | "story_mention";

export interface ChannelDriver {
  readonly channel: Channel;
  /** Adaptador de envio para a conta. */
  adapter(account: ChannelAccount): ChannelAdapter;
  /** Converte erros do provedor em ChannelError (tipo, mensagem amigável, se pode tentar de novo). */
  toChannelError(err: unknown): ChannelError;
  /** Permissão (escopo OAuth) exigida para responder a um evento; null = nenhuma específica. */
  requiredScope(event: InboundEventKind): string | null;
  /** Busca nome/foto do contato no provedor (melhor esforço). */
  fetchProfile?(account: ChannelAccount, contact: ContactRow): Promise<ContactProfileUpdate>;
  /** Ativa o recebimento de eventos (webhooks) da conta. */
  subscribeWebhooks(account: ChannelAccount): Promise<void>;
  /** Limpeza no provedor ao desconectar (cancelar webhooks etc.). */
  cleanup(account: ChannelAccount): Promise<void>;
  /** Renova o token quando o provedor exige (Instagram: a cada 60 dias). */
  refreshToken?(account: ChannelAccount): Promise<void>;
}
