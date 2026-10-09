/**
 * CRM tenancy: orgs, membership resolution, permission and seat enforcement.
 *
 * The rest of ConstructHUB scopes rows by user_id. The CRM cannot: a
 * construction company has crews, and the owner, office staff and field techs
 * must all see the same jobs. So CRM rows are scoped by org_id, and this module
 * is the bridge between an authenticated user and their active org.
 *
 * Every CRM route must go through requireOrg() — never trust an org id from the
 * request body.
 */
import type { PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { db, pool } from "../db";
import * as schema from "@shared/schema";
import { crmOrgs, crmMembers, users, crmEffectivePermissions } from "@shared/schema";
import type { CrmPermission } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorizeObjectRequest } from "./object-access";
import { PLANS, ADDONS, type AddonKey, type PlanKey } from "@shared/plans";
import { getEntitlements, raiseHint, cheapestPlanWhere, plural, inUse, type Entitlements } from "../entitlements";
import { getCrmEntitlements, crmPlanRequiredBody } from "./entitlements";
import { CRM_PLANS, cheapestCrmPlanWhere, CRM_EXTRA_SEAT_MONTHLY_CENTS, type CrmPlanKey } from "@shared/crm-plans";

export type OrgContext = {
  org: typeof crmOrgs.$inferSelect;
  member: typeof crmMembers.$inferSelect;
  permissions: Record<CrmPermission, boolean>;
};

/**
 * Get-or-create the caller's org.
 *
 * Existing ConstructHUB accounts predate the CRM, so on first CRM access we
 * create a personal org seeded from the user's existing company fields and make
 * them its owner. This keeps the migration invisible — nobody has to "set up a
 * company" before the CRM works.
 */
export async function ensureOrgForUser(userId: number): Promise<OrgContext> {
  // Without a pinned org the default must be STABLE: an unordered LIMIT 1 lets
  // Postgres hand back either membership, and the active org then flips
  // randomly between requests. Oldest membership wins.
  const existing = await db
    .select()
    .from(crmMembers)
    .where(and(eq(crmMembers.userId, userId), eq(crmMembers.status, "active")))
    .orderBy(asc(crmMembers.createdAt))
    .limit(1);

  if (existing.length) {
    const member = existing[0];
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, member.orgId)).limit(1);
    if (org) {
      return { org, member, permissions: crmEffectivePermissions(member.role, member.permissions) };
    }
    // Membership pointing at a deleted org — fall through and rebuild.
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const name = user?.companyName?.trim() || user?.displayName?.trim() || user?.email || "My Company";

  const [org] = await db
    .insert(crmOrgs)
    .values({
      name,
      ownerUserId: userId,
      email: user?.email ?? null,
      logoUrl: user?.companyLogoUrl ?? null,
    })
    .returning();

  const [member] = await db
    .insert(crmMembers)
    .values({
      orgId: org.id,
      userId,
      email: user?.email ?? `user-${userId}@local`,
      role: "owner",
      status: "active",
      displayName: user?.displayName ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    })
    .returning();

  return { org, member, permissions: crmEffectivePermissions(member.role, member.permissions) };
}

/** All orgs the user is an active member of (for the org switcher). */
export async function listOrgsForUser(userId: number) {
  const rows = await db
    .select({
      id: crmOrgs.id,
      name: crmOrgs.name,
      logoUrl: crmOrgs.logoUrl,
      role: crmMembers.role,
      memberId: crmMembers.id,
    })
    .from(crmMembers)
    .innerJoin(crmOrgs, eq(crmOrgs.id, crmMembers.orgId))
    .where(and(eq(crmMembers.userId, userId), eq(crmMembers.status, "active")));
  return rows;
}

/**
 * Resolve the active org for this request.
 *
 * Preference order: the org pinned in the session (if the user is still an
 * active member of it) → their first membership → a freshly created personal
 * org. Responds 401/403 and returns null when it cannot.
 */
export async function requireOrg(req: any, res: any, userId: number): Promise<OrgContext | null> {
  const ctx = await resolveOrg(req, res, userId);
  if (!ctx || !await authorizeObjectRequest(req, res, ctx)) return null;
  if (!await crmPlanOk(req, res, ctx)) return null;
  return ctx;
}

/**
 * The CRM is a separate product (shared/crm-plans.ts): every staff route runs
 * on the ORG OWNER's CRM plan — a team member rides the owner's subscription.
 * Without one the route answers 402 crm_plan_required and the app shows the
 * CRM plans. /api/crm/me and the billing routes stay open so the app can boot,
 * say why, and sell the plan. Beta accounts and ConstructHUB staff pass
 * (getCrmEntitlements). CRM_REQUIRE_PLAN=0 switches the gate off (the demo).
 */
