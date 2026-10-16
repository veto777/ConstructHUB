/**
 * Idaho. Checked live 2026-10-15.
 *
 *   ID Secretary of State business entities: the Secretary of State's public business search (sosbiz.idaho.gov,
 *     its JSON API; robots.txt allows it), with status and standing as published (Active-Existing, Inactive-Forfeited,
 *     Good Standing, ...). Companies only.
 *   ID DOPL eDOPL licenses: DOPL's "Public License Individual Search" (edopl.idaho.gov/OnlineServices/?link=PubSearch),
 *     the real-time lookup of every DOPL license, searched by name (individual, business or DBA) or license number.
 *     Checked live 2026-10-15: no login, no CAPTCHA, no bot check; its Primary Source Disclosure Statement says the
 *     data is public under the Idaho Public Records Law and sets no use limit. It is a FAST Enterprises "WDC" app: a
 *     session cookie, then JSON calls (_/?Load=1 draws the form, _/EventOccurred runs the search, _/SelectTablePage
 *     turns the 25-row results page), each carrying the version token the previous answer gave (Fast-Ver-Last).
 *     robots.txt is "Disallow: /", which is advisory for research searches since 2026-10-15 (../http.ts). The lookup
 *     covers every board; only the Contractors (general contractor registration), Electrical, Plumbing, HVAC and
 *     Public Works boards' license types are kept. The columns are DOPL's own: license number, type, name, DBA,
 *     status, expiration and Discipline (Yes/No; the details sit on each license's own page, not read here).
 *
 * The bulk "Public License List Search" (Excel export, with city and state) is not used: the live lookup is
 * real-time and DOPL says it carries more than the list. DOPL's own site (dopl.idaho.gov) publishes no discipline list
 * for the construction boards; see `blocked`.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../http";
import { companyNamed, personMatches, tokens } from "../licenses";
import { clean, usDate } from "../bulk";
import { normLicense, type IdQuery } from "../identifiers";
import { flipPerson } from "../person-name";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";
import { capNote, withNote } from "../notes";
import { Session, htmlText } from "./lib/g6-common";
import { looksLikeBusiness, personNameForm } from "./lib/business-name";

const SOS_SEARCH_PAGE = "https://sosbiz.idaho.gov/search/business";
const SOS_API = "https://sosbiz.idaho.gov/api/Records/businesssearch";

const hasAll = (name: string, v: string | null | undefined) => { const want = tokens(name); const have = new Set(tokens(v ?? "")); return want.length > 0 && want.every((w) => have.has(w)); };

export type IdSosRow = { TITLE?: (string | null)[]; RECORD_NUM?: string | null; FILING_DATE?: string | null; STATUS?: string | null; STANDING?: string | null };

/** "BOISE ROOFING LLC (556603)" → "BOISE ROOFING LLC". */
export function idSosHit(r: IdSosRow): EnforcementHit {
  const status = clean(r.STATUS), standing = clean(r.STANDING);
  return {
    state: "ID", source: "Idaho Secretary of State business entities", sourceUrl: SOS_SEARCH_PAGE,
    category: "business_status", name: clean(r.TITLE?.[0]?.replace(/\s*\(\d+\)\s*$/, "")), id: clean(r.RECORD_NUM), date: usDate(r.FILING_DATE), endDate: null,
    status: [status ? `Secretary of State status: ${status}` : null, standing ? `standing: ${standing}` : null].filter(Boolean).join(", ") || null,
    city: null, detail: clean(r.TITLE?.[1]), amount: null,
    adverse: /forfeit|revoked/i.test(status ?? "") ? true : null,
  };
}

async function searchIdSos(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/\s+/g, " ").trim();
  if (q.length < 3) return [];
  const res = await politeFetch(SOS_API, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json", referer: SOS_SEARCH_PAGE },
    body: JSON.stringify({ SEARCH_VALUE: q, STARTS_WITH_YN: true, CRA_SEARCH_YN: false, ACTIVE_ONLY_YN: false, FILING_DATE: { start: null, end: null } }),
  }, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`Idaho Secretary of State returned HTTP ${res.status}`);
  return idSosResults(name, await res.json().catch(() => null));
}

/** The register answers at most 500 rows (checked 2026-10-15: a search for "Idaho" stops at exactly 500). */
const MAX_ROWS = 500;

/**
 * The answer's rows (an object keyed by id; {} when nothing matches). An answer without `rows` (an error object) is
 * an error, never "no records".
 */
