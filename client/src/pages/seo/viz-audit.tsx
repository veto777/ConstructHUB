/**
 * Building blocks only the Site audit screen needs, on top of viz.tsx: the big health ring, a severity column that is
 * also the filter button, the health-over-time chart (a crawl with no score stays a gap) and a compact table class.
 * Same rules as viz.tsx: blue for words, orange for charts, green / amber / red only for the score and for errors,
 * warnings and notices; nothing here makes up a value — an absent figure is "—".
 */
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ORANGE, scoreColor, TOOLTIP } from "./viz";

/** Amber: the one colour for warnings and the middle health band, the same as viz's score colour. */
export const AMBER = "#f29900";
/** Tighter rows for the audit tables (the shared g-table rows are roomier): same columns, less padding. */
export const COMPACT_TABLE = "g-table w-full text-[13px] [&_td]:!py-1.5 [&_th]:!py-1.5";

const healthWord = (h: number) => (h >= 90 ? "Good" : h >= 70 ? "Needs work" : "Poor");

/** The health score as a big ring with the number inside and its word under it (green from 90, amber from 70). */
export function HealthRing({ value, size = 104 }: { value: number | null; size?: number }) {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg viewBox="0 0 128 128" width={size} height={size} className="shrink-0" role="img" aria-label={value == null ? "No health score yet" : `Health score ${value} out of 100`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="var(--g-divider)" strokeWidth="9" />
      {value != null && <circle cx="64" cy="64" r={r} fill="none" stroke={scoreColor(v)} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 64 64)" />}
      <text x="64" y="60" textAnchor="middle" dominantBaseline="middle" fontSize="34" fontWeight="500" fill="var(--g-text)">{value ?? "—"}</text>
      <text x="64" y="88" textAnchor="middle" fontSize="12" fill="var(--g-text-2)">{value == null ? "no data" : healthWord(v)}</text>
    </svg>
  );
}

/**
 * One severity as a column of the overview row — and the button that filters the issues table to it. Laid out like
 * viz's MetricColumn (blue label, big number, grey footnote) with the severity's dot beside the label.
 */
export function SeverityColumn({ label, color, value, foot, pressed, onClick, testId }: { label: string; color: string; value: string; foot: string; pressed: boolean; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="-mx-2 flex min-w-0 flex-col items-start rounded-lg px-2 py-1 text-left transition-colors" style={pressed ? { background: "var(--g-accent-soft)" } : undefined}
      aria-pressed={pressed} title={pressed ? "Showing only these — click to show every issue" : `Show only ${label.toLowerCase()}`} onClick={onClick} data-testid={testId}>
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--g-blue)" }}><span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />{label}</span>
      <span className="g-text mt-0.5 text-[28px] leading-9 tabular-nums">{value}</span>
      <span className="g-text-2 text-[12px] leading-4">{foot}</span>
    </button>
  );
}

/**
 * Health over time: every finished crawl, oldest first, as an orange area. A crawl with no score (or that could not be
 * read) is a gap the line never bridges, and a lone scored crawl between gaps stays visible as a dot.
 */
export function HealthTrend({ points }: { points: { key: string; label: string; value: number | null }[] }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="h-44 sm:h-56" aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`h${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ORANGE} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={32} />
          <Tooltip contentStyle={TOOLTIP} labelStyle={{ color: "var(--g-text-2)" }} formatter={(v: number) => [v, "Health score"]} />
          <Area type="monotone" dataKey="value" stroke={ORANGE} strokeWidth={2.5} fill={`url(#h${id})`} dot={{ r: 3, fill: ORANGE, strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A 0-100 area rating as a thin orange bar (the number is written beside it; the bar is decoration). */
export function RatingBar({ value }: { value: number | null }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
      {value != null && <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: ORANGE }} />}
    </div>
  );
}
