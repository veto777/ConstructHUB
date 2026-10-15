/**
 * Permit & License Research Reports (owner, 2026-10-14): a customer names people or companies, the states and the
 * trades; our research bot (server/research/) searches every live permit portal we reach in those states plus the
 * state contractor-license records, and delivers a sourced report. Paid up front, non-refundable, nothing guaranteed.
 *
 * One definition for the order form (client/src/pages/research-reports.tsx), the API (server/research/routes.ts) and
 * the runner, so the price the page shows is the price the server charges.
 */
import { z } from "zod";
import { addressKeys, normLicense, normPhone } from "./identifiers";
import {
  RESEARCH_STANDARD_CENTS, RESEARCH_EXTENDED_CENTS, RESEARCH_EXTENDED_MAX_NAMES, RESEARCH_EXTENDED_MAX_STATES,
} from "./plans";

export const COMPLIANCE_PATH = "/compliance";
export const RESEARCH_PATH = "/compliance/research";

export const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

/** Trades a customer can narrow to. Permits whose type or description matches are flagged and listed first. */
export const RESEARCH_TRADES = {
  electrical: { label: "Electrical", words: ["electric", "elec ", "elect", "wiring", "service upgrade", "panel", "solar", "ev charger"] },
  lowVoltage: { label: "Low voltage / telecom", words: ["low volt", "low-volt", "lv ", "telecom", "data", "fiber", "cabling", "communication"] },
  security: { label: "Security / fire alarm", words: ["alarm", "security", "access control", "cctv", "camera", "fire alarm", "intrusion"] },
  plumbing: { label: "Plumbing", words: ["plumb", "water heater", "sewer", "backflow", "gas line", "gas piping"] },
  mechanical: { label: "Mechanical / HVAC", words: ["mechanical", "hvac", "furnace", "heat pump", "air condition", "duct", "boiler"] },
  roofing: { label: "Roofing", words: ["roof", "reroof", "re-roof", "shingle"] },
  building: { label: "Building / general", words: ["building", "addition", "remodel", "alteration", "new construction", "tenant improvement", "demolition"] },
} as const;
export type ResearchTrade = keyof typeof RESEARCH_TRADES;
export const RESEARCH_TRADE_KEYS = Object.keys(RESEARCH_TRADES) as ResearchTrade[];

export const RESEARCH_TIERS = {
  standard: { label: "Standard report", cents: RESEARCH_STANDARD_CENTS, maxNames: 1, maxStates: 1 },
  extended: { label: "Extended report", cents: RESEARCH_EXTENDED_CENTS, maxNames: RESEARCH_EXTENDED_MAX_NAMES, maxStates: RESEARCH_EXTENDED_MAX_STATES },
} as const;
export type ResearchTier = keyof typeof RESEARCH_TIERS;

/** The tier an order needs: Standard for one name in one state, Extended up to its limits, null beyond them. */
export function researchTierFor(names: number, states: number): ResearchTier | null {
  if (names < 1 || states < 1) return null;
  if (names <= RESEARCH_TIERS.standard.maxNames && states <= RESEARCH_TIERS.standard.maxStates) return "standard";
  if (names <= RESEARCH_TIERS.extended.maxNames && states <= RESEARCH_TIERS.extended.maxStates) return "extended";
  return null;
}

// ── The words every page, checkout and email uses (owner: non-refundable, nothing guaranteed) ─────────────────────

export const RESEARCH_NONREFUNDABLE =
  "Research reports are paid in full up front and are non-refundable, including when the search finds nothing.";
export const RESEARCH_NO_GUARANTEE =
  "Nothing is guaranteed. We can only search what permit offices, licensing boards, courts and agencies publish online, records can be " +
  "missing, late or wrong at the source, and some portals are down or block searches on the day we run.";
export const RESEARCH_NOT_FCRA =
  "This is not a consumer report under the Fair Credit Reporting Act. It may not be used to decide anyone's " +
  "eligibility for employment, credit, insurance, housing or any other FCRA purpose.";

