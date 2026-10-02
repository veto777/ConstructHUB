/**
 * The weekly spam report (server/voice/spam-report.ts) against the real lane
 * DB: the week maths, the email's content (pure), once per org per week, the
 * zero-week skip, the org's opt-out switches, and the batch run. The email
 * sender and (mostly) the bell are fakes that record what they were handed;
 * one case uses the real bell to see the crm_notifications row.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { cleanup, fakePhone, made, makeAccount, type Account } from "./calls-fixtures";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const bag = made();

let report: typeof import("./spam-report");
// A Wednesday in 2001: the report covers Monday 2001-01-01 → Monday 2001-01-08 (UTC). Nothing real lives there.
const NOW = new Date("2001-01-10T15:00:00Z");
const WEEK_KEY = "2001-01-01";

async function call(orgId: string, outcome: "spam" | "blocked" | "lead_submitted", at: string, from = fakePhone(), reason: string | null = "Sales pitch about Google listings") {
  await pool.query(
    "insert into voice_calls (org_id, call_sid, from_number, outcome, spam_reason, started_at) values ($1, $2, $3, $4, $5, $6)",
    [orgId, `CAtest${randomUUID().replace(/-/g, "")}`, from, outcome, outcome === "spam" ? reason : null, new Date(at)]);
  return from;
}

const fakes = () => {
  const deliver = vi.fn(async (_userId: number, _kind: string, _key: string, _msg: any) => "sent");
  const bell = vi.fn(async (_args: any) => {});
  return { deliver, bell, deps: { q: pool, deliver, bell, hasCallAssistant: async () => true, baseUrl: "https://constructhub.example.invalid" } };
};

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  const { ensureVoiceSchema } = await import("./schema");
  await ensureVoiceSchema(pool);
  report = await import("./spam-report");
});

afterAll(async () => {
  await cleanup(pool, bag);
  await pool.end();
  const { pool: appPool } = await import("../db");
  await appPool.end();
});

describe("weekly spam report", () => {
  it("covers the last complete Monday-to-Monday week (UTC)", () => {
    expect(report.spamReportWeek(NOW)).toEqual({ start: new Date("2001-01-01T00:00:00Z"), end: new Date("2001-01-08T00:00:00Z"), key: WEEK_KEY });
    // On Monday itself the week just ended is reported.
    expect(report.spamReportWeek(new Date("2001-01-08T00:30:00Z")).key).toBe(WEEK_KEY);
    expect(report.spamReportWeek(new Date("2001-01-07T23:59:00Z")).key).toBe("2000-12-25");
    expect(report.spamReportTitle(1)).toBe("We stopped 1 spam call for you this week");
    expect(report.spamReportTitle(1200)).toBe("We stopped 1,200 spam calls for you this week");
  });

  it("emails the org owner once per week: every spam call with its number, time, reason and whether it is blocked now; and rings the bell", async () => {
    const a: Account = await makeAccount(pool, bag, { orgName: "Spam Report Siding", timezone: "America/Chicago" });
    const spammer = await call(a.orgId, "spam", "2001-01-02T15:04:00Z");
    await call(a.orgId, "spam", "2001-01-03T16:00:00Z", spammer);
    await call(a.orgId, "blocked", "2001-01-05T17:30:00Z", spammer);
    await call(a.orgId, "spam", "2001-01-06T10:00:00Z", "+15550100999", "Robocall offering merchant services");
    // Outside the week, or not spam: not in the report.
    await call(a.orgId, "spam", "2001-01-08T00:00:01Z");
    await call(a.orgId, "spam", "2000-12-31T23:59:59Z");
    await call(a.orgId, "lead_submitted", "2001-01-03T12:00:00Z");
    // The spammer is blocked now (two strikes); the other number is not.
    await pool.query("insert into voice_spam (org_id, phone_number, strikes, calls, blocked_at, blocked_by) values ($1, $2, 2, 3, now(), 'auto')", [a.orgId, spammer]);

    const week = report.spamReportWeek(NOW);
    const { deliver, bell, deps } = fakes();
    const out = await report.sendWeeklySpamReport(a.orgId, week, deps);
    expect(out).toEqual({ sent: true, orgId: a.orgId, week: WEEK_KEY, calls: 4, email: "sent", bell: true });

    expect(deliver).toHaveBeenCalledTimes(1);
    const [userId, kind, key, msg] = deliver.mock.calls[0];
    expect([userId, kind, key]).toEqual([a.userId, "voice.spam_report", `voice-spam-report:${a.orgId}:${WEEK_KEY}`]);
    expect(msg.subject).toBe("We stopped 4 spam calls for you this week");
    expect(msg.text).toContain("Spam Report Siding");
    expect(msg.text).toContain("Mon, Jan 1 and Sun, Jan 7");
    expect(msg.text).toContain("Sales pitch about Google listings");
    expect(msg.text).toContain("Robocall offering merchant services");
    expect(msg.text).toContain("Blocked number: rejected before it was answered");
    expect(msg.text).toContain("(555) 010-0999");
    // Times are the org's own (America/Chicago): 2001-01-02 15:04 UTC is 9:04 AM CST.
    expect(msg.text).toMatch(/Tue, Jan 2, 9:04\sAM CST/);
    // Now blocked / not blocked, per number, as the ledger says at report time.
    expect(msg.text.match(/Now blocked/g)).toHaveLength(3);
    expect(msg.text.match(/Not blocked/g)).toHaveLength(1);
    expect(msg.text).toContain("1 of these numbers is now blocked: their calls are rejected before they're answered.");
    expect(msg.text).toContain("https://constructhub.example.invalid/crm/call-assistant?tab=calls&view=spam");
    expect(msg.text).toContain('turn off "Weekly spam report" in CRM → Settings → Notifications');
    expect(msg.html).toContain("We stopped 4 spam calls for you this week");
    expect(msg.html).not.toContain("<script");

    expect(bell).toHaveBeenCalledTimes(1);
    expect(bell.mock.calls[0][0]).toMatchObject({ pref: "spamReport", type: "call.spam_report", title: "We stopped 4 spam calls for you this week", link: "/crm/call-assistant?tab=calls&view=spam" });
    expect(bell.mock.calls[0][0].body).toBe("2 numbers, 3 screened by the assistant and 1 rejected before answering. Nobody had to pick up.");

    // Idempotent: a second run (or a second process) sends nothing.
    expect(await report.sendWeeklySpamReport(a.orgId, week, deps)).toEqual({ sent: false, orgId: a.orgId, week: WEEK_KEY, reason: "already_sent" });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(bell).toHaveBeenCalledTimes(1);
    const { rows } = await pool.query("select spam_calls, blocked_calls, email, bell from voice_spam_reports where org_id = $1", [a.orgId]);
    expect(rows).toEqual([{ spam_calls: 3, blocked_calls: 1, email: "sent", bell: true }]);
  });

  it("skips a week with no spam (nothing claimed) and an owner without the Call Assistant", async () => {
    const quiet = await makeAccount(pool, bag);
    await call(quiet.orgId, "lead_submitted", "2001-01-03T12:00:00Z");
    const week = report.spamReportWeek(NOW);
    const { deliver, bell, deps } = fakes();
    expect(await report.sendWeeklySpamReport(quiet.orgId, week, deps)).toMatchObject({ sent: false, reason: "no_spam" });
    expect((await pool.query("select count(*)::int n from voice_spam_reports where org_id = $1", [quiet.orgId])).rows[0].n).toBe(0);

    const gone = await makeAccount(pool, bag);
    await call(gone.orgId, "spam", "2001-01-03T12:00:00Z");
    expect(await report.sendWeeklySpamReport(gone.orgId, week, { ...deps, hasCallAssistant: async () => false })).toMatchObject({ sent: false, reason: "no_call_assistant" });
    expect(deliver).not.toHaveBeenCalled();
    expect(bell).not.toHaveBeenCalled();
  });

  it("follows the org's Weekly spam report switches: all off sends nothing; email off rings the bell only; bell off emails only", async () => {
    const week = report.spamReportWeek(NOW);
    const off = await makeAccount(pool, bag, { customFields: { notificationPrefs: { spamReport: false } } });
    await call(off.orgId, "spam", "2001-01-04T12:00:00Z");
    const f1 = fakes();
    expect(await report.sendWeeklySpamReport(off.orgId, week, f1.deps)).toMatchObject({ sent: false, reason: "opted_out" });
    expect(f1.deliver).not.toHaveBeenCalled();
    expect(f1.bell).not.toHaveBeenCalled();
    // Recorded as opted out, so it is never re-evaluated for that week.
    expect((await pool.query("select email from voice_spam_reports where org_id = $1", [off.orgId])).rows).toEqual([{ email: "opted_out" }]);

    const bellOnly = await makeAccount(pool, bag, { customFields: { notificationPrefs: { spamReport: { inApp: true, email: false } } } });
    await call(bellOnly.orgId, "blocked", "2001-01-04T12:00:00Z");
    const f2 = fakes();
    expect(await report.sendWeeklySpamReport(bellOnly.orgId, week, f2.deps)).toMatchObject({ sent: true, email: "opted_out", bell: true });
    expect(f2.deliver).not.toHaveBeenCalled();
    expect(f2.bell).toHaveBeenCalledTimes(1);

    const emailOnly = await makeAccount(pool, bag, { customFields: { notificationPrefs: { spamReport: { inApp: false, email: true } } } });
    await call(emailOnly.orgId, "spam", "2001-01-04T12:00:00Z");
    const f3 = fakes();
    expect(await report.sendWeeklySpamReport(emailOnly.orgId, week, f3.deps)).toMatchObject({ sent: true, email: "sent", bell: false });
    expect(f3.deliver).toHaveBeenCalledTimes(1);
    expect(f3.bell).not.toHaveBeenCalled();
  });

  it("the real bell lands a notification for the org's owners", async () => {
    const a = await makeAccount(pool, bag);
    await call(a.orgId, "spam", "2001-01-05T12:00:00Z");
    const { deliver } = fakes();
    const out = await report.sendWeeklySpamReport(a.orgId, report.spamReportWeek(NOW), { q: pool, deliver, hasCallAssistant: async () => true, baseUrl: "https://x.example.invalid" });
    expect(out).toMatchObject({ sent: true, bell: true });
    const { rows } = await pool.query("select member_id, type, title, link from crm_notifications where org_id = $1", [a.orgId]);
    expect(rows).toEqual([{ member_id: a.memberId, type: "call.spam_report", title: "We stopped 1 spam call for you this week", link: "/crm/call-assistant?tab=calls&view=spam" }]);
  });

  it("the weekly run reports every org with spam that week, once; the job is off outside production unless switched on", async () => {
    const x = await makeAccount(pool, bag);
    const y = await makeAccount(pool, bag);
    const z = await makeAccount(pool, bag);
    await call(x.orgId, "spam", "2001-01-02T12:00:00Z");
    await call(y.orgId, "blocked", "2001-01-03T12:00:00Z");
    await call(z.orgId, "spam", "2001-01-09T12:00:00Z"); // this week, not the reported one
    const { deliver, deps } = fakes();
    const first = await report.runWeeklySpamReports(NOW, { ...deps, orgIds: [x.orgId, y.orgId, z.orgId] });
    expect(first).toEqual({ week: WEEK_KEY, sent: 2, skipped: {} });
    expect(deliver.mock.calls.map((c) => c[2]).sort()).toEqual([`voice-spam-report:${x.orgId}:${WEEK_KEY}`, `voice-spam-report:${y.orgId}:${WEEK_KEY}`].sort());
    // Again (a restart, the next hourly check): nothing left to send.
    expect(await report.runWeeklySpamReports(NOW, { ...deps, orgIds: [x.orgId, y.orgId, z.orgId] })).toEqual({ week: WEEK_KEY, sent: 0, skipped: {} });
    expect(deliver).toHaveBeenCalledTimes(2);

    expect(report.voiceSpamReportWorkerOffReason({ NODE_ENV: "production" } as any)).toBeNull();
    expect(report.voiceSpamReportWorkerOffReason({ NODE_ENV: "production", VOICE_SPAM_REPORT_WORKER_ENABLED: "false" } as any)).toMatch(/false/);
    expect(report.voiceSpamReportWorkerOffReason({ NODE_ENV: "development" } as any)).toMatch(/not a production server/);
    expect(report.voiceSpamReportWorkerOffReason({ NODE_ENV: "development", VOICE_SPAM_REPORT_WORKER_ENABLED: "true" } as any)).toBeNull();
  });

  it("the email lists at most 50 calls and counts the rest", () => {
    const week = report.spamReportWeek(NOW);
    const calls = Array.from({ length: 53 }, (_, i) => ({
      callId: String(i), phoneNumber: `+1555010${String(1000 + i).slice(-4)}`, at: new Date("2001-01-03T12:00:00Z"), outcome: "spam" as const, reason: "Sales pitch", nowBlocked: false,
    }));
    const msg = report.spamReportEmail({ orgName: "Acme <b>Siding</b>", week, calls, baseUrl: "https://x.example.invalid" });
    expect(msg.subject).toBe("We stopped 53 spam calls for you this week");
    expect(msg.text.match(/Not blocked/g)).toHaveLength(50);
    expect(msg.text).toContain("3 more spam calls are in your spam report.");
    // The org name is escaped in the HTML.
    expect(msg.html).toContain("Acme &lt;b&gt;Siding&lt;/b&gt;");
  });
});
