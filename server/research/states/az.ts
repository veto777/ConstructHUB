/**
 * Arizona. Checked live 2026-10-15.
 *
 *   AZ ROC contractor licenses: the Registrar of Contractors' public Contractor Search (azroc.my.site.com), the
 *     same guest Apex calls its page makes. Every license the ROC lists (active, suspended, revoked, expired,
 *     cancelled), by company name or by a person named on the license (qualifying party, officers, members).
 *   AZ ROC complaints: the complaints the same search shows on each license (open cases, disciplined cases and
 *     cases resolved with a corrective work order; the ROC leaves out dismissed and cancelled ones). Companies only.
 *
 * The ROC search answers: accountName, licenseData[] (licenseNo, subType, status, qpName), accountContactData[]
 * (contactName "Name (Role) "), address ("City, ST, ZIP"); getLicenseDetail adds renewalThr (renewed through),
 * licenseDescription, issuedDate; getAllComplaintsDetail gives complaintDataList[] (Name = case number, Status__c,
 * Complaint_Type__c, Complaint_Outcome_Multi__c, Allegations__c, Closed_Date__c, Jobsite_City__c). The complainant
 * (a private person) is never read into a report.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { tokens } from "../licenses";
import { clean } from "../bulk";
import { auraApex, type AuraSite } from "./lib/g7-aura";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";

const ROC: AuraSite = { origin: "https://azroc.my.site.com", page: "/AZRoc/s/contractor-search" };
const ROC_SEARCH_PAGE = ROC.origin + ROC.page;
const licensePage = (id: string) => `${ROC_SEARCH_PAGE}?licenseId=${encodeURIComponent(id)}`;

type RocLicense = { licenseId: string; licenseNo: string | null; qpName: string | null; status: string | null; subType: string | null };
export type RocAccount = { accountId: string; accountName: string | null; address: string | null; licenseData?: RocLicense[]; accountContactData?: { contactName: string | null }[] };
type RocDetail = { licenseDescription?: string | null; renewalThr?: string | null; licenseStatus?: string | null };
type RocComplaint = {
  Name?: string | null; Status__c?: string | null; Complaint_Type__c?: string | null; Complaint_Outcome_Multi__c?: string | null;
  Allegations__c?: string | null; Closed_Date__c?: string | null; Jobsite_City__c?: string | null; Case_Nature__c?: string | null;
  License_Number_Respondent__r?: { Name?: string | null; Primary_Licensee__r?: { Name?: string | null } | null } | null;
};

const MAX_DETAILS = 15;

/** "Douglas Guy Mack (President) " → "Douglas Guy Mack". */
export const contactName = (v: string | null | undefined) => clean(v?.replace(/\([^)]*\)\s*$/, ""));
const hasAll = (name: string, v: string | null) => { const have = new Set(tokens(v ?? "")); return tokens(name).every((w) => have.has(w)); };

async function rocSearch(searchKey: string): Promise<RocAccount[]> {
  const rows = await auraApex<RocAccount[] | null>(ROC, "apex://ARCP_ContractorSearch/ACTION$getRecords", { searchKey, classification: null, city: "" });
  return Array.isArray(rows) ? rows : [];
}

/** The ROC search matches the words as typed; a middle name the license doesn't carry finds nothing, so a person is also searched by first + last name. */
async function accountsFor(name: string, kind: "person" | "company"): Promise<RocAccount[]> {
  const key = name.replace(/\s+/g, " ").trim();
  if (key.length < 2) return [];
  let rows = await rocSearch(key);
  const words = key.split(" ");
  if (!rows.length && kind === "person" && words.length > 2) rows = await rocSearch(`${words[0]} ${words[words.length - 1]}`);
  return rows;
}

/** License hits from search rows, kept to rows that name the company (company) or a person on the license (person). */
export function rocLicenseHits(rows: RocAccount[], name: string, kind: "person" | "company"): (LicenseHit & { licenseId: string })[] {
  const out: (LicenseHit & { licenseId: string })[] = [];
  for (const a of rows) {
    const people = Array.from(new Set((a.accountContactData ?? []).map((c) => contactName(c.contactName)).filter((v): v is string => !!v)));
    const matchedPerson = kind === "person" ? people.find((p) => hasAll(name, p)) ?? null : null;
    if (kind === "company" ? !hasAll(name, a.accountName ?? null) : !matchedPerson && !(a.licenseData ?? []).some((l) => hasAll(name, l.qpName))) continue;
    for (const l of a.licenseData ?? []) {
      const qp = clean(l.qpName);
      out.push({
        licenseId: l.licenseId,
        state: "AZ", source: "Arizona Registrar of Contractors licenses", sourceUrl: licensePage(l.licenseId),
        businessName: clean(a.accountName), licenseNumber: clean(l.licenseNo), licenseType: clean(l.subType), specialty: null,
        status: clean(l.status),
        principal: kind === "person" ? (qp && hasAll(name, qp) ? qp : matchedPerson ?? qp) : qp ?? people[0] ?? null,
        city: clean(a.address), expires: null, matchedOn: kind === "company" ? "business" : "principal",
      });
    }
  }
  return out;
}

