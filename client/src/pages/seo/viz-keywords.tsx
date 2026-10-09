/**
 * Building blocks for the Keywords explorer and Content explorer, on top of viz.tsx: a keyword-difficulty badge, a
 * monthly bar chart, a thin bar beside a number, a row of figure columns with dividers, and the results-page features
 * as small grey icons. Same two colours as the dashboard (blue wording, orange graphs); green / amber / red only ever
 * say how hard a keyword is. A bar never carries a figure alone — the number is always written beside it — and nothing
 * here makes up a value: an absent figure is "—".
 *
 * Also the look of a figure that is a link (links.ts: every figure leads somewhere): a dotted blue underline says so
 * without hovering, a solid one on hover, an outline when reached by keyboard, and a hit area 44 px tall on a phone.
 */
import { Children, type ReactNode } from "react";
import { Link } from "wouter";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Image as ImageIcon, Info, Link2, Map as MapIcon, Megaphone, MessageCircleQuestion, Newspaper, Search, ShoppingBag, Sparkles, Star, Users, Video } from "lucide-react";
import { fmtNum, Tile } from "./shell";
import { compact, DifficultyBadge, PALETTE, TOOLTIP } from "./viz";

/** The cue every linked figure wears: a dotted blue underline (visible without hovering), solid on hover, an outline on keyboard focus. */
export const LINK_CUE = "rounded-sm underline decoration-dotted decoration-1 underline-offset-4 decoration-[color:var(--g-blue)] hover:decoration-solid focus-visible:decoration-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]";
/**
 * 44 px of hit area on an inline link, whatever its text size (a 16 px line plus 14 px above and below): padding on an
 * inline element is tappable but takes no room in the line. Not for a cell that cuts its words short (`truncate` clips
 * the padding too) — a link there is BLOCK_LINK with the cut on a span inside it.
 */
export const TAP = "py-[14px]";
/** An inline figure or word that is a link, in the text colour. */
export const FIG_LINK = `${LINK_CUE} ${TAP}`;
/** An inline word link in blue. */
export const TEXT_LINK = `g-link ${LINK_CUE} ${TAP}`;
/** A link around a bar, a badge or a block: at least 44 px tall. */
export const BLOCK_LINK = `${LINK_CUE} inline-flex min-h-11 items-center`;

/** The difficulty bands, the same ones shell.tsx `kd()` puts into words: under 30 easy, under 60 medium, else hard. */
export const kdBand = (n: number) => (n < 30 ? "easy" : n < 60 ? "medium" : "hard");
const KD_COLOR = { easy: "#1e8e3e", medium: "#f29900", hard: "#d93025" } as const;

/**
 * Keyword difficulty 0–100 as Ahrefs shows it: a coloured mark, the number and the word. `lg` is the badge for an
 * overview (the number on the colour); the small one, for a table row, is viz.tsx's DifficultyBadge, the same on
 * every SEO screen. The colour is never the only signal — the word is always there.
 */
export function KdBadge({ value, size = "sm" }: { value: number | null | undefined; size?: "sm" | "lg" }) {
  if (value == null) return size === "lg" ? <span className="g-text text-[28px] leading-9">—</span> : <span className="g-text-2">—</span>;
  const band = kdBand(value), color = KD_COLOR[band], label = `Difficulty ${value} out of 100, ${band}`;
  if (size === "lg") {
    return (
      <span className="inline-flex items-baseline gap-2" aria-label={label}>
        <span className="inline-grid h-10 min-w-[3rem] place-items-center rounded-full px-3 text-[22px] font-medium tabular-nums text-white" style={{ background: color }}>{value}</span>
        <span className="g-text-2 text-[14px]">{band}</span>
      </span>
    );
  }
  return <DifficultyBadge value={value} />;
}

/**
 * A number with a thin orange bar under it, the bar's length a share of `max` (the biggest value on the same screen,
 * or 100 for a score). Right-aligned for a table cell. The number is what is read; the bar only helps the eye.
 */
export function BarFigure({ value, max, color, format = fmtNum, title, align = "end", width = 56 }: {
  value: number | null | undefined; max: number | null | undefined; color: string; format?: (n: number) => string; title?: string;
  /** Which way the number and bar line up: `end` (a table cell) or `start` (a card). */
  align?: "start" | "end"; width?: number;
}) {
  const share = value != null && max != null && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className={`inline-flex flex-col ${align === "end" ? "items-end" : "items-start"}`} title={title}>
      <span className="g-text tabular-nums">{value == null ? "—" : format(value)}</span>
      <span className="mt-0.5 block h-[3px] overflow-hidden rounded-full" style={{ width, background: "var(--g-divider)" }} aria-hidden>
        {value != null && <span className="block h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />}
      </span>
    </span>
  );
}

/**
 * A small labelled figure on a card: the label in blue, the number with its bar. With `href` the whole figure is a
 * link to the view that holds the rows behind it (links.ts): the label, the number and the bar all open it.
 */
export function Figure({ label, value, max, color, format, title, testId, href }: { label: string; value: number | null | undefined; max: number | null | undefined; color: string; format?: (n: number) => string; title?: string; testId?: string; href?: string }) {
  const body = (<>
    <span className="text-[11px] font-medium leading-4" style={{ color: "var(--g-blue)" }}>{label}</span>
    <BarFigure value={value} max={max} color={color} format={format} title={title} align="start" width={64} />
  </>);
  if (href) return <Link href={href} className={`${LINK_CUE} inline-flex min-h-11 min-w-0 flex-col justify-center`} data-testid={testId}>{body}</Link>;
  return <span className="inline-flex min-w-0 flex-col" data-testid={testId}>{body}</span>;
}

