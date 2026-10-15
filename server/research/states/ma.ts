/**
 * Massachusetts. Every source was opened and searched live on 2026-10-15 (CLAUDE.md: never fabricate government
 * data); field names and status words are the publishers' own.
 *
 *   MA  OCABR Home Improvement Contractor registry (MA Contractor Hub, contractorhub.mass.gov): the public "HIC
 *       Contractor Search" (a Salesforce site; its search is the page's own guest Apex call
 *       ContractorSearchController.searchContractors). Live license search by business, by person and by HIC number.
 *       The same records carry the registrant's enforcement history, searched for companies only:
 *         - OCABR hearing decisions (docket, decision, decision date, fine),
 *         - Guaranty Fund claims paid (claim number, amount paid),
 *         - arbitration awards (case number, award, the side the arbitrator found for).
 *   MA  OPSI (Office of Public Safety and Inspections) licenses, bulk: the madpl.mylicense.com verification site's
 *       free "Download File" of a search, one search per license group: construction supervisors (unrestricted,
 *       1 & 2 family, specialty with its restrictions: roofing, windows and siding, insulation, demolition, masonry,
 *       solid fuel), elevator mechanics and operators, pipefitters, refrigeration contractors and technicians,
 *       sprinkler contractors and fitters, and ACTIVE hoisting engineers (the full hoisting search is too large
 *       for the site to export: it answers 404). Every status the site holds is kept (Active, Expired, Null and Void,
 *       Revoked, Suspended, ...).
 *   MA  Department of Fire Services certificates (madfs.mylicense.com): live search of the same kind of site for
 *       oil burner technicians and apprentices, fire suppression and blasting certificates of competency (people
 *       only: these are certificates issued to individuals). The site's download button answers HTTP 500, so it is
 *       read page by page instead.
 */
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { USER_AGENT, rateLimitHost } from "../http";
import { clean, usDate, type BulkHit } from "../bulk";
import { normLicense, type IdQuery } from "../identifiers";
import { tokens, wholeWordMatch } from "../licenses";
import { myLicenseDownload, myLicenseSearch, pipeRecords } from "./lib/g2-mylicense";
import { splitName } from "./lib/g2-aspnet";
import { looksLikeBusiness } from "./lib/business-name";
import { adverseFrom } from "../adverse";
import { capNote, noteOf, safeDecode, withNote } from "../notes";
import type { StatePack } from "./types";

// ── OCABR Home Improvement Contractor registry ───────────────────────────────────────────────────────────────
const HIC_PAGE = "https://contractorhub.mass.gov/s/hic-contractor-search";
const HIC_AURA = "https://contractorhub.mass.gov/s/sfsites/aura?r=1&aura.ApexAction.execute=1";

/**
 * contractorhub.mass.gov sends its certificate without the intermediate (checked with openssl 2026-10-15), so a
 * strict client can't build the chain. The missing intermediate is DigiCert's public "DigiCert EV RSA CA G2"
 * (http://cacerts.digicert.com/DigiCertEVRSACAG2.crt, SHA-256 95:88:EF:74:...:F6:14), added to the normal roots:
 * the chain is still fully verified.
 */
