/**
 * The dashboard's CRM context — a READ-ONLY copy of resolveOrg
 * (server/crm/tenancy.ts) without its ensureOrgForUser fallback, so loading
 * the dashboard never creates a CRM org (SPEC §3.4):
 *   1. the org pinned in the session, while the user is still an active member;
 *   2. otherwise the oldest active membership (ensureOrgForUser's stable order);
 *   3. otherwise null — the CRM tiles show "Set up the CRM".
 * A stale pin is ignored, not deleted: the dashboard writes nothing, not even
 * to the session.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { crmMembers, crmOrgs, crmEffectivePermissions } from "@shared/schema";
import type { OrgContext } from "../crm/tenancy";

export async function readOnlyCrmContext(userId: number, pinnedOrgId?: string | null): Promise<OrgContext | null> {
  if (pinnedOrgId) {
    const [hit] = await db
      .select({ member: crmMembers, org: crmOrgs })
      .from(crmMembers)
      .innerJoin(crmOrgs, eq(crmOrgs.id, crmMembers.orgId))
      .where(and(eq(crmMembers.orgId, pinnedOrgId), eq(crmMembers.userId, userId), eq(crmMembers.status, "active")))
      .limit(1);
    if (hit) return { org: hit.org, member: hit.member, permissions: crmEffectivePermissions(hit.member.role, hit.member.permissions) };
  }
  const [first] = await db
    .select({ member: crmMembers, org: crmOrgs })
    .from(crmMembers)
    .innerJoin(crmOrgs, eq(crmOrgs.id, crmMembers.orgId))
    .where(and(eq(crmMembers.userId, userId), eq(crmMembers.status, "active")))
    .orderBy(asc(crmMembers.createdAt))
    .limit(1);
  if (!first) return null;
  return { org: first.org, member: first.member, permissions: crmEffectivePermissions(first.member.role, first.member.permissions) };
}
