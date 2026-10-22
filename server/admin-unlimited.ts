/**
 * Owner order (2026-10-22): everything is infinite for a platform admin
 * (server/admin.ts). Plan gates, monthly quotas and count limits are lifted
 * centrally in server/entitlements.ts (platformAdminAllowances) and
 * server/crm/entitlements.ts (adminCrmLimits); this module lifts the per-account
 * request budgets — the growth_budgets windows routes take for one user
 * (takeAccountBudget) and rateLimit()'s per-user/IP windows.
 *
 * Budgets that protect someone other than the admin are NOT routed through
 * here and stay as they are for everybody: sign-in / 2FA attempt limits,
 * email to third parties (checklists, report sends and confirmations, agency
 * invitations and reminders), whole-platform budgets shared by every account
 * (e.g. sitescan:psi:global, sitescan:ai-global, hub:global:d, support:ai:all)
 * and external providers' own hard quotas (Search Console inspections per
 * property, the Google Ads developer-token queue, registrar and Gmail APIs).
 */
import { pool } from "./db";
import { isPlatformAdminEmail } from "./admin";

const TTL_MS = 60_000;
const cache = new Map<number, { at: number; admin: boolean }>();

/** Is this account a platform admin? One indexed lookup, cached for a minute; false for no id or an unknown user. */
export async function isPlatformAdminUserId(userId: number | null | undefined): Promise<boolean> {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.admin;
  let admin: boolean;
  try {
    const result = await pool.query("SELECT email FROM users WHERE id=$1", [id]);
    const email: unknown = result?.rows?.[0]?.email;
    admin = isPlatformAdminEmail(typeof email === "string" ? email : null) === true;
  } catch {
    // Can't tell: fail closed (the account keeps its limits) and ask again next time.
    return false;
  }
  cache.set(id, { at: Date.now(), admin });
  return admin;
}

/** Tests only: forget the cached answers. */
export function forgetPlatformAdminIds() {
  cache.clear();
}

/**
 * A fixed per-account count cap (sites, lists, watches, keys...): -1 —
 * unlimited — for a platform admin, `max` for everyone else. Responses that
 * tell the client the cap send this value too, so the client reads -1 the way
 * it reads every other unlimited allowance.
 */
export async function countCap(userId: number | null | undefined, max: number): Promise<number> {
  return (await isPlatformAdminUserId(userId)) ? -1 : max;
}

/** Is a count of `n` at or past a cap from countCap? Never for -1. */
export const atCap = (cap: number, n: number): boolean => cap >= 0 && n >= cap;
/** Would a total of `n` go past a cap from countCap? Never for -1. */
export const overCap = (cap: number, n: number): boolean => cap >= 0 && n > cap;