const text = (label: string, max: number) => z.string({ required_error: `${label} is required` }).trim().max(max, `${label} is too long`);

/** Limits on the identifiers one name may carry (they don't count as extra names for the price). */
export const RESEARCH_MAX_LICENSE_NUMBERS = 5;
export const RESEARCH_MAX_PHONES = 3;
export const RESEARCH_MAX_ADDRESSES = 3;

/** A list of optional identifiers: blanks dropped, each checked and normalized by shared/identifiers.ts, duplicates merged. */
const idList = (label: string, max: number, max1: number, check: (v: string) => string | null, bad: string) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => !(typeof x === "string" && x.trim() === "")) : v),
    z.array(z.string().trim().max(max1, `${label} is too long`).transform((v, ctx) => {
      const out = check(v);
      if (!out) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${v.slice(0, 40)}" ${bad}` }); return z.NEVER; }
      return out;
    })).max(max, `Up to ${max} ${label.toLowerCase()}s per name`),
  ).optional().transform((l) => (l?.length ? Array.from(new Set(l)) : undefined));

/** A license number as the customer typed it (uppercased, spaces collapsed): sources store some with dashes. */
export const cleanLicenseNumber = (v: string): string | null => (normLicense(v) ? v.toUpperCase().replace(/\s+/g, " ").trim() : null);
/** A phone as (206) 555-0142. */
export const formatPhone = (v: string): string | null => { const n = normPhone(v); return n ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : null; };
/** A street address with a house number (a city alone is not one), spaces collapsed. */
export const cleanAddress = (v: string): string | null => (addressKeys(v).length ? v.replace(/\s+/g, " ").trim() : null);

export const researchSubjectSchema = z.object({
  name: text("Name", 120).min(2, "Each name needs at least 2 characters"),
  /** "person" also covers owners: it matches the people named on licenses (owners, officers, qualifiers). */
  kind: z.enum(["person", "company"]),
  /** Optional ways to find the same contractor besides the name (orders before 2026-10-15 have none). */
  licenseNumbers: idList("License number", RESEARCH_MAX_LICENSE_NUMBERS, 40, cleanLicenseNumber, "doesn't look like a license number (it needs at least 3 letters or digits, one of them a digit)"),
  phones: idList("Phone number", RESEARCH_MAX_PHONES, 30, formatPhone, "isn't a 10-digit US phone number"),
  addresses: idList("Address", RESEARCH_MAX_ADDRESSES, 200, cleanAddress, "needs a house number and street, e.g. 123 Main St, Tampa FL 33602"),
});
export type ResearchSubjectInput = z.infer<typeof researchSubjectSchema>;

export const researchOrderSchema = z.object({
  subjects: z.array(researchSubjectSchema).min(1, "Add at least one name").max(RESEARCH_EXTENDED_MAX_NAMES, `Up to ${RESEARCH_EXTENDED_MAX_NAMES} names per report`),
  states: z.array(z.enum(STATE_CODES)).min(1, "Pick at least one state").max(RESEARCH_EXTENDED_MAX_STATES, `Up to ${RESEARCH_EXTENDED_MAX_STATES} states per report`),
  trades: z.array(z.enum(RESEARCH_TRADE_KEYS as [ResearchTrade, ...ResearchTrade[]])).max(RESEARCH_TRADE_KEYS.length).default([]),
  /** Only permits on or after this year are kept (rows without a date are kept and marked). */
  sinceYear: z.number().int().min(1980).max(2100).nullable().default(null),
  purpose: text("Purpose", 1000).optional().default(""),
  agreeNonRefundable: z.literal(true, { errorMap: () => ({ message: "Please accept that the report is non-refundable" }) }),
  agreeNoGuarantee: z.literal(true, { errorMap: () => ({ message: "Please accept that results are not guaranteed" }) }),
  agreeNotFcra: z.literal(true, { errorMap: () => ({ message: "Please confirm you won't use the report for an FCRA purpose" }) }),
});
export type ResearchOrderInput = z.infer<typeof researchOrderSchema>;

