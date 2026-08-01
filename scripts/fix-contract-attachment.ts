/**
 * Regenerate the signed-contract PDF for an approved estimate and REPLACE the
 * stored contract attachment (so the portal serves the corrected copy).
 * Run: npx tsx --env-file=.env scripts/fix-contract-attachment.ts --estimate=<id> --org=<id>
 */
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const argVal = (f: string) => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const EST_ID = argVal("--estimate");
const ORG_ID = argVal("--org");

const { db } = await import("../server/db");
const s = await import("../shared/schema");
const { and, desc, eq } = await import("drizzle-orm");
const { buildContractPdf } = await import("../server/crm/contract-pdf");
const { resolveOrgTheme } = await import("../shared/theme-colors");

async function main() {
  const [org] = await db.select().from(s.crmOrgs).where(eq(s.crmOrgs.id, ORG_ID)).limit(1);
  const [est] = await db.select().from(s.crmEstimates).where(eq(s.crmEstimates.id, EST_ID)).limit(1);
  const [cust] = await db.select().from(s.crmCustomers).where(eq(s.crmCustomers.id, est.customerId)).limit(1);
  const items = await db.select().from(s.crmEstimateItems).where(eq(s.crmEstimateItems.estimateId, est.id));
  const options = await db.select().from(s.crmEstimateOptions).where(eq(s.crmEstimateOptions.estimateId, est.id));

  const branding = {
    name: org.name, email: org.email, phone: org.phone, website: org.website,
    addressLine1: org.addressLine1, addressLine2: org.addressLine2, city: org.city,
    state: org.state, postalCode: org.postalCode, licenseNumber: org.licenseNumber, licenseState: org.licenseState,
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
    items: items.map((i) => ({ name: i.name, description: i.description, quantityMilli: i.quantityMilli, unit: i.unit, unitPriceCents: i.unitPriceCents, lineTotalCents: i.totalCents })),
    options: options.map((o) => ({ name: o.name, description: o.description, recommended: o.recommended, totalCents: o.totalCents })),
    terms: org.termsAndConditions,
  });

  const [att] = await db.select().from(s.crmAttachments)
    .where(and(eq(s.crmAttachments.kind, "contract"), eq(s.crmAttachments.refId, EST_ID)))
    .orderBy(desc(s.crmAttachments.createdAt)).limit(1);
  if (att) {
    fs.mkdirSync(path.dirname(att.storagePath), { recursive: true });
    fs.writeFileSync(att.storagePath, pdf);
    await db.update(s.crmAttachments)
      .set({ sizeBytes: pdf.length, fileName: `contract-${est.number}.pdf` })
      .where(eq(s.crmAttachments.id, att.id));
    console.log(`✓ replaced attachment ${att.id} (${pdf.length} bytes)`);
  } else {
    // The approval predated (or failed) the attachment store — create it fresh
    // using the storage convention from server/crm/attachments.ts.
    const storagePath = path.join(process.cwd(), "tmp", "crm-attachments", ORG_ID, `${randomBytes(16).toString("hex")}.pdf`);
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, pdf);
    await db.insert(s.crmAttachments).values({
      orgId: ORG_ID, kind: "contract", refId: EST_ID,
      fileName: `contract-${est.number}.pdf`, mime: "application/pdf",
      sizeBytes: pdf.length, storagePath,
    });
    console.log(`✓ created contract attachment (${pdf.length} bytes) at ${storagePath}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
