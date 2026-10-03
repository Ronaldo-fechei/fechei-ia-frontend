import { useQuery } from "@tanstack/react-query";
import { Check, ImageOff } from "lucide-react";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { InstagramAccount } from "../../lib/types";
import { Callout, Skeleton } from "../ui";

interface Media {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

/** Escolha das publicações/Reels monitorados pelo Comentário → DM (lista real da API do Instagram). */
export function MediaPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const accounts = useQuery({ queryKey: ["instagram-accounts"], queryFn: () => api.get<{ accounts: InstagramAccount[] }>("/instagram/accounts") });
  const account = accounts.data?.accounts[0];
  const media = useQuery({
    queryKey: ["instagram-media", account?.id],
    queryFn: () => api.get<{ media: Media[] }>(`/instagram/accounts/${account!.id}/media`),
    enabled: !!account && account.status === "connected",
    staleTime: 5 * 60_000,
  });

  if (accounts.isLoading) return <Skeleton className="h-24" />;
  if (!account) return <Callout tone="warning">Conecte sua conta do Instagram para escolher publicações específicas.</Callout>;
  if (media.isError) return <Callout tone="error">{(media.error as Error).message}</Callout>;
  if (media.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square" />
        ))}
      </div>
    );
  }
  const items = media.data?.media ?? [];
  if (!items.length) return <p className="text-sm text-zinc-500">Nenhuma publicação encontrada nesta conta.</p>;

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="scrollbar-thin grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
      {items.map((m) => {
        const img = m.thumbnail_url ?? (m.media_type !== "VIDEO" ? m.media_url : undefined);
        const selected = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => toggle(m.id)}
            title={m.caption ?? ""}
            className={cn("group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 ring-2 transition", selected ? "ring-brand-500" : "ring-transparent hover:ring-zinc-300")}
          >
            {img ? <img src={img} alt={m.caption?.slice(0, 60) ?? "Publicação"} className="size-full object-cover" loading="lazy" /> : <ImageOff className="m-auto size-6 text-zinc-400" />}
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">{m.media_product_type === "REELS" ? "Reel" : "Post"}</span>
            {selected && (
              <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-brand-600 text-white">
                <Check className="size-3.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
