/**
 * Texas — Texas Comptroller of Public Accounts, "City Rates with local codes and
 * total tax rates".
 *
 * Source page: comptroller.texas.gov/taxes/sales/city.php, which links
 * "Download city rates (XLSX)" (/taxes/sales/docs/city-rates.xlsx). The workbook
 * has one sheet named for the period ("Oct26") with one row per published
 * combination of jurisdictions: CityName, CityNumber, CityTax, CountyName,
 * CountyNumber, CountyTax, SPDName/Number/Tax (x3), TransitName/Number/Tax (x2),
 * TotalTax. Rates are fractions (0.0825 = 8.25%); "n/a" marks an empty slot.
 * ratePct is the Comptroller's own TotalTax column (state 6.25% included) — this
 * adapter never adds the components up itself.
 *
 * Row kinds:
 *  - CityNumber 2xxxxxx, no SPD          -> "city" (one row per county the city lies in;
 *                                           a city-wide transit authority is part of it)
 *  - CityNumber 2xxxxxx with SPD(s)      -> "special" (city name kept; the part of the
 *                                           city inside that special purpose district)
 *  - CityNumber 6xxxxxx "City/District"  -> "special" (Comptroller combined area; city =
 *                                           the part before "/")
 *  - no CityNumber, named place          -> "unincorporated" (unincorporated community the
 *                                           Comptroller lists by name; city = that name)
 *  - no CityNumber, no name              -> county remainder: "unincorporated" when only
 *                                           county tax applies, else "special" (SPD/transit)
 * locationCode = every Comptroller local code on the row (city, county, SPDs,
 * transit) joined with "+", so each published variant is distinguishable.
 *
 * Effective date: the sheet name gives month + year ("Oct26"); the Comptroller's
 * "Quarterly Updates to Rates" page lists "Effective October 1, 2026" — the date
 * whose month/year matches the sheet name is used. The load fails if none matches.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { readXlsx, toPct } from "../fetch-util";

export const TX_CITY_PAGE = "https://comptroller.texas.gov/taxes/sales/city.php";
export const TX_UPDATES_PAGE = "https://comptroller.texas.gov/taxes/sales/quarterly-updates/";
const TX_BASE = "https://comptroller.texas.gov";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The city-rates .xlsx link on the city rates page. */
export function findTxXlsx(html: string): string | null {
  const m = html.match(/href="([^"]*city-rates[^"]*\.xlsx)"/i);
  if (!m) return null;
  return m[1].startsWith("http") ? m[1] : TX_BASE + (m[1].startsWith("/") ? "" : "/") + m[1];
}

/** "Oct26" + the updates page's "Effective October 1, 2026" list -> "2026-10-01". */
export function txEffectiveDate(sheetName: string, updatesHtml: string): string | null {
  const s = sheetName.trim().match(/^([A-Za-z]{3})[A-Za-z]*\s*'?(\d{2}|\d{4})$/);
  if (!s) return null;
  const month = MONTHS.findIndex((m) => m.startsWith(s[1].toLowerCase())) + 1;
  const year = Number(s[2].length === 2 ? `20${s[2]}` : s[2]);
  if (!month) return null;
  const text = updatesHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of text.matchAll(/Effective ([A-Za-z]+) (\d{1,2}), (\d{4})/g)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (mo === month && Number(m[3]) === year) return `${year}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
  }
  return null;
}

const na = (s: string | undefined) => !s || /^n\/a$/i.test(s.trim());

export function parseTxXlsx(buf: Buffer): { sheetName: string; rows: (effectiveDate: string) => SalesTaxRow[] } {
  const wb = readXlsx(buf);
  const [sheetName, raw] = Object.entries(wb)[0] ?? [];
  if (!raw) throw new Error("TX: workbook has no sheets");
  const rows = raw.map((r) => r.map((c) => (c ?? "").trim()));
  const header = rows[0];
  const col = (n: string) => { const i = header.indexOf(n); if (i < 0) throw new Error(`TX: column "${n}" missing (header: ${header.join(", ")})`); return i; };
  const iCity = col("CityName"), iCityNo = col("CityNumber"), iCounty = col("CountyName"), iCountyNo = col("CountyNumber");
  const iSpd = ["SPDNumber", "SPD2Number", "SPD3Number"].map(col);
  const iTransit = ["TransitNumber", "Transit2Number"].map(col);
  const iTotal = col("TotalTax");
  return {
    sheetName,
    rows: (effectiveDate) => {
      const out: SalesTaxRow[] = [];
      const seen = new Set<string>();
      for (const r of rows.slice(1)) {
        if (r.length < header.length - 5) continue; // "End of Worksheet"
        const ratePct = toPct(r[iTotal], true);
        if (!Number.isFinite(ratePct) || ratePct < 6.25 || ratePct > 8.25) throw new Error(`TX: implausible TotalTax "${r[iTotal]}" (${r.join(" | ")})`);
        const name = na(r[iCity]) ? "" : r[iCity];
        const cityNo = na(r[iCityNo]) ? "" : r[iCityNo];
        const spds = iSpd.map((i) => r[i]).filter((v) => !na(v));
        const transit = iTransit.map((i) => r[i]).filter((v) => !na(v));
        const county = na(r[iCounty]) ? null : r[iCounty];
        const codes = [cityNo, na(r[iCountyNo]) ? "" : r[iCountyNo], ...spds, ...transit].filter(Boolean);
        let kind: SalesTaxRow["kind"]; let city: string | null;
        if (cityNo.startsWith("6") || name.includes("/")) { kind = "special"; city = name.split("/")[0].trim() || null; }
        else if (cityNo) { kind = spds.length ? "special" : "city"; city = name; }
        else if (name) { kind = "unincorporated"; city = name; }
        else { kind = spds.length || transit.length ? "special" : "unincorporated"; city = null; }
        const row: SalesTaxRow = { state: "TX", city, county, locationCode: codes.join("+") || null, zip: null, kind, ratePct, effectiveDate };
        const key = `${kind}|${city}|${county}|${row.locationCode}|${ratePct}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
      return out;
    },
  };
}

export const txSource: SalesTaxSource = {
  states: ["TX"],
  name: "TX Comptroller",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const url = findTxXlsx(await ctx.getText(TX_CITY_PAGE));
    if (!url) throw new Error("TX: city-rates .xlsx link not found on the Comptroller city rates page");
    const parsed = parseTxXlsx(await ctx.get(url));
    const effectiveDate = txEffectiveDate(parsed.sheetName, await ctx.getText(TX_UPDATES_PAGE));
    if (!effectiveDate) throw new Error(`TX: could not match sheet "${parsed.sheetName}" to an "Effective <date>" on the quarterly updates page`);
    const rows = parsed.rows(effectiveDate);
    const cities = new Set(rows.map((r) => r.locationCode?.match(/^2\d{6}/)?.[0]).filter(Boolean)).size;
    if (cities < 1000 || rows.length < 2500) throw new Error(`TX: only ${cities} cities / ${rows.length} rows parsed; refusing a partial table`);
    const [y, m] = effectiveDate.split("-").map(Number);
    return [{
      state: "TX", sourceName: "TX Comptroller", sourceUrl: url,
      effectiveDate, periodLabel: `Q${Math.floor((m - 1) / 3) + 1} ${y}`, rows,
      notes: "Rates are the Comptroller's published TotalTax per jurisdiction combination. A city appears once per county it lies in (kind city); parts of a city inside a special purpose district or a Comptroller combined area are kind special. Named unincorporated communities are kind unincorporated with the community name in city. locationCode joins the Comptroller local codes on the row with '+'.",
    }];
  },
};
