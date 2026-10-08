/**
 * Mentions watch: once a month, the pages PUBLISHED SINCE THE LAST CHECK that use the business's exact name, with the
 * same link check as Site Explorer -> Mentions (server/seo/mentions.ts). Off until the customer turns it on; it spends
 * only the month's included data.
 *
 * Why "published since": the ordinary check lists the 50 strongest websites that use the name, and comparing two such
 * lists cannot tell a new mention from a website that merely moved into the 50. So the watch reads PAGES (every page,
 * not one per website) by their publication date, OLDEST first, in a window that starts where the last one ended
 * (with a week's overlap; pages already seen are not counted twice). When a window holds more pages than one check
 * reads, the next check starts from the last page read — nothing is skipped, it is only later. A page the source has
 * no date for, or adds to its index later with an earlier date than the overlap, is not seen here; the panel says so.
 *
 * An alert is raised for the new pages that are likely the business — confirmed by the customer for that website, or
 * naming one of their places, and not marked as another business — on websites that do not link to the site yet.
 * Saved first, charged second: the check is written inside the charged call, with the next date, only while the
 * occurrence the scheduler leased is still this one.
 */
import type { PoolClient } from "pg";
import { pool } from "../db";
import { request, assertOk, taskItems, normalizeDomain, type DfsTask } from "./dataforseo";
import { withBudget, SeoBudgetError } from "./budget";
import { saveAlert, deliverAlert } from "./alerts";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { recordFailure } from "../ops/issues";
import { checkLinks, parseMention, placeIn, defaultPlaces, nameKey, pageKeyOf, nameOk, MENTIONS_ROWS, MENTIONS_ESTIMATE_USD, type MentionRow, type MentionsPage } from "./mentions";

export const mentionWatchDeps = { request, entitled: async (userId: number) => seoIncluded(await getEntitlements(userId)) };
/** The first watched check looks back this far (later ones: since the one before). */
export const FIRST_LOOKBACK_DAYS = 31;
/** Each window starts this far before where the last one ended, for pages the source indexed a little late. */
export const OVERLAP_DAYS = 7;
/** Pages read in one watched check (one search; the price is verified for this many). */
export const WATCH_ROWS = MENTIONS_ROWS;

export const MENTION_WATCH_DDL = [
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS mention_watch boolean NOT NULL DEFAULT false`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS next_mention_at timestamptz`,
  // One watched check per site per day, never rewritten: an alert always matches the check it was raised from.
  `CREATE TABLE IF NOT EXISTS seo_mention_checks (
     id serial PRIMARY KEY,
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     user_id integer NOT NULL,
     name text NOT NULL,
     name_key text NOT NULL,
     since timestamptz NOT NULL,
     run_on date NOT NULL DEFAULT current_date,
     page jsonb NOT NULL,
     -- The window read: pages published after window_from up to window_to; complete = every page in it was read.
     window_from timestamptz,
     window_to timestamptz,
     complete boolean NOT NULL DEFAULT true,
     cost_usd numeric NOT NULL DEFAULT 0,
     alerts_done boolean NOT NULL DEFAULT false,
     alerts_tried_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (site_id, run_on)
   )`,
  `ALTER TABLE seo_mention_checks ADD COLUMN IF NOT EXISTS window_from timestamptz`,
  `ALTER TABLE seo_mention_checks ADD COLUMN IF NOT EXISTS window_to timestamptz`,
  `ALTER TABLE seo_mention_checks ADD COLUMN IF NOT EXISTS complete boolean NOT NULL DEFAULT true`,
];
/** The alert kind for new mentions. Runs after every other change to the rule (it replaces it with the full list). */
export const MENTION_WATCH_ALERT_DDL = [
  `DO $$ BEGIN
     LOCK TABLE seo_alerts IN SHARE ROW EXCLUSIVE MODE;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'seo_alerts'::regclass AND conname = 'seo_alerts_kind_check' AND pg_get_constraintdef(oid) LIKE '%mention_new%') THEN
       ALTER TABLE seo_alerts DROP CONSTRAINT IF EXISTS seo_alerts_kind_check;
       ALTER TABLE seo_alerts ADD CONSTRAINT seo_alerts_kind_check CHECK (kind IN ('rank_drop','rank_gain','links_lost','links_gained','grid_down','grid_up','kw_new','kw_lost','mention_new'));
     END IF;
   END $$`,
];

