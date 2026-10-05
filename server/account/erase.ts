/**
 * Account deletion, step 2 — erasing (server/account/delete.ts is step 1, closing). Runs for accounts closed at
 * least ERASE_AFTER_DAYS ago: deletes the account's own data and every CRM / Call Assistant workspace it owned, then
 * the files those rows pointed at in R2, then the user row (its ~50 ON DELETE CASCADE tables go with it).
 *
 * Kept on purpose (privacy policy: payment records 7 years, email logs 12 months, analytics 24 months), with no name
 * or email left to tie them to a person: subscriptions, billing_*, course/service purchases, seo_contracts,
 * billing_addon_intros, email_log, ch_analytics_events, beta_access_codes, crm_beta_invites.
 *
 * Never erases a workspace other people still use, and never while one of its phone numbers is still held at the
 * carrier (the number-release worker frees them after the subscription ends): such an account is reported "blocked"
 * and retried on the next run.
 */
import { pool } from "../db";
import { deleteFromR2, isR2Key } from "../r2";
import { ERASE_AFTER_DAYS } from "./delete";

/** Rows keyed by the user, without a cascade from users (erased explicitly). Children before parents is not needed:
 *  the delete loop retries a table that a foreign key still holds back. */
const USER_TABLES = [
  "account_api_usage", "ad_spy_keywords", "agency_member_clients", "agency_poll_grants", "agency_social_destinations",
  "business_locations", "citation_campaigns", "competitor_listings", "competitor_scans", "crm_members",
  "edge_actions", "edge_assets", "edge_jobs", "edge_location_links", "gmb_listings", "google_profile_reviews",
  "lsa_accounts", "lsa_connections", "lsa_leads", "lsa_manager_accounts", "media_folders", "media_photos",
  "ranking_grid_scans", "review_recipient_preferences", "review_referral_settings", "review_reminder_settings",
  "review_requests", "review_templates", "search_queries", "tracked_domains",
] as const;

/** Child rows that point at the user's parents (no user_id of their own, no cascade). */
const CHILD_DELETES: readonly string[] = [
  "DELETE FROM click_visits WHERE domain_id IN (SELECT id FROM tracked_domains WHERE user_id = $1)",
  "DELETE FROM blocked_ips WHERE domain_id IN (SELECT id FROM tracked_domains WHERE user_id = $1)",
  "DELETE FROM vpn_visits WHERE domain_id IN (SELECT id FROM tracked_domains WHERE user_id = $1)",
  "DELETE FROM citations WHERE campaign_id IN (SELECT id FROM citation_campaigns WHERE user_id = $1)",
  "DELETE FROM gmb_edit_history WHERE listing_id IN (SELECT id FROM gmb_listings WHERE user_id = $1)",
  "DELETE FROM location_analytics WHERE location_id IN (SELECT id FROM business_locations WHERE user_id = $1)",
  "DELETE FROM ranking_grid_results WHERE scan_id IN (SELECT id FROM ranking_grid_scans WHERE user_id = $1)",
];

export type EraseReport = {
  userId: number;
  status: "erased" | "dry_run" | "blocked" | "not_due";
  reason?: string;
  orgs: string[];
  rows: Record<string, number>;
  files: number;
  fileErrors: number;
};

const r2KeyOf = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const k = v.startsWith("/api/files/") ? v.slice("/api/files/".length) : v;
  return isR2Key(k) || k.startsWith("voice/") ? k : null;
};

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

async function existing(client: Client, tables: readonly string[]): Promise<string[]> {
  const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [tables]);
  const have = new Set(rows.map((r) => String(r.table_name)));
  return tables.filter((t) => have.has(t));
}