const DIGICERT_EV_RSA_CA_G2 = `-----BEGIN CERTIFICATE-----
MIIFPDCCBCSgAwIBAgIQAWePH++IIlXYsKcOa3uyIDANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0yMDA3MDIxMjQyNTBaFw0zMDA3MDIxMjQyNTBaMEQxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxHjAcBgNVBAMTFURpZ2lDZXJ0IEVWIFJT
QSBDQSBHMjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK0eZsx/neTr
f4MXJz0R2fJTIDfN8AwUAu7hy4gI0vp7O8LAAHx2h3bbf8wl+pGMSxaJK9ffDDCD
63FqqFBqE9eTmo3RkgQhlu55a04LsXRLcK6crkBOO0djdonybmhrfGrtBqYvbRat
xenkv0Sg4frhRl4wYh4dnW0LOVRGhbt1G5Q19zm9CqMlq7LlUdAE+6d3a5++ppfG
cnWLmbEVEcLHPAnbl+/iKauQpQlU1Mi+wEBnjE5tK8Q778naXnF+DsedQJ7NEi+b
QoonTHEz9ryeEcUHuQTv7nApa/zCqes5lXn1pMs4LZJ3SVgbkTLj+RbBov/uiwTX
tkBEWawvZH8CAwEAAaOCAgswggIHMB0GA1UdDgQWBBRqTlC/mGidW3sgddRZAXlI
ZpIyBjAfBgNVHSMEGDAWgBROIlQgGJXm427mD/r6uRLtBhePOTAOBgNVHQ8BAf8E
BAMCAYYwHQYDVR0lBBYwFAYIKwYBBQUHAwEGCCsGAQUFBwMCMBIGA1UdEwEB/wQI
MAYBAf8CAQAwNAYIKwYBBQUHAQEEKDAmMCQGCCsGAQUFBzABhhhodHRwOi8vb2Nz
cC5kaWdpY2VydC5jb20wewYDVR0fBHQwcjA3oDWgM4YxaHR0cDovL2NybDMuZGln
aWNlcnQuY29tL0RpZ2lDZXJ0R2xvYmFsUm9vdEcyLmNybDA3oDWgM4YxaHR0cDov
L2NybDQuZGlnaWNlcnQuY29tL0RpZ2lDZXJ0R2xvYmFsUm9vdEcyLmNybDCBzgYD
VR0gBIHGMIHDMIHABgRVHSAAMIG3MCgGCCsGAQUFBwIBFhxodHRwczovL3d3dy5k
aWdpY2VydC5jb20vQ1BTMIGKBggrBgEFBQcCAjB+DHxBbnkgdXNlIG9mIHRoaXMg
Q2VydGlmaWNhdGUgY29uc3RpdHV0ZXMgYWNjZXB0YW5jZSBvZiB0aGUgUmVseWlu
ZyBQYXJ0eSBBZ3JlZW1lbnQgbG9jYXRlZCBhdCBodHRwczovL3d3dy5kaWdpY2Vy
dC5jb20vcnBhLXVhMA0GCSqGSIb3DQEBCwUAA4IBAQBSMgrCdY2+O9spnYNvwHiG
+9lCJbyELR0UsoLwpzGpSdkHD7pVDDFJm3//B8Es+17T1o5Hat+HRDsvRr7d3MEy
o9iXkkxLhKEgApA2Ft2eZfPrTolc95PwSWnn3FZ8BhdGO4brTA4+zkPSKoMXi/X+
WLBNN29Z/nbCS7H/qLGt7gViEvTIdU8x+H4l/XigZMUDaVmJ+B5d7cwSK7yOoQdf
oIBGmA5Mp4LhMzo52rf//kXPfE3wYIZVHqVuxxlnTkFYmffCX9/Lon7SWaGdg6Rc
k4RHhHLWtmz2lTZ5CEo2ljDsGzCFGJP7oT4q6Q8oFC38irvdKIJ95cUxYzj4tnOI
-----END CERTIFICATE-----`;
const HIC_CA = [...rootCertificates, DIGICERT_EV_RSA_CA_G2];

export type HicAccount = {
  Name?: string; Phone?: string; HIC_Number__c?: string; IsPersonAccount?: boolean;
  BillingStreet?: string; BillingCity?: string; BillingState?: string; BillingPostalCode?: string;
  Current_Registration_Status__c?: string; Registration_Effective_Date__c?: string; Registration_Expiration_Date__c?: string;
  AccountContactRelations?: { Contact_Full_Name__c?: string }[];
  PublicComplaintAccount?: { Docket_Number__c?: string; Hearing_Decision__c?: string; Hearing_Decision_Date__c?: string; Total_Fine_Amount__c?: number }[];
  Guaranty_Fund_Applications__r?: { Claim_Number__c?: string; Actual_Guaranty_Fund_Payment__c?: number }[];
  Cases2__r?: { CaseNumber?: string; Award_Amount__c?: number; Arbitration_Decision_in_Favor_of__c?: string }[];
};

type HicQuery = { name?: string | null; firstName?: string | null; lastName?: string | null; hicNumber?: string | null };

/** One HTTPS request to the Contractor Hub (its own CA list), with a deadline over the whole exchange, body included. */
function hicRequest(url: string, body: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "user-agent": USER_AGENT };
    if (body != null) Object.assign(headers, { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "content-length": String(Buffer.byteLength(body)), referer: HIC_PAGE });
    const req = httpsRequest(url, {
      method: body != null ? "POST" : "GET", ca: HIC_CA, timeout: 90_000, headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(`Contractor Hub returned HTTP ${res.statusCode}`))));
    });
    req.on("timeout", () => req.destroy(new Error("Contractor Hub timed out")));
    req.on("error", reject);
    const deadline = setTimeout(() => req.destroy(new Error("Contractor Hub response not finished in 120s")), 120_000);
    deadline.unref?.();
    req.on("close", () => clearTimeout(deadline));
    req.end(body ?? undefined);
  });
}

