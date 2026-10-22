/**
 * "Want to see your roofing bid too?" — the client page's upsell (owner, 2026-10-21: "if they have one scope this is
 * where you ask about the windows or the roof … your report and bid can be created instantly").
 *
 * The client's click never prices anything for the client: it makes a DRAFT estimate for that scope on the same
 * client (the most-used price-book item of that category, sized from the HOVER takeoff when there is one), and tells
 * the estimate's contact person so they can review it and send it in one click. Pricing reaches the client only
 * through a normal send.
 */
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  crmEstimates, crmEstimateItems, crmMembers, crmPbItems, crmPbCategories,
  type crmCustomers, type crmOrgs,
} from "@shared/schema";
import { categoryFromText, SCOPE_CATEGORY_LABEL, type ScopeCategory } from "@shared/scope-category";
import { takeoffQuantityForLine } from "@shared/hover-takeoff";
import { loadPricebookUsage } from "./pricebook-usage";
import { getCustomerTakeoff } from "./hover-file";
import { resolveEstimateTaxRate, taxSourceRecord } from "./tax";
import { estimateDefaultsFromOrg } from "./doc-defaults";
import { nextDocNumber, recalcEstimate } from "./entities";
import { resolveEstimateDivision, divisionContactMember } from "./divisions";
import { isSharedOfficeLogin } from "./client-contact";

/** The scopes the upsell can offer (the bundle's scopes; painting, gutters and doors are never pitched). */
export const UPSELL_SCOPES = ["siding", "windows", "roofing"] as const;
export type UpsellScope = (typeof UPSELL_SCOPES)[number];

type Est = typeof crmEstimates.$inferSelect;
type Cust = typeof crmCustomers.$inferSelect;
type Org = typeof crmOrgs.$inferSelect;

/** The price-book line a draft for this scope starts from: the org's most-used priced item of that category. */
async function scopeLine(orgId: string, scope: UpsellScope) {
  const rows = await db.select({ item: crmPbItems, category: crmPbCategories.name }).from(crmPbItems)
    .leftJoin(crmPbCategories, eq(crmPbCategories.id, crmPbItems.categoryId))
    .where(and(eq(crmPbItems.orgId, orgId), eq(crmPbItems.active, true)));
  const usage = await loadPricebookUsage(orgId).catch(() => new Map());
  const inScope = rows.filter(({ item, category }) => {
    const byCat = categoryFromText(category);
    return (byCat !== "other" ? byCat : categoryFromText(item.name)) === scope;
  });
  const priced = inScope.map(({ item }) => {
    const u = usage.get(item.id);
    const price = u?.lastPriceCents ?? (item.pricingMode === "per_sqft" ? item.rateCentsPerSqft : item.flatPriceCents) ?? 0;
    return { item, price, uses: u?.useCount ?? 0, description: u?.lastDescription ?? item.description ?? null, unit: u?.lastUnit ?? item.unit };
  }).filter((x) => x.price > 0);
  priced.sort((a, b) => b.uses - a.uses || a.item.name.localeCompare(b.item.name));
  return priced[0] ?? null;
}

/** Make the draft. Returns its id and number, and whether HOVER sized it. */
export async function createUpsellDraft(est: Est, cust: Cust, org: Org, scope: UpsellScope) {
  const label = SCOPE_CATEGORY_LABEL[scope as ScopeCategory];
  const pick = await scopeLine(org.id, scope);
  const takeoff = await getCustomerTakeoff(org.id, cust.id, { addressLine1: cust.addressLine1, postalCode: cust.postalCode })
    .catch(() => null);
  const fill = pick ? takeoffQuantityForLine({ name: pick.item.name, unit: pick.unit }, takeoff) : null;
  const tax = await resolveEstimateTaxRate(org.id, { customerId: cust.id, projectId: est.projectId });

  const draft = await db.transaction(async (tx) => {
    const [row] = await tx.insert(crmEstimates).values({
      orgId: org.id, customerId: cust.id, projectId: est.projectId,
      number: await nextDocNumber(tx, crmEstimates, org.id, "E"),
      title: (pick?.item.name ?? label).slice(0, 200),
      ...estimateDefaultsFromOrg(org as any),
      taxRateBps: tax.bps,
      publicToken: randomBytes(24).toString("hex"),
      createdByMemberId: est.createdByMemberId,
      divisionId: est.divisionId,
      customFields: {
        upsellFrom: { estimateId: est.id, number: est.number ?? null, scope, at: new Date().toISOString() },
        taxSource: taxSourceRecord(tax),
      },
    } as any).returning();
    return row;
  });

  const note = fill
    ? `Quantity from the HOVER report (${fill.basis}).`
    : "Quantity to confirm: no HOVER measurement for this scope yet.";
  await db.insert(crmEstimateItems).values({
    orgId: org.id, estimateId: draft.id, sortOrder: 0,
    kind: "labor",
    name: pick?.item.name ?? label,
    description: [pick?.description, `(${note} Review before sending.)`].filter(Boolean).join("\n\n"),
    quantityMilli: Math.round((fill?.quantity ?? 1) * 1000),
    unit: pick?.unit ?? null,
    unitPriceCents: pick?.price ?? 0,
    unitCostCents: pick?.item.flatCostCents ?? null,
    taxable: pick ? pick.item.taxable : true,
    scopeCategory: scope,
  } as any);
  const fresh = await recalcEstimate(org.id, draft.id);
  return { id: draft.id, number: fresh?.number ?? draft.number, measured: !!fill, priced: !!pick };
}

/**
 * Who hears about it: the estimate's writer when that is a real person, and the division's named contact (WA →
 * Andrey). An owner/admin login is a shared office account, so it falls to the division contact or the division's
 * own inbox — never the owner's personal details or the other division's.
 */
export async function upsellRecipients(est: Est): Promise<{ emails: string[]; memberIds: string[] }> {
  const emails = new Set<string>();
  const memberIds = new Set<string>();
  if (est.createdByMemberId) {
    const [m] = await db.select().from(crmMembers)
      .where(and(eq(crmMembers.id, est.createdByMemberId), eq(crmMembers.orgId, est.orgId))).limit(1);
    if (m && !isSharedOfficeLogin(m) && m.status === "active") {
      if (m.email) emails.add(m.email);
      memberIds.add(m.id);
    }
  }
  const div = await resolveEstimateDivision(est);
  const cm = await divisionContactMember(est.orgId, div);
  if (cm) {
    if (cm.email) emails.add(cm.email);
    memberIds.add(cm.id);
  } else if (!emails.size && div?.email) {
    emails.add(div.email);
  }
  return { emails: [...emails], memberIds: [...memberIds] };
}