// The AI Call Assistant's routes (/api/crm/voice/*) are a separate service with its own subscription
// (owner, 2026-10-08): they gate on THAT subscription (server/voice/context.ts voiceContext), never on a
// CRM plan, so a Call Assistant customer without the CRM can run their assistant.
const CRM_OPEN_PATHS = [/^\/api\/crm\/me(\/|$)/, /^\/api\/crm\/billing(\/|$)/, /^\/api\/crm\/orgs(\/|$)/, /^\/api\/crm\/voice(\/|$)/];
async function crmPlanOk(req: any, res: any, ctx: OrgContext): Promise<boolean> {
  if (process.env.CRM_REQUIRE_PLAN === "0") return true;
  const path = String(req?.originalUrl || req?.path || "").split("?")[0];
  if (CRM_OPEN_PATHS.some((re) => re.test(path))) return true;
  const crm = await getCrmEntitlements(ctx.org.ownerUserId);
  if (crm.active) return true;
  res.status(402).json(crmPlanRequiredBody());
  return false;
}

async function resolveOrg(req: any, res: any, userId: number): Promise<OrgContext | null> {
  const pinned: string | undefined = req.session?.activeOrgId;

  if (pinned) {
    const rows = await db
      .select()
      .from(crmMembers)
      .where(
        and(
          eq(crmMembers.orgId, pinned),
          eq(crmMembers.userId, userId),
          eq(crmMembers.status, "active"),
        ),
      )
      .limit(1);
    if (rows.length) {
      const member = rows[0];
      const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, pinned)).limit(1);
      if (org) {
        return { org, member, permissions: crmEffectivePermissions(member.role, member.permissions) };
      }
    }
    // Stale pin (membership revoked or org gone) — drop it and fall through.
    if (req.session) delete req.session.activeOrgId;
  }

  try {
    return await ensureOrgForUser(userId);
  } catch (e: any) {
    console.error("[crm] requireOrg failed:", e?.message || e);
    res.status(500).json({ message: "Could not resolve organization" });
    return null;
  }
}

/** Guard a route on a specific permission. Responds 403 and returns false if denied. */
export function requirePermission(res: any, ctx: OrgContext, perm: CrmPermission): boolean {
  if (ctx.permissions[perm]) return true;
  res.status(403).json({ message: `Requires permission: ${perm}` });
  return false;
}

/** Guard a route on holding at least one of several permissions. Responds 403 and returns false if none is held. */
export function requireAnyPermission(res: any, ctx: OrgContext, perms: readonly CrmPermission[]): boolean {
  if (perms.some((p) => ctx.permissions[p])) return true;
  res.status(403).json({ message: `Requires permission: ${perms.join(" or ")}` });
  return false;
}

/**
 * The one money redactor. A price-blind seat ("See prices" off) never receives
 * the `price` keys, a cost-blind seat ("See costs and margins" off) never
 * receives the `cost` keys: the keys are ABSENT from the JSON, not zeroed, so
 * a page shows "hidden" rather than "$0.00". Every route that returns a row
 * carrying money to a seat that may lack either permission goes through this
 * (or through a presenter built on the same two flags) instead of testing the
 * flags by hand.
 */
export function stripMoney<T extends Record<string, any>>(
  ctx: OrgContext, row: T, keys: { price?: readonly string[]; cost?: readonly string[] },
): T {
  const out: Record<string, any> = { ...row };
  if (!ctx.permissions.seePrices) for (const k of keys.price ?? []) delete out[k];
  if (!ctx.permissions.seeCosts) for (const k of keys.cost ?? []) delete out[k];
  return out as T;
}

/**
 * Whether `ctx` may hand `role` (with `overrides`) to someone else. Owners and
 * admins hand out any role below owner, as before. A delegate who only holds
 * "Manage team and invitations" through a per-person override may not create a
 * seat more powerful than their own: every permission the new role or override
 * switches ON must be one the delegate holds. Returns the first permission
 * they lack, or null when the grant is allowed.
 */
export function grantExceedsOwn(ctx: OrgContext, role: string, overrides: unknown): CrmPermission | null {
  if (ctx.member.role === "owner" || ctx.member.role === "admin") return null;
  const granted = crmEffectivePermissions(role, overrides);
  for (const p of Object.keys(granted) as CrmPermission[]) {
    if (granted[p] && !ctx.permissions[p]) return p;
  }
  return null;
}

/**
 * Guard a route on the OWNER role itself. Hard deletes (test-document cleanup)
 * are owner-only — never a permission flag, so no admin/pm seat override can
 * ever grant them. Responds 403 and returns false for every other role.
 */
export function requireOwnerRole(res: any, ctx: OrgContext): boolean {
  if (ctx.member.role === "owner") return true;
  res.status(403).json({ message: "Only the account owner can delete records." });
  return false;
}

