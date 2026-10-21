/**
 * Florida — FL Department of Revenue discretionary sales surtax by county.
 *
 * Florida's local sales tax is county-level only (no city sales taxes): the 6%
 * state rate plus each county's discretionary sales surtax (0%–2%). One
 * kind:"county" row per county, ratePct = state rate + total surtax.
 *
 * Sources (both FL DOR):
 *  - Surtax: the "Discretionary Sales Surtax Rate Table" on DOR's Address/Jurisdiction
 *    Database site (pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx).
 *    Its "Download All" button (an ASP.NET postback, so a form POST carrying the page's
 *    __VIEWSTATE/__EVENTVALIDATION) returns FDOR_DiscretionarySalesSurtaxRates.xlsx:
 *    one sheet, title rows, header "County | Total Surtax Rate", rows like
 *    "MIAMI-DADE | 1.00%", and a footer "Rates shown above are current as of M/D/YYYY".
 *    FetchCtx only does GET, so the POST uses Node's global fetch (same as ctx: no
 *    cookies or credentials needed). Form DR-15DSS (PDF) carries the per-surtax
 *    effective/expiration dates and is NOT parsed.
 *  - State rate: "Florida's general state sales tax rate is 6%" on
 *    floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx.
 *
 * Effective date: the workbook's own "current as of" date (DOR stamps the table with
 * the date it was generated, i.e. the rates in force on that date). The load fails if
 * that line is missing. Duplicate county lines with the same rate (the table lists
 * FLAGLER twice) are merged; a duplicate with a different rate fails the load.
 * Caveat: Hillsborough is published at 1.5% (see DOR TIP 24A01-15 on surtax suspension).
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { readXlsx, titleCase, toPct } from "../fetch-util";

export const FL_SURTAX_PAGE = "https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx";
export const FL_SALES_TAX_PAGE = "https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const pageText = (html: string) => html
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;|&rsquo;|&#8217;/gi, "'")
  .replace(/[\u00a0\u2019]/g, (c) => (c === "\u2019" ? "'" : " ")).replace(/\s+/g, " ");

/** "Florida's general state sales tax rate is 6%" → 6. */
export function parseFlStateRate(html: string): number | null {
  const m = pageText(html).match(/general state sales tax rate is\s*(\d+(?:\.\d+)?)\s*%/i);
  return m ? Number(m[1]) : null;
}

/** The ASP.NET hidden fields + the "Download All" submit button of the surtax table page. */
export function flDownloadForm(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of html.matchAll(/<input\b[^>]*type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    form.set(name, (m[0].match(/value="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'"));
  }
  const btn = html.match(/<input\b[^>]*type="submit"[^>]*value="Download All"[^>]*>/i)?.[0];
  const btnName = btn?.match(/name="([^"]+)"/)?.[1];
  if (!btnName || !form.has("__VIEWSTATE")) throw new Error("FL: surtax page has no Download All form (layout changed?)");
  form.set(btnName, "Download All");
  return form;
}

export function parseFlSurtaxXlsx(buf: Buffer, statePct: number): { effectiveDate: string; rows: SalesTaxRow[] } {
  const sheets = Object.values(readXlsx(buf));
  if (!sheets.length) throw new Error("FL: surtax workbook has no sheets");
  const rows = sheets[0];
  const asOf = rows.map((r) => r.join(" ")).join("\n").match(/current as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!asOf) throw new Error('FL: surtax workbook has no "current as of" date');
  const effectiveDate = `${asOf[3]}-${asOf[1].padStart(2, "0")}-${asOf[2].padStart(2, "0")}`;
  const h = rows.findIndex((r) => r[0]?.trim().toLowerCase() === "county" && /total surtax rate/i.test(r[1] ?? ""));
  if (h < 0) throw new Error("FL: surtax workbook header (County | Total Surtax Rate) not found");
  const byCounty = new Map<string, number>();
  for (const r of rows.slice(h + 1)) {
    const name = (r[0] ?? "").trim();
    const raw = (r[1] ?? "").trim();
    if (!name || !/^\d*\.?\d+\s*%$/.test(raw)) continue;
    const surtax = toPct(raw, false);
    const prev = byCounty.get(name);
    if (prev !== undefined && prev !== surtax) throw new Error(`FL: ${name} listed twice with different surtax rates (${prev}%, ${surtax}%)`);
    byCounty.set(name, surtax);
  }
  const out: SalesTaxRow[] = [...byCounty].map(([name, surtax]) => ({
    state: "FL",
    city: null,
    county: titleCase(name),
    locationCode: null,
    zip: null,
    kind: "county",
    ratePct: Math.round((statePct + surtax) * 10_000) / 10_000,
    effectiveDate,
  }));
  return { effectiveDate, rows: out };
}

export const flSource: SalesTaxSource = {
  states: ["FL"],
  name: "FL DOR",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const statePct = parseFlStateRate(await ctx.getText(FL_SALES_TAX_PAGE));
    if (statePct === null) throw new Error("FL: could not read the state sales tax rate from the DOR sales tax page");
    const form = flDownloadForm(await ctx.getText(FL_SURTAX_PAGE));
    const res = await fetch(FL_SURTAX_PAGE, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "*/*" },
      body: form.toString(),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`FL: surtax download POST -> ${res.status}`);
    if (!/spreadsheetml/i.test(res.headers.get("content-type") ?? "")) throw new Error(`FL: surtax download returned ${res.headers.get("content-type")}, not an .xlsx`);
    const { effectiveDate, rows } = parseFlSurtaxXlsx(Buffer.from(await res.arrayBuffer()), statePct);
    if (rows.length !== 67) throw new Error(`FL: ${rows.length} counties parsed, expected 67 — refusing a partial table`);
    return [{
      state: "FL", sourceName: "FL DOR", sourceUrl: FL_SURTAX_PAGE,
      effectiveDate, periodLabel: `as of ${effectiveDate}`, rows,
      notes: `County rows = ${statePct}% state rate + the county's total discretionary sales surtax (DOR surtax table, "current as of" date). ` +
        "Florida has no city-level sales tax. Surtax applies only to the first $5,000 of a single sale of tangible personal property; per-surtax effective/expiration dates are on Form DR-15DSS.",
    }];
  },
};
