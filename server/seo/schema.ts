import { LOCATION_SCHEMA_DDL } from "./locations";
import { LIST_SCHEMA_DDL } from "./lists";
import { REPORT_SCHEDULE_DDL } from "./site-report";
import { REPORT_RECIPIENT_DDL } from "./report-recipients";
import { VOICE_SCHEMA_DDL } from "./voice";
import { AI_SCHEMA_DDL } from "./ai-visibility";
import { GRID_SCHEMA_DDL } from "./grid";
import { RENDER_SCHEMA_DDL } from "./render-check";
import { KEYWORD_WATCH_DDL, KEYWORD_WATCH_ALERT_DDL } from "./keyword-watch";
import { MENTION_WATCH_DDL, MENTION_WATCH_ALERT_DDL } from "./mention-watch";
import { GRID_WATCH_DDL } from "./grid-monitor";
import { TASK_SCHEMA_DDL } from "./tasks";
import { pool } from "../db";
import { EXPLORER_SCHEMA_DDL } from "./explorer";
import { CREDIT_SCHEMA_DDL } from "./credits";
import { REPORT_SCHEMA_DDL } from "./reports";

/**
 * SEO toolset tables (rank tracker, keyword research, backlinks, competitor
 * gap, DataForSEO spend ledger). Idempotent: boot runs them, and
 * scripts/apply-schema-migration.ts spreads SEO_SCHEMA_DDL into its list.
 *
 * Tenancy follows the rest of the platform: every row carries user_id = the
 * paying account (an agency member acting in the owner's workspace spends the
 * owner's allowance — getDevUser maps res.locals.agencyOwner onto user.id).
 */
