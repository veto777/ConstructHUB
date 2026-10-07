/**
 * One issue per failure, across builds (fingerprint.ts), the one-time fold of
 * the duplicates the old keys left behind (merge.ts), and the digest's
 * "only when something changed" rule (digest.ts). Real Postgres (the dev lane
 * DB), every row in a throwaway schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "crypto";
import { OPS_ISSUES_DDL } from "./schema";
import { createIssueRecorder, getIssue, recordFailure, reportIssue, claimIssues, setIssueStatusByAdmin, type IssueInput } from "./issues";
import {
  clientErrorKey, errorIdentity, failureKey, issueFingerprint, normalizeForKey, processFailureKey, serverErrorKey, stableKeyForRow,
} from "./fingerprint";
import { errorFacts, scrubDetail } from "./scrub";
import { mergeDuplicateIssues, planMerge, statusSource } from "./merge";
import { completeRun } from "./digest";
import { createServerErrorCapture } from "./server-errors";
import { clientErrorHandler } from "./client-errors";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const SCHEMA = `ops_fp_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${SCHEMA},public -c TimeZone=UTC`, max: 6 });
const all = async () => (await pool.query(`SELECT * FROM ops_issues ORDER BY id`)).rows;

/** The same failure as two builds throw it: same name and message, different minified frames. */
function builtError(build: 1 | 2, message = "connect ECONNREFUSED 10.0.0.7:5432"): Error {
  const e = new TypeError(message);
  e.stack = build === 1
    ? `TypeError: ${message}\n    at wlt (/home/voiceban/ConstructHUB/dist/index.cjs:2938:27264)\n    at async Qk (/home/voiceban/ConstructHUB/dist/index.cjs:2938:29011)`
    : `TypeError: ${message}\n    at xQa (/home/voiceban/ConstructHUB/dist/index.cjs:3011:1840)\n    at async Zz (/home/voiceban/ConstructHUB/dist/index.cjs:3011:2199)`;
  return e;
}
/** The fingerprint the pre-fix code gave a recordFailure (what + name + message + top frames). */
function legacyFingerprint(source: string, what: string, err: Error): string {
  const frames = (err.stack ?? "").split("\n").slice(1, 4)
    .map((l) => l.trim().replace(/:\d+:\d+\)?$/, "").replace(/^at /, "").replace(/\(.*\/(?=[^/]+$)/, "(")).join(" < ");
  return issueFingerprint(source, `${what}|${err.name}|${err.message.replace(/\d+/g, "<n>")}|${frames}`);
}
const failureDetail = (what: string, err: unknown, extra: Record<string, unknown> = {}) => scrubDetail({ what, ...extra, error: errorFacts(err) });

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const sql of OPS_ISSUES_DDL) await pool.query(sql);
});
afterAll(async () => {
  await admin.query(`DELETE FROM user_notifications WHERE kind = 'ops.issue_desk' AND body LIKE '%Run fprun-%'`).catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
  await admin.end();
});

