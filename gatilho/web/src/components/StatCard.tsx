import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { delta } from "../lib/format";
import { Card, Skeleton, Tooltip } from "./ui";

export function StatCard({
  label,
  value,
  icon,
  current,
  previous,
  hint,
  loading,
  info,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  current?: number;
  previous?: number;
  hint?: ReactNode;
  loading?: boolean;
  info?: string;
}) {
  const d = current !== undefined && previous !== undefined ? delta(current, previous) : null;
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {info ? (
          <Tooltip content={info}>
            <p className="cursor-help text-sm text-zinc-500 underline decoration-zinc-300 decoration-dotted underline-offset-4">{label}</p>
          </Tooltip>
        ) : (
          <p className="text-sm text-zinc-500">{label}</p>
        )}
        {icon && <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-50 text-zinc-500 [&>svg]:size-4">{icon}</span>}
      </div>
      {loading ? <Skeleton className="h-8 w-20" /> : <p className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</p>}
      <div className="flex min-h-5 items-center gap-2 text-xs">
        {d && d.pct !== null && (current ?? 0) + (previous ?? 0) > 0 && (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", d.up ? "text-emerald-600" : "text-red-600")}>
            {d.up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {d.pct > 0 ? "+" : ""}
            {d.pct}%
          </span>
        )}
        {hint && <span className="text-zinc-400">{hint}</span>}
      </div>
    </Card>
  );
}
