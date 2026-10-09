/**
 * More building blocks for the SEO screens, on top of viz.tsx (which is shared and stays as it is): a row of figures
 * with thin dividers between them, a thin orange bar for "x of y", a list of such bars, a before / now pair of bars
 * for two snapshots, and a card with a blue title. The same two colours as everywhere (owner, 10/8): blue for words,
 * orange for every bar; green and red only ever mean better / worse. Every bar is decoration — its figure is always
 * written out next to it — and nothing here makes up a value: an absent figure is "—".
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ORANGE } from "./viz";

const num = (n: number) => Math.round(n).toLocaleString("en-US");
/** The card every section sits on. */
export const CARD = { borderColor: "var(--g-divider)", background: "var(--g-surface)" } as const;
/** Headings, labels and links are blue; the figures themselves stay in the text colour. */
export const BLUE_WORDS = { color: "var(--g-blue)" } as const;
/** The keyboard focus ring every link here shows (the surface's own rule covers anchors; this says it on the element too). */
export const FOCUS_RING = "rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue,#1a73e8)]";
/**
 * A link's hit area on a phone: at least 44 px tall, whatever the text size, the words centred in it (the owner taps
 * these on a 390 px screen). Parts inside it (a number in bold, an icon) sit 4 px apart, as a space would.
 */
export const TAP = "inline-flex min-h-11 items-center gap-x-1";
/** The cue that does not need a hover: a dotted underline always (solid on hover). */
export const LINK_CUE = "underline decoration-dotted underline-offset-2 hover:decoration-solid";
/**
 * A figure that is a link keeps the text colour and shows a dotted underline at all times — the cue that it leads
 * somewhere, on a phone as on a desktop — a 44 px hit area and the focus ring.
 */
export const FIGURE_LINK = `g-text ${TAP} ${LINK_CUE} ${FOCUS_RING}`;
/** The same on a link that keeps whatever colour its words have (a date in grey, a green verdict). */
export const QUIET_LINK = `${TAP} ${LINK_CUE} ${FOCUS_RING}`;
/** Words that lead somewhere, in the link blue: the same underline, hit area and focus ring. */
export const TEXT_LINK = `g-link ${TAP} ${LINK_CUE} ${FOCUS_RING}`;
/**
 * The same 44 px hit area for a small chip or word that must keep its size (a 24 px chip in a row of them): an
 * invisible box 10 px above and below it takes the tap. Nothing on the page moves.
 */
export const TAP_PAD = "relative before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']";

/**
 * Figures side by side, as a site's row on the dashboard (and Ahrefs' project rows): two to a row on a phone, more as
 * the screen widens, with a thin divider between neighbours once they are all on one line. Give it MetricColumns.
 */
