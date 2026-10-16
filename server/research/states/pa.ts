/**
 * Pennsylvania. Checked live 2026-10-15. Pennsylvania licenses no general contractor statewide; home improvement
 * contractors register with the Attorney General (whose search is behind a CAPTCHA, see `blocked`), and trades are
 * licensed by municipalities. The two largest cities publish theirs:
 *
 * Licenses (bulk):
 *   pa-philadelphia  Philadelphia L&I trade licenses (contractor, electrical contractor, plumbers, sheet metal, fire
 *                    suppression, engineers, home inspectors, …): City of Philadelphia open data, phl.carto.com
 *                    table trade_licenses
 *   pa-pittsburgh    Pittsburgh PLI licensed contractors (general and sign contractors) and trade licenses
 *                    (electrical, HVAC, fire suppression, stationary engineers): WPRDC datastore
 *
 * Enforcement and standing (companies only):
 *   pa-dli-debarments  PA Labor & Industry Prevailing Wage Act debarments (the department's Debarments and
 *                      Settlements page; individuals named with a firm are left out)
 *   PA DGS Commonwealth debarment and suspension list (live search of dgs.internet.state.pa.us/debarmentsearch)
 *   PA Department of State active business registrations (data.pa.gov 3urc-uaba, one row per business)
 *   PA Unified Judicial System web portal court cases naming the company (live "Organization" search): magisterial
 *     district, criminal and appellate dockets; civil cases in the Courts of Common Pleas are not on the portal
 */
import { promises as fs } from "node:fs";
import type { EnforcementHit } from "@shared/research-reports";
import { fetchWithDeadline, politeFetch, rateLimitHost } from "../http";
import { hasEnded } from "../adverse";
import { capNote, withNote } from "../notes";
import { looksLikeBusiness } from "./lib/business-name";
import { personText } from "../person-name";
import { clean, csvRecords, download, usDate, type BulkHit } from "../bulk";
import { decodeEntities } from "../bulk-sources";
import type { SodaEnforcement } from "../state-records";
import type { LiveEnforcementSearch, StatePack } from "./types";

const text = (v: string) => clean(decodeEntities(v.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[​‌‍﻿]/g, "")));
const iso = (v: string | null | undefined) => { const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/); return m && +m[1] >= 1900 && +m[1] < 2099 ? `${m[1]}-${m[2]}-${m[3]}` : null; };

// ── Philadelphia L&I trade licenses ─────────────────────────────────────────────────────────────────────────────
const PHL_PAGE = "https://opendataphilly.org/datasets/licenses-and-inspections-trade-licenses/";
const PHL_CSV = "https://phl.carto.com/api/v2/sql?format=csv&q=" + encodeURIComponent(
  "SELECT licensenumber, licensetype, licensestatus, contactname, companyname, issuedate, expirationdate FROM trade_licenses");

/**
 * Who holds a Philadelphia trade license, from its class (round 2, decision 2; licensetype values checked
 * 2026-10-16): inspection agencies are businesses; the master, journeyman, apprentice, technician, inspector,
 * engineer and other personal classes are a person's, whatever company is named with them; the contractor classes
 * (CONTRACTOR, ELECTRICAL CONTRACTOR, …, DEMOLITION, PA HOME IMPROVEMENT) are issued to people and companies alike
 * and say neither.
 */
export function phillyHolder(type: string | null | undefined): "business" | "individual" | null {
  const t = (type ?? "").toUpperCase().trim();
  if (!t) return null;
  if (/AGENCY$/.test(t)) return "business";
  if (/CONTRACTOR|^DEMOLITION$|HOME IMPROVEMENT/.test(t)) return null;
  return "individual";
}

async function* phillyLoader(): AsyncIterable<BulkHit> {
  const path = await download(PHL_CSV);
  try {
    for await (const r of csvRecords(path)) {
      if (!("licensetype" in r)) throw new Error("Philadelphia trade licenses: unexpected layout");
      const company = clean(r.companyname), who = personText(r.contactname); // the contact as published: a list stays a list
      if (!company && !who) continue;
      yield {
        kind: "license",
        hit: {
          state: "PA", source: "Philadelphia L&I trade licenses", sourceUrl: PHL_PAGE, businessName: company, licenseNumber: clean(r.licensenumber),
          licenseType: clean(r.licensetype), specialty: null, status: clean(r.licensestatus), principal: who, city: "Philadelphia",
          expires: iso(r.expirationdate), matchedOn: company ? "business" : "principal", holder: phillyHolder(r.licensetype),
        },
        business: company, person: who,
      };
    }
  } finally {
    await fs.rm(path, { force: true });
  }
}

