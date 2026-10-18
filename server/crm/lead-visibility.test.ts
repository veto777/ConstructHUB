/** shared/lead-visibility.ts — who may see which leads, by state or market. */
import { describe, it, expect } from "vitest";
import { leadVisibilityOf, memberLeadRule, leadAllowed } from "@shared/lead-visibility";

const cf = { leadVisibility: {
  m1: { states: ["fl"], markets: [] },
  m2: { states: [], markets: ["bellingham", "lynden"], unknownToo: true },
  m3: { states: [], markets: [] },          // empty = no rule
  m4: "junk",
} };

describe("lead visibility rules", () => {
  it("parses rules, normalizes states, drops empty and junk ones", () => {
    const rules = leadVisibilityOf(cf);
    expect(Object.keys(rules).sort()).toEqual(["m1", "m2"]);
    expect(rules.m1).toEqual({ states: ["FL"], markets: [], unknownToo: false });
    expect(memberLeadRule(cf, "m3")).toBeNull();
    expect(memberLeadRule(null, "m1")).toBeNull();
  });
  it("a lead passes by state OR by market; an unplaced lead is hidden unless the rule says otherwise", () => {
    const fl = memberLeadRule(cf, "m1"); const wa = memberLeadRule(cf, "m2");
    expect(leadAllowed(fl, { state: "FL", market: "tampa" })).toBe(true);
    expect(leadAllowed(fl, { state: "WA", market: "unknown" })).toBe(false);
    expect(leadAllowed(fl, { state: "??", market: "unknown" })).toBe(false);
    expect(leadAllowed(wa, { state: "WA", market: "lynden" })).toBe(true);
    expect(leadAllowed(wa, { state: "WA", market: "unknown" })).toBe(false); // WA alone is not enough for a market rule
    expect(leadAllowed(wa, { state: "??", market: "unknown" })).toBe(true);  // unknownToo
    expect(leadAllowed(null, { state: "??", market: "unknown" })).toBe(true); // no rule → everything
  });
});
