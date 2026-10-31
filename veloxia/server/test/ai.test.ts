import { describe, expect, it } from "vitest";
import { suggestionChannels } from "../src/modules/ai/service";

describe("canais da sugestão de IA", () => {
  it("mantém Instagram e WhatsApp juntos em mensagens", () => {
    expect(suggestionChannels(["instagram", "whatsapp", "whatsapp"], "dm")).toEqual(["instagram", "whatsapp"]);
    expect(suggestionChannels(["whatsapp"], "dm")).toEqual(["whatsapp"]);
  });

  it("comentários e Stories só existem no Instagram", () => {
    expect(suggestionChannels(["whatsapp"], "comment")).toEqual(["instagram"]);
    expect(suggestionChannels(["instagram", "whatsapp"], "story_mention")).toEqual(["instagram"]);
  });

  it("sem canal informado, usa o Instagram", () => {
    expect(suggestionChannels([], "dm")).toEqual(["instagram"]);
  });
});
