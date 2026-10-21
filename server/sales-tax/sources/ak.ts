/**
 * Alaska — Alaska Remote Seller Sales Tax Commission (ARSSTC) monthly rate sheet.
 *
 * Alaska has no state sales tax; boroughs and cities levy their own. The ARSSTC is
 * the public commission of Alaska municipalities (formed by intergovernmental
 * agreement among its members) that administers remote-seller local sales tax for its
 * member jurisdictions and publishes their rates. It is NOT a state
 * revenue agency: it covers member jurisdictions only (non-member municipalities that
 * levy a sales tax are absent — never read "not listed" as 0%), and no 0% state row
 * is emitted.
 *
 * Source page: arsstc.org/business-sellers/tax-rates/, which links one workbook per
 * month: ARSSTC-Sales-Tax-Rate-Sheet-M-D-YY.xlsx (the "...with-Zip-Codes..." variant is
 * ignored). The adapter picks the newest by the date in the file name and requires the
 * sheet's own "As of M/D/YYYY" stamp to match it.
 * Sheet "General Remote Sales Tax": header row "Borough / Census Tract Name | Borough Tax
 * Rate | Tax Filing Code | Date adopted... | ...Start Date | Tax Rate Effective Date |
 * City/Taxing Area | City / Taxing Area Sales Tax Rate | Tax Filing Code | ... | Tax Rate
 * Effective Date | Sales Tax Rate Total"; rates as fractions, dates as Excel serials (a
 * few typed as M/D/YYYY text). The table ends at the "Items highlighted..." footnote,
 * after which seasonal-rate tables follow (recorded in notes, not loaded — the main
 * table already shows each jurisdiction's rate in force on the sheet date).
 *
 * Rows: a city/taxing-area line → kind "city" (" City" suffix dropped), county = the
 * borough/census-area name as published, locationCode = the city filing code,
 * ratePct = "Sales Tax Rate Total" (borough + city). A borough-only line → kind
 * "county" when the borough has no city lines (unified city-boroughs: Juneau, Sitka,
 * Wrangell, ...), "unincorporated" when it does (Kenai Peninsula, Ketchikan Gateway:
 * the borough rate outside member cities). A borough published as several variants
 * ("Haines Borough" / "Haines Borough - Rural") → kind "special", city = the published
 * name, distinguished by locationCode.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { excelSerialToIso, readXlsx, toPct } from "../fetch-util";

export const AK_PAGE = "https://arsstc.org/business-sellers/tax-rates/";

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Newest ARSSTC-Sales-Tax-Rate-Sheet-M-D-YY.xlsx link (not the with-Zip-Codes one). */
export function findAkFile(html: string): { url: string; effectiveDate: string } | null {
  const links = [...html.matchAll(/href="([^"]*\/ARSSTC-Sales-Tax-Rate-Sheet-(\d{1,2})-(\d{1,2})-(\d{2,4})\.xlsx)"/gi)].map((m) => {
    const y = Number(m[4].length === 2 ? `20${m[4]}` : m[4]);
    return { url: m[1], effectiveDate: iso(y, Number(m[2]), Number(m[3])) };
  });
  if (!links.length) return null;
  links.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return links[0];
}

const cellDate = (raw: string): string | null => {
  const s = (raw ?? "").trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? iso(Number(m[3]), Number(m[1]), Number(m[2])) : null;
};

