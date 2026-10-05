import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { ChannelAccount } from "../lib/types";

/** Contas conectadas (Instagram e WhatsApp). */
export function useChannelAccounts() {
  const query = useQuery({
    queryKey: ["channel-accounts"],
    queryFn: () => api.get<{ accounts: ChannelAccount[] }>("/channels/accounts"),
    staleTime: 60_000,
  });
  const accounts = query.data?.accounts ?? [];
  return {
    ...query,
    accounts,
    instagram: accounts.filter((a) => a.channel === "instagram"),
    whatsapp: accounts.filter((a) => a.channel === "whatsapp"),
  };
}
