/**
 * Building blocks only Site explorer uses, on top of viz.tsx: counts as rows of bars, a share bar beside a number in a
 * table cell, a small heading over a group of figures, and the links every figure is (owner 2026-10-09).
 * Same two colours as everywhere else: orange for every bar; green / red only where a figure is better or worse
 * (a keyword's difficulty). Nothing here makes up a value — an absent figure is "—".
 *
 * Every link here is at least 44 px tall (a thumb on a phone), says it is a link without a pointer over it (a light
 * underline that darkens on hover) and shows a focus ring from the keyboard.
 */
import { useId, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { ExternalLink } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum } from "./shell";
import { compact, ORANGE, TOOLTIP } from "./viz";

/** The look of a link to data: link colour, a light underline always (darker on hover), a focus ring from the keyboard. */
export const LINK_CUE = "text-[color:var(--g-accent-ink)] underline decoration-1 decoration-[color:var(--g-divider)] underline-offset-[3px] hover:decoration-[color:var(--g-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)] rounded-sm";
/** A thumb-sized hit area (44 px) without changing the line the link sits on. */
export const TAP = "inline-flex min-h-[44px] items-center";
export const FIG = `${LINK_CUE} ${TAP}`;

/** A figure (or a word) that leads to its rows. `block` makes it fill its box (a whole card, a row of bars). */
export function Fig({ href, testId, children, style, className = "", block = false, label }: { href: string; testId: string; children: ReactNode; style?: CSSProperties; className?: string; block?: boolean; /** What the link is, for a screen reader, when the figure alone does not say. */ label?: string }) {
  return <Link href={href} className={`${LINK_CUE} ${block ? "flex min-h-[44px] flex-col justify-center" : TAP} ${className}`} style={style} aria-label={label} data-testid={testId}>{children}</Link>;
}

/** The page (or site) itself, behind an icon beside the link to its data — the external link kept separate and thumb-sized. */
export function OpenIcon({ href, what }: { href: string; what: string }) {
  return (
    <a href={href} className="-my-2 ml-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md align-middle text-[color:var(--g-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]" target="_blank" rel="noreferrer" aria-label={`Open ${what} in a new tab`} title="Open in a new tab" data-testid="link-open-external"><ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
  );
}

/**
 * One headline figure: its blue label and its number both lead to the figure's report (the owner's rule covers labels
 * too), with its change beside it and a footnote, a small chart or more under it. viz.tsx's MetricColumn look, with
 * this screen's thumb-sized links (its own label link underlines only on hover).
 */
export function Metric({ label, value, href, linkTestId, words, delta, foot, chart, children, testId }: {
  label: string; value: ReactNode; href: string; /** The number's link; the label's gets "-label" added. */ linkTestId: string;
  /** What the number is, for a screen reader, when the number alone does not say. */ words?: string;
  delta?: ReactNode; foot?: ReactNode; chart?: ReactNode; children?: ReactNode; testId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      <div className="text-[13px] font-medium"><Fig href={href} testId={`${linkTestId}-label`}>{label}</Fig></div>
      <div className="g-text flex flex-wrap items-center gap-x-1 text-[28px] leading-9 tabular-nums"><Fig href={href} testId={linkTestId} label={words}>{value}</Fig>{delta}</div>
      {foot && <div className="g-text-2 text-[12px] leading-4">{foot}</div>}
      {children}
      {chart && <div className="mt-auto pt-2">{chart}</div>}
    </div>
  );
}

/** A series' change from its first to its last point (null when there is no series to speak of). */
export const change = (xs: (number | null | undefined)[] | undefined) => { const v = (xs ?? []).filter((x): x is number => typeof x === "number"); return v.length > 1 ? v[v.length - 1] - v[0] : null; };

/** A small blue heading over a group of figures. */
export function Kicker({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-blue)" }}>{children}</h3>;
}

/**
 * Counts as rows of orange bars: the label on the left, the number (and an optional note) on the right, and a bar
 * underneath. Bars are a share of the largest row, or of `of` when the rows are parts of a known whole. A row with an
 * `href` is one link — label, number and bar together — to the rows it counts.
 */
