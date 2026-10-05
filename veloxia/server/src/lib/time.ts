/** Utilitários de data com fuso horário IANA (padrão America/Sao_Paulo). */

export const DEFAULT_TZ = "America/Sao_Paulo";

/** Data local (YYYY-MM-DD) no fuso informado. */
export function localDay(date: Date, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Período mensal (YYYY-MM) no fuso informado, usado nos contadores de uso. */
export function monthPeriod(date: Date, timeZone = DEFAULT_TZ): string {
  return localDay(date, timeZone).slice(0, 7);
}

/** Hora/minuto e dia da semana locais. */
export function localClock(date: Date, timeZone = DEFAULT_TZ): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { minutes: hour * 60 + minute, weekday };
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
