import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Logo } from "../../components/brand/Logo";
import { Callout, Card, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

/** Página de status da exclusão de dados solicitada pela Meta. */
export default function DataDeletionStatus() {
  const [params] = useSearchParams();
  const code = params.get("codigo") ?? "";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["data-deletion", code],
    queryFn: () => api.get<{ code: string; status: string; createdAt: string; completedAt: string | null }>(`/meta/data-deletion/${encodeURIComponent(code)}`),
    enabled: !!code,
    retry: false,
  });
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <Logo />
      <h1 className="mt-10 text-2xl font-semibold">Exclusão de dados</h1>
      <p className="mt-2 text-sm text-zinc-500">Acompanhe a solicitação de exclusão de dados enviada pelo Instagram/Meta.</p>
      <Card className="mt-6">
        {!code ? (
          <p className="text-sm text-zinc-600">Informe o código de confirmação recebido.</p>
        ) : isLoading ? (
          <Spinner />
        ) : isError || !data ? (
          <Callout tone="error">Código não encontrado.</Callout>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Código</dt>
              <dd className="font-mono">{data.code}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Status</dt>
              <dd className="font-medium">{data.status === "completed" ? "Concluída" : "Recebida"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Solicitada em</dt>
              <dd>{formatDateTime(data.createdAt)}</dd>
            </div>
            {data.completedAt && (
              <div className="flex justify-between">
                <dt className="text-zinc-500">Concluída em</dt>
                <dd>{formatDateTime(data.completedAt)}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>
    </div>
  );
}
