/**
 * The App Review demo account for the iPhone apps (docs/app/APP-STORE-PLAN.md, Remindr lesson 4: ONE demo account,
 * described the same everywhere, password never in git). Idempotent: run again to reset its password, renew its access
 * and refill the sample CRM workspace if it was emptied.
 *
 *   npx tsx script/create-review-account.ts --email support+appreview@constructhub.us --password-file /path/600-file
 *
 * Run on vb11 with the live .env. What it does:
 *   1. the account: verified email, that password, no 2FA (a reviewer can't receive a code), name "App Review";
 *   2. access: the Growth plan for 365 days through grantAccess (the /admin/access mechanism, granted by user 1) —
 *      the apps sell nothing, so without a plan the reviewer would only see locked tools;
 *   3. its CRM workspace (ensureOrgForUser) with a small sample book of work, created through the CRM's own API rules
 *      (clients with example.com emails and 555-01xx numbers, two jobs, two estimates), each marked "Demo data".
 * Prints the user id and what it created; never prints the password.
 */
import { readFileSync } from "fs";
import bcrypt from "bcryptjs";
import { pool } from "../server/db";
import { grantAccess } from "../server/access-grants";
import { ensureOrgForUser } from "../server/crm/tenancy";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const DEMO_NOTE = "Demo data for App Review — not a real customer.";
const SAMPLE = [
  { displayName: "Jordan Rivera", firstName: "Jordan", lastName: "Rivera", email: "jordan.rivera@example.com", phone: "(813) 555-0142",
    addressLine1: "1200 Sample Ave", city: "Tampa", state: "FL", postalCode: "33602",
    project: { name: "Roof replacement", status: "proposal_sent", trades: ["Roofing"] },
    estimate: { title: "Roof replacement — architectural shingles", items: [
      { kind: "labor", name: "Tear-off and disposal", quantityMilli: 28000, unit: "sq", unitPriceCents: 9500 },
      { kind: "material", name: "Architectural shingles", quantityMilli: 28000, unit: "sq", unitPriceCents: 14500 },
      { kind: "material", name: "Synthetic underlayment", quantityMilli: 28000, unit: "sq", unitPriceCents: 3200 },
      { kind: "labor", name: "Ridge vent and flashing", quantityMilli: 1000, unit: "job", unitPriceCents: 85000 },
    ] } },
  { displayName: "Maria Chen", firstName: "Maria", lastName: "Chen", email: "maria.chen@example.com", phone: "(813) 555-0177",
    addressLine1: "48 Demo Court", city: "Brandon", state: "FL", postalCode: "33511",
    project: { name: "Gutter replacement", status: "approved", trades: ["Gutters"] },
    estimate: { title: "Seamless gutters and downspouts", items: [
      { kind: "material", name: "6\" seamless aluminum gutter", quantityMilli: 160000, unit: "ft", unitPriceCents: 1100 },
      { kind: "material", name: "Downspouts", quantityMilli: 6000, unit: "ea", unitPriceCents: 9500 },
      { kind: "labor", name: "Remove old gutters and install", quantityMilli: 1000, unit: "job", unitPriceCents: 60000 },
    ] } },
  { displayName: "Harbor View HOA", companyName: "Harbor View HOA", email: "board@harborview.example.com", phone: "(813) 555-0110",
    addressLine1: "900 Example Blvd", city: "Clearwater", state: "FL", postalCode: "33755" },
];

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const passwordFile = arg("password-file");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email is required");
  if (!passwordFile) throw new Error("--password-file is required (the password never goes on the command line)");
  const password = readFileSync(passwordFile, "utf8").trim();
  if (password.length < 12) throw new Error("the password must be at least 12 characters");
  const hash = await bcrypt.hash(password, 12);

  // 1. The account.
  const { rows: [existing] } = await pool.query("SELECT id FROM users WHERE lower(email)=$1", [email]);
  let userId: number;
  if (existing) {
    userId = existing.id;
    await pool.query(
      `UPDATE users SET password_hash=$2, email_verified=true, totp_enabled=false, totp_secret=NULL,
              display_name='App Review', company_name='Sample Roofing Co. (demo)' WHERE id=$1`, [userId, hash]);
  } else {
    const { generateAccountId } = await import("../server/auth");
    const { rows: [row] } = await pool.query(
      `INSERT INTO users(email, password_hash, email_verified, display_name, company_name, account_id)
       VALUES ($1, $2, true, 'App Review', 'Sample Roofing Co. (demo)', $3) RETURNING id`, [email, hash, generateAccountId()]);
    userId = row.id;
  }

  // 2. Access: the Growth plan for a year, the same way an admin grants it on /admin/access.
  const { rows: [admin] } = await pool.query("SELECT id, email FROM users WHERE id=1");
  const grant = await grantAccess({ userId, plan: "growth", days: 365, note: "App Store review demo account (iPhone apps)" } as any,
    { id: admin.id, email: admin.email } as any);
  if ("refused" in grant) throw new Error(`grant refused: ${grant.refused}`);

  // 3. The CRM workspace and a small sample book of work.
  const { org, member } = await ensureOrgForUser(userId);
  await pool.query("UPDATE crm_orgs SET name='Sample Roofing Co. (demo)' WHERE id=$1", [org.id]);
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM crm_customers WHERE org_id=$1 AND archived_at IS NULL", [org.id]);
  const created: string[] = [];
  if (n === 0) {
    const { db } = await import("../server/db");
    const { crmCustomers, crmProjects, crmEstimates, crmEstimateItems } = await import("@shared/schema");
    const { randomBytes } = await import("crypto");
    const { nextDocNumber, recalcEstimate } = await import("../server/crm/entities");
    for (const s of SAMPLE) {
      const { project, estimate, ...fields } = s as any;
      const [cust] = await db.insert(crmCustomers).values({ ...fields, notes: DEMO_NOTE, orgId: org.id, ownerMemberId: member.id,
        portalToken: randomBytes(24).toString("hex") } as any).returning();
      created.push(`client ${cust.displayName}`);
      let projectId: string | null = null;
      if (project) {
        const row = await db.transaction(async (tx) => {
          const number = await nextDocNumber(tx, crmProjects, org.id, "P");
          const [p] = await tx.insert(crmProjects).values({ ...project, customerId: cust.id, orgId: org.id, number,
            description: DEMO_NOTE, addressLine1: s.addressLine1, city: s.city, state: s.state, postalCode: s.postalCode } as any).returning();
          return p;
        });
        projectId = row.id;
        created.push(`job ${row.number} ${row.name}`);
      }
      if (estimate) {
        const est = await db.transaction(async (tx) => {
          const number = await nextDocNumber(tx, crmEstimates, org.id, "E");
          const [e] = await tx.insert(crmEstimates).values({ orgId: org.id, customerId: cust.id, projectId, number, title: estimate.title,
            introText: DEMO_NOTE, taxRateBps: 0, publicToken: randomBytes(24).toString("hex"), createdByMemberId: member.id } as any).returning();
          return e;
        });
        await db.insert(crmEstimateItems).values(estimate.items.map((it: any, i: number) =>
          ({ ...it, taxable: true, hiddenFromClient: false, orgId: org.id, estimateId: est.id, sortOrder: i })) as any);
        const fresh = await recalcEstimate(org.id, est.id);
        created.push(`estimate ${est.number} ($${((fresh?.totalCents ?? 0) / 100).toFixed(2)})`);
      }
    }
  }
  console.log(JSON.stringify({ userId, email, plan: "growth", accessEnds: grant.endsAt, orgId: org.id,
    created: created.length ? created : "workspace already had clients — left as is" }));
}

main().then(() => pool.end()).catch(async (e) => { console.error(e?.message ?? e); await pool.end().catch(() => {}); process.exit(1); });
