/**
 * Visual building blocks for the SEO screens: big numbers on coloured tiles, tinted change badges, gradient trend
 * charts with a value on hover, a gauge, a ring and distribution bars. A chart never carries a figure alone: every
 * number is also written out (the charts are aria-hidden), and nothing here makes up a value — an absent figure is "—".
 */
import { useId, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Two colours, the same on every screen (owner, 10/8: "blue wording, orange graphs"): blue for words — labels, links,
 * headings — and orange for every chart and bar. Green and red only ever mean better / worse (a change, a score).
 */
export const BLUE = "#1a73e8", ORANGE = "#f57c00";
export const PALETTE = {
  authority: ORANGE, domains: ORANGE, backlinks: ORANGE, traffic: ORANGE, keywords: ORANGE, health: ORANGE, tracked: ORANGE,
  top3: "#e65100", top10: "#ffb74d", rest: "#e3e5e8",
} as const;

export const compact = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 10_000 ? `${(n / 1000).toFixed(1)}K` : Math.round(n).toLocaleString("en-US");

/** A colour for a 0-100 score: green from 90, amber from 70, red below. */
export const scoreColor = (v: number) => (v >= 90 ? "#1e8e3e" : v >= 70 ? "#f29900" : "#d93025");

/** A change as a tinted badge: "+580" / "−24". Up is good unless `upIsBad`. Nothing when there is no change to show. */
export function DeltaBadge({ value, label, upIsBad = false, suffix = "" }: { value: number | null | undefined; label: string; upIsBad?: boolean; suffix?: string }) {
  if (value == null || !Number.isFinite(value) || Math.round(value) === 0) return null;
  const good = upIsBad ? value < 0 : value > 0;
  return (
    <span className="ml-1.5 inline-block whitespace-nowrap align-baseline text-[14px] font-medium tabular-nums" style={{ color: good ? "var(--g-green)" : "var(--g-red)" }} aria-label={label}>
      {value > 0 ? "+" : "−"}{compact(Math.abs(value))}{suffix}
    </span>
  );
}

/** A trend as a filled area with a soft gradient, and the value under the pointer. `points` oldest first. */
export function GradientSpark({ points, color, height = 56, format = compact, range = false }: { points: { label: string; value: number }[] | undefined; color: string; height?: number; format?: (n: number) => string; /** The highest and lowest value beside the chart. */ range?: boolean }) {
  const id = useId().replace(/:/g, "");
  if (!points || points.length < 2) return <div style={{ height }} aria-hidden />;
  const vals = points.map((p) => p.value), hi = Math.max(...vals), lo = Math.min(...vals);
  return (
    <div className="flex items-stretch gap-1.5" style={{ height }} aria-hidden>
    <div className="min-w-0 flex-1">
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip cursor={{ stroke: color, strokeOpacity: 0.3 }} contentStyle={TOOLTIP} labelStyle={{ color: "var(--g-text-2)" }} formatter={(v: number) => [format(v), ""]} separator="" labelFormatter={(_, p) => (p?.[0]?.payload?.label as string) ?? ""} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#g${id})`} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    {range && <div className="flex shrink-0 flex-col justify-between text-right text-[11px] tabular-nums" style={{ color: "var(--g-text-2)" }}><span>{format(hi)}</span><span>{format(lo)}</span></div>}
    </div>
  );
}
export const TOOLTIP = { background: "var(--g-surface)", border: "1px solid var(--g-divider)", borderRadius: 8, fontSize: 12, padding: "4px 8px" } as const;

/**
 * A figure on a tile: a coloured accent, the label, a big number with its change, an optional chart and a footnote.
 * `value` is text the screen reader reads as it is.
 */
export function StatTile({ label, value, delta, color, chart, foot, side, testId, children }: {
  label: string; value: ReactNode; delta?: ReactNode; color: string; chart?: ReactNode; foot?: ReactNode; side?: ReactNode; testId?: string; children?: ReactNode;
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId} data-color={color}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium" style={{ color: "var(--g-blue)" }}>{label}</div>
          <div className="g-text mt-0.5 text-[26px] leading-8 tabular-nums sm:text-[30px] sm:leading-9">{value}{delta}</div>
        </div>
        {side}
      </div>
      {chart && <div className="mt-2">{chart}</div>}
      {children}
      {foot && <div className="g-text-2 mt-1.5 text-[12px] leading-4">{foot}</div>}
    </div>
  );
}

/**
 * One figure as a column of a site's row (as Ahrefs lays its projects out): the label, the number with its change in
 * plain green / red, a footnote, and its trend with the highest and lowest value beside it.
 */
export function MetricColumn({ label, value, delta, foot, chart, children, testId }: { label: string; value: ReactNode; delta?: ReactNode; foot?: ReactNode; chart?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      <div className="text-[13px] font-medium" style={{ color: "var(--g-blue)" }}>{label}</div>
      <div className="g-text mt-0.5 text-[28px] leading-9 tabular-nums">{value}{delta}</div>
      {foot && <div className="g-text-2 text-[12px] leading-4">{foot}</div>}
      {children}
      {chart && <div className="mt-auto pt-2">{chart}</div>}
    </div>
  );
}

