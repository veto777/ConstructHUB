/**
 * GET /api/v1/account — the key's own account: plan, limits, modules, API quota/usage, workspaces.
 * Always about the key's user (`?workspace=` does not apply here); `workspaces` lists the agency
 * workspaces the user may read with `?workspace=<ownerId>` on the other resources.
 */
import { pool } from "../../db";
import { getEntitlements } from "../../entitlements";
import { PLANS, type PlanKey } from "@shared/plans";
import { OPENAPI, dateTime, handler, nullableInt, nullableString, resource, sendItem } from "./_shared";

/**
 * Contract values for PlanLimits.apiUnitsPerMonth / apiRatePerMinute (lane 1 adds them to
 * shared/plans.ts). Read from the entitlements when present; these mirror the contract otherwise.
 */
export const API_UNITS_PER_MONTH: Record<PlanKey, number> = { starter: 0, team: 0, pro: 50_000, growth: 250_000, agency: -1 };
export const API_RATE_PER_MINUTE = 60;

export function apiAllowances(ent: { accessPlan: PlanKey | null; allowances: Record<string, unknown> | null }) {
  const a = ent.allowances as (Record<string, unknown> & { apiUnitsPerMonth?: unknown; apiRatePerMinute?: unknown }) | null;
  const fromPlan = typeof a?.apiUnitsPerMonth === "number" ? a.apiUnitsPerMonth : null;
  const unitsPerMonth = fromPlan ?? (ent.accessPlan ? API_UNITS_PER_MONTH[ent.accessPlan] : 0);
  const ratePerMinute = typeof a?.apiRatePerMinute === "number" ? a.apiRatePerMinute : API_RATE_PER_MINUTE;
  return { unitsPerMonth, ratePerMinute };
}

