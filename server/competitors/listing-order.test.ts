/**
 * The competitor listing order (GET /api/competitors/scans/:id) and the indexes the DB review
 * (w3-r8, 2026-10-15) added for it and the agency status filters.
 *
 * - static: scripts/apply-schema-migration.ts and the boot DDL both list every new index, so a
 *   migrated box and a fresh box end up with the same catalog.
 * - DB (needs DATABASE_URL): a non-numeric rating must sort last instead of throwing on ::numeric.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { competitorListings } from "@shared/schema";
import { listingOrder, RATING_NUMERIC_PATTERN } from "./listing-order";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const INDEXES: Array<[name: string, table: string, bootFile: string]> = [
  ["competitor_listings_scan_idx", "competitor_listings", "server/competitors/schema.ts"],
  ["competitor_scans_user_idx", "competitor_scans", "server/competitors/schema.ts"],
  ["google_profile_reviews_unanswered_idx", "google_profile_reviews", "server/gbp/schema.ts"],
  ["gbp_content_jobs_location_status_idx", "gbp_content_jobs", "server/gbp/content.ts"],
  ["agency_jobs_owner_created_idx", "agency_jobs", "server/agency/schema.ts"],
  ["agency_onboarding_owner_created_idx", "agency_onboarding", "server/agency/schema.ts"],
];

const createIdx = (name: string, table: string) =>
  new RegExp(String.raw`CREATE INDEX IF NOT EXISTS ${name} ON ${table}\s*\(`);

describe("w3-r8 indexes are declared idempotently", () => {
  const migration = read("scripts/apply-schema-migration.ts");
  for (const [name, table, bootFile] of INDEXES) {
    it(`${name}: in the migration script and in ${bootFile}`, () => {
      expect(migration).toMatch(createIdx(name, table));
      expect(read(bootFile)).toMatch(createIdx(name, table));
    });
  }
  it("the reviews index is partial on the exact statusSql.unanswered predicate", () => {
    const predicate = /google_profile_reviews_unanswered_idx[^;`]*WHERE NOT google_deleted AND reply_comment IS NULL/;
    expect(migration).toMatch(predicate);
    expect(read("server/gbp/schema.ts")).toMatch(predicate);
    expect(read("server/agency/access.ts")).toMatch(/NOT r\.google_deleted AND r\.reply_comment IS NULL/);
  });
});

describe("listing order expression", () => {
  it("only a plain decimal counts as a rating", () => {
    const re = new RegExp(RATING_NUMERIC_PATTERN);
    for (const ok of ["5", "4.5", "0", "10.25"]) expect(re.test(ok)).toBe(true);
    for (const bad of ["", "N/A", "4,5", "4.", ".5", "-1", "4.5 stars", "1e3"]) expect(re.test(bad)).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("listing order against the database", () => {
  const SCAN = -424242, USER = -424242; // no FK on competitor_listings; a negative pair nothing else uses
  let db: typeof import("../db").db, pool: typeof import("../db").pool;
  const rows = [
    { businessName: "unrated-blank", rating: "", reviewCount: 900 },
    { businessName: "unrated-null", rating: null, reviewCount: 800 },
    { businessName: "text-na", rating: "N/A", reviewCount: 700 },
    { businessName: "text-stars", rating: "4.5 stars", reviewCount: 600 },
    { businessName: "four-nine", rating: "4.9", reviewCount: 10 },
    { businessName: "four-nine-more", rating: "4.9", reviewCount: 50 },
    { businessName: "five", rating: "5", reviewCount: 1 },
    { businessName: "ten", rating: "10", reviewCount: 1 }, // numeric 10 > 5: alphabetical order would put "10" before "4.9"
  ];
  beforeAll(async () => {
    ({ db, pool } = await import("../db"));
    await pool.query("DELETE FROM competitor_listings WHERE scan_id=$1 AND user_id=$2", [SCAN, USER]);
    await db.insert(competitorListings).values(rows.map(r => ({ ...r, scanId: SCAN, userId: USER, placeId: `w3r8-${r.businessName}` })));
  });
  afterAll(async () => {
    await pool.query("DELETE FROM competitor_listings WHERE scan_id=$1 AND user_id=$2", [SCAN, USER]);
    await pool.end();
  });

  it("sorts numerically, and a non-numeric rating goes last instead of throwing", async () => {
    const got = await db.select({ name: competitorListings.businessName }).from(competitorListings)
      .where(and(eq(competitorListings.scanId, SCAN), eq(competitorListings.userId, USER)))
      .orderBy(...listingOrder());
    expect(got.map(r => r.name)).toEqual([
      "ten", "five", "four-nine-more", "four-nine",
      // no usable rating: most-reviewed first among them
      "unrated-blank", "unrated-null", "text-na", "text-stars",
    ]);
  });

  it("the old NULLIF(rating,'')::numeric form is what threw on that data", async () => {
    await expect(pool.query(
      "SELECT 1 FROM competitor_listings WHERE scan_id=$1 AND user_id=$2 ORDER BY NULLIF(rating,'')::numeric DESC NULLS LAST", [SCAN, USER],
    )).rejects.toThrow(/invalid input syntax for type numeric/);
  });

  it("the scan lookup has an index path (competitor_listings_scan_idx)", async () => {
    const { rows: idx } = await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='competitor_listings_scan_idx'");
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/\(scan_id, user_id\)/);
  });
});
