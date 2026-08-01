/**
 * Regenerate the signed-contract PDF for an already-approved estimate and
 * resend it to the client + org admin (used after the layout fix).
 * Run: npx tsx --env-file=.env scripts/resend-contract.ts --estimate=<id> --org=<id>
 */
const argVal = (f: string) => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const EST_ID = argVal("--estimate");
const ORG_ID = argVal("--org");
if (!EST_ID || !ORG_ID) throw new Error("--estimate and --org required");

const { db } = await import("../server/db");
const s = await import("../shared/schema");
const { and, desc, eq } = await import("drizzle-orm");
const { buildContractPdf, contractFileName } = await import("../server/crm/contract-pdf");
const { sendWithFallback } = await import("../server/email");
const { resolveOrgTheme } = await import("../shared/theme-colors");

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function main() {
  const [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.id, ORG_ID)).limit(1);
  const [est] = await db.select().from(s.crmEstimates).where(eq(s.crmEstimates.id, EST_ID)).limit(1);
  if (!org || !est) throw new Error("org or estimate not found");
  if (!est.approvedAt) throw new Error("estimate is not approved — no contract to send");
  const [cust] = await db.select().from(s.crmCustomers).where(eq(s.crmCustomers.id, est.customerId)).limit(1);
  const items = await db.select().from(s.crmEstimateItems).where(eq(s.crmEstimateItems.estimateId, est.id));
  const options = await db.select().from(s.crmEstimateOptions).where(eq(s.crmEstimateOptions.estimateId, est.id));
  const owners = await db.select().from(s.crmMembers)
    .where(and(eq(s.crmMembers.orgId, ORG_ID), eq(s.crmMembers.role, "owner"), eq(s.crmMembers.status, "active")));

  const branding = {
    name: org.name, email: org.email, phone: org.phone, website: org.website,
    addressLine1: org.addressLine1, addressLine2: org.addressLine2, city: org.city,
    state: org.state, postalCode: org.postalCode,
    licenseNumber: org.licenseNumber, licenseState: org.licenseState,
  };
  const pdf = await buildContractPdf({
    branding, accentHex: resolveOrgTheme(org.customFields).hex, orgName: org.name,
    customer: {
      displayName: cust.displayName, email: cust.email, phone: cust.phone,
      addressLine1: cust.addressLine1, addressLine2: cust.addressLine2,
      city: cust.city, state: cust.state, postalCode: cust.postalCode,
    },
    estimate: {
      number: est.number, title: est.title, createdAt: est.createdAt, expiresAt: est.expiresAt,
      approvedAt: est.approvedAt, subtotalCents: est.subtotalCents, discountCents: est.discountCents,
      taxCents: est.taxCents, totalCents: est.totalCents, approvedTotalCents: est.approvedTotalCents,
      depositCents: est.depositCents, signatureName: est.signatureName, signatureIp: est.signatureIp,
      selectedDiscounts: est.selectedDiscounts, termsText: est.termsText,
    },
    items: items.map((i) => ({
      name: i.name, description: i.description, quantityMilli: i.quantityMilli,
      unit: i.unit, unitPriceCents: i.unitPriceCents, lineTotalCents: i.totalCents,
    })),
    options: options.map((o) => ({ name: o.name, description: o.description, recommended: o.recommended, totalCents: o.totalCents })),
    terms: org.termsAndConditions,
  });
  console.log(`regenerated contract for ${est.number}: ${pdf.length} bytes`);

  const total = money(est.approvedTotalCents ?? est.totalCents);
  const recipients = [...new Set([cust.email, ...owners.map((m) => m.email)].filter(Boolean))] as string[];
  for (const to of recipients) {
    await sendWithFallback({
      to,
      subject: `${org.name} — your signed contract ${est.number} (corrected copy)`,
      html: `<p>Please find the corrected signed contract for <b>${est.number} — ${est.title}</b> (total <b>${total}</b>), signed by ${est.signatureName}.</p>
             <p>The earlier copy had a formatting issue — this one replaces it.</p>`,
      attachments: [{ filename: contractFileName(est.number), content: pdf }],
    } as any);
    console.log(`✓ sent to ${to}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
