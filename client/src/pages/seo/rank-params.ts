/**
 * The rank tracker's address, read once for the whole screen (client/src/pages/seo/index.tsx and its panels). The
 * parameters are the ones seoLinks.rankTracker (links.ts) writes: a figure's link and a filter picked on the page are
 * the same address, so the back button undoes either. The predicates here match the server's own figures
 * (server/seo/routes.ts overview summary, server/seo/rank-history.ts bands), so a figure lands on exactly its rows.
 */
import { useMemo } from "react";
import { useSearch } from "wouter";
import type { Movement, PositionBand, seoLinks } from "./links";

export type Device = "desktop" | "mobile";
export type RankTo = NonNullable<Parameters<typeof seoLinks.rankTracker>[1]>;
/** The newest saved position of one keyword on one device (the rank tracker's row shape). */
export type RowPosition = { position: number | null; previous: number | null; previousOn: string | null; features: string[]; local?: number | null; pack?: unknown[] };

const BANDS: readonly PositionBand[] = ["top3", "top10", "top20", "top50", "top100", "rest", "notFound"];
const MOVES: readonly Movement[] = ["up", "down", "new", "lost", "unchanged"];
/** `tag` for keywords that carry no tag (a real tag is free text, so a bracketed word that is not a tag). */
export const NO_TAG = "(none)";
const flag = (v: string | null) => ["1", "true", "yes"].includes(v ?? "");

export type Slice = { from: number; to: number | null };
/** "4-10" → 4..10, "21+" or "21-" → 21 and lower on the page. */
export const parseSlice = (s: string | null): Slice | null => {
  if (!s) return null;
  const m = /^(\d+)(?:-(\d*)|\+)$/.exec(s.trim());
  if (!m) return null;
  const from = Number(m[1]), to = m[2] ? Number(m[2]) : null;
  return from >= 1 && (to == null || to >= from) ? { from, to } : null;
};
/** `feature` as a list ("ai_overview,local_pack"): every one named must show. */
export const parseFeatures = (s: string | null): string[] => (s ? [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))] : []);
/** The list with one more feature, as the parameter is written. */
export const withFeature = (current: string | null | undefined, add: string): string => parseFeatures(current ?? null).concat(parseFeatures(current ?? null).includes(add) ? [] : [add]).join(",");

export type RankParams = {
  site: number | null; band: PositionBand | null; positions: Slice | null; positionsRaw: string | null; move: Movement | null; tag: string | null; keyword: string | null;
  device: Device | null; mapPack: boolean; noMap: boolean; checked: boolean; noVolume: boolean; feature: string | null; features: string[]; location: string | null; sort: "position" | null;
  panel: string | null; series: string | null; date: string | null;
  gsc: "page" | "query" | null; gscSort: "clicks" | "gain" | "loss" | null; gscAll: boolean; group: number | null; groupsAll: boolean; competing: number | null; competingShow: "changed" | "variants" | null;
  /** The table is narrowed or ordered (a chip is shown). */ narrowed: boolean;
};

/** The address's parameters, re-read whenever it changes (a link on the page, setParam, or the back button). */
export function useRankParams(): RankParams {
  const search = useSearch();
  return useMemo(() => parseRankParams(search), [search]);
}

/** The same, from a query string (pure, for tests). */
export function parseRankParams(search: string): RankParams {
  const p = new URLSearchParams(search);
  const pick = <T extends string>(name: string, allowed: readonly T[]): T | null => { const v = p.get(name); return v && (allowed as readonly string[]).includes(v) ? (v as T) : null; };
  const text = (name: string) => { const v = p.get(name)?.trim(); return v ? v : null; };
  const id = (name: string) => { const n = Number(p.get(name)); return Number.isInteger(n) && n > 0 ? n : null; };
  const feature = text("feature");
  const r: Omit<RankParams, "narrowed"> = {
    site: id("site"),
    band: pick("band", BANDS), positions: parseSlice(p.get("positions")), positionsRaw: text("positions"), move: pick("move", MOVES), tag: text("tag"), keyword: text("keyword"),
    device: pick("device", ["desktop", "mobile"] as const), mapPack: flag(p.get("mapPack")), noMap: flag(p.get("noMap")), checked: flag(p.get("checked")), noVolume: flag(p.get("noVolume")), feature, features: parseFeatures(feature), location: text("location"), sort: pick("sort", ["position"] as const),
    panel: text("panel"), series: text("series"), date: text("date"),
    gsc: pick("gsc", ["page", "query"] as const), gscSort: pick("gscSort", ["clicks", "gain", "loss"] as const), gscAll: flag(p.get("gscAll")), group: id("group"), groupsAll: flag(p.get("groupsAll")), competing: id("competing"), competingShow: pick("competingShow", ["changed", "variants"] as const),
  };
  return { ...r, narrowed: !!(r.band || r.positions || r.move || r.tag || r.keyword || r.mapPack || r.noMap || r.checked || r.noVolume || r.feature || r.location || r.sort) };
}

