import { describe, expect, it } from "vitest";
import { researchOrderSchema } from "@shared/research-reports";
import { orderView, type ResearchOrderRow } from "./store";

// The order form's "Anything else we should know" note: optional, up to 500 characters, stored in the
// order's input and shown on the order page and in the team's paid-order email. It never changes the
// price (RESEARCH_TIERS) or the trades the bot searches (trades stay the priced enum).
const order = {
  subjects: [{ name: "Ridge Roofing LLC", kind: "company" }], states: ["FL"],
  agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true,
};

describe("research order note", () => {
  it("is optional and trimmed, and defaults to empty", () => {
    expect(researchOrderSchema.parse(order).notes).toBe("");
    expect(researchOrderSchema.parse({ ...order, notes: "  Also trades as Ridge Roofing & Gutters.  " }).notes).toBe("Also trades as Ridge Roofing & Gutters.");
    expect(researchOrderSchema.parse({ ...order, notes: "x".repeat(500) }).notes).toHaveLength(500);
    // Plain text: control characters go, line breaks stay.
    expect(researchOrderSchema.parse({ ...order, notes: "line one\u0007\u001b\nline two" }).notes).toBe("line one\nline two");
  });
  it("refuses more than 500 characters and a non-string", () => {
    const long = researchOrderSchema.safeParse({ ...order, notes: "x".repeat(501) });
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0].message).toBe("Notes is too long");
    expect(researchOrderSchema.safeParse({ ...order, notes: 42 }).success).toBe(false);
  });
  it("does not change the tier, and a trade outside the priced list is still refused", () => {
    const withNote = researchOrderSchema.parse({ ...order, notes: "please hurry" });
    expect(withNote.subjects).toHaveLength(1);
    expect(withNote.trades).toEqual([]);
    expect(researchOrderSchema.safeParse({ ...order, trades: ["welding"] }).success).toBe(false);
  });
  it("reaches the order page through orderView, and an older order without one still reads", () => {
    const row = (input: unknown): ResearchOrderRow => ({
      id: 7, user_id: 1, email: "a@b.c", status: "paid", tier: "standard", price_cents: 49900, input: input as any, preview: null, report: null,
      error: null, stripe_session_id: null, created_at: new Date("2026-10-15T00:00:00Z"), paid_at: null, started_at: null, completed_at: null,
    });
    expect(orderView(row(researchOrderSchema.parse({ ...order, notes: "two names on the truck" }))).input.notes).toBe("two names on the truck");
    const legacy = orderView(row({ subjects: order.subjects, states: order.states, trades: [], sinceYear: null, purpose: "", agreeNonRefundable: true, agreeNoGuarantee: true, agreeNotFcra: true }));
    expect(legacy.input.notes).toBeUndefined();
    expect("agreeNotFcra" in legacy.input).toBe(false);
  });
});
