/**
 * Missouri. Every source below was opened and searched live on 2026-10-15; field names, statuses and codes are the
 * publishers' own (CLAUDE.md: never fabricate government data).
 *
 *   mo-dpr-electrical  Division of Professional Registration, Office of Statewide Electrical Contractors: the
 *                      nightly "Downloadable Listings" file of active statewide electrical contractor licenses
 *                      (licensee, employer, address, license number, dates).
 *   mo-dpr-ae          The same downloads for the Architects, Engineers, Land Surveyors and Landscape Architects
 *                      board: individual licenses and the corporations' certificates of authority (active only).
 *   live               MO PRO licensee search (Active and Non Active), the same professions, with the license's
 *                      current discipline status and whether it has prior disciplinary actions.
 *   socrata            Registered onsite wastewater treatment system (septic) installers, data.mo.gov nfxa-cq5r.
 *
 * MO PRO is a Salesforce Experience site; its downloads and search run through the site's public guest Apex actions
 * (MODPR_LicenseSearchDownloadController, MODPR_LicenseSearchController), the calls its own pages make.
 */
import type { LicenseHit } from "@shared/research-reports";
import { wholeWordMatch, type LicenseSource } from "../licenses";
import { clean, csvRecords, download, usDate, type BulkHit, type BulkSource } from "../bulk";
import type { IdQuery } from "../identifiers";
import { politeFetch } from "../http";
import type { LiveLicenseSearch, StatePack } from "./types";
import { fromFile, isoDay, joinAddr, unzipFirst } from "./lib/g6-common";

// ── MO PRO guest Apex actions ────────────────────────────────────────────────────────────────────────────────
const MOPRO = "https://mopro.mo.gov/license/s";
const MO_DOWNLOADS = `${MOPRO}/license-downloads`;
const MO_SEARCH = `${MOPRO}/license-search`;

let ctxCache: { at: number; fwuid: string; app: string } | null = null;
/** The page's Aura framework id and app version (changed by Salesforce releases; read from the page itself). */
async function auraContext(): Promise<{ fwuid: string; app: string }> {
  if (ctxCache && Date.now() - ctxCache.at < 3600_000) return ctxCache;
  const res = await politeFetch(MO_SEARCH, {}, { minDelayMs: 1000 });
  if (!res.ok) throw new Error(`MO PRO returned HTTP ${res.status}`);
  const page = decodeURIComponent(await res.text());
  const fwuid = page.match(/"fwuid":"([^"]+)"/)?.[1];
  const app = page.match(/"APPLICATION@markup:\/\/siteforce:communityApp":"([^"]+)"/)?.[1];
  if (!fwuid || !app) throw new Error("MO PRO page layout changed (no Aura context)");
  ctxCache = { at: Date.now(), fwuid, app };
  return ctxCache;
}

export async function moApex<T>(classname: string, method: string, params: Record<string, unknown>, pageURI = "/license/s/license-search"): Promise<T> {
  const { fwuid, app } = await auraContext();
  const message = { actions: [{ id: "1;a", descriptor: "aura://ApexActionController/ACTION$execute", callingDescriptor: "UNKNOWN", params: { namespace: "", classname, method, params, cacheable: false, isContinuation: false } }] };
  const context = { mode: "PROD", fwuid, app: "siteforce:communityApp", loaded: { "APPLICATION@markup://siteforce:communityApp": app }, dn: [], globals: {}, uad: true };
  const body = new URLSearchParams({ message: JSON.stringify(message), "aura.context": JSON.stringify(context), "aura.pageURI": pageURI, "aura.token": "null" });
  const res = await politeFetch(`${MOPRO}/sfsites/aura?r=1&aura.ApexAction.execute=1`, {
    method: "POST", body: body.toString(), headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", accept: "application/json" },
  }, { minDelayMs: 1000 });
  if (!res.ok) throw new Error(`MO PRO returned HTTP ${res.status}`);
  const json = JSON.parse((await res.text()).replace(/^\s*while\(1\);\s*/, ""));
  const action = json?.actions?.[0];
  if (action?.state !== "SUCCESS") { ctxCache = null; throw new Error(`MO PRO ${method}: ${action?.state ?? "no response"}`); }
  return action.returnValue?.returnValue as T;
}

// ── Downloadable listings (bulk) ─────────────────────────────────────────────────────────────────────────────
type MoFile = { fileName: string; fileUrl: string; licenseName: string };

const moFiles = (board: string) => moApex<MoFile[]>("MODPR_LicenseSearchDownloadController", "getFilesForSelectedBoard", { jsonData: JSON.stringify({ selectedBoard: board }) }, "/license/s/license-downloads");

