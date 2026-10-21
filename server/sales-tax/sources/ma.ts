/**
 * Massachusetts — MA Department of Revenue "Sales and Use Tax" guide.
 *
 * Source page: www.mass.gov/guides/sales-and-use-tax — "The Massachusetts sales tax is
 * 6.25% of the sales price or rental charge of tangible personal property ...".
 * Massachusetts has one statewide sales tax rate; cities and towns have no general
 * local sales tax (their local options — DOR "Tax Rates" page — are the 0.75% meals
 * excise, room occupancy and marijuana excises, none of which applies to general
 * sales). One kind:"state" row.
 *
 * Effective date: the guide gives none for the rate, so the adapter uses the page's own
 * "Updated: <Month D, YYYY>" stamp ("rate as published on the DOR guide updated ...").
 * The load fails without it.
 *
 * Fetching: mass.gov answers 403 to the browser-like User-Agent makeFetchCtx() sends,
 * but serves the page to a plain client, so on a 403 the adapter retries once with
 * Node's global fetch and its default User-Agent.
 */
import type { FetchCtx, SalesTaxSource, SalesTaxSourceResult } from "../types";

export const MA_PAGE = "https://www.mass.gov/guides/sales-and-use-tax";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const pageText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\u00a0/g, " ").replace(/\s+/g, " ");

export function parseMaPage(html: string): { ratePct: number; updated: string } | null {
  const t = pageText(html);
  const rate = t.match(/The Massachusetts sales tax is (\d+(?:\.\d+)?)% of the sales price/i);
  const d = t.match(/Updated:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!rate || !d) return null;
  const mo = MONTHS.indexOf(d[1].toLowerCase()) + 1;
  if (!mo) return null;
  return { ratePct: Number(rate[1]), updated: `${d[3]}-${String(mo).padStart(2, "0")}-${d[2].padStart(2, "0")}` };
}

async function getMaPage(ctx: FetchCtx): Promise<string> {
  try {
    return await ctx.getText(MA_PAGE);
  } catch (e) {
    if (!/-> 403\b/.test(String(e))) throw e;
    const res = await fetch(MA_PAGE, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`GET ${MA_PAGE} -> ${res.status} (plain client retry)`);
    return res.text();
  }
}

export const maSource: SalesTaxSource = {
  states: ["MA"],
  name: "MA DOR",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const p = parseMaPage(await getMaPage(ctx));
    if (!p) throw new Error("MA: rate sentence or Updated date not found on the DOR sales and use tax guide");
    return [{
      state: "MA", sourceName: "MA DOR", sourceUrl: MA_PAGE, effectiveDate: p.updated,
      periodLabel: `per DOR guide of ${p.updated}`,
      rows: [{ state: "MA", city: null, county: null, locationCode: null, zip: null, kind: "state", ratePct: p.ratePct, effectiveDate: p.updated }],
      notes: "Statewide rate (no general local sales tax; local option excises cover only meals, room occupancy and marijuana). The guide gives no effective date; effectiveDate is its \"Updated\" date.",
    }];
  },
};
