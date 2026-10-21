/**
 * Hawaii — Department of Taxation "County Surcharge on General Excise and Use Tax".
 *
 * Hawaii has no sales tax; it has the general excise tax (GET), levied on the business
 * but customarily passed on to customers. Source page: tax.hawaii.gov/geninfo/countysurcharge/,
 * which states the GET rate the surcharge rides on ("The county surcharge is only added
 * to activities taxed at the 4.0% rate") and, per county, the surcharge and its period:
 *   "City and County of Honolulu: The county surcharge at the rate of 0.5% is effective
 *    from January 1, 2007 to December 31, 2030."
 *   "County of Hawaii: ... 0.25% ... from January 1, 2019 to December 31, 2019, and at the
 *    rate of 0.5% from January 1, 2020 – December 31, 2030."
 * One kind:"county" row per county the page lists (Honolulu, Kauai, Hawaii, Maui), with
 * ratePct = GET rate + the county's surcharge for its latest-starting period and that
 * period's start as the effective date. Kalawao County is not on the page and is not
 * loaded. The load fails unless all four counties parse.
 *
 * ratePct is the tax RATE (4.5%). The page also publishes the maximum pass-on rate
 * (4.7120% where the 0.5% surcharge applies), i.e. the rate a business may add to a
 * pre-tax price to recover the GET on the tax-inclusive gross; it is recorded in notes.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";

export const HI_PAGE = "https://tax.hawaii.gov/geninfo/countysurcharge/";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const COUNTIES: [label: string, county: string][] = [
  ["City and County of Honolulu", "Honolulu"],
  ["County of Kauai", "Kauai"],
  ["County of Hawaii", "Hawaii"],
  ["County of Maui", "Maui"],
];

const pageText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&ndash;/gi, "–").replace(/&amp;/gi, "&")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/\s+/g, " ");

const isoDate = (s: string): string | null => {
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};

export function parseHiPage(html: string): { getPct: number; rows: SalesTaxRow[]; passOn: string } {
  const t = pageText(html);
  const get = t.match(/surcharge is only added to activities taxed at the (\d+(?:\.\d+)?)% rate/i);
  if (!get) throw new Error('HI: "activities taxed at the X% rate" (GET rate) not found');
  const getPct = Number(get[1]);
  // The surcharge section ends where the pass-on section begins.
  const passIdx = t.search(/Maximum Pass-On Rates/i);
  const surcharge = passIdx > 0 ? t.slice(0, passIdx) : t;
  const rows: SalesTaxRow[] = [];
  for (const [label, county] of COUNTIES) {
    const start = surcharge.indexOf(`${label}:`);
    if (start < 0) throw new Error(`HI: "${label}:" not found in the surcharge section`);
    const next = COUNTIES.map(([l]) => surcharge.indexOf(`${l}:`, start + label.length)).filter((i) => i > start);
    const end = Math.min(...next, surcharge.indexOf("The county surcharge is only added", start) > 0 ? surcharge.indexOf("The county surcharge is only added", start) : surcharge.length);
    const seg = surcharge.slice(start, end);
    let best: { rate: number; from: string } | null = null;
    for (const m of seg.matchAll(/rate of (\d+(?:\.\d+)?)% (?:is effective )?from ([A-Za-z]+ \d{1,2}, \d{4})\s*(?:to|–|-)\s*([A-Za-z]+ \d{1,2}, \d{4})/g)) {
      const from = isoDate(m[2]);
      if (from && (!best || from > best.from)) best = { rate: Number(m[1]), from };
    }
    if (!best) throw new Error(`HI: no surcharge period parsed for ${label}`);
    rows.push({
      state: "HI", city: null, county, locationCode: null, zip: null, kind: "county",
      ratePct: Math.round((getPct + best.rate) * 10_000) / 10_000, effectiveDate: best.from,
    });
  }
  const passOn = passIdx > 0 ? t.slice(passIdx, passIdx + 600).match(/City and County of Honolulu:\s*(\d+\.\d+)%/)?.[1] ?? "" : "";
  return { getPct, rows, passOn };
}

export const hiSource: SalesTaxSource = {
  states: ["HI"],
  name: "HI Dept. of Taxation",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const { getPct, rows, passOn } = parseHiPage(await ctx.getText(HI_PAGE));
    const effectiveDate = rows.map((r) => r.effectiveDate).sort().at(-1)!;
    return [{
      state: "HI", sourceName: "HI Dept. of Taxation", sourceUrl: HI_PAGE, effectiveDate,
      periodLabel: `effective ${effectiveDate}`, rows,
      notes: `General excise tax (not a sales tax): ${getPct}% state GET + county surcharge, per county. ` +
        (passOn ? `Maximum pass-on rate published for Honolulu: ${passOn}% (applies where the 0.5% surcharge applies). ` : "") +
        "Each row's effectiveDate is the start of its county's current surcharge period. Kalawao County is not listed by the Department and is not loaded.",
    }];
  },
};
