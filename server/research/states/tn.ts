/**
 * Tennessee. Checked live 2026-10-15.
 *
 *   Live:
 *     TN Commerce & Insurance licenses  The Department of Commerce & Insurance "Verify" license search
 *                          (verify.tn.gov → search.cloud.commerce.tn.gov; a Tyler app whose page calls its own public JSON
 *                          endpoint portal/search with the form's fields; robots.txt absent (404), no CAPTCHA on the
 *                          search form today: its configuration's reCaptcha is null). Kept to the Board for Licensing
 *                          Contractors' boards: contractors and limited licensed plumbers, limited licensed electricians,
 *                          home improvement. By organization name, by an individual licensee's last and first name, or by
 *                          license number; every status the boards list. The search names the license holder only (no
 *                          qualifying agents or owners on an organization's license), so a person is found by their own
 *                          license (limited licensed electricians and plumbers, individual contractors). Holder: the
 *                          search's own Entity Types value ("Organization" / "Individual").
 *
 *   Bulk:
 *     tn-tdec-enforcement  TDEC Enforcement Dataviewer (dataviewers.tdec.tn.gov, Oracle APEX app 999001; robots.txt
 *                          absent): every enforcement case's respondents (page 700) joined with the cases (page 710)
 *                          for the violation type, 1993 to today, as the app's own CSV downloads. Companies only:
 *                          a respondent is kept when its name is an organization's (LLC, Inc., Co., a utility, a
 *                          county, …); individuals named as respondents are left out (FCRA).
 *
 *     tn-blc-discipline    Department of Commerce & Insurance monthly Disciplinary Action Reports (tn.gov/commerce/dar/rb.html
 *                          and its archive; Excel-made PDFs, one per month), the rows of the Board for Licensing Contractors
 *                          ("Contractors & Home Improvement, Limited Licensed Electricians, Limited Licensed Plumbers") and
 *                          the Alarm Systems Contractors board, for the current and two previous years (2024 to today on
 *                          2026-10-15). Read with ../lib/a3-pdf.ts (pdftotext, else the JS reader). The reports publish no
 *                          license or case numbers: name, location, violation, action and date only. Companies only: a
 *                          respondent is kept when its name is an organization's (individuals and "Last, First" names are
 *                          left out, FCRA); for "Person dba Business" only the business name is kept.
 *
 * The division column is TDEC's own code (APC, WPC, UST, SWM, DWS, …); the dataviewer doesn't spell them out, so the
 * report shows the code.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { companyNamed, entityHolder, personMatches } from "../licenses";
import { flipPerson } from "../person-name";
import { normLicense, type IdQuery } from "../identifiers";
import { withNote } from "../notes";
import { postJson } from "./lib/g8-common";
import { splitName } from "./lib/g2-aspnet";
import { fetchWithDeadline, rateLimitHost, rethrowIfBlocked } from "../http";
import { adverseFrom } from "../adverse";
import { clean, csvRecords, usDate, type BulkHit, type BulkSource } from "../bulk";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiveLicenseSearch, StatePack } from "./types";
import { fromFile } from "./lib/g3-common";
import { pdfText, textLines } from "./lib/a3-pdf";
import { download } from "../bulk";

const TDEC_APP = "https://dataviewers.tdec.tn.gov/dataviewers/f?p=999001";
const TDEC_PAGE = "https://dataviewers.tdec.tn.gov/dataviewers/r/tdec_reports/tdec-enforcementdataviewer999001/home";

/** Organization words: a respondent without one is taken to be a person and skipped. */
const ORG = /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|L\.?P|LLP|LTD|PLLC|P\.?C|PARTNERS|PARTNERSHIP|ENTERPRISES?|CONSTRUCTION|CONTRACTING|CONTRACTORS?|BUILDERS?|HOMES|DEVELOPMENT|DEVELOPERS?|PROPERTIES|PROPERTY|GROUP|SERVICES?|INDUSTRIES|UTILITY|UTILITIES|DISTRICT|AUTHORITY|BOARD|CITY|COUNTY|TOWN|ASSOCIATION|TRUST|BANK|CHURCH|SCHOOL|UNIVERSITY|HOSPITAL|FARMS?|MART|MARKET|OIL|PETROLEUM|ENERGY|EXCAVATING|PAVING|LANDFILL|MINING|QUARRY|STONE ?WORKS|ASPHALT|CONCRETE|MATERIALS|SAND AND GRAVEL|SAND & GRAVEL|GRAVEL|TRUCKING|PLUMBING|ELECTRIC|ROOFING|DEMOLITION|ENVIRONMENTAL|DBA|D\/B\/A|USA|AMERICA)\b/i;
const ORDER = /order|settlement|cost recovery|judgment/i;
// Words that are surnames as well (Stone, Smart, Pool, Brothers, Hammers) are left out of both lists, or kept only in a
// form a surname can't take ("STONE WORKS", "POOLS", "& BROTHERS"): "John Stone" is a person (audit 2026-10-15, decision 5).

