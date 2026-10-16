/**
 * Pieces IP Tracker and VPN Shield share (pages/ip-tracker.tsx, pages/vpn-shield.tsx): the date-range and
 * "seen within" pickers (presets plus a typed value — owner's program 2026-10-15, rule 6), the three-step
 * "How this works" card over a bare form (rule 3), the dense table primitives and the small formatters.
 */
import { useState, type ReactNode } from "react";
import { Monitor, Smartphone, Tablet, Globe, Chrome, Compass, Laptop, type LucideIcon } from "lucide-react";
import { GooglePill } from "@/components/google";
import { cn } from "@/lib/utils";

/* ── Formatters ─────────────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const daysAgo = (now: Date, n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
export const shortDay = (key: string) => new Date(`${key}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function formatTimeAgo(dateStr: string, now = Date.now()) {
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function DeviceIcon({ type }: { type: string | null }) {
  if (type === "mobile") return <Smartphone className="h-3.5 w-3.5" />;
  if (type === "tablet") return <Tablet className="h-3.5 w-3.5" />;
  return <Monitor className="h-3.5 w-3.5" />;
}

/** Chrome has its own icon; Safari gets the compass its logo is; every other browser a neutral globe. */
export function browserIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("chrome") || n.includes("chromium")) return Chrome;
  if (n.includes("safari")) return Compass;
  return Globe;
}

/** Phones for iOS/Android, a tablet for iPadOS, a laptop for desktop systems, a globe when unknown. */
export function osIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n.includes("ipad")) return Tablet;
  if (n === "ios" || n.includes("iphone") || n.includes("android")) return Smartphone;
  if (/windows|mac|linux|chrome ?os|ubuntu|fedora/.test(n)) return Laptop;
  return Globe;
}

export function deviceIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (n === "mobile") return Smartphone;
  if (n === "tablet") return Tablet;
  if (n === "desktop") return Monitor;
  return Globe;
}

/* ── Date range: presets + a typed pair of dates ────────────────────────────── */

