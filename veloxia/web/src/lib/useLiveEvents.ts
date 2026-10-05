import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** Atualizações em tempo real via Server-Sent Events: invalida as consultas afetadas. */
export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events/stream", { withCredentials: true });
    const on = (type: string, handler: (ids: Record<string, string>) => void) =>
      source.addEventListener(type, (e) => {
        try {
          handler(JSON.parse((e as MessageEvent).data).ids ?? {});
        } catch {
          handler({});
        }
      });
    on("message.created", (ids) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (ids.conversationId) qc.invalidateQueries({ queryKey: ["messages", ids.conversationId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    });
    on("message.updated", (ids) => {
      if (ids.conversationId) qc.invalidateQueries({ queryKey: ["messages", ids.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    });
    on("conversation.updated", (ids) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (ids.conversationId) qc.invalidateQueries({ queryKey: ["conversation", ids.conversationId] });
    });
    on("contact.updated", (ids) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      if (ids.contactId) qc.invalidateQueries({ queryKey: ["contact", ids.contactId] });
      qc.invalidateQueries({ queryKey: ["conversation"] });
    });
    on("execution.updated", () => {
      qc.invalidateQueries({ queryKey: ["executions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["comments"] });
    });
    on("notification.created", () => qc.invalidateQueries({ queryKey: ["notifications"] }));
    on("channels.updated", () => {
      qc.invalidateQueries({ queryKey: ["channel-accounts"] });
      qc.invalidateQueries({ queryKey: ["instagram-accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    });
    on("templates.updated", () => qc.invalidateQueries({ queryKey: ["whatsapp-templates"] }));
    on("billing.updated", () => {
      qc.invalidateQueries({ queryKey: ["billing"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    });
    return () => source.close();
  }, [enabled, qc]);
}
