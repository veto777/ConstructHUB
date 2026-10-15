/**
 * A state pack: everything the research bot searches in one state beyond the original WA/TX/FL/CA tables. Each
 * state lives in its own file (./<st>.ts) so the sources of one state can be added or fixed without touching
 * another's. ../registry.ts merges the packs with the original tables.
 *
 * The rules (CLAUDE.md: never fabricate government data):
 *   - Every source here was opened and searched live on the date in `checked` (and the source's own comment).
 *   - Field names, status codes and their meanings are the publisher's own, never guessed.
 *   - A value the source doesn't give is null. A row the source can't name is skipped.
 *   - Enforcement, complaints and court records are searched for companies only (FCRA).
 *   - No CAPTCHA, login wall or 403 is ever worked around; such a source is listed in `blocked` instead.
 */
import type { EnforcementHit, LicenseHit } from "@shared/research-reports";
import type { LicenseSource } from "../licenses";
import type { BulkSource } from "../bulk";
import type { IdQuery } from "../identifiers";
import type { SodaEnforcement } from "../state-records";
import type { ComplaintSource } from "../records";

/** A license search that isn't a Socrata dataset (a state's own lookup form or API), run live per report. */
export type LiveLicenseSearch = {
  source: string;
  /** The official page a reader can open. */
  sourceUrl: string;
  search: (name: string, kind: "person" | "company") => Promise<LicenseHit[]>;
  /** Search by license number, phone or address, when the lookup offers it (the cross-reference pass uses it). */
  searchBy?: (q: IdQuery) => Promise<LicenseHit[]>;
};

/** An enforcement, standing or court search that isn't a Socrata dataset, run live per report (companies only). */
export type LiveEnforcementSearch = {
  source: string;
  scope: string;
  search: (name: string) => Promise<EnforcementHit[]>;
};

export type StatePack = {
  state: string;
  /** The date this pack's sources were last checked live (YYYY-MM-DD); "" for a state with nothing yet. */
  checked: string;
  /** Socrata license datasets (searched like ../licenses.ts). */
  licenses?: LicenseSource[];
  /** Other live license searches. */
  liveLicenses?: LiveLicenseSearch[];
  /** Bulk files, downloaded on a schedule and indexed (../bulk.ts). License files and enforcement files alike. */
  bulk?: BulkSource[];
  /** Socrata enforcement / standing datasets (../state-records.ts SodaEnforcement). */
  enforcement?: SodaEnforcement[];
  /** Other live enforcement, standing or court searches. */
  liveEnforcement?: LiveEnforcementSearch[];
  /** Attorney-general (or similar) consumer complaints as open data (../records.ts ComplaintSource). */
  complaints?: ComplaintSource[];
  /** Said in the report when the state has no statewide general-contractor license, instead of "no license found". */
  noStatewideGcLicense?: string;
  /** Sources looked at and not usable (CAPTCHA, login, paid, no name search, no data): for the next person, not shown. */
  blocked?: string[];
};
