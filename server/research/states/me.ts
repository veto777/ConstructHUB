/**
 * Maine. Every source was opened and searched live on 2026-10-15 (CLAUDE.md: never fabricate government data); the
 * column names and wording are the publisher's own.
 *
 *   ME  Department of Environmental Protection, Licensed Asbestos Abatement Contractors
 *       (www.maine.gov/dep/waste/asbestos/asbestoscontractors.html) and Licensed Asbestos Abatement Consultants
 *       (…/asbestosconsultants.html): live search of the two published tables (Business Name, Address, City, State,
 *       Zip, Phone; about 70 and 60 rows). The pages define both as "a business entity licensed by the Department",
 *       so every row is a business's license. No license numbers or dates are published.
 *   ME  DEP Board of Underground Storage Tank Installers, "Maine Certified Underground Storage Tank Installers and
 *       Inspectors" (www.maine.gov/dep/waste/busti/certifiedlist.html): live search of the published table (Name,
 *       Company, Town, Phone; about 95 rows). Each row is one certified person; "(INSP)" after a name is the page's
 *       mark for an underground storage tank inspector ("Unless noted as specifically being certified as an
 *       underground storage tank inspector, a certified individual may INSPECT AND INSTALL"). A person is searched by
 *       name, a company by the Company column (the person's employer). Phones are not shown (individuals' records).
 *
 * www.maine.gov's robots.txt (checked 2026-10-15) disallows none of these paths; the portal's policies
 * (www.maine.gov/portal/policies) set no rule against automated access.
 *
 * Maine licenses no general contractors: the Attorney General's consumer page "Home Construction and Repair"
 * (www.maine.gov/ag/consumer-protection/consumer-help-topics/housing/home-construction-and-repair) says "In Maine,
 * general contractors - and trades such as roofing and framing - are not licensed or regulated", and that the
 * state licenses plumbers and electricians.
 */
import type { LicenseHit } from "@shared/research-reports";
import { normPhone, type IdQuery } from "../identifiers";
import { companyNamed, personMatches } from "../licenses";
import { politeFetch } from "../http";
import { clean } from "../bulk";
import { flipPerson } from "../person-name";
import { capNote, withNote } from "../notes";
import { htmlPerson, text } from "./lib/g4-html";
import type { LiveLicenseSearch, StatePack } from "./types";

const DEP = "https://www.maine.gov/dep/waste";
export const ASBESTOS_CONTRACTORS = `${DEP}/asbestos/asbestoscontractors.html`;
export const ASBESTOS_CONSULTANTS = `${DEP}/asbestos/asbestosconsultants.html`;
export const UST_INSTALLERS = `${DEP}/busti/certifiedlist.html`;
const MAX = 15;
/** The pages change a few times a year; one copy serves a run of reports for an hour. */
const CACHE_MS = 3600_000;
const cache = new Map<string, { at: number; html: string }>();

/**
 * A page, cached for an hour only once `check` has read it whole (round 8, finding 7): an unreadable or partial page
 * is an error (the source reads "not searched"), never a cached empty list.
 */
async function page(url: string, label: string, check: (html: string) => unknown): Promise<string> {
  const c = cache.get(url);
  if (c && Date.now() - c.at < CACHE_MS) return c.html;
  const res = await politeFetch(url, {}, { minDelayMs: 1000 });
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
  const html = await res.text();
  try { check(html); } catch (err: any) { throw new Error(`${label}: the source answered with an unreadable page (${String(err?.message ?? err).slice(0, 120)})`); }
  cache.set(url, { at: Date.now(), html });
  return html;
}

/** For tests: forget the cached pages. */
export const clearMaineCache = () => cache.clear();
/** For tests with small fixture pages: the per-list row floors (null: the real ones). */
let floorOverride: number | null = null;
export const setMaineFloorForTests = (n: number | null) => { floorOverride = n; };
const floor = (n: number) => floorOverride ?? n;

/**
 * The one table of a page as records keyed by its own <th> headers. The headers must be exactly the expected ones,
 * and every data row must have exactly those cells, with at least `minRows` rows (round 8, finding 7): a page whose
 * columns changed, a malformed row or a near-empty list is an error, never a silently mis-read table. Person columns
 * are read with htmlPerson (round 8, finding 2): a <br> or block boundary between two names stays a list.
 */
