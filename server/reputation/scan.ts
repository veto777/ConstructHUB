/**
 * Reading Google for a name (shared/reputation.ts): page 1–2 of results (organic, video, image packs, top
 * stories) and the autocomplete predictions, through DataForSEO's live SERP endpoints, then each result
 * labelled negative / neutral / positive and owned / third-party (server/reputation/ai.ts, keyword fallback).
 */
import { assertOk, request, taskItems, type DfsTask } from "../seo/dataforseo";
import {
  heuristicSentiment, normalizeQuery, playbookFor, reputationScore, scoreCounts, scoreGrade,
  type ItemKind, type RepResult, type RepScanReport, type RepSubjectKind,
} from "@shared/reputation";
import { classifyResults, type ClassifyInput } from "./ai";

export const US_LOCATION = 2840;
const cost = (t: DfsTask) => (typeof t.cost === "number" && Number.isFinite(t.cost) ? t.cost : 0);
const domainOf = (u: string | null | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };

type Raw = Omit<RepResult, "sentiment" | "control" | "reason" | "playbook">;

/** The results worth judging, in page order: organic, each video, each top story, and one entry per image pack. */
export function parseSerp(items: any[]): Raw[] {
  const out: Raw[] = [];
  for (const it of items) {
    const pos = Number(it?.rank_absolute ?? it?.rank_group ?? out.length + 1);
    if (it?.type === "organic") {
      out.push({ kind: "result", position: pos, url: it.url ?? null, domain: it.domain ?? domainOf(it.url), title: String(it.title ?? ""), snippet: String(it.description ?? "") });
    } else if (it?.type === "video" && Array.isArray(it.items)) {
      for (const v of it.items.slice(0, 4)) out.push({ kind: "video", position: pos, url: v.url ?? null, domain: domainOf(v.url), title: String(v.title ?? ""), snippet: String(v.source ?? "") });
    } else if (it?.type === "top_stories" && Array.isArray(it.items)) {
      for (const n of it.items.slice(0, 4)) out.push({ kind: "news", position: pos, url: n.url ?? null, domain: n.domain ?? domainOf(n.url), title: String(n.title ?? ""), snippet: String(n.source ?? "") });
    } else if (it?.type === "images" && Array.isArray(it.items)) {
      for (const im of it.items.slice(0, 6)) {
        const page = im.url ?? im.source_url ?? null;
        out.push({ kind: "image", position: pos, url: page, domain: domainOf(page), title: String(im.alt ?? im.title ?? "Image"), snippet: "" });
      }
    }
  }
  return out;
}

export async function fetchSerp(query: string, depth = 20): Promise<{ raw: Raw[]; costUsd: number }> {
  const res = await request("POST", "/serp/google/organic/live/advanced", [{
    keyword: query, location_code: US_LOCATION, language_code: "en", device: "desktop", os: "windows", depth,
  }]);
  const task = assertOk(res, { treatNoResultsAsEmpty: true });
  return { raw: parseSerp(taskItems(task)), costUsd: cost(task) };
}

export async function fetchAutocomplete(query: string): Promise<{ suggestions: string[]; costUsd: number }> {
  const res = await request("POST", "/serp/google/autocomplete/live/advanced", [{
    keyword: query, location_code: US_LOCATION, language_code: "en", client: "gws-wiz",
  }]);
  const task = assertOk(res, { treatNoResultsAsEmpty: true });
  const suggestions = taskItems(task).map((i: any) => String(i?.suggestion ?? "").trim()).filter(Boolean);
  return { suggestions: [...new Set(suggestions)].filter((s) => s.toLowerCase() !== query.toLowerCase()).slice(0, 15), costUsd: cost(task) };
}

/** One full scan of a name: results + predictions, classified and scored. */
export async function scanName(input: { query: string; kind: RepSubjectKind; ownedDomains?: string[] }): Promise<{ report: RepScanReport; costUsd: number }> {
  const query = normalizeQuery(input.query);
  const [serp, auto] = await Promise.all([fetchSerp(query), fetchAutocomplete(query)]);
  const owned = (input.ownedDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""));
  const toClassify: ClassifyInput[] = [
    ...serp.raw.map((r, i) => ({ id: `r${i}`, kind: r.kind, title: r.title, snippet: r.snippet, domain: r.domain, url: r.url })),
    ...auto.suggestions.map((s, i) => ({ id: `a${i}`, kind: "autocomplete" as ItemKind, title: s, snippet: "", domain: null, url: null })),
  ];
  const labels = await classifyResults(query, input.kind, toClassify);
  const results: RepResult[] = serp.raw.map((r, i) => {
    const l = labels.items.get(`r${i}`);
    const h = heuristicSentiment(`${r.title} ${r.snippet}`, r.domain);
    const isOwned = !!r.domain && owned.some((d) => r.domain === d || r.domain!.endsWith(`.${d}`));
    const sentiment = l?.sentiment ?? h.sentiment;
    return {
      ...r, sentiment, control: isOwned ? "owned" : l?.control ?? "third_party", reason: l?.reason ?? h.reason,
      playbook: sentiment === "negative" ? playbookFor(r.domain, r.kind) : null,
    };
  });
  const autocomplete = auto.suggestions.map((s, i) => {
    const l = labels.items.get(`a${i}`);
    const h = heuristicSentiment(s, null);
    return { suggestion: s, sentiment: l?.sentiment ?? h.sentiment, reason: l?.reason ?? h.reason };
  });
  const score = reputationScore(results, autocomplete);
  return {
    report: {
      query, kind: input.kind, checkedAt: new Date().toISOString(), results, autocomplete, score, grade: scoreGrade(score),
      counts: scoreCounts(results, autocomplete), classifier: labels.provider,
    },
    costUsd: serp.costUsd + auto.costUsd,
  };
}

/** Is the name listed on a people-search site? A site: search for the quoted name; a hit whose title carries the name counts. */
export async function findOnSite(domain: string, name: string): Promise<{ listed: boolean; url: string | null; title: string | null; costUsd: number }> {
  const res = await request("POST", "/serp/google/organic/live/advanced", [{
    keyword: `site:${domain} "${name.replace(/"/g, "")}"`, location_code: US_LOCATION, language_code: "en", device: "desktop", os: "windows", depth: 10,
  }]);
  const task = assertOk(res, { treatNoResultsAsEmpty: true });
  const parts = name.toLowerCase().split(/\s+/).filter((p) => p.length > 1);
  const hit = taskItems(task).find((i: any) => i?.type === "organic" && parts.every((p) => `${i.title ?? ""} ${i.description ?? ""}`.toLowerCase().includes(p)));
  return { listed: !!hit, url: hit?.url ?? null, title: hit?.title ?? null, costUsd: cost(task) };
}
