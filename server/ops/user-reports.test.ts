/**
 * User reports ("Report an issue" → /report-issue) against a real Postgres (the
 * dev lane DB), every row in a throwaway schema like issues.test.ts:
 *
 *   selection   the order a run takes issues in: a user's blocker, then every
 *               other user report (worst, then longest waiting), then what the
 *               app captured itself — however many job warnings there are;
 *               a report the run did not reach goes back to the front; the
 *               daily-cap skip is marked, never silent
 *   HTTP        POST /api/issues/report (signed in, signed out + email, honeypot,
 *               cross-site, validation, rate limit, scrubbing, never merged,
 *               screenshot rules), GET /api/issues/mine (own reports only),
 *               the blocker bell (once per report), the desk's publicReply,
 *               the admin reply + Fixed / Not a bug
 *   the app     the page's routes, both footers' links, the help entry, and
 *               what the issue desk is told (ops/issue-desk/prompt.md, run.sh)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import pg from "pg";
import { randomUUID } from "crypto";
import { OPS_ISSUES_DDL } from "./schema";
import {
  claimIssues, compareForDesk, createUserReport, deferUserReports, getIssue, issueFingerprint, MAX_RELEASES, peekNewIssues,
  releaseUserReport, reportIssue,
} from "./issues";
import { registerOpsIssueRoutes } from "./routes";
import { registerUserReportRoutes, USER_REPORT_BODY_LIMIT, USER_REPORT_PATH, withoutSaidSecrets } from "./user-reports";
import { USER_REPORT_BELL_KIND } from "./digest";
import { isKnownPath } from "@shared/app-routes";
import { ISSUE_SEVERITIES, PUBLIC_REPORT_STATUS_LABELS, publicReportStatus, USER_REPORT_SEVERITY, type OpsIssue } from "@shared/ops-issues";
import { helpEntry } from "@shared/help/registry";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const SCHEMA = `ops_ur_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${SCHEMA},public -c TimeZone=UTC`, max: 8 });
const SECRET = "issue-desk-test-secret-0123456789abcdef";
/** Report numbers far from anything a dev box has, so the bell's "Report #<id>" marker is this run's alone. */
const FIRST_ID = 700_000_000 + Math.floor(Math.random() * 100_000_000);
const madeUsers: number[] = [];
const stored: { key: string; type: string; bytes: number }[] = [];

let server: Server;
let base = "";
let alice = 0;
let bob = 0;

const rows = async (where = "true", params: unknown[] = []) => (await pool.query(`SELECT * FROM ops_issues WHERE ${where} ORDER BY id`, params)).rows;
const park = () => pool.query(`UPDATE ops_issues SET status = 'ignored' WHERE status IN ('new','inspecting','triage')`);
const captured = async (title: string, severity = "warning", source = "job") =>
  capturedId(await pool.query(`INSERT INTO ops_issues (fingerprint, source, severity, title) VALUES ($1, $2, $3, $4) RETURNING id`, [issueFingerprint(source, `${title}-${randomUUID()}`), source, severity, title]));
const capturedId = (r: { rows: any[] }) => Number(r.rows[0].id);
const userReport = (trying: string, impact: keyof typeof USER_REPORT_SEVERITY, userId: number | null = null) =>
  createUserReport({ title: `User report: ${trying}`, severity: USER_REPORT_SEVERITY[impact], detail: { trying, impact }, reporterUserId: userId, reporterEmail: null }, pool);

async function http(method: string, url: string, opts: { user?: number; bearer?: string; body?: unknown; headers?: Record<string, string>; base?: string } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.user) headers["x-test-user"] = String(opts.user);
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch((opts.base ?? base) + url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ }
  return { status: r.status, body: json, raw: buf, headers: r.headers };
}

