/**
 * Building blocks only the Site audit screen needs, on top of viz.tsx: the big health ring, a severity column that is
 * also a link, a status bar whose every part is a link, the health-over-time chart (a crawl with no score stays a gap),
 * the active-filter chip and a compact table class. Same rules as viz.tsx: blue for words, orange for charts, green /
 * amber / red only for the score and for errors, warnings and notices; nothing here makes up a value — an absent
 * figure is "—". Every link here is at least 44 px tall on a phone, shows it is a link without hovering (a dotted
 * underline, the page's blue for words) and gets the surface's focus ring.
 */
import { useId, type ReactNode } from "react";
import { Link } from "wouter";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, ORANGE, scoreColor, TOOLTIP } from "./viz";
import type { seoLinks } from "./links";

/** The parameters the audit address takes (links.ts), so the audit's views hand narrowings around in one shape. */
export type AuditParams = NonNullable<Parameters<typeof seoLinks.audit>[1]>;
/** A narrowing that arrived for another tab: said in this tab's chip, with a link that takes it where it is read. */
export type Foreign = { words: string; href: string; label: string };

/** Amber: the one colour for warnings and the middle health band, the same as viz's score colour. */
export const AMBER = "#f29900";
/** Tighter rows for the audit tables (the shared g-table rows are roomier): same columns, less padding. */
export const COMPACT_TABLE = "g-table w-full text-[13px] [&_td]:!py-1.5 [&_th]:!py-1.5";
/**
 * A figure that is a link: a dotted underline says so without hovering (solid on hover and focus); the focus ring is
 * the surface's (google.css). Words in the page's blue (g-link) carry their colour as the cue and take this too.
 */
export const FIGURE = "rounded-sm underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:decoration-solid";
/**
 * A link's hit area: 44 px tall on a phone (390 px), 32 px on a desktop — padding on the link's own box (a 16 px line
 * and 14 px above and below). Padding, not a flex box: the words keep their place in the sentence and the spaces
 * between them (a flex box drops the space between "12" and "of"), and a path can still be cut with an ellipsis.
 */
export const TAP = "py-1.5 max-sm:py-3.5";
/** A figure link in a table cell or a line of text. */
export const FIG = `${FIGURE} inline-block ${TAP}`;
/** A figure link on a line of its own (a path in a cell, a note under it); add `truncate` to cut it with an ellipsis. */
export const FIG_BLOCK = `${FIGURE} block ${TAP}`;
/** A big figure (a tile's or a column's number) that is a link: its 32–36 px line and 6 px above and below on a phone. */
export const FIG_BIG = `${FIGURE} inline-block max-sm:py-1.5`;
/** A pill that is a link: 44 px tall on a phone. */
export const PILL = "g-pill g-pill--sm max-sm:!min-h-11";
/** The chevron that opens a row's details, as a link: 44 × 44 on a phone. */
export const CHEVRON = "g-pill !min-h-8 !px-2 max-sm:!min-h-11 max-sm:!min-w-11";
/** A tab strip that wraps on a phone instead of scrolling sideways with no scrollbar; each tab 44 px tall. */
export const TABS = "g-tabs flex-wrap sm:flex-nowrap [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center";
/** A <details> summary (a tappable line): 44 px tall on a phone, its marker kept. */
export const SUMMARY = "g-link cursor-pointer py-1 max-sm:py-3.5";
/** A detail row's cell: the stacked phone layout lays a cell out as a row, which a paragraph-and-list cell must not be. */
export const DETAIL_CELL = "max-sm:!block";

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
 * One severity as a column of the overview row — and the link that narrows the issues table to it (the address
 * carries the narrowing, so the link and the on-page filter are the same thing). Laid out like viz's MetricColumn
 * (blue label, big number, grey footnote) with the severity's dot beside the label. The footnote ("N affected") is a
 * link of its own, to the pages carrying that severity.
 */
