/**
 * Scoring the rank sources against the baseline, and the report. Pure.
 *
 * For each source, over the keywords both it and the baseline answered:
 *   found agree     both found the site, or both did not
 *   exact / ±2      the same position / within two places (over keywords both found)
 *   top-10 overlap  how many of the baseline's first-page domains the source also lists (Jaccard), where both have a page
 *   map pack agree  both say a map pack showed, or both say not (where both can tell)
 */
import type { RankObservation, SerpResult, SourceName } from "./types";

export type Pair = { baseline: RankObservation; obs: RankObservation };
export type SourceScore = {
  source: SourceName; label: string; asked: number; answered: number; errors: Record<string, number>;
  foundAgree: number; foundCompared: number;
  exact: number; within2: number; bothFound: number;
  overlapSum: number; overlapCompared: number;
  mapAgree: number; mapCompared: number;
  costUsd: number; msSum: number;
};

export function jaccard(a: SerpResult[], b: SerpResult[]): number {
  const A = new Set(a.map((r) => r.domain)), B = new Set(b.map((r) => r.domain));
  if (!A.size && !B.size) return 1;
  let both = 0;
  for (const d of A) if (B.has(d)) both++;
  return both / (A.size + B.size - both);
}

export function scoreSource(label: string, pairs: Pair[]): SourceScore {
  const s: SourceScore = { source: pairs[0]?.obs.source ?? "gsc", label, asked: pairs.length, answered: 0, errors: {}, foundAgree: 0, foundCompared: 0, exact: 0, within2: 0, bothFound: 0, overlapSum: 0, overlapCompared: 0, mapAgree: 0, mapCompared: 0, costUsd: 0, msSum: 0 };
  for (const { baseline, obs } of pairs) {
    s.costUsd += obs.costUsd; s.msSum += obs.ms;
    if (obs.error) { s.errors[obs.error] = (s.errors[obs.error] ?? 0) + 1; continue; }
    if (baseline.error) continue;
    s.answered++;
    s.foundCompared++;
    if ((baseline.position != null) === (obs.position != null)) s.foundAgree++;
    if (baseline.position != null && obs.position != null) {
      s.bothFound++;
      const d = Math.abs(baseline.position - obs.position);
      if (d === 0) s.exact++;
      if (d <= 2) s.within2++;
    }
    if (baseline.top.length && obs.top.length) { s.overlapCompared++; s.overlapSum += jaccard(baseline.top, obs.top); }
    if (baseline.mapPack != null && obs.mapPack != null) { s.mapCompared++; if (baseline.mapPack === obs.mapPack) s.mapAgree++; }
  }
  return s;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : "—");
const money = (usd: number) => (usd ? `$${usd.toFixed(4)}` : "free");

export function markdownReport(input: { site: string; place: { label: string } | null; device: string; when: string; baselineLabel: string; scores: SourceScore[]; pairsBySource: Record<string, Pair[]>; notes: string[] }): string {
  const L: string[] = [];
  L.push(`# Rank sources compared — ${input.site}${input.place ? ` from ${input.place.label}` : " (whole country)"}, ${input.device}`, "", `Run ${input.when}. Baseline: ${input.baselineLabel}.`, "");
  if (input.notes.length) { L.push("Notes:", ...input.notes.map((n) => `- ${n}`), ""); }
  L.push("| Source | Answered | Found agrees | Exact position | Within 2 | First-page overlap | Map pack agrees | Cost / check | Seconds / check |", "|---|---|---|---|---|---|---|---|---|");
  for (const s of input.scores) {
    const errs = Object.entries(s.errors).map(([e, n]) => `${e} ×${n}`).join(", ");
    L.push(`| ${s.label} | ${s.answered}/${s.asked}${errs ? ` (${errs})` : ""} | ${pct(s.foundAgree, s.foundCompared)} | ${pct(s.exact, s.bothFound)} | ${pct(s.within2, s.bothFound)} | ${s.overlapCompared ? `${Math.round((100 * s.overlapSum) / s.overlapCompared)}%` : "—"} | ${pct(s.mapAgree, s.mapCompared)} | ${money(s.asked ? s.costUsd / s.asked : 0)} | ${s.asked ? (s.msSum / s.asked / 1000).toFixed(1) : "—"} |`);
  }
  L.push("", "## Keyword by keyword", "");
  const sources = input.scores.map((s) => s.source);
  L.push(`| Keyword | ${input.baselineLabel} | ${input.scores.map((s) => s.label).join(" | ")} |`, `|---|---|${sources.map(() => "---").join("|")}|`);
  const first = input.pairsBySource[sources[0]] ?? [];
  for (let i = 0; i < first.length; i++) {
    const b = first[i].baseline;
    const cell = (o: RankObservation) => (o.error ? `_${o.error}_` : `${o.position ?? "not found"}${o.mapPack ? " · map" : ""}${o.note ? ` (${o.note})` : ""}`);
    L.push(`| ${b.keyword} | ${cell(b)} | ${sources.map((src) => cell(input.pairsBySource[src][i].obs)).join(" | ")} |`);
  }
  L.push("", "## First page, keyword by keyword (domains)", "");
  for (let i = 0; i < first.length; i++) {
    const b = first[i].baseline;
    L.push(`**${b.keyword}**`, `- ${input.baselineLabel}: ${b.top.map((r) => r.domain).join(", ") || "—"}`);
    for (const src of sources) { const o = input.pairsBySource[src][i].obs; if (o.top.length) L.push(`- ${input.scores.find((s) => s.source === src)!.label}: ${o.top.map((r) => r.domain).join(", ")}`); }
    L.push("");
  }
  return L.join("\n");
}
