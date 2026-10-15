/**
 * The automation: one pass a minute (BACKLINKS_WORKER_ENABLED=true) that
 *   1. searches — a few queries from the bank, within the daily query cap and the monthly budget;
 *   2. vets — leases new sources and reads them with the crawler (free: our own requests), then reads the contact
 *      pages of qualified sources that published no email (./contacts.ts, also free), and follows sorted chambers',
 *      associations', directories' and newspapers' links to more of their kind (./expand.ts, free);
 *   3. measures — authority for graded sources in bulk, once enough are waiting (cheap: ~$0.18 per 1,000);
 *   4. drafts — a pitch for each quality source that publishes an email;
 *   5. sends — approved pitches, only when sending is configured (./outreach.ts).
 * One process at a time runs a pass (a Postgres advisory lock); vetting is also leased per row.
 *
 *   BACKLINKS_WORKER_ENABLED=true         run the passes (default off)
 *   BACKLINKS_MONTHLY_BUDGET_USD          spend cap for searches + authority checks (default 25)
 *   BACKLINKS_QUERIES_PER_DAY             searches per day (default 40 ≈ $0.80/day at the live price)
 */
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { DataForSeoError, isConfigured } from "../seo/dataforseo";
import { recordFailure } from "../ops/issues";
import * as store from "./store";
import { discoveryEstimateUsd, searchOnce } from "./discover";
import { fetchMetrics, metricsEstimateUsd, METRICS_BATCH } from "./metrics";
import { gradeSource, readSite } from "./vet";
import { findContacts } from "./contacts";
import { expandSource } from "./expand";
import { composePitch, outreachConfig, pickEmail, PITCHED_KINDS, sendApproved } from "./outreach";

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
export const workerConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  enabled: env.BACKLINKS_WORKER_ENABLED === "true",
  capUsd: num(env.BACKLINKS_MONTHLY_BUDGET_USD, 25),
  queriesPerDay: Math.floor(num(env.BACKLINKS_QUERIES_PER_DAY, 40)),
});

export const VET_LEASE_MS = 2 * 60_000;
const VET_BATCH = 20, CONTACT_BATCH = 20, EXPAND_BATCH = 5, VET_CONCURRENCY = 5, QUERIES_PER_PASS = 2, METRICS_MIN_BATCH = 100;

async function budgetLeft(capUsd: number) { return capUsd - (await store.monthSpend()); }

/** Run up to `n` searches from the bank. Stops at the budget. */
export async function runDiscovery(n: number, capUsd = workerConfig().capUsd): Promise<{ queries: number; found: number; added: number; costUsd: number; stopped: string | null }> {
  if (!isConfigured()) return { queries: 0, found: 0, added: 0, costUsd: 0, stopped: "The search data source is not connected (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)" };
  const out = { queries: 0, found: 0, added: 0, costUsd: 0, stopped: null as string | null };
  for (const q of await store.dueQueries(n)) {
    if ((await budgetLeft(capUsd)) < discoveryEstimateUsd()) { out.stopped = "Monthly budget reached"; break; }
    let hits: Awaited<ReturnType<typeof searchOnce>>["hits"] = [], costUsd = 0;
    try {
      ({ hits, costUsd } = await searchOnce(q.query));
    } catch (e: any) {
      // Credentials or balance: stop discovery. Anything else ("Internal SE Server Error", partial results) is this one
      // search: count what it billed and move on — it comes round again with the bank (2026-10-15: one failing query
      // was retried every minute for 8 hours and stopped vetting with it).
      if (!(e instanceof DataForSeoError) || e.code === "auth") throw e;
      costUsd = e.costUsd;
      console.warn(`[backlinks] search skipped ("${q.query}"): ${e.message}`);
    }
    await store.addSpend(costUsd);
    const added = await store.addCandidates(hits, q.kind, q.query, q.niche === "general" ? null : q.niche);
    await store.recordQueryRun(q.id, hits.length, added, costUsd);
    out.queries++; out.found += hits.length; out.added += added; out.costUsd += costUsd;
  }
  return out;
}

/** Vet up to `n` sources (leased), `VET_CONCURRENCY` at a time. */
export async function runVetting(n = VET_BATCH): Promise<{ vetted: number; failed: number }> {
  await store.rejectExhausted();
  const token = randomUUID();
  const jobs = await store.claimForVetting(token, VET_LEASE_MS, n);
  let vetted = 0, failed = 0;
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(VET_CONCURRENCY, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const signals = await readSite(job.discoveredUrl ?? `https://${job.domain}/`, job.domain);
        // A directory in the directory catalogue: its catalogued source page was checked when it was added, so it is the
        // way in even when its heading does not say "directory" (bbb.org, a state licence lookup).
        if (job.catalogueUrl && (job.kind === "directory" || job.kind === "citation") && !signals.directoryUrl) signals.directoryUrl = job.catalogueUrl;
        if (await store.saveVetting(job, token, signals, gradeSource(job.kind, signals, job.metrics))) vetted++;
      } catch (e: any) {
        await store.failVetting(job, token, e?.message ?? String(e));
        failed++;
      }
    }
  }));
  return { vetted, failed };
}

/** The contact finder (./contacts.ts) for qualified sources that published no email, `VET_CONCURRENCY` at a time. */
export async function runContactSearch(n = CONTACT_BATCH): Promise<{ searched: number; found: number }> {
  const queue = await store.needingContacts(n);
  let searched = 0, found = 0;
  await Promise.all(Array.from({ length: Math.min(VET_CONCURRENCY, queue.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await findContacts(s.domain, s.contactUrl).catch(() => ({ emails: [] as string[], contactUrl: null, pagesRead: 0 }));
      await store.saveContacts(s.id, r.emails, r.contactUrl, r.pagesRead);
      searched++;
      if (r.emails.length) found++;
    }
  }));
  return { searched, found };
}

