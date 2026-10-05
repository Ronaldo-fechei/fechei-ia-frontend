/** Formatação em português do Brasil (datas no fuso do espaço de trabalho). */

let timeZone = "America/Sao_Paulo";
export function setDisplayTimeZone(tz: string) {
  timeZone = tz;
}

const toDate = (v: string | Date | null | undefined) => (v ? (v instanceof Date ? v : new Date(v)) : null);

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatDayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(d);
}

export function relativeTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return "agora";
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  if (diff < 7 * 86400) return `há ${Math.round(diff / 86400)} d`;
  return formatDate(d);
}

/** Hora para listas de conversa: "14:32", "ontem", "12/09". */
export function shortStamp(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  const today = day(new Date());
  const yesterday = day(new Date(Date.now() - 86400_000));
  if (day(d) === today) return formatTime(d);
  if (day(d) === yesterday) return "ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(d);
}

export const formatNumber = (n: number | null | undefined) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("pt-BR").format(n));

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n)}%`;
}

export function formatMoney(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Sem intervalo";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round((seconds / 3600) * 10) / 10} h`.replace(".", ",");
  return `${Math.round((seconds / 86400) * 10) / 10} dia(s)`.replace(".", ",");
}

export function delta(current: number, previous: number): { pct: number | null; up: boolean } {
  if (!previous) return { pct: current > 0 ? null : 0, up: current >= previous };
  return { pct: Math.round(((current - previous) / previous) * 100), up: current >= previous };
}

export function initials(name?: string | null): string {
  const parts = (name ?? "").replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
