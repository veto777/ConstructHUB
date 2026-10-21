/**
 * Virginia — Virginia Tax "Sales and use tax rates by locality".
 *
 * Source page: tax.virginia.gov/retail-sales-and-use-tax, whose "Download sales and
 * tax rates and locality codes for each city or county" link is an Excel workbook
 * (/sites/default/files/inline-files/sales-and-use-tax-rates-by-locality-by-date.xlsx).
 * The adapter reads the page and follows that link. The workbook has one sheet per
 * rate period ("Jul 2023 - Dec 2025", "Jan 2026 - Present", ...); the current one is
 * the sheet whose title line reads "<Month D, YYYY> - Present". Columns: Name, Code
 * (5-digit FIPS, 51xxx), General Sales, Food & Personal Hygiene, Fuel..., Plastic Bag,
 * Prepaid Wireless. General Sales is the combined state + regional + local rate as a
 * fraction (0.053 / 0.06 / 0.063 / 0.07).
 *
 * Virginia's 133 localities are 95 counties and 38 independent cities (county
 * equivalents, FIPS >= 51500). Counties → kind "county" (county name, "County" suffix
 * dropped); independent cities → kind "city" with county null ("Richmond City" →
 * city "Richmond"). locationCode = FIPS. Effective date = the "<date> - Present"
 * line; the load fails without it.
 */
import type { SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { readXlsx, toPct } from "../fetch-util";

export const VA_PAGE = "https://www.tax.virginia.gov/retail-sales-and-use-tax";
const VA_BASE = "https://www.tax.virginia.gov";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The locality-rates .xlsx link on the Virginia Tax retail sales page. */
export function findVaFile(html: string): string | null {
  const href = html.match(/href="([^"]*sales-and-use-tax-rates-by-locality[^"]*\.xlsx)"/i)?.[1];
  if (!href) return null;
  return href.startsWith("http") ? href : VA_BASE + (href.startsWith("/") ? "" : "/") + href;
}

export function parseVaXlsx(buf: Buffer): { effectiveDate: string; rows: SalesTaxRow[] } {
  const wb = readXlsx(buf);
  let best: { effectiveDate: string; rows: string[][] } | null = null;
  for (const rows of Object.values(wb)) {
    const head = rows.slice(0, 4).map((r) => r.join(" ")).join(" ");
    const m = head.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*(?:-|–|to)\s*Present/i);
    if (!m) continue;
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (!mo) continue;
    const effectiveDate = `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (!best || effectiveDate > best.effectiveDate) best = { effectiveDate, rows };
  }
  if (!best) throw new Error('VA: no "<date> - Present" sheet in the locality workbook');
  const h = best.rows.findIndex((r) => r.some((c) => c.trim() === "Code") && r.some((c) => /^General Sales/i.test(c.trim())));
  if (h < 0) throw new Error("VA: header row (Name | Code | General Sales) not found");
  const header = best.rows[h].map((c) => c.trim());
  const iName = header.indexOf("Name"), iCode = header.indexOf("Code");
  const iRate = header.findIndex((c) => /^General Sales/i.test(c));
  if (iName < 0 || iCode < 0) throw new Error("VA: Name/Code columns missing");
  const out: SalesTaxRow[] = [];
  for (const r of best.rows.slice(h + 1)) {
    const code = (r[iCode] ?? "").trim();
    if (!/^51\d{3}$/.test(code)) continue;
    const ratePct = Math.round(toPct(r[iRate] ?? "", true) * 1000) / 1000;
    if (!Number.isFinite(ratePct) || ratePct <= 0) throw new Error(`VA: bad General Sales rate for ${code}: "${r[iRate]}"`);
    const name = (r[iName] ?? "").replace(/\s+\d{5}\s*$/, "").replace(/\s+/g, " ").trim();
    const isCity = Number(code.slice(2)) >= 500;
    out.push({
      state: "VA",
      city: isCity ? name.replace(/\s+City$/i, "") : null,
      county: isCity ? null : name.replace(/\s+County$/i, ""),
      locationCode: code,
      zip: null,
      kind: isCity ? "city" : "county",
      ratePct,
      effectiveDate: best.effectiveDate,
    });
  }
  return { effectiveDate: best.effectiveDate, rows: out };
}

export const vaSource: SalesTaxSource = {
  states: ["VA"],
  name: "Virginia Tax",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const url = findVaFile(await ctx.getText(VA_PAGE));
    if (!url) throw new Error("VA: locality rates .xlsx link not found on the Virginia Tax retail sales page");
    const { effectiveDate, rows } = parseVaXlsx(await ctx.get(url));
    if (rows.length < 130) throw new Error(`VA: only ${rows.length} localities parsed — refusing a partial table`);
    const [y, m] = effectiveDate.split("-").map(Number);
    return [{
      state: "VA", sourceName: "Virginia Tax", sourceUrl: url, effectiveDate,
      periodLabel: `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1, 3)} ${y} – present`, rows,
      notes: "Combined General Sales rate per county / independent city as published by Virginia Tax. Food & personal hygiene items are taxed at a reduced rate (separate column, not loaded here).",
    }];
  },
};
