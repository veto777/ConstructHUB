/**
 * Mentions watch: once a month, the pages PUBLISHED SINCE THE LAST CHECK that use the business's exact name, with the
 * same link check as Site Explorer -> Mentions (server/seo/mentions.ts). Off until the customer turns it on; it spends
 * only the month's included data.
 *
 * Why "published since": the ordinary check lists the 50 strongest websites that use the name, and comparing two such
 * lists cannot tell a new mention from a website that merely moved into the 50. Pages with a publication date after
 * the last check are new by their own date (a page the source dates wrongly, or has no date for, is not seen here).
 *
 * An alert is raised for the new pages that are likely the business — confirmed by the customer for that website, or
 * naming one of their places, and not marked as another business — on websites that do not link to the site yet.
 * Saved first, charged second: the check is written inside the charged call, with the next date, only while the
 * occurrence the scheduler leased is still this one.
 */
import { pool } from "../db";
import { request, assertOk, taskItems, normalizeDomain, type DfsTask } from "./dataforseo";
import { withBudget, SeoBudgetError } from "./budget";
import { saveAlert, deliverAlert } from "./alerts";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { recordFailure } from "../ops/issues";
import { checkLinks, parseMention, placeIn, defaultPlaces, nameKey, pageKeyOf, MENTIONS_ROWS, MENTIONS_ESTIMATE_USD, type MentionRow, type MentionsPage } from "./mentions";