const stamp = (d: Date) => `${d.toISOString().slice(0, 19).replace("T", " ")} +00:00`;
/** The search for every page published after `from` up to `to`, OLDEST first. Pure. */
export function newMentionsRequest(name: string, domain: string, from: Date, to: Date): Record<string, unknown> {
  return {
    keyword: `"${name}"`, search_mode: "as_is", limit: WATCH_ROWS,
    filters: [["main_domain", "<>", domain], "and", ["content_info.date_published", ">", stamp(from)], "and", ["content_info.date_published", "<=", stamp(to)]],
    order_by: ["content_info.date_published,asc"],
  };
}

export type WatchPage = MentionsPage & { complete: boolean; /** Where the next window starts when this one was not read to its end. */ resumeFrom: string | null; skippedSeen: number };
/**
 * The pages of a window (deduplicated by page, pages already seen in earlier checks left out) and their link check. A
 * failed link check leaves "links to you" unknown and is not charged. The source's dates and the window decide what is
 * new; `complete` = every page of the window was read (else the next window resumes from the last one read).
 */
export async function fetchNewMentions(name: string, domain: string, from: Date, to: Date, seenBefore: ReadonlySet<string> = new Set()): Promise<{ data: WatchPage; costUsd: number; costUnknown: boolean; customerUsd: number }> {
  const target = normalizeDomain(domain) ?? domain;
  const task: DfsTask = assertOk(await mentionWatchDeps.request("POST", "/content_analysis/search/live", [newMentionsRequest(name, target, from, to)]), { treatNoResultsAsEmpty: true });
  const searchUsd = typeof task.cost === "number" ? task.cost : 0;
  const items = taskItems(task), seen = new Set<string>(), rows: MentionRow[] = [];
  let skippedSeen = 0, last: string | null = null;
  for (const i of items) {
    const d = typeof i?.content_info?.date_published === "string" ? new Date(i.content_info.date_published) : null;
    if (d && !Number.isNaN(d.getTime())) last = d.toISOString();
    const r = parseMention(i, target);
    if (!r) continue;
    const k = pageKeyOf(r.url);
    if (seen.has(k)) continue;
    seen.add(k);
    if (seenBefore.has(k)) { skippedSeen++; continue; }
    rows.push({ ...r, linksToYou: null });
  }
  const total = typeof (task.result?.[0] as any)?.total_count === "number" ? (task.result?.[0] as any).total_count : null;
  // Read to the end only when the source says there is no more than came back (unknown total + a full page = not complete).
  const complete = total !== null ? total <= items.length : items.length < WATCH_ROWS;
  const page: WatchPage = { name, domain: target, rows, total, linksChecked: !rows.length, linksCheckedAt: null, fetchedAt: new Date().toISOString(), complete, resumeFrom: complete ? null : last, skippedSeen };
  if (!rows.length) return { data: page, costUsd: searchUsd, costUnknown: false, customerUsd: searchUsd };
  const links = await checkLinks(page);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: { ...page, ...links.data }, costUsd: r6(searchUsd + links.costUsd), costUnknown: links.costUnknown, customerUsd: r6(searchUsd + (links.data.linksChecked ? links.costUsd : 0)) };
}

type WatchSite = { id: number; user_id: number; domain: string; name: string; lease: string };
/** The places a site's mentions are read for: the ones it saved, or the towns of its tracked keywords. */
export async function sitePlaces(site: { id: number; mention_places?: unknown }): Promise<string[]> {
  if (Array.isArray(site.mention_places)) return site.mention_places.filter((x): x is string => typeof x === "string").slice(0, 8);
  const { rows } = await pool.query("SELECT location_name FROM seo_keywords WHERE site_id=$1 AND location_name IS NOT NULL GROUP BY location_name ORDER BY count(*) DESC, location_name LIMIT 20", [site.id]);
  return defaultPlaces(rows.map((r: any) => r.location_name));
}

