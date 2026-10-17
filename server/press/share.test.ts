/**
 * Auto-share when live, against the lane's database: one social post per chosen destination and one Google post per
 * chosen location, tagged "press", queued once per release however often it is marked live; Google is skipped with
 * the plan's reason when auto-posts are not allowed; the text is fixed and fits each network.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { pool } from "../db";
import { ensurePressSchema } from "./schema";
import * as store from "./store";
import { saveShareSettings, shareDeps, shareRelease, shareSettings, shareText, ShareSettingsError } from "./share";
import { PRESS_SHARE_LINE, type PressReleaseInput } from "@shared/press";

process.env.SOCIAL_ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
const tag = `vh${Date.now().toString(36)}`;
const users: number[] = [];
const input: PressReleaseInput = {
  newsType: "expansion", companyName: "Ridgeline Roofing", website: "", city: "Columbus", state: "OH", contactName: "Dana Ortiz", contactEmail: "dana@ridgeline.example",
  contactPhone: "", details: "x".repeat(90), spokesperson: "", spokespersonTitle: "", quoteNotes: "", about: "", photos: [],
};
const URL_LIVE = "https://www.example.com/news/ridgeline-roofing-second-crew";
const HEADLINE = "Ridgeline Roofing Adds a Second Repair Crew in Franklin County";

async function account(plan?: "pro"): Promise<{ userId: number; locationId: number }> {
  const { rows: [u] } = await pool.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`${tag}-${users.length}@press.test`]);
  users.push(u.id);
  if (plan) await pool.query(`INSERT INTO subscriptions (user_id, plan, status) VALUES ($1,$2,'active')`, [u.id, plan]);
  const { encryptKey } = await import("../social/client");
  const { NATIVE_MARK } = await import("../social/native");
  await pool.query(`INSERT INTO social_connections (user_id, business_id, key_enc, accounts) VALUES ($1, NULL, $2, $3::jsonb)`, [u.id, encryptKey(`${NATIVE_MARK}chu${u.id}b0`, u.id), JSON.stringify([
    { id: "li-1", platform: "linkedin", name: "Ridgeline Roofing" },
    { id: "fb-1", platform: "facebook", name: "Dana", pages: [{ id: "page-1", name: "Ridgeline Roofing" }] },
    { id: "ig-1", platform: "instagram", name: "ridgeline" },
  ])]);
  const { rows: [loc] } = await pool.query(`INSERT INTO business_locations (user_id, business_name, gbp_account_name, gbp_location_name) VALUES ($1,'Ridgeline Roofing','accounts/111','locations/222') RETURNING id`, [u.id]);
  return { userId: u.id, locationId: loc.id };
}
async function liveRelease(userId: number) {
  const r = await store.createRelease(userId, "budget", input);
  return store.updateRelease(r.id, { status: "live", live_url: URL_LIVE, live_at: new Date(), text: { headline: HEADLINE, subheadline: "", dateline: "", body: "b", boilerplate: "", mediaContact: "" } });
}
const counts = async (userId: number) => ({
  social: Number((await pool.query(`SELECT count(*) FROM social_posts WHERE user_id=$1 AND source='press'`, [userId])).rows[0].count),
  gbp: Number((await pool.query(`SELECT count(*) FROM gbp_content_jobs WHERE user_id=$1 AND source='press'`, [userId])).rows[0].count),
});

const origRequire = shareDeps.requireAutoPosts;
const allow = async () => undefined;
beforeAll(async () => { await ensurePressSchema(pool); });
afterAll(async () => {
  shareDeps.requireAutoPosts = origRequire;
  await pool.query(`DELETE FROM social_posts WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM gbp_content_jobs WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_releases WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_share_settings WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM social_connections WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM subscriptions WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM business_locations WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
  await pool.end();
});

describe("share text", () => {
  it("is the headline, one plain sentence and the link; only the headline is shortened", () => {
    expect(shareText(HEADLINE, URL_LIVE)).toBe(`${HEADLINE}\n\n${PRESS_SHARE_LINE}\n\n${URL_LIVE}`);
    const short = shareText(HEADLINE, URL_LIVE, (t) => t.length <= 140)!;
    expect(short.length).toBeLessThanOrEqual(140);
    expect(short.endsWith(`\n\n${PRESS_SHARE_LINE}\n\n${URL_LIVE}`)).toBe(true);
    expect(short.startsWith("Ridgeline Roofing")).toBe(true);
    expect(shareText(HEADLINE, URL_LIVE, () => false)).toBeNull();
  });
});

describe("auto-share when live", () => {
  it("lists only connected destinations that take a text post, and queues one post per place, once", async () => {
    shareDeps.requireAutoPosts = origRequire; // the real check: this account is on Pro
    const { userId, locationId } = await account("pro");
    const view = await shareSettings(userId);
    const keys = view.social.options.map((o) => [o.key, o.ok]);
    expect(keys).toEqual([["social:linkedin:li-1::", true], ["social:facebook:fb-1:page-1:", true], ["social:instagram:ig-1::", false]]);
    expect(view.gbp).toMatchObject({ allowed: true, options: [{ locationId, ok: true }] });
    await expect(saveShareSettings(userId, { social: ["social:instagram:ig-1::"], gbp: [] })).rejects.toBeInstanceOf(ShareSettingsError);
    await saveShareSettings(userId, { social: ["social:linkedin:li-1::", "social:facebook:fb-1:page-1:"], gbp: [locationId] });

    const r = await liveRelease(userId);
    expect(await shareRelease(r.id)).toEqual({ queued: 3, failed: 0, skipped: 0, already: 0 });
    expect(await counts(userId)).toEqual({ social: 2, gbp: 1 });
    const { rows: posts } = await pool.query(`SELECT payload FROM social_posts WHERE user_id=$1`, [userId]);
    for (const p of posts) expect(JSON.stringify(p.payload)).toContain(PRESS_SHARE_LINE);
    const { rows: [job] } = await pool.query(`SELECT payload FROM gbp_content_jobs WHERE user_id=$1`, [userId]);
    expect(job.payload).toMatchObject({ summary: `${HEADLINE}\n\n${PRESS_SHARE_LINE}\n\n${URL_LIVE}`, callToAction: { actionType: "LEARN_MORE", url: URL_LIVE } });

    // Marked live again (the admin button, a second wire email), and twice at once: nothing more is queued.
    expect(await shareRelease(r.id)).toMatchObject({ queued: 0, already: 3 });
    await Promise.all([shareRelease(r.id), shareRelease(r.id)]);
    expect(await counts(userId)).toEqual({ social: 2, gbp: 1 });
    const view2 = store.releaseView(r, (await store.sharesFor([r.id])).get(r.id));
    expect(view2.shares.map((s) => [s.label, s.status])).toEqual(expect.arrayContaining([["LinkedIn", "queued"], ["Facebook", "queued"], ["Google Business Profile", "queued"]]));

    // A second release racing itself still shares once per place.
    const r2 = await liveRelease(userId);
    const both = await Promise.all([shareRelease(r2.id), shareRelease(r2.id)]);
    expect(both[0].queued + both[1].queued).toBe(3);
    expect(await counts(userId)).toEqual({ social: 4, gbp: 2 });

    // A draft or a release with no link is never shared.
    const draft = await store.createRelease(userId, "budget", input);
    expect(await shareRelease(draft.id)).toEqual({ queued: 0, failed: 0, skipped: 0, already: 0 });
  });

  it("skips Google with the plan's reason when auto-posts are not allowed; social still goes", async () => {
    shareDeps.requireAutoPosts = allow;
    const { userId, locationId } = await account();
    await saveShareSettings(userId, { social: ["social:linkedin:li-1::"], gbp: [locationId] });
    shareDeps.requireAutoPosts = origRequire; // the real check: this new account has no plan
    const view = await shareSettings(userId);
    expect(view.gbp.allowed).toBe(false);
    expect(view.gbp.reason).toMatch(/requires Pro or above/);
    await expect(saveShareSettings(userId, { social: [], gbp: [locationId] })).rejects.toMatchObject({ status: 402 });

    const r = await liveRelease(userId);
    expect(await shareRelease(r.id)).toEqual({ queued: 1, failed: 0, skipped: 1, already: 0 });
    const { rows: [g] } = await pool.query(`SELECT status, detail FROM press_shares WHERE release_id=$1 AND kind='gbp'`, [r.id]);
    expect(g.status).toBe("skipped");
    expect(g.detail).toMatch(/^Not posted to Google: .*requires Pro or above/);
    expect(await counts(userId)).toEqual({ social: 1, gbp: 0 });
  });
});
