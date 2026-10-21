/**
 * Maine — Maine Revenue Services "Sales and Use Tax Rates & Due Dates".
 *
 * Source page: www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates.
 * Its first table has one column per rate period, headed "Effective MM/DD/YYYY"
 * (10/01/2013, 01/01/2016, 10/01/2019, 01/01/2026, ...), and one row per rate type;
 * the "General Sales" row is the statewide general rate. Maine has no local sales
 * taxes (MRS publishes only statewide rates), so the load is one kind:"state" row
 * with the General Sales rate of the newest "Effective" column and that column's date
 * as the effective date. The load fails if the table, the General Sales row or the
 * dated headers are missing.
 */
import type { SalesTaxSource, SalesTaxSourceResult } from "../types";

export const ME_PAGE = "https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates";

const cellText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

/** Newest "Effective MM/DD/YYYY" column of the rates table → its General Sales rate. */
export function parseMeRates(html: string): { ratePct: number; effectiveDate: string } | null {
  for (const table of html.match(/<table\b[\s\S]*?<\/table>/gi) ?? []) {
    const rows = (table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).map((tr) => (tr.match(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi) ?? []).map(cellText));
    const head = rows.find((r) => r.some((c) => /Effective\s+\d{2}\/\d{2}\/\d{4}/i.test(c)));
    const gen = rows.find((r) => /^General Sales$/i.test(r[0] ?? ""));
    if (!head || !gen) continue;
    let bestI = -1;
    let bestDate = "";
    for (let i = 0; i < head.length; i++) {
      const m = head[i].match(/Effective\s+(\d{2})\/(\d{2})\/(\d{4})/i);
      if (!m) continue;
      const date = `${m[3]}-${m[1]}-${m[2]}`;
      if (date > bestDate) { bestDate = date; bestI = i; }
    }
    if (bestI < 0) continue;
    const rate = (gen[bestI] ?? "").match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (!rate) return null;
    return { ratePct: Number(rate[1]), effectiveDate: bestDate };
  }
  return null;
}

export const meSource: SalesTaxSource = {
  states: ["ME"],
  name: "Maine Revenue Services",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const p = parseMeRates(await ctx.getText(ME_PAGE));
    if (!p) throw new Error("ME: General Sales rate / Effective column not found on the MRS rates page");
    return [{
      state: "ME", sourceName: "Maine Revenue Services", sourceUrl: ME_PAGE, effectiveDate: p.effectiveDate,
      periodLabel: `effective ${p.effectiveDate}`,
      rows: [{ state: "ME", city: null, county: null, locationCode: null, zip: null, kind: "state", ratePct: p.ratePct, effectiveDate: p.effectiveDate }],
      notes: "Statewide General Sales rate (newest 'Effective' column of the MRS rate table). Prepared food, lodging and short-term auto rental carry higher statewide rates not loaded here.",
    }];
  },
};
