/** The phone tab bars (shared/tab-bar.ts): what a saved choice becomes on screen. */
import { describe, expect, it } from "vitest";
import { CRM_TAB_DEFAULT, CRM_TAB_OPTIONS, PLATFORM_TAB_DEFAULT, PLATFORM_TAB_OPTIONS, TAB_SLOTS, cleanTabChoice, resolveTabs } from "../shared/tab-bar";

const keys = (t: { key: string }[]) => t.map((x) => x.key);

describe("phone tab bar choices (owner 2026-10-04: pick what's in the lower ribbon)", () => {
  it("cleans a saved choice: known keys, no repeats, at most four; nothing usable → the default", () => {
    expect(cleanTabChoice(["calls", "calls", "nope", "posts", "rankings", "agency", "settings"], PLATFORM_TAB_OPTIONS)).toEqual(["calls", "posts", "rankings", "agency"]);
    expect(cleanTabChoice([], PLATFORM_TAB_OPTIONS)).toBeNull();
    expect(cleanTabChoice("calls", PLATFORM_TAB_OPTIONS)).toBeNull();
    expect(keys(resolveTabs(null, PLATFORM_TAB_OPTIONS, PLATFORM_TAB_DEFAULT))).toEqual([...PLATFORM_TAB_DEFAULT]);
  });

  it("shows the person's order; fewer than four are topped up from the defaults", () => {
    expect(keys(resolveTabs(["settings", "calls", "posts", "home"], PLATFORM_TAB_OPTIONS, PLATFORM_TAB_DEFAULT))).toEqual(["settings", "calls", "posts", "home"]);
    expect(keys(resolveTabs(["posts"], PLATFORM_TAB_OPTIONS, PLATFORM_TAB_DEFAULT))).toEqual(["posts", "home", "calls", "reviews"]);
  });

  it("a CRM tab the person can't open is never shown, and the bar stays full", () => {
    const fieldCrew = (o: { perm?: string }) => !o.perm; // no manageCustomers, no seePrices
    const tabs = keys(resolveTabs(["inbox", "invoices", "clients"], CRM_TAB_OPTIONS, CRM_TAB_DEFAULT, fieldCrew));
    expect(tabs).not.toContain("inbox");
    expect(tabs).not.toContain("invoices");
    expect(tabs[0]).toBe("clients");
    expect(tabs).toHaveLength(TAB_SLOTS);
  });
});
