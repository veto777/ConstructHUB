/**
 * The 60 s per-user dashboard cache (SPEC §3.3). In memory, keyed
 * `${userId}:${activeOrgId ?? "-"}` because a session's pinned CRM org changes
 * the CRM numbers. At most DASHBOARD_CACHE_MAX entries (oldest evicted).
 * `?fresh=1` (the Refresh button) bypasses it at most once every
 * FRESH_THROTTLE_MS per user; sooner asks get the cached answer.
 *
 * A change to what the account may see (plan change, Stripe webhook, trial
 * code, a CRM seat disabled) calls forgetDashboard(userId), so the next load
 * is rebuilt instead of showing the old plan and locks for up to a minute.
 */
import { DASHBOARD_CACHE_MS, type DashboardPayload } from "@shared/dashboard";

export const DASHBOARD_CACHE_MAX = 5_000;
export const FRESH_THROTTLE_MS = 10_000;

export type DashboardCache = ReturnType<typeof createDashboardCache>;

export function createDashboardCache(opts: { ttlMs?: number; max?: number; freshThrottleMs?: number; clock?: () => number } = {}) {
  const ttl = opts.ttlMs ?? DASHBOARD_CACHE_MS;
  const max = opts.max ?? DASHBOARD_CACHE_MAX;
  const throttle = opts.freshThrottleMs ?? FRESH_THROTTLE_MS;
  const clock = opts.clock ?? Date.now;
  const entries = new Map<string, { at: number; payload: DashboardPayload }>();
  const lastFresh = new Map<number, number>();
  /** When each user's entries were last forgotten: a build that started earlier is not stored. */
  const clearedAt = new Map<number, number>();

  const keyOf = (userId: number, activeOrgId?: string | null) => `${userId}:${activeOrgId || "-"}`;

  return {
    keyOf,
    /** The cached answer for this key while it is younger than the TTL. */
    get(userId: number, activeOrgId?: string | null): DashboardPayload | null {
      const key = keyOf(userId, activeOrgId);
      const hit = entries.get(key);
      if (!hit) return null;
      if (clock() - hit.at >= ttl) { entries.delete(key); return null; }
      return hit.payload;
    },
    set(userId: number, activeOrgId: string | null | undefined, payload: DashboardPayload): void {
      // Built before a forget (a plan change landed mid-build): answer it, never keep it.
      const cleared = clearedAt.get(userId);
      if (cleared !== undefined && Date.parse(payload.generatedAt) < cleared) return;
      const key = keyOf(userId, activeOrgId);
      entries.delete(key); // re-insert at the end: Map order is insertion order
      entries.set(key, { at: clock(), payload });
      while (entries.size > max) entries.delete(entries.keys().next().value!);
    },
    /**
     * May this user skip the cache now? True at most once per throttle window
     * (and records the use); false means "answer from the cache".
     */
    allowFresh(userId: number): boolean {
      const now = clock();
      const last = lastFresh.get(userId);
      if (last !== undefined && now - last < throttle) return false;
      lastFresh.set(userId, now);
      if (lastFresh.size > max) lastFresh.delete(lastFresh.keys().next().value!);
      return true;
    },
    /** Drop every entry of this user (every pinned org): the next load rebuilds. */
    clearUser(userId: number): void {
      const prefix = `${userId}:`;
      for (const key of Array.from(entries.keys())) if (key.startsWith(prefix)) entries.delete(key);
      clearedAt.delete(userId);
      clearedAt.set(userId, clock());
      if (clearedAt.size > max) clearedAt.delete(clearedAt.keys().next().value!);
    },
    clear(): void { entries.clear(); lastFresh.clear(); clearedAt.clear(); },
    get size() { return entries.size; },
  };
}

/** The process-wide cache GET /api/dashboard answers from. */
export const dashboardCache = createDashboardCache();

/**
 * Forget a user's cached dashboard. Safe to call from any write path (billing,
 * trial codes, CRM team changes): it imports nothing else and never throws.
 */
export function forgetDashboard(userId: number | null | undefined): void {
  if (typeof userId === "number" && Number.isFinite(userId)) dashboardCache.clearUser(userId);
}
