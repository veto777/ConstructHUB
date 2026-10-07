/** server/data/permit-routing.json — "permits for <place> are issued by <county or town>" — must stay honest. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const routes: { jurisdiction: string; issuedBy: string; sourceUrl: string; quote: string }[] =
  JSON.parse(readFileSync("server/data/permit-routing.json", "utf8"));
const portals: { jurisdiction: string; url: string | null }[] = JSON.parse(readFileSync("server/data/permit-portals.json", "utf8"));
const live = new Set(portals.filter((p) => p.url).map((p) => p.jurisdiction));

describe("county permit links", () => {
  it("each points at a county or town with a live portal, for a place without its own, with an official source and a real quote", () => {
    const seen = new Set<string>();
    for (const r of routes) {
      expect(seen.has(r.jurisdiction), `duplicate ${r.jurisdiction}`).toBe(false); seen.add(r.jurisdiction);
      expect(r.jurisdiction.slice(-2), r.jurisdiction).toBe(r.issuedBy.slice(-2));
      // The issuer is the county, or (since the 2026-10 fact-check) a town/township with its own permit office; either way
      // it must be a directory jurisdiction with a live portal (checked below) in the same state.
      expect(r.issuedBy, r.jurisdiction).toMatch(/, [A-Z]{2}$/);
      expect(live.has(r.issuedBy), `${r.jurisdiction}: ${r.issuedBy} has no live portal`).toBe(true);
      expect(live.has(r.jurisdiction), `${r.jurisdiction} has its own portal`).toBe(false);
      expect(r.sourceUrl, r.jurisdiction).toMatch(/^https?:\/\//);
      expect(r.sourceUrl, r.jurisdiction).not.toMatch(/wikipedia|facebook\.com|archive\.org/i);
      expect(r.quote.replace(/[^a-z0-9]/gi, "").length, r.jurisdiction).toBeGreaterThanOrEqual(12);
    }
    expect(routes.length).toBeGreaterThan(800);
  });
});