// ── What the API returns ─────────────────────────────────────────────────────────────────────────────────────────

export type ResearchStatus = "awaiting_payment" | "paid" | "researching" | "complete" | "failed";

export type LicenseHit = {
  state: string; source: string; sourceUrl: string; businessName: string | null; licenseNumber: string | null;
  licenseType: string | null; specialty: string | null; status: string | null; principal: string | null;
  city: string | null; expires: string | null;
  /** How the record was found: the subject's name (business or a person on the license) or one of its identifiers. */
  matchedOn: "business" | "principal" | "license" | "phone" | "address";
  /** Published by some sources only (absent on reports made before 2026-10-15). */
  address?: string | null; phone?: string | null;
  /** Everyone the source names on the license: owners, officers, qualifiers, responsible managing employees. */
  people?: { name: string; role: string | null }[];
  /** Set by the cross-reference pass: why a record found through another record is tied to the subject. */
  relatedVia?: string | null;
  /** The kind of tie, for grouping (set with relatedVia). */
  relatedTie?: RelatedTie;
  /** Found only by a license number, phone or address the customer gave; it names someone else (absent before 2026-10-15). */
  byYourIdentifier?: boolean;
  /**
   * Who holds the license, as the publisher says (license class, entity type, an individual credential such as a
   * journeyman or qualifier card): "business", "individual", or null when the publisher doesn't say. Only a
   * business's street address and phone are shown or indexed; an individual's or an unknown holder's record keeps
   * city, state and ZIP only (audit round 2, decision 2). Absent on reports made before 2026-10-16.
   */
  holder?: "business" | "individual" | null;
  /**
   * Disciplinary text a source publishes on the license (discipline history, "previous disciplinary actions",
   * complaint counts). Never shown on a license: the runner removes it from every hit, and for a business's
   * license turns it into an enforcement record (companies only; audit round 2, decision 1).
   */
  discipline?: string | null;
};

/**
 * How a related record is tied to the subject's own: the same license number, phone or street address, a person
 * named on both, or a business named on the subject's license. Strongest first.
 */
export type RelatedTie = "license" | "phone" | "person" | "business" | "address";
export const RELATED_TIES: RelatedTie[] = ["license", "phone", "person", "business", "address"];

export type PermitHit = {
  jurisdiction: string; permitNumber: string | null; permitType: string | null; status: string | null;
  address: string | null; issuedDate: string | null; contractorName: string | null; applicantName: string | null;
  description: string | null; sourceUrl: string | null; tradeMatch: string[]; undated: boolean;
};

export type PortalCoverage = { jurisdiction: string; outcome: "searched" | "not_searched" | "error"; message: string; found: number };

/** A consumer complaint filed with a state attorney general (open data: dates and status; some states add the text). */
export type ComplaintHit = {
  state: string; source: string; sourceUrl: string; id: string | null; opened: string | null; closed: string | null;
  status: string | null; business: string | null; city: string | null; category: string | null;
  description: string | null; resolution: string | null; savings: number | null;
  /** The business address the complaint names, when the source publishes it. */
  address?: string | null;
};

/** A federal court docket naming the company (CourtListener). A case filed is not a finding against anyone. */
export type CourtCaseHit = {
  caseName: string; court: string | null; courtId: string | null; state: string | null; docketNumber: string | null;
  filed: string | null; terminated: string | null; nature: string | null; url: string;
};

/** A federal OSHA inspection of the company's establishment, with its violations and penalties. */
export type OshaHit = {
  activityNr: string; establishment: string | null; city: string | null; state: string | null; opened: string | null;
  closed: string | null; inspectionType: string | null; violations: number | null; seriousViolations: number | null;
  penalty: number | null; url: string;
};

