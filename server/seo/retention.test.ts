/**
 * SEO history retention (server/seo/retention.ts; reliability review H3): due once a night in the quiet hour, every
 * statement capped, summaries never touched, a failure keeps the night open, a missing table is not an error.
 */
import { describe, expect, it } from "vitest";
import { PRUNED_ON_KEY, RETENTION, pruneSeoHistory, pruneStatements, retentionDue } from "./retention";

const at = (iso: string) => new Date(iso);

describe("retentionDue", () => {
  it("is due only inside the quiet hour and once per UTC date", () => {
    expect(retentionDue(at("2026-10-09T03:15:00Z"), null, 3)).toBe(true);
    expect(retentionDue(at("2026-10-09T03:59:59Z"), "2026-10-08", 3)).toBe(true);
    expect(retentionDue(at("2026-10-09T03:15:00Z"), "2026-10-09", 3)).toBe(false);
    expect(retentionDue(at("2026-10-09T04:00:00Z"), null, 3)).toBe(false);
    expect(retentionDue(at("2026-10-09T14:00:00Z"), "2026-10-01", 3)).toBe(false);
  });
});

describe("the night's statements", () => {
  it("cover every history table, each bounded by the cap and the policy's days, and never touch the summaries", () => {
    const stmts = pruneStatements();
    expect(stmts.map((s) => s.table)).toEqual(["seo_rank_checks", "seo_rank_runs", "seo_backlink_snapshots", "seo_keyword_snapshots", "seo_mention_checks", "sitescan_jobs"]);
    for (const s of stmts) {
      expect(s.sql, s.table).toMatch(/LIMIT \$2\)/);
      expect(s.params[1], s.table).toBe(RETENTION.CAP);
    }
    const checks = stmts[0];
    expect(checks.params[0]).toBe(RETENTION.RANK_DETAIL_DAYS);
    expect(checks.sql).toMatch(/^UPDATE seo_rank_checks SET serp_top=NULL, local_pack=NULL, rivals=NULL, serp_features='\[\]'::jsonb/);
    expect(checks.sql).not.toMatch(/position=|url=|checked_on=|DELETE/);
    expect(stmts[1].sql).toMatch(/^DELETE FROM seo_rank_runs .* status IN \('done','failed'\)/);
    expect(stmts[2].sql).toMatch(/SET backlinks='\[\]'::jsonb/);
    expect(stmts[2].sql).not.toMatch(/summary|changes/);
    expect(stmts[5].sql).toMatch(/SET state = state - 'pages' .* status='completed'/);
    expect(stmts[5].sql).not.toMatch(/report/);
    expect(RETENTION.RANK_DETAIL_DAYS).toBeGreaterThanOrEqual(120); // the site report reads 120 days of map-pack flags
  });
});

describe("pruneSeoHistory", () => {
  const fake = (opts: { pruned?: string | null; fail?: RegExp; missing?: RegExp } = {}) => {
    const log: { sql: string; params?: unknown[] }[] = [];
    const q = {
      query: async (sql: string, params?: unknown[]) => {
        log.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        if (/^SELECT value FROM seo_meta/.test(sql)) return { rows: opts.pruned ? [{ value: opts.pruned }] : [] };
        if (opts.fail?.test(sql)) throw new Error("canceling statement due to statement timeout");
        if (opts.missing?.test(sql)) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
        return { rows: [], rowCount: /^UPDATE seo_rank_checks/.test(sql) ? 5000 : 3 };
      },
    };
    return { q, log };
  };

  it("does nothing outside the hour or when tonight is done", async () => {
    const f = fake({ pruned: "2026-10-09" });
    expect(await pruneSeoHistory(f.q, at("2026-10-09T03:10:00Z"))).toBeNull();
    expect(await pruneSeoHistory(fake().q, at("2026-10-09T12:10:00Z"))).toBeNull();
    expect(f.log).toHaveLength(1);
  });

  it("runs every statement, reports rows touched, and stamps the date", async () => {
    const f = fake({ pruned: "2026-10-08" });
    const touched = await pruneSeoHistory(f.q, at("2026-10-09T03:10:00Z"));
    expect(touched).toEqual({ seo_rank_checks: 5000, seo_rank_runs: 3, seo_backlink_snapshots: 3, seo_keyword_snapshots: 3, seo_mention_checks: 3, sitescan_jobs: 3 });
    const stamp = f.log.at(-1)!;
    expect(stamp.sql).toMatch(/^INSERT INTO seo_meta\(key, value\)/);
    expect(stamp.params).toEqual([PRUNED_ON_KEY, "2026-10-09"]);
  });

  it("a failing statement is reported and the night is NOT stamped (tried again next tick); a missing table is skipped quietly", async () => {
    const f = fake({ fail: /^DELETE FROM seo_mention_checks/ });
    const touched = await pruneSeoHistory(f.q, at("2026-10-09T03:10:00Z"));
    expect(touched?.seo_mention_checks).toBeUndefined();
    expect(touched?.sitescan_jobs).toBe(3); // later tables still ran
    expect(f.log.some((l) => /^INSERT INTO seo_meta/.test(l.sql))).toBe(false);
    const g = fake({ missing: /^UPDATE sitescan_jobs/ });
    const t2 = await pruneSeoHistory(g.q, at("2026-10-09T03:10:00Z"));
    expect(t2?.sitescan_jobs).toBe(0);
    expect(g.log.some((l) => /^INSERT INTO seo_meta/.test(l.sql))).toBe(true);
  });
});
