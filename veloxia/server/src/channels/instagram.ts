/** Driver do Instagram (API do Instagram com login do Instagram). */
import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { channelAccounts } from "../db/schema";
import { decrypt, encrypt } from "../lib/crypto";
import { AppError } from "../lib/errors";
import { InstagramChannel, toChannelError } from "../integrations/instagram/adapter";
import { InstagramClient } from "../integrations/instagram/client";
import { refreshLongLivedToken } from "../integrations/instagram/oauth";
import type { ChannelAccount, ChannelDriver } from "./types";

export function instagramClient(account: ChannelAccount): InstagramClient {
  if (account.channel !== "instagram") throw new Error("Conta não é do Instagram");
  if (!account.accessTokenEnc || account.disconnectedAt) {
    throw new AppError(409, "channel_disconnected", "A conta do Instagram está desconectada. Reconecte para continuar.");
  }
  return new InstagramClient(decrypt(account.accessTokenEnc));
}

export const instagramDriver: ChannelDriver = {
  channel: "instagram",

  adapter: (account) => new InstagramChannel(instagramClient(account)),

  toChannelError,

  requiredScope: (event) => (event === "comment" ? "instagram_business_manage_comments" : "instagram_business_manage_messages"),

  async fetchProfile(account, contact) {
    const profile = await instagramClient(account).getUserProfile(contact.externalId);
    return {
      name: profile.name ?? contact.name,
      username: profile.username ?? contact.username,
      profilePicUrl: profile.profile_pic ?? contact.profilePicUrl,
      followerCount: profile.follower_count ?? contact.followerCount,
      isFollower: profile.is_user_follow_business ?? contact.isFollower,
      isFollowedByBusiness: profile.is_business_follow_user ?? contact.isFollowedByBusiness,
    };
  },

  async subscribeWebhooks(account) {
    const fields = env.META_WEBHOOK_FIELDS.split(",").map((f) => f.trim()).filter(Boolean);
    await instagramClient(account).subscribeWebhooks(fields);
  },

  async cleanup(account) {
    if (account.accessTokenEnc) await instagramClient(account).unsubscribeWebhooks();
  },

  async refreshToken(account) {
    if (!account.accessTokenEnc) return;
    const refreshed = await refreshLongLivedToken(decrypt(account.accessTokenEnc));
    await db
      .update(channelAccounts)
      .set({
        accessTokenEnc: encrypt(refreshed.accessToken),
        tokenExpiresAt: refreshed.expiresAt,
        tokenRefreshedAt: new Date(),
        status: account.status === "token_expired" ? "connected" : account.status,
        updatedAt: new Date(),
      })
      .where(eq(channelAccounts.id, account.id));
  },
};
