/**
 * Admin access grants (/admin/access, server/access-grants.ts): a platform
 * admin gives an account one of the price book's plans for 1–1000 days with no
 * card, and can end it early. The rules both sides check live here.
 */
import { PLAN_KEYS, type PlanKey } from "./plans";

export const ACCESS_GRANT_MIN_DAYS = 1;
export const ACCESS_GRANT_MAX_DAYS = 1000;
/** The quick picks next to the days box. */
export const ACCESS_GRANT_QUICK_DAYS: readonly number[] = [7, 30, 90, 365, 1000];
export const ACCESS_GRANT_NOTE_MAX = 500;
export const ACCESS_GRANT_DAY_MS = 86_400_000;

/** A whole number of days the form may send (1–1000). */
export function validGrantDays(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && days >= ACCESS_GRANT_MIN_DAYS && days <= ACCESS_GRANT_MAX_DAYS;
}

/** When a grant of `days` made at `from` ends. */
export function grantEndsAt(days: number, from: Date | number = Date.now()): Date {
  return new Date(new Date(from).getTime() + days * ACCESS_GRANT_DAY_MS);
}

/** Whole days left before `endsAt` (0 once it has passed; a part day counts as one). */
export function grantDaysLeft(endsAt: Date | string, now: Date | number = Date.now()): number {
  const ms = new Date(endsAt).getTime() - new Date(now).getTime();
  return ms > 0 ? Math.ceil(ms / ACCESS_GRANT_DAY_MS) : 0;
}

export const GRANTABLE_PLANS: readonly PlanKey[] = PLAN_KEYS;

/**
 * Trial codes (Settings → Admin: Trial Management) run 1–1000 days too, or 0
 * for "until revoked". The length a generate request asks for: absent → the
 * old default of 2 days; 0 → unlimited; a whole number 1–1000 → that; anything
 * else → null (refused).
 */
export const TRIAL_CODE_DEFAULT_DAYS = 2;
export function trialCodeDays(raw: unknown): number | null {
  if (raw === undefined || raw === null) return TRIAL_CODE_DEFAULT_DAYS;
  if (raw === 0) return 0;
  return validGrantDays(raw) ? raw : null;
}

/** Where an account's current access comes from. */
/** "complimentary": a plan held without Stripe, a grant row or a trial code (seed, legacy or comp accounts) — it used
 *  to read "Granted" although this page never granted it (audit lane 1 N; owner 2026-10-04: as recommended). */
export type AccessSource = "stripe" | "grant" | "trial_code" | "complimentary" | "none";

export const ACCESS_SOURCE_LABELS: Record<AccessSource, string> = {
  stripe: "Paid (Stripe)",
  grant: "Granted",
  trial_code: "Trial code",
  complimentary: "Free account (no charge)",
  none: "No plan",
};

/** active: holds the account's plan now; the rest have ended. */
export type AccessGrantStatus = "active" | "expired" | "revoked" | "replaced";

export type AccessGrantRow = {
  id: number;
  userId: number;
  email: string;
  displayName: string | null;
  companyName: string | null;
  plan: PlanKey;
  planName: string;
  days: number;
  note: string | null;
  grantedBy: { id: number; email: string };
  grantedAt: string;
  endsAt: string;
  status: AccessGrantStatus;
  /** When it stopped counting (revoked, replaced, or its end date); null while active. */
  endedAt: string | null;
  /** Why it ended, in words ("Revoked by …", "Replaced by a newer grant", "Ran to its end date"). */
  endedHow: string | null;
  revokedBy: { id: number; email: string } | null;
  daysLeft: number;
};

export type AccountAccess = {
  /** The plan the account has now (legacy keys mapped), or null. */
  plan: PlanKey | null;
  planName: string | null;
  source: AccessSource;
  /** The deciding subscription row's status (null without one). */
  status: string | null;
  /** Grant / trial end, or a Stripe subscription's current period end. */
  endsAt: string | null;
  /** The live grant made on this page, when that is where the access comes from. */
  grantId: number | null;
  /** A Stripe subscription that is not over: a grant would replace a paid plan, so it is refused. */
  paidStripe: boolean;
};

export type AccessGrantAccount = {
  id: number;
  email: string;
  displayName: string | null;
  companyName: string | null;
  createdAt: string | null;
  isPlatformAdmin: boolean;
  access: AccountAccess;
};

export type AccessGrantsPayload = {
  accounts: AccessGrantAccount[];
  active: AccessGrantRow[];
  ended: AccessGrantRow[];
  maxDays: number;
};

export type AccessGrantResult = {
  grant: AccessGrantRow;
  account: AccessGrantAccount;
  /** What happened to the notice email. */
  email: "sent" | "queued" | "duplicate" | "no_address" | "failed";
  message: string;
};

export type AccessRevokeResult = {
  grant: AccessGrantRow;
  /** False when the grant had already been revoked or had ended (nothing changed). */
  changed: boolean;
  message: string;
};