export function idSosResults(name: string, data: unknown): EnforcementHit[] {
  const rows = (data as { rows?: unknown } | null)?.rows;
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) throw new Error("Idaho Secretary of State returned an unexpected payload");
  const all = Object.values(rows as Record<string, IdSosRow>);
  const hits = all.map(idSosHit).filter((h) => hasAll(name, h.name));
  return withNote(hits, all.length >= MAX_ROWS ? capNote(MAX_ROWS, null, "names on the register that start with this name") : null);
}

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Idaho Secretary of State business entities", scope: "Every business entity and assumed business name on the Secretary of State's register (names that start with the search)", category: "business_status", search: searchIdSos },
];

// ── DOPL eDOPL Public License Individual Search (FAST WDC) ──────────────────────────────────────────────────────
const EDOPL_BASE = "https://edopl.idaho.gov/OnlineServices/";
const EDOPL_SEARCH = `${EDOPL_BASE}?link=PubSearch`;
const EDOPL_SOURCE = "Idaho DOPL licenses (eDOPL: contractor registration, electrical, plumbing, HVAC, public works)";

/**
 * The license types of the Contractors, Electrical, Plumbing, HVAC and Public Works (PWCL) boards, as the lookup's
 * License Type list names them (2026-10-15). Every other board's license (nurses, engineers, real estate...) is left out.
 */
const CONSTRUCTION_TYPE = /^(?:General Contractor Registration|(?:Limited )?Electrical .+|Residential Electrician License|Plumbing .+|HVAC .+|Public Works .+|Construction Management Certificate of Authority License)$/i;
/** The types that are a person's own credential (an apprentice, journeyman, trainee or installer card). */
const PERSONAL_TYPE = /\b(?:Apprentice|Journeyman|Trainee|Installer|Residential Electrician)\b/i;

/** Results pages read per search (25 rows each); a name with more rows than this says so in the report. */
const EDOPL_MAX_PAGES = 4;

export type EdoplRow = { license: string | null; type: string | null; name: string | null; dba: string | null; status: string | null; expires: string | null; discipline: string | null };
export type EdoplTable = { tableId: string; total: number; rows: EdoplRow[] };
export type EdoplForm = { fields: string[]; nameField: string; licenseField: string; searchEvent: string };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "29-Nov-2027" (the lookup's date format) → "2027-11-29"; anything else null. */
export function edoplDay(v: string | null | undefined): string | null {
  const m = clean(v)?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  const mo = m ? MONTHS.indexOf(m[2].toUpperCase()) + 1 : 0;
  if (!m || !mo) return null;
  return usDate(`${mo}/${m[1]}/${m[3]}`);
}

const labelFor = (html: string, caption: string): string | null => {
  for (const m of Array.from(html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>\s*<span[^>]*>([^<]*)<\/span>/g))) if (htmlText(m[2]) === caption) return m[1];
  return null;
};

/** The search form the Load answer draws: its field names, the name and license-number fields and the Search button. */
export function edoplForm(html: string): EdoplForm {
  const fields = Array.from(new Set(Array.from(html.matchAll(/<(?:input|select)\b[^>]*\bname="(D[a-z]-[0-9a-z]+)"/g), (m) => m[1])));
  const nameField = labelFor(html, "Name (individual, business, DBA)"), licenseField = labelFor(html, "License Number");
  const searchEvent = Array.from(html.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*data-event="LinkClick"[^>]*>\s*<span[^>]*>Search<\/span>/g))[0]?.[1] ?? null;
  if (!nameField || !licenseField || !searchEvent || !fields.includes(nameField) || !fields.includes(licenseField)) throw new Error("Idaho eDOPL returned an unexpected search form");
  return { fields, nameField, licenseField, searchEvent };
}

/**
 * The results table of a search or page answer: its id, DOPL's total row count (every page) and this page's rows,
 * read by the table's own column captions. "No results returned" is zero rows; any other answer without the
 * table is an error, never "no records".
 */
export function edoplTable(html: string): EdoplTable {
  const table = html.match(/<table\b[^>]*\bclass="DocTable\b[^"]*"[^>]*>[\s\S]*?<\/table>/)?.[0];
  if (!table) {
    if (/>\s*No results returned\s*</.test(html)) return { tableId: "", total: 0, rows: [] };
    throw new Error("Idaho eDOPL returned an unexpected page");
  }
  const tableId = table.match(/^<table\b[^>]*\bid="([^"]+)"/)?.[1] ?? "";
  const total = Number(table.match(/^<table\b[^>]*\bdata-fast-rowcount="(\d+)"/)?.[1] ?? NaN);
  const caps = Array.from(table.matchAll(/<col\b[^>]*\bdata-cap="([^"]*)"/g), (m) => htmlText(m[1]) ?? "");
  const need = ["License Number", "Type", "Name", "DBA", "Status", "Expiration", "Discipline"];
  if (!tableId || !Number.isFinite(total) || need.some((c) => !caps.includes(c))) throw new Error("Idaho eDOPL returned an unexpected results table");
  const rows: EdoplRow[] = [];
  for (const tr of Array.from(table.matchAll(/<tr\b[^>]*\bdata-row="\d+"[^>]*>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g), (m) => htmlText(m[1]));
    const v = (cap: string) => cells[caps.indexOf(cap)] ?? null;
    rows.push({ license: v("License Number"), type: v("Type"), name: v("Name"), dba: v("DBA"), status: v("Status"), expires: edoplDay(v("Expiration")), discipline: v("Discipline") });
  }
  return { tableId, total, rows };
}

