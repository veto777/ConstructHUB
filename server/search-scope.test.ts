import { describe, expect, it } from "vitest";

// Kimi QA: /search said "5 searchable portals in Florida" while the search ran 14 —
// the page counted a 100-row page of the directory. It now asks the server for the
// state's live-searchable portals, which must be exactly the nationwide
// searchable list narrowed to that state's counties.
const base = process.env.CRM_TEST_BASE_URL || "http://127.0.0.1:8149";

describe("GET /api/databases?searchable=true&stateCode=", () => {
  it("returns every live-searchable portal in the state and nothing else", async () => {
    const counties: { id: number; stateCode: string }[] = await (await fetch(`${base}/api/counties`)).json();
    const all: { id: number; countyId: number }[] = await (await fetch(`${base}/api/databases?searchable=true`)).json();
    const stateOf = new Map(counties.map(c => [c.id, c.stateCode]));
    const busiest = [...all.reduce((m, d) => m.set(stateOf.get(d.countyId)!, (m.get(stateOf.get(d.countyId)!) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(busiest, "at least one searchable portal in the dev DB").toBeTruthy();
    for (const code of [busiest!, busiest!.toLowerCase()]) {
      const res = await fetch(`${base}/api/databases?searchable=true&stateCode=${code}`);
      expect(res.status).toBe(200);
      const scoped: { id: number; countyId: number }[] = await res.json();
      expect(scoped.map(d => d.id).sort()).toEqual(all.filter(d => stateOf.get(d.countyId) === busiest).map(d => d.id).sort());
    }
    // An unknown state has no portals; a malformed code is refused, never widened to nationwide.
    expect(await (await fetch(`${base}/api/databases?searchable=true&stateCode=ZZ`)).json()).toEqual([]);
    expect((await fetch(`${base}/api/databases?searchable=true&stateCode=%27;--`)).status).toBe(400);
  });
});
