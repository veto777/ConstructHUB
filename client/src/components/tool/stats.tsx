/**
 * Figures of the tool layer (styles: client/src/styles/tool.css): a metric cell, the strip that lines cells up
 * between 1px rules, a status badge, a delta, a sparkline, skeletons.
 *
 * The rule these are built on (owner, 2026-10-09: "everything is clickable and separately"): every distinct piece —
 * the number, the change beside it, the sparkline, each sub-row — is its OWN link with its own destination, its own
 * hover and focus state, and an accessible name that says what it is and where it goes. A strip or a cell is never
 * wrapped in one big link, and a figure with no destination is plain text, never a dead link.
 */
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

type Click = MouseEventHandler<HTMLAnchorElement>;

/** One click target. An in-app address is a client-side link; anything else opens as a normal link. */
export function ToolLink({ href, onClick, label, title, testId, className, blue, external, style, children }: {
  href: string; onClick?: Click;
  /** The accessible name: what the figure is and where it leads ("Broken pages: 2.3K — open the site audit"). */
  label?: string; title?: string; testId?: string; className?: string; blue?: boolean; external?: boolean; style?: CSSProperties; children: ReactNode;
}) {
  const cls = cn("tool-link", blue && "tool-link--blue", className);
  if (external || !href.startsWith("/")) return <a href={href} onClick={onClick} className={cls} style={style} aria-label={label} title={title ?? label} data-testid={testId} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}</a>;
  return <Link href={href} onClick={onClick} className={cls} style={style} aria-label={label} title={title ?? label} data-testid={testId}>{children}</Link>;
}

/** Thousands as K, millions as M — the short form the big numbers use. */
export const shortNumber = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
};

/** A signed change ("+580", "−3"); `upIsBad` flips the colours (errors, broken pages). Nothing for no change. */
export function Delta({ value, upIsBad = false, format = shortNumber, suffix = "" }: { value: number | null | undefined; upIsBad?: boolean; format?: (n: number) => string; suffix?: string }) {
  if (value == null || !Number.isFinite(value) || Math.round(value) === 0) return null;
  const up = value > 0, good = up !== upIsBad;
  return <span className="tool-delta" data-dir={good ? "up" : "down"}>{up ? "+" : "−"}{format(Math.abs(value))}{suffix}</span>;
}

export type Tone = "good" | "warn" | "bad" | "none";
/** A score out of 100 as a tone: 90+ good, 70+ warn, below bad; unknown none. */
export const scoreTone = (v: number | null | undefined): Tone => (v == null ? "none" : v >= 90 ? "good" : v >= 70 ? "warn" : "bad");

/** A small solid rounded chip: a health score, a status. */
export function StatusBadge({ tone, size, label, testId, children }: { tone: Tone; size?: "lg"; label?: string; testId?: string; children: ReactNode }) {
  return <span className={cn("tool-badge", size === "lg" && "tool-badge--lg")} data-tone={tone} aria-label={label} role={label ? "img" : undefined} data-testid={testId}>{children}</span>;
}

