import { describe, it, expect } from "vitest";
import { pollWithinBudget } from "./polling";

/** The refetchInterval callback receives the query; only its error state matters here. */
const queryWith = (message?: string) =>
  ({
    state: { error: message == null ? null : new Error(message) },
  }) as never;

describe("pollWithinBudget", () => {
  it("polls at the base cadence when the last fetch succeeded or failed ordinarily", () => {
    expect(pollWithinBudget(20_000)(queryWith())).toBe(20_000);
    expect(pollWithinBudget(15_000)(queryWith("500: boom"))).toBe(15_000);
  });
  it("stops polling entirely on a plan_required answer", () => {
    expect(
      pollWithinBudget(20_000)(
        queryWith(
          '402: {"code":"plan_required","requiredPlan":"agency","message":"Domains + Mail Alerts is included with the Agency plan."}',
        ),
      ),
    ).toBe(false);
  });
  it("backs off for a whole window after a 429 instead of re-hitting the limiter", () => {
    expect(
      pollWithinBudget(20_000)(
        queryWith('429: {"message":"Request limit reached. Please try again later."}'),
      ),
    ).toBe(60_000);
  });
});