describe("fingerprints are stable across builds", () => {
  it("normalizes ids, numbers, hashes, paths with positions and hashed asset names", () => {
    expect(normalizeForKey("at wlt (/home/voiceban/ConstructHUB/dist/index.cjs:2938:27264)")).toBe(normalizeForKey("at xQa (/srv/app/dist/index.cjs:3011:1840)").replace("xQa", "wlt"));
    expect(normalizeForKey("ENOENT: no such file, open '/home/a/dist/data/x.json'")).toBe("ENOENT: no such file, open 'x.json'");
    expect(normalizeForKey("for module script 'https://constructhub.us/assets/schedule-BxK3_9aZ.js'"))
      .toBe(normalizeForKey("for module script 'https://crm.constructhub.us/assets/schedule-Qm1-77Pd.js'"));
    expect(normalizeForKey("for module script 'https://constructhub.us/assets/schedule-BxK3_9aZ.js'")).toBe("for module script 'schedule.js'");
    expect(normalizeForKey("org 42 job 9f8b3c1e-1111-4222-8333-abcdefabcdef a@b.co deadbeefdeadbeef01")).toBe("org <n> job <uuid> <email> <hex>");
    expect(normalizeForKey("mail to j***@example.com and [phone …42]")).toBe("mail to <email> and <phone>");
  });

  it("a job failure is one fingerprint whatever the bundle's frames say — and stays apart per error, per job, per org", () => {
    const key = (what: string, err: unknown, extra = {}) => failureKey(failureDetail(what, err, extra));
    expect(key("HOVER auto-sync", builtError(1), { orgId: 7 })).toBe(key("HOVER auto-sync", builtError(2), { orgId: 7 }));
    expect(key("HOVER auto-sync", builtError(1), { orgId: 7 })).not.toContain("index.cjs");
    expect(key("HOVER auto-sync", builtError(1), { orgId: 7 })).not.toMatch(/wlt|2938/);
    // ids inside the message and the job's own wording do not split an issue…
    expect(key("Email outbox (receipt, gave up after 5 attempts)", builtError(1, "row 81 failed"))).toBe(key("Email outbox (receipt, gave up after 6 attempts)", builtError(2, "row 9042 failed")));
    // …but a different error, job, org or location is a different issue; volatile context is not.
    expect(key("HOVER auto-sync", builtError(1), { orgId: 7 })).not.toBe(key("HOVER auto-sync", builtError(1), { orgId: 8 }));
    expect(key("GBP sync job", builtError(1), { locationId: "a" })).not.toBe(key("GBP sync job", builtError(1), { locationId: "b" }));
    expect(key("HOVER auto-sync", builtError(1))).not.toBe(key("HOVER sync scheduler tick", builtError(1)));
    expect(key("HOVER auto-sync", builtError(1))).not.toBe(key("HOVER auto-sync", new RangeError("connect ECONNREFUSED 10.0.0.7:5432")));
    expect(key("GBP sync job", builtError(1), { jobId: 1, attempts: 2 })).toBe(key("GBP sync job", builtError(2), { jobId: 99, attempts: 5 }));
    expect(errorIdentity(errorFacts("boom 12"))).toBe("thrown|boom <n>");
  });

  it("recordFailure, the 5xx handler and the process hooks write one row for both builds", async () => {
    const rec = createIssueRecorder({ pool, minIntervalMs: 0 });
    const record = (i: IssueInput) => rec.record(i);
    const { recordUnhandledError, recordProcessFailure } = createServerErrorCapture(record);
    const req: any = { method: "GET", baseUrl: "", route: { path: "/api/crm/schedule/:id" }, originalUrl: "/api/crm/schedule/12", user: { id: 1 } };
    for (const build of [1, 2] as const) {
      await rec.record({ source: "job", key: failureKey, title: "t", detail: { what: "Stable job", orgId: 3, error: errorFacts(builtError(build)) } });
      recordUnhandledError(req, { locals: {} } as any, builtError(build), 500);
      recordProcessFailure("unhandledRejection", builtError(build, "stable rejection"));
    }
    await new Promise((r) => setTimeout(r, 300));
    const rows = await all();
    expect(rows.map((r) => [r.source, r.count])).toEqual([["job", 2], ["server", 2], ["server", 2]]);
    // The stored detail recomputes to the fingerprint the row was written under (what the merge relies on).
    for (const r of rows) expect(issueFingerprint(r.source, stableKeyForRow(r.source, r.detail)!)).toBe(r.fingerprint);
    expect(serverErrorKey(rows[1].detail)).toBe("GET /api/crm/schedule/:id|500|TypeError|connect ECONNREFUSED <n>.<n>.<n>.x:<n>");
    expect(processFailureKey(rows[2].detail)).toBe("unhandledRejection|TypeError|stable rejection");
    expect(serverErrorKey({ method: "GET", route: "/x", status: 500, note: "handled" })).toBe("GET /x|500|handled");
    await pool.query(`DELETE FROM ops_issues`);
  });

  it("recordFailure itself keys from what + error + org (the app's default recorder is not used: only the key is checked)", () => {
    // recordFailure builds { what, …extra, error } and passes failureKey: the same function as above.
    expect(typeof recordFailure).toBe("function");
    expect(failureKey(failureDetail("X", builtError(1), { orgId: 1 }))).toBe("X|TypeError|connect ECONNREFUSED <n>.<n>.<n>.x:<n>|orgId=1");
  });

  it("a browser error is keyed without the build hash or line:col; every bundle-load failure is one issue", async () => {
    const d = (message: string, file: string | null = "/assets/index.js") => ({ kind: "error", message, file });
    expect(clientErrorKey(d("TypeError: Cannot read properties of undefined (reading 'value')"))).toBe("error|TypeError: Cannot read properties of undefined (reading 'value')|/assets/index.js");
    expect(clientErrorKey(d("x", "https://constructhub.us/assets/property-AbCd1234.js"))).toBe(clientErrorKey(d("x", "/assets/property-Zz99_-0q.js")));
    for (const m of [
      "TypeError: 'text/html' is not a valid JavaScript MIME type.",
      "TypeError: 'text/html' is not a valid JavaScript MIME type for module script 'https://constructhub.us/assets/schedule-BxK3_9aZ.js'",
      "TypeError: Failed to fetch dynamically imported module: https://constructhub.us/assets/crm-C0ffee12.js",
      "TypeError: Importing a module script failed.",
      "TypeError: error loading dynamically imported module: https://x/assets/a-12345678.js",
      "Error: Unable to preload CSS for /assets/schedule-AAAA1111.css",
    ]) expect(clientErrorKey(d(m))).toBe("chunk-load");

    // Through the real endpoint: two builds' reports of one error are one row.
    const rec = createIssueRecorder({ pool, minIntervalMs: 0 });
    const handle = clientErrorHandler({ record: (i) => rec.record(i), perIp: 100 });
    const post = async (body: unknown) => {
      const res: any = { setHeader() {}, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
      await handle({ body, get: () => undefined, ip: "198.51.100.1", socket: {} } as any, res);
      return res;
    };
    const report = (hash: string, line: number) => ({
      kind: "error", message: "TypeError: Cannot read properties of undefined (reading 'value')", path: "/property",
      source: `https://constructhub.us/assets/index-${hash}.js`, line, col: line * 7,
      stack: `TypeError: Cannot read properties of undefined (reading 'value')\n    at Object.P [as onChange] (https://constructhub.us/assets/index-${hash}.js:${line}:${line * 7})`,
    });
    expect((await post(report("AbCd1234", 40))).body).toEqual({ recorded: true });
    expect((await post(report("Zz99_-0q", 51))).body).toEqual({ recorded: true });
    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "client", count: 2, status: "triage" });
    expect(issueFingerprint("client", stableKeyForRow("client", rows[0].detail)!)).toBe(rows[0].fingerprint);
    await pool.query(`DELETE FROM ops_issues`);
  });

  it("leaves rows with a fixed key alone", () => {
    expect(stableKeyForRow("health", { engine: "x", checkedAt: "2026-10-07" })).toBeNull();
    expect(stableKeyForRow("call_assistant", { callId: "c", orgId: "o", reason: "no_caller_speech" })).toBeNull();
    expect(stableKeyForRow("job", { emailLogId: 4, kind: "receipt", attempts: 2, reason: "no address on file" })).toBeNull();
    expect(stableKeyForRow("client", { note: "odd" })).toBeNull();
  });
});

