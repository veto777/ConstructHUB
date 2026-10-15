/**
 * New Jersey. Checked live 2026-10-15.
 *
 * Licenses (bulk, Division of Consumer Affairs "License Verification – Download" site, newjersey.mylicense.com/
 * Verification_Bulk: a free pipe-delimited roster per profession, through the site's own search → Download List →
 * Continue ($0.00) → Download steps; no login):
 *   nj-hic     Home Improvement Contractors (registrations; Home Improvement and Home Elevation business contractors)
 *   nj-trades  Electrical Contractors board (electrical contractors, journeyman electricians, wiremen, apprentices,
 *              burglar/fire alarm and locksmith licenses, and the business permits), Master Plumbers board (master and
 *              journeyman plumbers, medical-gas piping), HVACR board (master HVACR contractors), EEMW board (elevator
 *              mechanics)
 *   nj-design  Architects, professional engineers and land surveyors (people and certificates of authorization),
 *              home inspectors
 *   Continuing-education sponsors, course providers and in-training registrations are left out.
 *
 * Enforcement (companies only):
 *   nj-debarments  NJDOL Division of Wage and Hour Compliance debarment list (Prevailing Wage Act; public works),
 *                  published only as a public Power BI report linked from nj.gov/labor/.../debarmentlist.shtml
 *   nj-wall        NJDOL Workplace Accountability in Labor List (The WALL): businesses with unpaid final judgments for
 *                  wage, benefit, workers' comp and tax violations, barred from public contracting (monthly .xlsx)
 *   nj-watchlist   NJDOL Wage Violation Watchlist: employers found in violation of a state wage and hour law (.xlsx)
 *
 * Standing (live, companies only):
 *   NJ Division of Revenue and Enterprise Services business name search (njportal.com/DOR/BusinessNameSearch): entity
 *   id, type, city and formation date of every entity whose name starts with the search (no status is shown).
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { USER_AGENT, politeFetch, rateLimitHost } from "../http";
import { clean, csvRecords, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import { excelDate, readXlsx } from "./lib/g1-xlsx";
import { publicPowerBiRows } from "./lib/g1-powerbi";
import type { LiveEnforcementSearch, StatePack } from "./types";

// ── NJ Division of Consumer Affairs licensee downloads ──────────────────────────────────────────────────────────
const MYLICENSE = "https://newjersey.mylicense.com/Verification_Bulk/";
const MYLICENSE_PAGE = "https://newjersey.mylicense.com/Verification/";

/** Hidden + text inputs and the selected option of each select, as the browser would post them. */
export function aspFields(html: string): URLSearchParams {
  const form = new URLSearchParams();
  for (const m of Array.from(html.matchAll(/<input[^>]*>/g))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = (tag.match(/type="([^"]+)"/)?.[1] ?? "text").toLowerCase();
    if (!name || !["hidden", "text"].includes(type)) continue;
    form.set(name, decodeEntities(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const m of Array.from(html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))) {
    const opt = m[2].match(/<option[^>]*selected="selected"[^>]*value="([^"]*)"/) ?? m[2].match(/<option[^>]*value="([^"]*)"/);
    form.set(m[1], opt ? decodeEntities(opt[1]) : "");
  }
  return form;
}

/** One profession's roster, saved to a temp file (the caller deletes it). `business`: the business-licensee search. */
async function myLicenseRoster(profession: string, business: boolean): Promise<string> {
  const jar = new Map<string, string>();
  const keep = (res: Response) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); } };
  const cookie = () => Array.from(jar, ([k, v]) => `${k}=${v}`).join("; ");
  const step = async (path: string, form?: URLSearchParams): Promise<string> => {
    const url = MYLICENSE + path;
    await rateLimitHost(url, 1500);
    const res = await fetch(url, {
      method: form ? "POST" : "GET", body: form?.toString(), redirect: "manual",
      headers: { "user-agent": USER_AGENT, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(jar.size ? { cookie: cookie() } : {}) },
    });
    keep(res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`NJ DCA download site redirected without a location (HTTP ${res.status})`);
      return step(new URL(loc, url).toString().replace(MYLICENSE, ""));
    }
    if (!res.ok) throw new Error(`NJ DCA download site returned HTTP ${res.status} for ${path}`);
    return res.text();
  };
  const search = `Search.aspx?facility=${business ? "Y" : "N"}`;
  let form = aspFields(await step(search));
  form.set("t_web_lookup__profession_name", profession);
  form.set("__EVENTTARGET", "t_web_lookup__profession_name");
  form = aspFields(await step(search, form));
  form.set("__EVENTTARGET", "");
  form.set("sch_button", "Search");
  let html = await step(search, form);
  if (!/btnBulkDownLoad/.test(html)) throw new Error(`NJ DCA search for ${profession} returned no download button`);
  form = aspFields(html);
  form.set("btnBulkDownLoad", "Download List");
  html = await step("SearchResults.aspx", form);
  if (!/btnContinue/.test(html) || !/\$0\.00/.test(html)) throw new Error("NJ DCA download confirmation changed (no free Continue step)");
  form = aspFields(html);
  form.set("btnContinue", "Continue");
  html = await step("Confirmation.aspx?from_page=Login.aspx", form);
  form = aspFields(html);
  form.set("sch_button", "Download");
  return download(MYLICENSE + "PrefDetails.aspx", {
    method: "POST", body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
  });
}

