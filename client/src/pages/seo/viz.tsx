/**
 * Visual building blocks for the SEO screens: big numbers on coloured tiles, tinted change badges, gradient trend
 * charts with a value on hover, a gauge, a ring and distribution bars. A chart never carries a figure alone: every
 * number is also written out (the charts are aria-hidden), and nothing here makes up a value — an absent figure is "—".
 */
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * A point of a trend: its label as written on the axis, its value, and (when known) a key a link can carry — the
 * month "YYYY-MM" the point stands for.
 */
export type TrendPoint = { label: string; value: number; key?: string };

/** Where a figure leads (links.ts): an address for a wouter <Link>, so middle-click and long-press open it in a new tab. */
type Linked = { href?: string; /** Runs before the link is followed (a page that keeps a chosen site is told which). */ onClick?: () => void; /** data-testid of the figure's link. */ linkTestId?: string };

/**
 * The cue every link carries without hover (the owner reads these on a phone): a light underline in the text's own
 * colour, full on hover and focus, and a focus ring. `TAP` makes a text link at least 44px tall, the text centred in
 * it, so it is tappable at 390px. `GROUP_CUE` is the same underline on words inside a block link (`group` on the link).
 */
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]";
export const LINK_CUE = `underline decoration-[color:color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px] hover:decoration-[color:currentColor] focus-visible:decoration-[color:currentColor] ${FOCUS}`;
export const TAP = "inline-flex min-h-[44px] items-center";
const GROUP_CUE = "underline decoration-[color:color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px] group-hover:decoration-[color:currentColor] group-focus-visible:decoration-[color:currentColor]";

/** A text link to a figure's data (a date, a count, a word in a sentence): blue unless styled, underlined always, 44px tall. */
export function FigureLink({ href, onClick, testId, className = "", style, children }: { href: string; onClick?: () => void; testId?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return <Link href={href} onClick={onClick} className={`${TAP} ${LINK_CUE} rounded-sm ${className}`} style={{ color: "var(--g-accent-ink)", ...style }} data-testid={testId}>{children}</Link>;
}

/**
 * A label over a number as ONE block link (54px tall — a thumb's target without padding tricks); the change sits
 * beside the number, outside the link, so it can carry a link of its own. The label keeps its "-label" test id (it
 * was a link of its own once; now it is the same link).
 */
function FigureBlock({ href, onClick, testId, label, value, delta, valueClass }: { href: string; onClick?: () => void; testId?: string; label: ReactNode; value: ReactNode; delta?: ReactNode; valueClass: string }) {
  return (
    <div className="flex min-w-0 items-stretch">
      <Link href={href} onClick={onClick} className={`group block min-w-0 rounded-sm ${FOCUS}`} data-testid={testId}>
        <span className={`block text-[13px] font-medium ${GROUP_CUE}`} style={{ color: "var(--g-blue)" }} data-testid={testId && `${testId}-label`}>{label}</span>
        <span className={`g-text mt-0.5 block tabular-nums ${valueClass}`}>{value}</span>
      </Link>
      {delta && <span className="flex items-end pb-[6px] leading-none">{delta}</span>}
    </div>
  );
}

/**
 * Every month of a chart as a real link (keyboard and touch — the chart itself is decoration): one 44px disclosure
 * naming the span, the months inside it.
 */
function MonthList({ points, hrefOf, onPick, testId }: { points: TrendPoint[]; hrefOf: (p: TrendPoint, i: number) => string | null | undefined; onPick?: (p: TrendPoint, i: number) => void; testId: string }) {
  const n = points.length;
  return (
    <details className="group/months text-[11px]" data-testid={`${testId}-months`}>
      <summary className={`${TAP} ${LINK_CUE} g-text-2 cursor-pointer gap-1 rounded-sm`}><span aria-hidden className="group-open/months:hidden">▸</span><span aria-hidden className="hidden group-open/months:inline">▾</span> Months: {points[0].label} – {points[n - 1].label}</summary>
      <ul className="flex flex-wrap gap-x-2">
        {points.map((p, i) => { const h = hrefOf(p, i); return <li key={p.key ?? String(i)}>{h ? <FigureLink href={h} onClick={onPick && (() => onPick(p, i))} testId={`link-${testId}-month-${p.key ?? i}`}>{p.label}</FigureLink> : <span className={`${TAP} g-text-2`}>{p.label}</span>}</li>; })}
      </ul>
    </details>
  );
}

/** The point under the pointer when a chart is clicked (recharts names it the active tooltip index). */
type ChartClick = { activeTooltipIndex?: number } | null | undefined;

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
    <span className="ml-1.5 inline whitespace-nowrap text-[14px] font-medium tabular-nums" style={{ color: good ? "var(--g-green)" : "var(--g-red)" }} aria-label={label}>
      {value > 0 ? "+" : "−"}{compact(Math.abs(value))}{suffix}
    </span>
  );
}

