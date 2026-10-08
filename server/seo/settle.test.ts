import { afterEach, describe, expect, it } from "vitest";
import { budgetDeps, settleBudget, type BudgetReservation } from "./budget";

const original = budgetDeps.settleCredits;
afterEach(() => { budgetDeps.settleCredits = original; });

/** A reservation whose estimate equals the actual cost, so settling never touches the database. */
const reservation = (): BudgetReservation => ({
  userId: 1, month: "2026-10", estimateUsd: 0.05,
  credit: { userId: 1, month: "2026-10", fromIncluded: 20, fromWallet: 0, allowanceCents: 1000 },
});

describe("settleBudget", () => {
  it("settles a reservation exactly once — a second settlement cannot refund it again", async () => {
    const charged: number[] = [];
    budgetDeps.settleCredits = async (_r, cents) => { charged.push(cents); };
    const r = reservation();
    await settleBudget(r, 0.05);
    await settleBudget(r, 0.05, 0);
    await settleBudget(r, 0.05, 0);
    expect(charged).toEqual([20]);
    expect(r.settled).toBe(true);
  });
  it("charges the customer nothing for a failed call while keeping our own cost", async () => {
    const charged: number[] = [];
    budgetDeps.settleCredits = async (_r, cents) => { charged.push(cents); };
    await settleBudget(reservation(), 0.05, 0);
    expect(charged).toEqual([0]);
  });
  it("a failed credit settlement does not throw away the rest of the settlement", async () => {
    budgetDeps.settleCredits = async () => { throw new Error("db down"); };
    await expect(settleBudget(reservation(), 0.05)).resolves.toBeUndefined();
  });
});
