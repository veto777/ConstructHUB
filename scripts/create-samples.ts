/**
 * Full pipeline delivery: create 3 sample customers + estimates (built from the
 * mined price-book scopes) in the owner's org, mark them sent with real
 * estimate emails (gated /e/:token links), so the owner can walk the entire
 * flow: email -> verify -> gated estimate -> client portal.
 *
 * Idempotent: sample customers are matched by email+name; sample estimates by
 * customFields.sampleKey. Re-running skips what exists.
 *
 * Run: DATABASE_URL="postgres://…" npx tsx scripts/create-samples.ts --org=<id> --to=<email>
 */
import { randomBytes } from "crypto";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const argVal = (flag: string, dflt?: string) => {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const ORG_ID: string = argVal("--org") ?? "";
const TO = argVal("--to", "alpinesidingcompany@gmail.com")!;
if (!ORG_ID) throw new Error("--org required");

const { db } = await import("../server/db");
const s = await import("../shared/schema");
const { and, eq, sql } = await import("drizzle-orm");
const { sendWithFallback } = await import("../server/email");
const { nextDocNumber } = await import("../server/crm/doc-number");

const tok = () => randomBytes(24).toString("hex");
const PORTAL = "https://portal.constructhub.us";

const SAMPLES = [
  {
    key: "sample-martinez",
    name: "Daniel & Rosa Martinez", firstName: "Daniel", lastName: "Martinez",
    phone: "(360) 555-0142", city: "Bellingham", state: "WA", address: "1420 Birchwood Dr",
    title: "Siding remodel — James Hardie primed + exterior paint",
    items: [
      { name: "Siding Remodel - James Hardie Primed + Exterior Paint", qty: 1, price: 4125000 },
      { name: "Window Trim Package (6 windows)", qty: 6, price: 28500 },
    ],
  },
  {
    key: "sample-chen",
    name: "Grace Chen", firstName: "Grace", lastName: "Chen",
    phone: "(941) 555-0177", city: "Sarasota", state: "FL", address: "882 Palm Aire Dr",
    title: "Re-roof — standard package",
    items: [
      { name: "Standard Package - Re Roof", qty: 1, price: 1895000 },
      { name: "Skylight installation", qty: 1, price: 145000 },
    ],
  },
  {
    key: "sample-obrien",
    name: "Pat & Linda O'Brien", firstName: "Pat", lastName: "O'Brien",
    phone: "(360) 555-0191", city: "Ferndale", state: "WA", address: "277 Mountain View Rd",
    title: "Siding + paint bundle",
    items: [
      { name: "Siding Remodel - Color +", qty: 1, price: 2270000 },
      { name: "Gutter Replacement - 5\" K-style", qty: 1, price: 165000 },
    ],
  },
];

async function main() {
  const [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.id, ORG_ID)).limit(1);
  if (!org) throw new Error("org not found");

  for (const smp of SAMPLES) {
    // customer — reuse if one with this email+name exists
    let [cust] = await db.select().from(s.crmCustomers)
      .where(and(eq(s.crmCustomers.orgId, ORG_ID), eq(s.crmCustomers.email, TO), eq(s.crmCustomers.displayName, smp.name)))
      .limit(1);
    if (!cust) {
      [cust] = await db.insert(s.crmCustomers).values({
        orgId: ORG_ID, displayName: smp.name, firstName: smp.firstName, lastName: smp.lastName,
        email: TO, phone: smp.phone, addressLine1: smp.address, city: smp.city, state: smp.state,
        postalCode: "98225", portalToken: tok(),
        customFields: { sample: true },
      }).returning();
      console.log(`✓ customer: ${smp.name}`);
    } else {
      console.log(`· customer exists: ${smp.name}`);
    }

    // estimate — skip if the sample key exists
    const existing = await db.select().from(s.crmEstimates)
      .where(and(eq(s.crmEstimates.orgId, ORG_ID), sql`${s.crmEstimates.customFields}->>'sampleKey' = ${smp.key}`))
      .limit(1);
    if (existing.length) { console.log(`· estimate exists for ${smp.key} — skipped`); continue; }

    const subtotal = smp.items.reduce((a, i) => a + i.price * i.qty, 0);
    const taxBps = org.defaultTaxRateBps ?? 0;
    const tax = Math.round((subtotal * taxBps) / 10000);
    const total = subtotal + tax;

    // The number comes from the CRM's one allocator, inside the insert's
    // transaction — never 1000 + count(*), which repeats a number that still
    // exists after any delete and would trip the (org_id, number) unique index.
    const est = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, "E", ORG_ID);
      const [row] = await tx.insert(s.crmEstimates).values({
        orgId: ORG_ID, customerId: cust.id, number, title: smp.title,
        termsText: org.termsAndConditions ?? null,
        taxRateBps: taxBps, subtotalCents: subtotal, discountCents: 0, taxCents: tax, totalCents: total,
        publicToken: tok(), status: "sent",
        sentAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000), sentToEmail: TO,
        customFields: { sampleKey: smp.key, sample: true, taxSource: { source: "org-default", bps: taxBps } },
      }).returning();
      await tx.insert(s.crmEstimateItems).values(
        smp.items.map((it, idx) => ({
          orgId: ORG_ID, estimateId: row.id, name: it.name, quantityMilli: it.qty * 1000,
          unitPriceCents: it.price, totalCents: it.price * it.qty, taxable: true, sortOrder: idx,
        })),
      );
      return row;
    });
    const number = est.number;

    const link = `${PORTAL}/e/${est.publicToken}`;
    try {
      await sendWithFallback({
        to: TO,
        subject: `${org.name} has sent you an estimate (${number})`,
        html: `
          <p>${org.name} has sent you an estimate, <b>${number} — ${smp.title}</b>.</p>
          <p><a href="${link}">View your estimate</a></p>
          <p>Only you can open this link — it verifies <b>${TO}</b>. It expires in 7 days.</p>
        `,
      });
      console.log(`✓ ${number} (${smp.title}) sent → ${TO}  [emailed]`);
    } catch (e: any) {
      console.log(`✓ ${number} created, EMAIL FAILED: ${e?.message || e}\n  ${link}`);
    }
  }
  console.log("done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