/**
 * An official enforcement or standing record on the company: licensing-board discipline and complaints, stop-work
 * orders, environmental orders, tax liens, debarments and business-registration status. `adverse` is the source's own
 * outcome (a final order or suspension is adverse; a complaint closed with no violation found is not; null: unknown).
 */
export type EnforcementCategory = "discipline" | "complaint" | "stop_work" | "environmental" | "tax_lien" | "debarment" | "business_status" | "wage" | "court_case";
export type EnforcementHit = {
  state: string; source: string; sourceUrl: string; category: EnforcementCategory;
  name: string | null; id: string | null; date: string | null; endDate: string | null; status: string | null;
  city: string | null; detail: string | null; amount: number | null; adverse: boolean | null;
  /** Published by some sources only. */
  address?: string | null; phone?: string | null; licenseNumber?: string | null;
  /** Set by the cross-reference pass (a record of a business tied to the subject through a license, phone or address). */
  relatedVia?: string | null;
  relatedTie?: RelatedTie;
  /** Found only by a license number, phone or address the customer gave (absent before 2026-10-15). */
  byYourIdentifier?: boolean;
};

/**
 * What a record source covers, so each count is backed by the sources of its own kind (round 3, decision 9):
 * consumer complaints, federal court dockets, state court cases, OSHA inspections, or state enforcement records.
 * Absent on reports made before 2026-10-16.
 */
export type RecordCategory = "complaints" | "federal_court" | "state_court" | "osha" | "enforcement";
export type RecordSource = { source: string; scope: string; searched: boolean; note: string; category?: RecordCategory };

export type ResearchSubjectReport = {
  name: string; kind: "person" | "company";
  licenses: LicenseHit[]; permits: PermitHit[];
  licenseSources: { state: string; source: string; searched: boolean; note: string }[];
  portals: PortalCoverage[];
  /** Complaints, lawsuits and safety records: companies only (reports made before 2026-10-14 have none). */
  complaints?: ComplaintHit[]; courtCases?: CourtCaseHit[]; osha?: OshaHit[];
  /** State enforcement and standing records (reports made before 2026-10-15 have none). */
  enforcement?: EnforcementHit[];
  recordSources?: RecordSource[];
  /** Searches by the license numbers, phones and addresses the customer gave (reports before 2026-10-15 have none). */
  identifierSearches?: { query: string; found: number; note: string; sourcesSearched?: number;
    /** Of those, license sources (an enforcement file is not a license search; absent before 2026-10-15 round 4). */
    licenseSourcesSearched?: number }[];
  /**
   * The cross-reference pass: records of other licenses and businesses tied to the subject's own records (same
   * license number, phone or address, or a person named on both). Never the subject's own: each carries relatedVia.
   */
  relatedLicenses?: LicenseHit[];
  relatedEnforcement?: EnforcementHit[];
  /** What the cross-reference pass searched, and what it left out (caps, ties too common to mean anything). */
  relatedNotes?: string[];
};

/**
 * The version of the rules a stored report was made under (A10, decision 5). 2: license holders are the publisher's
 * own (round 3) and recomputed for old bulk rows (round 4). A report without it is older: shown with today's rules,
 * and a holder it can't verify is treated as unknown (server/research/store.ts shownReport).
 */
export const REPORT_SNAPSHOT_VERSION = 3;
/*
 * 3 (round 6, decision 4): enforcement subjects and contacts follow today's rules, and relationship prose names a phone
 * or street only when it is one the report shows. An older report has its enforcement records checked again and their
 * contacts cut to the locality.
 */

export type ResearchReport = {
  /** REPORT_SNAPSHOT_VERSION when the report was saved (absent: an older report). */
  snapshotVersion?: number;
  generatedAt: string;
  states: string[]; trades: string[]; sinceYear: number | null;
  subjects: ResearchSubjectReport[];
  totals: { licenses: number; permits: number; portalsSearched: number; portalsNotSearched: number; complaints?: number; courtCases?: number; osha?: number; enforcement?: number; related?: number };
};

