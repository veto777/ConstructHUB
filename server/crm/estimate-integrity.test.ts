/**
 * Pure helpers behind the QA c13 estimate fixes (server/crm/entities.ts):
 * literal LIKE search, the derived "expired" state, the totals math the
 * deposit check uses, and the presenter's signed-total fields (redacted for
 * price-blind roles, like every other money field).
 */
import { beforeAll, describe, expect, it } from "vitest";

// entities.ts pulls in ../stripe (module-scope client) — a dummy key is
// enough to import; no queries run here.
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL ||= "postgres://localhost:5432/unused_no_queries_run";

let m: any;
let crmEffectivePermissions: any;
beforeAll(async () => {
  m = await import("./entities");
  ({ crmEffectivePermissions } = await import("@shared/schema"));
});

describe("likeContains", () => {
  it("escapes %, _ and backslash so a search matches them literally", () => {
    expect(m.likeContains("50%")).toBe("%50\\%%");
    expect(m.likeContains("a_b")).toBe("%a\\_b%");
    expect(m.likeContains("c:\\x")).toBe("%c:\\\\x%");
    expect(m.likeContains("plain")).toBe("%plain%");
  });
});

describe("estimateIsExpired", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const past = new Date("2026-09-01T00:00:00Z");
  const future = new Date("2026-10-30T00:00:00Z");
  const base = { status: "sent", expiresAt: past, approvedAt: null, declinedAt: null };
  it("is true only for an unanswered sent/viewed estimate past its date (or one marked expired)", () => {
    expect(m.estimateIsExpired(base, now)).toBe(true);
    expect(m.estimateIsExpired({ ...base, status: "viewed" }, now)).toBe(true);
    expect(m.estimateIsExpired({ ...base, expiresAt: future }, now)).toBe(false);
    expect(m.estimateIsExpired({ ...base, expiresAt: null }, now)).toBe(false);
    expect(m.estimateIsExpired({ ...base, status: "draft" }, now)).toBe(false);
    expect(m.estimateIsExpired({ ...base, approvedAt: past }, now)).toBe(false);
    expect(m.estimateIsExpired({ ...base, declinedAt: past }, now)).toBe(false);
    expect(m.estimateIsExpired({ ...base, status: "expired", expiresAt: null }, now)).toBe(true);
  });
});

describe("estimateTotals + depositRefusal", () => {
  it("matches recalcEstimate's math (discount off the taxable base, tax rounded once)", () => {
    const t = m.estimateTotals([
      { kind: "labor", unitPriceCents: 100_00, quantityMilli: 2500, taxable: true },
      { kind: "material", unitPriceCents: 50_00, quantityMilli: 1000, taxable: false },
      { kind: "discount", unitPriceCents: 25_00, quantityMilli: 1000, taxable: true },
    ], 880);
    expect(t).toEqual({ subtotalCents: 300_00, discountCents: 25_00, taxCents: 1980, totalCents: 29480 });
  });
  it("refuses a deposit above the total, allows up to it, ignores none", () => {
    expect(m.depositRefusal(100_01, 100_00)).toMatch(/can't be more than the estimate total/);
    expect(m.depositRefusal(100_00, 100_00)).toBeNull();
    expect(m.depositRefusal(null, 0)).toBeNull();
    expect(m.depositRefusal(0, 0)).toBeNull();
  });
});

describe("presentEstimate — signed total", () => {
  const ctx = (role: string) => ({ org: { id: "o" }, member: { id: "m" }, permissions: crmEffectivePermissions(role, null) });
  const est = {
    id: "e1", customerId: "c1", projectId: null, number: "E-1", divisionId: null, title: "Roof",
    status: "approved", introText: null, termsText: null,
    subtotalCents: 25_000_00, discountCents: 0, taxRateBps: 0, taxCents: 0, totalCents: 25_000_00, depositCents: null,
    approvedTotalCents: 24_500_00,
    selectedDiscounts: [{ id: "d", code: "military", label: "Military discount", percentBps: 200, conditions: null }],
    sentAt: new Date(), sentToEmail: null, firstViewedAt: null, lastViewedAt: null, viewCount: 0,
    approvedAt: new Date(), declinedAt: null, declineReason: null, signatureName: "Mary",
    expiresAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
  it("carries approvedTotalCents + selectedDiscounts for a price-seeing role", () => {
    const out = m.presentEstimate(est, ctx("owner"));
    expect(out.approvedTotalCents).toBe(24_500_00);
    expect(out.selectedDiscounts[0].label).toBe("Military discount");
    expect(out.expired).toBe(false);
  });
  it("redacts both for a price-blind role", () => {
    const out = m.presentEstimate(est, ctx("field"));
    expect(out.approvedTotalCents).toBeUndefined();
    expect(out.selectedDiscounts).toBeUndefined();
  });
});
