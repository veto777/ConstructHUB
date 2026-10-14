/**
 * Compliance Dept (owner, 2026-10-14): for every state, the agencies that do what Washington's Department of Labor &
 * Industries does for construction (contractor licensing, trade licensing, electrical permits), with their official
 * lookup pages. Researched state by state (Codex + Kimi, cross-checked) and every URL checked live before it is
 * listed (CLAUDE.md link policy: a URL that failed its check is null, never guessed).
 */
import data from "./state-agencies.json";

export type ComplianceRole =
  | "contractor_license" | "electrical_license" | "electrical_permits" | "plumbing_license" | "hvac_license"
  | "low_voltage_license" | "alarm_security_license" | "permits_other";

export const ROLE_LABELS: Record<ComplianceRole, string> = {
  contractor_license: "Contractor licensing",
  electrical_license: "Electrical licensing",
  electrical_permits: "Electrical permits & inspections",
  plumbing_license: "Plumbing licensing",
  hvac_license: "HVAC / mechanical licensing",
  low_voltage_license: "Low-voltage licensing",
  alarm_security_license: "Alarm & security licensing",
  permits_other: "Other state permits",
};

export type ComplianceAgency = {
  name: string; acronym: string | null; roles: ComplianceRole[];
  website: string | null; licenseLookupUrl: string | null; permitLookupUrl: string | null; openDataUrl: string | null;
  phone: string | null; notes: string;
};

export type ElectricalIssuer = "state" | "state_where_no_local" | "local_only" | "mixed";
export const ELECTRICAL_ISSUER_LABELS: Record<ElectricalIssuer, string> = {
  state: "The state issues electrical permits statewide",
  state_where_no_local: "The state issues them where the city or county doesn't",
  local_only: "Cities and counties issue electrical permits",
  mixed: "Split between the state and local governments",
};

export type StateCompliance = {
  state: string; stateName: string; summary: string;
  electricalPermits: { issuer: ElectricalIssuer; program: string | null; permitLookupUrl: string | null; notes: string };
  agencies: ComplianceAgency[];
  /** Links on official sites whose security check blocks automated visits: listed, but marked as not auto-checked. */
  unconfirmedUrls: string[];
  /** When every URL in this entry was last checked live (ISO date). */
  checkedAt: string;
};

export const STATE_COMPLIANCE = data as unknown as StateCompliance[];
export const complianceFor = (state: string) => STATE_COMPLIANCE.find((s) => s.state === state);
