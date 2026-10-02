/**
 * Formatting for the signed-in dashboard (docs/dashboard/SPEC.md §4.1).
 * A null value is "unknown / not measured yet" and always prints "—": the
 * dashboard never fills a gap with a guess.
 */
import { formatUsd } from "@shared/plan-copy";
import type { DashboardMetric, DashboardSurface, DashboardUsage } from "@shared/dashboard";

export const DASH = "—";

const nf = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return nf.format(n);
}

/** The big number of a metric, as text. */
export function formatMetricValue(metric: Pick<DashboardMetric, "value" | "format">, now: Date = new Date()): string {
  const { value, format } = metric;
  if (value === null || value === undefined || value === "") return DASH;
  if (typeof value === "string") {
    if (format === "datetime") return relativeTime(value, now);
    return value;
  }
  if (!Number.isFinite(value)) return DASH;
  switch (format) {
    case "cents": return formatUsd(Math.round(value / 100) * 100);
    case "rating": return value.toFixed(1);
    case "score": return String(Math.round(value));
    case "count": return formatCount(value);
    case "datetime": return relativeTime(new Date(value).toISOString(), now);
    default: return String(value);
  }
}

/** "3 of 15", "3 · Unlimited". */
export function formatLimit(used: number | null, limit: number): string {
  const u = used === null ? DASH : formatCount(used);
  return limit < 0 ? `${u} · Unlimited` : `${u} of ${formatCount(limit)}`;
}

/** 0–100, or null when there is no bar to draw (unlimited or unknown). */
export function percentOf(used: number | null, limit: number | undefined): number | null {
  if (used === null || limit === undefined || limit <= 0) return null;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

export type Tone = "default" | "good" | "warn" | "bad";

/** A meter warns at 80 % and is "bad" when full. */
export function meterTone(used: number, limit: number): Tone {
  if (limit <= 0) return "default";
  const pct = used / limit;
  if (pct >= 1) return "bad";
  if (pct >= 0.8) return "warn";
  return "default";
}

/** Text colour for a tone (600 light / 400 dark). The label always carries the meaning too. */
export function toneText(tone: Tone | undefined): string {
  switch (tone) {
    case "good": return "text-emerald-600 dark:text-emerald-400";
    case "warn": return "text-amber-600 dark:text-amber-400";
    case "bad": return "text-red-600 dark:text-red-400";
    default: return "text-foreground";
  }
}

/** Indicator colour for a shadcn Progress (its child div). */
export function toneBar(tone: Tone | undefined): string {
  switch (tone) {
    case "good": return "[&>div]:bg-emerald-600 dark:[&>div]:bg-emerald-400";
    case "warn": return "[&>div]:bg-amber-500 dark:[&>div]:bg-amber-400";
    case "bad": return "[&>div]:bg-red-600 dark:[&>div]:bg-red-400";
    default: return "[&>div]:bg-primary";
  }
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 hours ago", "2 days ago", "in 1 day", or "Oct 19" past a month. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return DASH;
  const diff = now.getTime() - t;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const say = (n: number, unit: string) => {
    const s = `${n} ${unit}${n === 1 ? "" : "s"}`;
    return future ? `in ${s}` : `${s} ago`;
  };
  if (abs < MIN) return future ? "in a moment" : "just now";
  if (abs < HOUR) { const n = Math.floor(abs / MIN); return future ? `in ${n} min` : `${n} min ago`; }
  if (abs < DAY) return say(Math.floor(abs / HOUR), "hour");
  if (abs < 30 * DAY) return say(Math.floor(abs / DAY), "day");
  return shortDate(iso);
}

/**
 * "Oct 19" (adds the year when it isn't this year). `utc` reads the date on
 * the UTC calendar: the monthly counts reset at 00:00 UTC on the 1st, which
 * is still the 31st on an American clock.
 */
export function shortDate(iso: string, now: Date = new Date(), utc = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const sameYear = utc ? d.getUTCFullYear() === now.getUTCFullYear() : d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), ...(utc ? { timeZone: "UTC" } : {}),
  });
}

/** "Good morning" by the viewer's own clock. */
export function greetingFor(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * A usage meter's link target. The contract's usage rows carry an optional
 * `surface`; before the server sends it, a "/crm/…" path can only be a CRM
 * (portal) page — the growth app has no "/crm/" routes.
 */
export function usageSurface(u: DashboardUsage): DashboardSurface {
  return u.surface ?? (u.href.startsWith("/crm/") || u.href === "/crm" ? "portal" : "app");
}
