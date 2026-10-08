/**
 * SEO alerts: what changed between one check and the next that a business
 * owner needs to hear about — rankings lost or won, the Google map pack
 * entered or left, linking sites lost or gained. Built from saved data, so an
 * alert never costs SEO data. Each alert is one row in seo_alerts (the Alerts
 * page) and one platform notification (the bell, and email when it is on).
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { notifyUser } from "../account-events";

export const DEFAULT_DROP = 3;
/** Movement below this position is noise: nobody sees page three. */
export const WATCH_DEPTH = 20;

export type CheckPair = {
  keywordId: number; keyword: string; device: string; location: string | null;
  position: number | null; previous: number | null;
  local: number | null; previousLocal: number | null;
};
export type RankChange = {
  keyword: string; device: string; location: string | null;
  /** "lost" = no longer in the tracked results, "new" = newly in them. */
  what: "dropped" | "lost" | "left_map_pack" | "improved" | "new" | "entered_map_pack";
  from: number | null; to: number | null;
};

/**
 * What moved enough to matter between two checks of the same keywords.
 * A drop or gain counts when it is at least `threshold` positions and the
 * better of the two positions is inside the first WATCH_DEPTH results.
 */
export function rankChanges(pairs: CheckPair[], threshold = DEFAULT_DROP): { drops: RankChange[]; gains: RankChange[] } {
  const drops: RankChange[] = [], gains: RankChange[] = [];
  const t = Math.max(1, Math.floor(threshold));
  for (const p of pairs) {
    const base = { keyword: p.keyword, device: p.device, location: p.location };
    if (p.previous !== null && p.position === null) { if (p.previous <= WATCH_DEPTH) drops.push({ ...base, what: "lost", from: p.previous, to: null }); }
    else if (p.previous === null && p.position !== null) { if (p.position <= WATCH_DEPTH) gains.push({ ...base, what: "new", from: null, to: p.position }); }
    else if (p.previous !== null && p.position !== null) {
      const moved = p.position - p.previous;
      if (moved >= t && p.previous <= WATCH_DEPTH) drops.push({ ...base, what: "dropped", from: p.previous, to: p.position });
      else if (-moved >= t && p.position <= WATCH_DEPTH) gains.push({ ...base, what: "improved", from: p.previous, to: p.position });
    }
    if (p.previousLocal !== null && p.local === null) drops.push({ ...base, what: "left_map_pack", from: p.previousLocal, to: null });
    else if (p.previousLocal === null && p.local !== null) gains.push({ ...base, what: "entered_map_pack", from: null, to: p.local });
  }
  const weight = (c: RankChange) => Math.min(c.from ?? 999, c.to ?? 999);
  return { drops: drops.sort((a, b) => weight(a) - weight(b)), gains: gains.sort((a, b) => weight(a) - weight(b)) };
}