export const mentionWatchDeps = { request, entitled: async (userId: number) => seoIncluded(await getEntitlements(userId)) };
/** The first watched check looks back this far (later ones: since the one before). */
export const FIRST_LOOKBACK_DAYS = 31;

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
     cost_usd numeric NOT NULL DEFAULT 0,
     alerts_done boolean NOT NULL DEFAULT false,
     alerts_tried_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (site_id, run_on)
   )`,
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
/** The search for pages published after `since` (and not in the future), newest first. Pure. */
export function newMentionsRequest(name: string, domain: string, since: Date, now = new Date()): Record<string, unknown> {
  return {
    keyword: `"${name}"`, search_mode: "one_per_domain", limit: MENTIONS_ROWS,
    filters: [["main_domain", "<>", domain], "and", ["content_info.date_published", ">", stamp(since)], "and", ["content_info.date_published", "<", stamp(new Date(now.getTime() + 864e5))]],
    order_by: ["content_info.date_published,desc"],
  };
}

/** The new pages and their link check. A failed link check leaves "links to you" unknown and is not charged. */
export async function fetchNewMentions(name: string, domain: string, since: Date): Promise<{ data: MentionsPage; costUsd: number; costUnknown: boolean; customerUsd: number }> {
  const target = normalizeDomain(domain) ?? domain;
  const task: DfsTask = assertOk(await mentionWatchDeps.request("POST", "/content_analysis/search/live", [newMentionsRequest(name, target, since)]), { treatNoResultsAsEmpty: true });
  const searchUsd = typeof task.cost === "number" ? task.cost : 0;
  const seen = new Set<string>(), rows: MentionRow[] = [];
  for (const i of taskItems(task)) { const r = parseMention(i, target); if (r && !seen.has(r.domain)) { seen.add(r.domain); rows.push({ ...r, linksToYou: null }); } }
  const total = typeof (task.result?.[0] as any)?.total_count === "number" ? (task.result?.[0] as any).total_count : null;
  const page: MentionsPage = { name, domain: target, rows, total, linksChecked: !rows.length, linksCheckedAt: null, fetchedAt: new Date().toISOString() };
  if (!rows.length) return { data: page, costUsd: searchUsd, costUnknown: false, customerUsd: searchUsd };
  const links = await checkLinks(page);
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return { data: links.data, costUsd: r6(searchUsd + links.costUsd), costUnknown: links.costUnknown, customerUsd: r6(searchUsd + (links.data.linksChecked ? links.costUsd : 0)) };
}

type WatchSite = { id: number; user_id: number; domain: string; name: string; lease: string };
/** The places a site's mentions are read for: the ones it saved, or the towns of its tracked keywords. */
export async function sitePlaces(site: { id: number; mention_places?: unknown }): Promise<string[]> {
  if (Array.isArray(site.mention_places)) return site.mention_places.filter((x): x is string => typeof x === "string").slice(0, 8);
  const { rows } = await pool.query("SELECT location_name FROM seo_keywords WHERE site_id=$1 AND location_name IS NOT NULL GROUP BY location_name ORDER BY count(*) DESC, location_name LIMIT 20", [site.id]);
  return defaultPlaces(rows.map((r: any) => r.location_name));
}

/**
 * One watched check for one leased occurrence. Bought from the included data only; saved inside the charged call
 * together with the next date — only while the site's date is still the leased one and the watch is on. Anything that
 * stops the save charges nothing.
 */
export async function takeWatchedCheck(site: WatchSite): Promise<{ id: number; pages: number } | null> {
  const key = nameKey(site.name);
  const { rows: [last] } = await pool.query("SELECT created_at FROM seo_mention_checks WHERE site_id=$1 AND name_key=$2 ORDER BY created_at DESC LIMIT 1", [site.id, key]);
  const since = last ? new Date(last.created_at) : new Date(Date.now() - FIRST_LOOKBACK_DAYS * 864e5);
  const out = await withBudget(site.user_id, MENTIONS_ESTIMATE_USD, async () => {
    const o = await fetchNewMentions(site.name, site.domain, since);
    const fail = (why: string) => Object.assign(new Error(`mentions watch for ${site.domain} not saved: ${why}`), { costUsd: o.costUsd, costUnknown: false, notSaved: true });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount: still } = await client.query("SELECT 1 FROM seo_sites WHERE id=$1 AND mention_watch AND next_mention_at::text = $2 FOR UPDATE", [site.id, site.lease]);
      if (!still) { await client.query("ROLLBACK"); throw fail("the watch was turned off or its date moved meanwhile"); }
      const { rows: [row] } = await client.query(
        `INSERT INTO seo_mention_checks(site_id, user_id, name, name_key, since, page, cost_usd) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (site_id, run_on) DO NOTHING RETURNING id`,
        [site.id, site.user_id, site.name, key, since.toISOString(), JSON.stringify(o.data), o.costUsd]);
      if (!row) { await client.query("ROLLBACK"); throw fail("today's check already exists"); }
      await client.query("UPDATE seo_sites SET next_mention_at = now() + interval '1 month' WHERE id=$1 AND next_mention_at::text = $2", [site.id, site.lease]);
      await client.query("COMMIT");
      return { data: { id: row.id as number, pages: o.data.rows.length }, costUsd: o.costUsd, costUnknown: o.costUnknown, customerUsd: o.customerUsd };
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      throw e?.notSaved ? e : fail(e?.message ?? String(e));
    } finally { client.release(); }
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
            pages: pages.slice(0, 50).map((p) => ({ domain: p.domain, url: p.url, title: p.title, place: p.place, confirmed: p.confirmed, linksToYou: p.linksToYou })), more: Math.max(0, pages.length - 50) };
          const id = await saveAlert(c.user_id, siteId, "mention_new", `mention:${c.id}`, `${pages.length} new page${pages.length === 1 ? "" : "s"} mention "${c.name}" — ${pages.length === 1 ? "its website does" : "their websites do"} not link to ${c.domain}`, [item]);
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
      WHERE mention_watch AND next_mention_at <= now() AND nullif(btrim(coalesce(mention_name, business_name, '')), '') IS NOT NULL
      RETURNING id, user_id, domain, btrim(coalesce(nullif(btrim(mention_name), ''), business_name)) AS name, next_mention_at::text AS lease`);
  let done = 0;
  for (const site of due) {
    const later = (interval: string) => pool.query(`UPDATE seo_sites SET next_mention_at = now() + interval '${interval}' WHERE id=$1 AND mention_watch AND next_mention_at::text = $2`, [site.id, site.lease]).catch(() => {});
    try {
      if (!(await mentionWatchDeps.entitled(site.user_id))) { await later("1 day"); continue; }
      if (await takeWatchedCheck(site)) done++;
    } catch (e: any) {
      if (e instanceof SeoBudgetError) { console.warn(`[seo] mentions watch for ${site.domain} skipped: ${e.message}`); await later("1 day"); }
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