export function headedTable(html: string, expected: string[], opts: { person?: string[]; minRows?: number } = {}): Record<string, string | null>[] {
  const table = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!table) throw new Error("the page has no table");
  const head = Array.from(table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => text(m[1]) ?? "");
  if (head.join("|") !== expected.join("|")) throw new Error(`the table's columns changed (${head.join(", ")})`);
  const out: Record<string, string | null>[] = [];
  for (const m of Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))) {
    const raw = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) => c[1]);
    if (!raw.length) continue; // the header row
    if (raw.length !== expected.length) throw new Error(`a row has ${raw.length} cells, not ${expected.length}`);
    const rec: Record<string, string | null> = {};
    expected.forEach((h, i) => { rec[h] = opts.person?.includes(h) ? htmlPerson(raw[i]) : text(raw[i]); });
    out.push(rec);
  }
  if (out.length < (opts.minRows ?? 1)) throw new Error(`only ${out.length} rows (at least ${opts.minRows ?? 1} expected)`);
  return out;
}

// ── DEP licensed asbestos abatement contractors and consultants (businesses) ─────────────────────────────────────

const ASBESTOS_COLUMNS = ["Business Name", "Address", "City", "State", "Zip", "Phone"];
const ASBESTOS_SOURCE = "Maine DEP licensed asbestos abatement contractors and consultants";
// Rows on 2026-10-15: 71 contractors, 62 consultants; a page with fewer than the floor is not read.
const ASBESTOS_LISTS = [
  { url: ASBESTOS_CONTRACTORS, type: "Asbestos abatement contractor", minRows: 35 },
  { url: ASBESTOS_CONSULTANTS, type: "Asbestos consultant", minRows: 30 },
];

export function asbestosHits(html: string, url: string, type: string, matchedOn: LicenseHit["matchedOn"] = "business", minRows = 1): LicenseHit[] {
  return headedTable(html, ASBESTOS_COLUMNS, { minRows }).filter((r) => r["Business Name"]).map((r) => {
    const locality = [r.City, [r.State, r.Zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return {
      state: "ME", source: ASBESTOS_SOURCE, sourceUrl: url, businessName: r["Business Name"], licenseNumber: null,
      licenseType: type, specialty: null, status: null, principal: null, city: r.City, expires: null, matchedOn,
      address: clean([r.Address, locality].filter(Boolean).join(", ")), phone: r.Phone,
      // Both pages define the licensee as "a business entity licensed by the Department".
      holder: "business",
    };
  });
}

async function asbestosAll(matchedOn: LicenseHit["matchedOn"]): Promise<LicenseHit[]> {
  const out: LicenseHit[] = [];
  for (const l of ASBESTOS_LISTS) {
    const html = await page(l.url, "Maine DEP asbestos list", (h) => asbestosHits(h, l.url, l.type, matchedOn, floor(l.minRows)));
    out.push(...asbestosHits(html, l.url, l.type, matchedOn, floor(l.minRows)));
  }
  return out;
}

async function asbestosSearch(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind !== "company") return [];
  const found = (await asbestosAll("business")).filter((h) => companyNamed(name, h.businessName));
  return withNote(found.slice(0, MAX), found.length > MAX ? capNote(MAX, found.length) : null);
}

/** The tables carry each business's phone (ten digits); that is the only identifier they can be searched by. */
async function asbestosSearchBy(q: IdQuery): Promise<LicenseHit[] | null> {
  const want = q.type === "phone" ? normPhone(q.value) : null;
  if (!want) return null;
  return (await asbestosAll("phone")).filter((h) => normPhone(h.phone) === want).slice(0, MAX);
}

// ── DEP certified underground storage tank installers and inspectors (individuals) ───────────────────────────────

const UST_COLUMNS = ["Name", "Company", "Town", "Phone"];
const UST_SOURCE = "Maine DEP certified underground storage tank installers and inspectors";
const GENERATION = /^(?:JR|SR|II|III|IV|V)\.?$/i;

/**
 * The page writes each row's one person "Last, First": "St. Pierre, Marc" → "Marc St. Pierre", "Boucher, Jr.,
 * Daniel" → "Daniel Boucher Jr.". Any other form is left to the shared rule.
 */
export function ustPerson(v: string | null): string | null {
  const parts = (v ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 3 && GENERATION.test(parts[1])) return `${parts[2]} ${parts[0]} ${parts[1]}`;
  if (parts.length === 2 && !/[\/&;]|\band\b/i.test(v ?? "")) return `${parts[1]} ${parts[0]}`;
  return flipPerson(v);
}

/** Rows on 2026-10-15: 95; a page with fewer than this is not read. */
const UST_MIN_ROWS = 45;

export function ustHits(html: string, matchedOn: LicenseHit["matchedOn"] = "principal", minRows = 1): LicenseHit[] {
  const out: LicenseHit[] = [];
  for (const r of headedTable(html, UST_COLUMNS, { person: ["Name"], minRows })) {
    const raw = r.Name;
    if (!raw) continue;
    const marks = Array.from(raw.matchAll(/\(\s*([^)]+?)\s*\)/g)).map((m) => m[1]);
    const name = ustPerson(clean(raw.replace(/\([^)]*\)/g, " ")));
    if (!name) continue;
    const inspector = marks.some((m) => /^INSP$/i.test(m));
    // Marks the page doesn't explain (one row carries "(C1-3)") are shown as published codes, never interpreted.
    const codes = marks.filter((m) => !/^INSP$/i.test(m)).map((m) => `code ${m}`);
    const company = r.Company;
    out.push({
      state: "ME", source: UST_SOURCE, sourceUrl: UST_INSTALLERS, businessName: company, licenseNumber: null,
      licenseType: inspector ? "Underground oil storage tank inspector" : "Underground oil storage tank installer (may install and inspect)",
      specialty: codes.length ? codes.join(", ") : null, status: null, principal: name, city: r.Town, expires: null, matchedOn,
      // Each row is one certified person: city only, no phone (round 2, decision 2).
      address: null, phone: null, holder: "individual",
      people: [{ name, role: company ? `Certified individual (company: ${company})` : "Certified individual" }],
    });
  }
  return out;
}

