/**
 * POST /api/seo/sites' write (server/seo/site-cap.ts addSiteOrExisting, review w3-r2 M1): adding a domain the account
 * already tracks never resets its country, language, devices or SERP depth — the stored row comes back with
 * existing: true. A new domain is inserted with the settings given. Needs a local constructhub_dev_<x> database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { ensureSeoSchema } from "./schema";
import { addSiteOrExisting, siteCapRefuses } from "./site-cap";

let user: number, other: number;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname) || !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("a local development DB is required");
  await ensureSeoSchema();
  [user, other] = (await pool.query("INSERT INTO users(email) VALUES('site-add-'||gen_random_uuid()||'@example.invalid'),('site-add-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows.map((r) => r.id);
});
afterAll(async () => {
  await pool.query("DELETE FROM seo_sites WHERE user_id=ANY($1)", [[user, other]]);
  await pool.query("DELETE FROM users WHERE id=ANY($1)", [[user, other]]);
  await pool.end();
});

const DEFAULTS = { locationCode: 2840, languageCode: "en", devices: "both", serpDepth: 10 };

describe("adding a site (review w3-r2 M1)", () => {
  it("a new domain is inserted with the settings given, existing: false", async () => {
    const { site, existing } = await addSiteOrExisting(user, "fresh-site.example", { locationCode: 2124, languageCode: "fr", devices: "desktop", serpDepth: 100 });
    expect(existing).toBe(false);
    expect(site).toMatchObject({ user_id: user, domain: "fresh-site.example", location_code: 2124, language_code: "fr", devices: "desktop", serp_depth: 100, keyword_count: 0 });
  });

  it("re-adding a tracked site with the defaults leaves its market, devices and depth as stored", async () => {
    const first = await addSiteOrExisting(user, "tracked.example", { locationCode: 2124, languageCode: "fr", devices: "desktop", serpDepth: 100 });
    await pool.query("INSERT INTO seo_keywords(site_id,user_id,keyword) VALUES($1,$2,'toiture')", [first.site.id, user]);
    const again = await addSiteOrExisting(user, "tracked.example", DEFAULTS);
    expect(again.existing).toBe(true);
    expect(again.site).toMatchObject({ id: first.site.id, location_code: 2124, language_code: "fr", devices: "desktop", serp_depth: 100, keyword_count: 1 });
    const { rows: [stored] } = await pool.query("SELECT location_code, language_code, devices, serp_depth FROM seo_sites WHERE id=$1", [first.site.id]);
    expect(stored).toEqual({ location_code: 2124, language_code: "fr", devices: "desktop", serp_depth: 100 });
    expect(Number((await pool.query("SELECT count(*) FROM seo_sites WHERE user_id=$1 AND domain='tracked.example'", [user])).rows[0].count)).toBe(1);
  });

  it("another account adding the same domain gets its own new row", async () => {
    const r = await addSiteOrExisting(other, "tracked.example", DEFAULTS);
    expect(r.existing).toBe(false);
    expect(r.site).toMatchObject({ user_id: other, location_code: 2840, devices: "both", serp_depth: 10 });
  });

  it("the site cap still lets an already-tracked domain through", async () => {
    expect(await siteCapRefuses(user, "tracked.example", 1)).toBe(false);
    expect(await siteCapRefuses(user, "brand-new.example", 1)).toBe(true);
  });
});
