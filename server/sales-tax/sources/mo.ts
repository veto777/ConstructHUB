/**
 * Missouri — MO Department of Revenue "Sales and Use Tax Rate Tables".
 *
 * Source: DOR lists one rate table per period (quarter, plus occasional mid-quarter
 * tables) on dor.mo.gov/taxation/business/tax-types/sales-use/rate-tables/<year>/,
 * each as PDF and as XLSX ("10/2026 - 12/2026 - XLS" -> /pdf/rates/2026/october2026.xlsx).
 * The adapter reads the rate-tables index, opens the newest year page, and takes the
 * XLSX link whose label starts with the latest MM/YYYY (HTML comments are ignored —
 * the page keeps stale links commented out).
 *
 * Sheet "Sales and Use Tax Rate Chart": header block, then rows of
 *   [blank, Jurisdiction Name, Jurisdiction Code, Sales Tax Rate, Use Tax Rate,
 *    Food Sales, Food Use, blank, Domestic Utility, AMJ Rate]
 * Jurisdiction Name is multi-line: line 1 is the city (or county), following lines
 * the county and the districts (CID/TDD/fire/ambulance...) that apply. Jurisdiction
 * Code is "PPPPP-CCC-NNN" = Census place FIPS (00000 = outside any city; 9xxxx = DOR
 * pseudo-areas such as "St Louis County (T1)"), county FIPS, variant (000 = base).
 * ratePct is the published total "Sales Tax Rate" (state + all local), which the
 * sheet writes either as "8.9750%" text or as a fraction (0.08975).
 *
 * Kinds: city/000 -> "city"; county-only/000 -> "unincorporated"; any other variant
 * (district overlays) and the 9xxxx pseudo-areas -> "special" (city set when inside one).
 * locationCode = the DOR jurisdiction code. Multi-county cities (Kansas City) get one
 * "city" row per county.
 *
 * Effective date: the sheet title row ("October, November, December 2026 (Updated
 * 8/25/2026)") gives the first month + year; it must agree with the link label.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { quarterLabel } from "../types";
import { readXlsx, titleCase, toPct } from "../fetch-util";

export const MO_BASE = "https://dor.mo.gov";
export const MO_INDEX = "https://dor.mo.gov/taxation/business/tax-types/sales-use/rate-tables/";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");

/** Newest year page linked from the rate-tables index. */
export function pickMoYearPage(indexHtml: string): string | null {
  const years = [...stripComments(indexHtml).matchAll(/href="([^"]*\/sales-use\/rate-tables\/(\d{4})\/)"/g)]
    .map((m) => ({ href: m[1], y: Number(m[2]) }));
  if (!years.length) return null;
  years.sort((a, b) => b.y - a.y);
  return new URL(years[0].href, MO_BASE).toString();
}

/** The XLSX link with the latest "MM/YYYY ..." label on a year page. */
export function pickMoXlsx(yearHtml: string): { url: string; month: number; year: number } | null {
  const links = [...stripComments(yearHtml).matchAll(/<a\s+href="([^"]+\.xlsx)"[^>]*>\s*(\d{2})\/(\d{4})[^<]*XLS\s*<\/a>/gi)]
    .map((m) => ({ url: new URL(m[1], MO_BASE).toString(), month: Number(m[2]), year: Number(m[3]) }));
  if (!links.length) return null;
  links.sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
  return links[0];
}

/** "October, November, December 2026 (Updated ...)" in the sheet header -> first month + year. */
export function parseMoPeriod(rows: string[][]): { month: number; year: number } | null {
  for (const r of rows.slice(0, 12)) {
    for (const cell of r) {
      const m = cell.trim().match(/^([A-Za-z]+)(?:\s*,\s*[A-Za-z]+)*\s+(\d{4})\b/);
      if (!m) continue;
      const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      if (month) return { month, year: Number(m[2]) };
    }
  }
  return null;
}

const rate = (raw: string) => (/%/.test(raw) ? toPct(raw, false) : toPct(raw, true));
const CODE = /^(\d{5})-(\d{3})-(\d{3})$/;

