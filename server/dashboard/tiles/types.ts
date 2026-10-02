import type { DashboardLink, DashboardMetric, DashboardTileKey } from "@shared/dashboard";
import type { DashboardContext } from "../context";

/**
 * What a tile source answers. "ok" carries at least one metric (the link-only
 * tiles excepted); "empty" means entitled but never set up — no metrics, a
 * setup CTA. Throwing (or running past the budget) makes the tile "error".
 */
export type TileOutcome =
  | { status: "ok"; metrics: DashboardMetric[]; cta?: DashboardLink }
  | { status: "empty"; cta?: DashboardLink; message?: string };

export type TileSource = (ctx: DashboardContext) => Promise<TileOutcome>;
export type TileSources = Partial<Record<DashboardTileKey, TileSource>>;

export const ok = (metrics: DashboardMetric[], cta?: DashboardLink): TileOutcome => ({ status: "ok", metrics, ...(cta ? { cta } : {}) });
export const EMPTY: TileOutcome = { status: "empty" };

export const metric = (
  key: string, label: string, value: DashboardMetric["value"], format: DashboardMetric["format"], extra: Partial<DashboardMetric> = {},
): DashboardMetric => {
  const out: DashboardMetric = { key, label, value, format };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) (out as any)[k] = v;
  return out;
};

/** A count where any is worth a look ("Need attention"): good at 0, warn above. */
export const watch = (n: number): DashboardMetric["tone"] => (n > 0 ? "warn" : "good");

/** pg count/sum results arrive as strings for bigint/numeric: a finite number, else null. */
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const int = (v: unknown): number => num(v) ?? 0;
export const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
