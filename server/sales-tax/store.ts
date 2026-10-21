/**
 * Official sales-tax rates in Postgres: load a state's table, seed from the
 * bundled file at boot, and look a job-site city up.
 *
 * Tables (server/sales-tax/schema.ts, shared/schema.ts):
 *   sales_tax_rates       one row per published location (city / unincorporated
 *                         county / county / statewide / special district)
 *   sales_tax_rate_loads  one row per loaded state: source, file URL, effective
 *                         date, period label, row count, content hash, origin
 *
 * A state's rows are only ever replaced as a whole, inside one transaction, and
 * only by a table that is newer (effective date) or a correction of the same
 * period (same date, different content). So the boot seed from the bundled
 * server/data/sales-tax-rates.json never rolls back a newer quarter that the
 * refresh job (refresh-cli.ts) already loaded in production.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { ensureSalesTaxSchema } from "./schema";
import { cityKey } from "./city-key";
import { pctToBps, type SalesTaxRow, type SalesTaxSourceResult } from "./types";

/** Bundled file: compact rows so the full national table stays small. */
export type BundledSalesTaxFile = {
  generatedAt: string;
  states: Array<Omit<SalesTaxSourceResult, "rows"> & {
    /** [city, county, locationCode, zip, kind, ratePct, effectiveDate] */
    rows: Array<[string | null, string | null, string | null, string | null, SalesTaxRow["kind"], number, string]>;
  }>;
};

export function packResult(r: SalesTaxSourceResult): BundledSalesTaxFile["states"][number] {
  return {
    state: r.state, sourceName: r.sourceName, sourceUrl: r.sourceUrl, effectiveDate: r.effectiveDate,
    periodLabel: r.periodLabel, ...(r.notes ? { notes: r.notes } : {}),
    rows: r.rows.map((x) => [x.city, x.county, x.locationCode, x.zip, x.kind, x.ratePct, x.effectiveDate]),
  };
}

export function unpackResult(s: BundledSalesTaxFile["states"][number]): SalesTaxSourceResult {
  return {
    ...s,
    rows: s.rows.map(([city, county, locationCode, zip, kind, ratePct, effectiveDate]) => ({
      state: s.state, city, county, locationCode, zip, kind, ratePct, effectiveDate,
    })),
  };
}

export function contentHash(r: SalesTaxSourceResult): string {
  const canon = r.rows
    .map((x) => [x.city, x.county, x.locationCode, x.zip, x.kind, x.ratePct, x.effectiveDate].join("|"))
    .sort().join("\n");
  return createHash("sha256").update(`${r.state}\n${r.effectiveDate}\n${canon}`).digest("hex").slice(0, 32);
}

export type LoadOutcome = "loaded" | "unchanged" | "older";

/**
 * Replace one state's rows with `r` when it is newer than (or a correction of)
 * what is loaded. Returns what happened. All-or-nothing per state.
 */
