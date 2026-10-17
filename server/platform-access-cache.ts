/**
 * The per-account "has anything on the platform" answer the API paywall keeps
 * (server/platform-access.ts), cached for PLATFORM_ACCESS_TTL_MS. No imports on
 * purpose: billing code that changes an account's access (the Stripe webhook,
 * admin grants, trial codes, à la carte, the Call Assistant and CRM billing)
 * calls forgetPlatformAccess without pulling in the entitlements graph.
 */
export const PLATFORM_ACCESS_TTL_MS = 30_000;

const cache = new Map<number, { at: number; has: boolean }>();

/** The cached answer while it is fresh, else undefined. */
export function cachedPlatformAccess(userId: number, now = Date.now()): boolean | undefined {
  const hit = cache.get(userId);
  if (!hit) return undefined;
  if (now - hit.at >= PLATFORM_ACCESS_TTL_MS) {
    cache.delete(userId);
    return undefined;
  }
  return hit.has;
}

export function rememberPlatformAccess(userId: number, has: boolean, now = Date.now()): void {
  // Bounded: a flood of distinct sessions can't grow it without limit.
  if (cache.size >= 50_000) cache.clear();
  cache.set(userId, { at: now, has });
}

/** Forget one account's answer (or every answer): the next request decides again. */
export function forgetPlatformAccess(userId?: number | null): void {
  if (typeof userId === "number" && Number.isFinite(userId)) cache.delete(userId);
  else if (userId === undefined) cache.clear();
}