// The divider skips the first cell of every row, so a row that wraps never starts with a line.
const ROWS: Record<3 | 4 | 5 | 6, { grid: string; cell: string }> = {
  3: { grid: "grid-cols-2 md:grid-cols-3", cell: "md:[&:not(:nth-child(3n+1))]:border-l" },
  4: { grid: "grid-cols-2 lg:grid-cols-4", cell: "lg:[&:not(:nth-child(4n+1))]:border-l" },
  5: { grid: "grid-cols-2 md:grid-cols-3 xl:grid-cols-5", cell: "xl:[&:not(:nth-child(5n+1))]:border-l" },
  6: { grid: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6", cell: "xl:[&:not(:nth-child(6n+1))]:border-l" },
};
export function MetricRow({ cols = 4, children, testId, className = "" }: { cols?: 3 | 4 | 5 | 6; children: ReactNode[] | ReactNode; testId?: string; className?: string }) {
  const r = ROWS[cols];
  const items = (Array.isArray(children) ? children : [children]).filter((c) => c != null && c !== false);
  return (
    <div className={`grid gap-x-3 gap-y-5 ${r.grid} ${className}`} data-testid={testId}>
      {items.map((c, i) => <div key={i} className={`min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 ${r.cell}`}>{c}</div>)}
    </div>
  );
}

/**
 * A figure that leads to its data (links.ts): the label and the number are one link, the foot and chart sit under it
 * (the foot can carry links of its own). Looks like viz.tsx's MetricColumn; the figure keeps the text colour and the
 * label's dotted underline (always shown, not only on hover) says it is a link; the block is well over 44 px tall and
 * shows the focus ring. `testId` names the column; the link itself is `link-<testId>`.
 */
export function LinkedFigure({ href, label, value, delta, foot, chart, children, testId }: { href: string; label: ReactNode; value: ReactNode; delta?: ReactNode; foot?: ReactNode; chart?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid={testId}>
      <Link href={href} className={`block min-w-0 rounded-md ${FOCUS_RING}`} data-testid={testId ? `link-${testId}` : undefined}>
        <span className="block text-[13px] font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid" style={BLUE_WORDS}>{label}</span>
        <span className="g-text mt-0.5 block text-[28px] leading-9 tabular-nums">{value}{delta}</span>
      </Link>
      {foot && <div className="g-text-2 text-[12px] leading-4">{foot}</div>}
      {children}
      {chart && <div className="mt-auto pt-2">{chart}</div>}
    </div>
  );
}

/** A section card: a blue title, a grey note beside it (a date, a device), and whatever goes inside. */
export function Section({ title, meta, children, testId, className = "", id }: { title: ReactNode; meta?: ReactNode; children: ReactNode; testId?: string; className?: string; /** An id a link can scroll to (?section=). */ id?: string }) {
  return (
    <section id={id} className={`min-w-0 rounded-xl border p-3 sm:p-4 ${className}`} style={CARD} data-testid={testId}>
      <Heading meta={meta}>{title}</Heading>
      {children}
    </section>
  );
}

/** A blue heading with an optional grey note after it. `level` 2 by default; 3 for a heading inside a card. */
export function Heading({ children, meta, level = 2, className = "", testId }: { children: ReactNode; meta?: ReactNode; level?: 2 | 3; className?: string; testId?: string }) {
  const Tag = level === 3 ? "h3" : "h2";
  return (
    <Tag className={`mb-2 min-w-0 text-[15px] font-medium leading-6 [overflow-wrap:anywhere] ${className}`} style={BLUE_WORDS} data-testid={testId}>
      {children}{meta != null && meta !== "" && <span className="g-text-2 text-[12px] font-normal"> · {meta}</span>}
    </Tag>
  );
}

/**
 * "x of y" as a thin orange bar with the words beside it. The bar is hidden from screen readers (the words carry the
 * figure). `words` replaces the default "x of y"; an empty total draws an empty track.
 */
export function RatioBar({ value, total, label, words, className = "" }: { value: number; total: number; label?: string; words?: ReactNode; className?: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <div className="h-2 min-w-[3rem] flex-1 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden><div className="h-full rounded-full" style={{ width: `${pct}%`, background: ORANGE }} /></div>
      <span className="g-text shrink-0 text-[12px] tabular-nums">{label && <span className="sr-only">{label}: </span>}{words ?? `${num(value)} of ${num(total)}`}</span>
    </div>
  );
}

/** A bare orange bar for inside a table cell, next to the figure the cell already prints. Decoration only. */
export function MiniBar({ value, total, className = "" }: { value: number | null | undefined; total: number; className?: string }) {
  if (value == null || !(total > 0)) return null;
  const pct = Math.max(0, Math.min(100, (value / total) * 100));
  return <span className={`inline-block h-1.5 w-12 overflow-hidden rounded-full align-middle ${className}`} style={{ background: "var(--g-divider)" }} aria-hidden><span className="block h-full rounded-full" style={{ width: `${pct}%`, background: ORANGE }} /></span>;
}

/**
 * Rows of label + orange bar + figure, the longest bar being the biggest value (or each out of its own `total` when
 * one is given). `words` is the figure as written; by default the number, or "x of y" with a total.
 */
export function BarList({ rows, testId, className = "" }: { rows: { key?: string; label: ReactNode; value: number; total?: number; words?: ReactNode; title?: string }[]; testId?: string; className?: string }) {
  const max = Math.max(0, ...rows.map((r) => (r.total != null ? 0 : r.value)));
  return (
    <ul className={`space-y-1.5 text-[13px] ${className}`} data-testid={testId}>
      {rows.map((r, i) => (
        <li key={r.key ?? i} className="min-w-0">
          <div className="g-text mb-0.5 truncate" title={r.title}>{r.label}</div>
          <RatioBar value={r.value} total={r.total ?? max} words={r.words ?? (r.total != null ? `${num(r.value)} of ${num(r.total)}` : num(r.value))} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Two snapshots as two bars — the earlier one paler — each with its date and figure. For a series of two there is no
 * line to draw: this is what the data honestly supports. Nothing when either figure is missing.
 */
export function PairBars({ before, now, beforeLabel, nowLabel, format = num }: { before: number | null | undefined; now: number | null | undefined; beforeLabel: string; nowLabel: string; format?: (n: number) => string }) {
  if (before == null || now == null) return null;
  const max = Math.max(before, now, 1);
  const bar = (v: number, label: string, pale: boolean) => (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="g-text-2 w-12 shrink-0 truncate" title={label}>{label}</span>
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden><div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: ORANGE, opacity: pale ? 0.45 : 1 }} /></div>
      <span className="g-text w-12 shrink-0 text-right tabular-nums">{format(v)}</span>
    </div>
  );
  return <div className="space-y-1" role="img" aria-label={`${beforeLabel}: ${format(before)}; ${nowLabel}: ${format(now)}`}>{bar(before, beforeLabel, true)}{bar(now, nowLabel, false)}</div>;
}

/**
 * The leading number of a written figure, for showing it big: "12 of 40 checked (+3)" → big "12", rest "of 40
 * checked (+3)". A value that does not start with a number is all rest (shown in words, never made into a figure).
 */
export function leadFigure(value: string): { big: string | null; rest: string } {
  const m = /^(—|[+−-]?\d[\d,]*(?:\.\d+)?%?)(?:\s+(.*))?$/s.exec(value.trim());
  if (!m) return { big: null, rest: value };
  return { big: m[1], rest: m[2] ?? "" };
}
