/**
 * States with no general sales tax — Delaware, Montana, Oregon: one kind:"state" row at
 * 0% each, cited to the state revenue department's own page saying so.
 *
 *  - DE Division of Revenue, revenue.delaware.gov/business-tax-forms/exemption-certificates/:
 *    "There are no state or local sales taxes in Delaware" (Delaware levies a gross
 *    receipts tax on the seller instead — not a sales tax, not passed through as one).
 *    Date: the page's schema.org "dateModified".
 *  - MT Department of Revenue, revenue.mt.gov/taxes/general-sales-tax: "Montana does not
 *    have a general-use sales tax." Date: the page's <lastmod> in revenue.mt.gov/sitemap.xml.
 *    Caveat: resort communities (and resort areas) levy a LOCAL RESORT TAX on lodging, restaurant food/drink and "luxury" goods; DOR does not
 *    administer it or publish rates (revenue.mt.gov/taxes/miscellaneous/local-resort-tax),
 *    so it is not loaded — noted on the result.
 *  - OR Department of Revenue, www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx:
 *    "Oregon doesn't have a general sales or use/transaction tax." Date: the page's
 *    TimeLastModified from the site's SharePoint REST endpoint (XML).
 *
 * None of these pages states an effective date (there is no rate to take effect), so
 * each row's effectiveDate is the agency page's own last-modified date — "as stated on
 * the agency page of YYYY-MM-DD". Each load fails if the statement or the date is gone.
 *
 * Not here: New Hampshire (no general sales tax, but revenue.nh.gov answers 403 to
 * automated clients, so the statement cannot be verified at run time) and Alaska (no
 * state sales tax but widespread local sales taxes — see ak.ts; no 0% row).
 */
import type { FetchCtx, SalesTaxSource, SalesTaxSourceResult } from "../types";

export const DE_PAGE = "https://revenue.delaware.gov/business-tax-forms/exemption-certificates/";
export const MT_PAGE = "https://revenue.mt.gov/taxes/general-sales-tax";
export const MT_SITEMAP = "https://revenue.mt.gov/sitemap.xml";
export const MT_RESORT_PAGE = "https://revenue.mt.gov/taxes/miscellaneous/local-resort-tax";
export const OR_PAGE = "https://www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx";
export const OR_MODIFIED =
  "https://www.oregon.gov/dor/programs/businesses/_api/web/getfilebyserverrelativeurl('/dor/programs/businesses/Pages/sales-tax.aspx')/TimeLastModified";

const pageText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&#039;|&rsquo;|&#8217;/gi, "'")
  .replace(/[\u2018\u2019]/g, "'").replace(/\u00a0/g, " ").replace(/\s+/g, " ");

export const deStatement = (html: string) => /There are no state or local sales taxes in Delaware/i.test(pageText(html));
export const mtStatement = (html: string) => /Montana does not have a general-use sales tax/i.test(pageText(html));
export const orStatement = (html: string) => /Oregon doesn't have a general sales or use\s*\/\s*transaction tax/i.test(pageText(html));

/** schema.org / OpenGraph modified date in a page → YYYY-MM-DD. */
export function pageModified(html: string): string | null {
  return html.match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1]
    ?? html.match(/article:modified_time"\s+content="(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

export function sitemapLastmod(xml: string, pageUrl: string): string | null {
  const esc = pageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.match(new RegExp(`<loc>\\s*${esc}/?\\s*</loc>\\s*<lastmod>\\s*(\\d{4}-\\d{2}-\\d{2})`))?.[1] ?? null;
}

/** SharePoint REST <d:TimeLastModified ...>2025-09-05T19:03:52Z</d:TimeLastModified> → 2025-09-05. */
export const sharepointModified = (xml: string) => xml.match(/TimeLastModified[^>]*>\s*(\d{4}-\d{2}-\d{2})T/)?.[1] ?? null;

function zeroRow(state: string, sourceName: string, sourceUrl: string, date: string, notes: string): SalesTaxSourceResult {
  return {
    state, sourceName, sourceUrl, effectiveDate: date, periodLabel: `per agency page of ${date}`,
    rows: [{ state, city: null, county: null, locationCode: null, zip: null, kind: "state", ratePct: 0, effectiveDate: date }],
    notes,
  };
}

async function loadDe(ctx: FetchCtx) {
  const html = await ctx.getText(DE_PAGE);
  if (!deStatement(html)) throw new Error('DE: "There are no state or local sales taxes in Delaware" not found on the Division of Revenue page');
  const date = pageModified(html);
  if (!date) throw new Error("DE: Division of Revenue page has no dateModified");
  return zeroRow("DE", "DE Division of Revenue", DE_PAGE, date,
    "No state or local sales tax (Division of Revenue). Delaware's gross receipts tax is imposed on the seller and is not a sales tax. effectiveDate = the page's last-modified date.");
}

async function loadMt(ctx: FetchCtx) {
  const html = await ctx.getText(MT_PAGE);
  if (!mtStatement(html)) throw new Error('MT: "Montana does not have a general-use sales tax" not found on the DOR page');
  const date = sitemapLastmod(await ctx.getText(MT_SITEMAP), MT_PAGE);
  if (!date) throw new Error("MT: DOR general sales tax page not found in the revenue.mt.gov sitemap");
  return zeroRow("MT", "MT Department of Revenue", MT_PAGE, date,
    "No general sales tax (MT DOR). CAVEAT: resort communities/areas levy a local resort tax on lodging, restaurant food & drink and luxury goods; " +
    `DOR does not administer it or publish rates (${MT_RESORT_PAGE}) — not loaded. effectiveDate = the page's sitemap last-modified date.`);
}

async function loadOr(ctx: FetchCtx) {
  const html = await ctx.getText(OR_PAGE);
  if (!orStatement(html)) throw new Error("OR: \"Oregon doesn't have a general sales or use/transaction tax\" not found on the DOR page");
  const date = sharepointModified(await ctx.getText(OR_MODIFIED));
  if (!date) throw new Error("OR: could not read the DOR page's TimeLastModified");
  return zeroRow("OR", "OR Department of Revenue", OR_PAGE, date,
    "No general sales or use/transaction tax (OR DOR). effectiveDate = the page's last-modified date.");
}

export const noSalesTaxSource: SalesTaxSource = {
  states: ["DE", "MT", "OR"],
  name: "No general sales tax (DE, MT, OR)",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    return [await loadDe(ctx), await loadMt(ctx), await loadOr(ctx)];
  },
};
