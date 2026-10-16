/**
 * South Dakota. Every source below was opened and parsed live on 2026-10-15; field names and license types are the
 * publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   sd-plumbers     SD Plumbing Commission list of licensed plumbers (PDF; city, license type, name).
 *   sd-specialty    SD Plumbing Commission specialty licensees (sewer and water, water conditioning and the
 *                   other specialty classes; PDF with expiration dates).
 *   sd-septic       SD Plumbing Commission small onsite wastewater (septic) installers (PDF; with employer).
 *
 *   sd-dor-tax-delinquent  SD Department of Revenue "Top 100 Delinquent Report" (dor.sd.gov/businesses/taxes,
 *                   "Click Here" PDF; "SOUTH DAKOTA BUSINESS TAX DELINQUENT REPORT"). Columns Owner Name / DBA Name,
 *                   Address, City, State, Tax Due, Interest Due, Penalty Due, Total Due. The report says: business tax
 *                   includes sales, use, tourism, contractors' excise, municipal, municipal gross receipts, motor vehicle
 *                   leasing and telecommunications gross receipts tax; "A lien has been filed against all taxpayers
 *                   listed"; names are removed within 10 days of payment in full (SDCL 10-59-46 through 51). The page
 *                   says it is updated weekly. Companies only (FCRA): a row whose owner is not a business name is
 *                   left out. 200 entries on the report of 09/15/2026 (checked 2026-10-15), 139 of them businesses.
 *                   dor.sd.gov robots.txt: "User-agent: * / Allow: /".
 *
 * The plumbing lists are published as PDFs only ("Lists of Licensees", dlr.sd.gov/plumbing/consumer_info.aspx);
 * they are read with ./lib/g6-pdf.ts. South Dakota has no state general-contractor license.
 */
