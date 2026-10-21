/**
 * New Mexico — Taxation & Revenue Department (TRD) "Gross Receipts and Compensating
 * Tax Rate Schedule" (.xlsx).
 *
 * Source: TRD's public document library (the "Forms & Publications" page,
 * www.tax.newmexico.gov/forms-publications/), folder path
 *   Current and Historic Tax Rates › Gross Receipts and Compensating Tax Rates ›
 *   Gross Receipts Tax Rate Schedules › Current Year Gross Receipts Tax Rate Schedules
 * e.g. "Rate Schedule July1,2026 - June 30, 2027.xlsx". The library is a RealFile
 * widget: the page carries the account / root-folder / widget GUIDs, folder contents
 * come from the widget's public GetWidgetFiles JSON endpoint (the same call the page
 * makes) and files are served from its PublicFiles/<account>/<fileId>/<name> URL.
 * The adapter walks that folder path by title at run time and takes the newest
 * uploaded "Rate Schedule" .xlsx, so a new semiannual schedule is picked up unattended.
 *
 * Sheet layout: title rows ("GROSS RECEIPTS AND COMPENSATING TAX RATE SCHEDULE",
 * "Effective July 1,2026 through June 30, 2027", "STATE GROSS RECEIPTS TAX RATE =
 * 4.875%"), then one block per county: a header row (B = county name in capitals,
 * C = "Location Code", D = "%") followed by rows B = location name, C = TRD location
 * code ("02-100"), D = combined GRT rate as a fraction (shown as 0.0000%). The
 * schedule's rate is the full combined state + local GRT rate for the location.
 *
 * Classification: "Remainder of County" → unincorporated; Los Alamos "City and
 * County" → city; TIF/TID/TIDD/MRA districts, pueblos/nations, airports, industrial
 * parks, water & sanitation districts and other narrower areas → special (name kept,
 * including TRD's "(1)" = sales to tribal entities/members, "(2)" = sales to tribal
 * non-members by non-members); everything else → city (a multi-county municipality
 * appears once per county with its own code, e.g. "Rio Rancho (Bernalillo)").
 * Rows TRD lists without a location code ("Isleta Pueblo (2)^ use location code
 * 02-002") only point at another code and are skipped.
 *
 * The effective date is read from the sheet's "Effective <Month> <d>, <yyyy> through
 * ..." line; the load fails rather than guess it.
 */
import type { FetchCtx, SalesTaxRow, SalesTaxSource, SalesTaxSourceResult } from "../types";
import { readXlsx, titleCase, toPct } from "../fetch-util";

export const NM_LIBRARY_PAGE = "https://www.tax.newmexico.gov/forms-publications/";
const RF_API = "https://klvg4oyd4j.execute-api.us-west-2.amazonaws.com/prod/";
const FOLDER_PATH = [
  /^current and historic tax rates$/i,
  /^gross receipts and compensating tax rates$/i,
  /^gross receipts tax rate schedules$/i,
  /^current year gross receipts tax rate schedules$/i,
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type RfFolder = { folderId?: string; linkGUID?: string | null; title?: string; name?: string };
type RfFile = { fileId?: string; linkGUID?: string | null; name: string; title?: string; type?: string; uploaded?: number };
type RfListing = { folders: RfFolder[]; files: RfFile[] };

/** The RealFile widget attributes on TRD's Forms & Publications page. */
export function parseNmLibraryPage(html: string): { accountGuid: string; rootFolderId: string; widgetId: string } | null {
  const div = html.match(/<div[^>]*class="rf-table"[^>]*>/i)?.[0];
  if (!div) return null;
  const attr = (n: string) => div.match(new RegExp(`data-${n}="([^"]+)"`, "i"))?.[1];
  const accountGuid = attr("account-guid"), rootFolderId = attr("folder-id"), widgetId = attr("widget-id");
  return accountGuid && rootFolderId && widgetId ? { accountGuid, rootFolderId, widgetId } : null;
}

/** "Effective July 1,2026 through June 30, 2027" (sheet text) → { effectiveDate, periodLabel }. */
export function parseNmPeriod(text: string): { effectiveDate: string; periodLabel: string } | null {
  const m = text.replace(/\s+/g, " ").match(/Effective\s+([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})\s+through\s+([A-Za-z]+)\s+\d{1,2}\s*,\s*(\d{4})/i);
  if (!m) return null;
  const from = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const to = MONTHS.indexOf(m[4].toLowerCase()) + 1;
  if (!from || !to) return null;
  return {
    effectiveDate: `${m[3]}-${String(from).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`,
    periodLabel: `${MON[from - 1]} ${m[3]}–${MON[to - 1]} ${m[5]}`,
  };
}

const SPECIAL = /\b(TIF|TID|TIDD|MRA|Pueblos?|Nation|Airport|Industrial Park|District|Fairgrounds|Water|Sanitation|Land|Bonito Lake|Canyon|School|Grant|Facility)\b|\//i;

/** Strip TRD's footnote marks: "*", "^ use location code …", note letters a–d. */
export function cleanNmName(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(/\^.*$/, "").replace(/\*/g, "").trim();
  s = s.replace(/(\((?:1|2)\))\s*[a-d](?:\s+[a-d])*$/, "$1");     // "(1)a c" → "(1)"
  s = s.replace(/\bDistrictb$/, "District (within city limits)");   // note b: inside the water district and the city limits
  s = s.replace(/\b(Land|Alamogordo)d$/, "$1");                     // note d: Alamogordo-owned land outside the city
  return s.trim();
}

export function parseNmSchedule(buf: Buffer): { period: { effectiveDate: string; periodLabel: string }; rows: SalesTaxRow[]; skipped: number } {
  const wb = readXlsx(buf);
  const sheet = Object.values(wb)[0];
  if (!sheet) throw new Error("NM: workbook has no sheets");
  const head = sheet.slice(0, 12).map((r) => r.join(" ")).join(" ");
  const period = parseNmPeriod(head);
  if (!period) throw new Error("NM: no 'Effective <date> through <date>' line in the rate schedule");
  if (!/GROSS RECEIPTS AND COMPENSATING TAX RATE SCHEDULE/i.test(head)) throw new Error("NM: not a GRT rate schedule workbook");

  const rows: SalesTaxRow[] = [];
  let county: string | null = null;
  let skipped = 0;
  for (const r of sheet) {
    const name = (r[1] ?? "").trim();
    const code = (r[2] ?? "").trim();
    const val = (r[3] ?? "").trim();
    if (/^location code$/i.test(code)) { county = titleCase(name.replace(/\*/g, "")); continue; }
    if (!county || !name) continue;
    if (!/^\d{2}-\d{3}$/.test(code)) { if (val) skipped++; continue; }
    const ratePct = toPct(val, true);
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 15) throw new Error(`NM: bad rate "${val}" for ${name} (${code})`);
    const cleaned = cleanNmName(name);
    let kind: SalesTaxRow["kind"];
    let city: string | null;
    if (/^remainder of county$/i.test(cleaned)) { kind = "unincorporated"; city = null; }
    else if (/^city and county$/i.test(cleaned)) { kind = "city"; city = county; }
    else if (SPECIAL.test(cleaned)) { kind = "special"; city = cleaned; }
    else {
      kind = "city";
      city = cleaned.replace(/\s*\([^)]*\)\s*$/, "").replace(/^(City|Town|Village) of\s+/i, "").trim();
    }
    rows.push({ state: "NM", city, county, locationCode: code, zip: null, kind, ratePct, effectiveDate: period.effectiveDate });
  }
  return { period, rows, skipped };
}