async function ustSearch(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const html = await page(UST_INSTALLERS, "Maine DEP tank installer list", (h) => ustHits(h, "principal", floor(UST_MIN_ROWS)));
  const found = kind === "company"
    ? ustHits(html, "business").filter((h) => companyNamed(name, h.businessName))
    : ustHits(html, "principal").filter((h) => personMatches(name, h.principal));
  return withNote(found.slice(0, MAX), found.length > MAX ? capNote(MAX, found.length) : null);
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: ASBESTOS_SOURCE, sourceUrl: ASBESTOS_CONTRACTORS, search: asbestosSearch, kinds: ["company"], searchBy: asbestosSearchBy },
  // Searched by name only (no searchBy): the page lists no license numbers, and individuals' phones are not used.
  { source: UST_SOURCE, sourceUrl: UST_INSTALLERS, search: ustSearch },
];

export const pack: StatePack = {
  state: "ME",
  checked: "2026-10-15",
  liveLicenses,
  noStatewideGcLicense: "Maine does not license general contractors or trades such as roofing and framing (Maine Attorney General); electricians, plumbers and oil and solid fuel technicians are licensed by the Office of Professional and Occupational Regulation, whose license search could not be used. Maine DEP's asbestos abatement licenses and underground tank installer certifications are searched above",
  blocked: [
    "OPOR license search, licensee list download and licensee discipline search (www.pfr.maine.gov/ALMSOnline/ALMSQuery; the electricians', plumbers' and fuel boards' \"Find a Licensee\", \"Download a List of Licensees\" and \"Search Licensee Discipline\" links all open it): robots.txt (checked 2026-10-15) has \"Disallow: /ALMSOnline/ALMSQuery/SearchResults.aspx\", \"Disallow: /ALMSOnline/ALMSQuery/ExportToCSV.aspx\", \"Disallow: /ALMSOnline/ALMSQuery/ShowDetail.aspx\" and \"Disallow: /ALMSOnline/ALMSQuery/ShowCaseDetail.aspx\", so neither the search, the CSV export nor the case details can be used",
    "www.maine.gov/cgi-bin/online/licensing (InforME; redirects to licensing.web.maine.gov/cgi-bin/online/licensing/begin.pl): checked 2026-10-15, it is the Regulatory Licensing & Permitting application service (\"submit a number of professional license transactions including applying for a new license, applying for an examination, or applying for a permit\"), not a lookup; its \"Search for License/Permit\" and \"Disciplinary/Enforcement Action\" links go to ALMSQuery (above). Nothing to search there",
    "Secretary of State corporate search (icrs.informe.org): did not answer (no response within 25 s, 2026-10-15)",
    "Electricians' Examining Board, Plumbers' Examining Board and Maine Fuel Board pages (www.maine.gov/pfr/professionallicensing/professions/…): publish no licensee lists or disciplinary action lists of their own; every list link goes to ALMSQuery (above)",
    "data.maine.gov: redirects to www.socrata.com (HTTP 404); no Maine open-data catalog to search",
  ],
};