/** Run the deletes, retrying any statement a foreign key still holds back until a pass makes no progress. */
async function deleteAll(client: Client, statements: { label: string; sql: string; values: unknown[] }[], rows: Record<string, number>) {
  let pending = statements;
  for (let pass = 0; pending.length && pass < 12; pass++) {
    const failed: typeof pending = [];
    for (const s of pending) {
      await client.query("SAVEPOINT erase_step");
      try {
        const r = await client.query(s.sql, s.values);
        rows[s.label] = (rows[s.label] ?? 0) + (r.rowCount ?? 0);
        await client.query("RELEASE SAVEPOINT erase_step");
      } catch (e: any) {
        await client.query("ROLLBACK TO SAVEPOINT erase_step");
        if (e?.code !== "23503") throw e; // only foreign-key ordering is retried
        failed.push(s);
      }
    }
    if (failed.length === pending.length) throw new Error(`erase: foreign keys still hold ${failed.map((f) => f.label).join(", ")}`);
    pending = failed;
  }
}

export async function eraseClosedAccount(userId: number, opts: { dryRun?: boolean; now?: Date; ignoreWait?: boolean; deleteObject?: (key: string) => Promise<void> } = {}): Promise<EraseReport> {
  const report: EraseReport = { userId, status: "not_due", orgs: [], rows: {}, files: 0, fileErrors: 0 };
  const { rows: [user] } = await pool.query("SELECT id, deletion_requested_at FROM users WHERE id = $1", [userId]);
  if (!user?.deletion_requested_at) return { ...report, reason: "account is not closed" };
  const due = new Date(user.deletion_requested_at).getTime() + ERASE_AFTER_DAYS * 86_400_000;
  if (!opts.ignoreWait && due > (opts.now ?? new Date()).getTime()) return report;

  const { rows: orgRows } = await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id = $1", [userId]);
  const orgs = orgRows.map((r) => String(r.id));
  report.orgs = orgs;
  if (orgs.length) {
    const { rows: [team] } = await pool.query(
      "SELECT count(*)::int AS n FROM crm_members WHERE org_id = ANY($1::text[]) AND status = 'active' AND user_id IS DISTINCT FROM $2", [orgs, userId]);
    if (team.n > 0) return { ...report, status: "blocked", reason: "a workspace it owns still has other active members" };
    const { rows: [held] } = await pool.query(
      "SELECT count(*)::int AS n FROM voice_numbers WHERE org_id = ANY($1::text[]) AND status <> 'released' AND NOT is_test", [orgs]).catch(() => ({ rows: [{ n: 0 }] }));
    if (held.n > 0) return { ...report, status: "blocked", reason: `${held.n} phone number(s) not yet released at the carrier` };
  }

  // Files first collected (the rows that name them are about to go), deleted after the commit.
  const keys = new Set<string>();
  const collect = async (sql: string, values: unknown[]) => {
    const { rows } = await pool.query(sql, values).catch(() => ({ rows: [] as any[] }));
    for (const r of rows) for (const v of Object.values(r)) {
      for (const item of Array.isArray(v) ? v : [v]) { const k = r2KeyOf(item); if (k) keys.add(k); }
    }
  };
  await collect("SELECT r2_key FROM media_photos WHERE user_id = $1", [userId]);
  await collect("SELECT avatar_url, company_logo_url FROM users WHERE id = $1", [userId]);
  if (orgs.length) {
    await collect("SELECT recording_key FROM voice_calls WHERE org_id = ANY($1::text[])", [orgs]);
    await collect("SELECT storage_path FROM crm_attachments WHERE org_id = ANY($1::text[])", [orgs]);
    await collect("SELECT logo_url FROM crm_orgs WHERE id = ANY($1::text[])", [orgs]);
    await collect("SELECT report_url FROM crm_measurements WHERE org_id = ANY($1::text[])", [orgs]);
    await collect("SELECT image_url FROM crm_pb_materials WHERE org_id = ANY($1::text[])", [orgs]);
    await collect("SELECT photo_urls FROM crm_daily_logs WHERE org_id = ANY($1::text[])", [orgs]);
    await collect("SELECT photo_urls FROM crm_punch_items WHERE org_id = ANY($1::text[])", [orgs]);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const statements: { label: string; sql: string; values: unknown[] }[] = [];
    if (orgs.length) {
      // The homeowners' portal sessions/tokens name the org's customers, not the org.
      const { rows: cust } = await client.query("SELECT id::text AS id FROM crm_customers WHERE org_id = ANY($1::text[])", [orgs]);
      const customerIds = cust.map((c) => String(c.id));
      if (customerIds.length) {
        for (const t of await existing(client, ["crm_client_sessions", "crm_client_tokens"])) {
          statements.push({ label: t, sql: `DELETE FROM ${t} WHERE customer_ids ?| $1::text[]`, values: [customerIds] });
        }
      }
      const { rows: orgTables } = await client.query(
        `SELECT DISTINCT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'org_id' AND (table_name LIKE 'crm\\_%' OR table_name LIKE 'voice\\_%')`);
      for (const r of orgTables) {
        const t = String(r.table_name);
        statements.push({ label: t, sql: `DELETE FROM ${t} WHERE org_id::text = ANY($1::text[])`, values: [orgs] });
      }
      statements.push({ label: "crm_orgs", sql: "DELETE FROM crm_orgs WHERE id = ANY($1::text[])", values: [orgs] });
    }
    for (const [i, sql] of CHILD_DELETES.entries()) {
      const table = sql.split(" ")[2];
      if ((await existing(client, [table])).length) statements.push({ label: `${table}#${i}`, sql, values: [userId] });
    }
    for (const t of await existing(client, USER_TABLES)) {
      statements.push({ label: t, sql: `DELETE FROM ${t} WHERE user_id = $1`, values: [userId] });
    }
    statements.push({ label: "users", sql: "DELETE FROM users WHERE id = $1", values: [userId] });
    await deleteAll(client, statements, report.rows);
    for (const k of Object.keys(report.rows)) if (!report.rows[k]) delete report.rows[k];
    if (opts.dryRun) {
      await client.query("ROLLBACK");
      return { ...report, status: "dry_run", files: keys.size };
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally { client.release(); }

  const del = opts.deleteObject ?? deleteFromR2;
  for (const k of Array.from(keys)) {
    try { await del(k); report.files++; } catch { report.fileErrors++; }
  }
  return { ...report, status: "erased" };
}

/** Every closed account that is due (the daily worker; also `npx tsx scripts/erase-closed-accounts.ts --dry-run`). */
export async function eraseDueAccounts(opts: { dryRun?: boolean; now?: Date } = {}): Promise<EraseReport[]> {
  const { rows } = await pool.query(
    "SELECT id FROM users WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at <= $1::timestamptz - make_interval(days => $2) ORDER BY id",
    [(opts.now ?? new Date()).toISOString(), ERASE_AFTER_DAYS]);
  const out: EraseReport[] = [];
  for (const r of rows) {
    try { out.push(await eraseClosedAccount(Number(r.id), opts)); }
    catch (e: any) { out.push({ userId: Number(r.id), status: "blocked", reason: String(e?.message ?? e), orgs: [], rows: {}, files: 0, fileErrors: 0 }); }
  }
  return out;
}

/** Production only, behind ACCOUNT_ERASE_WORKER_ENABLED=true: once a day. */
export function startAccountEraseWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ACCOUNT_ERASE_WORKER_ENABLED !== "true" || env.NODE_ENV !== "production") return false;
  const run = () => eraseDueAccounts()
    .then((rs) => { if (rs.length) console.log("[account-erase]", JSON.stringify(rs.map((r) => ({ id: r.userId, status: r.status, reason: r.reason, files: r.files })))); })
    .catch((e) => console.error("[account-erase] run failed:", e?.message ?? e));
  setTimeout(run, 5 * 60_000).unref?.();
  setInterval(run, 24 * 3_600_000).unref?.();
  return true;
}
