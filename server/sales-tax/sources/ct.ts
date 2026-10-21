/**
 * Connecticut — CT Department of Revenue Services "Sales and Use Tax Information".
 *
 * Source page: portal.ct.gov/drs/sales-tax/tax-information. Connecticut has one
 * statewide rate and no local sales taxes; the page says both: "The sales tax rate of
 * 6.35% applies to the retail sale, lease, or rental of most goods ..." and "There are
 * no additional sales taxes imposed by local jurisdictions in Connecticut." Both
 * sentences are required (the load fails if the no-local sentence disappears), and the
 * result is a single kind:"state" row.
 *
 * Effective date: the page gives no effective date for the rate, so the adapter uses
 * the page's own "Last Reviewed or Updated: DD-Mon-YYYY" stamp — "rate as published on
 * the DRS page reviewed YYYY-MM-DD". The load fails without it.
 */
import type { SalesTaxSource, SalesTaxSourceResult } from "../types";

export const CT_PAGE = "https://portal.ct.gov/drs/sales-tax/tax-information";
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const pageText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\u00a0/g, " ").replace(/\s+/g, " ");

export function parseCtPage(html: string): { ratePct: number; reviewed: string } | null {
  const t = pageText(html);
  const rate = t.match(/The sales tax rate of (\d+(?:\.\d+)?)% applies to the retail sale/i);
  const noLocal = /There are no additional sales taxes imposed by local jurisdictions in Connecticut/i.test(t);
  const d = t.match(/Last Reviewed or Updated:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/i);
  if (!rate || !noLocal || !d) return null;
  const mo = MON.indexOf(d[2].toLowerCase()) + 1;
  if (!mo) return null;
  return { ratePct: Number(rate[1]), reviewed: `${d[3]}-${String(mo).padStart(2, "0")}-${d[1].padStart(2, "0")}` };
}

export const ctSource: SalesTaxSource = {
  states: ["CT"],
  name: "CT DRS",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const p = parseCtPage(await ctx.getText(CT_PAGE));
    if (!p) throw new Error("CT: rate / no-local-tax sentence / Last Reviewed date not found on the DRS sales tax page");
    return [{
      state: "CT", sourceName: "CT DRS", sourceUrl: CT_PAGE, effectiveDate: p.reviewed,
      periodLabel: `per DRS page of ${p.reviewed}`,
      rows: [{ state: "CT", city: null, county: null, locationCode: null, zip: null, kind: "state", ratePct: p.ratePct, effectiveDate: p.reviewed }],
      notes: "Statewide rate; DRS: no local sales taxes in Connecticut. The page gives no effective date; effectiveDate is its \"Last Reviewed or Updated\" date.",
    }];
  },
};