export function SeverityColumn({ label, color, value, foot, footHref, footTestId, pressed, href, testId }: { label: string; color: string; value: string; foot: string; footHref: string; footTestId: string; pressed: boolean; href: string; testId: string }) {
  return (
    <div className="-mx-2 flex min-w-0 flex-col items-start rounded-lg px-2 py-1 text-left transition-colors" style={pressed ? { background: "var(--g-accent-soft)" } : undefined}>
      <Link href={href} className={`${FIGURE} flex min-h-11 min-w-0 flex-col items-start decoration-[color:var(--g-blue)]`} aria-current={pressed ? "true" : undefined} title={pressed ? "Showing only these — open to show every issue" : `Show only ${label.toLowerCase()}`} data-testid={testId}>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--g-blue)" }}><span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />{label}</span>
        <span className="g-text mt-0.5 text-[28px] leading-9 tabular-nums">{value}</span>
      </Link>
      <Link href={footHref} className={`g-text-2 ${FIG} text-[12px] leading-4`} title={`The pages with ${label.toLowerCase()}`} data-testid={footTestId}>{foot}</Link>
    </div>
  );
}

/**
 * What narrowed the view, in the words a visitor reads ("Warnings in Content"), with a link that clears it. Every
 * SEO page shows its narrowing this way (links.ts): data-testid="active-filter". `extra` is a second link when the
 * narrowing belongs to another tab ("Open Issues with it").
 */
export function ActiveFilter({ words, clearHref, extra, children }: { words: string; clearHref: string; extra?: { href: string; label: string; testId: string }; /** A sentence under the words, when the narrowing needs one. */ children?: ReactNode }) {
  return (
    <div className="mb-2 text-[13px]" role="status" data-testid="active-filter">
      <p className="inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-lg border px-2 py-1 [overflow-wrap:anywhere]" style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }}>
        <span className="g-text-2">Showing</span><b className="g-text font-medium" data-testid="active-filter-words">{words}</b>
        {extra && <Link href={extra.href} className={`g-link ${FIG}`} data-testid={extra.testId}>{extra.label}</Link>}
        <Link href={clearHref} className={`g-link ${FIG}`} data-testid="link-clear-filter">Clear</Link>
      </p>
      {children && <div className="g-text-2 mt-1 text-[12px]">{children}</div>}
    </div>
  );
}

/**
 * The crawled pages by answer, as a bar and a legend — and every part a link to the pages tab narrowed to that
 * answer. The same shades as viz's DistributionBar. Each segment is a 44 px tall link with the 10 px bar drawn across
 * its middle, so a thumb can hit it; the legend writes every number beside its swatch, so the colour is never the
 * only way to tell them apart.
 */
export function StatusBar({ parts, testId }: { parts: { key: string; label: string; value: number; color: string; href: string }[]; testId?: string }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  const drawn = total > 0 ? parts.filter((p) => p.value > 0) : [];
  return (
    <div data-testid={testId}>
      <div className="relative flex h-11 items-center">
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden />
        {drawn.map((p, i) => (
          <Link key={p.key} href={p.href} className="relative flex h-11 items-center focus-visible:rounded-sm" style={{ width: `${(p.value / total) * 100}%` }} aria-label={`${p.label}: ${p.value}`} title={`${p.label}: ${p.value}`} data-testid={`link-status-bar-${p.key}`}>
            <span className={`block h-2.5 w-full${i === 0 ? " rounded-l-full" : ""}${i === drawn.length - 1 ? " rounded-r-full" : ""}`} style={{ background: p.color }} />
          </Link>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {parts.map((p) => (
          <li key={p.key}><Link href={p.href} className={`g-text-2 ${FIG} gap-1`} title={`The pages that ${p.label.toLowerCase().startsWith("couldn") ? "couldn't be checked" : `answered ${p.label.toLowerCase()}`}`} data-testid={`link-status-${p.key}`}><span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />{p.label} <b className="g-text font-medium tabular-nums">{compact(p.value)}</b></Link></li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Health over time: every finished crawl, oldest first, as an orange area. A crawl with no score (or that could not be
 * read) is a gap the line never bridges, and a lone scored crawl between gaps stays visible as a dot.
 */
export function HealthTrend({ points, onPick }: { points: { key: string; label: string; value: number | null }[]; /** A point was clicked: open that crawl (the dated list under the chart is the keyboard way). */ onPick?: (key: string) => void }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className="h-44 sm:h-56" aria-hidden style={onPick ? { cursor: "pointer" } : undefined}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
          onClick={onPick ? (s: { activePayload?: { payload?: { key?: string } }[] } | null) => { const k = s?.activePayload?.[0]?.payload?.key; if (k) onPick(k); } : undefined}>
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
