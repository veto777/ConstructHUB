/**
 * Tennessee. Checked live 2026-10-15.
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
import type { EnforcementHit } from "@shared/research-reports";
import { USER_AGENT, rateLimitHost } from "../../scrapers/polite-fetch";
import { clean, csvRecords, usDate, type BulkHit, type BulkSource } from "../bulk";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StatePack } from "./types";
import { fromFile } from "./lib/g3-common";
import { pdfText, textLines } from "./lib/a3-pdf";
import { download } from "../bulk";

const TDEC_APP = "https://dataviewers.tdec.tn.gov/dataviewers/f?p=999001";
const TDEC_PAGE = "https://dataviewers.tdec.tn.gov/dataviewers/r/tdec_reports/tdec-enforcementdataviewer999001/home";

/** Organization words: a respondent without one is taken to be a person and skipped. */
const ORG = /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|L\.?P|LLP|LTD|PLLC|P\.?C|PARTNERS|PARTNERSHIP|ENTERPRISES?|CONSTRUCTION|CONTRACTING|CONTRACTORS?|BUILDERS?|HOMES|DEVELOPMENT|DEVELOPERS?|PROPERTIES|PROPERTY|GROUP|SERVICES?|INDUSTRIES|UTILITY|UTILITIES|DISTRICT|AUTHORITY|BOARD|CITY|COUNTY|TOWN|ASSOCIATION|TRUST|BANK|CHURCH|SCHOOL|UNIVERSITY|HOSPITAL|FARMS?|MART|MARKET|OIL|PETROLEUM|ENERGY|EXCAVATING|PAVING|LANDFILL|MINING|QUARRY|STONE|ASPHALT|CONCRETE|MATERIALS|SAND|GRAVEL|TRUCKING|PLUMBING|ELECTRIC|ROOFING|DEMOLITION|ENVIRONMENTAL|DBA|D\/B\/A|USA|AMERICA)\b/i;
const ORDER = /order|settlement|cost recovery|judgment/i;

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
    amount: null, adverse: type && ORDER.test(type) ? true : null,
  };
}

/** One of the app's CSV downloads: the first request opens a session (cookie + session id in the redirect). */
async function tdecCsv(page: number, session: { id: string; cookie: string } | null): Promise<{ path: string; session: { id: string; cookie: string } }> {
  let s = session;
  let url = `${TDEC_APP}:${page}:${s?.id ?? 0}:CSV::::`;
  for (let hop = 0; hop < 3; hop++) {
    await rateLimitHost(url, 2000);
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT, ...(s?.cookie ? { cookie: s.cookie } : {}) }, redirect: "manual" });
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
  try { cases = (await tdecCsv(710, respondents.session)).path; } catch { cases = null; } // violation types are a bonus
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
const DAR_ORG = /\b(L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|L\.?P|LLP|LTD|PLLC|P\.?C|GP|PARTNERS|PARTNERSHIP|ENTERPRISES?|CONSTRUCTION|CONTRACTING|CONTRACTORS?|BUILDERS?|BUILDING|HOMES?|DEVELOPMENT|DEVELOPERS?|PROPERTIES|PROPERTY|GROUP|SERVICES?|SOLUTIONS|INDUSTRIES|ROOFING|ROOF|RESTORATION|REMODELING|RENOVATIONS?|IMPROVEMENTS?|POOLS?|PLUMBING|ELECTRIC(AL)?|MECHANICAL|HEATING|AIR|HVAC|EXTERIORS?|SIDING|GUTTERS?|WINDOWS?|DOORS?|PAINTING|CONCRETE|PAVING|EXCAVATING|LANDSCAPING|FENCE|FENCING|DESIGNS?|SYSTEMS|SECURITY|SMART|TECHNOLOGIES|TECHNOLOGY|CONSULTING|MANAGEMENT|INVESTMENTS?|HOLDINGS|NEWCO|USA|AMERICA|SOLAR|ENERGY|REMODEL|REMODELER|HARDSCAPES?|FLOORING|SEPTIC|OUTDOORS?|COUNTERTOPS|LANDSCAPE|IRON WORKS|RENOVATORS|CONSULTANTS|DECKS?|DECK PRO|STRUCTURES|FINISHING|BUILDINGS|DEMOLITION|CABINETRY|CABINETS|TURNKEY|REALTY|VENTURES|CRAWL ?SPACE|BUILDS|BUILT|HOMEWORKS|RECONSTRUCTION|MAINTENANCE|FIRM|FOUNDATION|ROOFERS?|PROFESSIONALS?|OPERATIONS|LAWN|BROTHERS|CARPENTRY|RESIDENTIAL|HARDWOOD|GARDENS|PAINTERS|UNLIMITED|BUILDCO|HAMMERS|REMOVAL|ASSOCIATES|EXPERTS|XPERTS|WORX|INTERIORS|METAL|SAFETY|DBA|D\/B\/A)\b|\.com\b/i;
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
    adverse: /penalt|revo|suspen|costs|probation|cease|desist/i.test(r.action) ? true : null,
  };
}

/** The report PDFs of the current and two previous years, from the board's page and its archive. */
async function darPdfs(): Promise<string[]> {
  const year = new Date().getUTCFullYear();
  const urls = new Set<string>();
  for (const page of [DAR_PAGE, DAR_ARCHIVE]) {
    await rateLimitHost(page, 1500);
    const res = await fetch(page, { headers: { "user-agent": USER_AGENT } });
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
  bulk: BULK,
  blocked: [
    "TN Department of Commerce & Insurance license search (search.cloud.commerce.tn.gov: contractors, home improvement, electricians, plumbers): the public search runs reCAPTCHA",
    "TN Secretary of State business search (tnbear.tn.gov): connection timed out from our server on 2026-10-15; retried 2026-10-15 06:56 and 06:58 UTC from tower1 and vb11: TCP connect still times out (robots.txt unreachable too)",
    "TN Secretary of State business entity search (tncab.tnsos.gov, the newer TNCaB system): the search page runs reCAPTCHA and Cloudflare Turnstile",
    "TDEC asbestos and lead-based paint accreditations (dataviewers app 35001): searchable only through form posts, no list download found",
  ],
};
