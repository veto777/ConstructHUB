/**
 * Arizona. Checked live 2026-10-15.
 *
 *   AZ ROC contractor licenses: the Registrar of Contractors' public Contractor Search (azroc.my.site.com), the
 *     same guest Apex calls its page makes. Every license the ROC lists (active, suspended, revoked, expired,
 *     cancelled), by company name, by a person named on the license (qualifying party, officers, members) or by
 *     license number, with the phone and everyone named (with their roles).
 *   AZ ROC complaints: the complaints the same search shows on each license (open cases, disciplined cases and
 *     cases resolved with a corrective work order; the ROC leaves out dismissed and cancelled ones). Companies only.
 *
 * The ROC search answers: accountName, licenseData[] (licenseNo, subType, status, qpName), accountContactData[]
 * (contactName "Name (Role) "), address ("City, ST, ZIP": no street, so no address key), phone; getLicenseDetail adds renewalThr (renewed through),
 * licenseDescription, issuedDate and entityType (LLC, Corporation, Partnership, Sole Proprietorship: the holder; a sole
 * proprietorship's license is the owner's, so it shows no phone). A person is searched by name: the ROC search
 * matches the qualifying party and everyone named on the account (re-checked 2026-10-15: "Kenneth Mackey" finds
 * ROC 325034 and ROC 338420, qualifying party Kenneth Eugene Mackey); getAllComplaintsDetail gives complaintDataList[] (Name = case number, Status__c,
 * Complaint_Type__c, Complaint_Outcome_Multi__c, Allegations__c, Closed_Date__c, Jobsite_City__c). The complainant
 * (a private person) is never read into a report.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import { entityHolder, onePersonField, tokens } from "../licenses";
import { personText } from "../person-name";
import { clean } from "../bulk";
import { normLicense, type IdQuery } from "../identifiers";
import { auraApex, type AuraSite } from "./lib/g7-aura";
import { ADVERSE, NOT_ADVERSE, adverseFrom } from "../adverse";
import { rethrowIfBlocked } from "../http";
import { capNote, withNote } from "../notes";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./types";

const ROC: AuraSite = { origin: "https://azroc.my.site.com", page: "/AZRoc/s/contractor-search" };
const ROC_SEARCH_PAGE = ROC.origin + ROC.page;
const licensePage = (id: string) => `${ROC_SEARCH_PAGE}?licenseId=${encodeURIComponent(id)}`;

type RocLicense = { licenseId: string; licenseNo: string | null; qpName: string | null; status: string | null; subType: string | null };
export type RocAccount = { accountId: string; accountName: string | null; address: string | null; phone?: string | null; licenseData?: RocLicense[]; accountContactData?: { contactName: string | null }[] };
type RocDetail = { licenseDescription?: string | null; renewalThr?: string | null; licenseStatus?: string | null; entityType?: string | null };
type RocComplaint = {
  Name?: string | null; Status__c?: string | null; Complaint_Type__c?: string | null; Complaint_Outcome_Multi__c?: string | null;
  Allegations__c?: string | null; Closed_Date__c?: string | null; Jobsite_City__c?: string | null; Case_Nature__c?: string | null;
  License_Number_Respondent__r?: { Name?: string | null; Primary_Licensee__r?: { Name?: string | null } | null } | null;
};

/**
 * The account's "City, ST, ZIP" (round 3, per-state note): only those three parts are kept, so a street the ROC might
 * put in front ("123 Main St, Phoenix, AZ, 85001") never reaches the report's city.
 */
export function rocCity(address: string | null | undefined): string | null {
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  const tail = parts.slice(-3).filter((p) => !/^\d+\s+\S/.test(p));
  return clean(tail.join(", ")) || null;
}

const MAX_DETAILS = 15;

/**
 * The license page's entityType as the holder: the values the ROC answered on 2026-10-15 ("LLC", "Corporation",
 * "Partnership" → the business; "Sole Proprietorship" → the individual who owns it). Any other value, or no page read,
 * is null: the holder is unknown, shown like an individual's (city only, no phone).
 */
export const rocHolder = (entityType: string | null | undefined) =>
  entityHolder(entityType, { business: /^(LLC|Corporation|Partnership)$/, individual: /^Sole Proprietorship$/ });