/** One line a person can read: `"roof repair" in Tampa, Florida fell from 4 to 9 (mobile)`. */
export function describeChange(c: RankChange): string {
  const where = c.location ? ` in ${c.location}` : "";
  const dev = ` (${c.device})`;
  switch (c.what) {
    case "dropped": return `"${c.keyword}"${where} fell from ${c.from} to ${c.to}${dev}`;
    case "lost": return `"${c.keyword}"${where} dropped out of the results — it was ${c.from}${dev}`;
    case "left_map_pack": return `"${c.keyword}"${where} is no longer in the Google map pack — it was ${c.from}${dev}`;
    case "improved": return `"${c.keyword}"${where} rose from ${c.from} to ${c.to}${dev}`;
    case "new": return `"${c.keyword}"${where} now ranks at ${c.to}${dev}`;
    case "entered_map_pack": return `"${c.keyword}"${where} is now in the Google map pack at ${c.to}${dev}`;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const ITEM_CAP = 200;

/** Insert the alert once (per site, kind and source); its id when it is new, null when it already exists. */
async function saveAlert(userId: number, siteId: number, kind: string, source: string, title: string, items: unknown[]): Promise<number | null> {
  const { rows: [row] } = await pool.query(
    `INSERT INTO seo_alerts(user_id, site_id, kind, source, title, items) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (site_id, kind, source) DO NOTHING RETURNING id`,
    [userId, siteId, kind, source, title, JSON.stringify(items.slice(0, ITEM_CAP))]);
  return row ? Number(row.id) : null;
}

/** The bell / email text for a saved alert. Pure, for tests. */
export function alertMessage(a: { kind: string; title: string; domain: string; items: any[] }): { kind: "seo.rank_drop" | "seo.rank_gain" | "seo.links_change"; title: string; body: string; severity: "info" | "warning"; actionLabel: string; actionUrl: string } {
  if (a.kind === "rank_drop" || a.kind === "rank_gain") {
    const items = (Array.isArray(a.items) ? a.items : []) as RankChange[];
    return {
      kind: a.kind === "rank_drop" ? "seo.rank_drop" : "seo.rank_gain", title: a.title, severity: a.kind === "rank_drop" ? "warning" : "info",
      body: items.slice(0, 5).map(describeChange).join("\n") + (items.length > 5 ? `\n…and ${items.length - 5} more.` : ""),
      actionLabel: "See what changed", actionUrl: "/seo/alerts",
    };
  }
  const i = (Array.isArray(a.items) ? a.items[0] : null) ?? {};
  return {
    kind: "seo.links_change", title: a.title, severity: a.kind === "links_lost" ? "warning" : "info",
    body: `Sites linking to ${a.domain}: ${i.from ?? "?"} on ${i.since ?? "the last snapshot"}, ${i.to ?? "?"} now.`,
    actionLabel: "See the links", actionUrl: "/seo/backlinks",
  };
}

/**
 * Send one alert to the bell (and email when that is on). A delivery in
 * progress holds a five-minute lease (`claimed_at`); `notified_at` is set only
 * after it went out. A crash mid-delivery therefore leaves the alert due again
 * when the lease runs out, instead of marking it sent.
 */
export async function deliverAlert(alertId: number): Promise<boolean> {
  // Only the sender holding this token may finish or give up the delivery: a slow sender whose lease ran out cannot undo a newer one's.
  const token = randomUUID();
  const { rows: [a] } = await pool.query(
    `UPDATE seo_alerts x SET claimed_at=now(), claim_token=$2 FROM seo_sites s
      WHERE x.id=$1 AND x.notified_at IS NULL AND (x.claimed_at IS NULL OR x.claimed_at < now() - interval '5 minutes') AND s.id=x.site_id
     RETURNING x.id, x.user_id, x.kind, x.title, x.items, s.domain`, [alertId, token]);
  if (!a) return false;
  try {
    const m = alertMessage(a);
    await notifyUser(a.user_id, m.kind, { title: m.title, body: m.body, link: "/seo/alerts", severity: m.severity, actionLabel: m.actionLabel, actionUrl: m.actionUrl });
    await pool.query("UPDATE seo_alerts SET notified_at=now(), claimed_at=NULL, claim_token=NULL WHERE id=$1 AND claim_token=$2", [alertId, token]);
    return true;
  } catch (e: any) {
    await pool.query("UPDATE seo_alerts SET claimed_at=NULL, claim_token=NULL WHERE id=$1 AND notified_at IS NULL AND claim_token=$2", [alertId, token]).catch(() => {});
    console.error(`[seo] alert ${alertId} was not delivered (it will be retried): ${e?.message ?? e}`);
    return false;
  }
}

/** Alerts saved but not sent (a crash, a failed send, a lease that ran out): try again for three days. */
export async function deliverPendingAlerts(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM seo_alerts WHERE notified_at IS NULL AND created_at < now() - interval '2 minutes' AND created_at > now() - interval '3 days'
        AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes') ORDER BY id LIMIT 20`);
  let sent = 0;
  for (const r of rows) if (await deliverAlert(Number(r.id))) sent++;
  return sent;
}

/**
 * After a rank run: compare each keyword's newest check with the check of the
 * day before it and raise what moved. One alert of each kind per site per day:
 * running the check again the same day compares with the same earlier day, so
 * it must not tell the owner the same thing twice.
 */
export async function raiseRankAlerts(siteId: number, runId: string): Promise<{ drops: number; gains: number }> {
  const { rows: [site] } = await pool.query("SELECT id, user_id, domain, alerts_enabled, alert_drop, current_date::text AS today FROM seo_sites WHERE id=$1", [siteId]);
  if (!site || site.alerts_enabled === false) return { drops: 0, gains: 0 };
  const { rows } = await pool.query(
    `SELECT k.id AS "keywordId", k.keyword, NULLIF(k.location_name, 'United States') AS location, x.device,
            max(x.position) FILTER (WHERE rn=1) AS position, max(x.position) FILTER (WHERE rn=2) AS previous,
            max(x.local_position) FILTER (WHERE rn=1) AS local, max(x.local_position) FILTER (WHERE rn=2) AS "previousLocal",
            bool_or(rn=1 AND x.run_id=$2) AS in_run
       FROM (SELECT c.*, row_number() OVER (PARTITION BY keyword_id, device ORDER BY checked_on DESC) rn FROM seo_rank_checks c WHERE c.site_id=$1) x
       JOIN seo_keywords k ON k.id=x.keyword_id
      WHERE rn<=2 GROUP BY k.id, k.keyword, k.location_name, x.device HAVING count(*)=2`, [siteId, runId]);
  // Only keywords this run actually checked, and only those that had a check before it.
  const { drops, gains } = rankChanges(rows.filter((r: any) => r.in_run), site.alert_drop ?? DEFAULT_DROP);
  for (const [kind, items, verb] of [["rank_drop", drops, "fell"], ["rank_gain", gains, "improved"]] as const) {
    if (!items.length) continue;
    const id = await saveAlert(site.user_id, siteId, kind, site.today, `${plural(items.length, "ranking")} ${verb} for ${site.domain}`, items);
    if (id) await deliverAlert(id);
  }
  return { drops: drops.length, gains: gains.length };
}

/** Linking sites lost or gained between two snapshots, when it is at least 3 sites and 5% of what there was. */
export function linkChange(now: number | null | undefined, before: number | null | undefined): { kind: "links_lost" | "links_gained"; by: number } | null {
  if (typeof now !== "number" || typeof before !== "number") return null;
  const by = now - before;
  if (Math.abs(by) < Math.max(3, Math.ceil(before * 0.05))) return null;
  return { kind: by < 0 ? "links_lost" : "links_gained", by: Math.abs(by) };
}

/** After a backlink snapshot: compare with the snapshot before it. */
export async function raiseLinkAlerts(siteId: number): Promise<string | null> {
  const { rows: [site] } = await pool.query("SELECT id, user_id, domain, alerts_enabled FROM seo_sites WHERE id=$1", [siteId]);
  if (!site || site.alerts_enabled === false) return null;
  const { rows } = await pool.query("SELECT taken_on::text AS taken_on, summary FROM seo_backlink_snapshots WHERE site_id=$1 ORDER BY taken_on DESC LIMIT 2", [siteId]);
  if (rows.length < 2) return null;
  const [latest, previous] = rows;
  const change = linkChange(latest.summary?.referringDomains, previous.summary?.referringDomains);
  if (!change) return null;
  const title = `${site.domain} ${change.kind === "links_lost" ? "lost" : "gained"} ${plural(change.by, "linking site")}`;
  const items = [{ from: previous.summary.referringDomains, to: latest.summary.referringDomains, since: previous.taken_on, backlinksFrom: previous.summary?.backlinks ?? null, backlinksTo: latest.summary?.backlinks ?? null }];
  const id = await saveAlert(site.user_id, siteId, change.kind, latest.taken_on, title, items);
  if (!id) return null;
  await deliverAlert(id);
  return change.kind;
}

export async function listAlerts(userId: number, siteId: number | null, limit = 100) {
  const { rows } = await pool.query(
    `SELECT a.id, a.site_id AS "siteId", s.domain, a.kind, a.title, a.items, a.read_at AS "readAt", a.created_at AS "createdAt"
       FROM seo_alerts a JOIN seo_sites s ON s.id=a.site_id
      WHERE a.user_id=$1 AND ($2::int IS NULL OR a.site_id=$2) ORDER BY a.created_at DESC LIMIT $3`, [userId, siteId, limit]);
  return rows;
}
export async function unreadAlerts(userId: number): Promise<number> {
  const { rows: [r] } = await pool.query("SELECT count(*)::int n FROM seo_alerts WHERE user_id=$1 AND read_at IS NULL", [userId]);
  return r?.n ?? 0;
}
export async function markAlertsRead(userId: number, ids: number[] | null): Promise<void> {
  await pool.query(`UPDATE seo_alerts SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2))`, [userId, ids]);
}
