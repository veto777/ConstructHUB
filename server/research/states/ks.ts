/**
 * Kansas. Every source below was opened and searched live on 2026-10-15; field names, statuses and codes are the
 * publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   live  Kansas State Board of Technical Professions license verification (licensing.ks.gov/Verification_KBTP_213):
 *         engineers, architects, land surveyors, landscape architects and geologists, individuals and firms
 *         ("facilities"), every status. The site notes K.S.A. 45-220(c) on downloaded lists, so it is searched
 *         per report and never downloaded in bulk.
 *   ks-elevator-contractors / ks-elevator-mechanics  State Fire Marshal directories of licensed elevator
 *         contractors (company, contact, phone) and elevator mechanics (name, phone, company), published as PDFs on
 *         the Elevator Safety Program page and read with ./lib/g6-pdf.ts. The directories carry no license numbers.
 *
 * Kansas does not license contractors statewide (cities and counties do); roofers register with the Attorney
 * General, whose directory refuses automated requests (see blocked). Elevator contractors and mechanics are the one
 * construction trade the state licenses.
 */
import type { LicenseHit } from "@shared/research-reports";
import { promises as fs } from "node:fs";
import { clean, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { IdQuery } from "../identifiers";
import type { LiveLicenseSearch, StatePack } from "./types";
import { Session, hiddenInputs, htmlText } from "./lib/g6-common";
import { pdfLines, pdfTable, pdfTextRuns } from "./lib/g6-pdf";

const KSBTP = "https://licensing.ks.gov/Verification_KBTP_213";
const KSBTP_PERSON = `${KSBTP}/Search.aspx`;
const KSBTP_FACILITY = `${KSBTP}/Search.aspx?facility=Y`;

/** The results grid: name, license #, type, status, location, expiration. */
export function parseKsbtpResults(html: string): { name: string | null; number: string | null; type: string | null; status: string | null; location: string | null; expires: string | null }[] {
  const grid = html.match(/<table[^>]*id="datagrid_results"[\s\S]*?<\/caption>([\s\S]*)/)?.[1] ?? "";
  const out: ReturnType<typeof parseKsbtpResults> = [];
  for (const m of Array.from(grid.matchAll(/<a id="datagrid_results__ctl\d+_name"[^>]*>([^<]*)<\/a>[\s\S]*?<\/table>\s*<\/td>((?:\s*<td><span>[\s\S]*?<\/span><\/td>){5})/g))) {
    const cells = Array.from(m[2].matchAll(/<td><span>([\s\S]*?)<\/span><\/td>/g)).map((c) => htmlText(c[1]));
    out.push({ name: htmlText(m[1]), number: cells[0] ?? null, type: cells[1] ?? null, status: cells[2] ?? null, location: cells[3] ?? null, expires: usDate(cells[4]) });
  }
  return out;
}

async function ksbtpSearch(url: string, fields: Record<string, string>): Promise<ReturnType<typeof parseKsbtpResults>> {
  const s = new Session(1500);
  const page = await s.text(url, {}, "Kansas KSBTP verification");
  const body = new URLSearchParams();
  for (const [k, v] of hiddenInputs(page)) body.set(k, v);
  for (const m of Array.from(page.matchAll(/<(input|select)[^>]*name="(t_web_lookup__[^"]+)"/g))) body.set(m[2], "");
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set("sch_button", "Search");
  const html = await s.text(url, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer: url } }, "Kansas KSBTP verification");
  if (!/SearchResults|datagrid_results|No records/i.test(html)) throw new Error("Kansas KSBTP verification returned an unexpected page");
  return parseKsbtpResults(html);
}

/** "Smith, John A" → "John A Smith". */
const flip = (v: string | null) => { const m = v?.match(/^([^,]+),\s*(.+)$/); return m ? clean(`${m[2]} ${m[1]}`) : v; };

const toHit = (r: ReturnType<typeof parseKsbtpResults>[number], facility: boolean, matchedOn: LicenseHit["matchedOn"]): LicenseHit => {
  const who = facility ? null : flip(r.name);
  const loc = r.location?.match(/^(.*?)\s+([A-Z]{2})\s+(\d{5})/);
  return {
    state: "KS", source: "Kansas Board of Technical Professions licenses", sourceUrl: facility ? KSBTP_FACILITY : KSBTP_PERSON,
    businessName: facility ? r.name : null, licenseNumber: r.number, licenseType: r.type, specialty: null, status: r.status,
    principal: who, city: loc ? `${clean(loc[1])}, ${loc[2]}` : r.location, expires: r.expires, matchedOn,
    people: who ? [{ name: who, role: r.type }] : [],
  };
};

const SUFFIX = /\b(INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|LC|PLLC|LLP|PA|P A|PC|P C)\b\.?/gi;
const stripSuffix = (n: string) => clean(n.replace(/[.,]/g, " ").replace(SUFFIX, " ")) ?? n;