let auraCache: { at: number; fwuid: string; app: string } | null = null;
/** The search page's own Aura framework id and app version (they change with Salesforce releases), read from the page. */
export function parseAuraContext(page: string): { fwuid: string; app: string } {
  const text = safeDecode(page);
  const fwuid = text.match(/"fwuid":"([^"]+)"/)?.[1];
  const app = text.match(/"APPLICATION@markup:\/\/siteforce:communityApp":"([^"]+)"/)?.[1];
  if (!fwuid || !app) throw new Error("Contractor Hub page layout changed (no Aura context)");
  return { fwuid, app };
}
async function hicContext(): Promise<{ fwuid: string; app: string }> {
  if (auraCache && Date.now() - auraCache.at < 3600_000) return auraCache;
  await rateLimitHost(HIC_PAGE, 1500);
  auraCache = { at: Date.now(), ...parseAuraContext(await hicRequest(HIC_PAGE, null)) };
  return auraCache;
}

/** The registry's search returns at most this many registrations. */
export const HIC_MAX = 500;

/** The registry's own search (at most 500 registrations; names match anywhere in the name, as on the page). */
export async function searchHic(q: HicQuery): Promise<HicAccount[]> {
  const jsonRequest = JSON.stringify({ name: q.name ?? null, firstName: q.firstName ?? null, lastName: q.lastName ?? null, hicNumber: q.hicNumber ?? null, city: null, zipCode: null });
  const message = { actions: [{ id: "1;a", descriptor: "aura://ApexActionController/ACTION$execute", callingDescriptor: "UNKNOWN",
    params: { namespace: "", classname: "ContractorSearchController", method: "searchContractors", params: { jsonRequest }, cacheable: false, isContinuation: false } }] };
  const { fwuid, app } = await hicContext();
  const context = { mode: "PROD", fwuid, app: "siteforce:communityApp", loaded: { "APPLICATION@markup://siteforce:communityApp": app }, dn: [], globals: {}, uad: true };
  const body = new URLSearchParams({ message: JSON.stringify(message), "aura.context": JSON.stringify(context), "aura.pageURI": "/s/hic-contractor-search", "aura.token": "null" }).toString();
  await rateLimitHost(HIC_AURA, 1500);
  const rows = parseHicResponse(await hicRequest(HIC_AURA, body));
  return rows.length >= HIC_MAX ? withNote(rows, capNote(rows.length, null, "registrations (the registry's own limit)")) : rows;
}

export function parseHicResponse(text: string): HicAccount[] {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error("Contractor Hub sent an unexpected page"); }
  const a = d?.actions?.[0];
  if (a?.state !== "SUCCESS") throw new Error(`Contractor Hub search failed: ${JSON.stringify(a?.error ?? a?.state).slice(0, 200)}`);
  const rows = a.returnValue?.returnValue;
  if (!Array.isArray(rows)) throw new Error("Contractor Hub returned no result list");
  return rows;
}

const hicAddress = (a: HicAccount) => clean([a.BillingStreet, a.BillingCity, a.BillingState, a.BillingPostalCode].filter(Boolean).join(", "));
const hicPeople = (a: HicAccount) => Array.from(new Set((a.AccountContactRelations ?? []).map((c) => clean(c.Contact_Full_Name__c)).filter((n): n is string => !!n)));

export function hicToHit(a: HicAccount, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  const people = hicPeople(a);
  const name = clean(a.Name);
  // A person account is an individual: city, state and ZIP only, no street or phone (audit 2026-10-15, decision 4).
  const individual = !!a.IsPersonAccount;
  return {
    state: "MA", source: "Massachusetts Home Improvement Contractor registry (OCABR)", sourceUrl: HIC_PAGE,
    businessName: a.IsPersonAccount ? null : name, licenseNumber: clean(a.HIC_Number__c), licenseType: "Home Improvement Contractor registration",
    specialty: null, status: clean(a.Current_Registration_Status__c), principal: a.IsPersonAccount ? name : people[0] ?? null,
    city: clean(a.BillingCity), expires: clean(a.Registration_Expiration_Date__c)?.slice(0, 10) ?? null, matchedOn,
    address: individual ? clean([a.BillingCity, a.BillingState, a.BillingPostalCode].filter(Boolean).join(", ")) : hicAddress(a),
    phone: individual ? null : clean(a.Phone), people: people.map((p) => ({ name: p, role: "Contact" })),
  };
}

