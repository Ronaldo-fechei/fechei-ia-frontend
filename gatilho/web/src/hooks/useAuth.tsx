import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api, ApiError } from "../lib/api";
import { setDisplayTimeZone } from "../lib/format";
import type { Me, SystemStatus } from "../lib/types";

interface AuthValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (query.data?.workspace.timezone) setDisplayTimeZone(query.data.workspace.timezone);
  }, [query.data?.workspace.timezone]);

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(["me"], null);
    window.addEventListener("gatilho:unauthorized", onUnauthorized);
    return () => window.removeEventListener("gatilho:unauthorized", onUnauthorized);
  }, [qc]);

  const value: AuthValue = {
    me: query.data ?? null,
    loading: query.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ["me"] }),
    logout: async () => {
      try {
        await api.post("/auth/logout");
      } finally {
        qc.clear();
        qc.setQueryData(["me"], null);
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}

export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("Usuário não autenticado");
  return me;
}

export function useSystemStatus() {
  return useQuery({ queryKey: ["system-status"], queryFn: () => api.get<SystemStatus>("/system/status"), staleTime: 5 * 60_000 });
}