// ── Pittsburgh PLI contractor and trade licenses (WPRDC) ────────────────────────────────────────────────────────
const PGH_PAGE = "https://data.wprdc.org/dataset/business-contractors-trades";
const PGH_FILES: { resource: string; label: string; people: boolean }[] = [
  { resource: "7e195511-5219-4d16-84f7-f34a2aedf5b4", label: "Pittsburgh PLI licensed contractors", people: false },
  // Trade licenses are issued to the tradesperson: business_name holds a person's name.
  { resource: "51470435-a36f-4385-aee2-1c4766214a9a", label: "Pittsburgh PLI trade licenses", people: true },
];

export async function* pittsburghLoader(): AsyncIterable<BulkHit> {
  for (const f of PGH_FILES) {
    // The datastore API, a page at a time (the CSV dump endpoint answers 502 at times).
    for (let offset = 0; ; offset += 5000) {
      const res = await politeFetch(`https://data.wprdc.org/api/3/action/datastore_search?resource_id=${f.resource}&limit=5000&offset=${offset}`, { headers: { accept: "application/json" } }, { minDelayMs: 1500, retries: 3 });
      if (!res.ok) throw new Error(`${f.label}: WPRDC returned HTTP ${res.status}`);
      const body = await res.json() as { success?: boolean; result?: { records?: Record<string, unknown>[] } };
      const records = body.result?.records;
      if (!body.success || !Array.isArray(records)) throw new Error(`${f.label}: unexpected WPRDC payload`);
      if (!records.length) break;
      for (const rec of records) {
        const r = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v == null ? "" : String(v)]));
        if (!("license_type_name" in r)) throw new Error(`${f.label}: unexpected layout`);
        const name = clean(r.business_name);
        if (!name) continue;
        const who = f.people ? personText(r.business_name) : null; // the tradesperson as published: a list stays a list
        yield {
          kind: "license",
          hit: {
            state: "PA", source: f.label, sourceUrl: PGH_PAGE, businessName: f.people ? null : name, licenseNumber: clean(r.license_number),
            licenseType: clean(r.license_type_name), specialty: null, status: clean(r.license_state), principal: who,
            city: "Pittsburgh", expires: iso(r.expiration_date), matchedOn: f.people ? "principal" : "business",
            holder: f.people ? "individual" : "business",
          },
          // A trade license name may be a person or a shop: both searches find it.
          business: name, person: who,
        };
      }
      if (records.length < 5000) break;
    }
  }
}

// ── PA L&I Prevailing Wage Act debarments ───────────────────────────────────────────────────────────────────────
const PA_DLI_DEBAR = "https://www.pa.gov/agencies/dli/resources/compliance-laws-and-regulations/labor-management-relations/labor-law/prevailing-wage/debarments-and-settlements";

/** The debarment table: each row names firms, then "and <person>, individually" (people are dropped: companies only). */
export function parseDliDebarments(html: string): { firms: string[]; address: string | null; addresses: string[]; date: string | null }[] {
  const out: { firms: string[]; address: string | null; addresses: string[]; date: string | null }[] = [];
  const table = Array.from(html.matchAll(/<table[\s\S]*?<\/table>/g)).map((m) => m[0]).find((t) => /DATE OF DEBARMENT/i.test(t)) ?? "";
  for (const row of Array.from(table.matchAll(/<tr>([\s\S]*?)<\/tr>/g))) {
    const cells = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (cells.length < 3) continue;
    // Keep the line breaks: each <br> line is a firm, "and", or a person.
    const lines = decodeEntities(cells[0].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[\u200b\u200c\u200d\ufeff]/g, ""))
      .split("\n").map((l) => clean(l)).filter((l): l is string => !!l && !/^and$/i.test(l));
    // "<person>, individually" lines are people; so is any other line that doesn't read as a business (FCRA).
    const firms = lines.filter((l) => !/,?\s*individually$/i.test(l) && looksLikeBusiness(l));
    if (!firms.length) continue;
    const addrLines = decodeEntities(cells[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).split("\n").map((l) => clean(l)).filter((l): l is string => !!l);
    // An address is a street line followed by its "City, ST 12345" line, or both on one line.
    const addresses: string[] = [];
    for (const l of addrLines) {
      if (/^\d|^P\.?\s?O\.?\s?Box/i.test(l) || !addresses.length) addresses.push(l);
      else addresses[addresses.length - 1] += `, ${l}`;
    }
    out.push({ firms, address: addresses.join("; ") || null, addresses, date: usDate(text(cells[2])) });
  }
  return out;
}

