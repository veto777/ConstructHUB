/**
 * Building blocks only Site explorer uses, on top of viz.tsx: counts as rows of bars, a share bar beside a number in a
 * table cell, and a small heading over a group of figures.
 * Same two colours as everywhere else: orange for every bar; green / red only where a figure is better or worse
 * (a keyword's difficulty). Nothing here makes up a value — an absent figure is "—".
 */
import type { ReactNode } from "react";
import { fmtNum } from "./shell";
import { ORANGE } from "./viz";

/** A series' change from its first to its last point (null when there is no series to speak of). */
export const change = (xs: (number | null | undefined)[] | undefined) => { const v = (xs ?? []).filter((x): x is number => typeof x === "number"); return v.length > 1 ? v[v.length - 1] - v[0] : null; };

/** A small blue heading over a group of figures. */
export function Kicker({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--g-blue)" }}>{children}</h3>;
}

/**
 * Counts as rows of orange bars: the label on the left, the number (and an optional note) on the right, and a bar
 * underneath. Bars are a share of the largest row, or of `of` when the rows are parts of a known whole.
 */
export function BarRows({ rows, of, testId }: { rows: { label: ReactNode; value: number | null; hint?: ReactNode }[]; of?: number; testId?: string }) {
  const base = of ?? Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <ul className="space-y-2.5" data-testid={testId}>
      {rows.map((r, i) => (
        <li key={i} className="text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="g-text min-w-0 truncate">{r.label}</span>
            <span className="g-text shrink-0 tabular-nums">{fmtNum(r.value)}{r.hint != null && <span className="g-text-2 ml-1.5 text-[12px]">{r.hint}</span>}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${base > 0 && r.value && r.value > 0 ? Math.min(100, Math.max(1, (r.value / base) * 100)) : 0}%`, background: ORANGE }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A number in a table cell with a short orange bar for its share of the largest in that column (the number says it all). */
export function ShareBar({ value, max }: { value: number | null | undefined; max: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="inline-block h-1.5 w-14 shrink-0 overflow-hidden rounded-full" style={{ background: "var(--g-divider)" }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${max > 0 && value && value > 0 ? Math.min(100, Math.max(1, (value / max) * 100)) : 0}%`, background: ORANGE }} />
      </span>
      <span className="tabular-nums">{fmtNum(value)}</span>
    </span>
  );
}

/** The position and difficulty badges live in viz.tsx, shared by every SEO screen. */
export { PositionBadge, DifficultyBadge } from "./viz";
