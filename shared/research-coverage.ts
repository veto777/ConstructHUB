/**
 * "What we search, state by state" (/compliance/research/coverage): the shape of the coverage manifest.
 *
 * The manifest is generated from the research bot's own source registry at build time (server/research/coverage-manifest.ts,
 * served to the client as the `virtual:research-coverage` module), never typed in by hand, so the page can't promise
 * a source the bot doesn't search. The daily files' indexed identifiers are only known from the loaded data; the page
 * fills those in from /api/research-reports/coverage-facets when it can.
 */
import type { EnforcementCategory } from "./research-reports";

export const RESEARCH_COVERAGE_PATH = "/compliance/research/coverage";

/** What a source holds. */
export type CoverageKind =
  | "licenses" | "discipline" | "stop_work" | "wage" | "debarment" | "business_status" | "complaints" | "courts"
  | "environmental" | "tax_lien" | "other";

/** How a source can be searched: by business name, by a person on the record (an owner, officer or qualifier), or by an identifier. */
export type CoverageId = "name" | "owner" | "license" | "phone" | "address";

export const COVERAGE_KIND_ORDER: CoverageKind[] = [
  "licenses", "discipline", "complaints", "stop_work", "wage", "debarment", "courts", "environmental", "tax_lien", "business_status", "other",
];
export const COVERAGE_KIND_LABELS: Record<CoverageKind, string> = {
  licenses: "Contractor and trade licenses",
  discipline: "Licensing-board discipline",
  complaints: "Complaints",
  stop_work: "Stop-work orders",
  wage: "Wage and labor violations",
  debarment: "Debarments and suspensions",
  courts: "Court cases",
  environmental: "Environmental enforcement",
  tax_lien: "Tax liens",
  business_status: "Business registration status",
  other: "Other official records",
};
export const COVERAGE_ID_ORDER: CoverageId[] = ["name", "owner", "license", "phone", "address"];
export const COVERAGE_ID_LABELS: Record<CoverageId, string> = {
  name: "Business name", owner: "Owner or person", license: "License number", phone: "Phone", address: "Address",
};

/** The report's enforcement categories as page kinds. */
export const KIND_OF_CATEGORY: Record<EnforcementCategory, CoverageKind> = {
  discipline: "discipline", complaint: "complaints", stop_work: "stop_work", environmental: "environmental", tax_lien: "tax_lien",
  debarment: "debarment", business_status: "business_status", wage: "wage", court_case: "courts",
};

export type CoverageSource = {
  label: string;
  kinds: CoverageKind[];
  ids: CoverageId[];
  /** "file": an official download we refresh on a schedule; "live": searched on the agency's site when the report runs. */
  mode: "file" | "live";
  /** Files: hours between refreshes. */
  refreshHours?: number;
  /** Files: the id the facets endpoint reports on (bulk source id). */
  fileId?: string;
  /** A city or county source rather than a statewide one. */
  local?: boolean;
  /** Searched for companies only (enforcement, complaints and court records). */
  companiesOnly: boolean;
  /**
   * Searched only when the running server is set up for it (round 4: OSHA needs the Labor Department key). The page
   * lists it only when /api/research-reports/coverage-runtime says the server has it; never decided at build time.
   */
  needs?: keyof CoverageRuntime;
  /** The official page a reader can open. */
  url: string | null;
  /** Files: what it is found by was read from a sample of its first rows (a load made before full facets). */
  sampled?: boolean;
};

export type CoverageState = {
  state: string;
  /** The date the state's sources were last checked live (YYYY-MM-DD), when its pack says. */
  checked: string | null;
  sources: CoverageSource[];
  /** Said instead of "no license found" when the state has no statewide general-contractor license. */
  noStatewideGcLicense: string | null;
  /** How many sources were looked at and left out because they block automated searches, need an account or have no data. */
  unavailableCount: number;
};

export type CoverageManifest = {
  generatedAt: string;
  states: CoverageState[];
  /** Searched for every order, whatever the state. */
  nationwide: CoverageSource[];
};

/** Live facets of the daily files, from the loaded rows (what they're really indexed by). */
/** What the running server can search beyond the build's manifest (decided from the server's own settings). */
export type CoverageRuntime = { osha: boolean; samExclusions?: boolean; federalCourts?: boolean };

/** The nationwide sources the running server really searches (a `needs` source only when the server has it). */
export const nationwideNow = <T extends Pick<CoverageSource, "needs">>(list: T[], runtime: CoverageRuntime | undefined): T[] =>
  list.filter((n) => !n.needs || runtime?.[n.needs] === true);

export type CoverageFacets = Record<string, { rows: number; loadedAt: string | null; ids: CoverageId[]; kinds: CoverageKind[]; sampled?: boolean }>;

/** A source's identifiers and kinds, with a file's loaded facets applied when there are some. */
export function withFacets(src: CoverageSource, facets: CoverageFacets | undefined): CoverageSource {
  const f = src.fileId ? facets?.[src.fileId] : undefined;
  if (!f || !f.rows) return src;
  // An enforcement file is searched for companies only, so the people on it are not a way in.
  const ids = COVERAGE_ID_ORDER.filter((i) => (f.ids.includes(i) && !(i === "owner" && src.companiesOnly)) || (i === "name" && src.ids.includes("name")));
  const kinds = COVERAGE_KIND_ORDER.filter((k) => src.kinds.includes(k) || f.kinds.includes(k));
  return { ...src, ids, kinds, ...(f.sampled ? { sampled: true } : {}) };
}

/**
 * How thin a state's coverage is, in plain words (null when it's well covered). Based only on the manifest's counts:
 * license sources, record sources and the sources left out.
 */
export function coverageNote(s: CoverageState): string | null {
  const licenses = s.sources.filter((x) => x.kinds.includes("licenses")).length;
  const records = s.sources.filter((x) => !x.kinds.includes("licenses")).length;
  const fallback = "permit portals, the nationwide records listed below, and the cross-reference of any license numbers, phones and addresses you give";
  if (!licenses && !records) return `We don't search any of this state's own records yet, so reports here rely on ${fallback}.`;
  if (!licenses) {
    return s.unavailableCount
      ? `This state's license lookups block automated searches or need an account, so reports here rely on the records below, ${fallback}.`
      : `We don't search this state's license records yet, so reports here rely on the records below, ${fallback}.`;
  }
  if (licenses === 1 && s.unavailableCount >= 3) {
    return "Most of this state's other license lookups block automated searches or need an account, so we search the one source below and the state's records.";
  }
  return null;
}

/**
 * The record sources a sales line may add, decided by the running server (round 5, decision 11): OSHA only with the
 * Labor Department key, SAM.gov only with a loaded file. Before the answer arrives (first render, the prerendered
 * snapshot) neither is claimed. "" / ", and OSHA inspections (federal)" / ", federal exclusions … (SAM.gov), and OSHA …".
 */
export function runtimeRecordsPhrase(runtime: CoverageRuntime | undefined): string {
  const extra = [
    ...(runtime?.samExclusions === true ? ["federal exclusions and debarments (SAM.gov)"] : []),
    ...(runtime?.osha === true ? ["OSHA inspections (federal)"] : []),
    ...(runtime?.federalCourts === true ? ["federal court cases"] : []),
  ];
  if (!extra.length) return "";
  return extra.length === 1 ? `, and ${extra[0]}` : `, ${extra.slice(0, -1).join(", ")}, and ${extra[extra.length - 1]}`;
}