/** Start of next month (UTC): when the monthly API units reset. */
export function monthResetsAt(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Units and requests this month for the account and for this key, from account_api_usage (lane 1's table). */
async function usageThisMonth(userId: number, keyId: string) {
  const { rows: [t] } = await pool.query("SELECT to_regclass('public.account_api_usage') AS usage, to_regclass('public.account_api_keys') AS keys");
  const empty = { units: 0, requests: 0 };
  if (!t?.usage) return { account: empty, key: empty, keyRow: null as Record<string, any> | null };
  const [{ rows: [acct] }, { rows: [key] }] = await Promise.all([
    pool.query("SELECT coalesce(sum(units),0)::int units, coalesce(sum(requests),0)::int requests FROM account_api_usage WHERE user_id=$1 AND day >= date_trunc('month', now())::date", [userId]),
    pool.query("SELECT coalesce(sum(units),0)::int units, coalesce(sum(requests),0)::int requests FROM account_api_usage WHERE key_id=$1 AND day >= date_trunc('month', now())::date", [keyId]),
  ]);
  let keyRow: Record<string, any> | null = null;
  if (t.keys) {
    const { rows: [k] } = await pool.query(
      "SELECT id,name,prefix,suffix,scopes,monthly_unit_limit,expires_at,last_used_at,created_at FROM account_api_keys WHERE id=$1 AND user_id=$2", [keyId, userId]);
    keyRow = k ?? null;
  }
  return { account: acct ?? empty, key: key ?? empty, keyRow };
}

export const accountResource = resource("account", {
  tags: [{ name: "Account", description: "Your plan, limits and API usage." }],
  paths: {
    "/account": {
      get: {
        tags: ["Account"], summary: "Your account, plan, limits and API usage", operationId: "getAccount",
        responses: { ...OPENAPI.item("#/components/schemas/Account"), 401: OPENAPI.errors[401], 403: OPENAPI.errors[403], 429: OPENAPI.errors[429] },
      },
    },
  },
  components: { schemas: {
    ...OPENAPI.baseSchemas,
    Account: { type: "object", properties: {
      account: { type: "object", properties: { id: { type: "integer" }, email: { type: "string" }, displayName: nullableString, companyName: nullableString, createdAt: dateTime } },
      plan: { type: "object", properties: { key: nullableString, name: nullableString, storedPlan: nullableString, grantEndsAt: dateTime, isPlatformAdmin: { type: "boolean" } } },
      limits: { type: "object", nullable: true, additionalProperties: true, description: "The plan's allowances with add-ons applied (-1 = unlimited)." },
      modules: { type: "object", additionalProperties: { type: "boolean" } },
      addons: { type: "object", additionalProperties: { type: "integer" } },
      api: { type: "object", properties: {
        enabled: { type: "boolean" }, unitsPerMonth: { type: "integer" }, ratePerMinute: { type: "integer" },
        usedThisMonth: { type: "integer" }, requestsThisMonth: { type: "integer" }, remaining: { type: "integer", description: "Units left this month; -1 = unlimited." }, resetsAt: dateTime,
        key: { type: "object", nullable: true, properties: {
          id: { type: "string" }, name: nullableString, prefix: nullableString, suffix: nullableString, scopes: { type: "array", items: { type: "string" } },
          monthlyUnitLimit: nullableInt, unitsThisMonth: { type: "integer" }, requestsThisMonth: { type: "integer" }, expiresAt: dateTime, lastUsedAt: dateTime, createdAt: dateTime } },
      } },
      usage: { type: "object", properties: {
        locations: { type: "object", properties: { used: { type: "integer" }, included: nullableInt } },
        siteScans: { type: "object", properties: { usedThisMonth: { type: "integer" } } },
        reviews: { type: "object", properties: { total: { type: "integer" }, unanswered: { type: "integer" } } },
      } },
      workspaces: { type: "array", items: { type: "object", properties: {
        ownerId: { type: "integer" }, name: { type: "string" }, role: { type: "string" }, allClients: { type: "boolean" } } } },
    } },
  } },
}, (r) => {
  r.get("/", handler(async (_req, res, scope) => {
    const userId = scope.actor;
    const [ent, { rows: [user] }, { rows: [counts] }, usage, { rows: workspaces }] = await Promise.all([
      getEntitlements(userId),
      pool.query("SELECT id,email,display_name,company_name,created_at FROM users WHERE id=$1", [userId]),
      pool.query(`SELECT
          (SELECT count(*)::int FROM business_locations WHERE user_id=$1) AS locations,
          (SELECT count(*)::int FROM sitescan_jobs WHERE user_id=$1 AND created_at >= date_trunc('month', now())) AS site_scans,
          (SELECT count(*)::int FROM google_profile_reviews WHERE user_id=$1 AND NOT google_deleted) AS reviews,
          (SELECT count(*)::int FROM google_profile_reviews WHERE user_id=$1 AND NOT google_deleted AND reply_comment IS NULL) AS unanswered`, [userId]),
      usageThisMonth(userId, scope.keyId),
      pool.query(`SELECT m.user_id AS owner_id, coalesce(w.name,'Agency') AS name, m.role, m.all_clients
                    FROM agency_members m LEFT JOIN agency_workspaces w ON w.user_id=m.user_id WHERE m.member_id=$1 ORDER BY m.user_id`, [userId]),
    ]);
    const { unitsPerMonth, ratePerMinute } = apiAllowances(ent);
    const keyLimit = usage.keyRow?.monthly_unit_limit ?? null;
    // -1 = unlimited (platform admins): only a per-key cap limits what is left.
    const unlimited = unitsPerMonth === -1;
    const planLeft = unlimited ? Infinity : unitsPerMonth - usage.account.units;
    const remaining = Math.max(0, Math.min(planLeft, keyLimit == null ? Infinity : keyLimit - usage.key.units));
    sendItem(res, {
      account: user ? { id: user.id, email: user.email, displayName: user.display_name, companyName: user.company_name, createdAt: user.created_at } : null,
      plan: {
        key: ent.plan, name: ent.plan ? PLANS[ent.plan].name : null, storedPlan: ent.storedPlan,
        grantEndsAt: ent.grantEndsAt, isPlatformAdmin: ent.isPlatformAdmin,
      },
      limits: ent.allowances,
      modules: ent.modules,
      addons: ent.addons,
      api: {
        enabled: unlimited || unitsPerMonth > 0, unitsPerMonth, ratePerMinute,
        usedThisMonth: usage.account.units, requestsThisMonth: usage.account.requests,
        remaining: Number.isFinite(remaining) ? remaining : -1,
        resetsAt: monthResetsAt(),
        key: usage.keyRow ? {
          id: usage.keyRow.id, name: usage.keyRow.name, prefix: usage.keyRow.prefix, suffix: usage.keyRow.suffix,
          scopes: usage.keyRow.scopes ?? [], monthlyUnitLimit: keyLimit,
          unitsThisMonth: usage.key.units, requestsThisMonth: usage.key.requests,
          expiresAt: usage.keyRow.expires_at, lastUsedAt: usage.keyRow.last_used_at, createdAt: usage.keyRow.created_at,
        } : null,
      },
      usage: {
        locations: { used: counts?.locations ?? 0, included: ent.allowances?.locations ?? null },
        siteScans: { usedThisMonth: counts?.site_scans ?? 0 },
        reviews: { total: counts?.reviews ?? 0, unanswered: counts?.unanswered ?? 0 },
      },
      workspaces: workspaces.map((w) => ({ ownerId: w.owner_id, name: w.name, role: w.role, allClients: w.all_clients })),
    });
  }));
});
