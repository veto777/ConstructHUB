import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db";
import { supportCallToRow, mirrorSupportCall, backfillSupportCallLog, SUPPORT_CALL_OUTCOME_TICKET } from "./call-log";

const ORG = "11111111-2222-4333-8444-555555555555";
const SID = `SUPTEST${Date.now()}`;

describe("support call log → brand Call Assistant", () => {
  let userId = 0;
  beforeAll(async () => {
    process.env.SUPPORT_CALL_LOG_ORG_ID = ORG;
    process.env.SUPPORT_LINE_NUMBER = "+18323990560";
    const { rows: [u] } = await pool.query("insert into users(email, display_name) values ($1,$2) returning id", [`calllog-${Date.now()}@example.test`, "Call Log Tester"]);
    userId = u.id;
  });
  afterAll(async () => {
    delete process.env.SUPPORT_CALL_LOG_ORG_ID;
    await pool.query("delete from voice_calls where call_sid like 'SUPTEST%'");
    await pool.query("delete from support_tickets where call_sid like 'SUPTEST%'");
    await pool.query("delete from support_calls where call_sid like 'SUPTEST%'");
    if (userId) await pool.query("delete from users where id=$1", [userId]);
    await pool.end();
  });

  it("maps a verified call with a ticket to a record-only row", () => {
    const r = supportCallToRow({
      call_sid: "SUPTESTx", caller_number: "+18135550100", state: { verified: true, step: "done", aiTurns: [{ role: "gabe", text: "What's going on?" }, { role: "caller", text: "Login fails" }] },
      user_id: 5, verified_at: new Date("2026-10-15T10:00:30Z"), ticket_id: 9, created_at: new Date("2026-10-15T10:00:00Z"), updated_at: new Date(),
      line: "engine", metered_seconds: 100, ended_at: new Date("2026-10-15T10:03:00Z"),
      ticket_number: "T-00009", ticket_title: "Login problem", ticket_category: "login", ticket_severity: "high", ticket_status: "open", account_email: "a@b.test",
    }, ORG, "+18323990560");
    expect(r.outcome).toBe(SUPPORT_CALL_OUTCOME_TICKET);
    expect(r.durationSeconds).toBe(180);
    expect(r.callerName).toBe("a@b.test");
    expect(r.summary).toContain("ticket T-00009 (open): Login problem");
    expect(r.transcript).toEqual([{ role: "assistant", text: "What's going on?" }, { role: "caller", text: "Login fails" }]);
    expect(r.flags.support.verified).toBe(true);
  });

  it("an unverified, ended call is info only and names nobody", () => {
    const r = supportCallToRow({
      call_sid: "SUPTESTy", caller_number: "+18135550100", state: { verified: false, step: "done", aiTurns: [] }, user_id: null, verified_at: null, ticket_id: null,
      created_at: new Date("2026-10-15T10:00:00Z"), updated_at: new Date(), line: "ivr", metered_seconds: 40, ended_at: new Date("2026-10-15T10:00:40Z"),
      ticket_number: null, ticket_title: null, ticket_category: null, ticket_severity: null, ticket_status: null, account_email: "a@b.test",
    }, ORG, null);
    expect(r.outcome).toBe("info");
    expect(r.callerName).toBeNull();
    expect(r.summary).toBe("Support line (Gabe, keypad line) · caller not verified");
  });

  it("a call that never got an end but went quiet two hours ago is over", () => {
    const r = supportCallToRow({
      call_sid: "SUPTESTz", caller_number: "+18135550100", state: { verified: false, step: "ask_id", aiTurns: [] }, user_id: null, verified_at: null, ticket_id: null,
      created_at: new Date(Date.now() - 4 * 3_600_000), updated_at: new Date(Date.now() - 3 * 3_600_000 - 30_000), line: "engine", metered_seconds: 0, ended_at: null,
      ticket_number: null, ticket_title: null, ticket_category: null, ticket_severity: null, ticket_status: null, account_email: null,
    }, ORG, null);
    expect(r.outcome).toBe("info");
    expect(r.durationSeconds).toBe(3_600 - 30);
    expect(r.summary).not.toContain("in progress");
  });

  it("mirrors, re-mirrors after a ticket, and backfills only what is missing", async () => {
    await pool.query("insert into support_calls(call_sid, caller_number, state, user_id, verified_at, line, ended_at) values ($1,$2,$3,$4,now(),'engine',now())",
      [SID, "+18135550100", JSON.stringify({ verified: true, step: "done", aiTurns: [{ role: "caller", text: "hi" }] }), userId]);
    expect(await mirrorSupportCall(SID)).toBe(true);
    let { rows: [v] } = await pool.query("select org_id, engine, outcome, persona, summary from voice_calls where call_sid=$1", [SID]);
    expect(v.org_id).toBe(ORG); expect(v.engine).toBe("external"); expect(v.persona).toBe("gabe"); expect(v.outcome).toBe("info");
    const { rows: [t] } = await pool.query("insert into support_tickets(number, user_id, call_sid, category, severity, title, description) values ($1,$2,$3,'technical','high','App crashes','desc') returning id", [`T-${SID.slice(-5)}`, userId, SID]);
    await pool.query("update support_calls set ticket_id=$2 where call_sid=$1", [SID, t.id]);
    expect(await mirrorSupportCall(SID)).toBe(true);
    ({ rows: [v] } = await pool.query("select outcome, summary, service_needed from voice_calls where call_sid=$1", [SID]));
    expect(v.outcome).toBe(SUPPORT_CALL_OUTCOME_TICKET);
    expect(v.summary).toContain("App crashes");
    expect(v.service_needed).toContain("Something in the app");
    // A second support call without a mirror row: the backfill picks up exactly that one.
    await pool.query("insert into support_calls(call_sid, caller_number, state, line, ended_at) values ($1,$2,'{}','ivr',now())", [`${SID}b`, "+18135550101"]);
    expect(await backfillSupportCallLog()).toBe(1);
    expect(await backfillSupportCallLog()).toBe(0);
    // No voice_usage row: a mirrored call is never metered.
    const { rows: [{ n }] } = await pool.query("select count(*)::int as n from voice_usage where call_id in (select id from voice_calls where call_sid like 'SUPTEST%')").catch(() => ({ rows: [{ n: 0 }] }));
    expect(n).toBe(0);
  });
});
