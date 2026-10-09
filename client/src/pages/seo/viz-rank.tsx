/**
 * Building blocks the Rank tracker screen adds to viz.tsx (which other screens share, so it is never changed from
 * here): blue headings, the orange ramp for the result-page bands, a compact position badge, a trend of positions
 * drawn with #1 at the top, and a trend panel that switches between the tracker's figures. Same rules as viz.tsx:
 * every figure is written out (the charts are decoration, aria-hidden), and an absent figure is "—", never made up.
 */
import { useId, useState, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compact, ORANGE, PALETTE, PositionBadge as Badge, TOOLTIP } from "./viz";

/** The result-page bands, best first: one orange, darkest for the top, and a plain grey for "not found". */
export const BANDS = [
  { key: "top3", label: "1–3", color: PALETTE.top3 },
  { key: "top10", label: "4–10", color: "#fb8c00" },
  { key: "top20", label: "11–20", color: PALETTE.top10 },
  { key: "top100", label: "21+", color: "#ffe0b2" },
  { key: "notRanked", label: "Not found", color: "#9aa0a6" },
] as const;

/** A card's border and background (neutrals that follow light and dark mode). */
export const CARD = { borderColor: "var(--g-divider)", background: "var(--g-surface)" } as const;
/** The tracker's tables: a size smaller and tighter than the default, column names in blue. Phones keep the card list. */
export const TABLE = "g-table w-full text-[13px] [&_th]:!text-[color:var(--g-blue)] sm:[&_td]:!py-1.5 sm:[&_th]:!py-1.5";

/** A section's heading, in blue like every label. */
export function SectionTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-[16px] font-medium ${className}`} style={{ color: "var(--g-blue)" }}>{children}</h2>;
}
/** A card's heading inside a section. */
export function PanelTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-[14px] font-medium ${className}`} style={{ color: "var(--g-blue)" }}>{children}</h3>;
}

/** A position as a small badge; not found within the pages read (`depth` results) as ">depth" in the quieter ink. */
export function PositionBadge({ position, depth }: { position: number | null; depth: number }) {
  if (position == null) return <span className="g-text-2 tabular-nums" title="Not within the result pages the check read">&gt;{depth}</span>;
  return <Badge value={position} />;
}

/** A trend of positions as an orange area with #1 at the top, so that up means better. `points` oldest first. */
export function PositionSpark({ points, height = 48, range = false }: { points: { label: string; value: number }[] | undefined; height?: number; /** The best and worst value beside the chart. */ range?: boolean }) {
  const id = useId().replace(/:/g, "");
  if (!points || points.length < 2) return <div style={{ height }} aria-hidden />;
  const vals = points.map((p) => p.value), best = Math.min(...vals), worst = Math.max(...vals);
  // A step of room above the best and below the worst, so a flat line is not glued to an edge.
  const top = Math.max(1, Math.floor(best) - 1), bottom = Math.ceil(worst) + 1;
  return (
    <div className="flex items-stretch gap-1.5" style={{ height }} aria-hidden>
      <div className="min-w-0 flex-1">
        <ResponsiveContainer>
          <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`p${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
                <stop offset="100%" stopColor={ORANGE} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis hide reversed domain={[top, bottom]} />
            <Tooltip cursor={{ stroke: ORANGE, strokeOpacity: 0.3 }} contentStyle={TOOLTIP} labelStyle={{ color: "var(--g-text-2)" }} formatter={(v: number) => [String(v), ""]} separator="" labelFormatter={(_, p) => (p?.[0]?.payload?.label as string) ?? ""} />
            <Area type="monotone" dataKey="value" baseValue={bottom} stroke={ORANGE} strokeWidth={2} fill={`url(#p${id})`} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {range && <div className="flex shrink-0 flex-col justify-between text-right text-[11px] tabular-nums" style={{ color: "var(--g-text-2)" }}><span>{best}</span><span>{worst}</span></div>}
    </div>
  );
}

type Series = {
  key: string; label: string; points: { label: string; value: number }[];
  /** How a value is written ("42%"); whole numbers otherwise. */ format?: (v: number) => string;
  /** Positions: #1 at the top, so up means better. */ reversed?: boolean;
  /** What this figure rests on, under the chart. */ note?: ReactNode;
};

/** A large orange trend with a switch between the tracker's figures (each a series of dated points, oldest first). */
export function RankTrendPanel({ series, title, testId }: { series: Series[]; title: string; testId?: string }) {
  const usable = series.filter((s) => s.points.length >= 2);
  const [key, setKey] = useState(usable[0]?.key ?? "");
  const id = useId().replace(/:/g, "");
  const s = usable.find((x) => x.key === key) ?? usable[0];
  if (!s) return null;
  const fmt = s.format ?? ((v: number) => compact(v));
  const first = s.points[0], last = s.points[s.points.length - 1];
  const vals = s.points.map((p) => p.value), lo = Math.min(...vals), hi = Math.max(...vals);
  // Positions get a step of room above the best and below the worst; every other figure starts at 0.
  const bottom = Math.ceil(hi) + 1;
  const domain: [number, number | "auto"] = s.reversed ? [Math.max(1, Math.floor(lo) - 1), bottom] : [0, "auto"];
  return (
    <div className="rounded-xl border p-3 sm:p-4" style={CARD} data-testid={testId}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PanelTitle>{title}</PanelTitle>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Figure shown">
          {usable.map((x) => (
            <button key={x.key} type="button" aria-pressed={x.key === s.key} onClick={() => setKey(x.key)} className="rounded-md border px-2.5 py-0.5 text-[12px] transition-colors"
              style={x.key === s.key ? { borderColor: "var(--g-blue)", color: "var(--g-blue)", background: "var(--g-accent-soft)" } : { borderColor: "var(--g-divider)", color: "var(--g-text-2)" }} data-testid={`${testId ?? "trend"}-${x.key}`}>{x.label}</button>
          ))}
        </div>
      </div>
      <p className="g-text-2 mb-1 text-[12px]">{s.label}: {fmt(first.value)} on {first.label} → <b className="g-text font-medium">{fmt(last.value)}</b> on {last.label}</p>
      <div className="h-44 sm:h-56" aria-hidden>
        <ResponsiveContainer>
          <AreaChart data={s.points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`r${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ORANGE} stopOpacity={0.35} />
                <stop offset="100%" stopColor={ORANGE} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--g-divider)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis reversed={!!s.reversed} domain={domain} tickFormatter={(v) => fmt(v)} tick={{ fontSize: 11, fill: "var(--g-text-2)" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip contentStyle={TOOLTIP} formatter={(v: number) => [fmt(v), s.label]} />
            <Area type="monotone" dataKey="value" baseValue={s.reversed ? bottom : 0} stroke={ORANGE} strokeWidth={2.5} fill={`url(#r${id})`} isAnimationActive={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {s.note && <p className="g-text-2 mt-1 text-[11px]">{s.note}</p>}
    </div>
  );
}
