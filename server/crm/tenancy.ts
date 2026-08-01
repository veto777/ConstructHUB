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
import { db } from "../db";
import { crmOrgs, crmMembers, subscriptions, users, crmEffectivePermissions } from "@shared/schema";
import type { CrmPermission } from "@shared/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { PLANS } from "../stripe";

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
export async function getSeatUsage(org: typeof crmOrgs.$inferSelect) {
  const [{ used }] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(crmMembers)
    .where(
      and(
        eq(crmMembers.orgId, org.id),
        sql`${crmMembers.status} in ('active','invited')`,
      ),
    );

  // Beta accounts (owner signed up through a platform beta invite) get
  // unlimited seats for the duration of the beta — every gate below, and both
  // 402 sites in routes.ts, key off this result, so they never paywall one.
  const [owner] = await db
    .select({ betaAt: users.betaAt })
    .from(users)
    .where(eq(users.id, org.ownerUserId))
    .limit(1);
  if (owner?.betaAt) {
    return {
      plan: "beta",
      planName: "Beta",
      limit: -1,                               // -1 means unlimited
      used,
      remaining: -1,
      canAddSeat: true,
    };
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, org.ownerUserId))
    .limit(1);

  const planKey = (sub?.plan ?? "free") as keyof typeof PLANS;
  const active = sub?.status === "active" || sub?.status === "trialing";
  const plan = active ? PLANS[planKey] : undefined;
  // Unknown/free/inactive plans get a single seat (the owner).
  const limit = (plan?.limits as { users?: number } | undefined)?.users ?? 1;

  return {
    plan: planKey,
    planName: plan?.name ?? "Free",
    limit,                                   // -1 means unlimited
    used,
    remaining: limit < 0 ? -1 : Math.max(0, limit - used),
    canAddSeat: limit < 0 || used < limit,
  };
}
