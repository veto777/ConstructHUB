/**
 * Run-time detail for the coverage page (/compliance/research/coverage): what each loaded daily file is really indexed
 * by. The rest of the page comes from the build-time manifest (./coverage-manifest.ts); a file's identifiers can only
 * be read from its loaded rows. Server-safe: no network guard here.
 */
import type { EnforcementCategory } from "@shared/research-reports";
import {
  KIND_OF_CATEGORY, COVERAGE_ID_ORDER, COVERAGE_KIND_ORDER, type CoverageFacets, type CoverageId, type CoverageKind,
} from "@shared/research-coverage";
import { pool } from "../db";
import { bulkSchemaReady } from "./bulk";

const sortIds = (ids: Iterable<CoverageId>) => COVERAGE_ID_ORDER.filter((i) => new Set(ids).has(i));
const sortKinds = (kinds: Iterable<CoverageKind>) => COVERAGE_KIND_ORDER.filter((k) => new Set(kinds).has(k));

// ── Run-time facets of the daily files ────────────────────────────────────────────────────────────────────────────

const FACET_SAMPLE = 3000;
let facetCache: { at: number; data: CoverageFacets } | null = null;

/**
 * What each loaded file is really indexed by: "b:" words (business name), "p:" (people), "l:" / "t:" / "a:" keys,
 * and the enforcement categories of its records. A load records these over every row (research_bulk_sources.facets);
 * a file loaded before that is read from a sample of its rows until its next load. A category the page has no label
 * for counts as "other" rather than disappearing. Cached for six hours.
 */
export async function coverageFacets(): Promise<CoverageFacets> {
  if (facetCache && Date.now() - facetCache.at < 6 * 3600_000) return facetCache.data;
  await bulkSchemaReady();
  const { rows: srcs } = await pool.query(`SELECT id, generation, row_count, loaded_at, facets FROM research_bulk_sources WHERE loaded_at IS NOT NULL`);
  const data: CoverageFacets = {};
  const kindOf = (c: string) => (c === "license" ? "licenses" : c in KIND_OF_CATEGORY ? KIND_OF_CATEGORY[c as EnforcementCategory] : "other");
  const idOf: Record<string, CoverageId> = { "b:": "name", "p:": "owner", "l:": "license", "t:": "phone", "a:": "address" };
  for (const s of srcs) {
    const loadedAt = s.loaded_at ? new Date(s.loaded_at).toISOString().slice(0, 10) : null;
    if (s.facets?.prefixes) {
      const ids = (s.facets.prefixes as string[]).map((p) => idOf[p]).filter(Boolean);
      data[s.id] = { rows: Number(s.row_count), loadedAt, ids: sortIds(ids), kinds: sortKinds((s.facets.kinds as string[]).map(kindOf)) };
      continue;
    }
    const { rows } = await pool.query(
      `SELECT words, hit->>'k' AS k, hit->'h'->>'category' AS c FROM research_bulk_rows WHERE source = $1 AND generation = $2 LIMIT $3`,
      [s.id, s.generation, FACET_SAMPLE],
    );
    const ids = new Set<CoverageId>(), kinds = new Set<CoverageKind>();
    for (const r of rows) {
      for (const w of r.words as string[]) {
        const p = w.slice(0, 2);
        if (p === "b:") ids.add("name"); else if (p === "p:") ids.add("owner");
        else if (p === "l:") ids.add("license"); else if (p === "t:") ids.add("phone"); else if (p === "a:") ids.add("address");
      }
      kinds.add(kindOf(r.k === "license" ? "license" : r.c ?? "other"));
    }
    data[s.id] = { rows: Number(s.row_count), loadedAt, ids: sortIds(ids), kinds: sortKinds(kinds) };
  }
  facetCache = { at: Date.now(), data };
  return data;
}