/** Follow the links of sorted chambers, associations, directories and newspapers to their kind (./expand.ts). */
export async function runExpansion(n = EXPAND_BATCH): Promise<{ expanded: number; added: number }> {
  const queue = await store.needingExpansion(n);
  let expanded = 0, added = 0;
  await Promise.all(Array.from({ length: Math.min(VET_CONCURRENCY, queue.length) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const { sites } = await expandSource(s.domain, s.discoveredUrl).catch(() => ({ sites: [] }));
      let n = 0;
      for (const kind of new Set(sites.map((x) => x.kind))) n += await store.addCandidates(sites.filter((x) => x.kind === kind), kind, `linked from ${s.domain}`, null);
      await store.markExpanded(s.id, sites.length, n);
      expanded++; added += n;
    }
  }));
  return { expanded, added };
}

/** Authority for graded sources, in one bulk batch, re-grading each. `force` runs even under the minimum batch. */
export async function runMetrics(capUsd = workerConfig().capUsd, force = false): Promise<{ measured: number; costUsd: number; stopped: string | null }> {
  if (!isConfigured()) return { measured: 0, costUsd: 0, stopped: "The authority data source is not connected" };
  const rows = await store.needingMetrics(METRICS_BATCH);
  if (!rows.length || (!force && rows.length < METRICS_MIN_BATCH)) return { measured: 0, costUsd: 0, stopped: null };
  if ((await budgetLeft(capUsd)) < metricsEstimateUsd(rows.length)) return { measured: 0, costUsd: 0, stopped: "Monthly budget reached" };
  const { metrics, costUsd } = await fetchMetrics(rows.map((r) => r.domain));
  await store.addSpend(costUsd);
  let measured = 0;
  for (const r of rows) {
    const m = metrics.get(r.domain);
    if (!m) continue;
    await store.saveMetrics(r.id, m, gradeSource(r.kind, r.signals, m));
    measured++;
  }
  return { measured, costUsd, stopped: null };
}

/**
 * DR for the directory catalogue's own rows the Backlinks database does not hold or never measured (Google, Apple
 * Maps, Facebook; directories rejected before measuring). Display only: it grades nothing. Same budget as above.
 */
export async function runDirectoryAuthority(capUsd = workerConfig().capUsd): Promise<{ measured: number; costUsd: number; stopped: string | null }> {
  if (!isConfigured()) return { measured: 0, costUsd: 0, stopped: "The authority data source is not connected" };
  const domains = await store.directoriesNeedingAuthority(METRICS_BATCH);
  if (!domains.length) return { measured: 0, costUsd: 0, stopped: null };
  if ((await budgetLeft(capUsd)) < metricsEstimateUsd(domains.length)) return { measured: 0, costUsd: 0, stopped: "Monthly budget reached" };
  const { metrics, costUsd } = await fetchMetrics(domains);
  await store.addSpend(costUsd);
  for (const [domain, m] of metrics) await store.saveDirectoryAuthority(domain, m);
  return { measured: metrics.size, costUsd, stopped: null };
}

/** A draft pitch for quality sources that publish an email (never to a suppressed address). */
export async function runDrafts(n = 20): Promise<{ drafted: number }> {
  const { name } = outreachConfig();
  let drafted = 0;
  for (const s of await store.needingDraft(n)) {
    if (!PITCHED_KINDS.includes(s.kind)) continue;
    const to = pickEmail(s.emails);
    if (!to || (await store.isSuppressed(to))) continue;
    const { subject, body } = composePitch(s.kind, s.domain, s.signals, name);
    await store.saveDraft(s.id, to, subject, body);
    drafted++;
  }
  return { drafted };
}

const LOCK_KEY = 0x6261636b; // "back"
let running = false;

/** One full pass, unless another process holds the lock. */
export async function runPass(): Promise<void> {
  if (running) return;
  running = true;
  const client = await pool.connect();
  try {
    const got = (await client.query(`SELECT pg_try_advisory_lock($1) ok`, [LOCK_KEY])).rows[0]?.ok;
    if (!got) return;
    try {
      const cfg = workerConfig();
      const ranToday = Number((await pool.query(`SELECT count(*)::int n FROM backlink_queries WHERE last_run_at >= date_trunc('day', now())`)).rows[0]?.n ?? 0);
      // Discovery failing (credentials, balance) must not stop vetting, which is free.
      if (ranToday < cfg.queriesPerDay) await runDiscovery(Math.min(QUERIES_PER_PASS, cfg.queriesPerDay - ranToday), cfg.capUsd)
        .catch((e) => { void recordFailure("job", "Backlinks discovery", e); console.error(`[backlinks] discovery failed: ${e?.message ?? e}`); });
      await runVetting();
      await runContactSearch();
      await runExpansion();
      await runMetrics(cfg.capUsd);
      await runDirectoryAuthority(cfg.capUsd);
      await runDrafts();
      await sendApproved();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
    }
  } catch (e: any) {
    void recordFailure("job", "Backlinks worker pass", e);
    console.error(`[backlinks] pass failed: ${e?.message ?? e}`);
  } finally {
    client.release();
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startBacklinkWorker(env: NodeJS.ProcessEnv = process.env) {
  if (!workerConfig(env).enabled || timer) return;
  timer = setInterval(() => void runPass(), 60_000);
  timer.unref();
}
