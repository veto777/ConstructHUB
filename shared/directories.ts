export const DIRECTORY_STATUSES = [
  "queued",
  "submitted",
  "needs_owner_action",
  "live",
  "mismatch",
  "duplicate",
  "suppressed",
  "failed",
] as const;
export const DIRECTORY_CATEGORIES = [
  "general",
  "maps_nav",
  "social",
  "contractor",
  "trade_assoc",
  "manufacturer",
  "state_local",
  "ai",
] as const;
export const DIRECTORY_KINDS = [
  "api",
  "aggregator",
  "partner",
  "submission",
] as const;
export const DIRECTORY_LABELS: Record<string, string> = {
  queued: "Waiting to check",
  submitted: "Submitted",
  needs_owner_action: "Needs your action",
  live: "Live",
  mismatch: "Details differ",
  duplicate: "Duplicate",
  suppressed: "Suppressed",
  failed: "Check failed",
  general: "General",
  maps_nav: "Maps & navigation",
  social: "Social",
  contractor: "Contractors",
  trade_assoc: "Trade associations",
  manufacturer: "Manufacturers",
  state_local: "State & local",
  ai: "AI services",
  api: "Direct API",
  aggregator: "Data aggregator",
  partner: "Distribution partner",
  submission: "Submission",
};
export const TIER_LABELS: Record<string, string> = {
  1: "Direct services",
  2: "Data aggregators",
  3: "Distribution partners",
  4: "Contractor & local directories",
};
export type CatalogueDirectory = Directory & {
  dr: number | null;
  grade: string | null;
  link_status: "verified" | "unconfirmed" | null;
};
export type CataloguePage = { rows: CatalogueDirectory[]; total: number };
export type CatalogueFacets = Record<string, Record<string, number>>;

export type Directory = {
  id: number;
  name: string;
  domain: string | null;
  kind: string;
  tier: number;
  category: string;
  trades: string[] | null;
  states: string[] | null;
  requires_street_address: boolean | null;
  requires_phone_verification: boolean | null;
  requires_postcard: boolean | null;
  paid: boolean | null;
  active: boolean;
  source: string;
  notes: string | null;
};
export type DirectoryCounts = {
  total: number;
  live: number;
  mismatch: number;
  billable: number;
};
export type DirectorySummary = DirectoryCounts & {
  by_tier: Record<string, DirectoryCounts>;
  by_category: Record<string, DirectoryCounts>;
};
export type DirectoryProfileRow = {
  id: number;
  profile_id: number;
  location_id: number;
  user_id: number;
  directory_id: number;
  directory_name: string;
  status: string;
  listing_url: string | null;
  last_checked_at: string | null;
  billable: boolean;
  nap_result: {
    matches: boolean;
    fields: Record<
      string,
      {
        result: string;
        expected: string | null;
        observed: string | null;
        required: boolean;
      }
    >;
  } | null;
  evidence: { reason: string | null } | null;
};
export type BusinessProfile = Record<string, unknown> & {
  id: number;
  location_id: number;
  user_id: number;
  name: string | null;
  owner_edited_fields: string[];
  revision: number;
};
export type DirectoryEvent = {
  id: string;
  type: string;
  at: string;
  listing_id: number | null;
  detail: {
    fields?: string[];
    status?: string;
    evidence?: { reason?: string | null };
  } | null;
};
