/**
 * Auto-share when a release goes live (owner, 2026-10-17: "needs automation"). The customer picks, once, where a
 * live release is shared: their connected social accounts (the same destinations and checks as Social Media:
 * server/social/schedule.ts validateDestinations + shared/social.ts postPayload) and their Google Business Profile
 * locations (server/gbp/content.ts enqueue, which needs the auto-posts permission: requireAutoPosts).
 *
 * When a release turns live (worker.ts applyReplies on the wire's "live" or report email, routes.ts admin "mark
 * live"), shareRelease queues ONE social post per chosen destination and ONE Google post per chosen location. The
 * text is fixed, never AI: the headline, PRESS_SHARE_LINE and the live link, shortened only where a network's limit
 * needs it. press_shares (release_id, target_key) is the claim: a second "live" never posts again. A failure is
 * recorded on its row and shown on the release; it never changes the release's status.
 */
import { createHash } from "node:crypto";
import { pool } from "../db";
import { postPayload, postSchema, destinationSchema, type Destination } from "@shared/social";
import { PRESS_SHARE_LINE, type PressShareSettingsView } from "@shared/press";
import { connection, destinationKey, insertPosts, userLock, validateDestinations } from "../social/schedule";
import { enqueue, requireAutoPosts } from "../gbp/content";
import * as store from "./store";
import { logError } from "../ops/log";

const PLATFORM_NAME: Record<string, string> = {
  twitter: "X", x: "X", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", threads: "Threads", bluesky: "Bluesky",
  tiktok: "TikTok", youtube: "YouTube", pinterest: "Pinterest", reddit: "Reddit", mastodon: "Mastodon", tumblr: "Tumblr",
};
export const GBP_LABEL = "Google Business Profile";
const GBP_SUMMARY_MAX = 1500;