describe("the one-time merge of duplicates", () => {
  const insert = async (o: {
    fp: string; source?: string; title: string; detail: unknown; count?: number; first: string; last: string; status?: string;
    severity?: string; report?: string | null; branch?: string | null; inspectedAt?: string | null; history?: unknown[]; notifiedSig?: string | null;
  }): Promise<number> => {
    const { rows: [r] } = await pool.query(
      `INSERT INTO ops_issues (fingerprint, source, severity, title, detail, count, first_seen, last_seen, status, report, branch, inspected_at, history, notified_sig)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING id`,
      [o.fp, o.source ?? "job", o.severity ?? "error", o.title, JSON.stringify(o.detail), o.count ?? 1, o.first, o.last, o.status ?? "new",
        o.report ?? null, o.branch ?? null, o.inspectedAt ?? null, JSON.stringify(o.history ?? [{ at: o.first, event: "reported" }]), o.notifiedSig ?? null]);
    return Number(r.id);
  };

  it("picks the most advanced status — and does not let a stale 'fixed' hide a failure that came back", () => {
    const row = (id: number, status: any, last: string, inspected: string | null = null) => ({ id, status, last_seen: new Date(last), inspected_at: inspected ? new Date(inspected) : null });
    expect(statusSource([row(1, "new", "2026-10-01"), row(2, "inspected", "2026-10-02", "2026-10-02"), row(3, "new", "2026-10-05")]).id).toBe(2);
    expect(statusSource([row(1, "inspected", "2026-10-01", "2026-10-01"), row(2, "fix_ready", "2026-10-02", "2026-10-02")]).id).toBe(2);
    expect(statusSource([row(1, "ignored", "2026-10-01"), row(2, "new", "2026-10-05")]).id).toBe(1);
    expect(statusSource([row(1, "fixed", "2026-10-06"), row(2, "inspected", "2026-10-02", "2026-10-02")]).id).toBe(1);
    expect(statusSource([row(1, "fixed", "2026-10-01"), row(2, "new", "2026-10-05")]).id).toBe(2); // came back after the fix
    expect(statusSource([row(1, "triage", "2026-10-01"), row(2, "new", "2026-10-01")]).id).toBe(2);
  });

  it("folds each build's copy of a failure into the oldest row, sums and keeps what matters, and is idempotent", async () => {
    await pool.query(`DELETE FROM ops_issues`);
    const what = "HOVER auto-sync";
    const e1 = builtError(1), e2 = builtError(2);
    const e3 = builtError(2); e3.stack = e3.stack!.replace(/xQa/g, "b0P").replace(/3011/g, "3102");
    // Three deploys, three rows for org 7 — as production has them.
    const a = await insert({ fp: legacyFingerprint("job", what, e1), title: `${what} failed: a`, detail: failureDetail(what, e1, { orgId: 7 }), count: 40,
      first: "2026-10-01T10:00:00Z", last: "2026-10-02T09:00:00Z", status: "inspected", severity: "warning", report: "HOVER token expired for this org.",
      inspectedAt: "2026-10-01T10:20:00Z", notifiedSig: "inspected||",
      history: [{ at: "2026-10-01T10:00:00Z", event: "reported" }, { at: "2026-10-01T10:15:00Z", event: "claimed", by: "issue desk" }, { at: "2026-10-01T10:20:00Z", event: "inspected", by: "claude" }] });
    const b = await insert({ fp: legacyFingerprint("job", what, e2), title: `${what} failed: b`, detail: failureDetail(what, e2, { orgId: 7 }), count: 25,
      first: "2026-10-02T09:30:00Z", last: "2026-10-04T08:00:00Z", status: "fix_ready", severity: "error", report: "Refresh the token before syncing.", branch: "issue/2",
      inspectedAt: "2026-10-02T09:50:00Z" });
    const c = await insert({ fp: legacyFingerprint("job", what, e3), title: `${what} failed: c (latest)`, detail: { ...failureDetail(what, e3, { orgId: 7 }), latest: true }, count: 5,
      first: "2026-10-04T08:30:00Z", last: "2026-10-07T12:00:00Z", status: "new" });
    // The same job for another org: its own issue, only rekeyed.
    const other = await insert({ fp: legacyFingerprint("job", what, e1) + "x", title: "other org", detail: failureDetail(what, e1, { orgId: 8 }), first: "2026-10-03T00:00:00Z", last: "2026-10-03T00:00:00Z" });
    // A fixed-key row and an already-stable row: untouched.
    const health = await insert({ fp: issueFingerprint("health", "voice_engine_unreachable"), source: "health", title: "engine", detail: { engine: "x" }, first: "2026-10-01T00:00:00Z", last: "2026-10-01T00:00:00Z" });
    // A browser's stale-bundle reports under two old keys, the newer one already approved by an admin.
    const s1 = await insert({ fp: "old-client-1", source: "client", title: "Browser error: TypeError: 'text/html' is not a valid JavaScript MIME type.", status: "triage",
      detail: { kind: "error", message: "TypeError: 'text/html' is not a valid JavaScript MIME type.", page: "/crm/schedule", file: null }, count: 9, first: "2026-10-02T00:00:00Z", last: "2026-10-06T00:00:00Z" });
    const s2 = await insert({ fp: issueFingerprint("client", "chunk-load"), source: "client", title: "Browser could not load a page bundle (stale tab after a deploy?)", status: "inspected", report: "Stale tab.", inspectedAt: "2026-10-05T00:00:00Z",
      detail: { kind: "unhandledrejection", message: "TypeError: Importing a module script failed.", page: "/crm", file: null }, count: 3, first: "2026-10-03T00:00:00Z", last: "2026-10-05T00:00:00Z", severity: "warning" });

    const dry = await mergeDuplicateIssues(pool, { dryRun: true });
    expect(dry).toMatchObject({ scanned: 7, folded: 3, rekeyed: 1, dryRun: true });
    expect((await all()).map((r) => Number(r.id))).toEqual([a, b, c, other, health, s1, s2]); // nothing written

    const out = await mergeDuplicateIssues(pool);
    expect(out).toMatchObject({ scanned: 7, folded: 3, rekeyed: 1, dryRun: false });
    expect(out.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ keep: a, folded: [b, c], status: "fix_ready", count: 70 }),
      expect.objectContaining({ keep: s1, folded: [s2], status: "inspected", count: 12 }),
    ]));

    const rows = await all();
    expect(rows.map((r) => Number(r.id))).toEqual([a, other, health, s1]);
    const merged = rows[0];
    const stable = issueFingerprint("job", failureKey(failureDetail(what, e1, { orgId: 7 })));
    expect(merged.fingerprint).toBe(stable);
    expect(merged).toMatchObject({
      count: 70, status: "fix_ready", severity: "error", report: "Refresh the token before syncing.", branch: "issue/2",
      title: `${what} failed: c (latest)`,
    });
    expect(merged.detail.latest).toBe(true);
    expect(merged.first_seen.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(merged.last_seen.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(merged.inspected_at.toISOString()).toBe("2026-10-02T09:50:00.000Z");
    expect(merged.history.map((h: any) => h.event)).toEqual(["reported", "claimed", "inspected", "merged"]);
    expect(merged.history.at(-1)).toMatchObject({ by: "issue desk", note: expect.stringContaining(`#${b}, #${c}`) });
    // The other org's row took its own stable fingerprint; the fixed-key row is as it was.
    expect(rows[1].fingerprint).toBe(issueFingerprint("job", failureKey(failureDetail(what, e1, { orgId: 8 }))));
    expect(rows[1].history).toHaveLength(1);
    expect(rows[2].fingerprint).toBe(issueFingerprint("health", "voice_engine_unreachable"));
    // The stale-bundle reports are one issue, with the admin-approved row's status, text and report.
    expect(rows[3]).toMatchObject({ fingerprint: issueFingerprint("client", "chunk-load"), count: 12, status: "inspected", report: "Stale tab.", severity: "error",
      title: "Browser could not load a page bundle (stale tab after a deploy?)" });

    // The next occurrence — from yet another build — lands on the merged row, not a new one.
    const rec = createIssueRecorder({ pool, minIntervalMs: 0 });
    await rec.record({ source: "job", key: failureKey, title: `${what} failed: again`, detail: { what, orgId: 7, error: errorFacts(builtError(1)) } });
    expect(await all()).toHaveLength(4);
    expect((await getIssue(a, pool))!.count).toBe(71);

    // Idempotent: nothing left to do, nothing changes.
    const before = JSON.stringify(await all());
    expect(await mergeDuplicateIssues(pool)).toMatchObject({ scanned: 4, folded: 0, rekeyed: 0, groups: [] });
    expect(JSON.stringify(await all())).toBe(before);
  });

  it("a keeper can take a fingerprint another moving row still holds (no unique-key collision), and a fix that did not hold is not kept as fixed", async () => {
    await pool.query(`DELETE FROM ops_issues`);
    const d7 = failureDetail("Swap job", builtError(1), { orgId: 7 });
    const d8 = failureDetail("Swap job", builtError(1), { orgId: 8 });
    const fp7 = issueFingerprint("job", failureKey(d7)), fp8 = issueFingerprint("job", failureKey(d8));
    // Each row sits on the OTHER one's stable fingerprint.
    const x = await insert({ fp: fp8, title: "org 7", detail: d7, first: "2026-10-01T00:00:00Z", last: "2026-10-01T00:00:00Z", status: "fixed",
      history: [{ at: "2026-10-01T00:00:00Z", event: "reported" }, { at: "2026-10-01T01:00:00Z", event: "fixed", by: "o***@x.co" }] });
    const y = await insert({ fp: fp7, title: "org 8", detail: d8, first: "2026-10-02T00:00:00Z", last: "2026-10-02T00:00:00Z" });
    const z = await insert({ fp: "legacy-z", title: "org 7 again", detail: d7, first: "2026-10-03T00:00:00Z", last: "2026-10-06T00:00:00Z", count: 4 });
    expect(await mergeDuplicateIssues(pool)).toMatchObject({ folded: 1, rekeyed: 1 });
    const rows = await all();
    expect(rows.map((r) => [Number(r.id), r.fingerprint, r.status, r.count])).toEqual([[x, fp7, "new", 5], [y, fp8, "new", 1]]);
    expect(planMerge(rows)).toEqual([]);
    void z;
  });
});

