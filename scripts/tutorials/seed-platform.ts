/**
 * Platform sample data for the walkthrough videos. The demo workspace ("Aspire Interiors", seed-demo.ts)
 * fills the CRM; the tools of the main host — Google Business Profile locations, reviews, Ranking Grid,
 * Google Ads / Click Guard, Ads Manager, LSA leads, Agency, Cloudflare, Search Console, Domains, Mail
 * alerts, Site Scan, IP Tracker, VPN Shield, Social, Photos — were empty on camera because each needs a
 * connected provider account the owner will not create. The feature-page screenshots already have
 * fictional sample data for every one of them (script/feature-shots/seed/, BRIEF.md: "Summit Roofing Co.",
 * Denver CO, user 1, *.example addresses, 555-01xx phones, documentation IP ranges). This applies those
 * files to a recording database.
 *
 *   DATABASE_URL=<a recording database> npx tsx scripts/tutorials/seed-platform.ts
 *
 * What it applies: 10-gbp.sql, 20-reviews.sql, 30-ads.sql — through psql, as ONE transaction (each file's
 * own BEGIN / COMMIT is lifted out of the stream), with the search_path of the URL (db.ts databaseUrl), so
 * a copy of the template taken while `db.ts reseed` runs sees the data before or after, never half.
 * NOT 00-identity.sql: it renames user 1 to "Sam Rivera" / "Summit Roofing Co."; the template's user 1
 * stays "Demo Account" / "Aspire Interiors", and the Summit Roofing listings are simply the listings that
 * account manages. NOT 40-crm.sql / 41-call-assistant.sql: the CRM has its own demo seed.
 *
 * Idempotent: every file deletes its own fixed-id rows first. Dates are relative to now() AT SEED TIME and
 * are not moved forward on a fresh copy (unlike the CRM demo): reseed the template before a batch of
 * platform recordings. The provider rows (gbp_grants, ads_grants, edge_connections, lsa_connections,
 * social_connections, domain_connections) carry placeholder tokens — nothing can call Google or Cloudflare
 * with them, and the slot app has no provider keys — so a connect-an-account flow cannot be filmed with
 * this data; the pages show the account as connected and the data it holds.
 *
 * SAFETY: refuses any DATABASE_URL that is not a constructhub_tut_* recording database on 127.0.0.1:5432
 * (the guard of seed-demo.ts), and every SQL file refuses on its own unless current_database() is a
 * constructhub_dev_* lane or the schema / database is constructhub_tut_*. The password reaches psql
 * through its environment, never a command line, and is never printed.
 */
import { TUTORIAL_SOCIAL_ENCRYPTION_KEY, TUTORIAL_BLOTATO_PLACEHOLDER } from "./social-sample";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const PLATFORM_SEED_DIR = path.resolve(import.meta.dirname, "../../script/feature-shots/seed");
export const PLATFORM_SEED_FILES = ["10-gbp.sql", "20-reviews.sql", "30-ads.sql", "50-seo.sql"] as const;
/** The guard every applied file must carry (fix_guards, 2026-10-11): a file without it is not applied. */
const SCHEMA_GUARD = "current_schema() NOT LIKE 'constructhub\\_tut\\_%'";

/**
 * Rows the platform seed leaves, for the before / after of `db.ts reseed`: a table per tool. Tables
 * without a user_id column are counted whole — in a recording database every row is the demo account's.
 */
export const PLATFORM_CENSUS: Record<string, { table: string; byUser: boolean }> = {
  locations: { table: "business_locations", byUser: true },
  profileReviews: { table: "google_profile_reviews", byUser: true },
  gridScans: { table: "ranking_grid_scans", byUser: true },
  competitors: { table: "competitor_listings", byUser: true },
  reviewRequests: { table: "review_requests", byUser: true },
  lsaLeads: { table: "lsa_leads", byUser: true },
  agencyClients: { table: "agency_clients", byUser: true },
  edgeConnections: { table: "edge_connections", byUser: true },
  gscRows: { table: "gsc_analytics", byUser: false },
  domains: { table: "managed_domains", byUser: true },
  mailAlerts: { table: "mail_alert_messages", byUser: true },
  siteScans: { table: "sitescan_jobs", byUser: true },
  trackedDomains: { table: "tracked_domains", byUser: true },
  clickVisits: { table: "click_visits", byUser: false },
  vpnVisits: { table: "vpn_visits", byUser: false },
  adsAccounts: { table: "ads_accounts", byUser: true },
  adsFindings: { table: "ads_findings", byUser: true },
  socialPosts: { table: "social_posts", byUser: true },
  photos: { table: "media_photos", byUser: true },
};