/** A deterministic UUID for (release, place): the request id that makes a replay a no-op downstream too. */
export const shareRequestId = (releaseId: number, place: string) => {
  const h = createHash("sha256").update(`press-share:${releaseId}:${place}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** The post: headline, one plain sentence, the link. The headline is shortened (never the link) to fit a limit. */
export function shareText(headline: string, url: string, fits: (t: string) => boolean = () => true): string | null {
  const make = (h: string) => `${h}\n\n${PRESS_SHARE_LINE}\n\n${url}`;
  let h = headline.trim();
  if (fits(make(h))) return make(h);
  const words = h.split(/\s+/);
  while (words.length > 1) { words.pop(); h = `${words.join(" ").replace(/[,:;.-]+$/, "")}…`; if (fits(make(h))) return make(h); }
  return null;
}
const fitsFor = (d: Destination) => (t: string) => { try { postPayload(d, t, []); return true; } catch { return false; } };

// ---- settings --------------------------------------------------------------------------------------------------

type Saved = { destinations: Destination[]; location_ids: number[] };
async function saved(userId: number): Promise<Saved> {
  const { rows: [r] } = await pool.query(`SELECT destinations, location_ids FROM press_share_settings WHERE user_id=$1`, [userId]);
  return { destinations: (r?.destinations ?? []) as Destination[], location_ids: (r?.location_ids ?? []).map(Number) };
}

/** Every text-only destination the user's own (all-business) social connection offers, each with whether it can take one. */
async function socialOptions(userId: number): Promise<PressShareSettingsView["social"]> {
  let accounts: any[] = [];
  try { accounts = (await connection(userId)).accounts ?? []; } catch (e: any) {
    return { connected: false, reason: String(e?.message ?? "Connect your social accounts in Social Media first."), options: [] };
  }
  const options: PressShareSettingsView["social"]["options"] = [];
  for (const a of accounts) {
    const name = PLATFORM_NAME[a.platform] ?? a.platform;
    const targets: { d: Destination; label: string }[] = a.platform === "facebook"
      ? (a.pages ?? []).map((p: any) => ({ d: destinationSchema.parse({ accountId: a.id, platform: a.platform, pageId: p.id }), label: `${name}: ${p.name}` }))
      : [{ d: destinationSchema.parse({ accountId: a.id, platform: a.platform }), label: `${name}${a.name ? `: ${a.name}` : ""}` }];
    if (a.platform === "facebook" && !targets.length) options.push({ key: `social:${a.platform}:${a.id}::`, label: `${name}${a.name ? `: ${a.name}` : ""}`, ok: false, reason: "Choose a Facebook Page in Social Media first.", destination: null });
    for (const t of targets) {
      let reason: string | null = null;
      try { postPayload(t.d, shareText("Headline", "https://example.com/news") ?? "x", []); } catch (e: any) { reason = /requires media/.test(e.message) ? `${name} needs a photo or video, so a text post cannot go there.` : String(e.message); }
      options.push({ key: `social:${destinationKey(t.d)}`, label: t.label, ok: !reason, reason, destination: t.d });
    }
  }
  return { connected: true, reason: accounts.length ? null : "No social accounts are connected yet.", options };
}

async function gbpOptions(userId: number): Promise<PressShareSettingsView["gbp"]> {
  const { rows } = await pool.query(`SELECT id, business_name FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NOT NULL AND gbp_account_name IS NOT NULL ORDER BY business_name, id`, [userId]);
  let allowed = true, reason: string | null = null;
  try { await shareDeps.requireAutoPosts(userId); } catch (e: any) { allowed = false; reason = `${String(e?.message ?? "Not allowed on your plan")}. Posting to Google from here is not available until then.`; }
  if (!rows.length && allowed) reason = "No Google Business Profile is connected yet.";
  return { allowed, reason, options: rows.map((r: any) => ({ key: `gbp:${r.id}`, label: r.business_name, ok: allowed, reason: allowed ? null : reason, locationId: r.id })) };
}

export async function shareSettings(userId: number): Promise<PressShareSettingsView> {
  const [s, social, gbp] = await Promise.all([saved(userId), socialOptions(userId), gbpOptions(userId)]);
  return { social, gbp, chosen: { social: s.destinations.map((d) => `social:${destinationKey(d)}`), gbp: s.location_ids } };
}

export class ShareSettingsError extends Error { constructor(message: string, public status = 400) { super(message); } }

/** Saves the choice. Every destination passes Social Media's own checks; Google needs the auto-posts permission. */
export async function saveShareSettings(userId: number, choice: { social: string[]; gbp: number[] }): Promise<PressShareSettingsView> {
  const view = await shareSettings(userId);
  const destinations: Destination[] = [];
  for (const key of new Set(choice.social)) {
    const o = view.social.options.find((x) => x.key === key);
    if (!o) throw new ShareSettingsError("That social account is not connected any more. Refresh and choose again.");
    if (!o.ok) throw new ShareSettingsError(o.reason ?? "That account cannot take a text post.");
    destinations.push(o.destination as Destination);
  }
  if (destinations.length) {
    try { await validateDestinations(userId, destinations); } catch (e: any) { throw new ShareSettingsError(String(e?.message ?? e), 409); }
  }
  const ids = [...new Set(choice.gbp.map(Number))];
  if (ids.length && !view.gbp.allowed) throw new ShareSettingsError(view.gbp.reason ?? "Posting to Google is not available on your plan.", 402);
  for (const id of ids) if (!view.gbp.options.some((o) => o.locationId === id)) throw new ShareSettingsError("That Google Business Profile is not connected to your account.");
  await pool.query(
    `INSERT INTO press_share_settings (user_id, destinations, location_ids) VALUES ($1,$2,$3)
     ON CONFLICT (user_id) DO UPDATE SET destinations=EXCLUDED.destinations, location_ids=EXCLUDED.location_ids, updated_at=now()`,
    [userId, JSON.stringify(destinations), ids],
  );
  return shareSettings(userId);
}

// ---- sharing ---------------------------------------------------------------------------------------------------

/** Swappable in tests: the real queues. */
export const shareDeps = {
  requireAutoPosts,
  enqueueGbp: enqueue,
  /** One social post with source "press", the way createPosts queues one (same checks, same table). */
  async queueSocial(userId: number, d: Destination, text: string, requestId: string): Promise<string> {
    const input = postSchema.parse({ requestId, text, destinations: [d] });
    return userLock(userId, async (c) => {
      const { rows: existing } = await c.query(`SELECT id FROM social_posts WHERE user_id=$1 AND request_id=$2 AND business_id IS NULL`, [userId, requestId]);
      if (existing.length) return String(existing[0].id);
      await validateDestinations(userId, [d]);
      postPayload(d, text, []);
      await c.query("BEGIN");
      try {
        const rows = await insertPosts(c, userId, input, false, false, "press", null);
        await c.query("COMMIT");
        return String(rows[0].id);
      } catch (e) { await c.query("ROLLBACK"); throw e; }
    });
  },
};

/** Social Media takes one change per account at a time (userLock): wait a moment and try again, a few times. */
async function whenNotBusy<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e: any) {
      if (i >= tries || !/busy/i.test(String(e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 150 * i + Math.floor(Math.random() * 100)));
    }
  }
}

async function claim(releaseId: number, key: string, kind: "social" | "gbp", label: string): Promise<boolean> {
  const { rows } = await pool.query(`INSERT INTO press_shares (release_id, target_key, kind, label, status) VALUES ($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING RETURNING 1`, [releaseId, key, kind, label]);
  return rows.length > 0;
}
const settle = (releaseId: number, key: string, status: "queued" | "failed" | "skipped", detail: string | null, ref: string | null = null) =>
  pool.query(`UPDATE press_shares SET status=$3, detail=$4, ref=$5, updated_at=now() WHERE release_id=$1 AND target_key=$2`, [releaseId, key, status, detail?.slice(0, 500) ?? null, ref]);

export type ShareSummary = { queued: number; failed: number; skipped: number; already: number };

/** Queues the shares for a release that is live. Safe to call on every "live": each place is shared once. */
export async function shareRelease(releaseId: number): Promise<ShareSummary> {
  const out: ShareSummary = { queued: 0, failed: 0, skipped: 0, already: 0 };
  const row = await store.getRelease(releaseId);
  if (!row || !row.live_url || !["live", "reported"].includes(row.status)) return out;
  const s = await saved(row.user_id);
  const headline = row.text?.headline ?? row.input.companyName;
  const url = row.live_url;

  for (const d of s.destinations) {
    const key = `social:${destinationKey(d)}`;
    const label = PLATFORM_NAME[d.platform] ?? d.platform;
    if (!(await claim(row.id, key, "social", label))) { out.already++; continue; }
    try {
      const text = shareText(headline, url, fitsFor(d));
      if (!text) { await settle(row.id, key, "failed", `The link alone is too long for ${label}.`); out.failed++; continue; }
      const ref = await whenNotBusy(() => shareDeps.queueSocial(row.user_id, d, text, shareRequestId(row.id, key)));
      await settle(row.id, key, "queued", null, ref); out.queued++;
    } catch (e: any) {
      logError(`[press] share ${row.code} to ${key}:`, e);
      await settle(row.id, key, "failed", String(e?.message ?? e)); out.failed++;
    }
  }

  let gbpBlocked: string | null = null;
  if (s.location_ids.length) { try { await shareDeps.requireAutoPosts(row.user_id); } catch (e: any) { gbpBlocked = String(e?.message ?? "Not allowed on your plan"); } }
  for (const loc of s.location_ids) {
    const key = `gbp:${loc}`;
    if (!(await claim(row.id, key, "gbp", GBP_LABEL))) { out.already++; continue; }
    if (gbpBlocked) { await settle(row.id, key, "skipped", `Not posted to Google: ${gbpBlocked}.`); out.skipped++; continue; }
    try {
      const https = /^https:\/\//i.test(url);
      const summary = shareText(headline, url, (t) => t.length <= GBP_SUMMARY_MAX)!;
      const jobs = await shareDeps.enqueueGbp(row.user_id, loc, {
        requestKey: shareRequestId(row.id, key),
        items: [{ kind: "post", summary, ...(https ? { callToAction: { actionType: "LEARN_MORE", url } } : {}) }],
        schedule: { start: new Date().toISOString() },
      });
      const ids = (jobs as any[]).map((j) => j.id).filter(Boolean);
      if (ids.length) await pool.query(`UPDATE gbp_content_jobs SET source='press' WHERE id = ANY($1) AND user_id=$2`, [ids, row.user_id]);
      await settle(row.id, key, "queued", null, ids.join(",") || null); out.queued++;
    } catch (e: any) {
      logError(`[press] share ${row.code} to ${key}:`, e);
      await settle(row.id, key, "failed", String(e?.message ?? e)); out.failed++;
    }
  }
  return out;
}

/** The hook every "live" path calls: never throws, never blocks the status change. */
export async function shareWhenLive(releaseId: number): Promise<void> {
  try { await shareRelease(releaseId); } catch (e) { logError(`[press] share release ${releaseId}:`, e); }
}