export const tdecIsOrganization = (name: string | null): boolean => !!name && ORG.test(name);

export function tdecHit(r: Record<string, string>, violation: string | null): EnforcementHit {
  const type = clean(r["Case Type"]), status = clean(r["Case Status"]), division = clean(r.Division);
  return {
    state: "TN", source: "TDEC enforcement cases (Department of Environment and Conservation)", sourceUrl: TDEC_PAGE, category: "environmental",
    name: clean(r.Respondent), id: clean(r["Order Number"]), date: usDate(r["Signed Date"]), endDate: null,
    status: [type, status ? `case ${status.toLowerCase()}` : null].filter(Boolean).join(", ") || null,
    city: clean(r.County) ? `${clean(r.County)} County` : null,
    detail: [division ? `TDEC division code ${division}` : null, violation ? `violation: ${violation}` : null, clean(r.Site) ? `site: ${clean(r.Site)}` : null,
      clean(r["EFO Name"]) ? `${clean(r["EFO Name"])} field office` : null].filter(Boolean).join("; ") || null,
    // From the case type's own words (an order, settlement or judgment); a dismissed or withdrawn case is not adverse.
    amount: null, adverse: adverseFrom([type, status].filter(Boolean).join("; "), { adverse: ORDER }),
  };
}

/** One of the app's CSV downloads: the first request opens a session (cookie + session id in the redirect). */
async function tdecCsv(page: number, session: { id: string; cookie: string } | null): Promise<{ path: string; session: { id: string; cookie: string } }> {
  let s = session;
  let url = `${TDEC_APP}:${page}:${s?.id ?? 0}:CSV::::`;
  for (let hop = 0; hop < 3; hop++) {
    await rateLimitHost(url, 2000);
    const res = await fetchWithDeadline(url, { headers: s?.cookie ? { cookie: s.cookie } : {}, redirect: "manual" }, 5 * 60_000);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      const id = loc?.match(/session=(\d+)/)?.[1];
      const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      if (!loc || !id) throw new Error("TDEC dataviewer sent no session");
      s = { id, cookie: cookie || s?.cookie || "" };
      url = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok || !/text\/csv/i.test(res.headers.get("content-type") ?? "")) throw new Error(`TDEC page ${page} sent ${res.headers.get("content-type") ?? "nothing"} (HTTP ${res.status})`);
    const path = join(tmpdir(), `ch-tdec-${Date.now()}-${page}.csv`);
    await fs.writeFile(path, Buffer.from(await res.arrayBuffer()));
    return { path, session: s! };
  }
  throw new Error("TDEC dataviewer redirected too often");
}