export const SEO_SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS seo_sites (
    id serial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain text NOT NULL,
    location_code integer NOT NULL DEFAULT 2840,
    language_code text NOT NULL DEFAULT 'en',
    devices text NOT NULL DEFAULT 'both' CHECK (devices IN ('desktop','mobile','both')),
    serp_depth integer NOT NULL DEFAULT 10 CHECK (serp_depth BETWEEN 10 AND 100),
    next_rank_check_at timestamptz NOT NULL DEFAULT now(),
    next_backlinks_at timestamptz NOT NULL DEFAULT now(),
    last_rank_check_at timestamptz,
    last_backlinks_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, domain)
  )`,
  `CREATE TABLE IF NOT EXISTS seo_keywords (
    id serial PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keyword text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    search_volume integer,
    cpc numeric(10,4),
    difficulty integer,
    volume_checked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, keyword)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_keywords_site ON seo_keywords(site_id)`,
  // One rank-check run per site per trigger: the queued task ids live in
  // `tasks` while the standard queue works, polled by server/seo/jobs.ts.
  `CREATE TABLE IF NOT EXISTS seo_rank_runs (
    id uuid PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trigger text NOT NULL DEFAULT 'weekly',
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
    total integer NOT NULL DEFAULT 0,
    checked integer NOT NULL DEFAULT 0,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    error text,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS seo_rank_runs_site ON seo_rank_runs(site_id, created_at DESC)`,
  // One open run per site: two requests at once cannot both buy the same check.
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_rank_runs_one_active ON seo_rank_runs(site_id) WHERE status IN ('queued','running')`,
  `CREATE TABLE IF NOT EXISTS seo_rank_checks (
    id bigserial PRIMARY KEY,
    keyword_id integer NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    run_id uuid REFERENCES seo_rank_runs(id) ON DELETE SET NULL,
    checked_on date NOT NULL DEFAULT current_date,
    device text NOT NULL CHECK (device IN ('desktop','mobile')),
    position integer,
    url text,
    serp_features jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (keyword_id, checked_on, device)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_rank_checks_site_date ON seo_rank_checks(site_id, checked_on DESC)`,
  `CREATE TABLE IF NOT EXISTS seo_backlink_snapshots (
    id serial PRIMARY KEY,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    taken_on date NOT NULL DEFAULT current_date,
    summary jsonb NOT NULL,
    backlinks jsonb NOT NULL DEFAULT '[]'::jsonb,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, taken_on)
  )`,
  // The linking sites lost since the snapshot before (named, with the page that linked): { since, lost: [...], lostTotal }.
  `ALTER TABLE seo_backlink_snapshots ADD COLUMN IF NOT EXISTS changes jsonb`,
  // false until the link alerts this snapshot calls for have been raised (existing snapshots are long dealt with).
  `ALTER TABLE seo_backlink_snapshots ADD COLUMN IF NOT EXISTS alerts_done boolean NOT NULL DEFAULT true`,
  `ALTER TABLE seo_backlink_snapshots ALTER COLUMN alerts_done SET DEFAULT false`,
  `ALTER TABLE seo_backlink_snapshots ADD COLUMN IF NOT EXISTS alerts_tried_at timestamptz`,
  // DataForSEO spend, per paying account per calendar month (UTC). The cap in
  // server/seo/budget.ts reads the platform-wide sum of a month.
  `CREATE TABLE IF NOT EXISTS seo_api_usage (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month text NOT NULL,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    requests integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month)
  )`,
  // Site Explorer: saved domain reports (server/seo/explorer.ts).
  ...EXPLORER_SCHEMA_DDL,
  // The customer's SEO data credit (server/seo/credits.ts).
  ...CREDIT_SCHEMA_DDL,
  // Saved pages of Site Explorer reports and keyword overviews (server/seo/reports.ts).
  ...REPORT_SCHEMA_DDL,
  // AI visibility: saved answers from the assistants (server/seo/ai-visibility.ts).
  ...AI_SCHEMA_DDL,
  ...GRID_SCHEMA_DDL,
  // Rendering checks: pages fetched plain and in a browser (server/seo/render-check.ts).
  ...RENDER_SCHEMA_DDL,
  // Keyword watch: monthly snapshots of what a site ranks for (server/seo/keyword-watch.ts).
  ...KEYWORD_WATCH_DDL,
  // Followed competitors and the saved result pages (server/seo/voice.ts).
  ...VOICE_SCHEMA_DDL,
  // Scheduled SEO reports (server/seo/site-report.ts).
  ...REPORT_SCHEDULE_DDL,
  // Who may get them: confirmed recipients and the addresses that refused (server/seo/report-recipients.ts).
  ...REPORT_RECIPIENT_DDL,
  // Keyword lists (server/seo/lists.ts).
  ...LIST_SCHEMA_DDL,
  // What each lookup was, for the customer's usage history (server/seo/usage.ts).
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS label text`,
  `CREATE INDEX IF NOT EXISTS seo_reservations_user ON seo_reservations(user_id, created_at DESC)`,
  // Places a rank check can be run from (server/seo/locations.ts).
  ...LOCATION_SCHEMA_DDL,
  `CREATE INDEX IF NOT EXISTS seo_locations_loaded ON seo_locations(loaded_at DESC)`,
  // A keyword can be tracked in several places: the same keyword in Tampa and in Clearwater is two rows.
  `ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS location_code integer`,
  `ALTER TABLE seo_keywords ADD COLUMN IF NOT EXISTS location_name text`,
  // The new rule is in place before the old one goes, so there is never a moment with neither.
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_keywords_site_keyword_place ON seo_keywords(site_id, keyword, coalesce(location_code, 0))`,
  `ALTER TABLE seo_keywords DROP CONSTRAINT IF EXISTS seo_keywords_site_id_keyword_key`,
  // Every keyword carries the place it is checked from, so changing a site's default never moves a keyword's history.
  `UPDATE seo_keywords k SET location_code=s.location_code, location_name=CASE WHEN s.location_code=2840 THEN 'United States' ELSE k.location_name END
     FROM seo_sites s WHERE s.id=k.site_id AND k.location_code IS NULL
      AND NOT EXISTS (SELECT 1 FROM seo_keywords x WHERE x.site_id=k.site_id AND x.keyword=k.keyword AND x.location_code=s.location_code)`,
  // The Google map pack: this business's place in it (1-3, null = not in it) and who was in it.
  `ALTER TABLE seo_rank_checks ADD COLUMN IF NOT EXISTS local_position integer`,
  `ALTER TABLE seo_rank_checks ADD COLUMN IF NOT EXISTS local_pack jsonb`,
  // The name on the Google Business Profile (map-pack entries often carry no website), and alert settings.
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS business_name text`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS alerts_enabled boolean NOT NULL DEFAULT true`,
  // How often rankings are checked automatically (server/seo/jobs.ts RANK_FREQUENCIES).
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS rank_frequency text NOT NULL DEFAULT 'weekly'`,
  // A group the customer puts the site in on the dashboard (a client, a region); null = none.
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS group_name text`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seo_sites_rank_frequency_check') THEN
     ALTER TABLE seo_sites ADD CONSTRAINT seo_sites_rank_frequency_check CHECK (rank_frequency IN ('weekly','twice_weekly','daily')); END IF; END $$`,
  // Unlinked mentions (server/seo/mentions.ts): the name searched last and the places a mention is read for.
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS mention_name text`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS mention_places text[]`,
  // The customer's own verdict on a website that uses the name: "mine" (it writes about this business) or "not_mine"
  // (another business with the name). Per site, name and website.
  `CREATE TABLE IF NOT EXISTS seo_mention_marks (
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name_key text NOT NULL,
     domain text NOT NULL,
     verdict text NOT NULL CHECK (verdict IN ('mine','not_mine')),
     marked_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (site_id, name_key, domain)
   )`,
  // Verdicts are about a PAGE (one directory page can list several businesses; another page of the same website is
  // another question). The website-level table above is no longer read: its rows were never page-specific.
  `CREATE TABLE IF NOT EXISTS seo_mention_verdicts (
     site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
     user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name_key text NOT NULL,
     page_key text NOT NULL,
     page_url text NOT NULL,
     verdict text NOT NULL CHECK (verdict IN ('mine','not_mine')),
     marked_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (site_id, name_key, page_key)
   )`,
  // "Check again" that was bought: its answer, kept by the answer it replaced, so a repeat of the same request returns
  // it instead of buying again — even when the answer could not be saved as the report.
  `CREATE TABLE IF NOT EXISTS seo_refresh_receipts (
     user_id integer NOT NULL,
     key text NOT NULL,
     replaces text NOT NULL,
     answer jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, key, replaces)
   )`,
  // The claim is written before anything is bought (answer still empty): a second request for the same replacement —
  // from another tab, another server process, or after a crash — finds it instead of buying again.
  `ALTER TABLE seo_refresh_receipts ALTER COLUMN answer DROP NOT NULL`,
  `ALTER TABLE seo_refresh_receipts ADD COLUMN IF NOT EXISTS claimed_at timestamptz NOT NULL DEFAULT now()`,
  // Whose claim it is: only its holder may save the answer under it or give it back.
  `ALTER TABLE seo_refresh_receipts ADD COLUMN IF NOT EXISTS token text`,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS alert_drop integer NOT NULL DEFAULT 3`,
  // What changed between checks (server/seo/alerts.ts). `source` is what raised it (a rank run id, a snapshot date).
  `CREATE TABLE IF NOT EXISTS seo_alerts (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_id integer NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('rank_drop','rank_gain','links_lost','links_gained')),
    source text NOT NULL,
    title text NOT NULL,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, kind, source)
  )`,
  `CREATE INDEX IF NOT EXISTS seo_alerts_user ON seo_alerts(user_id, created_at DESC)`,
  // Set once the bell / email went out; a row without it is retried (server/seo/alerts.ts deliverPendingAlerts).
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS notified_at timestamptz`,
  // Ledger: a reservation closed as abandoned can still be settled for real if its call finishes late; refunds are recorded once.
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false`,
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS refund_key text`,
  // The real outcome of a call that finished after its reservation was closed as abandoned, kept until it is applied.
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS late_actual_usd numeric(12,6)`,
  `ALTER TABLE seo_reservations ADD COLUMN IF NOT EXISTS late_customer_usd numeric(12,6)`,
  // Rank runs: checks the source reported as failed, and a refund that still has to be made.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS failed integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS refund_due integer NOT NULL DEFAULT 0`,
  // Alerts: a delivery in progress holds a short lease; notified_at is set only once it went out.
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS claimed_at timestamptz`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS claim_token text`,
  // An email that failed after the bell entry went out: tried again on its own (a few times), never with a second bell entry.
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS email_retry_at timestamptz`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS email_tries integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS email_claim text`,
  // One list name per account, whatever the capitals.
  `CREATE UNIQUE INDEX IF NOT EXISTS seo_keyword_lists_name ON seo_keyword_lists(user_id, lower(name))`,
  // People who asked not to get an account's reports any more (server/seo/site-report-send.ts).
  `CREATE TABLE IF NOT EXISTS seo_report_optouts (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, email)
  )`,
  // A rank run remembers what paid for it and how many checks were accepted, to refund the ones that never come back.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS reservation_id uuid`,
  // Set by an earlier version, which closed a run first and saved its alerts after (a crash in between left them owed).
  // Today both happen in one transaction, so no new run owes; a run still owing is settled by settleOwedRankAlerts
  // (server/seo/jobs.ts) — raised from its own checks, or said to be lost on the run — and then cleared.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS alerts_due boolean NOT NULL DEFAULT false`,
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS posted integer NOT NULL DEFAULT 0`,
  // Not every lookup the run asked for came back with a result (null until the run is closed). Runs closed before the
  // column existed: worked out from their counts, once.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS partial boolean`,
  `UPDATE seo_rank_runs SET partial = (checked < total) WHERE partial IS NULL AND status IN ('done','failed')`,
  // A refund still owed (refund_due) is tried again until it is made — the one tried longest ago first; never given up.
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS refund_tries integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_rank_runs ADD COLUMN IF NOT EXISTS refund_tried_at timestamptz`,
  // Alert deliveries are tried again later and later (next_try_at); one given up after DELIVERY_TRIES is marked
  // (delivery_failed_at) and stays on the Alerts page as not sent, counted — never forgotten. An email given up after
  // EMAIL_TRIES is marked the same way (the bell entry went out).
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS delivery_tries integer NOT NULL DEFAULT 0`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS next_try_at timestamptz`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS delivery_failed_at timestamptz`,
  `ALTER TABLE seo_alerts ADD COLUMN IF NOT EXISTS email_failed_at timestamptz`,
  ...TASK_SCHEMA_DDL,
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false`,
  // Service-area planner: the services and towns a site used last ({ services: [...], towns: [...] }).
  `ALTER TABLE seo_sites ADD COLUMN IF NOT EXISTS planner jsonb`,
  // Last: it changes a rule on seo_alerts, which must exist by now.
  ...GRID_WATCH_DDL,
  // After the grid's: the alert kinds for the keyword watch (it replaces the same rule with the full list).
  ...KEYWORD_WATCH_ALERT_DDL,
  ...MENTION_WATCH_DDL,
  // Each finished crawl's health, worked out once (the dashboard reads these, not the whole crawl). `fingerprint` is of
  // the crawl's report and page count: a crawl changed afterwards is worked out again; `v` is the formula's version.
  `CREATE TABLE IF NOT EXISTS seo_crawl_health (
     job_id text PRIMARY KEY, fingerprint text NOT NULL, v integer NOT NULL,
     readable boolean NOT NULL, health integer, error_pages integer, crawled integer,
     computed_at timestamptz NOT NULL DEFAULT now()
   )`,
  // Last of all: the mentions watch's alert kind (the full list again, so it holds whatever ran before it).
  ...MENTION_WATCH_ALERT_DDL,
  // The newest N checks per keyword and device (overview, dashboard, tags) walk this instead of sorting a site's
  // whole history (review H3). Built CONCURRENTLY at boot like every index here.
  `CREATE INDEX IF NOT EXISTS seo_rank_checks_kw_device_on ON seo_rank_checks(keyword_id, device, checked_on DESC, id DESC)`,
];

/**
 * Boot-time schema step (reliability review H1, 2026-10-09).
 *
 * Before: every boot ran all ~170 statements above through the pool, un-caught, with no lock_timeout — one failure
 * (a statement that fails on existing rows, a full disk, a dropped connection) exited the process into systemd's
 * restart loop and took the CRM down with it, and one long reader on a seo_* table hung the boot on an ACCESS
 * EXCLUSIVE lock with the port closed.
 *
 * Now:
 *   - The list's hash is remembered in `seed_state` (key SEO_SCHEMA_KEY, the pattern of seed-permit-portals.ts).
 *     A boot whose code carries the same list runs ZERO DDL — one SELECT. Any change to the list runs it all again
 *     (every statement is idempotent) and stores the new hash only after the last statement succeeded.
 *   - The statements run on one connection with `lock_timeout` (SEO_DDL_LOCK_TIMEOUT_MS, 5 s) and `statement_timeout`
 *     (SEO_DDL_STATEMENT_TIMEOUT_MS, 60 s): a held table lock makes this step fail fast instead of hanging the boot.
 *   - `CREATE [UNIQUE] INDEX IF NOT EXISTS` is run CONCURRENTLY: on a table that has grown, a plain build blocks
 *     writers for its duration. An index left INVALID by an interrupted concurrent build is dropped and rebuilt.
 *   - It throws instead of exiting; server/seo/boot.ts catches, records an ops issue and boots WITHOUT the SEO
 *     module (503 on /api/seo, no worker) rather than taking the process down.
 */
import { createHash } from "node:crypto";

export const SEO_SCHEMA_KEY = "seo-schema";
/** One hash for the whole list: any edit to any statement changes it. */
export function seoSchemaHash(ddl: readonly string[] = SEO_SCHEMA_DDL): string {
  const h = createHash("sha256");
  for (const s of ddl) h.update(s).update("\n;\n");
  return h.digest("hex");
}

export type DdlClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export type SeoSchemaOutcome = { skipped: boolean; ran: number; ms: number; hash: string };

const INDEX_RE = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+ON\s+/i;
/** `CREATE [UNIQUE] INDEX IF NOT EXISTS name ON …` as a concurrent build, with the index's name; null for any other statement. */
export function concurrentIndexStatement(sql: string): { sql: string; name: string } | null {
  const m = INDEX_RE.exec(sql);
  if (!m) return null;
  return { name: m[2].replace(/"/g, ""), sql: sql.replace(/^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX)\s+IF\s+NOT\s+EXISTS/i, "$1 CONCURRENTLY IF NOT EXISTS") };
}

/** Run one statement of the list on `client`: indexes concurrently (dropping an invalid leftover first), the rest as written. */
export async function runSeoDdlStatement(client: DdlClient, sql: string): Promise<void> {
  const idx = concurrentIndexStatement(sql);
  if (!idx) { await client.query(sql); return; }
  // An INVALID index of this name (an interrupted concurrent build) would make IF NOT EXISTS skip the rebuild.
  const { rows } = await client.query("SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=$1 AND NOT i.indisvalid", [idx.name]);
  if (rows.length) await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${idx.name}`);
  try { await client.query(idx.sql); }
  catch (e) {
    // A failed concurrent build leaves an invalid index behind; remove it so the next boot can try again.
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${idx.name}`).catch(() => {});
    throw e;
  }
}

const envMs = (name: string, fallback: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; };

/** Has this exact list been applied already (seed_state row)? False when the table is missing (a fresh database). */
async function seoSchemaApplied(hash: string, q: DdlClient = pool): Promise<boolean> {
  const { rows: [t] } = await q.query("SELECT to_regclass('public.seed_state') AS t");
  if (!t?.t) return false;
  const { rows: [row] } = await q.query("SELECT hash FROM seed_state WHERE key=$1", [SEO_SCHEMA_KEY]);
  return row?.hash === hash;
}

/**
 * Bring the SEO tables up to the list above. Skips everything when the stored hash matches (`force` runs it anyway,
 * e.g. FORCE_SEO_SCHEMA=1). Throws on failure — nothing is remembered then, so the next boot tries again.
 */
export async function ensureSeoSchema(opts: { force?: boolean; connect?: () => Promise<DdlClient & { release: (err?: Error) => void }> } = {}): Promise<SeoSchemaOutcome> {
  const started = Date.now();
  const hash = seoSchemaHash();
  const force = opts.force ?? process.env.FORCE_SEO_SCHEMA === "1";
  if (!force && await seoSchemaApplied(hash)) return { skipped: true, ran: 0, ms: Date.now() - started, hash };
  const client = await (opts.connect ?? (() => pool.connect()))();
  let ran = 0;
  try {
    await client.query(`SET lock_timeout = ${envMs("SEO_DDL_LOCK_TIMEOUT_MS", 5_000)}`);
    await client.query(`SET statement_timeout = ${envMs("SEO_DDL_STATEMENT_TIMEOUT_MS", 60_000)}`);
    for (const sql of SEO_SCHEMA_DDL) {
      try { await runSeoDdlStatement(client, sql); ran++; }
      catch (e: any) {
        throw Object.assign(new Error(`SEO schema statement ${ran + 1}/${SEO_SCHEMA_DDL.length} failed: ${e?.message ?? e} — ${sql.replace(/\s+/g, " ").slice(0, 160)}`), { cause: e, statement: ran + 1 });
      }
    }
    await client.query(`CREATE TABLE IF NOT EXISTS seed_state (
      key text PRIMARY KEY, hash text NOT NULL, row_count integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(`INSERT INTO seed_state(key, hash, row_count) VALUES($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET hash=EXCLUDED.hash, row_count=EXCLUDED.row_count, applied_at=now()`, [SEO_SCHEMA_KEY, hash, SEO_SCHEMA_DDL.length]);
  } finally {
    // Session settings go back to the pool's defaults; a connection that cannot even do that is handed back as broken.
    try { await client.query("RESET lock_timeout"); await client.query("RESET statement_timeout"); client.release(); }
    catch (e) { client.release(e instanceof Error ? e : new Error(String(e))); }
  }
  return { skipped: false, ran, ms: Date.now() - started, hash };
}