/**
 * The table's current narrowing as the builder takes it, so a count made over the narrowed rows links to those rows and
 * not to a fresh, wider view (audit §3.2). `keyword` (a highlight) and `panel` are not narrowing and are left out.
 */
export function scopeOf(p: RankParams): RankTo {
  const s: RankTo = {};
  if (p.device) s.device = p.device;
  if (p.band) s.band = p.band;
  if (p.positionsRaw && p.positions) s.positions = p.positionsRaw;
  if (p.move) s.move = p.move;
  if (p.tag) s.tag = p.tag;
  if (p.mapPack) s.mapPack = true;
  if (p.noMap) s.noMap = true;
  if (p.checked) s.checked = true;
  if (p.noVolume) s.noVolume = true;
  if (p.feature) s.feature = p.feature;
  if (p.location) s.location = p.location;
  if (p.sort) s.sort = p.sort;
  return s;
}

/**
 * The current address with some parameters changed — for a control inside a panel that is a real link (a tab, "show
 * all", an opened row): everything else in the address stays, so the table's narrowing survives a panel's own pick.
 * An empty value removes the parameter.
 */
export function hrefWith(values: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) { if (v == null || v === "" || v === false) p.delete(k); else p.set(k, String(v)); }
  const s = p.toString();
  return `${window.location.pathname}${s ? `?${s}` : ""}`;
}

/** The device the table reads when the address names one the site tracks; the site's first otherwise. */
export const effectiveDevice = (p: RankParams, devices: readonly Device[]): Device => (p.device && devices.includes(p.device) ? p.device : devices[0]);

/** A map pack is known three ways (the feature list, the saved pack, the site's own place in it): any of them counts. */
export const showsMapPack = (p: RowPosition | null | undefined) => !!p && (p.features?.includes("local_pack") || (p.pack?.length ?? 0) > 0 || p.local != null);

/** The position bands as the server counts them: cumulative "top N"; `rest` is everything checked that is not in the top 10. */
export function inBand(p: RowPosition | null | undefined, band: PositionBand): boolean {
  if (!p) return false;
  const n = p.position;
  switch (band) {
    case "top3": return n != null && n <= 3;
    case "top10": return n != null && n <= 10;
    case "top20": return n != null && n <= 20;
    case "top50": return n != null && n <= 50;
    case "top100": return n != null && n <= 100;
    case "rest": return n == null || n > 10;
    case "notFound": return n == null;
  }
}
export const inSlice = (p: RowPosition | null | undefined, s: Slice) => !!p && p.position != null && p.position >= s.from && (s.to == null || p.position <= s.to);

/**
 * Movement since the check before, as the overview counts "improved" / "declined" (server/seo/routes.ts): entering the
 * results counts as up and dropping out as down. `new` is a keyword with no position from the check before — first
 * checked now, or not found then; `lost` was found then and not now; `unchanged` sits where it sat.
 */
export function moved(p: RowPosition | null | undefined, m: Movement): boolean {
  if (!p) return false;
  const now = p.position, before = p.previous, had = !!p.previousOn;
  switch (m) {
    case "up": return had && now != null && (before == null || now < before);
    case "down": return had && before != null && (now == null || now > before);
    case "new": return now != null && (!had || before == null);
    case "lost": return had && before != null && now == null;
    case "unchanged": return had && now != null && before != null && now === before;
  }
}

/** The table's rows that the address keeps (the keyword parameter highlights; it never narrows). */
export function keepsRow<R extends { tags: string[]; location?: string | null; searchVolume?: number | null; positions: Record<string, RowPosition | null> }>(r: R, p: RankParams, device: Device): boolean {
  const pos = r.positions[device];
  if (p.band && !inBand(pos, p.band)) return false;
  if (p.positions && !inSlice(pos, p.positions)) return false;
  if (p.move && !moved(pos, p.move)) return false;
  if (p.tag && (p.tag === NO_TAG ? r.tags.length > 0 : !r.tags.includes(p.tag))) return false;
  if (p.mapPack && !showsMapPack(pos)) return false;
  if (p.noMap && (!pos || showsMapPack(pos))) return false;
  if (p.checked && !pos) return false;
  if (p.noVolume && r.searchVolume != null) return false;
  if (p.location && (r.location ?? null) !== p.location) return false;
  for (const f of p.features) if (!(f === "local_pack" ? showsMapPack(pos) : !!pos?.features?.includes(f))) return false;
  return true;
}

