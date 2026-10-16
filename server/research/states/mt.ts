/**
 * Montana. Checked live 2026-10-15; field names, license types and codes are the publishers' own (CLAUDE.md: never
 * fabricate government data).
 *
 *   mt-deq-asbestos        Montana Department of Environmental Quality, Asbestos Control Program: "Asbestos
 *                          Accreditations" search (svc.mt.gov/deq/asbestosaccred). Its page reads one JSON endpoint
 *                          (api/query_results, accred=ALL) that returns an HTML table: Permittee, Address, City,
 *                          County, State, Zip, Phone, Expire Date, Type, Permit. The page says it "returns currently
 *                          accreditated personnel who have agreed to release their information to the public". Every
 *                          permittee is a person (accreditation types from the page's own list: CS Contractor/
 *                          Supervisor, IN Inspector, MP Management Planner, PD Project Designer, WK Worker), so a row
 *                          keeps city, state and ZIP only. 537 accreditations on 2026-10-15. svc.mt.gov has no
 *                          robots.txt (404). The page notes MCA 2-6-1017: the list may not be used as a mailing list;
 *                          it is only searched by name here.
 *   mt-deq-septic-pumpers  Montana DEQ Septic Tank Pumper program: "Licensed Pumpers" PDF linked from
 *                          deq.mt.gov/twr/Programs/septic-tank ("2026 Licensed Montana Septic Pumpers As of May 20,
 *                          2026"; columns LIC #, County, Business Company). Licenses are held by businesses (the
 *                          column is "Business Company"). 153 lines on 2026-10-15 (one duplicated, S-1181). The PDF's
 *                          name changes by year, so the link is read from the program page each load. deq.mt.gov
 *                          robots.txt disallows only /508test/.
 *
 * Montana's Construction Contractor License (HB 239, from 2026-01-01) and the electrical, plumbing and other trade
 * licenses are only searchable through the Department of Labor & Industry's portals, which refuse automated requests
 * (see `blocked`).
 */
import type { LicenseHit } from "@shared/research-reports";
import { clean, usDate, type BulkHit, type BulkSource } from "../bulk";
import { decodeEntities, politeFetch, politeJson, politeText } from "../http";
import { flipPerson, htmlLines, personText } from "../person-name";
import type { StatePack } from "./types";
import { pdfText, textLines } from "./lib/a3-pdf";

export const ASB_PAGE = "https://svc.mt.gov/deq/asbestosaccred/";
const ASB_API = "https://svc.mt.gov/deq/asbestosaccred/api/query_results?fname=&lname=&city=&county=&accred=ALL";
const ASB_SOURCE = "Montana DEQ asbestos accreditations";
/** The accreditation types as the search page's own list names them. */
const ASB_TYPES: Record<string, string> = {
  CS: "Asbestos Contractor/Supervisor", IN: "Asbestos Inspector", MP: "Asbestos Management Planner", PD: "Asbestos Project Designer", WK: "Asbestos Worker",
};

const cellText = (v: string): string | null => clean(decodeEntities(v.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")));
/** A person cell (the permittee): a <br> or block boundary between two names stays a list (round 8, finding 2). */
const personCell = (v: string): string | null => personText(decodeEntities(htmlLines(v)));

/** The rows of the accreditation table (the API's `html`), keyed by its header cells, lower-cased. */
export function asbestosRows(html: string): Record<string, string | null>[] {
  const rows = Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi), (m) => Array.from(m[1].matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi), (c) => ({ th: c[1].toLowerCase() === "h", v: cellText(c[2]), raw: c[2] })));
  const head = rows.find((r) => r.length && r.every((c) => c.th));
  if (!head) throw new Error("the Montana DEQ accreditation table changed layout (no header row)");
  const names = head.map((c) => (c.v ?? "").toLowerCase());
  for (const want of ["permittee", "city", "state", "zip", "expire date", "type", "permit"]) {
    if (!names.includes(want)) throw new Error(`the Montana DEQ accreditation table changed layout (no "${want}" column)`);
  }
  return rows.filter((r) => r.length === names.length && !r.every((c) => c.th)).map((r) => Object.fromEntries(names.map((n, i) => [n, n === "permittee" ? personCell(r[i].raw) : r[i].v])));
}