async function* dliDebarmentsLoader(): AsyncIterable<BulkHit> {
  await rateLimitHost(PA_DLI_DEBAR, 1500);
  const res = await fetchWithDeadline(PA_DLI_DEBAR, {}, 120_000);
  if (!res.ok) throw new Error(`PA L&I debarment page returned HTTP ${res.status}`);
  const rows = parseDliDebarments(await res.text());
  for (const r of rows) {
    const name = r.firms.join(" / ");
    const end = r.date ? `${Number(r.date.slice(0, 4)) + 3}${r.date.slice(4)}` : null;
    const over = hasEnded(end);
    const hit: EnforcementHit = {
      state: "PA", source: "Pennsylvania L&I Prevailing Wage Act debarments", sourceUrl: PA_DLI_DEBAR, category: "debarment",
      name, id: null, date: r.date, endDate: end,
      status: over ? "Three-year debarment over" : "Debarred from public works contracts",
      city: null,
      detail: [r.addresses[0] ? `Address listed: ${r.addresses[0]}` : null, "Under section 11(e) of the Prevailing Wage Act, no contract is awarded for 3 years after the date listed"].filter(Boolean).join(". "),
      // The row's later addresses may be the named individuals' (homes): only the first, the firm's, is a key.
      // On the list is the department's finding; once the 3 years are over the debarment no longer applies.
      amount: null, adverse: !over, address: r.addresses[0] ?? null,
    };
    yield { kind: "enforcement", hit, business: r.firms.join(" "), person: null, keys: { addresses: r.addresses.slice(0, 1) } };
  }
}

// ── PA DGS debarment and suspension list (live) ─────────────────────────────────────────────────────────────────
const DGS_PAGE = "https://www.dgs.internet.state.pa.us/debarmentsearch/debarment/index";
const DGS_LOOKUP = "https://www.dgs.internet.state.pa.us/debarmentsearch/Debarment/DebarmentLookup";

type DgsRow = { DebarmentListId?: number; Type?: string; VendorName?: string; EffectiveDate?: string | null; EndDate?: string | null; AddressLine1?: string | null; AddressLine2?: string | null; City?: string | null; State?: string | null; Zip?: string | null; AgencyName?: string | null; Reason?: string | null };

export function dgsHit(r: DgsRow, archived: boolean): EnforcementHit | null {
  const name = clean(r.VendorName);
  if (!name) return null;
  const end = iso(r.EndDate ?? null);
  return {
    state: "PA", source: "Pennsylvania DGS debarment and suspension list", sourceUrl: r.DebarmentListId != null ? `https://www.dgs.internet.state.pa.us/debarmentsearch/Debarment/Details/${r.DebarmentListId}` : DGS_PAGE,
    category: "debarment", name, id: r.DebarmentListId != null ? String(r.DebarmentListId) : null, date: iso(r.EffectiveDate ?? null),
    endDate: end, status: [clean(r.Type), end ? `until ${end}` : r.EndDate?.startsWith("2099") ? "with no end date" : null, archived ? "(archived)" : null].filter(Boolean).join(" ") || null,
    city: [clean(r.City), clean(r.State)].filter(Boolean).join(", ") || null,
    detail: [clean(r.AgencyName) ? `By the ${clean(r.AgencyName)}` : null, clean(r.Reason)].filter(Boolean).join(": ") || null,
    // Debarred or suspended is the agency's own action; an archived entry or one past its end date has ended.
    amount: null, adverse: !(archived || hasEnded(end)),
    address: clean(r.AddressLine1) ? clean([r.AddressLine1, r.AddressLine2, r.City, r.State, r.Zip].map((v) => clean(v ?? null)).filter(Boolean).join(" ")) : null,
  };
}