const BAND_WORDS: Record<PositionBand, string> = {
  top3: "in the top 3", top10: "in the top 10", top20: "in the top 20", top50: "in the top 50", top100: "in the top 100",
  rest: "not in the top 10 (11th or lower, or not found)", notFound: "not found in the pages read",
};
const MOVE_WORDS: Record<Movement, string> = {
  up: "up since the check before (newly found ones included)", down: "down since the check before (ones no longer found included)",
  new: "new since the check before (first checked now, or not found then)", lost: "no longer found since the check before", unchanged: "at the same position as the check before",
};
export const sliceWords = (s: Slice) => (s.to == null ? `at position ${s.from} or lower` : `in positions ${s.from}–${s.to}`);

/**
 * What the chip says (data-testid="active-filter"): the narrowing in the words a visitor reads, e.g. "Keywords in the
 * top 3, tagged “roofing” · desktop". `featureWords` names a SERP feature ("a map pack", "an AI overview").
 */
export function narrowingWords(p: RankParams, device: Device | null, featureWords: (t: string) => string, /** The address names a device the site does not track: the chip says so, and which one is shown instead. */ untracked: Device | null = null): string {
  const parts: string[] = [];
  if (p.band) parts.push(BAND_WORDS[p.band]);
  if (p.positions) parts.push(sliceWords(p.positions));
  if (p.move) parts.push(MOVE_WORDS[p.move]);
  if (p.tag) parts.push(p.tag === NO_TAG ? "with no tag" : `tagged “${p.tag}”`);
  if (p.location) parts.push(`checked from “${p.location}”`);
  if (p.checked) parts.push("with a saved check");
  if (p.noVolume) parts.push("with no monthly search volume yet");
  const shows = p.features.filter((f) => f !== "local_pack").map(featureWords);
  if (p.mapPack || p.features.includes("local_pack")) shows.unshift("a map pack");
  if (shows.length) parts.push(`whose results show ${shows.length > 1 ? `${shows.slice(0, -1).join(", ")} and ${shows[shows.length - 1]}` : shows[0]}`);
  if (p.noMap) parts.push("whose results show no map pack");
  if (p.sort) parts.push("ordered by position, best first");
  let words = parts.length ? `Keywords ${parts.join(", ")}` : "All keywords";
  if (p.keyword) words += ` — “${p.keyword}” highlighted`;
  if (untracked && device) return `${words} · ${device} (${untracked} is not tracked for this site)`;
  return device ? `${words} · ${device}` : words;
}

/** The History panel's figures, as its chip names them (the `series` parameter). */
export const SERIES_WORDS: Record<string, string> = { visibility: "Visibility", position: "Average position", top3: "In the top 3", top10: "In the top 10", map: "In the map pack" };

/** Where `panel` lands: the data-testid of each section (and "keywords" for the table). */
export const PANEL_TARGET: Record<string, string> = {
  history: "rank-history", tags: "rank-tags", competitors: "rank-competitors", groups: "serp-groups", gsc: "gsc-breakdown", competing: "rank-competing", keywords: "rank-filter", table: "rank-filter",
};

/** Scroll to an element by its test id once it is on the page (panels render after their own request). */
export function scrollToTestId(id: string, tries = 20): () => void {
  let cancelled = false, timer = 0;
  const attempt = (left: number) => {
    if (cancelled) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (left > 0) timer = window.setTimeout(() => attempt(left - 1), 150);
  };
  attempt(tries);
  return () => { cancelled = true; window.clearTimeout(timer); };
}

/** The host and path of a ranking page, for the site explorer's pages view ("explorer pages with path"). */
export function pageParts(url: string): { domain: string; path: string } | null {
  try { const u = new URL(url); return { domain: u.hostname.replace(/^www\./, ""), path: (u.pathname + u.search) || "/" }; } catch { return null; }
}

/** A timestamp's UTC day ("2026-10-08"), the day a check is filed under (the history's dates). */
export const utcDay = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toISOString().slice(0, 10); };

/** A tag as part of a test id: letters, digits and dashes only, so two tags never make one id. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
