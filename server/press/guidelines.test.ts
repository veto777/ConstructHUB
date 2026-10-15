import { describe, it, expect } from "vitest";
import { checkRelease, hasBlockingIssue, outsideQuotes } from "./guidelines";
import { PRESS_PACKAGES, PRESS_PROGRAM_CREDITS, PRESS_RELEASE_PRICE_CENTS, PRESS_WIRE_RATE_CENTS, pressPackagePrice } from "@shared/press";
import type { PressReleaseText } from "@shared/press";

const input = { companyName: "Ridgeline Roofing", contactEmail: "dana@ridgeline.example", details: "We added a second repair crew on November 1 after storm repair requests doubled.", quoteNotes: "", about: "Roofing since 2014 in Whatcom County." };
const good: PressReleaseText = {
  headline: "Ridgeline Roofing Adds a Second Repair Crew in Whatcom County",
  subheadline: "The Bellingham roofer answers a year of storm damage with a dedicated repair team",
  dateline: "BELLINGHAM, WA / October 15, 2026 /",
  body: Array(6).fill("Ridgeline Roofing today announced a second full-time crew dedicated to roof repairs and storm response, starting November 1. Repair requests more than doubled after the February and September wind storms, and homeowners were waiting up to three weeks for a leak repair. The company expects the new crew to bring that wait to under five business days. “Nobody with a leak wants to hear three weeks,” said Dana Ortiz, owner of Ridgeline Roofing. “We built this crew so a homeowner gets a tarp the same day.”").join("\n\n"),
  boilerplate: "About Ridgeline Roofing\nRidgeline Roofing is a residential roofing contractor in Bellingham, Washington, founded in 2014.",
  mediaContact: "Dana Ortiz\nRidgeline Roofing\ndana@ridgeline.example\n(360) 555-0142",
};

describe("press guidelines", () => {
  it("passes a clean AP-style release", () => {
    const issues = checkRelease(good, input);
    expect(issues.filter((i) => i.blocking)).toEqual([]);
  });

  it("flags hype, exclamation marks, caps and direct address outside quotes as blocking", () => {
    const bad = { ...good, headline: "AMAZING News: Ridgeline Roofing Is the Best!", body: `${good.body}\n\nYou should call us today for a free estimate.` };
    const issues = checkRelease(bad, input);
    const rules = issues.filter((i) => i.blocking).map((i) => i.rule);
    expect(rules).toContain("Exclamation marks");
    expect(rules).toContain("All-caps emphasis");
    expect(rules).toContain("Hype or spam words");
    expect(rules).toContain("Direct address outside quotes");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("first person inside a quote is fine; outside it is not", () => {
    expect(outsideQuotes('He said, “We are proud.” The company grew.')).not.toMatch(/\bWe\b/);
    const issues = checkRelease({ ...good, body: `${good.body}\n\nWe are proud of the team.` }, input);
    expect(issues.some((i) => i.rule === "Direct address outside quotes")).toBe(true);
  });

  it("needs the source near the top and a contact email", () => {
    const noName = checkRelease({ ...good, headline: "A Second Repair Crew Starts in November", subheadline: "", body: good.body.replace(/Ridgeline Roofing/g, "The company") }, input);
    expect(noName.some((i) => i.rule === "Clear source attribution" && i.blocking)).toBe(true);
    const noEmail = checkRelease({ ...good, mediaContact: "Dana Ortiz\n(360) 555-0142" }, { ...input, contactEmail: "" });
    expect(noEmail.some((i) => i.rule === "Valid media contact" && i.blocking)).toBe(true);
  });

  it("flags restricted topics from the customer's own words, blocking only where the wire refuses", () => {
    const crypto = checkRelease(good, { ...input, details: "We now accept bitcoin for roof repairs." });
    expect(crypto.find((i) => i.rule === "Cryptocurrency")?.blocking).toBe(false);
    const google = checkRelease(good, { ...input, details: "We are now a Google Partner and endorsed by Google." });
    expect(google.find((i) => i.rule === "Association with Google")?.blocking).toBe(true);
    const deal = checkRelease(good, { ...input, details: "We signed a deal with Acme Supply, a partnership with them for 2027." });
    expect(deal.some((i) => i.rule === "Partnership, deal, acquisition or funding")).toBe(true);
  });

  it("never lets the release name AI, the wire or ConstructHUB", () => {
    const issues = checkRelease({ ...good, boilerplate: `${good.boilerplate} This release was written with AI by ConstructHUB.` }, input);
    expect(issues.some((i) => i.rule === "Authorship" && i.blocking)).toBe(true);
  });
});

describe("press prices (owner, 2026-10-15)", () => {
  it("charges double the wire's rate; the program pays for 12 and gets 14", () => {
    expect(PRESS_RELEASE_PRICE_CENTS.budget).toBe(PRESS_WIRE_RATE_CENTS.budget * 2);
    expect(PRESS_RELEASE_PRICE_CENTS.premium).toBe(PRESS_WIRE_RATE_CENTS.premium * 2);
    const program = PRESS_PACKAGES.find((p) => p.key === "program_12")!;
    expect(program.credits).toBe(PRESS_PROGRAM_CREDITS);
    expect(pressPackagePrice(program, "budget")).toBe(PRESS_RELEASE_PRICE_CENTS.budget * 12);
    expect(pressPackagePrice(program, "premium")).toBe(PRESS_RELEASE_PRICE_CENTS.premium * 12);
    expect(PRESS_PACKAGES.length).toBe(3);
  });
});