export function BarRows({ rows, of, testId }: { rows: { label: ReactNode; value: number | null; hint?: ReactNode; href?: string; testId?: string; words?: string }[]; of?: number; testId?: string }) {
  const base = of ?? Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="space-y-1" data-testid={testId}>
      {rows.map((r, i) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">{fmtNum(r.value)}{r.hint != null && <span className="g-text-2 ml-1.5 text-[12px] no-underline">{r.hint}</span>}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${base > 0 && r.value && r.value > 0 ? Math.min(100, Math.max(1, (r.value / base) * 100)) : 0}%`, background: ORANGE }} />
            </div>
          </>
        );
        return (
          <li key={i} className="text-[13px]">
            {r.href ? <Fig href={r.href} testId={r.testId ?? `link-bar-${i}`} label={r.words} block className="g-text w-full">{inner}</Fig> : <div className="g-text min-h-[44px] py-2">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** A number in a table cell with a short orange bar for its share of the largest in that column (the number says it all); a link to its rows when it has an `href`. */
export function ShareBar({ value, max, href, testId, words }: { value: number | null | undefined; max: number; href?: string; testId?: string; words?: string }) {
  const inner = (
    <>
      <span className="inline-block h-1.5 w-14 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${max > 0 && value && value > 0 ? Math.min(100, Math.max(1, (value / max) * 100)) : 0}%`, background: ORANGE }} />
      </span>
      <span className="tabular-nums">{fmtNum(value)}</span>
    </>
  );
  return href ? <Fig href={href} testId={testId ?? "link-share"} label={words} className="justify-end gap-2">{inner}</Fig> : <span className="inline-flex min-h-[44px] items-center justify-end gap-2">{inner}</span>;
}

/**
 * Parts of a whole as one stacked bar with a legend whose entries are links (the keyword distribution: each band
 * leads to the keywords in it). The bar itself is a picture — 10 px tall is no place for a thumb — so the legend
 * carries the links and the numbers.
 */
export function LinkedDistribution({ parts, testId }: { parts: { label: string; value: number; color: string; href: string; testId: string; words: string }[]; testId?: string }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  return (
    <div data-testid={testId}>
      <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
        {total > 0 && parts.map((p) => p.value > 0 && <div key={p.label} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <ul className="flex flex-wrap gap-x-2 text-[11px]">
        {parts.map((p) => (
          <li key={p.label}><Fig href={p.href} testId={p.testId} label={p.words} className="gap-1 px-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden /><span className="g-text-2">{p.label}</span> <b className="g-text font-medium tabular-nums">{compact(p.value)}</b></Fig></li>
        ))}
      </ul>
    </div>
  );
}

/** A month of a chart, as a link a thumb or a keyboard can pick (the chart's own points are a picture). */
export type MonthLink = { month: string; label: string };
/**
 * The months of a chart as a row of links — the keyboard and touch way to pick a point. `current` is marked. With
 * `collapsed`, the row sits behind a "Months" disclosure so six small charts do not become six rows of links.
 */
export function MonthLinks({ months, href, current, testId, collapsed = false, what = "a month" }: { months: MonthLink[]; href: (month: string) => string; current: string | null; testId: string; collapsed?: boolean; /** What picking a month does, for the disclosure's words. */ what?: string }) {
  if (months.length < 2) return null;
  const row = (
    <ul className="flex flex-wrap gap-x-1" data-testid={testId} aria-label="Months">
      {months.map((m) => (
        <li key={m.month}><Link href={href(m.month)} className={`${LINK_CUE} ${TAP} px-1.5 text-[12px] ${m.month === current ? "font-medium" : ""}`} aria-current={m.month === current ? "true" : undefined} style={m.month === current ? { background: "var(--g-accent-soft)" } : undefined} data-testid={`${testId}-${m.month}`}>{m.label}</Link></li>
      ))}
    </ul>
  );
  return collapsed ? (
    <details className="text-[12px]">
      <summary className={`${TAP} cursor-pointer list-none px-1 text-[color:var(--g-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]`} data-testid={`${testId}-open`}>Pick {what} ›</summary>
      {row}
    </details>
  ) : row;
}

/** One figure of a monthly chart: its points oldest first (each with its "YYYY-MM"), and where its rows are. */
export type MonthSeries = { key: string; label: string; color: string; points: { month: string; label: string; value: number }[]; /** The report behind the figure, for the month picked (or none). */ href: (month: string | null) => string; /** The words on that link. */ rows: string };

/**
 * A large monthly trend chart with a switch between figures (the look of viz.tsx's TrendPanel) that leads somewhere:
 * every figure has a link to its rows, a clicked point picks that month (the address carries it, links.ts `month`)
 * and so does the row of month links under the chart, and a picked month is marked. The figure shown is the address's
 * `series`. Orange for every figure; blue only for words and the mark.
 */
export function MonthTrend({ series, title, note, testId, month, onPick, active, onSeries, monthHref }: {
  series: MonthSeries[]; title: string; note?: ReactNode; testId: string;
  /** The month picked, "YYYY-MM" (null for none). */ month: string | null; onPick: (month: string | null) => void;
  /** The figure shown (a series key from the address); the first usable one when absent. */ active?: string | null; onSeries: (key: string) => void;
  /** Where a month link leads (the same page with that month picked). */ monthHref: (month: string) => string;
}) {
  const usable = series.filter((s) => s.points.length >= 2);
  const id = useId().replace(/:/g, "");
  const s = usable.find((x) => x.key === active) ?? usable[0];
  if (!s) return null;
  const first = s.points[0], last = s.points[s.points.length - 1];
  const picked = month ? s.points.find((p) => p.month === month) ?? null : null;
  const monthOf = (label: unknown) => s.points.find((p) => p.label === label)?.month ?? null;
  return (
    <div className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>{title}</h3>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Figure shown">
          {usable.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.key === s.key} onClick={() => onSeries(x.key)} className="min-h-[44px] rounded-md border px-2.5 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]"
              style={x.key === s.key ? { borderColor: "var(--g-blue)", color: "var(--g-blue)", background: "var(--g-accent-soft)" } : { borderColor: "var(--g-divider)", color: "var(--g-text-2)" }} data-testid={`${testId}-${x.key}`}>{x.label}</button>
          ))}
        </div>
      </div>
      <p className="g-text-2 mb-1 flex flex-wrap items-center gap-x-3 text-[12px]">
        {/* The first and last figures pick their month; the picked month's figure leads to its rows. */}
        <span>{s.label}: <Link href={monthHref(first.month)} className={`${LINK_CUE} ${TAP} px-0.5`} aria-label={`${s.label}, ${first.label}: ${compact(first.value)} — pick that month`} data-testid={`${testId}-first`}>{compact(first.value)} in {first.label}</Link> → <Link href={monthHref(last.month)} className={`${LINK_CUE} ${TAP} px-0.5 font-medium`} aria-label={`${s.label}, ${last.label}: ${compact(last.value)} — pick that month`} data-testid={`${testId}-last`}>{compact(last.value)} in {last.label}</Link></span>
        {month && <span className="inline-flex items-center gap-1" data-testid={`${testId}-month`}>{picked ? <>{picked.label}: <Link href={s.href(picked.month)} className={`${LINK_CUE} ${TAP} px-0.5 font-medium`} aria-label={`${s.label}, ${picked.label}: ${compact(picked.value)} — ${s.rows}`} data-testid={`${testId}-month-value`}>{compact(picked.value)}</Link></> : "That month is not in this chart"}<button type="button" className={`${LINK_CUE} ${TAP} ml-1 px-1`} onClick={() => onPick(null)} data-testid={`${testId}-month-clear`}>Clear</button></span>}
      </p>
      <div className="h-44 sm:h-56" aria-hidden>
        <ResponsiveContainer>
          <AreaChart data={s.points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} style={{ cursor: "pointer" }} onClick={(st) => { const m = monthOf(st?.activeLabel); if (m) onPick(m === month ? null : m); }}>
            <defs>
              <linearGradient id={`m${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v: number) => [compact(v), s.label]} />
            <Area type="monotone" dataKey="value" stroke={s.color} strokeWidth={2.5} fill={`url(#m${id})`} isAnimationActive={false} activeDot={{ r: 4 }} />
            {picked && <ReferenceLine x={picked.label} stroke="var(--g-blue)" strokeDasharray="4 4" />}
            {picked && <ReferenceDot x={picked.label} y={picked.value} r={5} fill={s.color} stroke="var(--g-blue)" strokeWidth={2} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MonthLinks months={s.points} href={monthHref} current={month} testId={`${testId}-months`} />
      <p className="g-text-2 flex flex-wrap items-center gap-x-3 text-[12px]" data-testid={`${testId}-rows`}>
        <span>The rows:</span>
        {usable.map((x) => <Link key={x.key} href={x.href(month)} className={`${LINK_CUE} ${TAP} px-1`} data-testid={`link-${testId}-${x.key}`}>{x.rows}{month && picked ? ` · ${picked.label}` : ""} →</Link>)}
      </p>
      <p className="g-text-2 mt-1 text-[11px]">{note}{note ? " " : ""}Click a point, or a month above, to pick that month.</p>
    </div>
  );
}

/** The position and difficulty badges live in viz.tsx, shared by every SEO screen. */
export { PositionBadge, DifficultyBadge } from "./viz";
