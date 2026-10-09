/**
 * The referral program's rules — pure, so the vitest covers every money decision (owner, 2026-10-08):
 *
 *   A referred NEW signup who pays for 3 months → the referrer gets one free month, like for like.
 *   A referred NEW signup who pays a 1-year plan in full → the referrer gets 30% off their own 1-year
 *   subscription, like for like, redeemable at most once a year.
 *
 * "Like for like" = same product line (platform tier for platform tier, CRM tier for CRM tier) and the value of the
 * referred tier, never more than the referrer's own tier in that line (a Starter referral is worth a Starter month,
 * even to an Agency referrer; an Agency referral is worth at most the referrer's own Starter month).
 * Every amount comes from the price book (shared/plans.ts, shared/crm-plans.ts) — nothing the client sends.
 */
import { PLANS, isPlanKey, type BillingInterval, type PlanKey } from "@shared/plans";
import { CRM_PLANS, isCrmPlanKey, type CrmPlanKey } from "@shared/crm-plans";

export type Product = "platform" | "crm";
export type Tier = PlanKey | CrmPlanKey;
export type RewardKind = "month" | "annual30";

/** Days a qualifying payment must stand (refund / chargeback window) before the reward is earned. */
export const HOLD_DAYS = 14;
/** Paid monthly invoices that qualify a referral for the free month. */
export const MONTHS_TO_QUALIFY = 3;
/** The annual reward's share of the annual price. */
export const ANNUAL_SHARE = 0.3;
/** At most one annual reward is redeemed per this many days, per referrer. */
export const ANNUAL_REDEEM_EVERY_DAYS = 365;
const DAY = 86_400_000;

/** Free-mail providers: two strangers on gmail.com are not "the same company". */
export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com",
  "privaterelay.appleid.com",
]);

const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

/** Why a referral may never pay, or null. Checked when the account is created. */
export function blockReason(referrer: { id: number; email: string }, referred: { id: number; email: string }): string | null {
  if (referrer.id === referred.id) return "self";
  if (referrer.email.trim().toLowerCase() === referred.email.trim().toLowerCase()) return "self";
  const d = domainOf(referred.email);
  if (d && d === domainOf(referrer.email) && !FREE_MAIL.has(d)) return "same_company_domain";
  return null;
}

export function validTier(product: Product, tier: string | null | undefined): tier is Tier {
  return product === "platform" ? isPlanKey(tier) : isCrmPlanKey(tier);
}

/** A tier's list price for an interval, from the price book. */
export function priceCents(product: Product, tier: Tier, interval: BillingInterval): number {
  const p: { monthlyCents: number; annualCents: number } = product === "platform" ? PLANS[tier as PlanKey] : CRM_PLANS[tier as CrmPlanKey];
  return interval === "year" ? p.annualCents : p.monthlyCents;
}

/** One paid subscription invoice of the referred account, as the program counts it. */
export type CountedInvoice = {
  product: Product;
  tier: Tier;
  interval: BillingInterval;
  amountPaid: number;
  /** Anything left to pay on it (an annual plan is "paid in full" only at 0). */
  amountRemaining: number;
  refunded: boolean;
  paidAt: Date;
};

export type Qualification = { kind: RewardKind; product: Product; tier: Tier; qualifiedAt: Date; earnAt: Date };

/**
 * Does the referred account qualify, and for which ONE reward? An annual plan paid in full → annual30 (it wins:
 * it is checked first). Otherwise the third paid, unrefunded monthly invoice → month, valued at the tier of that
 * third invoice. A refunded invoice never counts; $0 invoices (the trial) never count.
 */
export function qualify(invoices: CountedInvoice[]): Qualification | null {
  const good = invoices.filter((i) => !i.refunded && i.amountPaid > 0).sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
  const annual = good.find((i) => i.interval === "year" && i.amountRemaining === 0);
  if (annual) return { kind: "annual30", product: annual.product, tier: annual.tier, qualifiedAt: annual.paidAt, earnAt: new Date(annual.paidAt.getTime() + HOLD_DAYS * DAY) };
  const monthly = good.filter((i) => i.interval === "month");
  if (monthly.length >= MONTHS_TO_QUALIFY) {
    const third = monthly[MONTHS_TO_QUALIFY - 1];
    return { kind: "month", product: third.product, tier: third.tier, qualifiedAt: third.paidAt, earnAt: new Date(third.paidAt.getTime() + HOLD_DAYS * DAY) };
  }
  return null;
}

/**
 * The reward's value, like for like: the referred tier's price, capped at the referrer's own tier in the same
 * product line. null = the referrer has no plan in that line yet (the reward waits until they do).
 *   month    → one month of min(referred, referrer) monthly price
 *   annual30 → 30% of min(referred, referrer) annual price, rounded to the cent
 */
export function rewardAmountCents(kind: RewardKind, product: Product, referredTier: Tier, referrerTier: Tier | null): number | null {
  if (!referrerTier || !validTier(product, referrerTier) || !validTier(product, referredTier)) return null;
  const interval: BillingInterval = kind === "month" ? "month" : "year";
  const base = Math.min(priceCents(product, referredTier, interval), priceCents(product, referrerTier, interval));
  return kind === "month" ? base : Math.round(base * ANNUAL_SHARE);
}

/** May this referrer redeem an annual reward now? (once per ANNUAL_REDEEM_EVERY_DAYS) */
export function annualRedeemable(lastAnnualAppliedAt: Date | null, now: Date): boolean {
  return !lastAnnualAppliedAt || now.getTime() - lastAnnualAppliedAt.getTime() >= ANNUAL_REDEEM_EVERY_DAYS * DAY;
}

/** Share-code alphabet: no 0/O/1/I/L, so a code read aloud or retyped survives. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
export function normalizeCode(raw: unknown): string | null {
  const c = String(raw ?? "").trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}