/** The name a site's watch follows: the name searched last, else the business name. */
const WATCH_NAME_SQL = `btrim(coalesce(nullif(btrim(mention_name), ''), business_name, ''))`;
/**
 * One watched check for one leased occurrence. Bought from the included data only; saved inside the charged call
 * together with the next date — only while the site's date is still the leased one, the watch is on, and it still
 * follows the same name. A day that already has its check buys nothing (its next date is put right instead). Anything
 * that stops the save charges the customer nothing; what the source cost is kept, with its uncertainty.
 */
export async function takeWatchedCheck(site: WatchSite): Promise<{ id: number; pages: number } | null> {
  const key = nameKey(site.name);
  if (!nameOk(site.name)) throw Object.assign(new Error(`mentions watch for ${site.domain}: the name cannot be searched as it is written`), { notSaved: true, badName: true });
  // One check a day, decided BEFORE anything is bought.
  const { rows: [today] } = await pool.query("SELECT id, run_on::text AS run_on FROM seo_mention_checks WHERE site_id=$1 AND run_on = current_date", [site.id]);
  if (today) {
    await pool.query("UPDATE seo_sites SET next_mention_at = $3::date + interval '1 month' WHERE id=$1 AND next_mention_at::text = $2", [site.id, site.lease, today.run_on]);
    return null;
  }
  // The window: from where the last check of this name ended (less the overlap; or the page it resumes from), to now.
  const { rows: prev } = await pool.query(
    "SELECT window_to, complete, page->>'resumeFrom' AS resume, page->'rows' AS rows, created_at FROM seo_mention_checks WHERE site_id=$1 AND name_key=$2 ORDER BY created_at DESC LIMIT 3", [site.id, key]);
  const to = new Date();
  const last = prev[0];
  const from = !last ? new Date(to.getTime() - FIRST_LOOKBACK_DAYS * 864e5)
    : !last.complete && last.resume ? new Date(last.resume)
    : new Date(new Date(last.window_to ?? last.created_at).getTime() - OVERLAP_DAYS * 864e5);
  const seenBefore = new Set<string>(prev.flatMap((p: any) => (Array.isArray(p.rows) ? p.rows : []).map((r: any) => (typeof r?.url === "string" ? pageKeyOf(r.url) : ""))).filter(Boolean));
  const out = await withBudget(site.user_id, MENTIONS_ESTIMATE_USD, async () => {
    const o = await fetchNewMentions(site.name, site.domain, from, to, seenBefore);
    const fail = (why: string) => Object.assign(new Error(`mentions watch for ${site.domain} not saved: ${why}`), { costUsd: o.costUsd, costUnknown: o.costUnknown, notSaved: true });
    let client: PoolClient | null = null;
    try {
      // Taking a connection is inside the same handling: a failure there still reports what the source cost.
      client = (await pool.connect()) as PoolClient;
      const db = client;
      await db.query("BEGIN");
      const { rowCount: still } = await db.query(`SELECT 1 FROM seo_sites WHERE id=$1 AND mention_watch AND next_mention_at::text = $2 AND lower(${WATCH_NAME_SQL}) = $3 FOR UPDATE`, [site.id, site.lease, key]);
      if (!still) { await db.query("ROLLBACK"); throw fail("the watch was turned off, its date moved or its name changed meanwhile"); }
      const { rows: [row] } = await db.query(
        `INSERT INTO seo_mention_checks(site_id, user_id, name, name_key, since, page, cost_usd, window_from, window_to, complete) VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8,$9) ON CONFLICT (site_id, run_on) DO NOTHING RETURNING id`,
        [site.id, site.user_id, site.name, key, from.toISOString(), JSON.stringify(o.data), o.costUsd, to.toISOString(), o.data.complete]);
      if (!row) { await db.query("ROLLBACK"); throw fail("today's check already exists"); }
      await db.query("UPDATE seo_sites SET next_mention_at = now() + interval '1 month' WHERE id=$1 AND next_mention_at::text = $2", [site.id, site.lease]);
      await db.query("COMMIT");
      return { data: { id: row.id as number, pages: o.data.rows.length }, costUsd: o.costUsd, costUnknown: o.costUnknown, customerUsd: o.customerUsd };
    } catch (e: any) {
      if (client) await (client as PoolClient).query("ROLLBACK").catch(() => {});
      throw e?.notSaved ? e : fail(e?.message ?? String(e));
    } finally { (client as PoolClient | null)?.release(); }
  }, { allowanceOnly: true, label: `Mentions watch — "${site.name}"` });
  await settleMentionAlerts(site.id).catch((e) => console.error(`[seo] mention alerts for site ${site.id} failed (they will be tried again): ${e?.message ?? e}`));
  return out.data;
}