/** A 0-100 score as a coloured badge (green from 90, amber from 70, red below): the one place a score is coloured. */
export function ScoreBadge({ value, label }: { value: number | null; label?: string }) {
  if (value == null) return <span className="g-text text-[28px] leading-9">—</span>;
  return <span className="inline-grid h-10 min-w-[3rem] place-items-center rounded-full px-3 text-[22px] font-medium tabular-nums text-white" style={{ background: scoreColor(value) }} aria-label={label ?? `${value} out of 100`}>{value}</span>;
}

/** A 0-100 score as a half-circle gauge (decoration: the number is written next to it). */
export function Gauge({ value, color, size = 64 }: { value: number | null; color: string; size?: number }) {
  const r = 26, len = Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg viewBox="0 0 64 36" width={size} height={(size * 36) / 64} aria-hidden className="shrink-0">
      <path d="M6 32 A26 26 0 0 1 58 32" fill="none" stroke="var(--g-divider)" strokeWidth="7" strokeLinecap="round" />
      {value != null && <path d="M6 32 A26 26 0 0 1 58 32" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(v / 100) * len} ${len}`} />}
    </svg>
  );
}

/** A 0-100 score as a ring with the number inside. */
export function Ring({ value, size = 64, label }: { value: number | null; size?: number; label?: string }) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0)), color = value == null ? "var(--g-divider)" : scoreColor(v);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={label ?? (value == null ? "No score" : `${value} out of 100`)} className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--g-divider)" strokeWidth="7" />
      {value != null && <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 32 32)" />}
      <text x="32" y="33" textAnchor="middle" dominantBaseline="middle" fontSize="17" fontWeight="600" fill="var(--g-text)">{value ?? "—"}</text>
    </svg>
  );
}

/** Parts of a whole as one stacked bar with a legend underneath (the legend carries the numbers). */
export function DistributionBar({ parts, testId }: { parts: { label: string; value: number; color: string }[]; testId?: string }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  return (
    <div data-testid={testId}>
      <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
        {total > 0 && parts.map((p) => p.value > 0 && <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {parts.map((p) => (
          <li key={p.label} className="g-text-2 inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />{p.label} <b className="g-text font-medium tabular-nums">{compact(p.value)}</b></li>
        ))}
      </ul>
    </div>
  );
}

/** A large trend chart with a switch between figures (each a series of labelled points, oldest first). */
export function TrendPanel({ series, title, note, testId }: { series: { key: string; label: string; color: string; points: { label: string; value: number }[] }[]; title: string; note?: ReactNode; testId?: string }) {
  const usable = series.filter((s) => s.points.length >= 2);
  const [key, setKey] = useState(usable[0]?.key ?? "");
  const id = useId().replace(/:/g, "");
  const s = usable.find((x) => x.key === key) ?? usable[0];
  if (!s) return null;
  const first = s.points[0].value, last = s.points[s.points.length - 1].value;
  return (
    <div className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>{title}</h3>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Figure shown">
          {usable.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.key === s.key} onClick={() => setKey(x.key)} className="rounded-md border px-2.5 py-0.5 text-[12px] transition-colors"
              style={x.key === s.key ? { borderColor: "var(--g-blue)", color: "var(--g-blue)", background: "var(--g-accent-soft)" } : { borderColor: "var(--g-divider)", color: "var(--g-text-2)" }} data-testid={`${testId ?? "trend"}-${x.key}`}>{x.label}</button>
          ))}
        </div>
      </div>
      <p className="g-text-2 mb-1 text-[12px]">{s.label}: {compact(first)} in {s.points[0].label} → <b className="g-text font-medium">{compact(last)}</b> in {s.points[s.points.length - 1].label}</p>
      <div className="h-44 sm:h-56" aria-hidden>
        <ResponsiveContainer>
          <AreaChart data={s.points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`t${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v: number) => [compact(v), s.label]} />
            <Area type="monotone" dataKey="value" stroke={s.color} strokeWidth={2.5} fill={`url(#t${id})`} isAnimationActive={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {note && <p className="g-text-2 mt-1 text-[11px]">{note}</p>}
    </div>
  );
}

/** "2026-03" → "Mar 2026"; anything else as it is. */
export const monthLabel = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : m);

/**
 * Where a keyword ranks, as a compact badge — the same on every SEO screen: dark orange in the top 3, light orange to
 * 10, plain below that. An absent position is "—".
 */
export function PositionBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="g-text-2">—</span>;
  const style = value <= 3 ? { background: PALETTE.top3, color: "#fff" } : value <= 10 ? { background: PALETTE.top10, color: "#202124" } : { background: "var(--g-chip)", color: "var(--g-text)" };
  return <span className="inline-grid h-6 min-w-[2rem] place-items-center rounded-md px-1.5 text-[12px] font-medium tabular-nums" style={style}>{value}</span>;
}

/** Keyword difficulty 0–100 in words (the bands shell.tsx `kd()` uses): under 30 easy, under 60 medium, else hard. */
export const kdWord = (n: number) => (n < 30 ? "easy" : n < 60 ? "medium" : "hard");

/**
 * Keyword difficulty as a tinted badge — the same on every SEO screen: green when easy, amber when medium, red when
 * hard, with the number and the word, so the colour is never the only signal.
 */
export function DifficultyBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="g-text-2">—</span>;
  const color = value < 30 ? "var(--g-green)" : value < 60 ? "#f29900" : "var(--g-red)";
  return <span className="inline-flex h-6 items-center whitespace-nowrap rounded-md px-1.5 text-[12px] font-medium tabular-nums" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>{value} {kdWord(value)}</span>;
}