export async function loadStateRates(
  pool: Pool, r: SalesTaxSourceResult, origin: "bundled" | "refresh", opts: { force?: boolean } = {},
): Promise<LoadOutcome> {
  if (!/^[A-Z]{2}$/.test(r.state)) throw new Error(`bad state code "${r.state}"`);
  for (const x of r.rows) {
    if (x.state !== r.state) throw new Error(`${r.state}: row for ${x.state} in the wrong table`);
    if (!Number.isFinite(x.ratePct) || x.ratePct < 0 || x.ratePct > 30) throw new Error(`${r.state}: rate ${x.ratePct} out of range (${x.city ?? x.county})`);
  }
  const hash = contentHash(r);
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      "SELECT effective_date::text AS d, content_hash FROM sales_tax_rate_loads WHERE state = $1 FOR UPDATE", [r.state]);
    const prev = cur.rows[0] as { d: string; content_hash: string } | undefined;
    if (prev && !opts.force) {
      if (prev.d > r.effectiveDate) { await client.query("ROLLBACK"); return "older"; }
      if (prev.d === r.effectiveDate && prev.content_hash === hash) { await client.query("ROLLBACK"); return "unchanged"; }
    }
    await client.query("DELETE FROM sales_tax_rates WHERE state = $1", [r.state]);
    const B = 1000;
    for (let i = 0; i < r.rows.length; i += B) {
      const chunk = r.rows.slice(i, i + B);
      await client.query(
        `INSERT INTO sales_tax_rates (state, city, city_key, county, location_code, zip, kind, rate_pct, rate_bps,
           effective_date, source, source_url, period_label)
         SELECT $1, j.city, j.city_key, j.county, j.location_code, j.zip, j.kind, j.rate_pct, j.rate_bps,
           j.effective_date::date, $2, $3, $4
         FROM jsonb_to_recordset($5::jsonb) AS j(city text, city_key text, county text, location_code text, zip text,
           kind text, rate_pct numeric, rate_bps integer, effective_date text)`,
        [r.state, r.sourceName, r.sourceUrl, r.periodLabel, JSON.stringify(chunk.map((x) => ({
          city: x.city, city_key: x.city ? cityKey(x.city) : null, county: x.county, location_code: x.locationCode,
          zip: x.zip, kind: x.kind, rate_pct: x.ratePct, rate_bps: pctToBps(x.ratePct), effective_date: x.effectiveDate,
        })))],
      );
    }
    await client.query(
      `INSERT INTO sales_tax_rate_loads (state, source, source_url, effective_date, period_label, row_count, content_hash, origin, loaded_at)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8, now())
       ON CONFLICT (state) DO UPDATE SET source = EXCLUDED.source, source_url = EXCLUDED.source_url,
         effective_date = EXCLUDED.effective_date, period_label = EXCLUDED.period_label, row_count = EXCLUDED.row_count,
         content_hash = EXCLUDED.content_hash, origin = EXCLUDED.origin, loaded_at = now()`,
      [r.state, r.sourceName, r.sourceUrl, r.effectiveDate, r.periodLabel, r.rows.length, hash, origin],
    );
    await client.query("COMMIT");
    return "loaded";
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export const BUNDLED_FILE = "sales-tax-rates.json";

export function readBundledFile(dir: string): BundledSalesTaxFile | null {
  const p = join(dir, BUNDLED_FILE);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as BundledSalesTaxFile;
}

/** Boot: create the tables and load every bundled state that is newer than the database's copy. */
export async function seedSalesTaxRates(pool: Pool, dataDir: string): Promise<void> {
  await ensureSalesTaxSchema(pool);
  const file = readBundledFile(dataDir);
  if (!file) return;
  const loaded: string[] = [];
  for (const s of file.states) {
    try {
      if ((await loadStateRates(pool, unpackResult(s), "bundled")) === "loaded") loaded.push(`${s.state} ${s.periodLabel} (${s.rows.length})`);
    } catch (e: any) {
      console.error(`[sales-tax] could not load bundled ${s.state} rates: ${e?.message ?? e}`);
    }
  }
  if (loaded.length) console.log(`[sales-tax] loaded official rates: ${loaded.join(", ")}`);
}

// ── Lookup ────────────────────────────────────────────────────────────────

export type OfficialRate = {
  state: string;
  city: string | null;
  county: string | null;
  locationCode: string | null;
  kind: string;
  ratePct: number;
  rateBps: number;
  effectiveDate: string;
  source: string;
  sourceUrl: string;
  periodLabel: string;
  /** The city has several published rates (multi-county city, districts) and none matched the ZIP. */
  varies: boolean;
  /** "address": WA DOR placed the street address in this location code (wa-address.ts); else matched by city name. */
  matchedBy?: "address" | "city";
  /** The taxing jurisdiction's name when it isn't the mailing city ("Whatcom County Unincorp. PTBA"). */
  jurisdiction?: string | null;
};

export type OfficialLookup = {
  /** The state has an official table loaded at all. */
  loaded: boolean;
  match: OfficialRate | null;
};

type RateRowDb = {
  state: string; city: string | null; county: string | null; location_code: string | null; zip: string | null;
  kind: string; rate_pct: string; rate_bps: number; effective_date: string; source: string; source_url: string; period_label: string;
};

