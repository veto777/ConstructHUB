/**
 * Washington — WA Department of Revenue quarterly local sales & use tax rates.
 *
 * Source: the CSV DOR links from its "Local sales & use tax rate table" page
 * (dor.wa.gov/taxes-rates/sales-use-tax-rates/local-sales-use-tax/local-sales-use-tax-rate-table).
 * Every location code DOR publishes is loaded: cities and towns, each county's
 * unincorporated area, and the narrower PTBA / tribal-area codes ("special").
 * Columns: Rate change, County, Location name, Location code, Local rate,
 * State rate, Combined sales tax — rates as fractions (".0920"), some cells
 * wrapped in extra quotes ('"""3701"""').
 *
 * The effective period is read from the table page ("Quarter 4 - Effective
 * October 1 through December 31, 2026"); the load fails rather than guess it.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { parseCsv, toPct } from "../fetch-util";

export const WA_TABLE_PAGE =
  "https://dor.wa.gov/taxes-rates/sales-use-tax-rates/local-sales-use-tax/local-sales-use-tax-rate-table";
export const WA_CSV = "https://dor.wa.gov/taxes-rates/sales-use-tax-rates/lsu-quarterly-tax-rates.csv";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Quarter 4 - Effective October 1 through December 31, 2026" → { effectiveDate: "2026-10-01", periodLabel: "Q4 2026" }. */
export function parseWaPeriod(html: string): { effectiveDate: string; periodLabel: string } | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = text.match(/Quarter\s+([1-4])\s*-\s*Effective\s+([A-Za-z]+)\s+(\d{1,2})\s+through\s+[A-Za-z]+\s+\d{1,2},\s*(\d{4})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  if (!month) return null;
  const effectiveDate = `${m[4]}-${String(month).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  return { effectiveDate, periodLabel: `Q${m[1]} ${m[4]}` };
}

const clean = (s: string) => s.replace(/"/g, "").trim();

export function parseWaCsv(csv: string, effectiveDate: string): SalesTaxRow[] {
  const rows = parseCsv(csv);
  const header = rows[0].map((h) => clean(h).toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`WA CSV: column "${name}" missing (header: ${header.join(", ")})`);
    return i;
  };
  const iCounty = col("county"), iName = col("location name"), iCode = col("location code"), iCombined = col("combined sales tax");
  const out: SalesTaxRow[] = [];
  for (const r of rows.slice(1)) {
    const name = clean(r[iName] ?? "");
    const ratePct = toPct(clean(r[iCombined] ?? ""), true);
    if (!name || !Number.isFinite(ratePct)) continue;
    const county = clean(r[iCounty] ?? "") || null;
    const unincorporated = /County Unincorp\. Areas$/i.test(name);
    const special = !unincorporated && (/ - /.test(name) || /PTBA|Unincorp/i.test(name));
    out.push({
      state: "WA",
      city: unincorporated ? null : name,
      county,
      locationCode: clean(r[iCode] ?? "") || null,
      zip: null,
      kind: unincorporated ? "unincorporated" : special ? "special" : "city",
      ratePct,
      effectiveDate,
    });
  }
  return out;
}

export const waSource: SalesTaxSource = {
  states: ["WA"],
  name: "WA DOR",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const period = parseWaPeriod(await ctx.getText(WA_TABLE_PAGE));
    if (!period) throw new Error("WA: could not read the effective quarter from the DOR rate table page");
    const rows = parseWaCsv(await ctx.getText(WA_CSV), period.effectiveDate);
    if (rows.length < 300) throw new Error(`WA: only ${rows.length} locations parsed — refusing a partial table`);
    return [{
      state: "WA", sourceName: "WA DOR", sourceUrl: WA_CSV,
      effectiveDate: period.effectiveDate, periodLabel: period.periodLabel, rows,
    }];
  },
};