/** libpq environment from a recording database URL — refused unless it is one (same rule as seed-demo.ts). */
export function libpqEnvFromUrl(raw: string): NodeJS.ProcessEnv {
  const u = new URL(raw);
  const options = u.searchParams.get("options") ?? "";
  // Only the recording schema may override the target database's search path.
  const schema = /^(?:-c TimeZone=UTC )?-c search_path=(constructhub_tut_[a-z0-9_]+)$/.exec(options)?.[1];
  const recordingTarget = schema || (/^constructhub_tut_[a-z0-9_]+$/.test(u.pathname.slice(1)) && (!options || options === "-c TimeZone=UTC"));
  if (u.hostname !== "127.0.0.1" || (u.port || "5432") !== "5432" || !recordingTarget)
    throw new Error("seed-platform.ts only writes to a constructhub_tut_* recording database on 127.0.0.1:5432");
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL is not a postgres URL");
  return {
    PATH: process.env.PATH, PGHOST: "127.0.0.1", PGPORT: "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1), PGOPTIONS: u.searchParams.get("options") ?? "",
  };
}

/** The three files as one psql stream: one BEGIN, their bodies in order, one COMMIT. */
export function combinedSql(dir = PLATFORM_SEED_DIR): string {
  const bodies = PLATFORM_SEED_FILES.map((f) => {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const begins = text.match(/^BEGIN;[ \t]*$/gm) ?? [], commits = text.match(/^COMMIT;[ \t]*$/gm) ?? [];
    if (begins.length !== 1 || commits.length !== 1) throw new Error(`${f}: expected exactly one BEGIN; and one COMMIT; line (${begins.length} / ${commits.length})`);
    if (!text.includes(SCHEMA_GUARD)) throw new Error(`${f}: has no recording-schema guard (${SCHEMA_GUARD}) — not applied`);
    return `-- ===== ${f}\n${text.replace(/^BEGIN;[ \t]*$/m, "").replace(/^COMMIT;[ \t]*$/m, "")}`;
  });
  return `\\set ON_ERROR_STOP on\nBEGIN;\n${bodies.join("\n")}\nCOMMIT;\n`;
}

function psql(env: NodeJS.ProcessEnv, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`psql exited ${code}\n${err.slice(-2000)}`))));
    p.stdin.on("error", () => { /* psql stopped early; its exit code says why */ });
    if (stdin !== undefined) p.stdin.end(stdin); else p.stdin.end();
  });
}

export async function platformCensus(env: NodeJS.ProcessEnv): Promise<Record<string, number>> {
  const sql = "select " + Object.entries(PLATFORM_CENSUS).map(([k, c]) => `(select count(*) from ${c.table}${c.byUser ? " where user_id = 1" : ""})::int as "${k}"`).join(", ");
  const line = (await psql(env, ["-At", "-F", "\t", "-c", sql])).trim();
  const keys = Object.keys(PLATFORM_CENSUS), values = line.split("\t").map(Number);
  if (values.length !== keys.length) throw new Error(`census: expected ${keys.length} counts, got "${line}"`);
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}
export const platformCensusLine = (c: Record<string, number>) => Object.entries(c).map(([k, v]) => `${k} ${v}`).join(" · ");

/** Only the fixed sample connection is unlocked, after SQL seeding, inside its transaction. */
export async function tutorialSocialSql(raw: string): Promise<string> {
  libpqEnvFromUrl(raw); // Refuse non-recording targets before loading encryption or changing env.
  const { encryptKey, BlotatoClient } = await import("../../server/social/client");
  const previous = process.env.SOCIAL_ENCRYPTION_KEY;
  let box: string;
  try {
    process.env.SOCIAL_ENCRYPTION_KEY = TUTORIAL_SOCIAL_ENCRYPTION_KEY;
    box = encryptKey(TUTORIAL_BLOTATO_PLACEHOLDER, 1);
  } finally {
    if (previous === undefined) delete process.env.SOCIAL_ENCRYPTION_KEY;
    else process.env.SOCIAL_ENCRYPTION_KEY = previous;
  }
  // Constructor computes the app's hash without making any network request.
  const hash = new BlotatoClient(TUTORIAL_BLOTATO_PLACEHOLDER).hash;
  return `UPDATE social_connections SET key_enc='${box}' WHERE user_id=1 AND business_id=910001 AND key_enc='fs-b-placeholder';
UPDATE social_business_config SET connection_hash='${hash}' WHERE user_id=1 AND business_id=910001;
UPDATE social_posts SET connection_hash='${hash}' WHERE user_id=1 AND business_id=910001 AND request_id LIKE 'fs-b-req-%';`;
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const env = libpqEnvFromUrl(raw);
  const t = Date.now();
  const social = await tutorialSocialSql(raw);
  await psql(env, [], combinedSql().replace(/COMMIT;\n$/, `${social}\nCOMMIT;\n`));
  const after = await platformCensus(env);
  console.log(`platform seed (${PLATFORM_SEED_FILES.join(", ")}) applied in ${((Date.now() - t) / 1000).toFixed(1)}s: ${platformCensusLine(after)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
