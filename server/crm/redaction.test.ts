/**
 * Permission redaction — the owner's key requirement (§4 of the brain doc):
 * a PM or field tech shared onto the client list must not be able to read
 * pricing out of the JSON. Redaction is server-side, in the presenters, so
 * these tests pin the presenters' behaviour: with `field` permissions every
 * money field is ABSENT (undefined), with `owner` permissions it is present.
 */
import { describe, it, expect, beforeAll } from "vitest";

// entities.ts pulls in ../stripe, whose module scope constructs a Stripe
// client and throws without a key. A dummy value is enough for import.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

let presentEstimate: any, presentEstimateItem: any, crmEffectivePermissions: any;

beforeAll(async () => {
  ({ presentEstimate, presentEstimateItem } = await import("./entities"));
  ({ crmEffectivePermissions } = await import("@shared/schema"));
});

const ctx = (role: string) => ({
  org: { id: "org-1" },
  member: { id: "mem-1" },
  permissions: crmEffectivePermissions(role, null),
});

const estimate = {
  id: "e1", customerId: "c1", projectId: "p1", number: "E-1", title: "Roof",
  status: "sent", introText: null, termsText: null,
  subtotalCents: 912000, discountCents: 50000, taxRateBps: 880,
  taxCents: 75856, totalCents: 937856, depositCents: 100000,
  sentAt: new Date(), sentToEmail: "x@example.com",
  firstViewedAt: null, lastViewedAt: null, viewCount: 0,
  approvedAt: null, declinedAt: null, declineReason: null,
  signatureName: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date(),
};

const item = {
  id: "i1", sortOrder: 0, kind: "labor", name: "Tear-off", description: null,
  quantityMilli: 1000, unit: "sq", taxable: true, hiddenFromClient: false,
  unitPriceCents: 400000, unitCostCents: 250000,
};

const ESTIMATE_MONEY = ["subtotalCents", "discountCents", "taxRateBps", "taxCents", "totalCents", "depositCents"];

describe("field role — price-blind", () => {
  it("estimate money fields are absent from the JSON", () => {
    const out = presentEstimate(estimate, ctx("field"));
    for (const k of ESTIMATE_MONEY) expect(out[k], k).toBeUndefined();
    // …while the non-money shape stays readable
    expect(out.title).toBe("Roof");
    expect(out.status).toBe("sent");
  });
  it("line-item price and cost are absent, name stays readable", () => {
    const out = presentEstimateItem(item, ctx("field"));
    expect(out.unitPriceCents).toBeUndefined();
    expect(out.unitCostCents).toBeUndefined();
    expect(out.name).toBe("Tear-off");
  });
});

describe("office role — sees price, never cost", () => {
  it("unit price present, unit cost absent", () => {
    const out = presentEstimateItem(item, ctx("office"));
    expect(out.unitPriceCents).toBe(400000);
    expect(out.unitCostCents).toBeUndefined();
  });
});

describe("owner role — sees everything", () => {
  it("all estimate money fields present and cents-exact", () => {
    const out = presentEstimate(estimate, ctx("owner"));
    expect(out.subtotalCents).toBe(912000);
    expect(out.discountCents).toBe(50000);
    expect(out.taxCents).toBe(75856);
    expect(out.totalCents).toBe(937856);
  });
  it("item price AND cost present", () => {
    const out = presentEstimateItem(item, ctx("owner"));
    expect(out.unitPriceCents).toBe(400000);
    expect(out.unitCostCents).toBe(250000);
  });
});

describe("pm role — coordinates the work, cost-blind", () => {
  it("defaults: office-like reach, seePrices on, seeCosts and back office off", () => {
    const p = crmEffectivePermissions("pm", null);
    expect(p.viewAllJobs).toBe(true);
    expect(p.manageJobs).toBe(true);
    expect(p.manageEstimates).toBe(true);
    expect(p.manageCustomers).toBe(true);
    expect(p.seePrices).toBe(true);
    expect(p.seeCosts).toBe(false);
    expect(p.manageTeam).toBe(false);
    expect(p.manageSettings).toBe(false);
    expect(p.manageIntegrations).toBe(false);
  });
  it("redaction: the pm sees the scope's price, never its cost", () => {
    const out = presentEstimateItem(item, ctx("pm"));
    expect(out.unitPriceCents).toBe(400000);
    expect(out.unitCostCents).toBeUndefined();
    // …and the document totals survive — only costs are stripped.
    const est = presentEstimate(estimate, ctx("pm"));
    expect(est.totalCents).toBe(937856);
  });
});

describe("per-seat overrides", () => {
  it("a field tech granted seePrices sees price but still not cost", () => {
    const custom = { org: { id: "o" }, member: { id: "m" },
      permissions: crmEffectivePermissions("field", { seePrices: true }) };
    const out = presentEstimateItem(item, custom);
    expect(out.unitPriceCents).toBe(400000);
    expect(out.unitCostCents).toBeUndefined();
  });
});