const emails = new Map<number, string>();
const currentUser = (req: any) => {
  const id = Number(req.headers["x-test-user"]);
  return id > 0 ? { id, email: emails.get(id) ?? null } : null;
};
const report = (over: Record<string, unknown> = {}) => ({
  trying: "Send an estimate to a client",
  happened: "The Send button spins forever and nothing arrives.",
  page: "/crm/estimates/4821?tab=send",
  impact: "broken",
  diagnostics: {
    url: "https://constructhub.us/report-issue", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 390, height: 844 }, language: "en-US", timezone: "America/New_York", time: "2026-10-07T15:00:00.000Z",
    recentErrors: [{ kind: "error", message: "TypeError: Cannot read properties of undefined (reading 'total')", at: "2026-10-07T14:59:00.000Z", source: "https://constructhub.us/assets/index-AbCd1234.js?v=2" }],
  },
  ...over,
});
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  if (process.env.DEV_AUTH_BYPASS_USER1 !== "true" || process.env.NODE_ENV === "production") throw new Error("Run with DEV_AUTH_BYPASS_USER1=true (user 1 is the platform admin in dev)");
  delete process.env.ADMIN_GATE_USER;
  delete process.env.ADMIN_GATE_PASS;
  process.env.ISSUE_DESK_SECRET = SECRET;
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  for (const sql of OPS_ISSUES_DDL) await pool.query(sql);
  await pool.query(`ALTER SEQUENCE ${SCHEMA}.ops_issues_id_seq RESTART WITH ${FIRST_ID}`);
  const { ensureAccountEventsSchema } = await import("../account-events");
  await ensureAccountEventsSchema();
  for (const name of ["alice", "bob"]) {
    const email = `ops-${name}-${randomUUID()}@example.invalid`;
    const { rows: [u] } = await admin.query("INSERT INTO users (email) VALUES ($1) RETURNING id", [email]);
    madeUsers.push(u.id);
    emails.set(u.id, email);
    if (name === "alice") alice = u.id; else bob = u.id;
  }

  const app = express();
  app.use(USER_REPORT_PATH, express.json({ limit: USER_REPORT_BODY_LIMIT }));
  app.use(express.json());
  const getDevUser = (req: any, res: any) => {
    const id = Number(req.headers["x-test-user"]);
    if (id > 0) return { id };
    res.status(401).json({ message: "Not authenticated" });
    return null;
  };
  registerOpsIssueRoutes(app, getDevUser, {
    pool,
    userReports: {
      currentUser, perUser: 1000, perIp: 1000, perDay: 1000, globalPerHour: 10_000,
      storeScreenshot: async (buffer, type, ext) => { const key = `issue-reports/${randomUUID()}.${ext}`; stored.push({ key, type, bytes: buffer.length }); return key; },
      planOf: async (id) => (id === alice ? "pro (active)" : null),
    },
    readScreenshot: async (key) => (stored.some((s) => s.key === key) ? { body: PNG, contentType: "image/png" } : { body: null, contentType: "" }),
  });
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ message: err.message }));
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await admin.query(`DELETE FROM user_notifications WHERE kind = $1 AND body ~ $2`, [USER_REPORT_BELL_KIND, `\\nReport #${String(FIRST_ID).slice(0, 1)}[0-9]{8}$`]).catch(() => {});
  if (madeUsers.length) await admin.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [madeUsers]).catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
  await admin.end();
});

describe("schema", () => {
  it("is idempotent, and a table made before user reports existed gains the source and the columns", async () => {
    for (const sql of OPS_ISSUES_DDL) await pool.query(sql);
    // An older table: the source list without "user", none of the reporter columns.
    await pool.query(`ALTER TABLE ops_issues DROP CONSTRAINT ops_issues_source_check`);
    await pool.query(`ALTER TABLE ops_issues ADD CONSTRAINT ops_issues_source_check CHECK (source IN ('server','job','client','call_assistant','health'))`);
    await pool.query(`ALTER TABLE ops_issues DROP COLUMN reporter_user_id, DROP COLUMN reporter_email, DROP COLUMN public_reply, DROP COLUMN public_reply_at`);
    await expect(pool.query(`INSERT INTO ops_issues (fingerprint, source, title) VALUES ('x', 'user', 'x')`)).rejects.toThrow(/ops_issues_source_check/);
    for (const sql of OPS_ISSUES_DDL) await pool.query(sql);
    const made = await userReport("after the upgrade", "minor", null);
    expect(made).toMatchObject({ source: "user", status: "new", severity: "info", reporterUserId: null, publicReply: null });
    await pool.query(`DELETE FROM ops_issues WHERE id = $1`, [made.id]);
  });
});

