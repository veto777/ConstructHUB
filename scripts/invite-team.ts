/**
 * One-off ops script: comp the owner's seat plan and invite team members,
 * replicating POST /api/crm/invitations exactly (token, 14-day expiry,
 * seat-holding member row, invitation email via the app's own mailer).
 * Idempotent: existing pending invite or active member for an email → skipped.
 *
 * Run: DATABASE_URL="postgres://…" npx tsx scripts/invite-team.ts
 */
import { randomBytes } from "crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const { db } = await import("../server/db");
const s = await import("../shared/schema");
const { and, eq, isNull, sql } = await import("drizzle-orm");
const { sendWithFallback } = await import("../server/email");

const ORG_ID = "bba6d22f-d871-4c94-a9c7-1904dada3787";
const OWNER_USER_ID = 1;
const PORTAL = "https://portal.constructhub.us";

const INVITES = [
  { email: "andrey@alpinesidingpros.com", displayName: "Andrey Shkurat", role: "admin" },
  { email: "mike@alpinesidingpros.com", displayName: "Mike Bakko", role: "office" },
] as const;

async function main() {
  // 1. Seat headroom: comp the owner the 5-seat plan (platform owner's own org;
  //    no Stripe objects — stripeSubscriptionId stays null).
  const [sub] = await db.select().from(s.subscriptions).where(eq(s.subscriptions.userId, OWNER_USER_ID)).limit(1);
  if (!sub) {
    await db.insert(s.subscriptions).values({ userId: OWNER_USER_ID, plan: "platinum", status: "active" });
    console.log("✓ comped owner plan: platinum/active (5 seats)");
  } else {
    console.log(`· subscription already present: ${sub.plan}/${sub.status} — left alone`);
  }

  const [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.id, ORG_ID)).limit(1);
  if (!org) throw new Error("org not found");

  // 2. Invitations — same shape as routes.ts POST /api/crm/invitations.
  for (const { email, displayName, role } of INVITES) {
    const lower = email.toLowerCase();
    const pending = await db
      .select()
      .from(s.crmInvitations)
      .where(and(eq(s.crmInvitations.orgId, ORG_ID), eq(s.crmInvitations.email, lower), isNull(s.crmInvitations.acceptedAt), isNull(s.crmInvitations.revokedAt)))
      .limit(1);
    if (pending.length) {
      console.log(`· ${lower}: pending invite already exists — skipped`);
      continue;
    }
    const existing = await db
      .select()
      .from(s.crmMembers)
      .where(and(eq(s.crmMembers.orgId, ORG_ID), sql`lower(${s.crmMembers.email}) = ${lower}`))
      .limit(1);
    if (existing.length && existing[0].status === "active") {
      console.log(`· ${lower}: already an active member — skipped`);
      continue;
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await db.insert(s.crmInvitations).values({
      orgId: ORG_ID, email: lower, role, token, invitedByUserId: OWNER_USER_ID, expiresAt,
    });
    if (existing.length) {
      await db.update(s.crmMembers)
        .set({ status: "invited", role, displayName, updatedAt: new Date() })
        .where(eq(s.crmMembers.id, existing[0].id));
    } else {
      await db.insert(s.crmMembers).values({
        orgId: ORG_ID, userId: null, email: lower, role, status: "invited", displayName,
      });
    }

    const link = `${PORTAL}/crm/join?token=${token}`;
    let emailed = false;
    try {
      await sendWithFallback({
        to: lower,
        subject: `You've been invited to join ${org.name} on ConstructHub CRM`,
        html: `
          <p>${org.name} has invited you to join their team on ConstructHub CRM.</p>
          <p><a href="${link}">Accept the invitation</a></p>
          <p>This link expires in 14 days. If you weren't expecting it, you can ignore this email.</p>
        `,
      });
      emailed = true;
    } catch (e: any) {
      console.log(`  ⚠ email failed for ${lower}: ${e?.message || e}`);
    }
    console.log(`✓ ${lower} invited as ${role} (emailed: ${emailed})\n  ${link}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
