import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { api, ApiError, errorMessage, qs } from "../lib/api";
import type { AutomationFull, AutomationSummary } from "../lib/types";
import { useConfirm } from "../components/ui";
import { useAuth } from "./useAuth";

export function useAutomations(filters: { status?: string; kind?: string; q?: string; triggerEvent?: string } = {}) {
  return useQuery({
    queryKey: ["automations", filters],
    queryFn: () => api.get<{ automations: AutomationSummary[] }>(`/automations${qs(filters)}`),
  });
}

export function useAutomation(id: string | undefined) {
  return useQuery({
    queryKey: ["automation", id],
    queryFn: () => api.get<{ automation: AutomationFull }>(`/automations/${id}`),
    enabled: !!id,
  });
}

/** Ações comuns (publicar, pausar, duplicar, excluir) com feedback ao usuário. */
export function useAutomationActions() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const invalidate = (id?: string) => {
    qc.invalidateQueries({ queryKey: ["automations"] });
    qc.invalidateQueries({ queryKey: ["keywords"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (id) qc.invalidateQueries({ queryKey: ["automation", id] });
    refresh();
  };

  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.code === "invalid_flow") {
      const errors = (err.data.errors as { message: string }[]) ?? [];
      toast.error("A automação tem itens a corrigir antes de publicar", { description: errors.slice(0, 3).map((e) => `• ${e.message}`).join("\n") });
    } else toast.error(errorMessage(err));
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" | "archived" | "draft" }) =>
      api.post<{ automation: AutomationFull }>(`/automations/${id}/status`, { status }),
    onSuccess: (data, vars) => {
      invalidate(vars.id);
      const msg = { active: "Automação ativada", paused: "Automação pausada", archived: "Automação arquivada", draft: "Automação movida para rascunho" }[vars.status];
      toast.success(msg, { description: vars.status === "active" ? "Ela já responde às novas mensagens." : undefined });
      return data;
    },
    onError,
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post<{ automation: AutomationFull }>(`/automations/${id}/publish`),
    onSuccess: (_d, id) => {
      invalidate(id);
      toast.success("Automação publicada!", { description: "Ela já está ativa e responde às novas mensagens." });
    },
    onError,
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ automation: AutomationFull }>(`/automations/${id}/duplicate`),
    onSuccess: (data) => {
      invalidate();
      toast.success("Automação duplicada como rascunho");
      navigate(`/app/automacoes/${data.automation.id}`);
    },
    onError,
  });

  const remove = async (id: string, name: string, after?: () => void) => {
    const ok = await confirm({
      title: "Excluir automação?",
      description: (
        <>
          <strong>{name}</strong> será excluída e deixará de responder imediatamente. O histórico de execuções continua nos logs.
        </>
      ),
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/automations/${id}`);
      invalidate();
      toast.success("Automação excluída");
      after?.();
    } catch (err) {
      onError(err);
    }
  };

  return { setStatus, publish, duplicate, remove, invalidate, onError };
}