/** A row as a license hit (null for another board's license, or a row without a name). */
export function edoplHit(r: EdoplRow, matchedOn: LicenseHit["matchedOn"]): LicenseHit | null {
  if (!r.name || !r.type || !CONSTRUCTION_TYPE.test(r.type)) return null;
  const personal = PERSONAL_TYPE.test(r.type);
  // A contractor license is a business's when its name reads as one; a name in a person's form is a sole
  // proprietor's (unknown holder); an apprentice/journeyman/trainee/installer card is the person's own.
  const business = !personal && personNameForm(r.name) === null && looksLikeBusiness(r.name);
  const person = business ? null : flipPerson(r.name);
  const dba = r.dba && r.dba.toUpperCase() !== r.name.toUpperCase() ? r.dba : null;
  return {
    state: "ID", source: EDOPL_SOURCE, sourceUrl: EDOPL_SEARCH,
    businessName: business ? r.name : dba, licenseNumber: r.license, licenseType: r.type, specialty: null, status: r.status,
    principal: person, city: null, expires: r.expires, matchedOn,
    people: person ? [{ name: person, role: r.type }] : [],
    holder: business ? "business" : personal ? "individual" : null,
    discipline: r.discipline === "Yes" ? "DOPL's license search marks this license Discipline: Yes (the details are on its eDOPL license record)" : null,
  };
}

/** The version token FAST hands back on every answer (a header, or the page's FWDC.setVerLast call). */
type Ver = { last: string; source: string };
const verOf = (res: Response, prev: Ver, html?: string): Ver => {
  const h = res.headers.get("fast-ver-last");
  if (h) return { last: h, source: res.headers.get("fast-ver-source") ?? "" };
  const m = html?.match(/FWDC\.setVerLast\('([^']+)',\s*'([^']*)'\)/);
  return m ? { last: m[1], source: m[2] } : prev;
};

// The honest UA and Accept only: no X-Requested-With, Fast-XHR or Referer posing as the page's own script (audit
// 2026-10-15, decision 12; eDOPL answered the same without them on 2026-10-15).
const JSON_ACCEPT = { accept: "application/json" };

