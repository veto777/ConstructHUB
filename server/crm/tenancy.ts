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
import { db, pool } from "../db";
import { crmOrgs, crmMembers, users, crmEffectivePermissions } from "@shared/schema";
import type { CrmPermission } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorizeObjectRequest } from "./object-access";
import { PLANS, type AddonKey, type PlanKey } from "@shared/plans";
import { getEntitlements, raiseHint, cheapestPlanWhere, plural, inUse } from "../entitlements";

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
  return ctx;
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
export async function getSeatUsage(org: typeof crmOrgs.$inferSelect, adding?: { userId?: number | null; email?: string | null }) {
  return getOwnerSeatUsage(org.ownerUserId, { adding });
}

/**
 * The people holding seats on an owner's plan, one entry per person: members
 * (active or invited) of every CRM org the owner owns, plus — while the plan
 * includes the Agency workspace — the owner and their agency team. Seats are
 * one pool: the plan's crmSeats plus Extra seat add-ons ("One more CRM or
 * agency team seat"), so someone on both teams holds one seat. An invitation
 * not yet accepted counts by the account its email belongs to, else the email.
 */
async function seatHolders(ownerUserId: number, withAgencyTeam: boolean): Promise<Set<string>> {
  const { rows: crm } = await pool.query(
    `SELECT COALESCE('u:' || COALESCE(m.user_id, (SELECT u.id FROM users u WHERE lower(u.email)=lower(m.email) ORDER BY u.id LIMIT 1)),
                     'e:' || lower(m.email)) AS who
       FROM crm_members m JOIN crm_orgs o ON o.id=m.org_id
      WHERE o.owner_user_id=$1 AND m.status IN ('active','invited')`,
    [ownerUserId],
  );
  const holders = new Set<string>(crm.map((r: { who: string }) => r.who));
  if (withAgencyTeam) {
    holders.add(`u:${ownerUserId}`);
    const { rows: team } = await pool.query("SELECT member_id FROM agency_members WHERE user_id=$1", [ownerUserId]);
    for (const r of team) holders.add(`u:${r.member_id}`);
  }
  return holders;
}

/** A person's seat identity: their account when one exists, else the invited email. */
async function seatIdentity(person: { userId?: number | null; email?: string | null }): Promise<string | null> {
  if (person.userId) return `u:${person.userId}`;
  const email = person.email?.trim().toLowerCase();
  if (!email) return null;
  const { rows: [u] } = await pool.query("SELECT id FROM users WHERE lower(email)=$1 ORDER BY id LIMIT 1", [email]);
  return u ? `u:${u.id}` : `e:${email}`;
}

/**
 * Seat usage on an owner's plan; the CRM team and the Agency team share it.
 * `adding` asks about one more person (by account id or email): `canAdd` says
 * whether they can join, which is always true for someone who already holds a
 * seat on the other team.
 */
export async function getOwnerSeatUsage(ownerUserId: number, opts: { adding?: { userId?: number | null; email?: string | null } } = {}) {
  const ent = await getEntitlements(ownerUserId);
  const withAgencyTeam = ent.modules.agencyWorkspace;
  const holders = await seatHolders(ownerUserId, withAgencyTeam);
  const used = holders.size;
  const adding = opts.adding ? await seatIdentity(opts.adding) : null;
  const alreadySeated = !!adding && holders.has(adding);

  // Beta accounts (owner signed up through a platform beta invite) get
  // unlimited seats for the duration of the beta — every gate below, and both
  // 402 sites in routes.ts, key off this result, so they never paywall one.
  const [owner] = await db
    .select({ betaAt: users.betaAt })
    .from(users)
    .where(eq(users.id, ownerUserId))
    .limit(1);
  if (owner?.betaAt) {
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
      addon: null as AddonKey | null,
    };
  }

  // CRM seats come with every paid plan (crmSeats, plus Extra seat add-ons);
  // the org owner's plan applies. Without a plan the owner keeps their own seat.
  const limit = ent.allowances?.crmSeats ?? 1;         // -1 means unlimited
  const planName = ent.accessPlan ? PLANS[ent.accessPlan].name : "current";
  const canAddSeat = limit < 0 || used < limit;
  const [one, many] = withAgencyTeam ? ["seat", "seats"] : ["CRM seat", "CRM seats"];
  const shared = withAgencyTeam ? " for the CRM and agency team together" : "";
  let message = `Your ${planName} plan includes ${limit < 0 ? `unlimited ${many}` : plural(limit, one, many)}${shared} and ${inUse(used)}.`;
  let upgradePlan: PlanKey | null = null;
  let addon: AddonKey | null = null;
  if (!ent.accessPlan) {
    const starter = cheapestPlanWhere((l) => l.crmSeats > 1);
    upgradePlan = starter;
    message += ` The CRM is included with every paid plan${starter ? `, and ${PLANS[starter].name} includes ${plural(PLANS[starter].limits.crmSeats, "seat")}` : ""}. Choose a plan in Pricing to add your team.`;
  } else if (!canAddSeat) {
    const raise = raiseHint(ent, "crmSeats", ["seat"], "extra_seat");
    upgradePlan = raise.upgradePlan;
    addon = raise.addon;
    if (raise.text) message += ` ${raise.text}`;
  }

  return {
    plan: ent.accessPlan ?? "none",
    planName,
    limit,
    used,
    remaining: limit < 0 ? -1 : Math.max(0, limit - used),
    canAddSeat,
    canAdd: alreadySeated || canAddSeat,
    message,
    upgradePlan,
    addon,
  };
}

export type SeatUsage = Awaited<ReturnType<typeof getOwnerSeatUsage>>;

/** Advisory lock key (with the owner's id) around a seat check and the addition it allows. */
export const SEAT_LOCK = 7164;
/**
 * Run a seat check and the addition it allows one at a time per owner, so the
 * CRM team and the Agency team can't race past the shared pool together (the
 * Agency route takes the same key inside its transaction).
 */
export async function withSeatLock<T>(ownerUserId: number, fn: () => Promise<T>): Promise<T> {
  const c = await pool.connect();
  let broken = false;
  try {
    await c.query("SELECT pg_advisory_lock($1,$2)", [SEAT_LOCK, ownerUserId]);
    try {
      return await fn();
    } finally {
      await c.query("SELECT pg_advisory_unlock($1,$2)", [SEAT_LOCK, ownerUserId]).catch(() => { broken = true; });
    }
  } finally {
    // A connection whose unlock failed may still hold the lock: close it rather than reuse it.
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
