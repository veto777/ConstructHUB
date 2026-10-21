/**
 * Illinois — IDOR (Illinois Department of Revenue) sales tax rate machine readable files.
 *
 * Source page: "Sales Tax Rate - Machine Readable Files"
 * (tax.illinois.gov/research/taxrates/sales-tax-rate-machine-readable-files.html). Two fixed-width
 * files are read, both linked from that page under the newest "Effective - MM/DD/YYYY" heading:
 *
 *  - ordmache-current.txt — the county/municipality ("ordinance") file: one 211-char record per
 *    IDOR location ID. Layout per IDOR's "Machine Readable File Guide ... County/Municipality Rate":
 *    Location ID X(10) "xxx-xxxx-x", Location name X(25), County name X(25), General
 *    Merchandise/Food & Drug Address Over-ride flag X(1), Rate effective date CCYYMMDD, Receipts
 *    General Merchandise high rate v99999, Receipts Food & Drug high rate, Receipts GM low rate,
 *    Receipts F&D low rate, Receipts over-ride flag, ... (purchases / auto / prior-period fields
 *    are ignored). Rates are combined state + local (".06250" = 6.25%).
 *  - ordmacha-current.txt — the "Addendum Address File": for every location whose address
 *    over-ride flag is "Y" (business districts and similar sub-city taxes), the ordinance file
 *    carries zero rates and IDOR publishes the rates here instead, 206-char records: Location ID
 *    X(10), Taxing district "Rxx" X(3), Location name X(25), County X(25), Address X(35),
 *    effective date, then the same receipts rate fields. The record with a blank address is the
 *    location's general rate; each other taxing district (R01, R02 …) is emitted once as a
 *    "special" row (its per-address list is not loaded; IDOR's address file is the authority for
 *    which addresses fall in it).
 *
 * ratePct is the Receipts General Merchandise rate (the general retail rate). Where IDOR sets the
 * receipts over-ride flag with different high/low rates (Metro East transit districts in Madison
 * and St. Clair counties), the HIGH rate "only applies if the taxpayer is liable for Metro East
 * District rates": the low rate is loaded as the location row and the high rate as a "special"
 * row with locationCode "<id> high". Location IDs xxx-5000-x are a county's unincorporated area.
 *
 * Effective date of the table = the "Effective - MM/DD/YYYY" label the page shows for the
 * ordmache-current.txt link; each row's effectiveDate is the record's own rate effective date.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { titleCase } from "../fetch-util";

export const IL_PAGE = "https://tax.illinois.gov/research/taxrates/sales-tax-rate-machine-readable-files.html";
const IL_BASE = "https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxrates/documents/salestaxrates/";
export const IL_ORD = IL_BASE + "ordmache-current.txt";
export const IL_ADDR = IL_BASE + "ordmacha-current.txt";

/** The effective date IDOR shows for the current ordinance file ("Effective - 08/01/2026"). */
export function parseIlPeriod(html: string): { effectiveDate: string; periodLabel: string } | null {
  // The link text itself is the label: <a href=".../ordmache-current.txt">Effective - 08/01/2026</a>
  const m = html.match(/ordmache-current\.txt"[^>]*>\s*Effective\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  const effectiveDate = `${m[3]}-${m[1]}-${m[2]}`;
  const mon = new Date(effectiveDate + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return { effectiveDate, periodLabel: `${mon} ${m[3]}` };
}

const ymd = (s: string): string | null => /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
/** "06250" → 6.25 */
const rate5 = (s: string): number => /^\d{5}$/.test(s) ? Number(s) / 1000 : NaN;

const COUNTY_FIX: Record<string, string> = { Dupage: "DuPage", Dekalb: "DeKalb", Lasalle: "LaSalle", Dewitt: "DeWitt" };
const county = (s: string) => { const t = titleCase(s); return COUNTY_FIX[t] ?? t; };
const place = (s: string) => titleCase(s.replace(/^CITY OF\s+/i, ""));

type Rec = { id: string; name: string; county: string; eff: string; high: number; low: number; ov: boolean };

function pushRec(out: SalesTaxRow[], r: Rec, kind: SalesTaxRow["kind"], code: string) {
  const uninc = /-5000-/.test(r.id);
  const base: Omit<SalesTaxRow, "kind" | "ratePct" | "locationCode"> = {
    state: "IL", city: uninc ? null : place(r.name), county: county(r.county), zip: null, effectiveDate: r.eff,
  };
  const k = kind === "city" && uninc ? "unincorporated" : kind;
  if (r.ov && r.high !== r.low) {
    out.push({ ...base, kind: k, ratePct: r.low, locationCode: code });
    out.push({ ...base, kind: "special", ratePct: r.high, locationCode: `${code} high` });
  } else {
    out.push({ ...base, kind: k, ratePct: r.high, locationCode: code });
  }
}

/** Parse ordmache-current.txt + ordmacha-current.txt (both latin1/ascii fixed width). */
export function parseIlFiles(ordText: string, addrText: string): SalesTaxRow[] {
  const out: SalesTaxRow[] = [];
  const overridden = new Set<string>();
  for (const line of ordText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.length < 90) throw new Error(`IL ordinance file: short record (${line.length} chars): ${line.slice(0, 40)}`);
    const id = line.slice(0, 10);
    if (!/^\d{3}-\d{4}-\d$/.test(id)) throw new Error(`IL ordinance file: bad location id "${id}"`);
    // Codes 200-0099-x … 250-0099-x / 500-0099-x are out-of-state / "ILLINOIS" filing codes with no county — not places.
    if (!line.slice(35, 60).trim()) continue;
    if (line[60] === "Y") { overridden.add(id); continue; }
    const eff = ymd(line.slice(61, 69));
    const high = rate5(line.slice(69, 74)), low = rate5(line.slice(79, 84));
    if (!eff || !Number.isFinite(high) || !Number.isFinite(low) || high < 6.25) throw new Error(`IL ordinance file: bad rate record for ${id}`);
    pushRec(out, { id, name: line.slice(10, 35).trim(), county: line.slice(35, 60).trim(), eff, high, low, ov: line[89] === "Y" }, "city", id);
  }
  // Addendum: one rate per (location, taxing district); the blank-address record is the general rate.
  const districts = new Map<string, Rec & { dist: string; blank: boolean }>();
  for (const line of addrText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.length < 127) throw new Error(`IL addendum file: short record (${line.length} chars)`);
    const id = line.slice(0, 10), dist = line.slice(10, 13);
    if (!/^\d{3}-\d{4}-\d$/.test(id) || !/^R\d\d$/.test(dist)) throw new Error(`IL addendum file: bad key "${id}${dist}"`);
    const eff = ymd(line.slice(98, 106));
    const high = rate5(line.slice(106, 111)), low = rate5(line.slice(116, 121));
    if (!eff || !Number.isFinite(high) || !Number.isFinite(low) || high < 6.25) throw new Error(`IL addendum file: bad rate record for ${id} ${dist}`);
    const rec = { id, dist, name: line.slice(13, 38).trim(), county: line.slice(38, 63).trim(), eff, high, low, ov: line[126] === "Y", blank: !line.slice(63, 98).trim() };
    const key = `${id} ${dist}`;
    const prev = districts.get(key);
    if (prev && (prev.high !== high || prev.low !== low)) throw new Error(`IL addendum file: ${key} has conflicting rates`);
    if (!prev || rec.blank) districts.set(key, rec);
  }
  const haveGeneral = new Set<string>();
  // General (blank-address) rate first: R00 preferred, else the lowest-numbered blank district.
  const sorted = [...districts.values()].sort((a, b) => (a.id + a.dist).localeCompare(b.id + b.dist));
  for (const d of sorted) {
    if (!overridden.has(d.id) || !d.blank || haveGeneral.has(d.id)) continue;
    haveGeneral.add(d.id);
    pushRec(out, d, "city", d.id);
    d.dist = "";
  }
  for (const d of sorted) {
    if (!overridden.has(d.id) || d.dist === "") continue;
    pushRec(out, d, "special", `${d.id} ${d.dist}`);
  }
  const missing = [...overridden].filter((id) => !haveGeneral.has(id));
  if (missing.length > 10) throw new Error(`IL: ${missing.length} address-override locations have no general rate in the addendum file`);
  return out;
}