/** A sparkline: blue for authority-type figures, orange for traffic. Drawn as plain SVG (no chart library to load). */
export function Spark({ points, color = "blue", range, format = shortNumber }: { points: number[]; color?: "blue" | "orange"; /** The highest and lowest value beside the line. */ range?: boolean; format?: (n: number) => string }) {
  if (points.length < 2) return null;
  const lo = Math.min(...points), hi = Math.max(...points), span = hi - lo || 1;
  const xy = points.map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(2)},${(36 - ((v - lo) / span) * 32).toFixed(2)}`);
  const stroke = color === "orange" ? "var(--tool-orange)" : "var(--tool-blue)";
  return (
    <>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <polygon points={`0,40 ${xy.join(" ")} 100,40`} fill={stroke} opacity=".12" />
        <polyline points={xy.join(" ")} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {range && <span className="tool-stat__range" aria-hidden="true"><span>{format(hi)}</span><span>{format(lo)}</span></span>}
    </>
  );
}

/** A block that holds the place of data still loading — give it the size the data will take. */
export function Skeleton({ width = "100%", height = 16, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={cn("tool-skel", className)} style={{ width, height }} aria-hidden="true" />;
}

export type StatSub = { key?: string; label: ReactNode; value: ReactNode; href?: string; onClick?: Click; /** "Broken pages: 2.3K — open the site audit" */ ariaLabel?: string; testId?: string };

/**
 * One metric: a small muted label, a big tabular number, the change beside it, optional sub-rows and a sparkline.
 * `href` is the number's own destination, `delta.href` the change's, `spark.href` the sparkline's, and each sub-row
 * carries its own — none of them shares a link with another.
 */
export function StatCell({ label, info, value, href, onClick, ariaLabel, linkTestId, testId, none, delta, spark, subs, note, children }: {
  label: ReactNode;
  /** A small help control beside the label (the page's existing "i"). */
  info?: ReactNode;
  /** The figure itself; null/undefined shows an em dash with `none` as the reason. */
  value: ReactNode;
  href?: string; onClick?: Click; ariaLabel?: string; linkTestId?: string; testId?: string;
  /** Why there is no figure (shown as the dash's tooltip) — never a zero that is not a zero. */
  none?: string;
  /** A change, always with the period it covers (`period`, e.g. "since Apr 2026") — never a bare number beside a figure of another period. */
  delta?: { value: number | null | undefined; period?: string; href?: string; onClick?: Click; ariaLabel?: string; testId?: string; upIsBad?: boolean; suffix?: string; format?: (n: number) => string } | null;
  spark?: { points: number[]; color?: "blue" | "orange"; href?: string; onClick?: Click; ariaLabel?: string; testId?: string; range?: boolean; format?: (n: number) => string } | null;
  subs?: StatSub[];
  /** A short muted line under the figure (a basis, a date) — pass links of their own inside it. */
  note?: ReactNode;
  /** Anything else that belongs to the metric (a distribution bar, an action button). */
  children?: ReactNode;
}) {
  const empty = value == null || value === "";
  const figure = empty ? <span className="tool-stat__value tool-stat__value--none" title={none ?? "No figure yet"} aria-label={none ?? "No figure yet"}>—</span>
    : href ? <ToolLink href={href} onClick={onClick} label={ariaLabel} testId={linkTestId} className="tool-stat__value">{value}</ToolLink>
    : <span className="tool-stat__value">{value}</span>;
  const d = delta && delta.value != null && Number.isFinite(delta.value) && Math.round(delta.value) !== 0 ? delta : null;
  const change = d ? <Delta value={d.value} upIsBad={d.upIsBad} suffix={d.suffix} format={d.format} /> : null;
  const line = spark && spark.points.length > 1 ? <Spark points={spark.points} color={spark.color} range={spark.range} format={spark.format} /> : null;
  return (
    <div className="tool-stat" data-testid={testId}>
      <div className="tool-stat__label"><span data-testid={testId && `${testId}-label`}>{label}</span>{info}</div>
      <div className="tool-stat__figure">
        {figure}
        {d && change && (d.href ? <ToolLink href={d.href} onClick={d.onClick} label={d.ariaLabel} testId={d.testId}>{change}{d.period && <span className="tool-delta__period">{d.period}</span>}</ToolLink> : <>{change}{d.period && <span className="tool-delta__period">{d.period}</span>}</>)}
      </div>
      {note && <div className="tool-stat__note">{note}</div>}
      {subs && subs.length > 0 && (
        <ul className="tool-stat__subs">
          {subs.map((s, i) => (
            <li key={s.key ?? i} className="tool-stat__sub">
              <span>{s.label}</span>
              {s.href ? <ToolLink href={s.href} onClick={s.onClick} label={s.ariaLabel} testId={s.testId}>{s.value}</ToolLink> : <span data-testid={s.testId}>{s.value}</span>}
            </li>
          ))}
        </ul>
      )}
      {children}
      {line && spark && (spark.href
        ? <Link href={spark.href} onClick={spark.onClick} className="tool-stat__spark" aria-label={spark.ariaLabel} title={spark.ariaLabel} data-testid={spark.testId}>{line}</Link>
        : <div className="tool-stat__spark" data-testid={spark.testId}>{line}</div>)}
    </div>
  );
}

/** Metric cells side by side, divided by 1px rules. Columns: phone / tablet / wide. Never wraps its children in a link. */
export function MetricStrip({ cols = [2, 3, 6], boxed, className, testId, children }: { cols?: [number, number, number]; boxed?: boolean; className?: string; testId?: string; children: ReactNode }) {
  return <div className={cn("tool-strip", boxed && "tool-strip--boxed", className)} data-testid={testId} style={{ "--tool-strip-cols": cols[0], "--tool-strip-cols-md": cols[1], "--tool-strip-cols-xl": cols[2] } as CSSProperties}>{children}</div>;
}