export type RangePreset = "7d" | "30d" | "month" | "all" | "custom";
export type DateRange = { preset: RangePreset; from: string; to: string };
export const ALL_TIME: DateRange = { preset: "all", from: "", to: "" };
const PRESETS: [RangePreset, string][] = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["all", "All time"]];
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00`).getTime());

/** The range's start and end (local midnight to the end of the last day), and the words the page says. */
export function rangeBounds(r: DateRange, now = new Date()): { start?: Date; end?: Date; label: string } {
  if (r.preset === "7d") return { start: daysAgo(now, 6), label: "Last 7 days" };
  if (r.preset === "30d") return { start: daysAgo(now, 29), label: "Last 30 days" };
  if (r.preset === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), label: "This month" };
  if (r.preset === "custom") {
    const start = isDay(r.from) ? new Date(`${r.from}T00:00`) : undefined;
    const end = isDay(r.to) ? new Date(new Date(`${r.to}T00:00`).getTime() + 86_400_000 - 1) : undefined;
    const label = start && end ? `${shortDay(r.from)} – ${shortDay(r.to)}` : start ? `Since ${shortDay(r.from)}` : end ? `Up to ${shortDay(r.to)}` : "All time";
    return { start, end, label };
  }
  return { label: "All time" };
}

/** The `?start=&end=` part of a visit request for the range (nothing for all time). */
export function rangeQuery(r: DateRange): string {
  const { start, end } = rangeBounds(r);
  const q = new URLSearchParams();
  if (start) q.set("start", start.toISOString());
  if (end) q.set("end", end.toISOString());
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The range's key for a query cache: a preset name, or the two typed dates. */
export const rangeKey = (r: DateRange) => (r.preset === "custom" ? `custom:${r.from}:${r.to}` : r.preset);

/** Is this visit inside the range (client-side lists that come whole from the server). */
export function inRange(r: DateRange, at: string, now = new Date()): boolean {
  const { start, end } = rangeBounds(r, now);
  const t = new Date(at).getTime();
  return (!start || t >= start.getTime()) && (!end || t <= end.getTime());
}

/**
 * Preset pills plus two date boxes. Typing a date is the custom range; a preset clears the boxes.
 * Every preset-only filter on these pages takes a typed value as well (owner's program, rule 6).
 */
export function RangePicker({ value, onChange, presets = PRESETS, testId = "range" }: { value: DateRange; onChange: (r: DateRange) => void; presets?: [RangePreset, string][]; testId?: string }) {
  const setDay = (k: "from" | "to", v: string) => onChange({ preset: "custom", from: k === "from" ? v : value.from, to: k === "to" ? v : value.to });
  const today = localDayKey(new Date());
  // A typed pair the inputs' min/max could not stop (keyboard entry): said in words, and announced.
  const error = rangeError(value, today);
  const errorId = `${testId}-error`;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range" data-testid={`${testId}-picker`}>
      {presets.map(([p, label]) => (
        <GooglePill key={p} size="sm" label={label} selected={value.preset === p} ariaPressed={value.preset === p} onClick={() => onChange({ preset: p, from: "", to: "" })} testId={`${testId}-${p}`} />
      ))}
      <label className="flex items-center gap-1 text-[13px] g-text-2">From
        <input type="date" className="g-input !min-h-8 !w-auto !px-2 text-[13px]" value={value.from} max={value.to || today} onChange={(e) => setDay("from", e.target.value)} aria-label="Range start date" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} data-testid={`${testId}-from`} />
      </label>
      <label className="flex items-center gap-1 text-[13px] g-text-2">To
        <input type="date" className="g-input !min-h-8 !w-auto !px-2 text-[13px]" value={value.to} min={value.from || undefined} max={today} onChange={(e) => setDay("to", e.target.value)} aria-label="Range end date" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} data-testid={`${testId}-to`} />
      </label>
      {error && <p id={errorId} role="alert" className="basis-full text-[13px]" style={{ color: "var(--g-red)" }} data-testid={errorId}>{error}</p>}
    </div>
  );
}

/** Why a typed custom range cannot be used, in words — null when it can. */
export function rangeError(value: DateRange, today = localDayKey(new Date())): string | null {
  if (value.from && value.to && value.from > value.to) return "The start date is after the end date.";
  if ((value.from && value.from > today) || (value.to && value.to > today)) return "The range cannot go past today.";
  return null;
}

/* ── "Seen within": minutes presets + a typed number ────────────────────────── */

const WINDOWS: [number, string][] = [[20, "Online now (20 min)"], [60, "Last hour"], [1440, "Last 24 hours"], [0, "Any time"]];

/** `minutes` 0 = no limit. */
export function WindowPicker({ minutes, onChange, testId = "window" }: { minutes: number; onChange: (m: number) => void; testId?: string }) {
  const [typed, setTyped] = useState("");
  const apply = (v: string) => { setTyped(v); const n = Number(v); if (v.trim() !== "" && Number.isFinite(n) && n > 0) onChange(Math.floor(n)); };
  const preset = WINDOWS.some(([m]) => m === minutes);
  // Something typed that is not a number of minutes above 0 changes nothing — said so, and announced.
  const error = windowError(typed);
  const errorId = `${testId}-error`;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Seen within" data-testid={`${testId}-picker`}>
      <span className="text-[13px] g-text-2">Seen within</span>
      {WINDOWS.map(([m, label]) => (
        <GooglePill key={m} size="sm" label={label} selected={minutes === m} ariaPressed={minutes === m} onClick={() => { setTyped(""); onChange(m); }} testId={`${testId}-${m}`} />
      ))}
      <label className="flex items-center gap-1 text-[13px] g-text-2">
        <input type="number" inputMode="numeric" min={1} step={1} placeholder="minutes" className="g-input !min-h-8 !w-24 !px-2 text-[13px]" value={preset ? typed : typed || String(minutes)} onChange={(e) => apply(e.target.value)} aria-label="Seen within this many minutes" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} data-testid={`${testId}-minutes`} />
        minutes
      </label>
      {error && <p id={errorId} role="alert" className="basis-full text-[13px]" style={{ color: "var(--g-red)" }} data-testid={errorId}>{error}</p>}
    </div>
  );
}

/** Why a typed "seen within" value is not used, in words — null for an empty box or a whole number of minutes above 0. */
export function windowError(typed: string): string | null {
  if (typed.trim() === "") return null;
  const n = Number(typed);
  return Number.isFinite(n) && n > 0 ? null : "Enter a number of minutes above 0.";
}

/* ── "How this works" over a bare form (≤ 3 steps) ─────────────────────────── */

export function StepsCard({ title = "How this works", steps, testId }: { title?: string; steps: ReactNode[]; testId?: string }) {
  return (
    <div className="g-callout" data-testid={testId}>
      <h3>{title}</h3>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        {steps.slice(0, 3).map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[14px] leading-5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[12px] font-medium" style={{ background: "var(--g-accent-soft)", color: "var(--g-accent-ink)" }} aria-hidden="true">{i + 1}</span>
            <span className="g-text">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ── Table primitives (phone: stacked rows · desktop: a table) ───────────────── */

export const TH = "px-3 py-2 sm:px-4 sm:py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap";
export const TR = "border-t transition-colors hover:bg-muted/40 flex flex-col gap-1.5 px-3.5 py-3 sm:table-row sm:px-0 sm:py-0";
export const TD = "block p-0 sm:table-cell sm:px-4 sm:py-3 sm:align-middle";

export function PercentBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("w-full bg-muted rounded-full h-2", className)}>
      <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

/** A labelled list of counts with a share bar each, sorted by count (browsers, systems, devices, providers). */
export function BreakdownList({ data, iconFor, emptyText = "No data", testId }: { data: Record<string, number>; iconFor?: (name: string) => LucideIcon; emptyText?: string; testId?: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <div className="space-y-2" data-testid={testId}>
      {entries.map(([name, count]) => {
        const pct = total ? (count / total) * 100 : 0;
        const Icon = iconFor?.(name);
        return (
          <div key={name} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{name}</span>
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{count.toLocaleString()} ({pct.toFixed(1)}%)</span>
            </div>
            <PercentBar value={pct} />
          </div>
        );
      })}
    </div>
  );
}
