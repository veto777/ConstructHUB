/** Resend pending team-invitation emails (uses the app's own mailer).
 *  Run: npx tsx --env-file=.env scripts/resend-invites.ts  (DATABASE_URL in .env) */
const { db } = await import("../server/db");
const s = await import("../shared/schema");
const { and, eq, isNull } = await import("drizzle-orm");
const { sendWithFallback } = await import("../server/email");

const PORTAL = "https://portal.constructhub.us";

async function main() {
  const rows = await db
    .select()
    .from(s.crmInvitations)
    .where(and(isNull(s.crmInvitations.acceptedAt), isNull(s.crmInvitations.revokedAt)));
  const [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.id, rows[0]?.orgId ?? "")).limit(1);
  for (const inv of rows) {
    const link = `${PORTAL}/crm/join?token=${inv.token}`;
    try {
      await sendWithFallback({
        to: inv.email,
        subject: `You've been invited to join ${org.name} on ConstructHub CRM`,
        html: `
          <p>${org.name} has invited you to join their team on ConstructHub CRM.</p>
          <p><a href="${link}">Accept the invitation</a></p>
          <p>This link expires in 14 days. If you weren't expecting it, you can ignore this email.</p>
        `,
      });
      console.log(`✓ emailed ${inv.email}`);
    } catch (e: any) {
      console.log(`⚠ ${inv.email}: ${e?.message || e}\n  ${link}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