/** One eDOPL search session: open the form, search one field, read up to EDOPL_MAX_PAGES pages. */
async function edoplSearch(field: "name" | "license", value: string): Promise<{ rows: EdoplRow[]; total: number }> {
  const s = new Session(1500);
  const label = "Idaho eDOPL license search";
  const win = `FWDC.WND-${Array.from({ length: 3 }, () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0")).join("-")}`;
  let ajax = 0;
  const first = await s.fetch(EDOPL_SEARCH);
  if (!first.ok) throw new Error(`${label} returned HTTP ${first.status}`);
  const page = await first.text();
  let ver = verOf(first, { last: "", source: "" }, page);
  if (!ver.last) throw new Error(`${label} returned an unexpected page`);
  const common = (trigger: string, source = "") => ({
    FAST_SCRIPT_VER__: "1", FAST_VERLAST__: ver.last, FAST_VERLAST_SOURCE__: ver.source, FAST_CLIENT_WHEN__: String(Date.now()),
    FAST_CLIENT_WINDOW__: win, FAST_CLIENT_AJAX_ID__: String(++ajax), FAST_CLIENT_TRIGGER__: trigger, FAST_CLIENT_SOURCE_ID__: source,
  });
  const json = async (res: Response): Promise<Record<string, unknown>> => {
    if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}`);
    if (res.headers.get("fast-session-expired")) throw new Error(`${label}: the session expired`);
    const text = await res.text();
    ver = verOf(res, ver);
    try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`${label} returned an unexpected payload`); }
  };
  const load = await json(await s.fetch(`${EDOPL_BASE}_/?${new URLSearchParams({ Load: "1", ...common("InitPage") })}`, { headers: JSON_ACCEPT }));
  const manager = ((load.contents as { manager?: string }[] | undefined) ?? []).find((c) => typeof c?.manager === "string")?.manager;
  if (!manager) throw new Error(`${label} returned an unexpected payload`);
  const form = edoplForm(manager);
  const post = async (path: string, body: Record<string, string>) => {
    const data = await json(await s.fetch(`${EDOPL_BASE}_/${path}`, { method: "POST", body: new URLSearchParams(body).toString(), headers: { ...JSON_ACCEPT, "content-type": "application/x-www-form-urlencoded" } }));
    if (data.result !== 0 || typeof data.html !== "string") throw new Error(`${label} returned an unexpected payload`);
    return edoplTable(data.html);
  };
  const fields = Object.fromEntries(form.fields.map((f) => [f, ""]));
  fields[field === "name" ? form.nameField : form.licenseField] = value;
  let t = await post("EventOccurred", {
    ...fields, LASTFOCUSFIELD__: form.searchEvent, DOC_MODAL_ID__: "0", EVENT__: form.searchEvent, TYPE__: "0", CLOSECONFIRMED__: "false",
    ...common("DocFieldLinkClick", form.searchEvent),
  });
  const rows = [...t.rows];
  for (let p = 2; rows.length < t.total && p <= EDOPL_MAX_PAGES; p++) {
    const tableId = t.tableId;
    t = await post("SelectTablePage", { LASTFOCUSFIELD__: `${tableId}_Vpgnext`, DOC_MODAL_ID__: "0", TABLE_VIEW__: tableId, TABLE_PAGE__: String(p), ...common("") });
    if (!t.rows.length) break;
    rows.push(...t.rows);
  }
  return { rows, total: t.total };
}

const SUFFIX = /\b(?:INC|INCORPORATED|LLC|L L C|CO|CORP|CORPORATION|COMPANY|LTD|PLLC|LLP)\b\.?/gi;
/** The name as the lookup takes it: punctuation and a corporate suffix dropped (the lookup matches words). */
export const edoplQuery = (name: string): string => (clean(name.replace(/[.,'"]/g, " ").replace(SUFFIX, " ")) ?? "").toUpperCase();

/** The hits of one answer that the searched name names (business, DBA or the person), and a note when it stopped early. */
export function edoplNameHits(name: string, kind: "person" | "company", rows: EdoplRow[], total: number): LicenseHit[] {
  const q = edoplQuery(name);
  const hits = rows.map((r) => edoplHit(r, kind === "company" ? "business" : "principal")).filter((h): h is LicenseHit => !!h)
    .filter((h) => kind === "company" ? companyNamed(q, h.businessName) : personMatches(name, h.principal));
  return withNote(hits, total > rows.length ? capNote(rows.length, total, "eDOPL licenses of every board under this name") : null);
}

async function searchEdopl(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const q = edoplQuery(name);
  if (tokens(q).length === 0 || q.length < 3) return [];
  const { rows, total } = await edoplSearch("name", q);
  return edoplNameHits(name, kind, rows, total);
}

async function searchEdoplBy(q: IdQuery): Promise<LicenseHit[] | null> {
  const want = q.type === "license" ? normLicense(q.value) : null;
  if (!want) return null; // the lookup searches by name and license number only
  const { rows } = await edoplSearch("license", q.value.trim().toUpperCase());
  // The lookup matches license numbers by contains ("41390" finds RCE-41390 and CS41390): exact numbers only.
  return rows.filter((r) => normLicense(r.license) === want).map((r) => edoplHit(r, "license")).filter((h): h is LicenseHit => !!h);
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: EDOPL_SOURCE, sourceUrl: EDOPL_SEARCH, search: searchEdopl, searchBy: searchEdoplBy },
];

export const pack: StatePack = {
  state: "ID",
  checked: "2026-10-15",
  liveLicenses,
  liveEnforcement,
  blocked: [
    "DOPL website (dopl.idaho.gov; robots.txt 'Disallow:' empty): the Contractors (/con/), Electrical (/ele/), Plumbing (/plb/), HVAC (/hvac/) and Public Works (/pwc/) board pages link only to eDOPL (searched live above; its Discipline Search and per-license discipline details are not read); the site's only discipline pages are for other boards (Accountancy /boa/boa-discipline/, Shorthand Reporters /sre/sre-disciplinary-actions/) (checked 2026-10-15)",
    "data.idaho.gov: a data-governance site (AI readiness, data literacy, policies), not a dataset catalog; an ArcGIS Online search for Idaho contractor/licensee/electrician/plumber items found no license register (checked 2026-10-15)",
    "Idaho Attorney General consumer protection (ag.idaho.gov): contractor settlements (assurances of voluntary compliance) are announced as newsroom press releases only, with no list or dataset (checked 2026-10-15)",
  ],
};