/** The free look before paying: license matches now, and how many live portals the full report will sweep. */
export type ResearchPreview = {
  /** Every license record found, by name or by an identifier the customer gave. */
  licenseMatches: number;
  /** Of those, found by a license number, phone or address (absent on older previews). */
  identifierMatches?: number;
  licenseSourceStates: string[];
  /**
   * States where a license search really ran for the preview (round 5, decision 10): a configured source that failed is
   * not one. Absent on older previews.
   */
  licenseSearchedStates?: string[];
  portalsByState: Record<string, number>;
  /** Companies only: complaint, federal case and OSHA inspection counts (absent on older previews). */
  records?: { complaints: number; courtCases: number; osha: number; enforcement?: number; searched: string[];
    /** Which kinds were searched (round 4, finding 10): a count is shown only when its kind ran (absent on older previews). */
    ran?: { complaints: boolean; courtCases: boolean; osha: boolean; enforcement: boolean } };
};

export type ResearchOrderView = {
  id: number; status: ResearchStatus; tier: ResearchTier; priceCents: number;
  input: Omit<ResearchOrderInput, "agreeNonRefundable" | "agreeNoGuarantee" | "agreeNotFcra">;
  preview: ResearchPreview | null; report: ResearchReport | null; error: string | null;
  createdAt: string; paidAt: string | null; completedAt: string | null;
};

// ── Counts backed by what ran (round 3, decision 9) ─────────────────────────────────────────────────────────────

export type SourceKind = RecordCategory | "none";
/**
 * What a record source covers: its own category, or for a report made before categories were recorded, its name.
 * Each count is backed only by the sources of its own kind ("none": the single "searched for companies only" line).
 */
export const recordKindOf = (r: RecordSource): SourceKind =>
  r.category ?? (/consumer complaints|attorney general/i.test(r.source) ? "complaints" : /courtlistener|federal court/i.test(r.source) ? "federal_court"
    : /state court/i.test(r.source) ? "state_court" : /OSHA/.test(r.source) ? "osha" : /Complaints, lawsuits/i.test(r.source) ? "none" : "enforcement");
/** The sources behind the state enforcement count (state court cases are shown among them). */
export const ENFORCEMENT_KINDS: SourceKind[] = ["enforcement", "state_court"];

/** True when at least one of the record sources of these kinds was searched. */
export const anySearched = (sources: RecordSource[] | undefined, kinds: SourceKind[]) => !!sources?.some((r) => kinds.includes(recordKindOf(r)) && r.searched);

/** True when a subject's license search ran against at least one source (by name or by an identifier). */
// An identifier search counts only with its license-source count (round 5, decision 10): an older report without it,
// whose generic count may be an enforcement file, reads as not searched by identifier.
export const subjectLicensesSearched = (s: ResearchSubjectReport) => s.licenseSources.some((x) => x.searched) || !!s.identifierSearches?.some((x) => (x.licenseSourcesSearched ?? 0) > 0);

/**
 * A report's one-line summary: each count backed by a source of its own kind that ran, everything else named as
 * not searched. "Found 3 license record(s), 12 permit(s) and 0 consumer complaint(s). Not searched: OSHA inspections."
 */
export function reportSummary(r: ResearchReport): string {
  const t = r.totals, found: string[] = [], not: string[] = [];
  const add = (ran: boolean, n: number | undefined, what: string, label: string) => (ran || n ? found.push(`${n ?? 0} ${what}`) : not.push(label));
  add(r.subjects.some(subjectLicensesSearched), t.licenses, "license record(s)", "license records");
  add(t.portalsSearched > 0, t.permits, "permit(s)", "permit portals");
  if (t.complaints != null) {
    const ran = (kinds: SourceKind[]) => r.subjects.some((x) => anySearched(x.recordSources, kinds));
    add(ran(["complaints"]), t.complaints, "consumer complaint(s)", "consumer complaints");
    if (t.enforcement != null) add(ran(ENFORCEMENT_KINDS), t.enforcement, "state enforcement or standing record(s)", "state enforcement records");
    add(ran(["federal_court"]), t.courtCases, "federal court case(s)", "federal court cases");
    add(ran(["osha"]), t.osha, "OSHA inspection(s)", "OSHA inspections");
  }
  const list = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0]);
  return [found.length ? `Found ${list(found)}.` : "", not.length ? `Not searched: ${list(not)}.` : ""].filter(Boolean).join(" ");
}