describe("selection: which issues a run takes, and in what order", () => {
  it("takes a user's blocker first, then every other user report, then captured failures — past any number of job warnings", async () => {
    await park();
    // 14 recurring job warnings and a critical server failure, all seen more recently than the reports.
    for (let i = 0; i < 14; i++) await captured(`nightly sync warning ${i}`, "warning");
    const critical = await captured("payments webhook down", "critical", "server");
    const minorOld = await userReport("a typo on the pricing page", "minor");
    const broken = await userReport("the export button does nothing", "broken");
    const minorNew = await userReport("an idea for the dashboard", "minor");
    const blocker = await userReport("I cannot sign in", "blocker");
    // The reports are OLDER than every captured failure (first_seen and last_seen): recency must not push them back.
    await pool.query(`UPDATE ops_issues SET first_seen = now() - interval '2 days' + (id - $1) * interval '1 minute', last_seen = now() - interval '2 days' WHERE source = 'user'`, [minorOld.id]);

    const want = [blocker.id, broken.id, minorOld.id, minorNew.id, critical];
    const peek = await peekNewIssues(10, pool);
    expect(peek.slice(0, 5).map((i) => i.id)).toEqual(want);
    expect(peek).toHaveLength(10);
    expect(peek.slice(5).every((i) => i.source === "job" && i.severity === "warning")).toBe(true);
    // The same order through the tower's API (what Claude is given on stdin), peeked then claimed.
    const viaApi = await http("GET", "/api/ops-internal/issues?status=new&claim=0", { bearer: SECRET });
    expect(viaApi.body.issues.slice(0, 5).map((i: any) => i.id)).toEqual(want);
    expect(viaApi.body.issues[0]).toMatchObject({ source: "user", severity: "critical", reporter: "a signed-out visitor" });

    const claimed = await claimIssues(10, pool);
    expect(claimed.slice(0, 5).map((i) => i.id)).toEqual(want);
    expect(claimed.every((i) => i.status === "inspecting")).toBe(true);
    // What is left for the next run is job warnings only: no user report was left behind.
    expect((await rows("status = 'new'")).every((r) => r.source === "job")).toBe(true);
  });

  it("with only room for a few, the room goes to user reports (a limit of 3 never returns a captured failure while a report waits)", async () => {
    await park();
    await captured("server exploded", "critical", "server");
    for (let i = 0; i < 5; i++) await captured(`job warning ${i}`);
    const reports = [await userReport("r1", "minor"), await userReport("r2", "minor"), await userReport("r3", "broken"), await userReport("r4", "blocker")];
    const first = await claimIssues(3, pool);
    expect(first.map((i) => i.source)).toEqual(["user", "user", "user"]);
    expect(first.map((i) => i.id)).toEqual([reports[3].id, reports[2].id, reports[0].id]);
    const second = await claimIssues(3, pool);
    expect(second.map((i) => [i.source, i.severity])).toEqual([["user", "info"], ["server", "critical"], ["job", "warning"]]);
  });

  it("compareForDesk sorts in memory exactly as the query does", async () => {
    await park();
    for (let i = 0; i < 4; i++) await captured(`w ${i}`, i % 2 ? "error" : "warning");
    await captured("crit", "critical", "health");
    await userReport("a", "minor"); await userReport("b", "blocker"); await userReport("c", "broken"); await userReport("d", "minor");
    const inOrder = await peekNewIssues(10, pool);
    const shuffled = [...inOrder].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
    expect(shuffled.sort(compareForDesk).map((i) => i.id)).toEqual(inOrder.map((i) => i.id));
    expect(ISSUE_SEVERITIES.at(-1)).toBe("critical");
    expect(USER_REPORT_SEVERITY.blocker).toBe(ISSUE_SEVERITIES.at(-1)); // a blocker is the highest severity the pipeline has
  });

  it("the over-the-cap run takes user reports only (?source=user) and leaves captured failures new", async () => {
    await park();
    const job = await captured("still waiting");
    const mine = await userReport("only me", "broken");
    const peek = await http("GET", "/api/ops-internal/issues?status=new&source=user&claim=0", { bearer: SECRET });
    expect(peek.body.issues.map((i: any) => i.id)).toEqual([mine.id]);
    expect((await http("GET", "/api/ops-internal/issues?status=new&source=job", { bearer: SECRET })).status).toBe(400);
    const claim = await http("GET", "/api/ops-internal/issues?status=new&source=user", { bearer: SECRET });
    expect(claim.body.issues.map((i: any) => i.id)).toEqual([mine.id]);
    expect((await rows("id = $1", [job]))[0].status).toBe("new");
  });

  it("a user report the run did not reach is released: still Received, and first in the next run", async () => {
    await park();
    for (let i = 0; i < 3; i++) await captured(`later warning ${i}`, "error");
    const mine = await userReport("the run died before me", "minor", alice);
    const jobId = await captured("a job", "critical");
    await claimIssues(10, pool);
    expect(publicReportStatus((await getIssue(mine.id, pool))!.status)).toBe("looking");

    // Only the tower may release, only a claimed user report.
    expect((await http("POST", `/api/ops-internal/issues/${mine.id}/release`, { body: {} })).status).toBe(401);
    expect((await http("POST", `/api/ops-internal/issues/${jobId}/release`, { bearer: SECRET, body: {} })).body).toMatchObject({ code: "not_user_report" });
    const released = await http("POST", `/api/ops-internal/issues/${mine.id}/release`, { bearer: SECRET, body: { why: "run ended first (error_max_turns)" } });
    expect(released.body).toEqual({ id: mine.id, status: "new" });
    const after = (await getIssue(mine.id, pool))!;
    expect(after).toMatchObject({ status: "new", claimedAt: null, report: null });
    expect(after.history.at(-1)).toMatchObject({ event: "released", by: "run ended first (error_max_turns)" });
    expect(PUBLIC_REPORT_STATUS_LABELS[publicReportStatus(after.status)]).toBe("Received");
    expect((await http("POST", `/api/ops-internal/issues/${mine.id}/release`, { bearer: SECRET, body: {} })).body).toMatchObject({ code: "not_claimed" });

    // New failures arrive meanwhile; the released report is still first.
    await captured("brand new critical", "critical", "server");
    expect((await claimIssues(10, pool))[0].id).toBe(mine.id);

    // It cannot bounce forever: after MAX_RELEASES the tower is told to file it for a person.
    for (let n = 1; n < MAX_RELEASES; n++) {
      expect("issue" in await releaseUserReport(mine.id, "again", pool)).toBe(true);
      await claimIssues(10, pool);
    }
    expect(await releaseUserReport(mine.id, "again", pool)).toEqual({ error: "too_many", status: "inspecting" });
    expect(await releaseUserReport(99_999_999_999, "x", pool)).toEqual({ error: "not_found" });
  });

  it("a run skipped for the daily cap marks every waiting user report once, and they stay new", async () => {
    await park();
    const a = await userReport("waiting a", "broken");
    const b = await userReport("waiting b", "minor");
    const job = await captured("not a report");
    const first = await http("POST", "/api/ops-internal/user-reports/defer", { bearer: SECRET, body: { why: "daily run cap (6 runs today)" } });
    expect(first.body.deferred).toEqual([a.id, b.id]);
    expect((await http("POST", "/api/ops-internal/user-reports/defer", { bearer: SECRET, body: {} })).body.deferred).toEqual([]); // not twice in a row
    expect(await deferUserReports("x", pool)).toEqual([]);
    const marked = (await getIssue(a.id, pool))!;
    expect(marked.status).toBe("new");
    expect(marked.history.at(-1)).toMatchObject({ event: "deferred", by: "daily run cap (6 runs today)" });
    expect((await getIssue(job, pool))!.history.some((h) => h.event === "deferred")).toBe(false);
    expect((await claimIssues(2, pool)).map((i) => i.id)).toEqual([a.id, b.id]);
    expect((await http("POST", "/api/ops-internal/user-reports/defer", { body: {} })).status).toBe(401);
  });
});

