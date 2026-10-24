/**
 * Reputation plan prices. Kept on the server so they never ship in the public pages code: the owners rule
 * (2026-10-24) is that these prices are not public — buyers get them on a sales call and in the proposal
 * template "Reputation Restoration — ConstructHUB", which was built from these numbers.
 */
import { REP_TERM_MONTHS } from "@shared/reputation";

export const REP_PLAN_MONTHLY_CENTS = { foundation: 150_000, restore: 250_000, "restore-pro": 350_000, total: 500_000 } as const;
export const REP_PREPAY_DISCOUNT = 0.1;
export const annualCents = (monthly: number) => Math.round(monthly * REP_TERM_MONTHS * (1 - REP_PREPAY_DISCOUNT));