async function searchRocLicenses(name: string, kind: "person" | "company"): Promise<LicenseHit[]> {
  const hits = rocLicenseHits(await accountsFor(name, kind), name, kind);
  // The license page adds the class description and the renewed-through date.
  for (const h of hits.slice(0, MAX_DETAILS)) {
    const d = await auraApex<RocDetail | null>(ROC, "apex://ARCP_ContractorSearch/ACTION$getLicenseDetail", { licenseId: h.licenseId }).catch(() => null);
    if (!d) continue;
    h.licenseType = clean(d.licenseDescription) ?? h.licenseType;
    h.expires = /^\d{4}-\d{2}-\d{2}$/.test(d.renewalThr ?? "") ? d.renewalThr! : null;
    h.status = clean(d.licenseStatus) ?? h.status;
  }
  return hits.map(({ licenseId: _id, ...h }) => h);
}

/** One complaint as the ROC lists it on a license (the complainant is left out). */
export function rocComplaintHit(c: RocComplaint, fallbackName: string | null, licenseNo: string | null, licenseId: string): EnforcementHit {
  const type = clean(c.Complaint_Type__c);
  const status = clean(c.Status__c);
  const outcome = clean(c.Complaint_Outcome_Multi__c?.replace(/;/g, "; "));
  return {
    state: "AZ", source: "Arizona Registrar of Contractors complaints", sourceUrl: licensePage(licenseId),
    category: type === "Disciplined" ? "discipline" : "complaint",
    name: clean(c.License_Number_Respondent__r?.Primary_Licensee__r?.Name) ?? fallbackName,
    id: clean(c.Name), date: null, endDate: /^\d{4}-\d{2}-\d{2}/.test(c.Closed_Date__c ?? "") ? c.Closed_Date__c!.slice(0, 10) : null,
    status: [status, type ? `(${type})` : null].filter(Boolean).join(" ") || null,
    city: clean(c.Jobsite_City__c) ? `Jobsite: ${clean(c.Jobsite_City__c)}` : null,
    detail: [licenseNo ?? clean(c.License_Number_Respondent__r?.Name) ? `License ${licenseNo ?? clean(c.License_Number_Respondent__r?.Name)}` : null,
      clean(c.Allegations__c) ? `Allegations: ${clean(c.Allegations__c!.replace(/;/g, "; "))}` : null,
      outcome ? `Outcome: ${outcome}` : null].filter(Boolean).join(". ") || null,
    amount: null, adverse: type === "Disciplined" ? true : null,
  };
}

async function searchRocComplaints(name: string): Promise<EnforcementHit[]> {
  const rows = (await accountsFor(name, "company")).filter((a) => hasAll(name, a.accountName ?? null));
  const out: EnforcementHit[] = [];
  let calls = 0;
  for (const a of rows) for (const l of a.licenseData ?? []) {
    if (calls++ >= MAX_DETAILS) break;
    const r = await auraApex<{ complaintDataList?: RocComplaint[] } | null>(ROC, "apex://ARCP_ContractorSearch/ACTION$getAllComplaintsDetail", { licenseId: l.licenseId });
    for (const c of r?.complaintDataList ?? []) out.push(rocComplaintHit(c, clean(a.accountName), clean(l.licenseNo), l.licenseId));
  }
  return out;
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: "Arizona Registrar of Contractors licenses", sourceUrl: ROC_SEARCH_PAGE, search: searchRocLicenses },
];

const liveEnforcement: LiveEnforcementSearch[] = [
  { source: "Arizona Registrar of Contractors complaints", scope: "Open, disciplined and resolved-with-corrective-work cases listed on each ROC license", search: searchRocComplaints },
];

export const pack: StatePack = {
  state: "AZ",
  checked: "2026-10-15",
  liveLicenses,
  liveEnforcement,
  blocked: [
    "roc.az.gov / azroc.gov posting lists (active contractor lists, new licenses, discipline CSVs): every path, robots.txt included, answers a Cloudflare JS challenge (HTTP 403)",
    "Arizona Corporation Commission eCorp (ecorp.azcc.gov): robots.txt disallows every path",
  ],
};
