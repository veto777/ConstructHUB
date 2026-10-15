/**
 * New Mexico. Checked live 2026-10-15.
 *
 *   NM RLD home inspector and landscape architect licenses: the Regulation and Licensing Department's public
 *     license search for its boards (nmrldlpi.my.site.com/bcd, the guest Apex call its page makes), Board of Home
 *     Inspector and Board of Landscape Architecture. Individuals: searched for people only.
 *   NM Secretary of State business entities: the Secretary of State's public business search
 *     (enterprise.sos.nm.gov, its JSON API), status as published (Active, Revoked Final, ...). Companies only.
 *
 * Construction Industries Division contractor and journeyman licenses (the core New Mexico construction licenses) are
 * only searchable through PSI's portal, which requires a CAPTCHA: listed under `blocked`, never worked around.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { politeFetch } from "../../scrapers/polite-fetch";
import { tokens } from "../licenses";
import { clean, usDate } from "../bulk";
import { auraApex, type AuraSite } from "./lib/g7-aura";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";

const RLD: AuraSite = { origin: "https://nmrldlpi.my.site.com", page: "/bcd/s/rld-public-search" };
const RLD_SEARCH_PAGE = `${RLD.origin}${RLD.page}?language=en_US`;
const RLD_BOARDS = ["Board of Home Inspector", "Board of Landscape Architecture"];
const SOS_SEARCH_PAGE = "https://enterprise.sos.nm.gov/search/business";
const SOS_API = "https://enterprise.sos.nm.gov/api/businessEntitySearch/webSearch";

const hasAll = (name: string, v: string | null | undefined) => { const want = tokens(name); const have = new Set(tokens(v ?? "")); return want.length > 0 && want.every((w) => have.has(w)); };

// ── RLD boards (home inspectors, landscape architects) ───────────────────────────────────────────────────────

export type RldLicense = {
  Name?: string | null; Status?: string | null; License_Holder_Name__c?: string | null; License_Holder_City__c?: string | null;
  License_Holder_Street__c?: string | null; License_Holder_Postal_Code__c?: string | null;
  License_Holder_State__c?: string | null; periodEnd__c?: string | null; Regulatory_Authorization_Type_Name__c?: string | null; Regulatory_Authority__c?: string | null;
};

/** One license row, with the address of record RLD publishes for it. */
export function rldLicenseHit(r: RldLicense): LicenseHit {
  return {
    state: "NM", source: "New Mexico RLD home inspector and landscape architect licenses", sourceUrl: RLD_SEARCH_PAGE,
    businessName: null, licenseNumber: clean(r.Name), licenseType: clean(r.Regulatory_Authorization_Type_Name__c),
    specialty: clean(r.Regulatory_Authority__c), status: clean(r.Status), principal: clean(r.License_Holder_Name__c),
    city: [clean(r.License_Holder_City__c), clean(r.License_Holder_State__c)].filter(Boolean).join(", ") || null,
    expires: /^\d{4}-\d{2}-\d{2}$/.test(r.periodEnd__c ?? "") ? r.periodEnd__c! : null, matchedOn: "principal",
    address: clean(r.License_Holder_Street__c) ? [clean(r.License_Holder_Street__c), clean(r.License_Holder_City__c), [clean(r.License_Holder_State__c), clean(r.License_Holder_Postal_Code__c)].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
    people: clean(r.License_Holder_Name__c) ? [{ name: clean(r.License_Holder_Name__c)!, role: clean(r.Regulatory_Authorization_Type_Name__c) }] : [],
  };
}

async function searchRld(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind === "company") return []; // these boards license individuals
  const words = name.replace(/\s+/g, " ").trim().split(" ");
  const last = words[words.length - 1];
  if (!last || last.length < 2) return [];
  const out: LicenseHit[] = [];
  for (const board of RLD_BOARDS) {
    const rv = await auraApex<{ returnValue?: RldLicense[] } | null>(RLD, "aura://ApexActionController/ACTION$execute", {
      namespace: "", classname: "RLDLicenseSearchController", method: "onSearch", cacheable: false, isContinuation: false,
      params: { professionValue: board, licenseTypeValue: "", licenseHolderNameValue: last, licenseNumberValue: "", licenseStatusValue: "", cityValue: "", countyValue: "", stateValue: "", zipCodeValue: "" },
    });
    for (const r of rv?.returnValue ?? []) if (hasAll(name, r.License_Holder_Name__c)) out.push(rldLicenseHit(r));
  }
  return out;
}

// ── Secretary of State ───────────────────────────────────────────────────────────────────────────────────────

export type NmSosRow = { RECORD_NUM?: string | null; TITLE?: (string | null)[]; RegistrationDate?: string | null; BusinessStatusId?: string | null; BusinessRecordTypeId?: string | null; FormationLocale?: string | null };

export function nmSosHit(r: NmSosRow): EnforcementHit {
  const status = clean(r.BusinessStatusId);
  return {
    state: "NM", source: "New Mexico Secretary of State business entities", sourceUrl: SOS_SEARCH_PAGE,
    category: "business_status", name: clean(r.TITLE?.[0]), id: clean(r.RECORD_NUM), date: usDate(r.RegistrationDate), endDate: null,
    status: status ? `Secretary of State status: ${status}` : null, city: null,
    detail: [clean(r.BusinessRecordTypeId), clean(r.FormationLocale) ? `formed in ${clean(r.FormationLocale)}` : null].filter(Boolean).join(", ") || null,
    amount: null, adverse: /revoked|forfeit/i.test(status ?? "") ? true : null,
  };
}

async function searchNmSos(name: string): Promise<EnforcementHit[]> {
  const q = name.replace(/\s+/g, " ").trim().slice(0, 50);
  if (q.length < 3) return [];
  // The page sends the search text encoded twice (SEARCH_VALUE=Bradbury%2520Stamm); sent the same way here.
  const url = `${SOS_API}?SEARCH_VALUE=${encodeURIComponent(encodeURIComponent(q))}&QueryTypeId=2&BusinessRecordTypeId=0&BusinessStatusTypeId=0&FROM_MAIN_SEARCH=true`;
  const res = await politeFetch(url, { headers: { accept: "application/json", referer: SOS_SEARCH_PAGE } }, { minDelayMs: 1500 });
  if (!res.ok) throw new Error(`NM Secretary of State returned HTTP ${res.status}`);
  const data = await res.json().catch(() => null) as { rows?: Record<string, NmSosRow> } | null;
  if (!data || typeof data !== "object") throw new Error("NM Secretary of State returned an unexpected payload");
  return Object.values(data.rows ?? {}).map(nmSosHit).filter((h) => hasAll(name, h.name));
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: "New Mexico RLD home inspector and landscape architect licenses", sourceUrl: RLD_SEARCH_PAGE, search: searchRld },
];

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "New Mexico Secretary of State business entities", scope: "Every business entity on the Secretary of State's register", category: "business_status", search: searchNmSos },
];

export const pack: StatePack = {
  state: "NM",
  checked: "2026-10-15",
  liveLicenses,
  liveEnforcement,
  blocked: [
    "Construction Industries Division contractor / journeyman license search (public.psiexams.com/search.jsp, PSI): the search requires a CAPTCHA",
    "Workforce Solutions public works contractor registry (dws.state.nm.us/pwaa): the site's firewall rejects automated requests (\"Request Rejected\")",
    "CID disciplinary actions: RLD publishes enforcement pages for its boards but none for CID",
  ],
};