/** The list matches part of the vendor name: search the longest word, then the caller keeps whole-name matches. */
async function searchDgs(name: string): Promise<EnforcementHit[]> {
  const words = name.toUpperCase().replace(/[^A-Z0-9& ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !/^(INC|LLC|CORP|THE|AND|COMPANY)$/.test(w));
  if (!words.length) return [];
  const word = words.reduce((a, b) => (b.length > a.length ? b : a));
  const page = await politeFetch(DGS_PAGE, {}, { minDelayMs: 1500 });
  if (!page.ok) throw new Error(`PA DGS debarment search returned HTTP ${page.status}`);
  const token = (await page.text()).match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)?.[1];
  if (!token) throw new Error("PA DGS debarment search page changed (no form token)");
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const hits: EnforcementHit[] = [];
  const notes: string[] = [];
  for (const archived of [false, true]) {
    const body = new URLSearchParams({ draw: "1", start: "0", length: "500", VendorName: word, SAPNumber: "", VendorUniqueId: "", ddlAgencyCode: "", Archived: String(archived) });
    const res = await politeFetch(DGS_LOOKUP, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", RequestVerificationToken: token, referer: DGS_PAGE, ...(cookie ? { cookie } : {}) } }, { minDelayMs: 1500 });
    if (!res.ok) throw new Error(`PA DGS debarment search returned HTTP ${res.status}`);
    const json = await res.json() as { data?: DgsRow[]; recordsFiltered?: number; recordsTotal?: number };
    if (!Array.isArray(json.data)) throw new Error("PA DGS debarment search returned an unexpected payload");
    const total = Number(json.recordsFiltered ?? json.recordsTotal);
    if (Number.isFinite(total) && total > json.data.length) notes.push(`${archived ? "archived list: " : ""}${capNote(json.data.length, total, `entries containing "${word}"`)}`);
    for (const r of json.data) {
      const h = dgsHit(r, archived);
      if (h && !hits.some((x) => x.id === h.id)) hits.push(h);
    }
  }
  return withNote(hits, notes.join("; ") || null);
}

// ── PA UJS web portal court cases (live) ────────────────────────────────────────────────────────────────────────
const UJS = "https://ujsportal.pacourts.us/CaseSearch";

export function parseUjsCases(html: string): EnforcementHit[] {
  const table = html.match(/<table[^>]*id="caseSearchResultGrid"[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error("PA UJS portal returned an unexpected page");
  const heads = Array.from(table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map((h) => text(h[1]) ?? "");
  const col = (label: string) => heads.indexOf(label, 1);
  // A renamed column would otherwise read as "no cases": the grid must still carry the columns the rows are read by.
  for (const need of ["Docket Number", "Case Caption", "Filing Date"]) if (col(need) < 0) throw new Error(`PA UJS portal results changed (no "${need}" column)`);
  const out: EnforcementHit[] = [];
  for (const row of Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)).slice(1)) {
    const raw = Array.from(row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((c) => c[1]);
    if (raw.length < heads.length - 1) continue;
    const cell = (label: string) => { const i = col(label); return i >= 0 ? text(raw[i] ?? "") : null; };
    const docket = cell("Docket Number");
    const caption = cell("Case Caption");
    if (!docket || !caption) continue;
    const sheet = raw.join(" ").match(/href="(\/Report\/[A-Za-z]+DocketSheet\?[^"]+)"/)?.[1];
    const county = cell("County");
    out.push({
      state: "PA", source: "Pennsylvania UJS court cases (web portal)", sourceUrl: sheet ? new URL(decodeEntities(sheet), UJS).toString() : UJS,
      category: "court_case", name: [caption, cell("Primary Participant(s)")].filter(Boolean).join(" / "), id: docket,
      date: usDate(cell("Filing Date")), endDate: null, status: cell("Case Status"),
      city: [cell("Court Office"), county ? `${county} County` : null].filter(Boolean).join(", ") || null,
      detail: [cell("Court Type") ? `${cell("Court Type")} court` : null, `Case: ${caption}`].filter(Boolean).join(". "), amount: null, adverse: null,
    });
  }
  return out;
}

async function searchUjs(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/[^A-Za-z0-9&' .,-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (q.length < 3) return [];
  const page = await politeFetch(UJS, {}, { minDelayMs: 2000 });
  if (!page.ok) throw new Error(`PA UJS portal returned HTTP ${page.status}`);
  const token = (await page.text()).match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)?.[1];
  if (!token) throw new Error("PA UJS portal search page changed (no form token)");
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ SearchBy: "Organization", OrganizationName: q, FiledStartDate: "1899-01-01", FiledEndDate: new Date().toISOString().slice(0, 10), __RequestVerificationToken: token });
  const res = await politeFetch(UJS, { method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded", referer: UJS, ...(cookie ? { cookie } : {}) } }, { minDelayMs: 2000 });
  if (!res.ok) throw new Error(`PA UJS portal returned HTTP ${res.status}`);
  return parseUjsCases(await res.text());
}

// ── PA Department of State business registrations ───────────────────────────────────────────────────────────────
const ENFORCEMENT: SodaEnforcement[] = [
  {
    state: "PA", source: "Pennsylvania Department of State active business registrations", scope: "Every active registration, one row per business (data.pa.gov)",
    datasetUrl: "https://data.pa.gov/d/3urc-uaba", url: "https://data.pa.gov/resource/3urc-uaba.json", nameFields: ["business_name"],
    toHit: (r) => ({
      category: "business_status", name: clean(String(r.business_name ?? "")), id: clean(String(r.filing_number ?? "")),
      date: null, endDate: null, status: "Active registration (on the Department of State's active list)",
      city: [clean(String(r.city ?? "")), clean(String(r.state ?? ""))].filter(Boolean).join(", ") || null,
      detail: [clean(String(r.typeofbusinessregistration ?? "")), clean(String(r.shortcountyname ?? "")) ? `${clean(String(r.shortcountyname))} County` : null].filter(Boolean).join(", ") || null,
      amount: null, adverse: null,
    }),
  },
];

const LIVE_ENFORCEMENT: LiveEnforcementSearch[] = [
  { source: "Pennsylvania DGS debarment and suspension list", scope: "Vendors debarred or suspended from Commonwealth contracts, current and archived", category: "debarment", search: searchDgs },
  { source: "Pennsylvania UJS court cases (web portal)", scope: "Magisterial district, criminal and appellate dockets naming the company (not Common Pleas civil cases)", category: "court_case", search: searchUjs },
];

export const pack: StatePack = {
  state: "PA",
  checked: "2026-10-15",
  bulk: [
    { id: "pa-philadelphia", state: "PA", label: "Philadelphia L&I trade licenses", pageUrl: PHL_PAGE, everyHours: 24, minRows: 35_000, load: phillyLoader },
    { id: "pa-dli-debarments", state: "PA", label: "Pennsylvania L&I Prevailing Wage Act debarments", pageUrl: PA_DLI_DEBAR, everyHours: 24 * 7, minRows: 3,
      load: dliDebarmentsLoader, companiesOnly: true, category: "debarment" },
    // Back on by OWNER ORDER 2026-10-15: data.wprdc.org's robots.txt Disallow no longer stops a search (http.ts).
    { id: "pa-pittsburgh", state: "PA", label: "Pittsburgh PLI contractor and trade licenses", pageUrl: PGH_PAGE, everyHours: 24 * 7, minRows: 7_000, load: pittsburghLoader },
  ],
  enforcement: ENFORCEMENT,
  liveEnforcement: LIVE_ENFORCEMENT,
  noStatewideGcLicense: "Pennsylvania does not license general contractors statewide; home improvement contractors register with the Attorney General, and trades are licensed by municipalities (Philadelphia's are searched above)",
  blocked: [
    "PA Attorney General home improvement contractor registry (hicsearch.attorneygeneral.gov): Cloudflare Turnstile CAPTCHA on the search and its .xlsx download",
    "PA Department of State PALS license verification (pals.pa.gov; architects, engineers, crane operators and other state boards): the search loads Google reCAPTCHA v3",
    "PA Attorney General consumer complaints: no open dataset on data.pa.gov",
    "PA Common Pleas civil cases: not on the UJS web portal (county systems only)",
  ],
};
