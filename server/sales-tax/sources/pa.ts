/**
 * Pennsylvania — PA Department of Revenue "Sales, Use and Hotel Occupancy Tax" page.
 *
 * PA has no rate file; the DOR page states the whole rate structure in one paragraph:
 * "The Pennsylvania sales tax rate is 6 percent. By law, a 1 percent local tax is added
 * to purchases made in Allegheny County, and 2 percent local tax is added to purchases
 * made in Philadelphia." Those are the only local sales taxes in PA, so the load is:
 *   - one kind:"state" row (6%) — the rate everywhere outside the two local-tax counties
 *     (the "state" kind here means "rest of state", see notes);
 *   - kind:"county" rows for Allegheny (6+1) and Philadelphia (6+2).
 * All three numbers are read from the page; the load fails if any sentence is missing.
 *
 * Effective date: the page states none, so the adapter uses the page's own
 * last-modified date from pa.gov's sitemap (www.pa.gov/en.sitemap.xml, <lastmod> of
 * this URL) — i.e. "rates as published on the DOR page last modified YYYY-MM-DD".
 * The load fails if the sitemap has no entry for the page.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";

export const PA_PAGE = "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax";
export const PA_SITEMAP = "https://www.pa.gov/en.sitemap.xml";

const pageText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\u00a0/g, " ").replace(/\s+/g, " ");

export function parsePaRates(html: string): { state: number; allegheny: number; philadelphia: number } | null {
  const t = pageText(html);
  const state = t.match(/Pennsylvania sales tax rate is (\d+(?:\.\d+)?) percent/i);
  const alle = t.match(/(\d+(?:\.\d+)?) percent local tax is added to purchases made in Allegheny County/i);
  const phil = t.match(/(\d+(?:\.\d+)?) percent local tax is added to purchases made in Philadelphia/i);
  if (!state || !alle || !phil) return null;
  return { state: Number(state[1]), allegheny: Number(alle[1]), philadelphia: Number(phil[1]) };
}

/** <lastmod> (YYYY-MM-DD) of `pageUrl` in a sitemap.xml. */
export function sitemapLastmod(xml: string, pageUrl: string): string | null {
  const esc = pageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = xml.match(new RegExp(`<loc>\\s*${esc}(?:\\.html)?\\s*</loc>\\s*<lastmod>\\s*(\\d{4}-\\d{2}-\\d{2})`));
  return m ? m[1] : null;
}

export function buildPaRows(r: { state: number; allegheny: number; philadelphia: number }, effectiveDate: string): SalesTaxRow[] {
  const row = (kind: "state" | "county", county: string | null, ratePct: number): SalesTaxRow => ({
    state: "PA", city: null, county, locationCode: null, zip: null, kind,
    ratePct: Math.round(ratePct * 10_000) / 10_000, effectiveDate,
  });
  return [
    row("state", null, r.state),
    row("county", "Allegheny", r.state + r.allegheny),
    row("county", "Philadelphia", r.state + r.philadelphia),
  ];
}

export const paSource: SalesTaxSource = {
  states: ["PA"],
  name: "PA DOR",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const rates = parsePaRates(await ctx.getText(PA_PAGE));
    if (!rates) throw new Error("PA: rate sentences (6 percent / Allegheny / Philadelphia) not found on the DOR page");
    if (rates.state < 1 || rates.allegheny <= 0 || rates.philadelphia <= 0) throw new Error(`PA: implausible rates ${JSON.stringify(rates)}`);
    const effectiveDate = sitemapLastmod(await ctx.getText(PA_SITEMAP), PA_PAGE);
    if (!effectiveDate) throw new Error("PA: DOR page not found in the pa.gov sitemap (no last-modified date)");
    return [{
      state: "PA", sourceName: "PA DOR", sourceUrl: PA_PAGE, effectiveDate,
      periodLabel: `per DOR page of ${effectiveDate}`, rows: buildPaRows(rates, effectiveDate),
      notes: `${rates.state}% statewide; +${rates.allegheny}% local in Allegheny County, +${rates.philadelphia}% local in Philadelphia (the local taxes the DOR page lists). ` +
        'The kind:"state" row is the rate for every other county. The DOR page gives no effective date; effectiveDate is the page\'s last-modified date from the pa.gov sitemap.',
    }];
  },
};