async function hicLicenseSearch(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind === "company") {
    const rows = await searchHic({ name });
    return withNote(rows.map((a) => hicToHit(a, "business")).filter((h) => wholeWordMatch(name, h)), noteOf(rows));
  }
  const parts = splitName(name);
  if (!parts) return [];
  const want = tokens(name);
  const rows = await searchHic({ firstName: parts.first, lastName: parts.last });
  return withNote(rows
    .map((a) => hicToHit(a, "principal"))
    .filter((h) => [h.principal, ...(h.people ?? []).map((p) => p.name)].some((p) => { const have = new Set(tokens(p ?? "")); return want.every((w) => have.has(w)); })), noteOf(rows));
}

async function hicSearchBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null; // the registry searches by HIC number, not by phone or street address
  const n = normLicense(q.value);
  if (!n) return null;
  // HIC numbers are plain digits ("169040", sometimes written "HIC 169040"); another board's number that happens to
  // share the digits ("CSFA-106775") is not an HIC number.
  const digits = n.match(/^(?:HIC)?(\d+)$/)?.[1];
  if (!digits) return null;
  return (await searchHic({ hicNumber: digits })).map((a) => hicToHit(a, "license")).filter((h) => normLicense(h.licenseNumber) === digits);
}

/** Hearing decisions, Guaranty Fund payments and arbitration awards on one registration (companies only). */
export function hicEnforcement(a: HicAccount): EnforcementHit[] {
  const base = { state: "MA", sourceUrl: HIC_PAGE, name: clean(a.Name), city: clean(a.BillingCity), address: hicAddress(a), phone: clean(a.Phone), licenseNumber: clean(a.HIC_Number__c) };
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
  const out: EnforcementHit[] = [];
  for (const c of a.PublicComplaintAccount ?? []) {
    const fine = Number(c.Total_Fine_Amount__c);
    // Adverse only from the decision itself ("Reprimand", "Revoke", "Suspension", …) or a fine it imposed; a decision
    // the record doesn't state, or a dismissal, is not marked adverse (audit 2026-10-15, decision 2).
    const decision = adverseFrom(c.Hearing_Decision__c, { adverse: /revo|suspen|reprimand|\bfined?\b|penalt|restitution|probation|censure|cease/i });
    out.push({ ...base, source: "Massachusetts HIC hearing decisions (OCABR)", category: "discipline", id: clean(c.Docket_Number__c),
      date: clean(c.Hearing_Decision_Date__c)?.slice(0, 10) ?? null, endDate: null,
      status: c.Hearing_Decision__c ? `Hearing decision: ${clean(c.Hearing_Decision__c)}` : "Hearing decision",
      detail: [`Docket ${clean(c.Docket_Number__c) ?? "(no number)"}`, Number.isFinite(fine) && fine > 0 ? `fine ${usd(fine)}` : null].filter(Boolean).join(", "),
      amount: Number.isFinite(fine) && fine > 0 ? fine : null, adverse: decision === false ? false : decision ?? (Number.isFinite(fine) && fine > 0 ? true : null) });
  }
  for (const g of a.Guaranty_Fund_Applications__r ?? []) {
    const paid = Number(g.Actual_Guaranty_Fund_Payment__c);
    out.push({ ...base, source: "Massachusetts HIC Guaranty Fund claims (OCABR)", category: "complaint", id: clean(g.Claim_Number__c), date: null, endDate: null,
      status: Number.isFinite(paid) && paid > 0 ? "Guaranty Fund payment made" : "Guaranty Fund claim",
      detail: [`Guaranty Fund claim ${clean(g.Claim_Number__c) ?? ""} against this registration`.replace(/\s+/g, " "), Number.isFinite(paid) && paid > 0 ? `amount paid ${usd(paid)}` : null].filter(Boolean).join(", "),
      amount: Number.isFinite(paid) && paid > 0 ? paid : null, adverse: Number.isFinite(paid) && paid > 0 ? true : null });
  }
  for (const c of a.Cases2__r ?? []) {
    const award = Number(c.Award_Amount__c), side = clean(c.Arbitration_Decision_in_Favor_of__c);
    out.push({ ...base, source: "Massachusetts HIC arbitration awards (OCABR)", category: "complaint", id: clean(c.CaseNumber), date: null, endDate: null,
      status: side ? `Arbitration decided in favor of the ${side.toLowerCase()}` : "Arbitration case",
      detail: [`Arbitration case ${clean(c.CaseNumber) ?? ""}`.trim(), Number.isFinite(award) && award > 0 ? `award ${usd(award)}` : null].filter(Boolean).join(", "),
      amount: Number.isFinite(award) && award > 0 ? award : null, adverse: side === "Homeowner" ? true : side === "Contractor" ? false : null });
  }
  return out;
}