describe("POST /api/issues/report", () => {
  it("stores a signed-in report as its own row: source user, severity from the radio, scrubbed, never merged", async () => {
    await park();
    const body = report({
      impact: "blocker",
      happened: "Nothing loads. My login is jane.doe@acme-roofing.com / password=hunter2secret and my cell is (813) 555-0142. Key sk_live_abcdefgh12345678.",
    });
    const one = await http("POST", "/api/issues/report", { user: alice, body });
    expect(one.status).toBe(201);
    expect(one.body).toEqual({ id: expect.any(Number), reference: `#${one.body.id}`, status: "received", screenshot: "none" });
    const two = await http("POST", "/api/issues/report", { user: alice, body }); // word for word the same
    const three = await http("POST", "/api/issues/report", { user: bob, body });
    expect(new Set([one.body.id, two.body.id, three.body.id]).size).toBe(3);

    const [row] = await rows("id = $1", [one.body.id]);
    expect(row).toMatchObject({ source: "user", severity: "critical", status: "new", count: 1, reporter_user_id: alice, reporter_email: emails.get(alice), public_reply: null });
    expect(row.title).toBe("User report: Send an estimate to a client");
    const all = await rows("id = ANY($1::bigint[])", [[one.body.id, two.body.id, three.body.id]]);
    expect(new Set(all.map((r) => r.fingerprint)).size).toBe(3);
    expect(all.every((r) => r.count === 1)).toBe(true);

    // Scrubbed (scrub.ts): no address, phone, password or key reaches the row; the page lost its id and query string.
    const json = JSON.stringify(row.detail);
    for (const secret of ["jane.doe", "hunter2secret", "555-0142", "sk_live_abcdefgh12345678", "?tab=send", "4821", "Mozilla/5.0"]) expect(json, secret).not.toContain(secret);
    expect(row.detail).toMatchObject({
      impact: "blocker", trying: "Send an estimate to a client", page: "/crm/estimates/:n",
      reporter: { signedIn: true, userId: alice, plan: "pro (active)" },
      diagnostics: { browser: "Chrome 129 · macOS", viewport: "390x844", language: "en-US", timezone: "America/New_York", sentFrom: "/report-issue" },
      screenshot: null,
    });
    expect(row.detail.happened).toBe("Nothing loads. My login is j***@acme-roofing.com / password=[redacted] and my cell is [phone …42]. Key [redacted].");
    expect(withoutSaidSecrets("My password is Tr0ub4dor&3, and the token: 'abc def'. The error code is 500.")).toBe("My password is [redacted], and the token: [redacted]. The error code is 500.");
    expect(row.detail.diagnostics.recentErrors).toEqual([{ kind: "error", at: "2026-10-07T14:59:00.000Z", message: "TypeError: Cannot read properties of undefined (reading 'total')", source: "/assets/index-AbCd1234.js" }]);
    expect(row.history).toEqual([{ at: expect.any(String), event: "reported", by: "user" }]);

    // The tower never gets the reply address.
    const peek = await http("GET", "/api/ops-internal/issues?status=new&claim=0", { bearer: SECRET });
    expect(JSON.stringify(peek.body)).not.toContain(emails.get(alice)!);
    expect(peek.body.issues[0]).not.toHaveProperty("reporterEmail");
    expect(peek.body.issues[0].reporter).toBe("a signed-in user");
  });

  it("maps the radio to the pipeline's severities", async () => {
    for (const [impact, severity] of [["blocker", "critical"], ["broken", "error"], ["minor", "info"]] as const) {
      const r = await http("POST", "/api/issues/report", { user: bob, body: report({ impact }) });
      expect((await rows("id = $1", [r.body.id]))[0].severity).toBe(severity);
    }
  });

  it("a blocker rings every platform admin's bell at once, one notification per report; other reports ring nothing", async () => {
    const bells = async (id: number) => (await admin.query(`SELECT * FROM user_notifications WHERE kind = $1 AND body LIKE $2`, [USER_REPORT_BELL_KIND, `%\nReport #${id}`])).rows;
    const blocker = await http("POST", "/api/issues/report", { user: alice, body: report({ impact: "blocker", trying: "Open my dashboard, reach me at owner@acme-roofing.com" }) });
    const rung = await bells(blocker.body.id);
    expect(rung.length).toBeGreaterThanOrEqual(1);
    expect(rung.some((n) => n.user_id === 1)).toBe(true);
    expect(new Set(rung.map((n) => n.user_id)).size).toBe(rung.length);
    expect(rung[0]).toMatchObject({ title: "A user can’t use the site", link: "/admin/issues", severity: "warning" });
    expect(rung[0].body).toContain("User report: Open my dashboard, reach me at o***@acme-roofing.com");
    // Not again when a run claims, reports on and digests it — and not again by hand.
    const { notifyAdminsOfBlockerReport } = await import("./digest");
    expect(await notifyAdminsOfBlockerReport({ id: blocker.body.id, title: "again" }, pool)).toBe(0);
    expect(await bells(blocker.body.id)).toHaveLength(rung.length);
    const minor = await http("POST", "/api/issues/report", { user: alice, body: report({ impact: "minor" }) });
    const broken = await http("POST", "/api/issues/report", { user: alice, body: report({ impact: "broken" }) });
    expect(await bells(minor.body.id)).toHaveLength(0);
    expect(await bells(broken.body.id)).toHaveLength(0);
  });

  it("signed out it needs an email; with one it stores the report with no account", async () => {
    const none = await http("POST", "/api/issues/report", { body: report() });
    expect(none.status).toBe(400);
    expect(none.body).toMatchObject({ field: "email", message: "Add your email address so we can reply." });
    expect((await http("POST", "/api/issues/report", { body: report({ email: "not an address" }) })).body).toMatchObject({ field: "email" });
    const ok = await http("POST", "/api/issues/report", { body: report({ email: "  Visitor@Example.com ", impact: "blocker", trying: "Sign in" }) });
    expect(ok.status).toBe(201);
    const [row] = await rows("id = $1", [ok.body.id]);
    expect(row).toMatchObject({ reporter_user_id: null, reporter_email: "visitor@example.com", severity: "critical", status: "new" });
    expect(row.detail.reporter).toEqual({ signedIn: false, userId: null, plan: null });
    expect(JSON.stringify(row.detail)).not.toContain("visitor@example.com");
  });

  it("refuses what is not a report: missing fields, a cross-site post; a honeypot hit is answered and dropped", async () => {
    const before = (await rows()).length;
    expect((await http("POST", "/api/issues/report", { user: alice, body: report({ trying: " " }) })).body).toMatchObject({ field: "trying" });
    expect((await http("POST", "/api/issues/report", { user: alice, body: report({ happened: "x" }) })).body).toMatchObject({ field: "happened" });
    expect((await http("POST", "/api/issues/report", { user: alice, body: report({ impact: "catastrophic" }) })).body).toMatchObject({ field: "impact" });
    expect((await http("POST", "/api/issues/report", { user: alice, body: [] })).status).toBe(400);
    expect((await http("POST", "/api/issues/report", { user: alice, body: report(), headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const bot = await http("POST", "/api/issues/report", { body: report({ email: "bot@example.com", website: "https://spam.example" }) });
    expect(bot.status).toBe(201);
    expect(bot.body).toEqual({ id: null, reference: null, status: "received", screenshot: "none" });
    expect((await rows()).length).toBe(before);
  });

  it("rate-limits per account and per signed-out IP", async () => {
    const app = express();
    app.use(express.json());
    let now = 1_000_000;
    registerUserReportRoutes(app, { pool, currentUser, perUser: 2, perIp: 1, windowMs: 60_000, now: () => now, storeScreenshot: null, planOf: async () => null, notifyBlocker: async () => 0 });
    const s = await new Promise<Server>((resolve) => { const x = app.listen(0, "127.0.0.1", () => resolve(x)); });
    const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      expect((await http("POST", "/api/issues/report", { base: b, user: alice, body: report() })).status).toBe(201);
      expect((await http("POST", "/api/issues/report", { base: b, user: alice, body: report() })).status).toBe(201);
      const limited = await http("POST", "/api/issues/report", { base: b, user: alice, body: report() });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect((await http("POST", "/api/issues/report", { base: b, user: bob, body: report() })).status).toBe(201); // another account is unaffected
      expect((await http("POST", "/api/issues/report", { base: b, body: report({ email: "a@example.com" }) })).status).toBe(201);
      expect((await http("POST", "/api/issues/report", { base: b, body: report({ email: "b@example.com" }) })).status).toBe(429);
      now += 61_000;
      expect((await http("POST", "/api/issues/report", { base: b, user: alice, body: report() })).status).toBe(201);
    } finally { s.close(); }
  });

  it("keeps a screenshot only when it is a real image, and only in storage — never on disk", async () => {
    const png = `data:image/png;base64,${PNG.toString("base64")}`;
    const ok = await http("POST", "/api/issues/report", { user: alice, body: report({ screenshot: { type: "image/png", data: png } }) });
    expect(ok.body.screenshot).toBe("saved");
    const [row] = await rows("id = $1", [ok.body.id]);
    expect(row.detail.screenshot).toEqual({ key: stored.at(-1)!.key, type: "image/png", bytes: PNG.length });
    expect(row.detail.screenshot.key).toMatch(/^issue-reports\/[0-9a-f-]{36}\.png$/);
    // Not an image, whatever it calls itself; and a type we do not take.
    const before = stored.length;
    expect((await http("POST", "/api/issues/report", { user: alice, body: report({ screenshot: { type: "image/png", data: Buffer.from("<script>alert(1)</script> padding").toString("base64") } }) })).status).toBe(400);
    expect((await http("POST", "/api/issues/report", { user: alice, body: report({ screenshot: { type: "image/svg+xml", data: PNG.toString("base64") } }) })).status).toBe(400);
    expect(stored.length).toBe(before);
    // Only platform admins open it; the public file route cannot reach the key (it serves three-segment keys).
    expect((await http("GET", `/api/admin/issues/${ok.body.id}/screenshot`)).status).toBe(401);
    expect((await http("GET", `/api/admin/issues/${ok.body.id}/screenshot`, { user: alice })).status).toBe(403);
    const shot = await http("GET", `/api/admin/issues/${ok.body.id}/screenshot`, { user: 1 });
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    expect(shot.headers.get("cache-control")).toContain("no-store");
    expect(shot.raw.equals(PNG)).toBe(true);
    expect(row.detail.screenshot.key.split("/")).toHaveLength(2);
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "user-reports.ts"), "utf8");
    expect(src).not.toMatch(/writeFile|createWriteStream|from "fs"|from "node:fs"/);

    // No storage configured: the report is kept, the picture is not, and the answer says so.
    const app = express();
    app.use(express.json({ limit: "8mb" }));
    registerUserReportRoutes(app, { pool, currentUser, storeScreenshot: null, planOf: async () => null });
    const s = await new Promise<Server>((resolve) => { const x = app.listen(0, "127.0.0.1", () => resolve(x)); });
    try {
      const r = await http("POST", "/api/issues/report", { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, user: alice, body: report({ screenshot: { type: "image/png", data: png } }) });
      expect(r.status).toBe(201);
      expect(r.body.screenshot).toBe("not_saved");
      expect((await rows("id = $1", [r.body.id]))[0].detail.screenshot).toBeNull();
      expect((await http("GET", `/api/admin/issues/${r.body.id}/screenshot`, { user: 1 })).status).toBe(404);
    } finally { s.close(); }
  });
});

describe("GET /api/issues/mine and the replies", () => {
  it("shows a person their own reports only, with a plain status, and the desk's publicReply once Claude reported", async () => {
    await park();
    expect((await http("GET", "/api/issues/mine")).status).toBe(401);
    const a = await http("POST", "/api/issues/report", { user: alice, body: report({ trying: "Alice: export my leads", impact: "broken" }) });
    const b = await http("POST", "/api/issues/report", { user: bob, body: report({ trying: "Bob: change my logo", impact: "minor" }) });
    await http("POST", "/api/issues/report", { body: report({ email: "anon@example.com", trying: "Anonymous: sign in" }) });

    const mineA = await http("GET", "/api/issues/mine", { user: alice });
    expect(mineA.status).toBe(200);
    expect(mineA.headers.get("cache-control")).toBe("no-store");
    expect(mineA.body.account).toEqual({ id: alice, plan: "pro (active)" });
    expect(mineA.body.reports[0]).toEqual({ id: a.body.id, trying: "Alice: export my leads", impact: "broken", status: "received", statusLabel: "Received", createdAt: expect.any(String), reply: null, repliedAt: null });
    expect(mineA.body.reports.every((r: any) => !/Bob|Anonymous/.test(r.trying))).toBe(true);
    // Nothing internal leaks into the reporter's list.
    for (const k of ["detail", "report", "branch", "history", "fingerprint", "reporterEmail", "severity"]) expect(mineA.body.reports[0]).not.toHaveProperty(k);
    const mineB = await http("GET", "/api/issues/mine", { user: bob });
    expect(mineB.body.reports.map((r: any) => r.id)).toContain(b.body.id);
    expect(mineB.body.reports.map((r: any) => r.id)).not.toContain(a.body.id);

    // A run claims them: "Being looked at".
    const claim = await http("GET", "/api/ops-internal/issues?status=new", { bearer: SECRET });
    expect(claim.body.issues.map((i: any) => i.id)).toEqual(expect.arrayContaining([a.body.id, b.body.id]));
    expect((await http("GET", "/api/issues/mine", { user: alice })).body.reports[0]).toMatchObject({ status: "looking", statusLabel: "Being looked at" });

    // Claude's verdict carries the answer for the reporter (scrubbed and capped like everything stored).
    const done = await http("POST", `/api/ops-internal/issues/${a.body.id}/report`, { bearer: SECRET, body: {
      status: "fix_ready", report: "Cause: server/crm/export.ts:41 reads a null org. Fix on the branch.", branch: `issue/${a.body.id}`,
      publicReply: "Thanks for telling us. The export failed for accounts with no company logo. A fix is ready and goes live after our team reviews it. Questions: write to help@constructhub.us.",
    } });
    expect(done.status).toBe(200);
    const after = (await http("GET", "/api/issues/mine", { user: alice })).body.reports[0];
    expect(after).toMatchObject({ status: "fix_ready", statusLabel: "Fix ready", repliedAt: expect.any(String) });
    expect(after.reply).toContain("The export failed for accounts with no company logo.");
    expect(after.reply).toContain("h***@constructhub.us");
    expect(JSON.stringify(after)).not.toContain("server/crm/export.ts");
    // "ignored" reads "Not a bug"; a report with no publicReply leaves the reply empty.
    await http("POST", `/api/ops-internal/issues/${b.body.id}/report`, { bearer: SECRET, body: { status: "ignored", report: "A suggestion." } });
    expect((await http("GET", "/api/issues/mine", { user: bob })).body.reports.find((r: any) => r.id === b.body.id)).toMatchObject({ status: "not_a_bug", statusLabel: "Not a bug", reply: null });
    // publicReply on a captured failure is dropped: nobody reads it.
    const job = await captured("job for reply");
    await claimIssues(10, pool);
    await reportIssue(job, { status: "inspected", report: "x", publicReply: "hello" }, pool);
    expect((await rows("id = $1", [job]))[0].public_reply).toBeNull();
  });

  it("an admin sees the reporter, writes or clears the reply, and marks Fixed / Not a bug", async () => {
    const made = await http("POST", "/api/issues/report", { user: bob, body: report({ trying: "Bob: print an invoice", impact: "blocker" }) });
    const id = made.body.id;
    // The list and the detail carry who reported and how bad; the filter knows the source.
    const list = await http("GET", "/api/admin/issues?source=user", { user: 1 });
    expect(list.status).toBe(200);
    expect(list.body.issues.every((i: any) => i.source === "user")).toBe(true);
    expect(list.body.issues.find((i: any) => i.id === id)).toMatchObject({ source: "user", severity: "critical", reporterUserId: bob, reporterEmail: emails.get(bob), publicReply: null });
    const detail = await http("GET", `/api/admin/issues/${id}`, { user: 1 });
    expect(detail.body.detail).toMatchObject({ impact: "blocker", diagnostics: { browser: "Chrome 129 · macOS" } });

    expect((await http("POST", `/api/admin/issues/${id}/reply`, { body: { reply: "x" } })).status).toBe(401);
    expect((await http("POST", `/api/admin/issues/${id}/reply`, { user: alice, body: { reply: "x" } })).status).toBe(403);
    expect((await http("POST", `/api/admin/issues/${id}/reply`, { user: 1, body: { reply: "x".repeat(1501) } })).status).toBe(400);
    const job = await captured("not a user report");
    expect((await http("POST", `/api/admin/issues/${job}/reply`, { user: 1, body: { reply: "hello" } })).status).toBe(400);
    expect((await http("POST", `/api/admin/issues/99999999999/reply`, { user: 1, body: { reply: "hello" } })).status).toBe(404);

    const saved = await http("POST", `/api/admin/issues/${id}/reply`, { user: 1, body: { reply: "  We found it: invoices with a 0% tax line could not print.\n\nIt is fixed now.  " } });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ publicReply: "We found it: invoices with a 0% tax line could not print.\n\nIt is fixed now.", publicReplyAt: expect.any(String) });
    expect(saved.body.history.at(-1)).toMatchObject({ event: "public_reply" });
    expect((await http("POST", `/api/admin/issues/${id}/status`, { user: 1, body: { status: "fixed" } })).status).toBe(200);
    const mine = async () => (await http("GET", "/api/issues/mine", { user: bob })).body.reports.find((r: any) => r.id === id);
    expect(await mine()).toMatchObject({ status: "fixed", statusLabel: "Fixed", reply: "We found it: invoices with a 0% tax line could not print.\n\nIt is fixed now." });
    await http("POST", `/api/admin/issues/${id}/status`, { user: 1, body: { status: "ignored" } });
    expect(await mine()).toMatchObject({ status: "not_a_bug", statusLabel: "Not a bug" });
    const cleared = await http("POST", `/api/admin/issues/${id}/reply`, { user: 1, body: { reply: "" } });
    expect(cleared.body).toMatchObject({ publicReply: null, publicReplyAt: null });
    expect((await mine()).reply).toBeNull();
    // Re-inspect sends it back to the front of the queue.
    await park();
    await captured("newer critical", "critical", "server");
    await http("POST", `/api/admin/issues/${id}/status`, { user: 1, body: { status: "new" } });
    expect((await peekNewIssues(10, pool))[0].id).toBe(id);
    expect(await mine()).toMatchObject({ status: "received" });
  });
});

