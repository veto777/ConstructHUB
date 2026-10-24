import { describe, expect, it } from "vitest";
import { priceSelection, standardTerms } from "@shared/proposals";
import { toContent } from "./import";

describe("proposal from a PDF", () => {
  const raw = {
    brand: { name: "News Media House", contactEmail: "support@newsmediahouse.com" },
    title: "Reputation Restoration", recipient: { name: "Dr. Example", company: "Example Clinic", email: "not-an-email" },
    sections: [{ eyebrow: "01 / Overview", heading: "The opportunity", body: "Text.\n\n- one\n- two" }, { heading: "", body: "" }],
    groups: [
      { name: "Press releases", select: "one", items: [{ name: "Standard", price: 8550, billing: "one_time" }, { name: "National", price: 15570, recommended: true }, { name: "National", price: 1297.5, recommended: true }, { name: "Included extra", price: 0 }] },
      { name: "Reputation services", select: "many", items: [{ name: "Monthly program", price: 500, billing: "monthly", termMonths: 6 }, { name: "" }] },
      { name: "Empty", items: [] },
    ],
    proposalTerms: ["Six-month minimum commitment."],
  };
  const { content, recipient } = toContent(raw, "ConstructHUB");

  it("keeps the sections and drops empty ones", () => {
    expect(content.sections.map((s) => s.heading)).toEqual(["The opportunity"]);
  });
  it("turns every priced service into an option with cents, unique ids and recommendations pre-selected", () => {
    expect(content.groups.map((g) => g.name)).toEqual(["Press releases", "Reputation services"]);
    const pr = content.groups[0];
    expect(pr.select).toBe("one");
    expect(pr.items.map((i) => i.priceCents)).toEqual([855_000, 1_557_000, 129_750]);
    expect(new Set(pr.items.map((i) => i.id)).size).toBe(3);
    expect(pr.items[1]).toMatchObject({ defaultSelected: true, badge: "Recommended" });
    // a pick-one group keeps only its first recommendation, and an item without a price is dropped
    expect(pr.items[2]).toMatchObject({ defaultSelected: false, badge: "" });
    expect(content.groups[1].items).toHaveLength(1);
    expect(content.groups[1].items[0]).toMatchObject({ billing: "monthly", termMonths: 6, priceCents: 50_000 });
    expect(priceSelection(content, [pr.items[1].id, content.groups[1].items[0].id], "monthly").contractTotalCents).toBe(1_557_000 + 300_000);
  });
  it("puts the PDF's own terms first, then the standard agreement", () => {
    expect(content.terms.startsWith("TERMS FROM THIS PROPOSAL")).toBe(true);
    expect(content.terms).toContain("- Six-month minimum commitment.");
    expect(content.terms).toContain(standardTerms("News Media House"));
  });
  it("ignores an invalid recipient email", () => {
    expect(recipient).toEqual({ name: "Dr. Example", company: "Example Clinic", email: "not-an-email" });
  });
});

describe("a PDF with its own numbered terms", () => {
  it("makes them the clauses the client initials, without the standard agreement", () => {
    const { content } = toContent({ title: "T", groups: [{ name: "SEO", select: "one", items: [{ name: "Starter", price: 2500, billing: "monthly", termMonths: 6 }] }],
      clauses: [{ heading: "1. Initial commitment", body: "Six months." }, { heading: "", body: "" }], proposalTerms: [] }, "Acme");
    expect(content.clauses).toEqual([{ id: "c1", heading: "1. Initial commitment", body: "Six months.", initials: true }]);
    expect(content.terms).toBe("");
  });
});

describe("standard terms", () => {
  it("say nothing is guaranteed, there are no refunds, and the work is proven", () => {
    const t = standardTerms("Acme");
    expect(t).toMatch(/do not guarantee/);
    expect(t).toMatch(/non-refundable/);
    expect(t).toMatch(/Proof of work/);
    expect(t).toContain("Acme");
  });
});

describe("initial boxes", () => {
  it("is one box for all the terms unless the proposal asks for one per clause", async () => {
    const { initialTargets, proposalContentSchema } = await import("@shared/proposals");
    const c = proposalContentSchema.parse({ clauses: [{ id: "c1", heading: "1" }, { id: "c2", heading: "2" }, { id: "c3", heading: "3", initials: false }] });
    expect(initialTargets(c)).toEqual([{ id: "all", heading: "Program terms" }]);
    expect(initialTargets({ ...c, clauseInitials: "each" }).map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(initialTargets({ ...c, clauses: [] })).toEqual([]);
  });
});
