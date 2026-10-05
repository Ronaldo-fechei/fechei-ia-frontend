/** Registro dos canais disponíveis. Adicione aqui o driver de um canal novo. */
import type { Channel } from "@veloxia/shared";
import { instagramDriver } from "./instagram";
import type { ChannelDriver } from "./types";
import { whatsappDriver } from "./whatsapp";

const DRIVERS: Record<Channel, ChannelDriver> = {
  instagram: instagramDriver,
  whatsapp: whatsappDriver,
};

export function getDriver(channel: Channel): ChannelDriver {
  const driver = DRIVERS[channel];
  if (!driver) throw new Error(`Canal sem driver registrado: ${channel}`);
  return driver;
}