import { flipPerson } from "../person-name";
import type { LicenseHit } from "@shared/research-reports";
import { promises as fs } from "node:fs";
import { clean, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { StatePack } from "./types";
import { pdfTable } from "./lib/g6-pdf";
import { pdfText, textLines } from "./lib/a3-pdf";
import { looksLikeBusiness, usd } from "./lib/g8-common";
import { personNameForm } from "./lib/business-name";
import { decodeEntities, politeFetch, politeText } from "../http";
import type { EnforcementHit } from "@shared/research-reports";

const SD_PAGE = "https://dlr.sd.gov/plumbing/consumer_info.aspx";
const SD_DOCS = "https://dlr.sd.gov/plumbing/documents";

async function pdfRows(url: string, header: string[]) {
  const path = await download(url);
  try { return pdfTable(await fs.readFile(path), header); } finally { await fs.rm(path, { force: true }); }
}

/** "LARSON, TREVOR J" → "TREVOR J LARSON". */
/** "LAST, FIRST" → "FIRST LAST" for one person; a published list stays a list (../person-name.ts). */
const flip = (v: string | null) => flipPerson(v);
const titleCity = (v: string | null) => clean(v)?.toUpperCase() ?? null;

/** Every list here licenses people (plumbers, specialty and septic installers): an employer on the row doesn't make the license the employer's (round 2, decision 2). */
const lic = (h: Omit<LicenseHit, "matchedOn">, business: string | null, personName: string | null): BulkHit =>
  ({ kind: "license", hit: { ...h, holder: "individual", matchedOn: personName ? "principal" : "business" }, business, person: personName, keys: { licenses: [], phones: [], addresses: [] } });

/**
 * The commission's lists are grouped: a city line, then a license-type line (a long type wraps onto a second
 * line), then one line per person. Yields { city, type, cells } for every person line.
 */
function* grouped(rows: { cells: Record<string, string> }[], nameCol: string): Generator<{ city: string | null; type: string | null; cells: Record<string, string> }> {
  let city: string | null = null, type: string | null = null, typeOpen = false;
  for (const { cells } of rows) {
    const name = cells[nameCol], t = cells["license type"], c = cells["city"];
    if (c && !name && !t) { city = c; type = null; typeOpen = false; continue; }
    if (t && !name) { type = typeOpen ? clean(`${type} ${t}`) : t; typeOpen = true; continue; }
    typeOpen = false;
    if (t) type = t;
    if (c) city = c;
    if (name) yield { city, type, cells };
  }
}

const SD_PLUMBERS: BulkSource = {
  id: "sd-plumbers", state: "SD", label: "South Dakota Plumbing Commission licensed plumbers", pageUrl: SD_PAGE,
  everyHours: 24 * 7, minRows: 1_950, // 2,798 on 2026-10-15
  load: async function* () {
    for (const g of grouped(await pdfRows(`${SD_DOCS}/List_of_licensed_plumbers.pdf`, ["City", "License Type", "Name"]), "name")) {
      const who = flip(g.cells.name);
      if (!who) continue;
      yield lic({
        state: "SD", source: "South Dakota Plumbing Commission licensed plumbers", sourceUrl: SD_PAGE, businessName: null,
        licenseNumber: null, licenseType: g.type, specialty: null, status: "Listed as licensed", principal: who,
        city: titleCity(g.city), expires: null, people: [{ name: who, role: g.type }],
      }, null, who);
    }
  },
};

const DATE_TAIL = /\s+(\d{1,2}\/\d{1,2}\/\d{4})$/;

const SD_SPECIALTY: BulkSource = {
  id: "sd-specialty", state: "SD", label: "South Dakota Plumbing Commission specialty licensees", pageUrl: SD_PAGE,
  everyHours: 24 * 7, minRows: 640, // 909 on 2026-10-15
  load: async function* () {
    for (const g of grouped(await pdfRows(`${SD_DOCS}/list_of_specialty_licensees.pdf`, ["City", "License Type", "Person Name", "Expiration Date"]), "person name")) {
      let name = g.cells["person name"], exp = g.cells["expiration date"];
      // A few rows print the name and date as one run: split the trailing date off.
      const m = !exp ? name.match(DATE_TAIL) : null;
      if (m) { exp = m[1]; name = name.replace(DATE_TAIL, ""); }
      const who = flip(name);
      if (!who) continue;
      yield lic({
        state: "SD", source: "South Dakota Plumbing Commission specialty licensees", sourceUrl: SD_PAGE, businessName: null,
        licenseNumber: null, licenseType: g.type, specialty: null, status: "Listed as licensed", principal: who,
        city: titleCity(g.city), expires: usDate(exp), people: [{ name: who, role: g.type }],
      }, null, who);
    }
  },
};

const SD_SEPTIC: BulkSource = {
  id: "sd-septic", state: "SD", label: "South Dakota small onsite wastewater (septic) installers", pageUrl: SD_PAGE,
  everyHours: 24 * 7, minRows: 390, // 561 on 2026-10-15
  load: async function* () {
    const rows = await pdfRows(`${SD_DOCS}/list_of_small_wastewater.pdf`, ["City", "License Type", "Name", "Employer Name"]);
    // An employer name that wraps prints its first line just above the person's line: join it to the next row.
    let carry: string | null = null;
    const joined: { cells: Record<string, string> }[] = [];
    for (const r of rows) {
      const c = r.cells;
      if (c["employer name"] && !c.name && !c.city && !c["license type"]) { carry = clean(`${carry ?? ""} ${c["employer name"]}`); continue; }
      if (c.name && carry) c["employer name"] = clean(`${carry} ${c["employer name"]}`) ?? carry;
      if (c.name || c.city || c["license type"]) carry = null;
      joined.push({ cells: c });
    }
    for (const g of grouped(joined, "name")) {
      const who = flip(g.cells.name);
      if (!who) continue;
      const employer = clean(g.cells["employer name"]);
      yield lic({
        state: "SD", source: "South Dakota small onsite wastewater installers", sourceUrl: SD_PAGE, businessName: employer,
        licenseNumber: null, licenseType: g.type, specialty: null, status: "Listed as licensed", principal: who,
        city: titleCity(g.city), expires: null, people: [{ name: who, role: g.type }],
      }, employer, who);
    }
  },
};

export const DOR_PAGE = "https://dor.sd.gov/businesses/taxes/";
const DOR_SOURCE = "South Dakota Department of Revenue business tax delinquent report";

/** The report's PDF: the page's link titled "Top 100 Delinquent Report" (its media path changes with each report). */
export function delinquentPdfUrl(html: string, base = DOR_PAGE): string | null {
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    const href = tag.match(/href="([^"]+\.pdf)"/i)?.[1];
    if (href && /title="Top 100 Delinquent Report"/i.test(tag)) return new URL(decodeEntities(href), base).href;
  }
  return null;
}