describe("the page, the footers and what the issue desk is told", () => {
  const read = (f: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../..", f), "utf8");

  it("the report page is a route on the platform (signed in and out) and in the CRM, and a known path (200, not the 404)", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain(`<Route path="/report-issue" component={ReportIssuePage} />`);
    expect(app).toMatch(/<Route path="\/report-issue">\{\(\) => <Suspense fallback=\{null\}><Ribboned\.ReportIssuePage \/><\/Suspense>\}<\/Route>/);
    expect(app).toContain(`<Route path="/crm/report-issue" component={CrmReportIssuePage} />`);
    // Signed out it must not bounce to sign-in, and the CRM paywall must not hide it.
    expect(app.match(/SIGNED_IN_ONLY = \[[\s\S]*?\];/)![0]).not.toContain("/report-issue");
    expect(app).toMatch(/CRM_GATE_OPEN = \[[^\]]*\\\/crm\\\/report-issue/);
    expect(isKnownPath("/report-issue")).toBe(true);
    expect(isKnownPath("/crm/report-issue")).toBe(true);
    expect(helpEntry("report-issue")).toMatchObject({ route: "/report-issue", group: "Tools" });
    expect(read("client/src/pages/report-issue.tsx")).toContain(`<HelpButton k="report-issue" />`);
  });

  it("Help and Report an issue are in the platform footer, the CRM footer and both public footers (the app shells keep them)", () => {
    const app = read("client/src/App.tsx");
    const dash = app.slice(app.indexOf('data-testid="footer-dashboard"'), app.indexOf("</footer>", app.indexOf('data-testid="footer-dashboard"')));
    expect(dash).toContain(`<Link href="/tutorials"`);
    expect(dash).toContain(`<Link href={reportIssueHref()}`);
    const crm = app.slice(app.indexOf('data-testid="footer-crm"'), app.indexOf("</footer>", app.indexOf('data-testid="footer-crm"')));
    expect(crm).toContain(`href={marketingUrl("/tutorials#group-crm")}`);
    expect(crm).toContain(`<Link href={reportIssueHref("/crm/report-issue")}`);
    const chrome = read("client/src/components/public-page-chrome.tsx");
    for (const id of ["footer-public-page-app", "footer-public-page"]) {
      const at = chrome.indexOf(`data-testid="${id}"`);
      const footer = chrome.slice(at, chrome.indexOf("</footer>", at));
      expect(footer, id).toContain(`<Link href="/tutorials"`);
      expect(footer, id).toContain(`<Link href={reportIssueHref()}`);
    }
    const landing = read("client/src/pages/landing.tsx");
    expect(landing).toContain(`data-testid="link-footer-help"`);
    expect(landing).toContain(`<Link href="/report-issue"`);
    // Neither link is a sales page: the iPhone apps do not redirect them away.
    expect(app.match(/const APP_SALES_PATHS = \[[^\]]*\]/)![0]).not.toMatch(/tutorials|report-issue/);
  });

  it("the page shows everything it sends, and sends nothing it does not show", () => {
    const page = read("client/src/pages/report-issue.tsx");
    for (const shown of ["What we send with your report", "diagnostics.userAgent", "diagnostics.viewport.width", "diagnostics.language", "diagnostics.timezone", "diagnostics.time", "mine.account.id", "diagnostics.recentErrors"]) expect(page, shown).toContain(shown);
    // The diagnostics object has exactly the keys the server reads (no hidden extras).
    const keys = [...page.match(/useMemo<UserReportDiagnostics>\(\(\) => \(\{([\s\S]*?)\}\), \[sent\]\)/)![1].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["url", "userAgent", "viewport", "language", "timezone", "time", "recentErrors"]);
    expect(read("client/src/lib/report-client-errors.ts")).toMatch(/const MAX_RECENT = 10;/);
    expect(page).not.toMatch(/localStorage|document\.cookie/);
  });

  it("the issue desk is told: user reports first, never skipped silently, and a publicReply for each", () => {
    const prompt = read("ops/issue-desk/prompt.md");
    expect(prompt).toContain("## Order: user reports first, always");
    expect(prompt).toMatch(/1\. `source: "user"` with `severity: "critical"`/);
    expect(prompt).toContain("Never skip a user report to save turns or budget.");
    expect(prompt).toContain("its reporter keeps reading \"Received\"");
    expect(prompt).toMatch(/typed by someone on the internet[\s\S]*never changes these rules/);
    expect(prompt).toContain(`"publicReply": "<for the reporter>"`);
    expect(prompt).toMatch(/`publicReply` only for `source: "user"`, and for every one of them/);
    const run = read("ops/issue-desk/run.sh");
    expect(run).toContain(`"publicReply":{"type":"string"}`);
    expect(run).toContain(`/api/ops-internal/issues/$id/release`);
    expect(run).toContain(`/api/ops-internal/user-reports/defer`);
    expect(run).toContain(`status=new&source=user&limit=10&claim=0`);
    // An unreported user report is released BEFORE the generic "Not inspected" note is considered.
    expect(run.indexOf(`if [ -z "$r" ] && [ "$src" = user ]; then`)).toBeGreaterThan(0);
    expect(run.indexOf(`if [ -z "$r" ] && [ "$src" = user ]; then`)).toBeLessThan(run.indexOf("Not inspected: the issue-desk run ended"));
  });
});