/** One accreditation as a license hit. A person's accreditation: no street or phone (round 2, decision 2). */
export function asbestosHit(r: Record<string, string | null>): BulkHit | null {
  const who = flipPerson(r.permittee);
  if (!who) return null;
  const code = clean(r.type)?.toUpperCase() ?? null;
  const type = code ? ASB_TYPES[code] ?? `code ${code}` : null;
  const st = clean(r.state), zip = clean(r.zip);
  const hit: LicenseHit = {
    state: "MT", source: ASB_SOURCE, sourceUrl: ASB_PAGE, businessName: null, licenseNumber: clean(r.permit),
    licenseType: type, specialty: null, status: "Current", principal: who, // the page lists "currently accreditated personnel" only
    city: clean([clean(r.city), [st, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")), expires: usDate(r["expire date"]),
    matchedOn: "principal", people: [{ name: who, role: type }], holder: "individual",
  };
  return { kind: "license", hit, business: null, person: who, keys: { licenses: [hit.licenseNumber], phones: [], addresses: [] } };
}

const MT_ASBESTOS: BulkSource = {
  id: "mt-deq-asbestos", state: "MT", label: "Montana DEQ asbestos accreditations", pageUrl: ASB_PAGE,
  everyHours: 24 * 7, minRows: 375, // 537 on 2026-10-15
  load: async function* () {
    const data = await politeJson<{ html?: unknown }>(ASB_API, { headers: { accept: "application/json" } }, { minDelayMs: 1500, timeoutMs: 90_000 });
    if (typeof data?.html !== "string") throw new Error("Montana DEQ accreditation search returned an unexpected payload");
    for (const r of asbestosRows(data.html)) { const h = asbestosHit(r); if (h) yield h; }
  },
};

export const PUMPER_PAGE = "https://deq.mt.gov/twr/Programs/septic-tank";
const PUMPER_SOURCE = "Montana DEQ licensed septic tank pumpers";

/** The "Licensed Pumpers" PDF linked from the program page (its file name carries the year). */
export function pumperPdfUrl(html: string, base = PUMPER_PAGE): string | null {
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/^\s*Licensed Pumpers\s*$/i.test(cellText(m[2]) ?? "")) return new URL(decodeEntities(m[1]).trim(), base).href;
  }
  return null;
}

export type PumperRow = { license: string; county: string; company: string };

/** The PDF's lines "S-1185   Beaverhead   BADGER PASS SEPTIC LLC" (columns LIC #, County, Business Company), deduplicated. */
export function parsePumpers(text: string): { asOf: string | null; rows: PumperRow[] } {
  const asOf = text.match(/(\d{4}\s+Licensed Montana Septic Pumpers\s+As of\s+[A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1]?.replace(/\s+/g, " ") ?? null;
  const seen = new Set<string>();
  const rows: PumperRow[] = [];
  for (const line of textLines(text)) {
    const m = line.match(/^\s*(S-\d+)\s+(\S.*?\S|\S)\s{2,}(\S.*?)\s*$/);
    if (!m) continue;
    const row = { license: m[1], county: clean(m[2])!, company: clean(m[3])! };
    const k = `${row.license}|${row.county}|${row.company}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(row);
  }
  return { asOf, rows };
}

export function pumperHit(r: PumperRow, asOf: string | null): BulkHit {
  const hit: LicenseHit = {
    state: "MT", source: PUMPER_SOURCE, sourceUrl: PUMPER_PAGE, businessName: r.company, licenseNumber: r.license,
    licenseType: "Septic Tank Pumper", specialty: null, status: asOf ? `Licensed (on DEQ's list: ${asOf})` : "Licensed (on DEQ's list)",
    principal: null, city: null, expires: null, matchedOn: "business", people: [],
    // The publisher's column is "Business Company": the license is the business's.
    holder: "business",
  };
  return { kind: "license", hit, business: r.company, person: null, keys: { licenses: [r.license], phones: [], addresses: [] } };
}

const MT_PUMPERS: BulkSource = {
  id: "mt-deq-septic-pumpers", state: "MT", label: PUMPER_SOURCE, pageUrl: PUMPER_PAGE,
  everyHours: 24 * 7, minRows: 105, // 152 distinct on 2026-10-15
  load: async function* () {
    const url = pumperPdfUrl(await politeText(PUMPER_PAGE, {}, { minDelayMs: 1500 }));
    if (!url) throw new Error("the Montana DEQ septic pumper page no longer links a Licensed Pumpers PDF");
    const res = await politeFetch(url, {}, { minDelayMs: 1500, timeoutMs: 90_000 });
    if (!res.ok) throw new Error(`Montana DEQ returned HTTP ${res.status} for the pumper list`);
    const { asOf, rows } = parsePumpers((await pdfText(new Uint8Array(await res.arrayBuffer()))).text);
    for (const r of rows) yield pumperHit(r, asOf);
  },
};

export const pack: StatePack = {
  state: "MT",
  checked: "2026-10-15",
  bulk: [MT_ASBESTOS, MT_PUMPERS],
  blocked: [
    "DLI Employment Standards licensee lookup and licensee list download (ebizws.mt.gov/PUBLICPORTAL and ERD_PUBLICPORTAL; construction contractor, electrical, plumbing and other trade licenses, and the Electrical and Plumbers boards' 'Licensee Mailing Lists'): re-checked 2026-10-15, the F5 firewall answers 'Request Rejected' ('The requested URL was rejected. Please consult with your administrator.') to every request, robots.txt included",
    "DLI construction contractor registration lookup (erdcontractors.mt.gov/ICCROnlineSearch/registrationlookup.jsp, linked from erd.dli.mt.gov): 2026-10-15 the server resets the connection after the request (robots.txt included)",
    "DLI professional licensing and Building Codes on Accela (ebiz.mt.gov/pol and /bcb → aca-prod.accela.com): the license search links go to the rejected ebizws portal; Accela's own licensee lookup was not used, being a side door to the same refused data",
    "DLI data dashboards (erd.dli.mt.gov/data-dashboards/professional-licensing, IndependentContractors; Tableau on tableau-ext.mt.gov): application and certificate counts, no licensee names",
    "Montana Data Portal (data.mt.gov) 'License Information' (Tableau DS-LicenseInformation): descriptions of license types and requirements, not licensees",
    "DEQ 'List of Montana Asbestos Companies' (deq.mt.gov/cleanupandrec/Programs/asbestos): a voluntary directory of companies that employ accredited people and asked to be listed, not a license; not used as one",
    "Electrical and Plumbers boards (boards.bsd.dli.mt.gov): discipline only through the rejected licensee lookup; board meeting documents (boardmeetings.dli.mt.gov) are agendas and minutes, not a discipline list",
    "Secretary of State business search (biz.sosmt.gov): Cloudflare security check (HTTP 403)",
    "DLI prevailing-wage debarment list (erd.dli.mt.gov/labor-standards/public-contracts-prevailing-wage-law/debarment): live 2026-10-15, lists 'None'",
    "State Procurement (doa.mt.gov/SPSD) debarred vendors: no state list today; the agency resources page points to SAM.gov and the DLI list above",
    "DEQ enforcement: annual summary reports only, no case-level list",
  ],
};
