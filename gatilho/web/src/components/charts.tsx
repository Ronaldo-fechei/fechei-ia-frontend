import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDayLabel, formatNumber } from "../lib/format";

export interface Series {
  key: string;
  label: string;
  color: string;
}

function ChartTooltip({ active, payload, label, series, labelFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-medium text-zinc-700">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p: any) => {
        const s = series.find((x: Series) => x.key === p.dataKey);
        return (
          <p key={p.dataKey} className="flex items-center gap-2 text-zinc-600">
            <span className="size-2 rounded-full" style={{ backgroundColor: s?.color }} />
            {s?.label}: <strong className="text-zinc-900">{formatNumber(p.value)}</strong>
          </p>
        );
      })}
    </div>
  );
}

export function TrendChart({ data, series, height = 240, xKey = "day" }: { data: Record<string, any>[]; series: Series[]; height?: number; xKey?: string }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="#f1f1f4" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={xKey === "day" ? formatDayLabel : undefined} tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTooltip series={series} labelFormatter={xKey === "day" ? formatDayLabel : undefined} />} />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#g-${s.key})`} animationDuration={500} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, xKey, yKey, label, color = "#ef5a2f", height = 200, xFormatter }: { data: Record<string, any>[]; xKey: string; yKey: string; label: string; color?: string; height?: number; xFormatter?: (v: any) => string }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#f1f1f4" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={xFormatter} tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTooltip series={[{ key: yKey, label, color }]} labelFormatter={xFormatter} />} cursor={{ fill: "#fafafa" }} />
          <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} animationDuration={500} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Lista com barras proporcionais (rankings). */
export function BarList({ items, emptyText = "Sem dados no período." }: { items: { label: string; value: number; hint?: string }[]; emptyText?: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-zinc-500">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-zinc-800">{item.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-600">{formatNumber(item.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
          {item.hint && <p className="mt-0.5 text-xs text-zinc-400">{item.hint}</p>}
        </li>
      ))}
    </ul>
  );
}