describe("the digest notifies only when something changed", () => {
  const RUN = (n: number) => `fprun-${SCHEMA.slice(-6)}-${n}`;
  const bells = async (run: string) => (await admin.query(`SELECT title, body FROM user_notifications WHERE kind = 'ops.issue_desk' AND body LIKE $1`, [`%Run ${run}`])).rows;
  const claimAndReport = async (id: number, status: "inspected" | "fix_ready" | "ignored", branch?: string) => {
    const claimed = await claimIssues(10, pool);
    expect(claimed.map((i) => i.id)).toContain(id);
    for (const i of claimed) expect("issue" in (await reportIssue(i.id, { status: i.id === id ? status : "inspected", report: "r", branch: i.id === id ? branch : null }, pool))).toBe(true);
  };

  it("first verdict → one bell; the same verdict again → nothing; a fix, a recurrence after 'fixed' or a re-inspection → a bell", async () => {
    await pool.query(`DELETE FROM ops_issues`);
    const rec = createIssueRecorder({ pool, minIntervalMs: 0 });
    const fail = () => rec.record({ source: "job", key: failureKey, title: "Digest job failed: x", detail: { what: "Digest job", error: errorFacts(builtError(1)) } });
    await fail();
    const id = Number((await all())[0].id);
    const adminsWithAccounts = (await admin.query(`SELECT 1 FROM users WHERE lower(email) = 'dev@constructhub.local'`)).rows.length;

    // 1. First seen and inspected: news.
    await claimAndReport(id, "inspected");
    const first = await completeRun(RUN(1), [id], { q: pool });
    expect(first).toMatchObject({ reported: 1, changed: 1, title: "Claude inspected 1 issue — no fix ready" });
    expect(first.notified).toBe(first.admins);
    expect(await bells(RUN(1))).toHaveLength(first.admins);
    if (!first.admins) expect(adminsWithAccounts).toBe(0);
    // …and a retried "run complete" tells no one twice.
    expect(await completeRun(RUN(1), [id], { q: pool })).toMatchObject({ reported: 1, changed: 0, title: null, notified: 0 });

    // 2. It keeps failing (count grows) and an admin sends it back; Claude says the same thing: that IS asked-for news.
    await fail(); await fail();
    expect((await getIssue(id, pool))!).toMatchObject({ count: 3, status: "inspected" });
    // A later run that reports on nothing new for this issue: no notification at all.
    expect(await completeRun(RUN(2), [id], { q: pool })).toMatchObject({ changed: 0, title: null, notified: 0, emailed: 0 });
    expect(await bells(RUN(2))).toHaveLength(0);

    // 3. Re-inspected with the SAME verdict after nothing changed in between (a stale claim retaken): nothing.
    await pool.query(`UPDATE ops_issues SET status = 'inspecting', claimed_at = now() WHERE id = $1`, [id]);
    expect("issue" in (await reportIssue(id, { status: "inspected", report: "same again" }, pool))).toBe(true);
    expect(await completeRun(RUN(3), [id], { q: pool })).toMatchObject({ reported: 1, changed: 0, title: null, notified: 0 });
    expect(await bells(RUN(3))).toHaveLength(0);

    // 4. The status advances to a ready fix: news.
    await pool.query(`UPDATE ops_issues SET status = 'inspecting', claimed_at = now() WHERE id = $1`, [id]);
    expect("issue" in (await reportIssue(id, { status: "fix_ready", report: "fixed on a branch", branch: "issue/9" }, pool))).toBe(true);
    const fix = await completeRun(RUN(4), [id], { q: pool });
    expect(fix).toMatchObject({ changed: 1, title: "Claude inspected 1 issue — 1 fix ready" });
    expect(await bells(RUN(4))).toHaveLength(fix.admins);

    // 5. Marked fixed, then it happens again: reopened → inspected again with the old verdict → still news.
    await setIssueStatusByAdmin(id, "fixed", "o***@x.co", pool);
    await fail();
    expect((await getIssue(id, pool))!.status).toBe("new");
    await claimAndReport(id, "fix_ready", "issue/9");
    const back = await completeRun(RUN(5), [id], { q: pool });
    expect(back).toMatchObject({ changed: 1 });
    const backBells = await bells(RUN(5));
    expect(backBells).toHaveLength(back.admins);
    if (backBells[0]) expect(backBells[0].body).toContain("back after it was marked fixed");
    expect(await completeRun(RUN(6), [id], { q: pool })).toMatchObject({ changed: 0, title: null });

    // 6. An admin's "Re-inspect" is a request for a fresh answer: the answer is news even when it is the same.
    await setIssueStatusByAdmin(id, "new", "o***@x.co", pool);
    await claimAndReport(id, "fix_ready", "issue/9");
    expect(await completeRun(RUN(7), [id], { q: pool })).toMatchObject({ changed: 1 });
  });

  it("an issue Claude had reported on before the column existed counts as already told", async () => {
    await pool.query(`DELETE FROM ops_issues`);
    await pool.query(`ALTER TABLE ops_issues DROP COLUMN notified_sig`);
    const { rows: [old] } = await pool.query(`INSERT INTO ops_issues (fingerprint, source, title, status, report, inspected_at) VALUES ('told', 'job', 'old news', 'inspected', 'r', now()) RETURNING id`);
    const { rows: [fresh] } = await pool.query(`INSERT INTO ops_issues (fingerprint, source, title) VALUES ('untold', 'job', 'not inspected yet') RETURNING id`);
    for (const sql of OPS_ISSUES_DDL) await pool.query(sql);
    for (const sql of OPS_ISSUES_DDL) await pool.query(sql); // and again: idempotent
    const rows = await all();
    expect(rows.map((r) => r.notified_sig)).toEqual(["inspected||", null]);
    expect(await completeRun(RUN(8), [Number(old.id), Number(fresh.id)], { q: pool })).toMatchObject({ reported: 1, changed: 0, title: null, notified: 0 });
  });
});
