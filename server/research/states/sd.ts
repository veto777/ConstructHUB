/**
 * South Dakota. Every source below was opened and parsed live on 2026-10-15; field names and license types are the
 * publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   sd-plumbers     SD Plumbing Commission list of licensed plumbers (PDF; city, license type, name).
 *   sd-specialty    SD Plumbing Commission specialty licensees (sewer and water, water conditioning and the
 *                   other specialty classes; PDF with expiration dates).
 *   sd-septic       SD Plumbing Commission small onsite wastewater (septic) installers (PDF; with employer).
 *
 * The lists are published as PDFs only ("Lists of Licensees", dlr.sd.gov/plumbing/consumer_info.aspx); they are
 * read with ./lib/g6-pdf.ts. South Dakota has no state general-contractor license.
 */
import type { LicenseHit } from "@shared/research-reports";
import { promises as fs } from "node:fs";
import { clean, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { StatePack } from "./types";
import { pdfTable } from "./lib/g6-pdf";

const SD_PAGE = "https://dlr.sd.gov/plumbing/consumer_info.aspx";
const SD_DOCS = "https://dlr.sd.gov/plumbing/documents";

async function pdfRows(url: string, header: string[]) {
  const path = await download(url);
  try { return pdfTable(await fs.readFile(path), header); } finally { await fs.rm(path, { force: true }); }
}

/** "LARSON, TREVOR J" → "TREVOR J LARSON". */
const flip = (v: string | null) => { const m = v?.match(/^([^,]+),\s*(.+)$/); return m ? clean(`${m[2]} ${m[1]}`) : clean(v); };
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

export const pack: StatePack = {
  state: "SD",
  checked: "2026-10-15",
  bulk: [SD_PLUMBERS, SD_SPECIALTY, SD_SEPTIC],
  noStatewideGcLicense:
    "South Dakota does not license general contractors statewide; plumbers and electricians are licensed by state commissions (the plumbing lists are searched above)",
  blocked: [
    "South Dakota Electrical Commission license lookup (sdec.portalus.thentiacloud.net, Thentia): HTTP 403 from the load balancer to every request",
    "South Dakota Secretary of State business search (sosenterprise.sd.gov): reCAPTCHA",
    "SD Plumbing Commission lists carry no license numbers, addresses or phones, so they can't be searched by those",
  ],
};
