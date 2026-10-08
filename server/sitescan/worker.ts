import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { takeBudget } from "../growth-limits";
import { reserveQuotaFor, refundReservation, resetsAt, type QuotaReservation } from "../growth-quotas";
import { notifyUser } from "../account-events";
import {
  crawl,
  emptyState,
  findingsFor,
  scoresFor,
  scoreExplanation,
  type CrawlState,
} from "./audit";
import { pageSpeed, businessSchema } from "./providers";
import { safeFetch } from "./http";
import { enrichFindings, fixesFor, reconcileFixes } from "./guidance";
import { robotsRules } from "./robots";
import { recordFailure } from "../ops/issues";
export async function profileFor(user: number, id?: number) {
  const {
    rows: [p],
  } = await pool.query(
    `SELECT l.id,s.profile_snapshot,s.last_success AS synced_at
    FROM business_locations l JOIN gbp_sync_status s ON s.location_id=l.id AND s.kind='profile' AND s.last_success IS NOT NULL AND s.profile_snapshot IS NOT NULL
    WHERE l.user_id=$1 AND l.gbp_location_name IS NOT NULL AND ($2::integer IS NULL OR l.id=$2) ORDER BY l.id LIMIT 1`,
    [user, id ?? null],
  );
  return p ? { ...p.profile_snapshot, id: p.id, synced_at: p.synced_at } : null;
}
export async function enqueue(
  user: number | null,
  url: string,
  cap: number,
  psi: number,
  profile: any = null,
) {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO sitescan_jobs(id,user_id,url,page_cap,psi_pages,profile,state) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, user, url, cap, psi, profile, emptyState(url)],
  );
  return id;
}
export const workerDependencies = { crawl, pageSpeed, http: safeFetch };
export async function runSiteScanWorker(deps = workerDependencies) {
  const token = randomUUID();
  const {
    rows: [job],
  } = await pool.query(
    `UPDATE sitescan_jobs SET status='running',lease_token=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1
    WHERE id=(SELECT id FROM sitescan_jobs WHERE (status='queued' OR status='running' AND lease_until<now()) AND attempts<5 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    [token],
  );
  if (!job) return;
  const heartbeat = setInterval(
    () =>
      void pool
        .query(
          "UPDATE sitescan_jobs SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_token=$2",
          [job.id, token],
        )
        .catch(() => {}),
    30_000,
  );
  heartbeat.unref();
  try {
    const checkpoint = async (state: CrawlState) => {
      if (Buffer.byteLength(JSON.stringify(state)) > 25_000_000)
        throw new Error("Crawl checkpoint exceeds 25 MB");
      const r = await pool.query(
        "UPDATE sitescan_jobs SET state=$3,lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease_token=$2",
        [job.id, token, state],
      );
      if (!r.rowCount) throw new Error("Lease lost");
    };
    const state = await deps.crawl(
      job.url,
      job.page_cap,
      job.state,
      checkpoint,
      deps.http,
      undefined,
      job.user_id ? 20 * 60_000 : 50_000,
    );
    // Link sampling is explicitly bounded; external robots policy is fetched before each host's links.
    const rules = new Map<string, ReturnType<typeof robotsRules>>([
      [state.origin || new URL(job.url).origin, robotsRules(state.robots)],
    ]);
    const candidates = [...new Set(state.pages.flatMap((p) => p.links))]
      .filter((u) => !state.pages.some((p) => p.url === u))
      .slice(0, job.user_id ? 40 : 0);
    for (const url of candidates) {
      if (state.linkChecks.some((c) => c.url === url)) continue;
      try {
        const origin = new URL(url).origin;
        if (!rules.has(origin)) {
          const r = await deps.http(
            origin + "/robots.txt",
            (u) => new URL(u).origin === origin,
          );
          if (r.status !== 200 && r.status !== 404) continue;
          rules.set(origin, robotsRules(r.status === 200 ? r.body : ""));
        }
        const rule = rules.get(origin)!;
        if (!rule.allowed(url) || rule.delay > 30) continue;
        await new Promise((r) =>
          setTimeout(r, Math.max(300, rule.delay * 1000)),
        );
        const result = await deps.http(
          url,
          (u) => new URL(u).origin === origin && rule.allowed(u),
        );
        state.linkChecks.push({ url, status: result.status });
      } catch {
        state.linkChecks.push({ url, status: null });
      }
      await checkpoint(state);
    }
    state.imageChecks ||= [];
    for (const image of [
      ...new Set(state.pages.flatMap((p) => p.images.map((i) => i.url))),
    ].slice(0, job.user_id ? 30 : 0)) {
      if (state.imageChecks.some((i) => i.url === image)) continue;
      const origin = new URL(image).origin,
        rule = rules.get(origin);
      // Only origins whose robots policy was already checked; never fetch unknown CDNs blindly.
      if (!rule || !rule.allowed(image) || rule.delay > 30) continue;
      await new Promise((r) => setTimeout(r, Math.max(300, rule.delay * 1000)));
      try {
        const r = await deps.http(
          image,
          (u) => new URL(u).origin === origin && rule.allowed(u),
        );
        if (r.status === 200)
          state.imageChecks.push({
            url: image,
            bytes: r.bytes,
            pages: state.pages
              .filter((p) => p.images.some((i) => i.url === image))
              .map((p) => p.url),
          });
      } catch {
        /* Unmeasured, never invent image weight. */
      }
      await checkpoint(state);
    }
    const psi: any[] = [];
    for (const p of state.pages
      .filter((p) => p.status === 200)
      .slice(0, job.psi_pages))
      for (const strategy of ["mobile", "desktop"] as const) {
        if (deps.pageSpeed === pageSpeed && !process.env.PAGESPEED_API_KEY) {
          psi.push(await pageSpeed(p.url, strategy));
          continue;
        }
        if (
          !(await takeBudget(
            "sitescan:psi:" + job.user_id,
            20,
            1,
            86400_000,
          )) ||
          !(await takeBudget("sitescan:psi:global", 100, 1, 86400_000))
        ) {
          psi.push({
            url: p.url,
            strategy,
            unavailable: "Daily PageSpeed budget exhausted",
          });
          continue;
        }
        try {
          const {
            rows: [slot],
          } = await pool.query(
            `UPDATE sitescan_provider_budget SET next_at=GREATEST(next_at,clock_timestamp())+interval '1 second' WHERE id=1 RETURNING GREATEST(0,EXTRACT(EPOCH FROM (next_at-clock_timestamp()))*1000)::int delay`,
          );
          if (slot) await new Promise((r) => setTimeout(r, slot.delay));
          psi.push(await deps.pageSpeed(p.url, strategy));
        } catch {
          psi.push({
            url: p.url,
            strategy,
            reason: "request_error",
            unavailable:
              "PageSpeed request failed: network, timeout or invalid response. Retry later.",
          });
        }
      }
    if (!job.psi_pages)
      psi.push({
        reason: "disabled",
        unavailable:
          "PageSpeed was not selected (0 pages). Retry with PageSpeed enabled.",
      });
    else if (!psi.length)
      psi.push({
        reason: "no_pages",
        unavailable: "No successful HTML pages were available for PageSpeed.",
      });
    const findings = findingsFor(state, job.profile);
    for (const p of psi)
      if (typeof p.score === "number" && p.score < 90)
        findings.push({
          id: "psi-" + p.strategy + "-" + p.url,
          category: "performance",
          severity: p.score < 50 ? "critical" : "warning",
          title: `${p.strategy} PageSpeed performance: ${p.score}`,
          urls: [p.url],
          why: "Measured Lighthouse lab performance is below 90; field data may differ.",
          fix: "Review the attached LCP, CLS, blocking time and transfer size measurements; optimize the largest resources and JavaScript.",
        });
    const scores = scoresFor(findings, state, psi);
    const report = {
      version: 2,
      url: job.url,
      scannedAt: new Date().toISOString(),
      pages: state.pages.length,
      remaining: state.queue.length,
      blocked: state.blocked.length,
      errors: state.errors,
      findings: enrichFindings(findings, state, job.profile),
      fixes: fixesFor(findings, state, job.profile),
      platforms: [
        ...new Set(state.pages.map((p) => p.platform || "Custom/unknown")),
      ],
      scoreExplanation: scoreExplanation(findings, state, psi),
      scores,
      psi,
      profile: job.profile,
      jsonLdDraft: businessSchema(job.profile),
      coverage: {
        pageCap: job.page_cap,
        checkedLinks: state.linkChecks.length,
        // How the site answered for addresses that have no page (see the "soft-404" finding): one outcome per
        // address asked; `asked: 0` with the reason when none was (robots.txt, no answer, or a crawl resumed from
        // before the check existed — "not_measured").
        missingPageProbe: {
          asked: state.missingPages?.length ?? 0,
          outcomes: (state.missingPages ?? []).map((m) => m.outcome),
          ...(state.missingPages?.length
            ? {}
            : {
                reason:
                  state.missingPages === undefined
                    ? "not_measured"
                    : (state.missingPagesNote ?? "no_answer"),
              }),
        },
        notes: [
          "Scores are heuristic audit indicators, not search rankings.",
          "HTML-only crawl; JavaScript is not executed.",
          state.missingPages?.length
            ? `${state.missingPages.length} address${state.missingPages.length === 1 ? "" : "es"} with no page ${state.missingPages.length === 1 ? "was" : "were"} asked for, to see how the site answers for a missing page.`
            : state.missingPages === undefined
              ? "How the site answers for a missing page was not measured in this crawl."
              : state.missingPagesNote === "robots"
                ? "How the site answers for a missing page was not checked: robots.txt does not allow it."
                : "How the site answers for a missing page could not be checked: the requests got no answer.",
          "Links (40) and images (30, 2 MB maximum) are sampled; full page weight comes from PageSpeed. Unknown CDN image sizes are not measured.",
          "NAP and service gaps compare scanned text/headings with the last synced GBP snapshot.",
          "AI drafts must be reviewed before use.",
        ],
      },
    };
    const {
      rows: [previous],
    } = await pool.query(
      "SELECT report,fix_done FROM sitescan_jobs WHERE user_id=$1 AND url=$2 AND profile->>'id' IS NOT DISTINCT FROM $4 AND status='completed' AND id<>$3 ORDER BY completed_at DESC LIMIT 1",
      [
        job.user_id,
        job.url,
        job.id,
        job.profile?.id ? String(job.profile.id) : null,
      ],
    );
    report.fixes = reconcileFixes(
      report.fixes,
      (previous?.report?.fixes || []).map((f: any) => ({
        ...f,
        done: previous.fix_done?.[f.key] ?? f.done,
      })),
      state,
      job.profile,
      psi,
    );
    const changed = await pool.query(
      "UPDATE sitescan_jobs SET report=$3,state=$4,status='completed',completed_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$2",
      [job.id, token, report, state],
    );
    if (changed.rowCount && job.user_id) {
      const oldCritical = new Set(
        (previous?.report?.findings || [])
          .filter((f: any) => f.severity === "critical")
          .map((f: any) => f.id + JSON.stringify(f.urls)),
      );
      const regressed =
        previous &&
        ((scores.overall !== null &&
          previous.report.scores.overall !== null &&
          scores.overall < previous.report.scores.overall) ||
          findings.some(
            (f) =>
              f.severity === "critical" &&
              !oldCritical.has(f.id + JSON.stringify(f.urls)),
          ));
      await notifyUser(
        job.user_id,
        regressed ? "sitescan.regressed" : "sitescan.completed",
        {
          title: regressed
            ? "Site Scan needs attention"
            : "Site Scan completed",
          body: `${state.pages.length} ${state.pages.length === 1 ? "page" : "pages"} checked. Overall score: ${scores.overall ?? "unavailable"}.`,
          link: "/site-scan",
          severity: regressed ? "warning" : "info",
        },
      );
    }
  } catch {
    await pool.query(
      "UPDATE sitescan_jobs SET status='failed',error='Scan could not complete. Check website availability, robots policy and scan limits; lower the page cap and retry.',lease_until=NULL WHERE id=$1 AND lease_token=$2 AND status='running'",
      [job.id, token],
    );
  } finally {
    clearInterval(heartbeat);
  }
}
/**
 * Monthly scheduled scans. Each one spends a Site Scan from the owner's
 * monthly plan allowance (Agency: per billed location), like a scan started by
 * hand. A used-up month waits for the 1st (UTC); an account with no plan is
 * looked at again the next day; the daily scan budget defers to the next day.
 */
export async function runSchedules() {
  const c = await pool.connect();
  const held: QuotaReservation[] = [];
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(
      "SELECT * FROM sitescan_schedules WHERE next_at<=now() FOR UPDATE SKIP LOCKED LIMIT 10",
    );
    for (const s of rows) {
      const quota = await reserveQuotaFor(s.user_id, "siteScans", 1);
      if (!quota.ok) {
        await c.query(
          "UPDATE sitescan_schedules SET next_at=$3 WHERE user_id=$1 AND url=$2",
          [
            s.user_id,
            s.url,
            quota.status === 403
              ? resetsAt()
              : new Date(Date.now() + 86400_000).toISOString(),
          ],
        );
        continue;
      }
      held.push(quota.reservation);
      if (await takeBudget("sitescan:scan:" + s.user_id, 5, 1, 86400_000)) {
        const profile = s.location_id
            ? await profileFor(s.user_id, s.location_id)
            : null,
          id = randomUUID();
        await c.query(
          "INSERT INTO sitescan_jobs(id,user_id,url,page_cap,psi_pages,profile,state) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            id,
            s.user_id,
            s.url,
            s.page_cap,
            s.psi_pages,
            profile,
            emptyState(s.url),
          ],
        );
        await c.query(
          "UPDATE sitescan_schedules SET next_at=now()+interval '1 month' WHERE user_id=$1 AND url=$2",
          [s.user_id, s.url],
        );
      } else {
        // The daily budget said no: the monthly scan goes back until tomorrow's try.
        await refundReservation(held.pop(), 1);
        await c.query(
          "UPDATE sitescan_schedules SET next_at=now()+interval '1 day' WHERE user_id=$1 AND url=$2",
          [s.user_id, s.url],
        );
      }
    }
    await c.query(
      "UPDATE sitescan_jobs SET status='failed',error='Worker retry limit reached' WHERE status='running' AND lease_until<now() AND attempts>=5",
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    // Nothing was queued: give back the scans this tick reserved.
    for (const r of held) await refundReservation(r, 1).catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export function startSiteScanWorker() {
  if (process.env.SITESCAN_WORKER_DISABLED === "true") return;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await runSchedules();
      await runSiteScanWorker();
    } catch (e) {
      console.error("Site Scan worker tick failed");
      void recordFailure("job", "Site Scan worker tick", e);
    } finally {
      busy = false;
    }
  }, 5000);
  timer.unref();
  return timer;
}