/**
 * A trend as a filled area with a soft gradient, and the value under the pointer. `points` oldest first. With
 * `pointHref` / `onPoint`, clicking a point opens that point's month, and the months are listed under the chart as
 * real links (the chart is decoration; the list is the keyboard and touch route). `testId` names the month links.
 */
export function GradientSpark({ points, color, height = 56, format = compact, range = false, pointHref, onPoint, testId }: { points: TrendPoint[] | undefined; color: string; height?: number; format?: (n: number) => string; /** The highest and lowest value beside the chart. */ range?: boolean; /** Where a point leads; null for nowhere. */ pointHref?: (p: TrendPoint, i: number) => string | null | undefined; onPoint?: (p: TrendPoint, i: number) => void; testId?: string }) {
  const id = useId().replace(/:/g, "");
  const [, navigate] = useLocation();
  if (!points || points.length < 2) return <div style={{ height }} aria-hidden />;
  const vals = points.map((p) => p.value), hi = Math.max(...vals), lo = Math.min(...vals);
  const clickable = !!(pointHref || onPoint);
  const pick = (st: ChartClick) => { const i = st?.activeTooltipIndex; if (i == null || !points[i]) return; onPoint?.(points[i], i); const h = pointHref?.(points[i], i); if (h) navigate(h); };
  const chart = (
    <div className={`flex items-stretch gap-1.5${clickable ? " cursor-pointer" : ""}`} style={{ height }} aria-hidden>
    <div className="min-w-0 flex-1">
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} onClick={clickable ? pick : undefined}>
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
  if (!pointHref) return chart;
  return <div className="min-w-0">{chart}<MonthList points={points} hrefOf={pointHref} onPick={onPoint} testId={testId ?? "spark"} /></div>;
}
export const TOOLTIP = { background: "var(--g-surface)", border: "1px solid var(--g-divider)", borderRadius: 8, fontSize: 12, padding: "4px 8px" } as const;

/**
 * A figure on a tile: a coloured accent, the label, a big number with its change, an optional chart and a footnote.
 * `value` is text the screen reader reads as it is. With `href`, the label and the value are one block link to the
 * figure's data (the change, the chart and the footnote can carry their own).
 */