/**
 * Seat limit for an org, derived from the OWNER's subscription plan.
 *
 * Housecall Pro's seat cliff (extra logins are MAX-only, so hiring a 6th person
 * forces a 101% price jump) is the single most-complained-about thing in their
 * review corpus. We enforce a limit but never block hiring silently — the API
 * returns the numbers so the UI can say exactly what is needed.
 */
export async function getSeatUsage(org: typeof crmOrgs.$inferSelect, adding?: { userId?: number | null; email?: string | null }, lock?: SeatLock) {
  return getOwnerSeatUsage(org.ownerUserId, { adding, client: lock?.client, ent: lock?.ent });
}

/** Runs SQL: the pool, or the connection holding the seat lock (withSeatLock). */
type Sql = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * The people holding seats on an owner's plan, one entry per person: members
 * (active or invited) of every CRM org the owner owns, plus — while the plan
 * includes the Agency workspace — the owner and their agency team. Seats are
 * one pool: the plan's crmSeats plus Extra seat add-ons ("One more CRM or
 * agency team seat"), so someone on both teams holds one seat. An invitation
 * not yet accepted counts by the account its email belongs to, else the email.
 */
async function seatHolders(q: Sql, ownerUserId: number, withAgencyTeam: boolean): Promise<Set<string>> {
  const { rows: crm } = await q.query(
    `SELECT COALESCE('u:' || COALESCE(m.user_id, (SELECT u.id FROM users u WHERE lower(u.email)=lower(m.email) ORDER BY u.id LIMIT 1)),
                     'e:' || lower(m.email)) AS who
       FROM crm_members m JOIN crm_orgs o ON o.id=m.org_id
      WHERE o.owner_user_id=$1 AND m.status IN ('active','invited')`,
    [ownerUserId],
  );
  const holders = new Set<string>(crm.map((r: { who: string }) => r.who));
  if (withAgencyTeam) {
    holders.add(`u:${ownerUserId}`);
    const { rows: team } = await q.query("SELECT member_id FROM agency_members WHERE user_id=$1", [ownerUserId]);
    for (const r of team) holders.add(`u:${r.member_id}`);
  }
  return holders;
}

/** A person's seat identity: their account when one exists, else the invited email. */
async function seatIdentity(q: Sql, person: { userId?: number | null; email?: string | null }): Promise<string | null> {
  if (person.userId) return `u:${person.userId}`;
  const email = person.email?.trim().toLowerCase();
  if (!email) return null;
  const { rows: [u] } = await q.query("SELECT id FROM users WHERE lower(email)=$1 ORDER BY id LIMIT 1", [email]);
  return u ? `u:${u.id}` : `e:${email}`;
}

/**
 * Seat usage on an owner's plan; the CRM team and the Agency team share it.
 * `adding` asks about one more person (by account id or email): `canAdd` says
 * whether they can join, which is always true for someone who already holds a
 * seat on the other team. Under the seat lock, pass its `client` and `ent`
 * so every query runs on the connection holding the lock.
 */
