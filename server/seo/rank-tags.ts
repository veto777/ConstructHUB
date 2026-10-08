/**
 * Rank tracker -> by tag: how each group of keywords (a service, a town — whatever the customer tags them with) does
 * on the newest check against the check before, on ONE device. From the saved checks only — free.
 *
 * What it rests on: one saved result per keyword, device and day (a later check the same day replaces the earlier
 * one), so "a check" here is a saved day. Each keyword's newest saved day on that device is compared with its own saved
 * day before — checks need not cover every keyword, so the dates both sides span are said. A change is measured only
 * on keywords with both, so a keyword added since never shows as a gain; those are counted apart. Visibility is the
 * history's index: 100 = every keyword first; weighted by search volume only when every keyword in the row has one
 * (else each keyword counts once — `weighted` says which).
 */
import { pool } from "../db";
import { summarizeChecks } from "./rank-history";

export type TagKeyword = { id: number; tags: string[]; volume: number | null };
export type TagRow = {
  /** null = keywords with no tag. */ tag: string | null; keywords: number;
  /** Of them, checked in the newest check (the figures below are of these). */ checked: number; ranked: number; top3: number; top10: number;
  averagePosition: number | null; visibility: number | null;
  /** Checked both times: the changes are measured on these alone. */ compared: number;
  /** The index weighted by search volume (every keyword in it has one), or each keyword counted once — for the current figure and, separately, for the change (its keywords are only those in both). */ weighted: boolean; changeWeighted: boolean | null;
  visibilityChange: number | null; top10Change: number | null;
  /** Average position now and before, of the keywords ranked both times (lower is better). */ positionNow: number | null; positionBefore: number | null; rankedBoth: number;
  /** Checked now and not in the check before (added since, or not answered then). */ newSince: number;
};
type Pos = Map<number, number | null>;

const summary = (ids: number[], pos: Pos, vol: Map<number, number | null>) =>
  summarizeChecks(ids.map((id) => ({ keywordId: id, checkedOn: "x", position: pos.get(id) ?? null, volume: vol.get(id) ?? null })))[0] ?? null;

/** Pure. `now` / `before`: each keyword's position in the newest check and the one before (null = checked, not ranked; absent = not checked). */
export function tagOverview(keywords: TagKeyword[], now: Pos, before: Pos | null): { all: TagRow; rows: TagRow[] } {
  const vol = new Map(keywords.map((k) => [k.id, k.volume] as const));
  const row = (tag: string | null, ids: number[]): TagRow => {
    const checked = ids.filter((id) => now.has(id));
    const s = checked.length ? summary(checked, now, vol) : null;
    const both = before ? checked.filter((id) => before.has(id)) : [];
    const sNow = both.length ? summary(both, now, vol) : null, sBefore = both.length && before ? summary(both, before, vol) : null;
    const rankedBoth = both.filter((id) => now.get(id) != null && before!.get(id) != null);
    const avg = (p: Pos) => (rankedBoth.length ? Math.round((rankedBoth.reduce((a, id) => a + (p.get(id) as number), 0) / rankedBoth.length) * 10) / 10 : null);
    return {
      tag, keywords: ids.length, checked: checked.length, ranked: s?.ranked ?? 0, top3: s?.top3 ?? 0, top10: s ? s.top3 + s.top10 : 0,
      averagePosition: s?.averagePosition ?? null, visibility: s ? s.visibility : null,
      compared: both.length, weighted: checked.length > 0 && checked.every((id) => (vol.get(id) ?? 0) > 0),
      changeWeighted: both.length ? both.every((id) => (vol.get(id) ?? 0) > 0) : null,
      visibilityChange: sNow && sBefore ? Math.round((sNow.visibility - sBefore.visibility) * 10) / 10 : null,
      top10Change: sNow && sBefore ? (sNow.top3 + sNow.top10) - (sBefore.top3 + sBefore.top10) : null,
      positionNow: avg(now), positionBefore: before ? avg(before) : null, rankedBoth: rankedBoth.length,
      newSince: before ? checked.length - both.length : 0,
    };
  };
  const tags = new Map<string, number[]>();
  for (const k of keywords) for (const t of new Set(k.tags)) (tags.get(t) ?? tags.set(t, []).get(t)!).push(k.id);
  const untagged = keywords.filter((k) => !k.tags.length).map((k) => k.id);
  const rows = [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, ids]) => row(t, ids));
  if (untagged.length && tags.size) rows.push(row(null, untagged));
  return { all: row("", keywords.map((k) => k.id)), rows };
}

export type CheckSpan = { from: string; to: string; keywords: number };
export type RankTags = { device: "desktop" | "mobile"; devices: ("desktop" | "mobile")[]; /** The device asked for is not one this site tracks: the first it tracks is shown. */ deviceFallback?: boolean;
  /** The dates each keyword's newest check spans, and the dates of the checks before them. */ now: CheckSpan | null; before: CheckSpan | null; all: TagRow; rows: TagRow[] };

/** The site must already be the account's (the route checks). */
export async function rankTags(site: { id: number; devices: string }, device?: "desktop" | "mobile" | null): Promise<RankTags> {
  const devices: ("desktop" | "mobile")[] = site.devices === "both" ? ["desktop", "mobile"] : [site.devices === "mobile" ? "mobile" : "desktop"];
  const dev = device && devices.includes(device) ? device : devices[0];
  const { rows: keywords } = await pool.query("SELECT id, tags, search_volume AS volume FROM seo_keywords WHERE site_id=$1 ORDER BY id", [site.id]);
  // Each keyword's newest saved day on this device and the saved day before it (one result per keyword, device and
  // day). Checks need not cover every keyword, so the comparison is made keyword by keyword and the dates it spans are returned.
  const { rows } = await pool.query(
    `SELECT keyword_id, position, checked_on::text AS on, n::int FROM (
       SELECT keyword_id, position, checked_on, row_number() OVER (PARTITION BY keyword_id ORDER BY checked_on DESC, id DESC) AS n
         FROM seo_rank_checks WHERE site_id=$1 AND device=$2) r WHERE n <= 2`, [site.id, dev]);
  const now: Pos = new Map(), before: Pos = new Map();
  const span = (n: number): CheckSpan | null => { const d = rows.filter((r: any) => r.n === n).map((r: any) => r.on as string).sort(); return d.length ? { from: d[0], to: d[d.length - 1], keywords: d.length } : null; };
  for (const r of rows) (r.n === 1 ? now : before).set(r.keyword_id, r.position);
  const kws: TagKeyword[] = keywords.map((k: any) => ({ id: k.id, tags: Array.isArray(k.tags) ? k.tags.filter((t: unknown) => typeof t === "string" && t) : [], volume: k.volume == null ? null : Number(k.volume) }));
  return { device: dev, devices, ...(device && device !== dev ? { deviceFallback: true } : {}), now: span(1), before: span(2), ...tagOverview(kws, now, before.size ? before : null) };
}