const toOfficial = (r: RateRowDb, varies: boolean): OfficialRate => ({
  state: r.state, city: r.city, county: r.county, locationCode: r.location_code, kind: r.kind,
  ratePct: Number(r.rate_pct), rateBps: r.rate_bps, effectiveDate: r.effective_date, source: r.source,
  sourceUrl: r.source_url, periodLabel: r.period_label, varies,
});

/**
 * Pick the row for a city among the state's candidates (pure; tested). Prefers
 * a ZIP match, then the plain city row; several distinct rates left → the most
 * common one (ties: the higher), flagged `varies`.
 */
export function pickCityRow<T extends { zip: string | null; kind: string; rate_bps: number; county?: string | null }>(
  rows: T[], zip?: string | null, county?: string | null,
): { row: T; varies: boolean } | null {
  if (!rows.length) return null;
  let pool = rows;
  const z = (zip ?? "").slice(0, 5);
  if (z && pool.some((r) => r.zip === z)) pool = pool.filter((r) => r.zip === z);
  const c = (county ?? "").trim().toLowerCase().replace(/\s+county$/, "");
  if (c && pool.some((r) => (r.county ?? "").toLowerCase() === c)) pool = pool.filter((r) => (r.county ?? "").toLowerCase() === c);
  if (pool.some((r) => r.kind === "city")) pool = pool.filter((r) => r.kind === "city");
  const rates = new Map<number, number>();
  for (const r of pool) rates.set(r.rate_bps, (rates.get(r.rate_bps) ?? 0) + 1);
  if (rates.size === 1) return { row: pool[0], varies: false };
  const [best] = [...rates.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  return { row: pool.find((r) => r.rate_bps === best[0])!, varies: true };
}

const SELECT_ROW = `SELECT state, city, county, location_code, zip, kind, rate_pct::text, rate_bps, effective_date::text,
  source, source_url, period_label FROM sales_tax_rates`;

/** One location code's row (WA DOR codes are unique per state). */
export async function lookupByLocationCode(pool: Pool, state: string, code: string): Promise<OfficialRate | null> {
  const r = (await pool.query(`${SELECT_ROW} WHERE state = $1 AND location_code = $2 LIMIT 1`, [state, code])).rows as RateRowDb[];
  return r[0] ? toOfficial(r[0], false) : null;
}

export async function lookupOfficialRate(
  pool: Pool, args: { state: string; city?: string | null; zip?: string | null; county?: string | null },
): Promise<OfficialLookup> {
  const state = args.state.trim().toUpperCase();
  const load = await pool.query("SELECT 1 FROM sales_tax_rate_loads WHERE state = $1", [state]);
  if (!load.rowCount) return { loaded: false, match: null };
  const key = args.city ? cityKey(args.city) : "";
  if (key) {
    const rows = (await pool.query(`${SELECT_ROW} WHERE state = $1 AND city_key = $2`, [state, key])).rows as RateRowDb[];
    const picked = pickCityRow(rows, args.zip, args.county);
    if (picked) return { loaded: true, match: toOfficial(picked.row, picked.varies) };
  }
  // A ZIP-keyed table can still place an address whose city name is not in it.
  const z = (args.zip ?? "").slice(0, 5);
  if (/^\d{5}$/.test(z)) {
    const rows = (await pool.query(`${SELECT_ROW} WHERE state = $1 AND zip = $2`, [state, z])).rows as RateRowDb[];
    const picked = pickCityRow(rows, z, args.county);
    if (picked) return { loaded: true, match: toOfficial(picked.row, picked.varies) };
  }
  // One statewide rate (no local sales taxes): every address in the state gets it.
  const statewide = (await pool.query(`${SELECT_ROW} WHERE state = $1 AND kind = 'state' LIMIT 1`, [state])).rows as RateRowDb[];
  if (statewide[0]) return { loaded: true, match: toOfficial(statewide[0], false) };
  return { loaded: true, match: null };
}
