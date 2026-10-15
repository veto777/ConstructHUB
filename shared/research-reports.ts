/**
 * Permit & License Research Reports (owner, 2026-10-14): a customer names people or companies, the states and the
 * trades; our research bot (server/research/) searches every live permit portal we reach in those states plus the
 * state contractor-license records, and delivers a sourced report. Paid up front, non-refundable, nothing guaranteed.
 *
 * One definition for the order form (client/src/pages/research-reports.tsx), the API (server/research/routes.ts) and
 * the runner, so the price the page shows is the price the server charges.
 */
import { z } from "zod";
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

export const researchSubjectSchema = z.object({
  name: text("Name", 120).min(2, "Each name needs at least 2 characters"),
  kind: z.enum(["person", "company"]),
});

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
  city: string | null; expires: string | null; matchedOn: "business" | "principal";
};

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
};

export type RecordSource = { source: string; scope: string; searched: boolean; note: string };

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
};

export type ResearchReport = {
  generatedAt: string;
  states: string[]; trades: string[]; sinceYear: number | null;
  subjects: ResearchSubjectReport[];
  totals: { licenses: number; permits: number; portalsSearched: number; portalsNotSearched: number; complaints?: number; courtCases?: number; osha?: number; enforcement?: number };
};

/** The free look before paying: license matches now, and how many live portals the full report will sweep. */
export type ResearchPreview = {
  licenseMatches: number;
  licenseSourceStates: string[];
  portalsByState: Record<string, number>;
  /** Companies only: complaint, federal case and OSHA inspection counts (absent on older previews). */
  records?: { complaints: number; courtCases: number; osha: number; enforcement?: number; searched: string[] };
};

export type ResearchOrderView = {
  id: number; status: ResearchStatus; tier: ResearchTier; priceCents: number;
  input: Omit<ResearchOrderInput, "agreeNonRefundable" | "agreeNoGuarantee" | "agreeNotFcra">;
  preview: ResearchPreview | null; report: ResearchReport | null; error: string | null;
  createdAt: string; paidAt: string | null; completedAt: string | null;
};
