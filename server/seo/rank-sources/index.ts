/** The rank sources and one run of the comparison over a site's tracked keywords (script/seo-rank-compare.ts). */
import { pool } from "../../db";
import { normalizeDomain } from "../dataforseo";
import { markdownReport, scoreSource, type Pair, type SourceScore } from "./compare";
import { cseSource } from "./google-cse";
import { dataforseoSource } from "./dataforseo";
import { gscSource } from "./gsc";
import { scrapeSource } from "./google-scrape";
import type { RankObservation, RankPlace, RankQuery, RankSource, SourceName, Device } from "./types";

export * from "./types";
export { markdownReport, scoreSource, jaccard } from "./compare";
export { gscSource, cseSource, scrapeSource, dataforseoSource };

export const SOURCES: Record<SourceName, RankSource> = { dataforseo: dataforseoSource, gsc: gscSource, cse: cseSource, scrape: scrapeSource };

/** A place from the rank tracker's list, with Google's canonical name (null = not on the list). */
export async function placeByCode(code: number): Promise<RankPlace | null> {
  const { rows: [r] } = await pool.query("SELECT code, name FROM seo_locations WHERE code=$1", [code]);
  if (!r) return null;
  const parts = String(r.name).split(",").map((p: string) => p.trim());
  if (parts[parts.length - 1] === "United States") parts.pop();
  return { code: r.code, label: parts.join(", "), canonical: r.name };
}

export type CompareRun = {
  site: string; device: Device; place: RankPlace | null; keywords: string[];
  sources: SourceName[]; skipped: { source: SourceName; why: string }[];
  scores: SourceScore[]; pairsBySource: Record<string, Pair[]>; baseline: RankObservation[]; report: string;
};

/** Every keyword through the baseline and each source in turn (sources one keyword at a time, gently: the scrape waits between pages). */
export async function runComparison(input: { domain: string; device?: Device; placeCode?: number | null; sources?: SourceName[]; limit?: number; pauseMs?: number; log?: (line: string) => void }): Promise<CompareRun> {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error("bad domain");
  const device = input.device ?? "desktop";
  const log = input.log ?? (() => {});
  const { rows: [site] } = await pool.query("SELECT id, user_id, domain, location_code, language_code FROM seo_sites WHERE domain=$1 ORDER BY id LIMIT 1", [domain]);
  if (!site) throw new Error(`no SEO site for ${domain}`);
  const { rows: kws } = await pool.query("SELECT keyword FROM seo_keywords WHERE site_id=$1 ORDER BY id LIMIT $2", [site.id, input.limit ?? 50]);
  const keywords: string[] = kws.map((r: any) => r.keyword);
  const place = input.placeCode ? await placeByCode(input.placeCode) : null;
  if (input.placeCode && !place) throw new Error(`place ${input.placeCode} is not on the list (open the rank tracker's place picker once to load it)`);
  const wanted = (input.sources ?? ["gsc", "cse", "scrape"]).filter((s) => s !== "dataforseo");
  const query = (keyword: string): RankQuery => ({ keyword, domain, userId: Number(site.user_id), device, place, countryCode: Number(site.location_code) || 2840, languageCode: site.language_code || "en" });

  const skipped: CompareRun["skipped"] = [];
  const sources: SourceName[] = [];
  for (const s of wanted) {
    const a = await SOURCES[s].available({ userId: Number(site.user_id), domain });
    if (a.ok) sources.push(s); else { skipped.push({ source: s, why: a.why ?? "unavailable" }); log(`skip ${s}: ${a.why}`); }
  }
  const base = await dataforseoSource.available({ userId: Number(site.user_id), domain });
  if (!base.ok) throw new Error(`baseline unavailable: ${base.why}`);

  const baseline: RankObservation[] = [];
  const pairsBySource: Record<string, Pair[]> = Object.fromEntries(sources.map((s) => [s, []]));
  for (const keyword of keywords) {
    const q = query(keyword);
    const b = await dataforseoSource.check(q);
    baseline.push(b);
    log(`${keyword}: baseline ${b.error ? `error ${b.error}` : b.position ?? "not found"}`);
    for (const s of sources) {
      const o = await SOURCES[s].check(q);
      pairsBySource[s].push({ baseline: b, obs: o });
      log(`${keyword}: ${s} ${o.error ? `error ${o.error}` : o.position ?? "not found"}${o.note ? ` — ${o.note}` : ""}`);
      if (s === "scrape") await new Promise((r) => setTimeout(r, input.pauseMs ?? 4000));
    }
  }
  const scores = sources.map((s) => scoreSource(SOURCES[s].label, pairsBySource[s]));
  const notes = skipped.map((k) => `${SOURCES[k.source].label}: skipped — ${k.why}`);
  const report = markdownReport({ site: domain, place, device, when: new Date().toISOString(), baselineLabel: dataforseoSource.label, scores, pairsBySource, notes });
  return { site: domain, device, place, keywords, sources, skipped, scores, pairsBySource, baseline, report };
}