export function parseMoRows(rows: string[][], effectiveDate: string): SalesTaxRow[] {
  const hdr = rows.findIndex((r) => r.some((c) => /^Jurisdiction Name$/i.test(c.trim())));
  if (hdr < 0) throw new Error("MO: header row (Jurisdiction Name) not found");
  const h = rows[hdr].map((c) => c.replace(/\s+/g, " ").trim().toLowerCase());
  const iName = h.indexOf("jurisdiction name"), iCode = h.indexOf("jurisdiction code");
  const iSales = h.findIndex((c) => c.startsWith("sales tax rate"));
  if (iCode < 0 || iSales < 0) throw new Error(`MO: unexpected header: ${h.join(" | ")}`);

  const recs: { lines: string[]; place: string; county: string; variant: string; code: string; ratePct: number }[] = [];
  for (const r of rows.slice(hdr + 1)) {
    const code = (r[iCode] ?? "").trim();
    const m = code.match(CODE);
    if (!m) continue;
    const ratePct = rate(r[iSales] ?? "");
    if (!Number.isFinite(ratePct) || ratePct <= 0 || ratePct > 20) throw new Error(`MO: bad sales rate for ${code}: "${r[iSales]}"`);
    const lines = (r[iName] ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) throw new Error(`MO: no name for ${code}`);
    recs.push({ lines, place: m[1], county: m[2], variant: m[3], code, ratePct });
  }
  // County names from the county-area rows (line 1 "ADAIR COUNTY" on 00000-001-NNN). A few
  // counties have no 000 base row (the whole unincorporated area lies in some district).
  // County FIPS 510 is the independent City of St. Louis: no county, county stays null.
  const countyName = new Map<string, string>();
  for (const x of recs) {
    if (x.place === "00000" && /\sCOUNTY$/i.test(x.lines[0]) && !countyName.has(x.county)) {
      countyName.set(x.county, titleCase(x.lines[0].replace(/\s+COUNTY$/i, "")));
    }
  }
  return recs.map((x): SalesTaxRow => {
    const outside = x.place === "00000" || x.place.startsWith("9");
    const kind = x.place === "00000" && x.variant === "000" ? "unincorporated"
      : !outside && x.variant === "000" ? "city" : "special";
    return {
      state: "MO",
      city: outside ? null : titleCase(x.lines[0]),
      county: countyName.get(x.county) ?? null,
      locationCode: x.code,
      zip: null,
      kind,
      ratePct: x.ratePct,
      effectiveDate,
    };
  });
}

export const moSource: SalesTaxSource = {
  states: ["MO"],
  name: "MO DOR",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const yearPage = pickMoYearPage(await ctx.getText(MO_INDEX));
    if (!yearPage) throw new Error("MO: no year page linked from the rate-tables index");
    const link = pickMoXlsx(await ctx.getText(yearPage));
    if (!link) throw new Error(`MO: no XLSX rate table linked from ${yearPage}`);
    const wb = readXlsx(await ctx.get(link.url));
    const sheet = Object.values(wb)[0];
    if (!sheet) throw new Error("MO: workbook has no sheets");
    const period = parseMoPeriod(sheet);
    if (!period) throw new Error("MO: could not read the period from the rate table header");
    if (period.month !== link.month || period.year !== link.year) {
      throw new Error(`MO: table header ${period.month}/${period.year} disagrees with link label ${link.month}/${link.year}`);
    }
    const effectiveDate = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
    const rows = parseMoRows(sheet, effectiveDate);
    if (rows.length < 2000) throw new Error(`MO: only ${rows.length} jurisdictions parsed — refusing a partial table`);
    if (rows.filter((r) => r.kind === "unincorporated").length < 100) {
      throw new Error("MO: fewer than 100 county base rows — refusing a partial table");
    }
    return [{
      state: "MO", sourceName: "MO DOR", sourceUrl: link.url,
      effectiveDate, periodLabel: quarterLabel(effectiveDate), rows,
      notes: "Total sales tax rate per DOR jurisdiction code (state + county + city + districts). " +
        "\"special\" rows are CID/TDD/fire/ambulance overlays or DOR pseudo-areas; locationCode = DOR jurisdiction code.",
    }];
  },
};