async function* tdecLoader(): AsyncIterable<BulkHit> {
  const respondents = await tdecCsv(700, null);
  let cases: string | null = null;
  // Violation types are a bonus: a failure skips them, but an access denial stops the load (round 2, decision 6).
  try { cases = (await tdecCsv(710, respondents.session)).path; } catch (err) { rethrowIfBlocked(err); cases = null; }
  const violations = new Map<string, string>();
  if (cases) for await (const r of fromFile(cases, (p) => csvRecords(p))) { const no = clean(r["Case Number"]), v = clean(r["Violation Type"]); if (no && v) violations.set(no, v); }
  for await (const r of fromFile(respondents.path, (p) => csvRecords(p))) {
    const name = clean(r.Respondent);
    if (!tdecIsOrganization(name)) continue;
    yield { kind: "enforcement", hit: tdecHit(r, violations.get(clean(r["Order Number"]) ?? "") ?? null), business: name, person: null };
  }
}

// ── Board for Licensing Contractors (and Alarm Systems Contractors) monthly disciplinary action reports ──────────
const DAR_PAGE = "https://www.tn.gov/commerce/dar/rb.html";
const DAR_ARCHIVE = "https://www.tn.gov/commerce/dar/rb/archive.html";
const DAR_PROGRAMS: [RegExp, string][] = [
  [/^Contractors\b/, "Board for Licensing Contractors (contractors, home improvement, limited licensed electricians and plumbers)"],
  [/^Alarm Systems Contractors\b/, "Alarm Systems Contractors Board"],
];
/** The rest of the contractor program's name, printed on the lines under each row; never part of the respondent. */
const DAR_PROGRAM_TAIL = /^(Limited Licensed Electricians, Limited|Licensed Plumbers)\b/;
const DATE_END = /^(.*?)\s*(\d{1,2}\/\d{1,2}\/\d{4})$/;
const LOCATION = /^[A-Za-z][A-Za-z .'‐-]*, ?[A-Za-z]{2}$/;
const LOCATION_GLUED = /^([A-Za-z][A-Za-z .'‐-]*, ?[A-Z]{2}) (\S.*)$/;

export type DarRow = { program: string; respondent: string; location: string; violation: string; action: string; date: string };

/**
 * The contractor-board rows of one report's text. A row is one line ending in its date; wrapped respondent,
 * violation and action text sits on the lines below it, placed under the row's own columns (so it is assigned by
 * position relative to that row, which holds in both pdftotext's and the JS reader's layout).
 */
export function parseTnDar(text: string): DarRow[] {
  const out: (DarRow & { cols: number[] })[] = [];
  let cur: (DarRow & { cols: number[] }) | null = null;
  const all = textLines(text);
  // The JS reader keeps the page margin; the program column is the leftmost text, so cut the common indent.
  const indent = Math.min(...all.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  for (const raw of all) {
    const line = raw.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (/^\s*Page \d+ of \d+$/.test(line) || /DISCIPLINARY ACTION REPORT|^\s*Program\s{2,}Respondent/.test(line)) { cur = null; continue; }
    // A row: pieces split on 2+ spaces (linear, no backtracking): program, respondent…, "City, ST", violation…, action, date.
    const pieces = Array.from(line.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g)).map((p) => ({ t: p[0], x: p.index ?? 0 }));
    const last = pieces.length ? pieces[pieces.length - 1].t.match(DATE_END) : null;
    if (/^\S/.test(line) && last && pieces.length >= 4) {
      const program = DAR_PROGRAMS.find(([re]) => re.test(pieces[0].t))?.[1];
      cur = null;
      if (!program) continue;
      if (last[1]) pieces[pieces.length - 1] = { t: last[1], x: pieces[pieces.length - 1].x };
      else pieces.pop();
      let loc = pieces.findIndex((p, i) => i >= 2 && LOCATION.test(p.t));
      if (loc < 0) {
        // "City, ST Violation…" printed with one space between them: split the piece.
        const glued = pieces.findIndex((p, i) => i >= 2 && LOCATION_GLUED.test(p.t));
        if (glued >= 0) {
          const g = pieces[glued].t.match(LOCATION_GLUED)!;
          pieces.splice(glued, 1, { t: g[1], x: pieces[glued].x }, { t: g[2], x: pieces[glued].x + g[1].length + 1 });
          loc = glued;
        }
      }
      if (loc >= 0 && pieces.length - loc === 2) {
        // The violation runs into the action ("…continued to contract $100,000 civil penalty"): split before the money.
        const v = pieces[loc + 1], at = v.t.search(/ \$[\d,]+/);
        if (at > 0) pieces.splice(loc + 1, 1, { t: v.t.slice(0, at), x: v.x }, { t: v.t.slice(at + 1), x: v.x + at + 1 });
      }
      if (loc < 0 || pieces.length - loc < 3) continue; // no "City, ST" with a violation and an action after it: not a row we can read
      const respondent = pieces.slice(1, loc), violation = pieces.slice(loc + 1, -1), action = pieces[pieces.length - 1];
      cur = {
        program, respondent: respondent.map((p) => p.t).join(" "), location: pieces[loc].t, violation: violation.map((p) => p.t).join(" "),
        action: action.t, date: last[2], cols: [respondent[0].x, pieces[loc].x, violation[0].x, action.x],
      };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^\S/.test(line) && !DAR_PROGRAM_TAIL.test(line)) { cur = null; continue; } // another board's row
    // A continuation line: strip the program-name tail, then give each piece to the column it starts under.
    const body = line.replace(DAR_PROGRAM_TAIL, (t) => " ".repeat(t.length));
    for (const piece of body.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g)) {
      const x = piece.index ?? 0;
      const [c2, c3, c4, c5] = cur.cols;
      const field = x >= c5 - 2 ? "action" : x >= c4 - 2 ? "violation" : x >= c3 - 2 ? null : x >= c2 - 2 ? "respondent" : null;
      if (field) cur[field] = `${cur[field]} ${piece[0]}`;
    }
  }
  return out.map(({ cols: _c, ...r }) => ({ ...r, respondent: r.respondent.replace(/\s+/g, " ").trim(), violation: r.violation.replace(/\s+/g, " ").trim(), action: r.action.replace(/\s+/g, " ").trim() }));
}

/** Organization words for a contractor respondent (the TDEC list, plus trades and the words these reports use). */
const DAR_ORG = /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|L\.?P|LLP|LTD|PLLC|P\.?C|GP|PARTNERS|PARTNERSHIP|ENTERPRISES?|CONSTRUCTION|CONTRACTING|CONTRACTORS?|BUILDERS?|BUILDING|HOMES?|DEVELOPMENT|DEVELOPERS?|PROPERTIES|PROPERTY|GROUP|SERVICES?|SOLUTIONS|INDUSTRIES|ROOFING|ROOF|RESTORATION|REMODELING|RENOVATIONS?|IMPROVEMENTS?|POOLS|PLUMBING|ELECTRIC(AL)?|MECHANICAL|HEATING|AIR|HVAC|EXTERIORS?|SIDING|GUTTERS?|WINDOWS?|DOORS?|PAINTING|CONCRETE|PAVING|EXCAVATING|LANDSCAPING|FENCE|FENCING|DESIGNS?|SYSTEMS|SECURITY|TECHNOLOGIES|TECHNOLOGY|CONSULTING|MANAGEMENT|INVESTMENTS?|HOLDINGS|NEWCO|USA|AMERICA|SOLAR|ENERGY|REMODEL|REMODELER|HARDSCAPES?|FLOORING|SEPTIC|OUTDOORS?|COUNTERTOPS|LANDSCAPE|IRON WORKS|RENOVATORS|CONSULTANTS|DECKS?|DECK PRO|STRUCTURES|FINISHING|BUILDINGS|DEMOLITION|CABINETRY|CABINETS|TURNKEY|REALTY|VENTURES|CRAWL ?SPACE|BUILDS|BUILT|HOMEWORKS|RECONSTRUCTION|MAINTENANCE|FIRM|FOUNDATION|ROOFERS?|PROFESSIONALS?|OPERATIONS|LAWN|(?<=& |AND )BROTHERS|CARPENTRY|RESIDENTIAL|HARDWOOD|GARDENS|PAINTERS|UNLIMITED|BUILDCO|REMOVAL|ASSOCIATES|EXPERTS|XPERTS|WORX|INTERIORS|METAL|SAFETY|DBA|D\/B\/A)\b|\.com\b/i;
const DBA = /\s+(?:dba|d\/b\/a|doing business as)\s+/i;

/** The business named on a row, or null when the respondent is an individual (FCRA: companies only). */
export function darBusiness(respondent: string): string | null {
  const name = respondent.replace(/\s+/g, " ").trim();
  if (/^[A-Z][A-Za-z'‐-]+, [A-Z][a-z]+(?: [A-Z]\.?)?$/.test(name)) return null; // "James, Ian M."
  const [left, right] = name.split(DBA);
  if (right != null) return DAR_ORG.test(left.replace(DBA, " ")) ? name : DAR_ORG.test(right) || right.split(" ").length > 1 ? right : null;
  if (/^\d/.test(name)) return name; // "101 Contractor"
  return DAR_ORG.test(name) ? name : null;
}

export function darHit(r: DarRow, sourceUrl: string): EnforcementHit | null {
  const name = darBusiness(r.respondent);
  if (!name) return null;
  const fine = r.action.match(/\$\s?([\d,]+(?:\.\d+)?)\s+civil penalty/i);
  return {
    state: "TN", source: "TN Board for Licensing Contractors and Alarm Systems Contractors Board disciplinary actions", sourceUrl, category: "discipline",
    name, id: null, date: usDate(r.date), endDate: null, status: r.action, city: r.location,
    detail: `${r.program}. Violation: ${r.violation}`, amount: fine ? Number(fine[1].replace(/,/g, "")) : null,
    // From the action's own words: dismissed or withdrawn → false; a penalty, revocation, … → true; mixed or negated
    // wording ("civil penalty waived", "no civil penalty") → null (round 2, decision 4).
    adverse: adverseFrom(r.action, { adverse: /penalt|revo|suspen|costs|probation|cease|desist/i }),
  };
}

/** The report PDFs of the current and two previous years, from the board's page and its archive. */
async function darPdfs(): Promise<string[]> {
  const year = new Date().getUTCFullYear();
  const urls = new Set<string>();
  for (const page of [DAR_PAGE, DAR_ARCHIVE]) {
    await rateLimitHost(page, 1500);
    const res = await fetchWithDeadline(page, {}, 60_000);
    if (!res.ok) throw new Error(`${page} returned HTTP ${res.status}`);
    for (const m of (await res.text()).matchAll(/href="([^"]*\/regboards\/dar\/(\d{4})\/[^"]+\.pdf)"/gi)) {
      if (Number(m[2]) >= year - 2) urls.add(new URL(m[1], page).toString());
    }
  }
  if (urls.size < 12) throw new Error(`only ${urls.size} disciplinary action reports linked`);
  return Array.from(urls);
}

async function* darLoader(): AsyncIterable<BulkHit> {
  const seen = new Set<string>();
  for (const url of await darPdfs()) {
    const path = await download(url);
    let text: string;
    try { text = (await pdfText(await fs.readFile(path))).text; } finally { await fs.rm(path, { force: true }); }
    for (const r of parseTnDar(text)) {
      const hit = darHit(r, url);
      if (!hit) continue;
      const key = `${hit.name}|${hit.date}|${r.violation}|${r.action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield { kind: "enforcement", hit, business: hit.name, person: null };
    }
  }
}


// ── Department of Commerce & Insurance "Verify" license search (search.cloud.commerce.tn.gov, live) ──────────────
const VERIFY_PAGE = "https://search.cloud.commerce.tn.gov/";
const VERIFY_API = "https://search.cloud.commerce.tn.gov/api/rs/api/endpoints/v1/portal/search";
const VERIFY_SOURCE = "TN Commerce & Insurance licenses (contractors, home improvement, limited licensed electricians and plumbers)";
/** The search's own Boards filter values (portal/search/configuration, 2026-10-15; the electricians' label has two spaces). */
export const VERIFY_BOARDS = ["Contractors and Ltd Licensed Plumbers", "Contractors:  Limited Licensed Electricians", "Home Improvement"];
const VERIFY_ROWS = 50;
const VERIFY_PAGES = 2;

/** One result card as the search answers it (portal/search results[]). */
export type VerifyCard = { id: string; title: string | null; subtitle: string | null; details?: { label: string | null; values: (string | null)[] | null }[] | null };

/**
 * One card as a license hit, or null when it carries no license number (an application, not a license).
 * The card's "License Details" values are unlabeled; their order was checked against the same record's labeled
 * details page (portal/search/<id>/details: License number and type, Status, Expiration Date): license group, license
 * type, license number, status, expiration date. "Primary Contact Information" puts the street first (kept out: city
 * and ZIP only) and "CITY, State ZIP" fourth. The card's subtitle is the search's own Entity Types filter value
 * ("Organization" or "Individual").
 */
export function verifyHit(c: VerifyCard, matchedOn: LicenseHit["matchedOn"]): LicenseHit | null {
  const lic = c.details?.find((d) => d.label === "License Details")?.values ?? [];
  const contact = c.details?.find((d) => d.label === "Primary Contact Information")?.values ?? [];
  const number = clean(lic[2]);
  if (!number) return null;
  const holder = entityHolder(c.subtitle, { business: /^Organization$/, individual: /^Individual$/ });
  const name = clean(c.title);
  const person = holder === "individual" ? flipPerson(name) : null;
  const expires = /^\d{2}\/\d{2}\/\d{4}$/.test(lic[4] ?? "") ? usDate(lic[4]!) : null;
  return {
    state: "TN", source: VERIFY_SOURCE, sourceUrl: `${VERIFY_PAGE}search/${encodeURIComponent(c.id)}/detail`,
    businessName: holder === "individual" ? null : name, licenseNumber: number, licenseType: clean(lic[1]) ?? clean(lic[0]),
    specialty: null, status: clean(lic[3]), principal: person, city: clean(contact[3]), expires, matchedOn,
    address: null, phone: null, people: person ? [{ name: person, role: null }] : [],
    holder,
  };
}

/**
 * A results page as the search's own success answer, or an error (round 8, finding 7): a numeric resultCount and a
 * results list (null only for a count of 0), no longer than a page, and not empty while the count says rows remain.
 * Anything else ({"error": "Search unavailable"}, a missing count) is an unreadable answer, so the source reads "not
 * searched", never 0 matches.
 */
export function verifyPage(r: unknown, start: number): VerifyCard[] {
  const x = r as { resultCount?: unknown; results?: unknown } | null;
  const count = x?.resultCount;
  const rows = x?.results === null && count === 0 ? [] : x?.results;
  const ok = typeof count === "number" && Number.isInteger(count) && count >= 0 && Array.isArray(rows) && rows.length <= VERIFY_ROWS
    && !(count > start && rows.length === 0) && rows.every((c) => c && typeof c === "object");
  if (!ok) throw new Error("TN Commerce & Insurance license search: the source answered with an unreadable page");
  return rows as VerifyCard[];
}

/** One search (the page's own form request), the contractor boards only, up to VERIFY_PAGES pages of results. */
async function verifySearch(values: Record<string, string>, keep: (c: VerifyCard) => boolean): Promise<{ cards: VerifyCard[]; more: boolean }> {
  const out: VerifyCard[] = [];
  let more = false;
  for (let page = 0; page < VERIFY_PAGES; page++) {
    const r = await postJson<{ resultCount?: number; results?: VerifyCard[] | null }>(VERIFY_API, {
      appliedFilters: VERIFY_BOARDS.map((b) => `board:${b}`).join(","), highlight: "true",
      formRequest: { metadata: null, values }, lookupString: null, rows: VERIFY_ROWS, start: page * VERIFY_ROWS, type: "credential",
    }, "TN Commerce & Insurance license search", 1200);
    const rows = verifyPage(r, page * VERIFY_ROWS);
    const kept = rows.filter(keep);
    out.push(...kept);
    // The search ranks its results; when the last page read still had matches and the search has more, say so.
    more = (r.resultCount ?? 0) > (page + 1) * VERIFY_ROWS && kept.length > 0;
    if (!more || rows.length < VERIFY_ROWS) break;
  }
  return { cards: out, more };
}

async function searchVerify(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind === "company") {
    const { cards, more } = await verifySearch({ organizationName: name.trim() }, (c) => companyNamed(name, c.title));
    const hits = cards.map((c) => verifyHit(c, "business")).filter((h): h is LicenseHit => !!h);
    return withNote(hits, more ? `read the first ${VERIFY_PAGES * VERIFY_ROWS} ranked results; the search had more` : null);
  }
  const parts = splitName(name);
  if (!parts) return [];
  const { cards, more } = await verifySearch({ lastName: parts.last, firstName: parts.first }, (c) => c.subtitle === "Individual" && personMatches(name, flipPerson(c.title)));
  const hits = cards.map((c) => verifyHit(c, "principal")).filter((h): h is LicenseHit => !!h);
  return withNote(hits, more ? `read the first ${VERIFY_PAGES * VERIFY_ROWS} ranked results; the search had more` : null);
}

/** The search takes a license number (its License Number field); not phones or addresses. */
async function searchVerifyBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null;
  const want = normLicense(q.value);
  if (!want || !/^\d+$/.test(want)) return null; // the boards' license numbers are digits only
  const { cards } = await verifySearch({ licenseNumber: want }, (c) => normLicense(c.details?.find((d) => d.label === "License Details")?.values?.[2] ?? null) === want);
  return cards.map((c) => verifyHit(c, "license")).filter((h): h is LicenseHit => !!h);
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: VERIFY_SOURCE, sourceUrl: VERIFY_PAGE, search: searchVerify, searchBy: searchVerifyBy },
];

const BULK: BulkSource[] = [
  // 7,800 respondent rows on 2026-10-15, 5,308 of them organizations.
  { id: "tn-tdec-enforcement", state: "TN", label: "TDEC enforcement cases", pageUrl: TDEC_PAGE, everyHours: 24 * 7, minRows: 3_700, load: tdecLoader, companiesOnly: true, category: "environmental" },
  // 602 rows (2024 to 2026-09) on 2026-10-15. The floor allows for January, when a whole year leaves the window.
  // Without pdftotext the JS reader reads only the 2026 reports (the 2024–2025 ones are rotated pages it can't lay out),
  // about 150 rows: under the floor, so such a load keeps the previous one instead of replacing it.
  { id: "tn-blc-discipline", state: "TN", label: "TN Board for Licensing Contractors and Alarm Systems Contractors Board disciplinary actions", pageUrl: DAR_PAGE, everyHours: 24 * 7, minRows: 380, load: darLoader, companiesOnly: true, category: "discipline" },
];

export const pack: StatePack = {
  state: "TN",
  checked: "2026-10-15",
  liveLicenses,
  bulk: BULK,
  blocked: [
    "TN Commerce & Insurance Verify (search.cloud.commerce.tn.gov), re-checked 2026-10-15: the search runs without a CAPTCHA (its search configuration's reCaptcha is null) and is used above; it publishes no qualifying agents or owners on an organization's license, and no disciplinary history",
    "TN Secretary of State business search (tnbear.tn.gov): connection timed out from our server on 2026-10-15; retried 2026-10-15 06:56 and 06:58 UTC from tower1 and vb11: TCP connect still times out (robots.txt unreachable too)",
    "TN Secretary of State business entity search (tncab.tnsos.gov, the newer TNCaB system): the search page runs reCAPTCHA and Cloudflare Turnstile",
    "TDEC asbestos and lead-based paint accreditations (dataviewers app 35001): searchable only through form posts, no list download found",
  ],
};