async function listFolder(ctx: FetchCtx, lib: { accountGuid: string; rootFolderId: string; widgetId: string }, folderId: string): Promise<RfListing> {
  const q = new URLSearchParams({ widgetId: lib.widgetId, folderId, rootFolderId: lib.rootFolderId, accountGUID: lib.accountGuid });
  const json = JSON.parse(await ctx.getText(`${RF_API}GetWidgetFiles?${q}`));
  const data = json?.data;
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.files)) throw new Error(`NM: unexpected document-library listing for folder ${folderId}`);
  return data as RfListing;
}

/** Walk the TRD library to the current-year rate schedule folder and pick the newest "Rate Schedule" .xlsx. */
export async function findNmScheduleUrl(ctx: FetchCtx): Promise<string> {
  const lib = parseNmLibraryPage(await ctx.getText(NM_LIBRARY_PAGE));
  if (!lib) throw new Error("NM: document-library widget not found on the TRD Forms & Publications page");
  let folderId = lib.rootFolderId;
  let listing = await listFolder(ctx, lib, folderId);
  for (const want of FOLDER_PATH) {
    const f = listing.folders.find((x) => want.test((x.title || x.name || "").trim()));
    const id = f?.linkGUID || f?.folderId;
    if (!id) throw new Error(`NM: folder ${want} not found in the TRD document library`);
    folderId = id;
    listing = await listFolder(ctx, lib, folderId);
  }
  const files = listing.files
    .filter((f) => /\.xlsx$/i.test(f.name) && /rate schedule/i.test(f.name))
    .sort((a, b) => (b.uploaded ?? 0) - (a.uploaded ?? 0));
  const file = files[0];
  const fileId = file?.linkGUID || file?.fileId;
  if (!file || !fileId) throw new Error("NM: no 'Rate Schedule' .xlsx in the current-year rate schedule folder");
  return encodeURI(`${RF_API}PublicFiles/${lib.accountGuid}/${fileId}/${file.name}`);
}

export const nmSource: SalesTaxSource = {
  states: ["NM"],
  name: "NM TRD",
  async load(ctx): Promise<SalesTaxSourceResult[]> {
    const url = await findNmScheduleUrl(ctx);
    const { period, rows, skipped } = parseNmSchedule(await ctx.get(url));
    if (rows.length < 250) throw new Error(`NM: only ${rows.length} locations parsed — refusing a partial schedule`);
    if (!rows.some((r) => r.kind === "unincorporated") || rows.filter((r) => r.kind === "city").length < 90) {
      throw new Error("NM: rate schedule is missing county remainders or municipalities — refusing it");
    }
    return [{
      state: "NM", sourceName: "NM TRD", sourceUrl: url,
      effectiveDate: period.effectiveDate, periodLabel: period.periodLabel, rows,
      notes: "Gross receipts tax (GRT) rate schedule — NM taxes the seller's gross receipts rather than a sales tax; rates are the combined state + local GRT per TRD location code. "
        + "Pueblo/nation rows: (1) = sales to tribal entities or members, (2) = sales to tribal non-members by non-members. "
        + `${skipped} schedule line(s) without their own location code (they point to another code) were skipped.`,
    }];
  },
};
