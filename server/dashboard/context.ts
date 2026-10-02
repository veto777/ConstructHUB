/**
 * The per-request context every tile reads (SPEC §3.1): computed once, shared.
 * The shared lookups are lazy and memoised — a tile that needs this month's
 * usage or the user's tracked sites asks for them, and the first ask runs the
 * query for every tile. A locked tile never asks, so it reads no feature data.
 */
import type { Entitlements } from "../entitlements";
import { locationCount } from "../entitlements";
import { monthlyUsage } from "../growth-quotas";
import type { OrgContext } from "../crm/tenancy";
import { dashboardPool, dq } from "./pool";

export type MonthlyUsage = Awaited<ReturnType<typeof monthlyUsage>>;

export type DashboardContext = {
  userId: number;
  now: Date;
  ent: Entitlements;
  /** The active CRM org (read-only lookup), or null when the user has none. */
  crm: OrgContext | null;
  /** This month's metered use (growth_budgets), keyed by meter. */
  usage: () => Promise<MonthlyUsage>;
  /** Locations the account holds (locationCount). */
  locations: () => Promise<number>;
  /** Ids of the user's Click Guard sites (tracked_domains); visit tables have no user_id. */
  trackedDomainIds: () => Promise<number[]>;
};

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

export function makeContext(userId: number, ent: Entitlements, crm: OrgContext | null, now = new Date()): DashboardContext {
  return {
    userId, now, ent, crm,
    usage: once(() => monthlyUsage(userId, ent)),
    locations: once(() => locationCount(userId, dashboardPool())),
    trackedDomainIds: once(async () =>
      (await dq<{ id: number }>("SELECT id FROM tracked_domains WHERE user_id=$1 ORDER BY id", [userId])).map((r) => r.id)),
  };
}