/**
 * The preview's "Records on file" line (round 4, finding 10): each count only when a source of its kind ran (an older
 * preview without `ran`: only counts above zero), and the kinds that could not be searched named as such. Null when
 * there is nothing to say.
 */
export function previewRecordsLine(r: ResearchPreview["records"]): string | null {
  if (!r) return null;
  const ran = r.ran;
  const parts: string[] = [], not: string[] = [];
  const add = (did: boolean | undefined, n: number | undefined, what: string, label: string) => {
    if (did ?? (n ?? 0) > 0) parts.push(`${n ?? 0} ${what}`);
    else if (did === false) not.push(label);
  };
  add(ran?.complaints, r.complaints, "consumer complaint(s)", "consumer complaints");
  add(ran?.enforcement, r.enforcement, "state enforcement or standing record(s)", "state enforcement records");
  if (ran?.courtCases ?? r.courtCases > 0) parts.push(`about ${r.courtCases} federal court docket(s)`);
  add(ran?.osha, r.osha, "OSHA inspection(s)", "OSHA inspections");
  if (!parts.some((p) => !/^0 |^about 0 /.test(p))) return null;
  const list = (l: string[]) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0]);
  return `Records on file: ${list(parts)}.${not.length ? ` Not searched in this preview: ${list(not)}.` : ""}`;
}

/**
 * The preview's license line (round 5, decision 10): a count only for states where a license search really ran.
 * Configured states whose search failed are named as not searched; an older preview (no licenseSearchedStates) reads as
 * before. Null when the states have no license source at all.
 */
/**
 * One identifier search as the report lists it (round 6, decision 9): "N found" only when the search is known to have
 * run (sourcesSearched above 0), or found something; otherwise "not searched", never "0 found".
 */
export function identifierSearchLine(x: NonNullable<ResearchSubjectReport["identifierSearches"]>[number]): string {
  const ran = (x.sourcesSearched ?? 0) > 0 || x.found > 0;
  return `${x.query} (${ran ? `${x.found} found` : "not searched"}; ${x.note})`;
}

export function previewLicenseLine(p: Pick<ResearchPreview, "licenseMatches" | "identifierMatches" | "licenseSourceStates" | "licenseSearchedStates">): string | null {
  if (!p.licenseSourceStates.length) return null;
  // An older preview didn't record which searches ran (round 6, decision 9): its count is no "searched, 0 found".
  if (!p.licenseSearchedStates) {
    return p.licenseMatches > 0
      ? `${p.licenseMatches} license record(s) found in state license data${p.identifierMatches ? `, ${p.identifierMatches} of them by a license number, phone or address you gave` : ""}. This preview didn't record whether every state's license records (${p.licenseSourceStates.join(", ")}) could be searched; the report searches them again.`
      : `This preview didn't record whether state license records for ${p.licenseSourceStates.join(", ")} could be searched; the report searches them again.`;
  }
  const ran = p.licenseSearchedStates;
  const missed = p.licenseSourceStates.filter((s) => !ran.includes(s));
  const found = ran.length
    ? `${p.licenseMatches} license record(s) match in ${ran.join(", ")} state license data${p.identifierMatches ? `, ${p.identifierMatches} of them found by a license number, phone or address you gave` : ""}.`
    : "";
  const not = missed.length ? `State license records for ${missed.join(", ")} could not be searched for this preview; the report tries again.` : "";
  return [found, not].filter(Boolean).join(" ");
}
