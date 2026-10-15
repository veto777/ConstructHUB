/**
 * Every research source by state: the original tables (./licenses.ts, ./bulk-sources.ts, ./state-records.ts,
 * ./records.ts) plus the per-state packs in ./states. The runner and ./records read sources only through here.
 */
import type { EnforcementHit, RecordCategory, RecordSource } from "@shared/research-reports";
import type { BulkSource } from "./bulk";
import { BULK_SOURCES } from "./bulk-sources";
import { licenseSourcesFor, type LicenseSource } from "./licenses";
import { searchSodaEnforcement, type SodaEnforcement } from "./state-records";
import type { ComplaintSource } from "./records";
import { STATE_PACKS } from "./states";
import { NATIONWIDE_BULK } from "./sam";
import { failureNote, noteOf } from "./notes";
import { LOCAL_BULK, LOCAL_ENFORCEMENT, LOCAL_LICENSES, LOCAL_LIVE, LOCAL_LIVE_ENFORCEMENT } from "./states/local";
import type { LiveEnforcementSearch, LiveLicenseSearch, StatePack } from "./states/types";

const PACKS = new Map<string, StatePack>(STATE_PACKS.map((p) => [p.state, p]));
const pack = (state: string): StatePack | undefined => PACKS.get(state);

export const ALL_BULK_SOURCES: BulkSource[] = [...BULK_SOURCES, ...STATE_PACKS.flatMap((p) => p.bulk ?? []), ...LOCAL_BULK, ...NATIONWIDE_BULK];
/** Files searched in every state, once per report (state "US": SAM.gov exclusions). */
export const nationwideBulkSources = (): BulkSource[] => NATIONWIDE_BULK;
export const allBulkSourcesFor = (state: string): BulkSource[] => ALL_BULK_SOURCES.filter((s) => s.state === state);

export const allLicenseSourcesFor = (state: string): LicenseSource[] => [...licenseSourcesFor(state), ...(pack(state)?.licenses ?? []), ...LOCAL_LICENSES.filter((s) => s.state === state)];
export const liveLicenseSearchesFor = (state: string): LiveLicenseSearch[] => [...(pack(state)?.liveLicenses ?? []), ...(LOCAL_LIVE[state] ?? [])];
export const packComplaintSourcesFor = (state: string): ComplaintSource[] => pack(state)?.complaints ?? [];

/** States with no statewide license for general contractors: said in the report instead of "no license found". */
const NO_STATEWIDE_GC_LICENSE: Record<string, string> = {
  TX: "Texas does not license general contractors statewide; trades (electrical, A/C, plumbing and others) are licensed separately and are searched above",
};
export const noStatewideGcLicense = (state: string): string | null => pack(state)?.noStatewideGcLicense ?? NO_STATEWIDE_GC_LICENSE[state] ?? null;

/** A pack's live enforcement searches (Socrata datasets and its own), for one company in one state. */
export async function searchPackEnforcement(name: string, state: string, matches: (n: string | null) => boolean): Promise<{ hits: EnforcementHit[]; sources: RecordSource[] }> {
  const hits: EnforcementHit[] = [];
  const sources: RecordSource[] = [];
  const p = pack(state);
  // The report's category for the source (round 3, decision 9): a search of court cases is a state court source.
  const kindOf = (src: LiveEnforcementSearch | SodaEnforcement): RecordCategory => (categoryOf(src) === "court_case" ? "state_court" : "enforcement");
  const run = async (source: string, scope: string, category: RecordCategory, fn: () => Promise<EnforcementHit[]>) => {
    try {
      const raw = await fn();
      const found = raw.filter((h) => matches(h.name));
      hits.push(...found);
      // A search that stopped at a cap says so ("showing the first 10 of 34 matches").
      sources.push({ source, scope, searched: true, note: `${found.length} record(s)${noteOf(raw) ? ` (${noteOf(raw)})` : ""}`, category });
    } catch (err: any) {
      sources.push({ source, scope, searched: false, note: failureNote(err), category });
    }
  };
  for (const src of p?.enforcement ?? []) await run(src.source, src.scope, kindOf(src as SodaEnforcement), () => searchSodaEnforcement(src as SodaEnforcement, name, matches));
  for (const src of p?.liveEnforcement ?? []) await run(src.source, src.scope, kindOf(src as LiveEnforcementSearch), () => (src as LiveEnforcementSearch).search(name));
  for (const src of LOCAL_ENFORCEMENT.filter((x) => x.state === state)) await run(src.source, src.scope, kindOf(src), () => searchSodaEnforcement(src, name, matches));
  for (const src of LOCAL_LIVE_ENFORCEMENT[state] ?? []) await run(src.source, src.scope, kindOf(src), () => src.search(name));
  return { hits, sources };
}

/** True when the state has any state-level source at all (for the "we don't search this state yet" notes). */
export const hasLicenseSources = (state: string): boolean =>
  allLicenseSourcesFor(state).length > 0 || liveLicenseSearchesFor(state).length > 0 || allBulkSourcesFor(state).some((s) => !s.companiesOnly);

/** The category a pack's enforcement source declares (Socrata ones: what their toHit returns). */
function categoryOf(s: LiveEnforcementSearch | SodaEnforcement): string | null {
  if ("category" in s && s.category) return s.category;
  if ("toHit" in s) { try { return s.toHit({}).category; } catch { return null; } }
  return null;
}

/**
 * A pack that searches the state's court cases (a source whose records are court_case) replaces the "not searched"
 * note. Decided by the records' category, not by the word "court" in a label (WA's bond-recovery suits name a
 * court but are not a search of the state's courts; audit 2026-10-15, decision 11).
 */
export const hasStateCourtSearch = (state: string): boolean =>
  [...(pack(state)?.liveEnforcement ?? []), ...(pack(state)?.enforcement ?? [])].some((s) => categoryOf(s) === "court_case");