const KS_KSBTP: LiveLicenseSearch = {
  source: "Kansas Board of Technical Professions licenses", sourceUrl: KSBTP_PERSON,
  search: async (name, kind) => {
    if (kind === "company") return (await ksbtpSearch(KSBTP_FACILITY, { t_web_lookup__full_name: stripSuffix(name) })).map((r) => toHit(r, true, "business"));
    const w = name.trim().split(/\s+/);
    if (w.length < 2) return [];
    return (await ksbtpSearch(KSBTP_PERSON, { t_web_lookup__first_name: w[0], t_web_lookup__last_name: w[w.length - 1] })).map((r) => toHit(r, false, "principal"));
  },
  searchBy: async (q: IdQuery) => {
    if (q.type !== "license") return [];
    // License numbers carry the profession prefix ("PE1234", "E-65"), as the form asks.
    const n = q.value.trim().toUpperCase();
    const people = (await ksbtpSearch(KSBTP_PERSON, { t_web_lookup__license_no: n })).map((r) => toHit(r, false, "license"));
    const firms = (await ksbtpSearch(KSBTP_FACILITY, { t_web_lookup__license_no: n })).map((r) => toHit(r, true, "license"));
    const want = n.replace(/[^A-Z0-9]/g, "");
    return [...people, ...firms].filter((h) => (h.licenseNumber ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") === want);
  },
};

// ── State Fire Marshal elevator directories (PDF) ────────────────────────────────────────────────────────────
const KSFM_PAGE = "https://firemarshal.ks.gov/342/Elevator-Safety-Program";
const KSFM_CONTRACTORS = "https://firemarshal.ks.gov/DocumentCenter/View/2371/Contractors-Phone-List";
const KSFM_MECHANICS = "https://firemarshal.ks.gov/DocumentCenter/View/2370/Mechanics-Phone-List";
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

async function ksfmRows(url: string, header: string[]): Promise<{ asOf: string | null; rows: Record<string, string>[] }> {
  const path = await download(url);
  try {
    const buf = await fs.readFile(path);
    // The report's print date heads the first page ("Monday, August 17, 2026").
    const first = pdfLines(pdfTextRuns(buf)).slice(0, 4).map((l) => l.map((r) => r.text).join(" ")).join(" ");
    const d = first.match(new RegExp(`(${MONTHS}) (\\d{1,2}), (\\d{4})`));
    const asOf = d ? `${d[3]}-${String(MONTHS.split("|").indexOf(d[1]) + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}` : null;
    const rows = pdfTable(buf, header).map((r) => r.cells)
      // Skip the alphabet group letters, page footers and the repeated print date.
      .filter((c) => !Object.values(c).some((v) => /^Page \d+ of \d+$/.test(v) || new RegExp(`(${MONTHS}) \\d{1,2}, \\d{4}`).test(v)))
      .filter((c) => Object.values(c).filter(Boolean).length >= 2);
    return { asOf, rows };
  } finally { await fs.rm(path, { force: true }); }
}


const KS_ELEVATOR_CONTRACTORS: BulkSource = {
  id: "ks-elevator-contractors", state: "KS", label: "Kansas State Fire Marshal licensed elevator contractors", pageUrl: KSFM_PAGE,
  everyHours: 24 * 7, minRows: 23, // 33 on 2026-10-15
  load: async function* () {
    const { asOf, rows } = await ksfmRows(KSFM_CONTRACTORS, ["Company Name", "Name", "Phone"]);
    for (const c of rows) {
      const company = clean(c["company name"]), contact = clean(c.name), phone = clean(c.phone);
      if (!company) continue;
      const hit: LicenseHit = {
        state: "KS", source: "Kansas State Fire Marshal licensed elevator contractors", sourceUrl: KSFM_PAGE,
        businessName: company, licenseNumber: null, licenseType: "Elevator contractor", specialty: null,
        status: asOf ? `Listed in the State Fire Marshal's licensed elevator contractor directory of ${asOf}` : "Listed in the State Fire Marshal's licensed elevator contractor directory",
        principal: contact, city: null, expires: null, matchedOn: "business", phone, people: contact ? [{ name: contact, role: "Contact" }] : [],
      };
      yield { kind: "license", hit, business: company, person: contact, keys: { phones: [phone] } } satisfies BulkHit;
    }
  },
};

const KS_ELEVATOR_MECHANICS: BulkSource = {
  id: "ks-elevator-mechanics", state: "KS", label: "Kansas State Fire Marshal licensed elevator mechanics", pageUrl: KSFM_PAGE,
  everyHours: 24 * 7, minRows: 180, // 261 on 2026-10-15
  load: async function* () {
    const { asOf, rows } = await ksfmRows(KSFM_MECHANICS, ["Name", "Phone", "Company"]);
    for (const c of rows) {
      const who = clean(c.name), company = clean(c.company), phone = clean(c.phone);
      if (!who) continue;
      const hit: LicenseHit = {
        state: "KS", source: "Kansas State Fire Marshal licensed elevator mechanics", sourceUrl: KSFM_PAGE,
        businessName: company, licenseNumber: null, licenseType: "Elevator mechanic", specialty: null,
        status: asOf ? `Listed in the State Fire Marshal's licensed elevator mechanic directory of ${asOf}` : "Listed in the State Fire Marshal's licensed elevator mechanic directory",
        principal: who, city: null, expires: null, matchedOn: "principal", phone, people: [{ name: who, role: "Elevator mechanic" }],
      };
      yield { kind: "license", hit, business: company, person: who, keys: { phones: [phone] } } satisfies BulkHit;
    }
  },
};

export const pack: StatePack = {
  state: "KS",
  checked: "2026-10-15",
  liveLicenses: [KS_KSBTP],
  bulk: [KS_ELEVATOR_CONTRACTORS, KS_ELEVATOR_MECHANICS],
  noStatewideGcLicense:
    "Kansas does not license general contractors or trades statewide (cities and counties do); engineers, architects and surveyors are licensed by the Board of Technical Professions (searched above), and roofers register with the Attorney General",
  blocked: [
    "Kansas Attorney General roofing contractor registration directory (ag.ks.gov): HTTP 403 (Akamai) to our declared crawler",
    "KDHE licensed asbestos abatement contractors and lead activity firms (kdhe.ks.gov DocumentCenter PDFs): HTTP 403 to our declared crawler",
    "Kansas Secretary of State business entity search: robots.txt disallows /eforms/BusinessEntity/Search.aspx and the page serves an AWS WAF CAPTCHA",
  ],
};