const NOT_A_LICENSE = /CE Sponsor|CPC (Provider|Class)|Instructor|In-Training/i;

function njRosterLoader(label: string, lists: { profession: string; business: boolean }[]): () => AsyncIterable<BulkHit> {
  return async function* () {
    for (const list of lists) {
      // The site sometimes answers a download with an error page: try up to three times, a minute apart.
      let path = "";
      for (let attempt = 1; ; attempt++) {
        path = await myLicenseRoster(list.profession, list.business);
        const head = (await fs.readFile(path, "utf8")).slice(0, 200);
        if (head.startsWith("full_name|")) break;
        await fs.rm(path, { force: true });
        if (attempt >= 3) throw new Error(`NJ DCA ${list.profession} roster has an unexpected layout: ${head.replace(/\s+/g, " ").slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 60_000));
      }
      try {
        for await (const r of csvRecords(path, "|")) {
          const type = clean(r.license_type_name);
          if (!type || NOT_A_LICENSE.test(type)) continue;
          const full = clean(r.full_name);
          if (!full) continue;
          const person = list.business ? null : clean([r.first_name, r.middle_name, r.last_name, r.name_suffix].map(clean).filter(Boolean).join(" ")) ?? full;
          const business = list.business ? full : null;
          const zip = /^\d{9}$/.test(r.addr_zipcode ?? "") ? `${r.addr_zipcode.slice(0, 5)}-${r.addr_zipcode.slice(5)}` : r.addr_zipcode; // "078654204"
          const address = clean([r.addr_line_1, r.addr_line_2, r.addr_city, r.addr_state, zip].map(clean).filter(Boolean).join(" "));
          yield {
            kind: "license",
            hit: {
              state: "NJ", source: label, sourceUrl: MYLICENSE_PAGE, businessName: business, licenseNumber: clean(r.license_no),
              licenseType: type, specialty: clean(r.profession_name), status: clean(r.license_status_name), principal: person,
              city: [clean(r.addr_city), clean(r.addr_state)].filter(Boolean).join(", ") || null, expires: usDate(r.expiration_date),
              matchedOn: business ? "business" : "principal", address,
            },
            business, person,
            keys: { licenses: [r.license_no], addresses: [address] },
          };
        }
      } finally {
        await fs.rm(path, { force: true });
      }
    }
  };
}

// ── NJDOL prevailing-wage debarment list (public Power BI report) ───────────────────────────────────────────────
const NJ_DEBAR_PAGE = "https://nj.gov/labor/wageandhour/registration-permits/register/debarmentlist.shtml";
const NJ_DEBAR_REPORT = "https://app.powerbigov.us/view?r=eyJrIjoiZDQxYTM0MDMtMGQ2Mi00ZTRkLThmNzQtNTYyYjBhNjhiMTQyIiwidCI6IjUwNzZjM2QxLTM4MDItNGI5Zi1iMzZhLWUwYTQxYmQ2NDJhNyJ9";

async function* njDebarmentsLoader(): AsyncIterable<BulkHit> {
  const rows = await publicPowerBiRows(NJ_DEBAR_REPORT, "WEB_DEBARREDCONTRACTORS",
    ["TRADE_NAME", "EMPLOYER_NUM", "EXPIRATION_DATE", "ADDRESS1", "ADDRESS2", "CITY", "STATE", "ZIPCODE", "COUNTY", "DEBAR_CATEGORY"]);
  const today = new Date().toISOString().slice(0, 10);
  for (const r of rows) {
    const name = clean(r.TRADE_NAME == null ? null : String(r.TRADE_NAME));
    if (!name) continue;
    const end = typeof r.EXPIRATION_DATE === "number" ? new Date(r.EXPIRATION_DATE).toISOString().slice(0, 10) : null;
    const category = clean(r.DEBAR_CATEGORY == null ? null : String(r.DEBAR_CATEGORY));
    const address = clean(["ADDRESS1", "ADDRESS2", "CITY", "STATE", "ZIPCODE"].map((k) => (r[k] == null ? "" : String(r[k]))).join(" "));
    const hit: EnforcementHit = {
      state: "NJ", source: "New Jersey DOL prevailing-wage debarments", sourceUrl: NJ_DEBAR_PAGE, category: "debarment",
      name, id: r.EMPLOYER_NUM == null ? null : String(r.EMPLOYER_NUM), date: null, endDate: end,
      status: [category, end ? (end < today ? `through ${end} (period over)` : `through ${end}`) : null].filter(Boolean).join(" ") || null,
      city: [clean(String(r.CITY ?? "")), clean(String(r.STATE ?? ""))].filter(Boolean).join(", ") || null,
      detail: "Debarred under the New Jersey Prevailing Wage Act from bidding on or working on public works contracts", amount: null, adverse: true,
      address,
    };
    yield { kind: "enforcement", hit, business: name, person: null, keys: { addresses: [address] } };
  }
}

// ── NJDOL The WALL and the Wage Violation Watchlist (.xlsx) ─────────────────────────────────────────────────────
const NJ_WALL_PAGE = "https://www.nj.gov/labor/ea/osec/wall.shtml";
const NJ_WALL_FILE = "https://www.nj.gov/labor/ea/assets/PDFs/Wall_Dataset.xlsx";
const NJ_WATCH_PAGE = "https://nj.gov/labor/ea/osec/wageviolationlist.shtml";
const NJ_WATCH_FILE = "https://www.nj.gov/labor/ea/assets/PDFs/WVW-List.xlsx";

const records = (rows: string[][]): Record<string, string>[] => {
  const header = (rows[0] ?? []).map((h) => h.replace(/\s+/g, " ").trim());
  return rows.slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, (row[i] ?? "").trim()])));
};

/** Rows of each worksheet asked for, as objects keyed by its header row (header text with runs of spaces collapsed). */
async function xlsxSheets(url: string, sheets: number[]): Promise<Record<string, string>[][]> {
  const path = await download(url);
  try {
    const out: Record<string, string>[][] = [];
    for (const n of sheets) out.push(records(await readXlsx(path, n)));
    return out;
  } finally {
    await fs.rm(path, { force: true });
  }
}
async function* xlsxRecords(url: string): AsyncIterable<Record<string, string>> {
  yield* (await xlsxSheets(url, [1]))[0];
}

const money = (v: string | undefined) => { const n = Number(v); return v && Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cityOf = (address: string | undefined) => clean(address?.split(",").slice(-2).join(",").replace(/\s+\d{5}(-\d{4})?\s*$/, ""));

async function* njWallLoader(): AsyncIterable<BulkHit> {
  // Sheet 2 ("Add.Locations") lists each employer's other addresses.
  const [main, more] = await xlsxSheets(NJ_WALL_FILE, [1, 2]);
  const others = new Map<string, string[]>();
  for (const r of more) {
    const n = clean(r["Name of Employer/DBA"])?.toUpperCase(), a = clean(r["Address of Employer"]);
    if (n && a) others.set(n, [...(others.get(n) ?? []), a]);
  }
  for (const r of main) {
    const name = clean(r["Name of Employer/DBA"]);
    if (!name) continue;
    if (!("Violation Type" in r)) throw new Error("The WALL file has an unexpected layout");
    const violation = clean(r["Violation Type"]);
    const owed = money(r["Total Liability Owed Under Final Judgment / Order"]);
    const hit: EnforcementHit = {
      state: "NJ", source: "New Jersey DOL Workplace Accountability in Labor List (The WALL)", sourceUrl: NJ_WALL_PAGE,
      category: violation && /tax/i.test(violation) ? "tax_lien" : "wage", name, id: null,
      date: excelDate(r["Date Posted on the WALL"]), endDate: null, status: "On the WALL (barred from public contracting until paid)",
      city: cityOf(r["Employer's Principal Address"]),
      detail: [violation ? `Unpaid final judgment or order: ${violation}` : null, clean(r["Industry Type"]), owed != null ? `${usd(owed)} owed` : null,
        clean(r.County) ? `${clean(r.County)} County` : null].filter(Boolean).join(". ") || null,
      amount: owed, adverse: true, address: clean(r["Employer's Principal Address"]),
    };
    yield { kind: "enforcement", hit, business: name, person: null, keys: { addresses: [r["Employer's Principal Address"], ...(others.get(name.toUpperCase()) ?? [])] } };
  }
}

async function* njWatchlistLoader(): AsyncIterable<BulkHit> {
  for await (const r of xlsxRecords(NJ_WATCH_FILE)) {
    const name = clean(r["Name of Employer/DBA"]);
    if (!name) continue;
    if (!("Nature of Claim" in r)) throw new Error("The Wage Violation Watchlist file has an unexpected layout");
    const wages = money(r["Final Wages Assessed"]), fees = money(r["Fee and Penalty Assessed"]);
    const workers = Number(r["Affected Employees"]);
    const hit: EnforcementHit = {
      state: "NJ", source: "New Jersey DOL Wage Violation Watchlist", sourceUrl: NJ_WATCH_PAGE, category: "wage", name, id: null,
      date: excelDate(r["Date of Final Order and Judgement"]), endDate: null, status: clean(r.Status),
      city: cityOf(r["Employer Address"]),
      detail: [clean(r["Nature of Claim"]), Number.isFinite(workers) && workers > 0 ? `${workers} employee(s)` : null,
        wages != null ? `wages assessed ${usd(wages)}` : null, fees != null ? `fees and penalties ${usd(fees)}` : null].filter(Boolean).join(". ") || null,
      amount: wages, adverse: true, address: clean(r["Employer Address"]),
    };
    yield { kind: "enforcement", hit, business: name, person: null, keys: { addresses: [r["Employer Address"]] } };
  }
}

// ── NJ Division of Revenue business name search (live) ──────────────────────────────────────────────────────────
const NJ_BIZ = "https://www.njportal.com/DOR/BusinessNameSearch/Search/BusinessName";
const ENTITY_SUFFIX = /^(INC|INCORPORATED|LLC|L\.L\.C|CORP|CORPORATION|CO|COMPANY|LTD|LP|LLP|PC|PLLC)$/;

export function parseNjBusinessNames(html: string): EnforcementHit[] {
  const table = html.match(/<table class="table table-data[\s\S]*?<\/table>/)?.[0] ?? "";
  const out: EnforcementHit[] = [];
  for (const m of Array.from(table.matchAll(/<tr>\s*<td>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(("<td>" + m[1]).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (cells.length < 5) continue;
    const plain = (v: string) => clean(decodeEntities(v.replace(/<[^>]+>/g, " ")));
    const name = plain(cells[0]);
    if (!name) continue;
    const typeName = clean(decodeEntities(cells[3].match(/title="([^"]+)"/)?.[1] ?? "")) ?? plain(cells[3]);
    out.push({
      state: "NJ", source: "New Jersey Division of Revenue business entity records", sourceUrl: NJ_BIZ, category: "business_status",
      name, id: plain(cells[1]), date: usDate(plain(cells[4])), endDate: null, status: "On file with the Division of Revenue (this search shows no status)",
      city: plain(cells[2]), detail: typeName ? `${typeName}, formed or registered ${plain(cells[4]) ?? "(no date)"}` : null, amount: null, adverse: null,
    });
  }
  return out;
}

/** The search matches from the start of the name ("%" is its wildcard): the name's words up to an entity suffix. */
async function searchNjBusinessNames(name: string): Promise<EnforcementHit[]> {
  const words = name.toUpperCase().replace(/[^A-Z0-9& ]/g, " ").split(/\s+/).filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && ENTITY_SUFFIX.test(w));
  const q = (cut > 0 ? words.slice(0, cut) : words).slice(0, 4).join("%");
  if (q.replace(/%/g, "").length < 3) return [];
  const page = await politeFetch(NJ_BIZ, {}, { minDelayMs: 1500 });
  if (!page.ok) throw new Error(`NJ business name search returned HTTP ${page.status}`);
  const html = await page.text();
  const token = html.match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)?.[1];
  if (!token) throw new Error("NJ business name search page changed (no form token)");
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const res = await politeFetch(NJ_BIZ, {
    method: "POST", body: new URLSearchParams({ __RequestVerificationToken: token, BusinessName: q }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", referer: NJ_BIZ, ...(cookie ? { cookie } : {}) },
  }, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`NJ business name search returned HTTP ${res.status}`);
  const body = await res.text();
  if (!/Incorporated Date/.test(body)) return []; // no table: nothing on file under this name
  return parseNjBusinessNames(body);
}

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "New Jersey Division of Revenue business entity records", scope: "Every business entity on file, by name", category: "business_status", search: searchNjBusinessNames },
];

export const pack: StatePack = {
  state: "NJ",
  checked: "2026-10-15",
  bulk: [
    { id: "nj-hic", state: "NJ", label: "New Jersey home improvement contractor registrations (Division of Consumer Affairs)", pageUrl: MYLICENSE_PAGE,
      everyHours: 24, minRows: 100_000, load: njRosterLoader("New Jersey home improvement contractor registrations", [{ profession: "Home Improvement Contractors", business: true }]) },
    { id: "nj-trades", state: "NJ", label: "New Jersey electrical, plumbing, HVACR and elevator licenses (Division of Consumer Affairs)", pageUrl: MYLICENSE_PAGE,
      everyHours: 24, minRows: 60_000, load: njRosterLoader("New Jersey electrical, plumbing, HVACR and elevator licenses", [
        { profession: "Electrical Contractors", business: false }, { profession: "Electrical Contractors", business: true },
        { profession: "Master Plumbers", business: false }, { profession: "HVACR", business: false }, { profession: "EEMW", business: false },
      ]) },
    { id: "nj-design", state: "NJ", label: "New Jersey architects, engineers, land surveyors and home inspectors (Division of Consumer Affairs)", pageUrl: MYLICENSE_PAGE,
      everyHours: 24 * 7, minRows: 60_000, load: njRosterLoader("New Jersey architects, engineers, land surveyors and home inspectors", [
        { profession: "Architecture", business: false }, { profession: "Architecture", business: true },
        { profession: "Engineers & Land Surveyors", business: false }, { profession: "Engineers & Land Surveyors", business: true },
        { profession: "Home Inspection Advisory Comm", business: false },
      ]) },
    { id: "nj-debarments", state: "NJ", label: "New Jersey DOL prevailing-wage debarments", pageUrl: NJ_DEBAR_PAGE, everyHours: 24, minRows: 100,
      load: njDebarmentsLoader, companiesOnly: true, category: "debarment" },
    { id: "nj-wall", state: "NJ", label: "New Jersey DOL Workplace Accountability in Labor List (The WALL)", pageUrl: NJ_WALL_PAGE, everyHours: 24 * 7, minRows: 280,
      load: njWallLoader, companiesOnly: true, category: "wage" },
    { id: "nj-watchlist", state: "NJ", label: "New Jersey DOL Wage Violation Watchlist", pageUrl: NJ_WATCH_PAGE, everyHours: 24 * 7, minRows: 750,
      load: njWatchlistLoader, companiesOnly: true, category: "wage" },
  ],
  liveEnforcement: LIVE_ENFORCEMENT,
  noStatewideGcLicense: "New Jersey does not license general contractors statewide; home improvement contractors register with the Division of Consumer Affairs, and electricians, plumbers and HVACR contractors are licensed by their boards (all searched above)",
  blocked: [
    "NJ Division of Revenue entity status and standing: only the paid NJ Business Records Service shows it; the free name search (used) has no status",
    "NJ Courts public access (portal.njcourts.gov): behind an Incapsula bot wall, no bulk data or API",
    "NJ Division of Consumer Affairs board actions and consumer complaints: published only as individual PDFs and press releases",
    "NJDOL stop-work orders: announced only in press releases, no list",
  ],
};