/** Pure: the new pages worth an alert — likely the business, not marked otherwise (verdicts by page), on a website not known to link. */
export function alertPages(rows: readonly MentionRow[], places: readonly string[], marks: ReadonlyMap<string, "mine" | "not_mine">): (MentionRow & { place: string | null; confirmed: boolean })[] {
  return rows.map((r) => ({ ...r, place: placeIn(r, places), confirmed: marks.get(pageKeyOf(r.url)) === "mine" }))
    .filter((r) => marks.get(pageKeyOf(r.url)) !== "not_mine" && (r.confirmed || !!r.place) && r.linksToYou !== true);
}

/** Raise the alert each unsettled watched check calls for, once; then mark it dealt with. Alerts off = none (still settled). */
export async function settleMentionAlerts(siteId: number): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE seo_mention_checks x SET alerts_tried_at = now() FROM seo_sites s WHERE x.site_id=$1 AND x.alerts_done = false AND s.id = x.site_id
     RETURNING x.id, x.user_id, x.name, x.name_key, x.since, x.created_at, x.page, s.domain, s.alerts_enabled, s.mention_places, s.id AS sid`, [siteId]);
  let raised = 0;
  for (const c of rows) {
    try {
      if (c.alerts_enabled !== false) {
        const page = c.page as MentionsPage;
        const { rows: marks } = await pool.query("SELECT page_key, verdict FROM seo_mention_verdicts WHERE site_id=$1 AND name_key=$2", [siteId, c.name_key]);
        const pages = alertPages(Array.isArray(page?.rows) ? page.rows : [], await sitePlaces({ id: siteId, mention_places: c.mention_places }), new Map(marks.map((m: any) => [m.page_key, m.verdict])));
        if (pages.length) {
          const item = { checkId: c.id, name: c.name, since: new Date(c.since).toISOString().slice(0, 10), takenOn: new Date(c.created_at).toISOString().slice(0, 10), linksChecked: page.linksChecked,
            pages: pages.slice(0, 50).map((p) => ({ domain: p.domain, url: p.url, title: p.title, place: p.place, confirmed: p.confirmed, linksToYou: p.linksToYou })), more: Math.max(0, pages.length - 50), siteId };
          // "No link found" only where the link check answered; where it did not, the link is said to be not known.
          const unknown = pages.filter((p) => p.linksToYou === null).length;
          const title = `${pages.length} new page${pages.length === 1 ? "" : "s"} mention "${c.name}"` + (unknown === pages.length ? ` — whether ${pages.length === 1 ? "its website links" : "their websites link"} to ${c.domain} is not known` : unknown ? ` — no link to ${c.domain} found for ${pages.length - unknown}, not known for ${unknown}` : ` — no link to ${c.domain} found`);
          const id = await saveAlert(c.user_id, siteId, "mention_new", `mention:${c.id}`, title, [item]);
          if (id) { await deliverAlert(id); raised++; }
        }
      }
      await pool.query("UPDATE seo_mention_checks SET alerts_done = true WHERE id=$1", [c.id]);
    } catch (e: any) { console.error(`[seo] mention alert for check ${c.id} failed (it will be tried again): ${e?.message ?? e}`); }
  }
  return raised;
}

/** The scheduler: owed alerts first, then every site whose watched check is due (leased for six hours each). */
export async function runDueMentionChecks(): Promise<number> {
  const { rows: owed } = await pool.query("SELECT site_id FROM seo_mention_checks WHERE alerts_done = false GROUP BY site_id ORDER BY min(alerts_tried_at) NULLS FIRST, site_id LIMIT 20").catch(() => ({ rows: [] as any[] }));
  for (const o of owed) await settleMentionAlerts(o.site_id).catch(() => {});
  const { rows: due } = await pool.query(
    `UPDATE seo_sites SET next_mention_at = now() + interval '6 hours'
      WHERE mention_watch AND next_mention_at <= now() AND ${WATCH_NAME_SQL} <> ''
      RETURNING id, user_id, domain, ${WATCH_NAME_SQL} AS name, next_mention_at::text AS lease`);
  let done = 0;
  for (const site of due) {
    const later = (interval: string) => pool.query(`UPDATE seo_sites SET next_mention_at = now() + interval '${interval}' WHERE id=$1 AND mention_watch AND next_mention_at::text = $2`, [site.id, site.lease]).catch(() => {});
    try {
      if (!(await mentionWatchDeps.entitled(site.user_id))) { await later("1 day"); continue; }
      if (await takeWatchedCheck(site)) done++;
    } catch (e: any) {
      if (e instanceof SeoBudgetError) { console.warn(`[seo] mentions watch for ${site.domain} skipped: ${e.message}`); await later("1 day"); }
      else if (e?.badName) { console.warn(`[seo] ${e.message}`); await later("7 days"); }
      else if (!e?.notSaved) void recordFailure("job", "SEO mentions watch", e);
    }
  }
  return done;
}

/** Turned on: due at once (the scheduler takes it from the included data); off: nothing is due. */
export async function setMentionWatch(userId: number, siteId: number, on: boolean): Promise<void> {
  await pool.query(`UPDATE seo_sites SET mention_watch=$3, next_mention_at = CASE WHEN $3 THEN coalesce(next_mention_at, now()) ELSE NULL END WHERE id=$1 AND user_id=$2`, [siteId, userId, on]);
}

/** What the screen shows: the setting, the next date, and the newest watched check of this name. */
export async function mentionWatchView(userId: number, site: { id: number; mention_watch?: boolean; next_mention_at?: unknown }, name: string) {
  const { rows: [c] } = await pool.query("SELECT id, since, created_at, page FROM seo_mention_checks WHERE site_id=$1 AND user_id=$2 AND name_key=$3 ORDER BY created_at DESC LIMIT 1", [site.id, userId, nameKey(name)]);
  return {
    watch: !!site.mention_watch, nextAt: site.mention_watch && site.next_mention_at ? new Date(site.next_mention_at as string).toISOString() : null,
    latest: c ? { id: c.id, since: new Date(c.since).toISOString(), takenAt: new Date(c.created_at).toISOString(), page: c.page as MentionsPage } : null,
  };
}

/**
 * A second try of a watched check's link lookup, when it did not load. Bought (the customer's own choice) and SAVED
 * FIRST, CHARGED SECOND: the check is updated inside the charged call, only while its link lookup is still missing.
 */
export async function retryWatchedLinks(userId: number, siteId: number, checkId: number, estimateUsd: number): Promise<MentionsPage | null> {
  const { rows: [c] } = await pool.query("SELECT page FROM seo_mention_checks WHERE id=$1 AND site_id=$2 AND user_id=$3", [checkId, siteId, userId]);
  if (!c) return null;
  const page = c.page as MentionsPage;
  if (page.linksChecked) return page;
  const out = await withBudget(userId, estimateUsd, async () => {
    const o = await checkLinks(page);
    if (!o.data.linksChecked) throw Object.assign(new Error("The link check did not load."), { costUsd: o.costUsd, costUnknown: o.costUnknown });
    const merged = { ...page, ...o.data };
    const { rowCount } = await pool.query("UPDATE seo_mention_checks SET page=$4 WHERE id=$1 AND site_id=$2 AND user_id=$3 AND coalesce(page->>'linksChecked','false') = 'false'", [checkId, siteId, userId, JSON.stringify(merged)])
      .catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { costUsd: o.costUsd, costUnknown: o.costUnknown }); });
    if (!rowCount) throw Object.assign(new Error("The check was completed meanwhile."), { costUsd: o.costUsd, costUnknown: o.costUnknown });
    return { data: merged, costUsd: o.costUsd, costUnknown: o.costUnknown };
  }, { label: `Mentions watch — link check, second try` });
  return out.data;
}