/**
 * shell.tsx's own summary Tile, wrapped in a link to the rows it counts (shell.tsx is not changed): label, number and
 * hint all open it — a tile is far taller than 44 px. The label turns blue and the number wears the dotted underline,
 * so it reads as a link without hovering; an outline on keyboard focus. `testId` is the link's; `tileTestId` the tile's.
 */
export function TileLink({ href, title, testId, tileTestId, label, value, hint }: { href: string; title?: string; testId?: string; tileTestId?: string; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Link href={href} title={title} data-testid={testId}
      className="block min-w-0 rounded-lg hover:[&>.g-tile]:bg-[var(--g-hover)] [&_.g-tile__label]:text-[color:var(--g-blue)] [&_.g-tile__value]:underline [&_.g-tile__value]:decoration-dotted [&_.g-tile__value]:decoration-1 [&_.g-tile__value]:underline-offset-4 [&_.g-tile__value]:decoration-[color:var(--g-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--g-blue)]">
      <Tile label={label} value={value} hint={hint} testId={tileTestId} />
    </Link>
  );
}

/**
 * Monthly figures as orange bars with the value on hover (`points` oldest first). Thin bars with a rounded top on a
 * faint grid; the axes carry the months and the scale. `highlight` draws one month in the deeper orange; `onBar` makes
 * each bar a pick (the page pairs it with a month picker, the keyboard's way to the same place).
 */
export function MonthlyBars({ points, color, height = 200, format = fmtNum, name = "Searches", highlight, onBar }: { points: { label: string; value: number }[]; color: string; height?: number; format?: (n: number) => string; name?: string; /** The label of one month to draw in the deeper orange (the one a link pointed at). */ highlight?: string; onBar?: (label: string) => void }) {
  if (points.length < 2) return null;
  return (
    <div style={{ width: "100%", height }} aria-hidden>
      <ResponsiveContainer>
        <BarChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip cursor={{ fill: "var(--g-hover)" }} contentStyle={TOOLTIP} labelStyle={{ color: "var(--g-text-2)" }} formatter={(v: number) => [format(v), name]} />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} style={onBar ? { cursor: "pointer" } : undefined}
            onClick={onBar ? (d: { payload?: { label?: string }; label?: string }) => { const l = d?.payload?.label ?? d?.label; if (l) onBar(l); } : undefined}>
            {highlight != null && points.map((p) => <Cell key={p.label} fill={p.label === highlight ? PALETTE.top3 : color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Figures side by side, as the dashboard lays a site's out: two to a row on a phone, all in one row with thin
 * dividers from the breakpoint that fits `cols`. Each child is one column (a MetricColumn, as a rule).
 */
export function MetricRow({ children, cols, testId }: { children: ReactNode; cols: 4 | 6; testId?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  const grid = cols === 6 ? "sm:grid-cols-3 xl:grid-cols-6" : "sm:grid-cols-2 lg:grid-cols-4";
  const divider = cols === 6 ? "xl:[&:not(:first-child)]:border-l" : "lg:[&:not(:first-child)]:border-l";
  return (
    <div className={`grid grid-cols-2 gap-x-3 gap-y-5 ${grid}`} data-testid={testId}>
      {items.map((c, i) => <div key={i} className={`min-w-0 border-[color:var(--g-divider)] px-1 sm:px-3 ${divider}`}>{c}</div>)}
    </div>
  );
}

/** A bordered card, the same surface as a dashboard card. */
export function Card({ children, className = "", testId, id }: { children: ReactNode; className?: string; testId?: string; /** An anchor a link can land on (links.ts `section`). */ id?: string }) {
  return <div id={id} className={`rounded-xl border p-3 sm:p-4 ${className}`} style={{ borderColor: "var(--g-divider)", background: "var(--g-surface)" }} data-testid={testId}>{children}</div>;
}

/** A section heading in blue, with room for a grey note after it. */
export function Heading({ children, note, className = "" }: { children: ReactNode; note?: ReactNode; className?: string }) {
  return <h3 className={`text-[14px] font-medium ${className}`} style={{ color: "var(--g-blue)" }}>{children}{note && <span className="g-text-2 text-[12px] font-normal"> · {note}</span>}</h3>;
}

/** The features of a Google results page, each as a small grey icon with its name. Keys are the keyword source's. */
const FEATURE_ICON: Record<string, typeof MapIcon> = {
  local_pack: MapIcon, people_also_ask: MessageCircleQuestion, featured_snippet: Star, images: ImageIcon, video: Video, paid: Megaphone,
  related_searches: Search, people_also_search: Users, knowledge_graph: Info, shopping: ShoppingBag, top_stories: Newspaper, ai_overview: Sparkles,
};
export function FeatureTag({ feature, label, href, testId }: { feature: string; label: string; /** Where the feature's evidence is (the saved results it was seen on). */ href?: string; testId?: string }) {
  const Icon = FEATURE_ICON[feature] ?? Link2;
  const cls = "g-text-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px]";
  if (href) return <Link href={href} className={`${cls} min-h-11 ${LINK_CUE}`} style={{ borderColor: "var(--g-divider)" }} data-testid={testId}><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{label}</Link>;
  return (
    <span className={`${cls} min-h-9`} style={{ borderColor: "var(--g-divider)" }} data-testid={testId}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{label}
    </span>
  );
}
