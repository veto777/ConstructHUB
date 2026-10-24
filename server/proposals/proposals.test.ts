import { describe, expect, it } from "vitest";
import { cardFeeCents, defaultSelection, priceSelection, proposalContentSchema, selectionProblems } from "@shared/proposals";

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
  it("pre-selects included and default items, one per pick-one group", () => {
    expect(defaultSelection(content).sort()).toEqual(["foundation", "starter"]);
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
});
