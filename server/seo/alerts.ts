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
export async function saveAlert(userId: number, siteId: number, kind: string, source: string, title: string, items: unknown[], db: { query: typeof pool.query } = pool): Promise<number | null> {
  const { rows: [row] } = await db.query(
    `INSERT INTO seo_alerts(user_id, site_id, kind, source, title, items) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (site_id, kind, source) DO NOTHING RETURNING id`,
    [userId, siteId, kind, source, title, JSON.stringify(items.slice(0, ITEM_CAP))]);
  return row ? Number(row.id) : null;
}

/** The bell / email text for a saved alert. Pure, for tests. */
export function alertMessage(a: { kind: string; title: string; domain: string; items: any[] }): { kind: "seo.rank_drop" | "seo.rank_gain" | "seo.links_change" | "seo.grid_change" | "seo.mention_new"; title: string; body: string; severity: "info" | "warning"; actionLabel: string; actionUrl: string } {
  if (a.kind === "rank_drop" || a.kind === "rank_gain") {
    const items = (Array.isArray(a.items) ? a.items : []) as RankChange[];
    return {
      kind: a.kind === "rank_drop" ? "seo.rank_drop" : "seo.rank_gain", title: a.title, severity: a.kind === "rank_drop" ? "warning" : "info",
      body: items.slice(0, 5).map(describeChange).join("\n") + (items.length > 5 ? `\n…and ${items.length - 5} more.` : ""),
      actionLabel: "See what changed", actionUrl: "/seo/alerts",
    };
  }
  const i = (Array.isArray(a.items) ? a.items[0] : null) ?? {};
  // Keyword watch: searches the search data newly sees the site ranking for, or no longer sees, between two snapshots.
  if (a.kind === "kw_new" || a.kind === "kw_lost") {
    const list: any[] = Array.isArray(i.keywords) ? i.keywords : [];
    const line = (k: any) => (a.kind === "kw_new" ? `"${k.keyword}" — position ${k.position ?? "?"}${k.volume != null ? `, ${k.volume} searches a month` : ""}` : `"${k.keyword}" — was at position ${k.was ?? "?"}`);
    return {
      kind: a.kind === "kw_new" ? "seo.rank_gain" : "seo.rank_drop", title: a.title, severity: a.kind === "kw_new" ? "info" : "warning",
      body: `In the search data, compared with the snapshot of ${i.since ?? "last month"}:\n` + list.slice(0, 5).map(line).join("\n") + (list.length + (Number(i.more) || 0) > 5 ? `\n…and ${list.length + (Number(i.more) || 0) - 5} more.` : ""),
      actionLabel: "See the keywords", actionUrl: "/seo/alerts",
    };
  }
  if (a.kind === "mention_new") {
    const pages = Array.isArray(i?.pages) ? i.pages : [];
    return {
      kind: "seo.mention_new", title: a.title, severity: "info",
      body: `Published since ${i?.since ?? "the last check"} and using "${i?.name ?? ""}" (likely you — check each one):\n${pages.slice(0, 5).map((p: any) => `${p.domain}${p.title ? ` — ${String(p.title).slice(0, 80)}` : ""}`).join("\n")}${pages.length > 5 ? "\n…" : ""}`,
      actionLabel: "See the mentions", actionUrl: i?.siteId ? `/seo/mentions?site=${Number(i.siteId)}${i?.checkId ? `&check=${Number(i.checkId)}` : ""}` : "/seo/mentions",
    };
  }
  if (a.kind === "grid_down" || a.kind === "grid_up")
    return {
      kind: "seo.grid_change", title: a.title, severity: a.kind === "grid_down" ? "warning" : "info",
      body: `Local grid for "${i.keyword ?? ""}" (${i.size} × ${i.size} points): in the first three local results at ${i.top3} of ${i.checked} points, was ${i.wasTop3} of ${i.wasChecked}. Position score ${i.score ?? "—"}, was ${i.wasScore ?? "—"} (lower is better).`,
      actionLabel: "See the grid", actionUrl: "/seo/local-grid",
    };
  return {
    kind: "seo.links_change", title: a.title, severity: a.kind === "links_lost" ? "warning" : "info",
    body: `Sites linking to ${a.domain}: ${i.from ?? "?"} on ${i.since ?? "the last snapshot"}, ${i.to ?? "?"} now.` +
      (Array.isArray(i.lost) && i.lost.length ? `\nLinks lost from: ${i.lost.slice(0, 5).map((l: any) => `${l.domain}${l.authority != null ? ` (authority ${l.authority})` : ""}`).join(", ")}${i.lost.length > 5 ? ", …" : ""}.` : ""),
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
  // A site whose alerts were switched off after this one was saved: it stays on the Alerts page but is not sent.
  await pool.query("UPDATE seo_alerts x SET notified_at=now() FROM seo_sites s WHERE x.id=$1 AND x.notified_at IS NULL AND s.id=x.site_id AND s.alerts_enabled = false", [alertId]);
  const { rows: [a] } = await pool.query(
    `UPDATE seo_alerts x SET claimed_at=now(), claim_token=$2 FROM seo_sites s
      WHERE x.id=$1 AND x.notified_at IS NULL AND (x.claimed_at IS NULL OR x.claimed_at < now() - interval '5 minutes') AND s.id=x.site_id AND s.alerts_enabled IS NOT FALSE
     RETURNING x.id, x.user_id, x.kind, x.title, x.items, s.domain`, [alertId, token]);
  if (!a) return false;
  try {
    // Looked at again right before sending: alerts switched off since the claim mean it is kept on the page, not sent.
    const { rowCount: on } = await pool.query("SELECT 1 FROM seo_alerts x JOIN seo_sites s ON s.id = x.site_id WHERE x.id=$1 AND x.claim_token=$2 AND s.alerts_enabled IS NOT FALSE", [alertId, token]);
    if (!on) { await pool.query("UPDATE seo_alerts SET notified_at=now(), claimed_at=NULL, claim_token=NULL WHERE id=$1 AND claim_token=$2", [alertId, token]); return false; }
    const m = alertMessage(a);
    const sent = await notifyUser(a.user_id, m.kind, { title: m.title, body: m.body, link: "/seo/alerts", severity: m.severity, actionLabel: m.actionLabel, actionUrl: m.actionUrl });
    // The bell entry is there; an email that failed is tried again on its own.
    // A failed email is queued again only while the site's alerts are still on (switching them off meanwhile wins).
    await pool.query(`UPDATE seo_alerts x SET notified_at=now(), claimed_at=NULL, claim_token=NULL,
        email_retry_at = CASE WHEN $3 AND (SELECT s.alerts_enabled FROM seo_sites s WHERE s.id = x.site_id) IS NOT FALSE THEN now() + interval '15 minutes' ELSE NULL END
      WHERE x.id=$1 AND x.claim_token=$2`, [alertId, token, sent?.email === "failed"]);
    return true;
  } catch (e: any) {
    await pool.query("UPDATE seo_alerts SET claimed_at=NULL, claim_token=NULL WHERE id=$1 AND notified_at IS NULL AND claim_token=$2", [alertId, token]).catch(() => {});
    console.error(`[seo] alert ${alertId} was not delivered (it will be retried): ${e?.message ?? e}`);
    return false;
  }
}

/** Emails that failed after their alert's bell entry went out: the email alone, up to four tries, 15 minutes apart. */
export const EMAIL_TRIES = 4;
export async function retryAlertEmails(): Promise<number> {
  // A small batch at a time, each email claimed with this pass's token (another pass skips the claimed ones, and only
  // this pass can mark them sent); the claim also moves the next try on, so an abandoned one comes back later.
  const token = randomUUID();
  const { rows } = await pool.query(
    `UPDATE seo_alerts x SET email_retry_at = now() + interval '15 minutes', email_tries = x.email_tries + 1, email_claim = $1
       FROM seo_sites s
      WHERE s.id = x.site_id AND x.id IN (
        SELECT a.id FROM seo_alerts a JOIN seo_sites t ON t.id = a.site_id
         WHERE a.email_retry_at <= now() AND a.email_tries < ${EMAIL_TRIES} AND t.alerts_enabled IS NOT FALSE
         ORDER BY a.email_retry_at LIMIT 10 FOR UPDATE OF a SKIP LOCKED)
     RETURNING x.id, x.user_id, x.kind, x.title, x.items, s.domain, x.email_tries`, [token]).catch(() => ({ rows: [] as any[] }));
  let sent = 0;
  for (const a of rows) {
    try {
      // Looked at again just before sending: alerts switched off since the batch was claimed end this one.
      const { rowCount: on } = await pool.query("SELECT 1 FROM seo_alerts x JOIN seo_sites s ON s.id = x.site_id WHERE x.id=$1 AND x.email_claim=$2 AND s.alerts_enabled IS NOT FALSE", [a.id, token]);
      if (!on) { await pool.query("UPDATE seo_alerts SET email_retry_at=NULL, email_claim=NULL WHERE id=$1 AND email_claim=$2", [a.id, token]); continue; }
      const m = alertMessage(a);
      const r = await notifyUser(a.user_id, m.kind, { title: m.title, body: m.body, link: "/seo/alerts", severity: m.severity, actionLabel: m.actionLabel, actionUrl: m.actionUrl }, { only: "email" });
      if (r.email !== "failed" || a.email_tries >= EMAIL_TRIES) await pool.query("UPDATE seo_alerts SET email_retry_at=NULL, email_claim=NULL WHERE id=$1 AND email_claim=$2", [a.id, token]);
      if (r.email !== "failed") sent++;
    } catch (e: any) { console.error(`[seo] alert ${a.id} email retry failed: ${e?.message ?? e}`); }
  }
  return sent;
}

/** Alerts saved but not sent (a crash, a failed send, a lease that ran out): try again for three days. */
export async function deliverPendingAlerts(): Promise<number> {
  await retryAlertEmails().catch((e) => console.error("[seo] alert email retries failed", e?.message ?? e));
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
export type RankAlertPlan = { userId: number; siteId: number; domain: string; drops: RankChange[]; gains: RankChange[] } | null;
/**
 * What a run moved, worked out from its own checks against each keyword's check before (read only). Done BEFORE the run
 * is closed: closing and saving these alerts then happen in one transaction, so a run is never done without its alerts.
 */
export async function rankAlertPlan(siteId: number, runId: string, db: { query: typeof pool.query } = pool): Promise<RankAlertPlan> {
  const { rows: [site] } = await db.query("SELECT id, user_id, domain, alerts_enabled, alert_drop FROM seo_sites WHERE id=$1", [siteId]);
  if (!site || site.alerts_enabled === false) return null;
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
  return { userId: site.user_id, siteId, domain: site.domain, drops, gains };
}
/**
 * Saves a plan's alerts with `db` (inside the transaction that closes the run), filed under the transaction's own day.
 * `partial`: the run stopped before every keyword came back — said in the title. Returns the new alerts' ids (to send).
 */
export async function saveRankAlerts(db: { query: typeof pool.query }, plan: RankAlertPlan, partial = false): Promise<number[]> {
  if (!plan) return [];
  const { rows: [{ today }] } = await db.query("SELECT current_date::text AS today");
  const ids: number[] = [];
  for (const [kind, items, verb] of [["rank_drop", plan.drops, "fell"], ["rank_gain", plan.gains, "improved"]] as const) {
    if (!items.length) continue;
    const id = await saveAlert(plan.userId, plan.siteId, kind, today, `${plural(items.length, "ranking")} ${verb} for ${plan.domain}${partial ? " (from a check that stopped early)" : ""}`, items, db);
    if (id) ids.push(id);
  }
  return ids;
}
/** Work out, save and send a run's alerts (outside a run's closing; the closing does the same in its transaction). */
export async function raiseRankAlerts(siteId: number, runId: string): Promise<{ drops: number; gains: number }> {
  const plan = await rankAlertPlan(siteId, runId);
  for (const id of await saveRankAlerts(pool, plan)) await deliverAlert(id);
  return { drops: plan?.drops.length ?? 0, gains: plan?.gains.length ?? 0 };
}

/** Linking sites lost or gained between two snapshots, when it is at least 3 sites and 5% of what there was. */
export function linkChange(now: number | null | undefined, before: number | null | undefined): { kind: "links_lost" | "links_gained"; by: number } | null {
  if (typeof now !== "number" || typeof before !== "number") return null;
  const by = now - before;
  if (Math.abs(by) < Math.max(3, Math.ceil(before * 0.05))) return null;
  return { kind: by < 0 ? "links_lost" : "links_gained", by: Math.abs(by) };
}

/** After a backlink snapshot: compare with the snapshot before it. */
/** A lost link from a site at least this strong (0–100) is worth an alert on its own… */
export const STRONG_LINK = 30;
/** …unless the site looks like spam (a spam score this high) or the link was nofollow: those are no loss. */
export const SPAM_LIMIT = 50;
type LostRow = { domain: string; authority: number | null; spam?: number | null; follow?: boolean; from: string | null; to: string | null; lastSeen: string | null };
/** The lost backlinks worth naming in an alert: strongest site first, at most ten. Pure. */
export function namedLosses(lost: unknown): LostRow[] {
  return (Array.isArray(lost) ? lost : []).filter((l): l is LostRow => !!l && typeof l.domain === "string")
    .sort((a, b) => (b.authority ?? -1) - (a.authority ?? -1)).slice(0, 10)
    .map((l) => ({ domain: l.domain, authority: l.authority ?? null, spam: l.spam ?? null, follow: l.follow !== false, from: l.from ?? null, to: l.to ?? null, lastSeen: l.lastSeen ?? null }));
}
/**
 * Is this lost link one that mattered: a followed link from a site with some authority that is not known to be spam?
 * (An unknown spam score is not evidence either way; the alert shows it as unknown.) Pure.
 */
export const isStrongLoss = (l: LostRow) => (l.authority ?? 0) >= STRONG_LINK && l.follow !== false && (l.spam == null || l.spam < SPAM_LIMIT);
/** Every strong loss among ALL the saved losses, strongest first — judged before any list is cut to ten. Pure. */
export function strongLosses(lost: unknown): LostRow[] {
  return (Array.isArray(lost) ? lost : []).filter((l): l is LostRow => !!l && typeof l.domain === "string").filter(isStrongLoss)
    .sort((a, b) => (b.authority ?? -1) - (a.authority ?? -1)).slice(0, 10)
    .map((l) => ({ domain: l.domain, authority: l.authority ?? null, spam: l.spam ?? null, follow: l.follow !== false, from: l.from ?? null, to: l.to ?? null, lastSeen: l.lastSeen ?? null }));
}
/**
 * After a snapshot, two questions asked separately: did the count of linking sites move enough (linkChange)? and was a
 * link from a strong site lost? A month can gain sites overall and still lose one that mattered — then both are said.
 * Returns the kind of the first alert raised, or null.
 */
export async function raiseLinkAlerts(siteId: number, /** The snapshot to judge (its date); the newest when left out. It is compared with the snapshot before it. */ takenOn?: string): Promise<string | null> {
  const { rows: [site] } = await pool.query("SELECT id, user_id, domain, alerts_enabled FROM seo_sites WHERE id=$1", [siteId]);
  if (!site || site.alerts_enabled === false) return null;
  const { rows } = await pool.query("SELECT taken_on::text AS taken_on, summary, changes FROM seo_backlink_snapshots WHERE site_id=$1 AND ($2::date IS NULL OR taken_on <= $2::date) ORDER BY taken_on DESC LIMIT 2", [siteId, takenOn ?? null]);
  if (rows.length < 2 || (takenOn && rows[0].taken_on !== takenOn)) return null;
  const [latest, previous] = rows;
  const change = linkChange(latest.summary?.referringDomains, previous.summary?.referringDomains);
  // Named losses belong to this comparison only when they were collected since the snapshot it is compared with.
  const mine = latest.changes?.since === previous.taken_on;
  const lost = mine ? namedLosses(latest.changes?.lost) : [];
  const strong = mine ? strongLosses(latest.changes?.lost) : [];
  const counts = { from: previous.summary?.referringDomains ?? null, to: latest.summary?.referringDomains ?? null, since: previous.taken_on, backlinksFrom: previous.summary?.backlinks ?? null, backlinksTo: latest.summary?.backlinks ?? null };
  let raised: string | null = null;
  const raise = async (kind: "links_lost" | "links_gained", title: string, names: LostRow[]) => {
    const id = await saveAlert(site.user_id, siteId, kind, latest.taken_on, title, [{ ...counts, lost: names, lostShown: names.length, lostTotal: names.length ? latest.changes?.lostTotal ?? null : null }]);
    if (id) { await deliverAlert(id); raised ??= kind; }
  };
  if (change) await raise(change.kind, `${site.domain} ${change.kind === "links_lost" ? "lost" : "gained"} ${plural(change.by, "linking site")}`, change.kind === "links_lost" ? lost : []);
  // A strong link lost is said even when the count rose, or barely moved. (When the count fell, the alert above already names it.)
  if (strong.length && change?.kind !== "links_lost")
    await raise("links_lost", `${site.domain} lost ${strong.length === 1 ? `a link from ${strong[0].domain}` : `links from ${strong.length} strong sites`}`, strong);
  return raised;
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
