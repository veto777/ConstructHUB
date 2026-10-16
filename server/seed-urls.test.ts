/** Seed permit-portal URLs must be real: none of the known-dead ones, and each one either verified in
 *  permit-portals.json or explicitly flagged for verification (CLAUDE.md HARD RULE). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { ALL_DATABASES } from "./seed-all-states";
import { NORTHERN_WA_DATABASES } from "./seed";
import {
  DEAD_SEED_URLS, SEED_URLS_PENDING_VERIFICATION, planDeadSeedFix, portalKeyFor, correctDeadSeedUrls, type PortalEntry,
} from "./seed-dead-urls";

const portals: PortalEntry[] = JSON.parse(readFileSync("server/data/permit-portals.json", "utf8"));
const portalUrls = new Set(portals.map((p) => p.url).filter(Boolean) as string[]);
const dead = new Set(DEAD_SEED_URLS);
const pending = new Set(SEED_URLS_PENDING_VERIFICATION);
const seedRows = [...ALL_DATABASES, ...NORTHERN_WA_DATABASES] as { name: string; portalUrl: string | null; searchUrl: string | null }[];
const seedUrls = seedRows.flatMap((d) => [d.portalUrl, d.searchUrl].map((u) => ({ name: d.name, u }))).filter((x) => x.u) as { name: string; u: string }[];

describe("seed permit-portal URLs", () => {
  it("contain no known-dead URL", () => {
    for (const { name, u } of seedUrls) expect(dead.has(u), `${name}: ${u} is dead`).toBe(false);
    expect(seedUrls.length).toBeGreaterThan(100);
  });

  it("are each verified in permit-portals.json or flagged for verification", () => {
    for (const { name, u } of seedUrls) {
      expect(portalUrls.has(u) || pending.has(u), `${name}: ${u} is neither in permit-portals.json nor flagged`).toBe(true);
    }
  });

  it("keep the lists honest: dead ≠ verified ≠ pending, and no stale pending entries", () => {
    for (const u of DEAD_SEED_URLS) {
      expect(portalUrls.has(u), `${u} is dead but listed in permit-portals.json`).toBe(false);
      expect(pending.has(u), `${u} is both dead and pending`).toBe(false);
    }
    const used = new Set(seedUrls.map((x) => x.u));
    for (const u of SEED_URLS_PENDING_VERIFICATION) expect(used.has(u), `${u} is flagged but no longer seeded`).toBe(true);
    expect(dead.size).toBe(DEAD_SEED_URLS.length);
  });
});

describe("planDeadSeedFix", () => {
  const D = "https://aca-prod.accela.com/HOUSTON/";
  const byKey = (entries: PortalEntry[]) => { const m = new Map<string, PortalEntry[]>(); for (const p of entries) m.set(p.jurisdiction, [...(m.get(p.jurisdiction) || []), p]); return m; };
  const deadSet = new Set([D, "https://skagitcountywa.gov/Search/Permits/SearchAdvanced.aspx"]);
  const city = { jurisdiction: "Houston, TX", jurisdictionType: "city", countyName: "Harris", stateCode: "TX", portalUrl: D, searchUrl: D };

  it("takes the permit-portals.json entry for the same jurisdiction", () => {
    const fix = planDeadSeedFix(city, byKey([{ jurisdiction: "Houston, TX", url: "https://www.houstonpermittingcenter.org/", platform: "Custom", linkStatus: "verified", lastVerifiedAt: "2026-10-05T00:00:00.000Z" }]), deadSet);
    expect(fix).toMatchObject({ portalUrl: "https://www.houstonpermittingcenter.org/", searchUrl: "https://www.houstonpermittingcenter.org/", linkStatus: "verified", isActive: true });
  });

  it("nulls the link (dead, inactive) when no source entry exists — never a guess", () => {
    expect(planDeadSeedFix(city, byKey([]), deadSet)).toMatchObject({ portalUrl: null, searchUrl: null, platform: null, linkStatus: "dead", isActive: false });
  });

  it("only clears the dead field when the other link is not dead", () => {
    const fix = planDeadSeedFix({ jurisdiction: "Skagit County, WA", jurisdictionType: "county", countyName: "Skagit", stateCode: "WA",
      portalUrl: "https://www.skagitcounty.net/Departments/PlanningAndPermit/permitsearch.htm", searchUrl: "https://skagitcountywa.gov/Search/Permits/SearchAdvanced.aspx" }, byKey([]), deadSet);
    expect(fix).toEqual({ portalUrl: "https://www.skagitcounty.net/Departments/PlanningAndPermit/permitsearch.htm", searchUrl: null });
  });

  it("leaves rows without a dead URL alone", () => {
    expect(planDeadSeedFix({ ...city, portalUrl: "https://example.gov/", searchUrl: null }, byKey([]), deadSet)).toBeNull();
  });

  it("never hands a county row its city's portal", () => {
    expect(portalKeyFor({ jurisdiction: "Winston-Salem, NC", jurisdictionType: "county", countyName: "Forsyth", stateCode: "NC" })).toBe("Forsyth County, NC");
    expect(portalKeyFor({ jurisdiction: "Jefferson Parish, LA", jurisdictionType: "county", countyName: "Jefferson", stateCode: "LA" })).toBe("Jefferson Parish, LA");
    expect(portalKeyFor({ jurisdiction: "Baton Rouge, LA", jurisdictionType: "city", countyName: "East Baton Rouge", stateCode: "LA" })).toBe("Baton Rouge, LA");
    const fix = planDeadSeedFix({ ...city, jurisdiction: "Winston-Salem, NC", jurisdictionType: "county", countyName: "Forsyth", stateCode: "NC" },
      byKey([{ jurisdiction: "Winston-Salem, NC", url: "https://city.example/", platform: null, linkStatus: "verified" }]), deadSet);
    expect(fix).toMatchObject({ portalUrl: null, linkStatus: "dead" });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("correctDeadSeedUrls (database)", () => {
  it("corrects rows still holding a dead seed URL, leaves others alone, and is idempotent", async () => {
    const { pool } = await import("./db");
    const tag = `seed-url-test-${process.pid}-${Date.now()}`;
    const c = await pool.query("INSERT INTO counties (name, state, state_code) VALUES ($1, 'Testland', 'ZZ') RETURNING id", [tag]);
    const countyId = c.rows[0].id;
    try {
      const ins = (j: string, url: string | null, search: string | null) => pool.query(
        `INSERT INTO permit_databases (name, jurisdiction, jurisdiction_type, county_id, portal_url, search_url, platform, is_active, link_status)
         VALUES ($1, $2, 'city', $3, $4, $5, 'Accela', true, 'unchecked') RETURNING id`, [tag, j, countyId, url, search]).then((r) => r.rows[0].id);
      const deadId = await ins(`${tag} A, ZZ`, DEAD_SEED_URLS[0], DEAD_SEED_URLS[0]);
      const partId = await ins(`${tag} B, ZZ`, "https://keep.example.gov/", DEAD_SEED_URLS[1]);
      const okId = await ins(`${tag} C, ZZ`, "https://keep.example.gov/", "https://keep.example.gov/");

      const first = await correctDeadSeedUrls();
      expect(first.nulled).toBeGreaterThanOrEqual(1);
      expect(first.partial).toBeGreaterThanOrEqual(1);
      const rows = new Map((await pool.query("SELECT * FROM permit_databases WHERE county_id=$1", [countyId])).rows.map((r) => [r.id, r]));
      expect(rows.get(deadId)).toMatchObject({ portal_url: null, search_url: null, platform: null, link_status: "dead", is_active: false });
      expect(rows.get(partId)).toMatchObject({ portal_url: "https://keep.example.gov/", search_url: null, link_status: "unchecked" });
      expect(rows.get(okId)).toMatchObject({ portal_url: "https://keep.example.gov/", search_url: "https://keep.example.gov/", platform: "Accela", link_status: "unchecked" });

      expect(await correctDeadSeedUrls()).toEqual({ nulled: 0, replaced: 0, partial: 0 });
      const left = await pool.query("SELECT count(*)::int AS n FROM permit_databases WHERE portal_url = ANY($1) OR search_url = ANY($1)", [DEAD_SEED_URLS]);
      expect(left.rows[0].n).toBe(0);
    } finally {
      await pool.query("DELETE FROM permit_databases WHERE county_id=$1", [countyId]);
      await pool.query("DELETE FROM counties WHERE id=$1", [countyId]);
    }
  });
});