export async function getOwnerSeatUsage(
  ownerUserId: number,
  opts: { adding?: { userId?: number | null; email?: string | null }; client?: Sql; ent?: Entitlements } = {},
) {
  const q: Sql = opts.client ?? pool;
  const ent = opts.ent ?? await getEntitlements(ownerUserId);
  const withAgencyTeam = ent.modules.agencyWorkspace;
  const holders = await seatHolders(q, ownerUserId, withAgencyTeam);
  const used = holders.size;
  const adding = opts.adding ? await seatIdentity(q, opts.adding) : null;
  const alreadySeated = !!adding && holders.has(adding);

  // Beta accounts (owner signed up through a platform beta invite) get
  // unlimited seats for the duration of the beta — every gate below, and both
  // 402 sites in routes.ts, key off this result, so they never paywall one.
  const { rows: [owner] } = await q.query("SELECT beta_at FROM users WHERE id=$1", [ownerUserId]);
  if (owner?.beta_at) {
    return {
      plan: "beta",
      planName: "Beta",
      limit: -1,                               // -1 means unlimited
      used,
      remaining: -1,
      canAddSeat: true,
      canAdd: true,
      message: "Beta accounts have unlimited CRM seats.",
      upgradePlan: null as PlanKey | null,
      upgradeCrmPlan: null as CrmPlanKey | null,
      addon: null as AddonKey | null,
    };
  }

  // The CRM is a SEPARATE PRODUCT (shared/crm-plans.ts): its seats come from
  // the account's own CRM subscription, never from a ConstructHUB platform
  // plan. On Agency the agency team draws from the platform plan's agencySeats,
  // and both pools are counted together because seatHolders() returns the two
  // teams as one set.
  const crm = await getCrmEntitlements(ownerUserId);
  const agencySeats = withAgencyTeam ? (ent.allowances?.agencySeats ?? 0) : 0;
  // -1 (Unlimited's agencySeats, or an unlimited CRM plan) means no ceiling in
  // either pool: an unlimited plus a finite count is still unlimited.
  const limit = crm.seats < 0 || agencySeats < 0 ? -1 : crm.seats + agencySeats;
  const planName = crm.plan ? CRM_PLANS[crm.plan].name : withAgencyTeam && ent.accessPlan ? PLANS[ent.accessPlan].name : "none";
  const canAddSeat = limit < 0 || used < limit;
  const [one, many] = withAgencyTeam ? ["seat", "seats"] : ["CRM seat", "CRM seats"];
  let message = `Your ${planName} plan includes ${limit < 0 ? `unlimited ${many}` : plural(limit, one, many)} and ${inUse(used)}.`;
  let upgradePlan: PlanKey | null = null;
  let upgradeCrmPlan: CrmPlanKey | null = null;
  let addon: AddonKey | null = null;
  if (!crm.plan) {
    upgradeCrmPlan = cheapestCrmPlanWhere(() => true);
    const cheapest = upgradeCrmPlan ? CRM_PLANS[upgradeCrmPlan] : null;
    message = `The ConstructHUB CRM is a separate subscription from your platform plan${cheapest ? `, from $${(cheapest.monthlyCents / 100).toFixed(0)}/mo` : ""}. Choose a CRM plan to open the CRM and add your team.`;
  } else if (!canAddSeat) {
    upgradeCrmPlan = cheapestCrmPlanWhere((l) => l.seats > limit);
    const next = upgradeCrmPlan ? CRM_PLANS[upgradeCrmPlan] : null;
    message += next
      ? ` ${next.name} includes ${plural(next.limits.seats, "seat")}, or add an extra seat for $${(CRM_EXTRA_SEAT_MONTHLY_CENTS / 100).toFixed(0)}/mo.`
      : ` Add an extra seat for $${(CRM_EXTRA_SEAT_MONTHLY_CENTS / 100).toFixed(0)}/mo.`;
    // The Agency team is in the pool and the platform plan sells the Extra seat
    // add-on: buying one raises agencySeats, so name it for the client's
    // limit_reached handler (plan-errors.ts). Without the module the add-on
    // buys nothing, and on Unlimited the pool never fills.
    if (withAgencyTeam && ent.accessPlan && ADDONS.extra_seat.availableOn.includes(ent.accessPlan)) addon = "extra_seat";
  }

  return {
    plan: crm.plan ?? ent.accessPlan ?? "none",
    planName,
    limit,
    used,
    remaining: limit < 0 ? -1 : Math.max(0, limit - used),
    canAddSeat,
    canAdd: alreadySeated || canAddSeat,
    message,
    upgradePlan,
    upgradeCrmPlan,
    addon,
  };
}

export type SeatUsage = Awaited<ReturnType<typeof getOwnerSeatUsage>>;

/** Advisory lock key (with the owner's id) around a seat check and the addition it allows. */
export const SEAT_LOCK = 7164;
/** What work under the seat lock runs on: the connection holding it (raw and Drizzle) and the owner's plan. */
export type SeatLock = { client: PoolClient; db: NodePgDatabase<typeof schema>; ent: Entitlements };
/**
 * Run a seat check and the addition it allows one at a time per owner, so the
 * CRM team and the Agency team can't race past the shared pool together. It is
 * one transaction holding pg_advisory_xact_lock, and `fn` must do all of its
 * SQL through the SeatLock it is given: a request waiting for the lock holds a
 * pool connection, so work under the lock that needed a second connection from
 * the pool (10 by default) wedges every query in the process once ten requests
 * for one owner arrive together. The owner's plan is read before the lock.
 */
export async function withSeatLock<T>(ownerUserId: number, fn: (lock: SeatLock) => Promise<T>): Promise<T> {
  const ent = await getEntitlements(ownerUserId);
  const c = await pool.connect();
  let broken = false;
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1,$2)", [SEAT_LOCK, ownerUserId]);
    const result = await fn({ client: c, db: drizzle(c, { schema }), ent });
    await c.query("COMMIT");
    return result;
  } catch (e) {
    // A connection that can't roll back is closed rather than reused.
    await c.query("ROLLBACK").catch(() => { broken = true; });
    throw e;
  } finally {
    c.release(broken);
  }
}

/** The body of every seat-limit refusal (CRM invitations and re-activations, the Agency team). */
export function seatLimitBody(seats: SeatUsage) {
  return {
    code: "limit_reached",
    feature: "crmSeats",
    limit: seats.limit,
    used: seats.used,
    upgradePlan: seats.upgradePlan,
    addon: seats.addon,
    message: seats.message,
    seats,
  };
}
