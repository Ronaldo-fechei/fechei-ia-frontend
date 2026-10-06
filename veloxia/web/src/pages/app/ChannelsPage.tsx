import { useSearchParams } from "react-router";
import { CHANNELS, CHANNEL_INFO, type Channel } from "@veloxia/shared";
import { ChannelGlyph } from "../../components/brand/Logo";
import { BookOpenCheck } from "lucide-react";
import { ButtonLink, PageHeader, Tabs } from "../../components/ui";
import { useChannelAccounts } from "../../hooks/useChannels";
import { InstagramPanel } from "./InstagramPage";
import { WhatsAppPanel } from "./WhatsAppPanel";

/** Canais conectados. Novos aplicativos entram como mais uma aba (veja shared/src/channels.ts). */
export default function ChannelsPage() {
  const [params, setParams] = useSearchParams();
  const { instagram, whatsapp } = useChannelAccounts();
  const requested = params.get("canal");
  const channel: Channel = CHANNELS.includes(requested as Channel) ? (requested as Channel) : "instagram";
  const counts: Record<Channel, number> = { instagram: instagram.length, whatsapp: whatsapp.length };

  return (
    <div>
      <PageHeader
        title="Canais"
        description="Conexões oficiais com a Meta. Conecte o Instagram, o WhatsApp ou os dois."
        actions={
          <ButtonLink to={`/app/como-conectar?canal=${channel}`} variant="secondary" icon={<BookOpenCheck className="size-4" />}>
            Passo a passo
          </ButtonLink>
        }
      />
      <Tabs
        className="mb-6"
        value={channel}
        onChange={(c) => {
          const next = new URLSearchParams();
          next.set("canal", c);
          setParams(next, { replace: true });
        }}
        items={CHANNELS.map((c) => ({
          value: c,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <ChannelGlyph channel={c} className="size-4" />
              {CHANNEL_INFO[c].label}
            </span>
          ),
          count: counts[c] || undefined,
        }))}
      />
      {channel === "whatsapp" ? <WhatsAppPanel /> : <InstagramPanel />}
    </div>
  );
}
