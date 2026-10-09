/**
 * Defence in depth behind the robots matcher (review S-1): the crawl's uninterruptible steps are timed, a step that
 * overran fails the scan for good (it is never leased again), the scan has a wall clock, and the free public scan is
 * rate-limited. No database: the pool is a recorder (the lease rules themselves are proven against Postgres in
 * integration.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const db = vi.hoisted(() => ({ calls: [] as { sql: string; params: any[] }[], job: null as any }));
vi.mock("../db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      db.calls.push({ sql, params });
      if (/SET status='running',lease_token/.test(sql)) return { rows: db.job ? [db.job] : [], rowCount: db.job ? 1 : 0 };
      return { rows: [], rowCount: 1 };
    }),
  },
}));
vi.mock("../ops/issues", () => ({ recordFailure: vi.fn(async () => {}) }));
vi.mock("../account-events", () => ({ notifyUser: vi.fn(async () => {}) }));

import { crawl, emptyState, findingsFor, parsePage, ScanAbort, type CrawlStep } from "./audit";
import { CpuStallError, MAX_ABANDONED, runSiteScanWorker, scanLimits } from "./worker";
import { FREE_SCAN_LIMITS, freeScanGate } from "./routes";
import { recordFailure } from "../ops/issues";

const page = (url: string, body = "<html><head><title>T</title></head><body><h1>T</h1><a href='/next'>n</a></body></html>") => ({ url, status: 200, body, bytes: body.length, headers: { "content-type": "text/html" }, redirects: [] as string[] });
const HOSTILE = `User-agent: *\n${Array.from({ length: 400 }, (_, i) => `Disallow: /*${"a".repeat(900)}${i}b`).join("\n")}\nSitemap: https://evil.test/${"a".repeat(1900)}`;
const evil = async (url: string, allowed?: (u: string) => boolean) => {
  if (allowed && !allowed(url)) throw new Error("Redirect excluded by crawl policy");
  if (url.endsWith("/robots.txt")) return page(url, HOSTILE);
  if (url.endsWith(".xml")) return page(url, "<urlset>" + Array.from({ length: 300 }, (_, i) => `<url><loc>https://evil.test/${"a".repeat(1800)}${i}</loc></url>`).join("") + "</urlset>");
  return page(url, "<html><body>" + Array.from({ length: 500 }, (_, i) => `<a href="/${"a".repeat(1800)}${i}">x</a>`).join("") + "</body></html>");
};
const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end); };

describe("a hostile site cannot hold the crawl", () => {
  it("a whole crawl of a site built to be slow to match finishes quickly, and never fetches what it cannot clear", async () => {
    const t = performance.now();
    const fetched: string[] = [];
    const state = await crawl("https://evil.test/", 11, undefined, undefined, async (u, a) => { fetched.push(u); return evil(u, a); }, async () => {});
    const took = performance.now() - t;
    expect(took, `crawl took ${took.toFixed(0)} ms`).toBeLessThan(8_000);
    expect(state.robots.length).toBeLessThanOrEqual(500 * 1024);
    // The long addresses could not be cleared within the work limit: they were not requested.
    expect(fetched.filter((u) => u.length > 1500)).toEqual([]);
    const f = performance.now();
    findingsFor(state);
    expect(performance.now() - f).toBeLessThan(2_000);
  });
  it("findings read robots.txt once per bot, not once per page", () => {
    const state = emptyState("https://big.test/");
    state.robots = "User-agent: *\n" + Array.from({ length: 4000 }, (_, i) => `Disallow: /section-${i}/`).join("\n") + "\nUser-agent: GPTBot\nDisallow: /private/";
    state.pages = Array.from({ length: 500 }, (_, i) => parsePage(page(`https://big.test/${i % 2 ? "private" : "open"}/${i}`)));
    const t = performance.now();
    const bot = findingsFor(state).find((x) => x.id === "bot-GPTBot");
    expect(performance.now() - t).toBeLessThan(3_000);
    expect(bot?.urls).toHaveLength(250);
  });
  it("a bot finding is not claimed when the rules could not be read within the limit", () => {
    const state = emptyState("https://evil.test/");
    state.robots = HOSTILE.replace("User-agent: *", "User-agent: GPTBot");
    state.pages = Array.from({ length: 40 }, (_, i) => parsePage(page(`https://evil.test/${"a".repeat(1900)}${i}`)));
    const t = performance.now();
    expect(findingsFor(state).find((x) => x.id === "bot-GPTBot")).toBeUndefined();
    expect(performance.now() - t).toBeLessThan(2_000);
  });
  it("a step that stops the scan is not swallowed as one page's error", async () => {
    const step: CrawlStep = async (label, work) => { if (label.startsWith("page https://ok.test/")) throw new ScanAbort("stop"); return work(); };
    await expect(crawl("https://ok.test/", 3, undefined, undefined, async (u) => page(u, u.endsWith("robots.txt") ? "" : undefined), async () => {}, 60_000, step)).rejects.toThrow("stop");
  });
  it("every piece of work on what the site sent goes through a step", async () => {
    const labels: string[] = [];
    const step: CrawlStep = async (label, work) => { labels.push(label.split(" ")[0]); return work(); };
    await crawl("https://ok.test/", 2, undefined, undefined, async (u) => page(u, u.endsWith("robots.txt") ? "User-agent: *\nAllow: /" : u.endsWith(".xml") ? "<urlset/>" : undefined), async () => {}, 60_000, step);
    expect(new Set(labels)).toEqual(new Set(["robots.txt", "sitemap", "page"]));
    expect(labels.filter((l) => l === "page").length).toBeGreaterThanOrEqual(3); // the missing-page probe + two pages
  });
});

describe("the worker's time limits and poison guard", () => {
  const job = (over: any = {}) => ({ id: "11111111-1111-4111-8111-111111111111", user_id: null, url: "https://evil.test/", page_cap: 11, psi_pages: 0, profile: null, state: emptyState("https://evil.test/"), ...over });
  const failed = () => db.calls.find((c) => /SET status='failed',error=\$3,fail_reason=\$4/.test(c.sql));
  beforeEach(() => { db.calls.length = 0; db.job = job(); vi.mocked(recordFailure).mockClear(); process.env.SITESCAN_STEP_BUDGET_MS = "20"; });

  it("a step over its time fails the scan as a stall — final, recorded, with its mark left in place", async () => {
    const after = vi.fn();
    await runSiteScanWorker({
      crawl: (async (...a: any[]) => { await a[7]("page https://evil.test/slow", () => busy(60)); after(); return emptyState("x"); }) as any,
      http: vi.fn() as any, pageSpeed: vi.fn() as any,
    });
    expect(after).not.toHaveBeenCalled(); // the scan stopped at the step
    expect(failed()?.params.slice(2)).toEqual([expect.stringContaining("will not be retried"), "cpu_stall"]);
    expect(failed()?.params[2]).not.toMatch(/robots|regex|cpu|event loop/i); // plain words for the customer
    const marks = db.calls.filter((c) => /SET cpu_step=/.test(c.sql));
    expect(marks.map((c) => c.params[2] ?? null)).toEqual(["page https://evil.test/slow"]); // marked, never cleared
    expect(recordFailure).toHaveBeenCalledWith("job", "Site Scan stalled the web process", expect.any(Error));
    expect(db.calls.some((c) => /status='completed'/.test(c.sql))).toBe(false);
  });
  it("a step within its time is marked, cleared, and the scan completes", async () => {
    const state = emptyState("https://fine.test/");
    state.queue = [];
    await runSiteScanWorker({ crawl: (async (...a: any[]) => { await a[7]("page https://fine.test/", () => 1); return state; }) as any, http: vi.fn() as any, pageSpeed: vi.fn() as any });
    const marks = db.calls.filter((c) => /SET cpu_step=/.test(c.sql)).map((c) => (/cpu_step=NULL/.test(c.sql) ? null : c.params[2]));
    expect(marks.slice(0, 2)).toEqual(["page https://fine.test/", null]);
    expect(marks.filter((m) => m !== null).length).toBe(marks.filter((m) => m === null).length); // every mark cleared
    expect(marks).toContain("report: findings");
    expect(failed()).toBeUndefined();
    expect(db.calls.some((c) => /status='completed'/.test(c.sql))).toBe(true);
    expect(recordFailure).not.toHaveBeenCalled();
  });
  it("any other failure is final too, and is not called a stall", async () => {
    await runSiteScanWorker({ crawl: (async () => { throw new Error("network"); }) as any, http: vi.fn() as any, pageSpeed: vi.fn() as any });
    expect(failed()?.params[3]).toBe("error");
    expect(recordFailure).not.toHaveBeenCalled();
  });
  it("poisoned scans are failed before anything is leased; only a clean, once-abandoned scan is taken again", async () => {
    db.job = null;
    await runSiteScanWorker();
    const [sweep, lease] = db.calls;
    expect(sweep.sql).toMatch(/SET status='failed'[\s\S]*cpu_step IS NOT NULL OR abandoned>=\$1 OR attempts>=5/);
    expect(sweep.params[0]).toBe(MAX_ABANDONED);
    expect(lease.sql).toMatch(/status='queued' OR status='running' AND lease_until<now\(\) AND cpu_step IS NULL AND abandoned<\$2/);
    expect(lease.sql).toMatch(/ORDER BY \(user_id IS NULL\),created_at/); // customers before free scans
    expect(MAX_ABANDONED).toBe(1);
  });
  it("the crawl gets the scan's wall clock and the step runner; a free scan's clock is short", async () => {
    const seen: any[] = [];
    await runSiteScanWorker({ crawl: (async (...a: any[]) => { seen.push(a[6], typeof a[7]); const s = emptyState("x"); s.queue = []; return s; }) as any, http: vi.fn() as any, pageSpeed: vi.fn() as any });
    expect(seen[0]).toBeLessThanOrEqual(50_000);
    expect(seen[1]).toBe("function");
    expect(scanLimits.scanMs(false)).toBe(3 * 60_000);
    expect(scanLimits.scanMs(true)).toBe(30 * 60_000);
    expect(new CpuStallError("x", 9000, 5000)).toBeInstanceOf(ScanAbort);
  });
  it("past the wall clock nothing more is fetched", async () => {
    process.env.SITESCAN_SCAN_BUDGET_MS = "1";
    try {
      db.job = job({ user_id: 7 });
      const state = emptyState("https://slow.test/");
      state.queue = [];
      state.pages = [{ ...parsePage(page("https://slow.test/")), links: ["https://other.test/a", "https://other.test/b"], images: [{ url: "https://slow.test/i.png", alt: "" }] }];
      const http = vi.fn();
      await runSiteScanWorker({ crawl: (async () => { await new Promise((r) => setTimeout(r, 10)); return state; }) as any, http: http as any, pageSpeed: vi.fn() as any });
      expect(http).not.toHaveBeenCalled();
      expect(db.calls.some((c) => /status='completed'/.test(c.sql))).toBe(true);
    } finally { delete process.env.SITESCAN_SCAN_BUDGET_MS; }
  });
});

describe("the free public scan's limits", () => {
  const who = { ip: "ip", email: "email", host: "host" };
  const budget = () => {
    const used = new Map<string, number>();
    return { used, take: async (key: string, limit: number) => { const n = (used.get(key) ?? 0) + 1; if (n > limit) return false; used.set(key, n); return true; } };
  };
  it("refuses while free scans are already waiting — without spending the visitor's allowance", async () => {
    const b = budget();
    expect(await freeScanGate(who, { take: b.take, waiting: async () => FREE_SCAN_LIMITS.waiting })).toBe("busy");
    expect(b.used.size).toBe(0);
    expect(await freeScanGate(who, { take: b.take, waiting: async () => FREE_SCAN_LIMITS.waiting - 1 })).toBe("ok");
  });
  it("limits per visitor address, per email, per website, per hour and per day", async () => {
    const run = async (vary: (i: number) => typeof who, n: number) => {
      const b = budget(), out: string[] = [];
      for (let i = 0; i < n; i++) out.push(await freeScanGate(vary(i), { take: b.take, waiting: async () => 0 }));
      return out.filter((x) => x === "ok").length;
    };
    expect(await run((i) => ({ ip: "same", email: "e" + i, host: "h" + i }), 10)).toBe(FREE_SCAN_LIMITS.perIpDay);
    expect(await run((i) => ({ ip: "i" + i, email: "same", host: "h" + i }), 10)).toBe(FREE_SCAN_LIMITS.perEmailDay);
    expect(await run((i) => ({ ip: "i" + i, email: "e" + i, host: "same" }), 10)).toBe(FREE_SCAN_LIMITS.perSiteDay);
    expect(await run((i) => ({ ip: "i" + i, email: "e" + i, host: "h" + i }), 60)).toBe(FREE_SCAN_LIMITS.perHour);
    expect(FREE_SCAN_LIMITS.perHour).toBeLessThan(FREE_SCAN_LIMITS.perDay);
  });
  it("the public start route uses the gate before it queues anything", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "routes.ts"), "utf8");
    const route = src.slice(src.indexOf('"/api/sitescan/public/start"'));
    expect(route.indexOf("freeScanGate(")).toBeGreaterThan(0);
    expect(route.indexOf("freeScanGate(")).toBeLessThan(route.indexOf("enqueue(null"));
  });
});
