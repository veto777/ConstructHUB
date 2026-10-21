/**
 * California — CDTFA "California City & County Sales & Use Tax Rates".
 *
 * Source page: cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm, whose "Download"
 * section links the current table as an Excel file named for its effective date
 * (/taxes-and-fees/SalesTaxRates10-1-26.xlsx) under the heading "Tax Rates
 * Effective October 1, 2026". The adapter reads that page, picks the newest
 * SalesTaxRatesM-D-YY.xlsx link, and requires the page to state the same
 * effective date as the file name (the load fails otherwise; never today's date).
 *
 * Workbook: one sheet, a title row, then columns Location, Rate, County, Type,
 * Notes. Rate is the combined state + local + district rate as a fraction
 * (0.1025 = 10.25%). Type "City" = incorporated city; Type "County" rows are the
 * rate for the county's unincorporated area ("Los Angeles County", or "Kern County
 * Unincorporated Area" where CDTFA splits it out). Split-out counties also have an
 * empty-rate "X County" row ("Please refer to ..."), which carries no rate and is
 * skipped.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { readXlsx, toPct } from "../fetch-util";

export const CA_RATES_PAGE = "https://www.cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm";
const CA_BASE = "https://www.cdtfa.ca.gov";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Newest SalesTaxRatesM-D-YY.xlsx link on the CDTFA rates page, checked against its "Tax Rates Effective <date>" heading. */
export function findCaFile(html: string): { url: string; effectiveDate: string; periodLabel: string } | null {
  const links = [...html.matchAll(/href="([^"]*SalesTaxRates(\d{1,2})-(\d{1,2})-(\d{2,4})\.xlsx)"/gi)].map((m) => {
    const y = Number(m[4].length === 2 ? `20${m[4]}` : m[4]);
    return { href: m[1], effectiveDate: iso(y, Number(m[2]), Number(m[3])) };
  });
  if (!links.length) return null;
  links.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const best = links[0];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const stated = [...text.matchAll(/Tax Rates Effective ([A-Za-z]+) (\d{1,2}), (\d{4})/gi)].map((m) => {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    return mo ? iso(Number(m[3]), mo, Number(m[2])) : "";
  });
  if (!stated.includes(best.effectiveDate)) return null;
  const url = best.href.startsWith("http") ? best.href : CA_BASE + (best.href.startsWith("/") ? "" : "/") + best.href;
  const [y, m] = best.effectiveDate.split("-").map(Number);
  const mon = MONTHS[m - 1];
  return { url, effectiveDate: best.effectiveDate, periodLabel: `${mon[0].toUpperCase()}${mon.slice(1, 3)} ${y}` };
}

export function parseCaXlsx(buf: Buffer, effectiveDate: string): SalesTaxRow[] {
  const sheets = Object.values(readXlsx(buf));
  if (!sheets.length) throw new Error("CA: workbook has no sheets");
  const rows = sheets[0];
  const h = rows.findIndex((r) => (r[0] ?? "").trim().toLowerCase() === "location" && (r[1] ?? "").trim().toLowerCase() === "rate");
  if (h < 0) throw new Error("CA: header row (Location, Rate, County, Type) not found");
  const header = rows[h].map((x) => x.trim().toLowerCase());
  const col = (n: string) => { const i = header.indexOf(n); if (i < 0) throw new Error(`CA: column "${n}" missing`); return i; };
  const iLoc = col("location"), iRate = col("rate"), iCounty = col("county"), iType = col("type");
  const out: SalesTaxRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const loc = (r[iLoc] ?? "").trim();
    const rawRate = (r[iRate] ?? "").trim();
    if (!loc || !rawRate) continue; // "X County: Please refer to ..." rows carry no rate
    const ratePct = toPct(rawRate, true);
    if (!Number.isFinite(ratePct) || ratePct < 7 || ratePct > 15) throw new Error(`CA: implausible rate "${rawRate}" for ${loc}`);
    const type = (r[iType] ?? "").trim().toLowerCase();
    const county = (r[iCounty] ?? "").trim() || null;
    if (type === "city") {
      out.push({ state: "CA", city: loc.replace(/^City of\s+/i, ""), county, locationCode: null, zip: null, kind: "city", ratePct, effectiveDate });
    } else if (type === "county") {
      out.push({ state: "CA", city: null, county, locationCode: null, zip: null, kind: "unincorporated", ratePct, effectiveDate });
    } else throw new Error(`CA: unknown Type "${r[iType]}" for ${loc}`);
  }
  return out;
}

export const caSource: SalesTaxSource = {
  states: ["CA"],
  name: "CA CDTFA",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const file = findCaFile(await ctx.getText(CA_RATES_PAGE));
    if (!file) throw new Error("CA: could not find the current SalesTaxRates*.xlsx link and its stated effective date on the CDTFA page");
    const rows = parseCaXlsx(await ctx.get(file.url), file.effectiveDate);
    const cities = rows.filter((r) => r.kind === "city").length;
    const uninc = rows.filter((r) => r.kind === "unincorporated").length;
    if (cities < 450 || uninc !== 58) throw new Error(`CA: ${cities} cities / ${uninc} unincorporated counties parsed; refusing a partial table`);
    return [{
      state: "CA", sourceName: "CA CDTFA", sourceUrl: file.url,
      effectiveDate: file.effectiveDate, periodLabel: file.periodLabel, rows,
      notes: "County rows are CDTFA's rate for the county's unincorporated area. Rates include state, local and district taxes as CDTFA lists them per city/county; district taxes that cover only part of a city or unincorporated area are not in this table (CDTFA address lookup).",
    }];
  },
};
