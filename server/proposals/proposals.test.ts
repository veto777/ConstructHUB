import { describe, expect, it } from "vitest";
import { addMonths, autoPayLines, autoPayMonths, autoPaySchedule, cardFeeCents, defaultSelection, paymentBalance, priceSelection, proposalContentSchema, selectionProblems } from "@shared/proposals";

const content = proposalContentSchema.parse({
  payment: { plan: "choice", cardFeeBps: 300 },
  groups: [
    { id: "seo", name: "SEO program", select: "one", required: true, items: [
      { id: "starter", name: "Starter", priceCents: 250_000, billing: "monthly", termMonths: 6, defaultSelected: true },
      { id: "pro", name: "Pro", priceCents: 550_000, billing: "monthly", termMonths: 6 },
    ] },
    { id: "rep", name: "Reputation", select: "many", items: [
      { id: "foundation", name: "Foundation", priceCents: 350_000, included: true },
      { id: "video", name: "Video series", priceCents: 250_000 },
    ] },
  ],
});

describe("proposals pricing", () => {
  it("opens with only the included items selected", () => {
    expect(defaultSelection(content).sort()).toEqual(["foundation"]);
  });
  it("monthly plan: one-time + first month today, then monthly", () => {
    const t = priceSelection(content, ["starter", "foundation"], "monthly");
    expect(t.oneTimeCents).toBe(350_000);
    expect(t.monthlyCents).toBe(250_000);
    expect(t.contractTotalCents).toBe(350_000 + 250_000 * 6);
    expect(t.dueTodayCents).toBe(600_000);
    expect(t.recurringCents).toBe(250_000);
  });
  it("full plan: the whole term today, less the 5% pay-in-full discount", () => {
    const t = priceSelection(content, ["pro", "foundation", "video"], "full");
    const gross = 350_000 + 250_000 + 550_000 * 6;
    expect(t.discountCents).toBe(gross * 0.05);
    expect(t.dueTodayCents).toBe(gross * 0.95);
    expect(t.contractTotalCents).toBe(gross * 0.95);
    expect(t.recurringCents).toBe(0);
  });
  it("the pay-in-full discount follows the proposal's percentage, and only when paying ahead", () => {
    const c = proposalContentSchema.parse({ ...content, payment: { plan: "choice", fullPayDiscountBps: 1000 } });
    expect(priceSelection(c, ["starter", "foundation"], "full").dueTodayCents).toBe((350_000 + 250_000 * 6) * 0.9);
    expect(priceSelection(c, ["starter", "foundation"], "monthly").discountCents).toBe(0);
    expect(priceSelection(c, ["foundation"], "full").discountCents).toBe(0);
  });
  it("only one-time items: always paid in full", () => {
    const c = proposalContentSchema.parse({ ...content, groups: [content.groups[1]] });
    expect(priceSelection(c, ["foundation"], "monthly").plan).toBe("full");
  });
  it("a plan the proposal does not allow falls back to the allowed one", () => {
    const c = proposalContentSchema.parse({ ...content, payment: { plan: "monthly" } });
    expect(priceSelection(c, ["starter", "foundation"], "full").plan).toBe("monthly");
  });
  it("auto-pay never stops before the longest package term", () => {
    const c = (end: number | null) => proposalContentSchema.parse({ ...content, payment: { plan: "monthly", endAfterMonths: end } });
    const t = priceSelection(c(1), ["starter", "foundation"], "monthly");
    expect(autoPayMonths(c(1), t)).toBe(6);
    expect(autoPayMonths(c(12), t)).toBe(12);
    expect(autoPayMonths(c(null), t)).toBeNull();
  });
  it("rejects bad selections", () => {
    expect(selectionProblems(content, ["starter", "pro", "foundation"])).toContain("Choose only one option in “SEO program”.");
    expect(selectionProblems(content, ["foundation"])).toContain("Choose an option in “SEO program”.");
    expect(selectionProblems(content, ["starter"])[0]).toMatch(/Foundation is included/);
    expect(selectionProblems(content, ["starter", "foundation", "nope"])[0]).toMatch(/no longer offered/);
    expect(selectionProblems(content, ["starter", "foundation"])).toEqual([]);
  });
  it("card fee is 3% rounded to the cent; ACH pays none", () => {
    expect(cardFeeCents(600_000, 300)).toBe(18_000);
    expect(cardFeeCents(12_345, 300)).toBe(370);
    expect(cardFeeCents(600_000, 0)).toBe(0);
  });
  it("auto-pay bills each monthly service for its own term, the longest until cancelled (the Tutty contract)", () => {
    const c = proposalContentSchema.parse({ payment: { plan: "monthly", cardFeeBps: 300 }, groups: [
      { id: "on", name: "Onboarding", items: [{ id: "fee", name: "Onboarding", priceCents: 350_000, included: true }] },
      { id: "seo", name: "SEO", items: [{ id: "starter", name: "Starter SEO", priceCents: 250_000, billing: "monthly", termMonths: 6 }] },
      { id: "add", name: "Add-ons", select: "many", items: [{ id: "email", name: "Email outreach", priceCents: 100_000, billing: "monthly", termMonths: 1 }] },
    ] });
    const t = priceSelection(c, ["fee", "starter", "email"], "monthly");
    expect(t.dueTodayCents).toBe(350_000 + 250_000 + 100_000);
    expect(t.contractTotalCents).toBe(350_000 + 250_000 * 6 + 100_000);
    const open = autoPaySchedule(c, t);
    expect(open).toEqual([{ fromMonth: 2, toMonth: null, lines: [{ itemId: "starter", name: "Starter SEO", priceCents: 250_000 }], cents: 250_000 }]);
    expect(autoPayLines(open)).toEqual(["Month 2 on, until cancelled: $2,500.00/mo"]);
    expect(autoPayLines(open, 300)).toEqual(["Month 2 on, until cancelled: $2,575.00/mo"]);
    // A fixed end: months 2–6 are the contract; dueToday + those = the contract total.
    const fixed = autoPaySchedule(proposalContentSchema.parse({ ...c, payment: { plan: "monthly", endAfterMonths: 6 } }), t);
    expect(fixed).toEqual([{ fromMonth: 2, toMonth: 6, lines: [{ itemId: "starter", name: "Starter SEO", priceCents: 250_000 }], cents: 250_000 }]);
    expect(t.dueTodayCents + fixed.reduce((s, p) => s + p.cents * (p.toMonth! - p.fromMonth + 1), 0)).toBe(t.contractTotalCents);
  });
  it("auto-pay phases step down as shorter terms end", () => {
    const c = proposalContentSchema.parse({ payment: { plan: "choice", endAfterMonths: 6 }, groups: [
      { id: "g", name: "G", select: "many", items: [
        { id: "a", name: "A", priceCents: 100_00, billing: "monthly", termMonths: 6 },
        { id: "b", name: "B", priceCents: 50_00, billing: "monthly", termMonths: 3 },
      ] },
    ] });
    const ph = autoPaySchedule(c, priceSelection(c, ["a", "b"], "monthly"));
    expect(ph.map((p) => [p.fromMonth, p.toMonth, p.cents])).toEqual([[2, 3, 150_00], [4, 6, 100_00]]);
    expect(autoPaySchedule(c, priceSelection(c, ["a", "b"], "full"))).toEqual([]);
  });
  it("balance: paid and clearing payments count; failed ones don't", () => {
    const b = paymentBalance(1_555_000, [
      { amountCents: 900_000, status: "paid" }, { amountCents: 300_000, status: "processing" }, { amountCents: 200_000, status: "failed" },
    ]);
    expect(b).toEqual({ dueTodayCents: 1_555_000, paidCents: 900_000, pendingCents: 300_000, remainingCents: 355_000 });
    expect(paymentBalance(100, [{ amountCents: 100, status: "paid" }]).remainingCents).toBe(0);
  });
  it("a plan of 1-month services has no auto-pay after today", () => {
    const c = proposalContentSchema.parse({ payment: { plan: "monthly" }, groups: [
      { id: "g", name: "G", items: [{ id: "a", name: "A", priceCents: 100_00, billing: "monthly", termMonths: 1, included: true }] },
    ] });
    expect(autoPaySchedule(c, priceSelection(c, ["a"], "monthly"))).toEqual([]);
  });
  it("adding months clamps the day to the month's end", () => {
    expect(addMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(addMonths(new Date("2026-10-25T06:00:00Z"), 5).toISOString()).toBe("2027-03-25T06:00:00.000Z");
  });
});