// ── OPSI licenses (madpl.mylicense.com download) ─────────────────────────────────────────────────────────────
const OPSI = "https://madpl.mylicense.com/verification/";
const P = "t_web_lookup__profession_name", T = "t_web_lookup__license_type_name", S = "t_web_lookup__license_status_name";
/** One download per group. Values are the form's own option values (some end in a space). */
const OPSI_SEARCHES: Record<string, string>[] = [
  { [P]: "Building Licenses" },
  { [P]: "Elevators Licenses" },
  ...["Pipefitter Apprentice", "Pipefitter Apprentice PP", "Pipefitter Journeyman PHCP", "Pipefitter Journeyman PHCP-W", "Pipefitter Journeyman PP",
    "Pipefitter Journeyman PP-W", "Pipefitter Master PHCP", "Pipefitter Master PHCP-W", "Pipefitter Master PP", "Pipefitter Master PP-W",
    "Pipefitter Unrestricted Apprentice", "Pipefitter Unrestricted Journeyman", "Pipefitter Unrestricted Master",
    "Refrigeration Apprentice", "Refrigeration Contractor", "Refrigeration Technician",
    "Sprinkler Apprentice ", "Sprinkler Contractor", "Sprinkler Journeyman "].map((t) => ({ [T]: t })),
  { [T]: "Hoisting Engineer", [S]: "Active" },
];
/** Types in the "Building Licenses" group that aren't construction (projectionists, building officials). */
const OPSI_SKIP = /^(Motion Picture Operator|Building Official)/i;
/** Restriction rows sit under their license number ("CSSL-RF - Roofing", "HE-2A- Excavators", "4A repealed ..."). */
const RESTRICTION = /^(CSSL-|HE-|\d)/;

async function* maOpsiLoader(): AsyncIterable<BulkHit> {
  for (const search of OPSI_SEARCHES) {
    const byLicense = new Map<string, { main: Record<string, string> | null; restrictions: string[]; first: Record<string, string> }>();
    const file = await myLicenseDownload(OPSI, search);
    if (file == null) continue; // a license type nobody holds (Pipefitter Apprentice PP today)
    for (const r of pipeRecords(file)) {
      const no = clean(r.license_no), type = clean(r.license_type_name);
      if (!no || !type || OPSI_SKIP.test(type)) continue;
      const g = byLicense.get(no) ?? { main: null, restrictions: [], first: r };
      if (RESTRICTION.test(type)) g.restrictions.push(type.replace(/^CSSL-[A-Z]+ - /, ""));
      else g.main ??= r;
      byLicense.set(no, g);
    }
    for (const [no, g] of byLicense) {
      const r = g.main ?? g.first;
      const who = clean(r.full_name);
      if (!who) continue;
      // These licenses are issued to individuals, so the address on file is a person's: city, state and ZIP only,
      // no street, and it is not a cross-reference key (audit 2026-10-15, decision 4).
      const address = clean([r.addr_city, r.addr_state, r.addr_zipcode].filter(Boolean).join(", "));
      const hit: LicenseHit = {
        state: "MA", source: "Massachusetts OPSI licenses (construction supervisors, pipefitters, refrigeration, sprinkler, elevator, hoisting)",
        sourceUrl: OPSI, businessName: null, licenseNumber: no, licenseType: clean(g.main?.license_type_name) ?? clean(r.license_type_name),
        specialty: g.restrictions.length ? `Restrictions: ${Array.from(new Set(g.restrictions)).join(", ")}` : null,
        status: clean(r.license_status_name), principal: who, city: clean(r.addr_city), expires: usDate(r.expiration_date), matchedOn: "principal",
        address, people: [{ name: who, role: null }],
      };
      yield { kind: "license", hit, business: null, person: who, keys: { licenses: [no] } };
    }
  }
}