export type DelinquentRow = { owner: string; dba: string | null; address: string | null; city: string; st: string; tax: number | null; interest: number | null; penalty: number | null; total: number | null };

const AMT = String.raw`\$([\d,]+\.\d{2})`;
const OWNER_LINE = new RegExp(String.raw`^\s*(\S.*?)\s{2,}(?:(\S.*?)\s{2,})?(\S.*?)\s{2,}([A-Z]{2})\s+${AMT}\s+${AMT}\s+${AMT}\s+${AMT}\s*$`);
const num = (v: string): number | null => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };

/**
 * The report's rows: an owner line (name, address, city, state and the four amounts), then the DBA name on the next
 * text line. Headers, page footers and the grand-total line are skipped.
 */
export function parseDelinquent(text: string): { reportDate: string | null; rows: DelinquentRow[] } {
  const reportDate = usDate(text.match(/REPORT DATE:\s*(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? null);
  const rows: DelinquentRow[] = [];
  let open: DelinquentRow | null = null;
  for (const line of textLines(text)) {
    if (!line.trim()) continue;
    const m = line.match(OWNER_LINE);
    if (m) {
      open = { owner: clean(m[1])!, dba: null, address: clean(m[2]), city: clean(m[3])!, st: m[4], tax: num(m[5]), interest: num(m[6]), penalty: num(m[7]), total: num(m[8]) };
      rows.push(open);
      continue;
    }
    if (/\$\d|^\s*(?:Owner Name|DBA Name|Page \d+ of \d+)/i.test(line)) { open = null; continue; }
    if (open && !open.dba) { open.dba = clean(line); open = null; }
  }
  return { reportDate, rows };
}

/**
 * The owner is a business: a business form and no personal name form. A person's lien stays a person's whatever its
 * DBA says ("JOHN BROTHERS" dba "BROTHERS PLUMBING" is an individual's lien: no row; round 8, finding 1).
 */
export const sdOwnerIsBusiness = (owner: string): boolean => personNameForm(owner) === null && looksLikeBusiness(owner);

/** A stored row from before SD_RULE_VERSION: kept only when its owner (the name before " dba ") is a business today. */
export function sdLegacyLien(h: EnforcementHit): EnforcementHit | null {
  const owner = (h.name ?? "").split(/\s+dba\s+/i)[0].trim();
  return owner && sdOwnerIsBusiness(owner) ? h : null;
}

/** A row as report hits, one per business name (owner, and a different DBA); none when the owner is not a business. */
export function delinquentHits(r: DelinquentRow, reportDate: string | null): BulkHit[] {
  if (!sdOwnerIsBusiness(r.owner)) return []; // companies only (FCRA): a person's tax lien is not searched, nor its DBA
  const dba = r.dba && r.dba.toUpperCase() !== r.owner.toUpperCase() ? r.dba : null;
  const day = reportDate ? `${reportDate.slice(5, 7)}/${reportDate.slice(8, 10)}/${reportDate.slice(0, 4)}` : null;
  const parts = [r.tax != null ? `tax due ${usd(r.tax)}` : null, r.interest != null ? `interest due ${usd(r.interest)}` : null, r.penalty != null ? `penalty due ${usd(r.penalty)}` : null].filter(Boolean);
  const hit: EnforcementHit = {
    state: "SD", source: DOR_SOURCE, sourceUrl: DOR_PAGE, category: "tax_lien",
    name: dba ? `${r.owner} dba ${dba}` : r.owner, id: null, date: reportDate, endDate: null,
    status: `On the business tax delinquent report${day ? ` of ${day}` : ""}: a lien has been filed`,
    city: `${r.city}, ${r.st}`,
    detail: `Delinquent South Dakota business tax (sales, use, tourism, contractors' excise, municipal and other business taxes)${parts.length ? `: ${parts.join(", ")}` : ""}`,
    amount: r.total, adverse: true,
    address: r.address ? `${r.address}, ${r.city}, ${r.st}` : null,
  };
  return [r.owner, dba].filter((n): n is string => !!n).map((business) => ({ kind: "enforcement" as const, hit, business, person: null }));
}

const SD_DOR_DELINQUENT: BulkSource = {
  id: "sd-dor-tax-delinquent", state: "SD", label: DOR_SOURCE, pageUrl: DOR_PAGE,
  everyHours: 24 * 7, minRows: 133, // 190 on the report of 09/15/2026 (139 business owners of 200 entries, plus 51 distinct DBA names)
  companiesOnly: true, category: "tax_lien",
  // Rows stored before round 8 are re-read: an owner that was a business only by "Brothers" is a person (sdLegacyLien).
  legacyEnforcement: sdLegacyLien, enforcementRuleVersion: 7,
  load: async function* () {
    const url = delinquentPdfUrl(await politeText(DOR_PAGE, {}, { minDelayMs: 1500 }));
    if (!url) throw new Error("the Department of Revenue taxes page no longer links the Top 100 Delinquent Report");
    const res = await politeFetch(url, {}, { minDelayMs: 1500, timeoutMs: 90_000 });
    if (!res.ok) throw new Error(`Department of Revenue returned HTTP ${res.status} for the delinquent report`);
    const { reportDate, rows } = parseDelinquent((await pdfText(new Uint8Array(await res.arrayBuffer()))).text);
    if (rows.length < 140) throw new Error(`the delinquent report changed layout (${rows.length} rows read)`);
    for (const r of rows) yield* delinquentHits(r, reportDate);
  },
};

export const pack: StatePack = {
  state: "SD",
  checked: "2026-10-15",
  bulk: [SD_PLUMBERS, SD_SPECIALTY, SD_SEPTIC, SD_DOR_DELINQUENT],
  noStatewideGcLicense:
    "South Dakota does not license general contractors statewide; plumbers and electricians are licensed by state commissions (the plumbing lists are searched above)",
  blocked: [
    "South Dakota Electrical Commission license portal (sdec.portalus.thentiacloud.net, Thentia; electrical contractors and electricians; linked from dlr.sd.gov/electrical): re-checked 2026-10-15, the portal and its public register (/webs/portal/register/) redirect to /maintenance/portal/ (\"The portal is currently undergoing maintenance. Please try again later.\"), and the register's search service returns no rows for any name, so there is nothing to read; its robots.txt Disallow no longer counts (OWNER ORDER 2026-10-15). dlr.sd.gov/electrical publishes no licensee or contractor list",
    "SD Plumbing Commission: no company list; its PLUMBING CONTRACTOR and SEWER AND WATER CONTRACTOR licenses are issued to people and are in the lists above (dlr.sd.gov/plumbing/consumer_info.aspx, re-checked 2026-10-15)",
    "Department of Revenue contractor's excise tax licenses: no public list or lookup (dor.sd.gov/businesses/taxes/contractors-excise-tax; the tax license application at apps.sd.gov/rv23cedar is an account system)",
    "Electrical and Plumbing commission discipline: only meeting documents on boardsandcommissions.sd.gov (BoardID=35, 77), no discipline list",
    "South Dakota Secretary of State business search (sosenterprise.sd.gov): reCAPTCHA",
    "SD Plumbing Commission lists carry no license numbers, addresses or phones, so they can't be searched by those",
  ],
};