export const ilSource: SalesTaxSource = {
  states: ["IL"],
  name: "IL DOR",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const period = parseIlPeriod(await ctx.getText(IL_PAGE));
    if (!period) throw new Error("IL: could not read the effective date of ordmache-current.txt from the IDOR machine readable files page");
    const [ord, addr] = await Promise.all([ctx.get(IL_ORD), ctx.get(IL_ADDR)]);
    const rows = parseIlFiles(ord.toString("latin1"), addr.toString("latin1"));
    const cities = rows.filter((r) => r.kind === "city").length;
    if (cities < 1200 || rows.length < 1500) throw new Error(`IL: only ${rows.length} rows (${cities} cities) parsed — refusing a partial table`);
    const newest = rows.reduce((m, r) => (r.effectiveDate > m ? r.effectiveDate : m), "");
    if (newest > period.effectiveDate) throw new Error(`IL: file has rates effective ${newest}, after the page's ${period.effectiveDate} — page/file mismatch`);
    return [{
      state: "IL", sourceName: "IL DOR", sourceUrl: IL_ORD,
      effectiveDate: period.effectiveDate, periodLabel: period.periodLabel, rows,
      notes: "Receipts general-merchandise rate (combined state + local) per IDOR location ID. Business-district " +
        "(address over-ride) rates come from IDOR's addendum address file (" + IL_ADDR + "): the location's general " +
        "rate is the blank-address record; each other taxing district is a 'special' row (locationCode '<id> Rxx'). " +
        "Metro East locations with different high/low rates: the low rate is the location row, the high rate (only " +
        "for taxpayers liable for the Metro East district tax) is a 'special' row '<id> high'. Grocery/drug, auto and " +
        "cannabis rates are not loaded.",
    }];
  },
};
