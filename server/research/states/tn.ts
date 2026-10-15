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

const BULK: BulkSource[] = [
  // 7,800 respondent rows on 2026-10-15, 5,308 of them organizations.
  { id: "tn-tdec-enforcement", state: "TN", label: "TDEC enforcement cases", pageUrl: TDEC_PAGE, everyHours: 24 * 7, minRows: 3_700, load: tdecLoader, companiesOnly: true },
];

export const pack: StatePack = {
  state: "TN",
  checked: "2026-10-15",
  bulk: BULK,
  blocked: [
    "TN Department of Commerce & Insurance license search (search.cloud.commerce.tn.gov: contractors, home improvement, electricians, plumbers): the public search runs reCAPTCHA",
    "TN Board for Licensing Contractors disciplinary actions: monthly PDF reports only (tn.gov/commerce/dar), no table or download",
    "TN Secretary of State business search (tnbear.tn.gov): connection timed out from our server on 2026-10-15",
    "TDEC asbestos and lead-based paint accreditations (dataviewers app 35001): searchable only through form posts, no list download found",
  ],
};