export function StatTile({ label, value, delta, color, chart, foot, side, testId, children, href, onClick, linkTestId }: {
  label: string; value: ReactNode; delta?: ReactNode; color: string; chart?: ReactNode; foot?: ReactNode; side?: ReactNode; testId?: string; children?: ReactNode;
} & Linked) {
  const lt = linkTestId ?? (testId ? `link-${testId}` : undefined);
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId} data-color={color}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {href ? <FigureBlock href={href} onClick={onClick} testId={lt} label={label} value={value} delta={delta} valueClass="text-[26px] leading-8 sm:text-[30px] sm:leading-9" /> : <>
            <div className="text-[13px] font-medium" style={{ color: "var(--g-blue)" }}>{label}</div>
            <div className="g-text mt-0.5 text-[26px] leading-8 tabular-nums sm:text-[30px] sm:leading-9">{value}{delta}</div>
          </>}
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
export function MetricColumn({ label, value, delta, foot, chart, children, testId, href, onClick, linkTestId }: { label: string; value: ReactNode; delta?: ReactNode; foot?: ReactNode; chart?: ReactNode; children?: ReactNode; testId?: string } & Linked) {
  const lt = linkTestId ?? (testId ? `link-${testId}` : undefined);
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      {href ? <FigureBlock href={href} onClick={onClick} testId={lt} label={label} value={value} delta={delta} valueClass="text-[28px] leading-9" /> : <>
        <div className="text-[13px] font-medium" style={{ color: "var(--g-blue)" }}>{label}</div>
        <div className="g-text mt-0.5 text-[28px] leading-9 tabular-nums">{value}{delta}</div>
      </>}
      {foot && <div className="g-text-2 text-[12px] leading-4">{foot}</div>}
      {children}
      {chart && <div className="mt-auto pt-2">{chart}</div>}
    </div>
  );
}

/**
 * A 0-100 score as a coloured badge (green from 90, amber from 70, red below): the one place a score is coloured.
 * With `href`, the badge is a link to where the score comes from (not for a badge already inside a figure's link).
 */