const BUSINESS_PROFESSION = /corporation|corp\b/i;

function moRow(r: Record<string, string>, licenseName: string, label: string): BulkHit | null {
  const personName = clean([r.prc_first_name, r.prc_middle_name, r.prc_last_name, r.prc_suffix].filter(Boolean).join(" "));
  const entity = clean(r.prc_entity_name);
  const isBusiness = BUSINESS_PROFESSION.test(licenseName) || (!personName && !!entity);
  const business = isBusiness ? entity : clean(r.employer_name);
  const dba = clean(r.prc_dba_name);
  const who = isBusiness ? null : personName ?? entity;
  if (!business && !who) return null;
  const address = joinAddr(r.ba_address, r.ba_2address, r.ba_city, r.ba_state, r.ba_zip);
  const status = [clean(r.lst_description), clean(r.les_description)].filter(Boolean).join(", ") || null;
  const discipline = clean(r.ld_description);
  const hit: LicenseHit = {
    state: "MO", source: label, sourceUrl: MO_DOWNLOADS,
    businessName: [business, dba ? `DBA ${dba}` : null].filter(Boolean).join(" ") || null, licenseNumber: clean(r.lic_number),
    licenseType: licenseName, specialty: clean(r.clas_description), status: discipline ? `${status ?? ""}; discipline: ${discipline}`.replace(/^; /, "") : status,
    principal: who, city: clean(r.ba_city), expires: isoDay(r.lic_exp_date) ?? usDate(r.lic_exp_date),
    matchedOn: isBusiness ? "business" : "principal", address,
    people: who ? [{ name: who, role: isBusiness ? null : licenseName }] : [],
  };
  return { kind: "license", hit, business: [business, dba].filter(Boolean).join(" ") || null, person: who, keys: { licenses: [r.lic_number], addresses: [address] } };
}

function moBoardLoader(board: string, label: string): () => AsyncIterable<BulkHit> {
  return async function* () {
    const files = await moFiles(board);
    if (!files?.length) throw new Error(`MO PRO lists no files for ${board}`);
    for (const f of files) {
      const txt = await unzipFirst(await download(f.fileUrl), /^(?!FILEDESC).*\.TXT$/i);
      for await (const r of fromFile(txt, (p) => csvRecords(p, "\t"))) {
        const h = moRow(r, f.licenseName, label);
        if (h) yield h;
      }
    }
  };
}

const MO_ELECTRICAL: BulkSource = {
  id: "mo-dpr-electrical", state: "MO", label: "Missouri statewide electrical contractor licenses (active)", pageUrl: MO_DOWNLOADS,
  everyHours: 24, minRows: 840, // 1,201 on 2026-10-15
  load: moBoardLoader("Electrical Contractors", "Missouri statewide electrical contractor licenses"),
};

const MO_AE: BulkSource = {
  id: "mo-dpr-ae", state: "MO", label: "Missouri architects, engineers, land surveyors and landscape architects (active)", pageUrl: MO_DOWNLOADS,
  everyHours: 24 * 7, minRows: 21_000,
  load: moBoardLoader("Architects, Engineers, Land Surveyors, and Landscape Architects", "Missouri architects, engineers, land surveyors and landscape architects"),
};

// ── Licensee search (live, Active and Non Active, with discipline status) ────────────────────────────────────
const MO_PROFESSIONS = [
  "Electrical Contractor", "Architect", "Architectural Corporation", "Professional Engineer", "Engineering Corporation",
  "Professional Land Surveyor", "Land Surveying Corp", "Professional Landscape Architect", "Landscape Architect Corp",
];
type Pick = { label: string; value: string };
type MoResult = { businessLicenseId: string; licenseeName: string | null; rat: string | null; city: string | null; state: string | null; boardName: string | null };
type MoSection = { headingName: string; records: { headingFieldValue: { label: string; value: string | null }[] }[] };

const professionIds = async (status: string): Promise<string[]> => {
  const picks = await moApex<Pick[]>("MODPR_LicenseSearchController", "loadPicklistValues", { status });
  return (picks ?? []).filter((p) => MO_PROFESSIONS.includes(p.label)).map((p) => p.value);
};

/** The detail sections: license fields, address, and the employers / supervisors / employees named. */
export function parseMoDetail(sections: MoSection[]): { fields: Record<string, string>; address: string | null; people: { name: string; role: string | null }[] } {
  const fields: Record<string, string> = {};
  let address: string | null = null;
  const people: { name: string; role: string | null }[] = [];
  for (const s of sections ?? []) {
    for (const rec of s.records ?? []) {
      const v = Object.fromEntries(rec.headingFieldValue.map((f) => [f.label, clean(f.value) ?? ""]));
      if (s.headingName === "License") Object.assign(fields, v);
      else if (s.headingName === "Address") address = joinAddr(v["Street"], v["City"], v["State"], v["PostalCode"]);
      else if (v["Licensee Name"]) people.push({ name: v["Licensee Name"], role: clean(v["Role"]) });
    }
  }
  return { fields, address, people };
}

