import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";
import { toast } from "sonner";
import { Badge, Button, Card, CardTitle, EmptyState, PageHeader, Select, Skeleton, Tabs } from "../../components/ui";
import { StatCard } from "../../components/StatCard";
import { useMe } from "../../hooks/useAuth";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime, formatNumber, relativeTime } from "../../lib/format";

type Tab = "erros" | "fila" | "webhooks" | "clientes" | "contas";

function Json({ value }: { value: unknown }) {
  return <pre className="scrollbar-thin max-h-64 overflow-auto rounded-lg bg-ink-950 p-3 text-[11px] leading-relaxed text-zinc-200">{JSON.stringify(value, null, 2)}</pre>;
}

function Errors() {
  const { data, isLoading } = useQuery({ queryKey: ["admin", "errors"], queryFn: () => api.get<{ errors: { id: string; context: string; message: string; details: unknown; createdAt: string; workspaceId: string | null }[] }>("/admin/errors") });
  if (isLoading) return <Skeleton className="h-64" />;
  if (!data?.errors.length) return <EmptyState title="Nenhum erro registrado" />;
  return (
    <div className="space-y-2">
      {data.errors.map((e) => (
        <details key={e.id} className="card p-3">
          <summary className="cursor-pointer text-sm">
            <Badge tone="red">{e.context}</Badge> <span className="font-medium">{e.message}</span>
            <span className="ml-2 text-xs text-zinc-400">{formatDateTime(e.createdAt)}</span>
          </summary>
          <div className="mt-3">
            <Json value={{ workspaceId: e.workspaceId, ...(e.details as object) }} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Jobs() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("dead");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "jobs", status], queryFn: () => api.get<{ jobs: { id: number; type: string; status: string; attempts: number; lastError: string | null; runAt: string; payload: unknown; updatedAt: string }[] }>(`/admin/jobs?status=${status}`) });
  const retry = async (id: number) => {
    try {
      await api.post(`/admin/jobs/${id}/retry`);
      toast.success("Job reenfileirado");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48">
        {["dead", "failed", "pending", "running", "done"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.jobs.length ? (
        <EmptyState title="Nenhum job com esse status" />
      ) : (
        data.jobs.map((j) => (
          <Card key={j.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{j.type}</Badge>
              <span className="text-zinc-500">#{j.id} · {j.attempts} tentativa(s) · {relativeTime(j.updatedAt)}</span>
              {(j.status === "dead" || j.status === "failed") && (
                <Button size="xs" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={() => retry(j.id)} className="ml-auto">
                  Reprocessar
                </Button>
              )}
            </div>
            {j.lastError && <p className="text-sm text-red-700">{j.lastError}</p>}
            <Json value={j.payload} />
          </Card>
        ))
      )}
    </div>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("failed");
  const { data, isLoading } = useQuery({ queryKey: ["admin", "webhooks", status], queryFn: () => api.get<{ events: { id: string; object: string; status: string; attempts: number; error: string | null; receivedAt: string; payload: unknown }[] }>(`/admin/webhooks${status ? `?status=${status}` : ""}`) });
  const reprocess = async (id: string) => {
    try {
      await api.post(`/admin/webhooks/${id}/reprocess`);
      toast.success("Evento reenfileirado");
      qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="space-y-3">
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-48">
        <option value="">todos</option>
        {["failed", "pending", "processed", "ignored"].map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.events.length ? (
        <EmptyState title="Nenhum evento" />
      ) : (
        data.events.map((e) => (
          <details key={e.id} className="card p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <Badge tone={e.status === "failed" ? "red" : e.status === "processed" ? "green" : "gray"}>{e.status}</Badge>
              <span>{formatDateTime(e.receivedAt)}</span>
              <span className="text-zinc-400">{e.attempts} tentativa(s)</span>
              {e.error && <span className="text-red-700">{e.error}</span>}
              <Button size="xs" variant="secondary" className="ml-auto" onClick={(ev) => { ev.preventDefault(); reprocess(e.id); }}>
                Reprocessar
              </Button>
            </summary>
            <div className="mt-3">
              <Json value={e.payload} />
            </div>
          </details>
        ))
      )}
    </div>
  );
}

function Customers() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "workspaces"], queryFn: () => api.get<{ workspaces: { id: string; name: string; ownerEmail: string; planId: string | null; status: string | null; accounts: number; createdAt: string }[]; plans: { id: string; name: string }[] }>("/admin/workspaces") });
  const setPlan = async (id: string, planId: string) => {
    try {
      await api.post(`/admin/workspaces/${id}/plan`, { planId });
      toast.success("Plano alterado");
      qc.invalidateQueries({ queryKey: ["admin", "workspaces"] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  if (isLoading) return <Skeleton className="h-64" />;
  return (
    <Card padded={false} className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500 uppercase">
          <tr>
            <th className="px-4 py-3">Espaço</th>
            <th className="px-4 py-3">Dono</th>
            <th className="px-4 py-3">Contas IG</th>
            <th className="px-4 py-3">Criado</th>
            <th className="px-4 py-3">Plano</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {data?.workspaces.map((w) => (
            <tr key={w.id}>
              <td className="px-4 py-2.5 font-medium">{w.name}</td>
              <td className="px-4 py-2.5">{w.ownerEmail}</td>
              <td className="px-4 py-2.5">{w.accounts}</td>
              <td className="px-4 py-2.5">{relativeTime(w.createdAt)}</td>
              <td className="px-4 py-2.5">
                <Select value={w.planId ?? ""} onChange={(e) => setPlan(w.id, e.target.value)} className="h-8 max-w-40">
                  {data.plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Accounts() {
  const { data, isLoading } = useQuery({ queryKey: ["admin", "accounts"], queryFn: () => api.get<{ accounts: { id: string; username: string; status: string; webhookError: string | null; lastError: string | null; lastWebhookAt: string | null; tokenExpiresAt: string | null }[] }>("/admin/instagram-accounts") });
  if (isLoading) return <Skeleton className="h-64" />;
  return (
    <Card padded={false} className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500 uppercase">
          <tr>
            <th className="px-4 py-3">Conta</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Último webhook</th>
            <th className="px-4 py-3">Token até</th>
            <th className="px-4 py-3">Erro</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {data?.accounts.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-2.5 font-medium">@{a.username}</td>
              <td className="px-4 py-2.5">
                <Badge tone={a.status === "connected" ? "green" : "red"}>{a.status}</Badge>
              </td>
              <td className="px-4 py-2.5">{a.lastWebhookAt ? relativeTime(a.lastWebhookAt) : "—"}</td>
              <td className="px-4 py-2.5">{a.tokenExpiresAt ? formatDateTime(a.tokenExpiresAt) : "—"}</td>
              <td className="px-4 py-2.5 text-red-700">{a.webhookError ?? a.lastError ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("erros");
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<{ users: number; workspaces: number; instagramAccounts: number; errors24h: number; jobs: { status: string; n: number }[]; webhooks24h: { status: string; n: number }[] }>("/admin/overview"),
    enabled: me.user.role === "admin",
  });
  if (me.user.role !== "admin") return <Navigate to="/app" replace />;
  const o = overview.data;
  const dead = o?.jobs.find((j) => j.status === "dead")?.n ?? 0;
  const failedWebhooks = o?.webhooks24h.find((w) => w.status === "failed")?.n ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader title="Administração" description="Detalhes técnicos: erros, fila de processamento, webhooks e clientes." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Usuários" value={formatNumber(o?.users)} loading={overview.isLoading} />
        <StatCard label="Espaços" value={formatNumber(o?.workspaces)} loading={overview.isLoading} />
        <StatCard label="Contas IG ativas" value={formatNumber(o?.instagramAccounts)} loading={overview.isLoading} />
        <StatCard label="Erros (24h)" value={formatNumber(o?.errors24h)} loading={overview.isLoading} />
        <StatCard label="Jobs mortos / webhooks falhos" value={`${formatNumber(dead)} / ${formatNumber(failedWebhooks)}`} loading={overview.isLoading} />
      </div>
      <Card>
        <CardTitle title="Detalhes" />
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-4"
          items={[
            { value: "erros", label: "Erros" },
            { value: "fila", label: "Fila" },
            { value: "webhooks", label: "Webhooks" },
            { value: "clientes", label: "Clientes" },
            { value: "contas", label: "Contas IG" },
          ]}
        />
        {tab === "erros" && <Errors />}
        {tab === "fila" && <Jobs />}
        {tab === "webhooks" && <Webhooks />}
        {tab === "clientes" && <Customers />}
        {tab === "contas" && <Accounts />}
      </Card>
    </div>
  );
}