export function ScoreBadge({ value, label, href, onClick, linkTestId }: { value: number | null; label?: string } & Linked) {
  if (value == null) return href ? <FigureLink href={href} onClick={onClick} testId={linkTestId} className="text-[28px] leading-9" style={{ color: "var(--g-text)" }}>—</FigureLink> : <span className="g-text text-[28px] leading-9">—</span>;
  const cls = "inline-grid min-w-[3rem] place-items-center rounded-full px-3 text-[22px] font-medium tabular-nums text-white";
  const style = { background: scoreColor(value) }, aria = label ?? `${value} out of 100`;
  // As a link the badge is 44px tall (a thumb's target) and says so with a light underline.
  return href ? <Link href={href} onClick={onClick} className={`${cls} h-11 ${LINK_CUE}`} style={style} aria-label={aria} data-testid={linkTestId}>{value}</Link>
    : <span className={`${cls} h-10`} style={style} aria-label={aria}>{value}</span>;
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

/**
 * Parts of a whole as one stacked bar with a legend underneath (the legend carries the numbers). With `segmentHref`,
 * each segment and its legend entry link to that part's rows: the segments are real, focusable links whose hit area
 * is 44px tall with the 10px bar drawn through the middle of it, and the legend entries are 44px tall too; `key` is
 * what the link is built from (the label when absent).
 */
export function DistributionBar({ parts, testId, segmentHref, onSegment }: { parts: { label: string; value: number; color: string; key?: string }[]; testId?: string; /** Where a part leads; null for nowhere. */ segmentHref?: (key: string) => string | null | undefined; onSegment?: (key: string) => void }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  const keyOf = (p: { key?: string; label: string }) => p.key ?? p.label;
  const shown = total > 0 ? parts.filter((p) => p.value > 0) : [];
  const piece = (p: { color: string }, i: number) => <span className={`block h-2.5 w-full${i === 0 ? " rounded-l-full" : ""}${i === shown.length - 1 ? " rounded-r-full" : ""}`} style={{ background: p.color }} aria-hidden />;
  return (
    <div data-testid={testId}>
      {segmentHref ? (
        <div className="relative flex min-h-[44px] items-center">
          <span className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden />
          {shown.map((p, i) => {
            const href = segmentHref(keyOf(p)), style = { width: `${(p.value / total) * 100}%` }, words = `${p.label}: ${compact(p.value)}`;
            return href ? <Link key={p.label} href={href} onClick={onSegment && (() => onSegment(keyOf(p)))} className={`relative flex min-h-[44px] items-center rounded-sm hover:opacity-80 ${FOCUS}`} style={style} aria-label={words} title={words} data-testid={`link-${testId ?? "band"}-bar-${keyOf(p)}`}>{piece(p, i)}</Link>
              : <span key={p.label} className="relative flex min-h-[44px] items-center" style={style} title={words}>{piece(p, i)}</span>;
          })}
        </div>
      ) : (
        <div className="flex h-2.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
          {shown.map((p) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
        </div>
      )}
      <ul className={`flex flex-wrap gap-x-3 text-[11px]${segmentHref ? "" : " mt-1.5 gap-y-0.5"}`}>
        {parts.map((p) => {
          const href = segmentHref?.(keyOf(p));
          const body = <><span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />{p.label} <b className="g-text font-medium tabular-nums">{compact(p.value)}</b></>;
          return (
            <li key={p.label} className="g-text-2 inline-flex items-center gap-1">
              {href ? <Link href={href} onClick={onSegment && (() => onSegment(keyOf(p)))} className={`${TAP} ${LINK_CUE} gap-1 rounded-sm`} data-testid={`link-${testId ?? "band"}-${keyOf(p)}`}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A large trend chart with a switch between figures (each a series of labelled points, oldest first). With
 * `pointHref` / `onPoint`, clicking a point opens that point's month, and the first and last month in the line above
 * the chart are links to the same places (the keyboard route).
 */
export function TrendPanel({ series, title, note, testId, pointHref, onPoint }: { series: { key: string; label: string; color: string; points: TrendPoint[] }[]; title: string; note?: ReactNode; testId?: string; /** Where a point of a series leads; null for nowhere. */ pointHref?: (seriesKey: string, p: TrendPoint, i: number) => string | null | undefined; onPoint?: (seriesKey: string, p: TrendPoint, i: number) => void }) {
  const usable = series.filter((s) => s.points.length >= 2);
  const [key, setKey] = useState(usable[0]?.key ?? "");
  const id = useId().replace(/:/g, "");
  const [, navigate] = useLocation();
  const s = usable.find((x) => x.key === key) ?? usable[0];
  if (!s) return null;
  const n = s.points.length, first = s.points[0].value, last = s.points[n - 1].value;
  const clickable = !!(pointHref || onPoint);
  const pick = (st: ChartClick) => { const i = st?.activeTooltipIndex; if (i == null || !s.points[i]) return; onPoint?.(s.key, s.points[i], i); const h = pointHref?.(s.key, s.points[i], i); if (h) navigate(h); };
  const monthLink = (i: number, which: "first" | "last") => {
    const h = pointHref?.(s.key, s.points[i], i);
    return h ? <FigureLink href={h} onClick={onPoint && (() => onPoint(s.key, s.points[i], i))} testId={`link-${testId ?? "trend"}-${which}`}>{s.points[i].label}</FigureLink> : s.points[i].label;
  };
  return (
    <div className="rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-medium" style={{ color: "var(--g-blue)" }}>{title}</h3>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Figure shown">
          {usable.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.key === s.key} onClick={() => setKey(x.key)} className="min-h-[44px] rounded-md border px-2.5 py-0.5 text-[12px] transition-colors"
              style={x.key === s.key ? { borderColor: "var(--g-blue)", color: "var(--g-blue)", background: "var(--g-accent-soft)" } : { borderColor: "var(--g-divider)", color: "var(--g-text-2)" }} data-testid={`${testId ?? "trend"}-${x.key}`}>{x.label}</button>
          ))}
        </div>
      </div>
      <p className="g-text-2 mb-1 text-[12px]">{s.label}: {compact(first)} in {monthLink(0, "first")} → <b className="g-text font-medium">{compact(last)}</b> in {monthLink(n - 1, "last")}</p>
      <div className={`h-44 sm:h-56${clickable ? " cursor-pointer" : ""}`} aria-hidden>
        <ResponsiveContainer>
          <AreaChart data={s.points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} onClick={clickable ? pick : undefined}>
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
      {pointHref && <MonthList points={s.points} hrefOf={(p, i) => pointHref(s.key, p, i)} onPick={onPoint && ((p, i) => onPoint(s.key, p, i))} testId={`${testId ?? "trend"}-${s.key}`} />}
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