// ── Department of Fire Services certificates (madfs.mylicense.com, live) ─────────────────────────────────────
const DFS = "https://madfs.mylicense.com/verification/";
const DFS_TYPES = /^(Oil Burner Technician Certificate|Oil Burner Apprentice Certificate|CC Fire Supr Cert of Competency|BL Explosives Cert of Competency)$/i;

function dfsHit(r: Record<string, string | null>, matchedOn: LicenseHit["matchedOn"]): LicenseHit {
  return {
    state: "MA", source: "Massachusetts Department of Fire Services certificates (oil burner, fire suppression, blasting)", sourceUrl: DFS,
    businessName: null, licenseNumber: r["License #"] ?? null, licenseType: r["License Type"] ?? null, specialty: null,
    status: r.Status ?? null, principal: r.name ?? null, city: [r.City, r.St].filter(Boolean).join(", ") || null,
    expires: usDate(r["Expiration Date"]), matchedOn, people: r.name ? [{ name: r.name, role: null }] : [],
  };
}

async function dfsSearch(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  if (kind === "company") return []; // these certificates are issued to individuals only
  const parts = splitName(name);
  if (!parts) return [];
  const rows = await myLicenseSearch(DFS, { t_web_lookup__last_name: parts.last, t_web_lookup__first_name: parts.first });
  return rows.filter((r) => DFS_TYPES.test(r["License Type"] ?? "")).map((r) => dfsHit(r, "principal")).filter((h) => wholeWordMatch(name, h));
}

async function dfsSearchBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null; // a certificate lookup: by number only
  const n = normLicense(q.value);
  if (!n) return null;
  const rows = await myLicenseSearch(DFS, { t_web_lookup__license_no: q.value.trim() }, 1);
  return rows.filter((r) => DFS_TYPES.test(r["License Type"] ?? "") && normLicense(r["License #"]) === n).map((r) => dfsHit(r, "license"));
}

export const pack: StatePack = {
  state: "MA",
  checked: "2026-10-15",
  liveLicenses: [
    { source: "Massachusetts Home Improvement Contractor registry (OCABR)", sourceUrl: HIC_PAGE, search: hicLicenseSearch, searchBy: hicSearchBy },
    { source: "Massachusetts Department of Fire Services certificates (oil burner, fire suppression, blasting)", sourceUrl: DFS, search: dfsSearch, searchBy: dfsSearchBy },
  ],
  liveEnforcement: [
    {
      source: "Massachusetts HIC hearing decisions, Guaranty Fund claims and arbitration awards (OCABR)",
      scope: "Every registration the Contractor Hub holds, current and expired",
      // Companies only (FCRA): a person account is an individual unless its name reads as a business.
      search: async (name) => {
        const rows = await searchHic({ name });
        return withNote(rows.filter((a) => (!a.IsPersonAccount || looksLikeBusiness(a.Name)) && wholeWordMatch(name, { businessName: clean(a.Name), principal: null })).flatMap(hicEnforcement), noteOf(rows));
      },
    },
  ],
  bulk: [
    { id: "ma-opsi", state: "MA", label: "Massachusetts OPSI licenses (construction supervisors, pipefitters, refrigeration, sprinkler, elevator, hoisting)",
      pageUrl: OPSI, everyHours: 24 * 7, minRows: 120_000, load: maOpsiLoader },
  ],
  blocked: [
    "www.mass.gov (every page, including the Division of Occupational Licensure 'Check a license' page that names the electrician and plumber lookups) answers HTTP 403 to our bot, so those lookups' addresses could not be confirmed: electricians, plumbers and gas fitters are not searched",
    "Secretary of the Commonwealth corporations search (corp.sec.state.ma.us): robots.txt disallows everything and the site sits behind an Incapsula challenge",
    "elicensing21.mass.gov (ePLACE) licensee search lists only the Alcoholic Beverages Control Commission",
    "madfs.mylicense.com 'Download' button answers HTTP 500, so Fire Services certificates are searched live instead of downloaded",
    "OCABR Contractor Hub has no phone or street-address search (only business name, person, HIC number, city and ZIP)",
    "Attorney General Fair Labor Division citations and DIA stop-work orders are published only on www.mass.gov (HTTP 403 to our bot)",
  ],
};
