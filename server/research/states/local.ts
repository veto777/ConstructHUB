/**
 * City and county contractor licenses and registrations (NYC DOB, Chicago, Philadelphia L&I, …), searched in
 * the reports of the state they're in. Same rules and checks as a state pack (./types.ts).
 */
import type { LicenseSource } from "../licenses";
import type { BulkSource } from "../bulk";
import type { LiveLicenseSearch } from "./types";

/** Socrata datasets; `state` is the state the city or county is in. */
export const LOCAL_LICENSES: LicenseSource[] = [];
/** Bulk files; `state` is the state the city or county is in. */
export const LOCAL_BULK: BulkSource[] = [];
/** Other live lookups, by state. */
export const LOCAL_LIVE: Record<string, LiveLicenseSearch[]> = {};