export function parseAkXlsx(buf: Buffer): { asOf: string; rows: SalesTaxRow[] } {
  const wb = readXlsx(buf);
  const name = Object.keys(wb).find((n) => /general/i.test(n));
  if (!name) throw new Error("AK: no General Remote Sales Tax sheet in the ARSSTC workbook");
  const rows = wb[name];
  const asOfM = rows.slice(0, 3).flat().join(" ").match(/As of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!asOfM) throw new Error('AK: ARSSTC sheet has no "As of" date');
  const asOf = iso(Number(asOfM[3]), Number(asOfM[1]), Number(asOfM[2]));
  const h = rows.findIndex((r) => /^Borough \/ Census Tract Name/i.test((r[0] ?? "").trim()));
  if (h < 0) throw new Error("AK: ARSSTC header row not found");
  const hdr = rows[h].map((c) => c.replace(/\s+/g, " ").trim().toLowerCase());
  if (!/borough tax rate/.test(hdr[1] ?? "") || !/city \/ taxing area sales tax rate/.test(hdr[7] ?? "") || !/sales tax rate total/.test(hdr[12] ?? "")) {
    throw new Error(`AK: unexpected ARSSTC columns: ${hdr.join(" | ")}`);
  }
  type Raw = { borough: string; bCode: string; bEff: string | null; city: string; cCode: string; cEff: string | null; total: number };
  const raw: Raw[] = [];
  for (const r of rows.slice(h + 1)) {
    const borough = (r[0] ?? "").replace(/\s+/g, " ").trim();
    if (!borough || /^Items highlighted/i.test(borough) || /^Member cities/i.test(borough)) break;
    const total = toPct(r[12] ?? "", true);
    if (!Number.isFinite(total) || total <= 0) throw new Error(`AK: bad total rate for ${borough} / ${r[6]}: "${r[12]}"`);
    raw.push({
      borough, bCode: (r[2] ?? "").trim(), bEff: cellDate(r[5] ?? ""),
      city: (r[6] ?? "").replace(/\s+/g, " ").trim(), cCode: (r[8] ?? "").trim(), cEff: cellDate(r[11] ?? ""),
      total: Math.round(total * 1000) / 1000,
    });
  }
  const base = (b: string) => b.replace(/\s+-\s+.*$/, "");
  const hasCities = new Set(raw.filter((x) => x.city).map((x) => base(x.borough)));
  const variants = new Map<string, number>();
  for (const x of raw) if (!x.city) variants.set(base(x.borough), (variants.get(base(x.borough)) ?? 0) + 1);
  const seen = new Set<string>();
  const out: SalesTaxRow[] = [];
  for (const x of raw) {
    const key = `${x.borough}|${x.city}|${x.total}`;
    if (seen.has(key)) continue; // the sheet repeats some borough-only lines
    seen.add(key);
    if (x.city) {
      out.push({
        state: "AK", city: x.city.replace(/\s+City$/i, ""), county: base(x.borough), locationCode: x.cCode || null, zip: null,
        kind: "city", ratePct: x.total, effectiveDate: x.cEff ?? x.bEff ?? asOf,
      });
    } else {
      const b = base(x.borough);
      const special = (variants.get(b) ?? 0) > 1;
      out.push({
        state: "AK", city: special ? x.borough : null, county: b, locationCode: x.bCode || null, zip: null,
        kind: special ? "special" : hasCities.has(b) ? "unincorporated" : "county",
        ratePct: x.total, effectiveDate: x.bEff ?? asOf,
      });
    }
  }
  return { asOf, rows: out };
}

export const akSource: SalesTaxSource = {
  states: ["AK"],
  name: "ARSSTC",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const file = findAkFile(await ctx.getText(AK_PAGE));
    if (!file) throw new Error("AK: no ARSSTC-Sales-Tax-Rate-Sheet-*.xlsx link on the ARSSTC tax rates page");
    const { asOf, rows } = parseAkXlsx(await ctx.get(file.url));
    if (asOf !== file.effectiveDate) throw new Error(`AK: sheet says "As of ${asOf}" but the file name says ${file.effectiveDate}`);
    if (rows.length < 40) throw new Error(`AK: only ${rows.length} jurisdictions parsed — refusing a partial table`);
    const [y, m] = asOf.split("-").map(Number);
    return [{
      state: "AK", sourceName: "Alaska Remote Seller Sales Tax Commission", sourceUrl: file.url, effectiveDate: asOf,
      periodLabel: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`, rows,
      notes: "Local sales tax of ARSSTC MEMBER boroughs/cities only (Alaska has no state sales tax). Non-member municipalities with a local sales tax are not listed — a missing place is unknown, not 0%. " +
        "Several members have seasonal rates (summer/winter) and seasonal grocery rates; each row is the rate on the sheet's as-of date and the sheet is republished monthly. Per-row effectiveDate is the jurisdiction's own 'Tax Rate Effective Date'.",
    }];
  },
};
