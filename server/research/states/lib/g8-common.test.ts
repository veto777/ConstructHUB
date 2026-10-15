import { describe, expect, it } from "vitest";
import { anyDay } from "./g8-common";

describe("g8 dates (round 2, decision 13)", () => {
  it("reads four-digit years and ISO dates; a two-digit year gets no guessed century", () => {
    expect(anyDay("03/31/2026")).toBe("2026-03-31");
    expect(anyDay("2026-03-31T00:00:00")).toBe("2026-03-31");
    expect(anyDay("3-31-26")).toBeNull();
    expect(anyDay("03/31/99")).toBeNull();
    expect(anyDay("")).toBeNull();
  });
});