/** "Douglas Guy Mack (President) " → "Douglas Guy Mack". */
/** The role suffix comes off; the rest is the field as published, a list kept a list (round 6, decision 3: "Jane Smith\nJohn Doe" is not one name). */
export const contactName = (v: string | null | undefined) => personText(v?.replace(/\([^)]*\)\s*$/, ""));
/** "Kenneth Eugene Mackey (Member;Qualifying Party) " → "Member; Qualifying Party". */
const contactRole = (v: string | null | undefined) => clean(v?.match(/\(([^)]*)\)\s*$/)?.[1]?.replace(/;/g, "; ")) ?? null;
const letters = (v: string | null | undefined) => (v ?? "").toUpperCase().split(/[^A-Z0-9']+/).filter(Boolean);
/** Every word of the name, single letters included, is a word of v ("D & S Electric" is not "A & B Electric"). */
const hasAll = (name: string, v: string | null) => { const have = new Set(letters(v)); return tokens(name).length > 0 && letters(name).every((w) => have.has(w)); };
/**
 * The same person: every full word of the name is on the record, and a middle initial on the name agrees with a middle
 * name the record gives ("John Q Smith" is not "John R Smith"; plain "John Smith" stays a candidate).
 */
export function samePersonName(name: string, v: string | null): boolean {
  // One person per field, by the shared check (round 5, decision 4).
  if (v && !onePersonField(v)) return false;
  const want = letters(name), have = letters(v);
  const full = want.filter((w) => w.length > 1);
  if (!full.length || !full.every((w) => have.includes(w))) return false;
  const extra = have.filter((w) => !full.includes(w));
  return want.filter((w) => w.length === 1).every((i) => !extra.length || extra.some((w) => w[0] === i));
}

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
export function rocLicenseHits(rows: RocAccount[], name: string, kind: "person" | "company" | "license"): (LicenseHit & { licenseId: string })[] {
  const out: (LicenseHit & { licenseId: string })[] = [];
  for (const a of rows) {
    const people = Array.from(new Set((a.accountContactData ?? []).map((c) => contactName(c.contactName)).filter((v): v is string => !!v)));
    const matchedPerson = kind === "person" ? people.find((p) => samePersonName(name, p)) ?? null : null;
    if (kind === "company" ? !hasAll(name, a.accountName ?? null) : kind === "person" && !matchedPerson && !(a.licenseData ?? []).some((l) => samePersonName(name, l.qpName))) continue;
    const roles = new Map<string, string[]>();
    for (const c of a.accountContactData ?? []) {
      const n = contactName(c.contactName);
      if (!n) continue;
      const r = contactRole(c.contactName);
      roles.set(n, [...(roles.get(n) ?? []), ...(r ? [r] : [])]);
    }
    for (const l of a.licenseData ?? []) {
      const qp = clean(l.qpName);
      const named = new Map(roles);
      if (qp && !Array.from(named.keys()).some((k) => k === qp)) named.set(qp, ["Qualifying Party"]);
      out.push({
        licenseId: l.licenseId,
        state: "AZ", source: "Arizona Registrar of Contractors licenses", sourceUrl: licensePage(l.licenseId),
        businessName: clean(a.accountName), licenseNumber: clean(l.licenseNo), licenseType: clean(l.subType), specialty: null,
        status: clean(l.status),
        principal: kind === "person" ? (qp && samePersonName(name, qp) ? qp : matchedPerson ?? qp) : qp ?? people[0] ?? null,
        city: rocCity(a.address), expires: null, matchedOn: kind === "company" ? "business" : kind === "license" ? "license" : "principal",
        phone: clean(a.phone),
        people: Array.from(named, ([n, r]) => ({ name: n, role: Array.from(new Set(r)).join("; ") || null })),
        // Who holds the license comes only from the license page's entityType (withDetails, rocHolder): LLC,
        // Corporation or Partnership → the business; Sole Proprietorship → its owner. Until that page is read, and for
        // hits past the MAX_DETAILS page reads, the holder is unknown (A13): a sole proprietor's phone is never shown
        // because its page wasn't read. The account address is city, state and ZIP only (rocCity).
        holder: null,
      });
    }
  }
  return out;
}

const rocDetail = (licenseId: string) => auraApex<RocDetail | null>(ROC, "apex://ARCP_ContractorSearch/ACTION$getLicenseDetail", { licenseId });

export async function withDetails(hits: (LicenseHit & { licenseId: string })[], detail = rocDetail): Promise<LicenseHit[]> {
  // The license page adds the class description, the renewed-through date and the holder.
  let failed = 0;
  for (const h of hits.slice(0, MAX_DETAILS)) {
    // One license page that fails is noted; an access denial stops the search (round 2, decision 6).
    const d = await detail(h.licenseId).catch((err) => { rethrowIfBlocked(err); return null; });
    if (!d) { failed++; continue; }
    h.licenseType = clean(d.licenseDescription) ?? h.licenseType;
    h.expires = /^\d{4}-\d{2}-\d{2}$/.test(d.renewalThr ?? "") ? d.renewalThr! : null;
    h.status = clean(d.licenseStatus) ?? h.status;
    h.holder = rocHolder(d.entityType); // an entity type not on either list leaves it unknown
  }
  const out = hits.map(({ licenseId: _id, ...h }) => h);
  return withNote(out, [
    hits.length > MAX_DETAILS ? `class description, renewal date and holder read for the first ${MAX_DETAILS} of ${hits.length} licenses (the rest show city only)` : null,
    failed ? `the license page could not be read for ${failed} license(s), shown as the search lists them` : null,
  ].filter(Boolean).join("; "));
}

const searchRocLicenses = async (name: string, kind: "person" | "company") => withDetails(rocLicenseHits(await accountsFor(name, kind), name, kind));

/** The ROC search also takes a license number ("ROC 128499" or "128499"); it does not search phones or addresses. */
async function searchRocBy(q: IdQuery): Promise<LicenseHit[] | null> {
  if (q.type !== "license") return null;
  const want = normLicense(q.value)?.replace(/^ROC/, "");
  if (!want) return null;
  const rows = await rocSearch(want);
  return withDetails(rocLicenseHits(rows, "", "license").filter((h) => normLicense(h.licenseNumber)?.replace(/^ROC/, "") === want));
}

/** A case the ROC types "Disciplined": the outcome's clean answer; null when mixed or negated; true with no outcome words. */
export function disciplinedAdverse(outcome: string | null): boolean | null {
  const a = adverseFrom(outcome);
  if (a !== null || !outcome) return a ?? true;
  return ADVERSE.test(outcome) || NOT_ADVERSE.test(outcome) ? null : true;
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
    // The ROC's own case type and outcome: a disciplined case is adverse unless its outcome says otherwise; an outcome
    // with mixed or negated wording is unknown (round 2, decision 4).
    amount: null, adverse: type === "Disciplined" ? disciplinedAdverse(outcome) : adverseFrom(outcome),
    licenseNumber: licenseNo ?? clean(c.License_Number_Respondent__r?.Name),
  };
}

async function searchRocComplaints(name: string): Promise<EnforcementHit[]> {
  const rows = (await accountsFor(name, "company")).filter((a) => hasAll(name, a.accountName ?? null));
  const licenses = rows.flatMap((a) => (a.licenseData ?? []).map((l) => ({ a, l })));
  const out: EnforcementHit[] = [];
  for (const { a, l } of licenses.slice(0, MAX_DETAILS)) {
    const r = await auraApex<{ complaintDataList?: RocComplaint[] } | null>(ROC, "apex://ARCP_ContractorSearch/ACTION$getAllComplaintsDetail", { licenseId: l.licenseId });
    for (const c of r?.complaintDataList ?? []) out.push(rocComplaintHit(c, clean(a.accountName), clean(l.licenseNo), l.licenseId));
  }
  return withNote(out, licenses.length > MAX_DETAILS ? capNote(MAX_DETAILS, licenses.length, "licenses' complaint lists") : null);
}

const liveLicenses: LiveLicenseSearch[] = [
  { source: "Arizona Registrar of Contractors licenses", sourceUrl: ROC_SEARCH_PAGE, search: searchRocLicenses, searchBy: searchRocBy },
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