async function moSearch(criteria: string, value: string, kind: "person" | "company" | "license"): Promise<LicenseHit[]> {
  const hits: LicenseHit[] = [];
  for (const status of ["Active", "Non Active"]) {
    const ids = await professionIds(status);
    if (!ids.length) continue;
    const rows = await moApex<MoResult[]>("MODPR_LicenseSearchController", "fetchBLWithoutCounty", {
      status, countyName: [], professionName: ids, searchCriteria: criteria, partialRequires: value,
    });
    // The search is a partial match ("SPE" finds "Spencer"): keep whole-word matches before fetching details.
    const named = (rows ?? []).filter((r) => kind === "license" || wholeWordMatch(value, { businessName: r.licenseeName, principal: null }));
    for (const r of named.slice(0, 12)) {
      const isBusiness = BUSINESS_PROFESSION.test(r.rat ?? "");
      if (kind === "company" && !isBusiness && r.rat !== "Electrical Contractor") continue;
      let d: ReturnType<typeof parseMoDetail> = { fields: {}, address: null, people: [] };
      try { d = parseMoDetail(await moApex<MoSection[]>("MODPR_LicenseSearchController", "getApplicationData", { blId: r.businessLicenseId, status, directApplication: false })); } catch { /* row stands alone */ }
      const disc = d.fields["Current Discipline Status"], prior = d.fields["Previous Disciplinary Actions"];
      const statusText = [status === "Active" ? "Active" : "Not active",
        disc && disc !== "None" ? `current discipline: ${disc}` : null,
        prior && prior !== "No" ? `previous disciplinary actions: ${prior}` : null].filter(Boolean).join("; ");
      const name = clean(r.licenseeName);
      hits.push({
        state: "MO", source: "Missouri MO PRO licensee search", sourceUrl: MO_SEARCH,
        businessName: isBusiness ? name : null, licenseNumber: clean(d.fields["License Number"]), licenseType: clean(r.rat),
        specialty: null, status: statusText, principal: isBusiness ? null : name,
        city: [clean(r.city), clean(r.state)].filter(Boolean).join(", ") || null, expires: usDate(d.fields["Expiration Date"]),
        matchedOn: kind === "license" ? "license" : isBusiness ? "business" : "principal", address: d.address,
        people: [...(!isBusiness && name ? [{ name, role: clean(r.rat) }] : []), ...d.people],
      });
    }
  }
  return hits;
}

const MO_LIVE: LiveLicenseSearch = {
  source: "Missouri MO PRO licensee search", sourceUrl: MO_SEARCH,
  search: (name, kind) => moSearch("Licensee Name (Partial - enter in the textbox below)", name.trim(), kind),
  searchBy: async (q: IdQuery) => q.type === "license" ? moSearch("License Number (Exact - enter in the textbox below)", q.value.trim(), "license") : [],
};

// ── data.mo.gov ──────────────────────────────────────────────────────────────────────────────────────────────
const MO_OWTS: LicenseSource = {
  state: "MO", source: "Missouri registered onsite wastewater treatment system installers",
  datasetUrl: "https://data.mo.gov/d/nfxa-cq5r", url: "https://data.mo.gov/resource/nfxa-cq5r.json",
  fields: { businessName: "business", licenseNumber: "installer_id", licenseType: null, specialty: "installer_level", status: null, principal: null, city: "city", expires: "date_of_expiration" },
  personField: ["first_name", "mi", "last_name"], phone: "business_phone",
};

export const pack: StatePack = {
  state: "MO",
  checked: "2026-10-15",
  licenses: [MO_OWTS],
  liveLicenses: [MO_LIVE],
  bulk: [MO_ELECTRICAL, MO_AE],
  noStatewideGcLicense:
    "Missouri does not license general contractors statewide; cities and counties license contractors and trades, and the optional statewide electrical contractor license is searched above",
  blocked: [
    "Missouri Division of Labor Standards contractor debarment list (labor.mo.gov/contractor-debarment-list): reads 'No contractors debarred at this time' on 2026-10-15, nothing to search",
    "Missouri Secretary of State business entities: no free bulk file or open API (the online search is per entity)",
    "MO PRO downloadable listings hold active licenses only; non-active licenses and discipline status come from the live licensee search",
  ],
};
