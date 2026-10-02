/**
 * The call lifecycle over HTTP on a child server booted from THIS checkout
 * (plan-gates / sms-meter pattern; free port in 8200–8230 found at run time):
 *
 *   engine → app  /api/voice-internal/*  bearer, start, mid-call alert, end
 *                 report (lead → CRM, escalation, usage), idempotent and
 *                 race-safe retries, spam strikes → blocked, the blocklist
 *                 check, a pre-answer reject, carrier status, recordings
 *   browser → app /api/crm/voice/*       the add-on gate (402), the log and
 *                 its filters, one call with transcript, org isolation, the
 *                 spam ledger (block/unblock, manageSettings), escalations
 *   carrier → app /api/crm/sms/inbound   an escalation reply confirms it;
 *                 HELP still answers HELP first
 *
 * The child has no SignalWire carrier (texts → its own log outbox), no R2
 * (recording upload answers 503 honestly) and EMAIL_FORCE_SINK=1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import pg from "pg";
import { cleanup, fakePhone, made, makeAccount, makeNumber, setProfile, type Account } from "./calls-fixtures";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const bag = made();

const SESSION_SECRET = "voice-calls-session-secret";
const VOICE_SECRET = "voice-calls-internal-secret-0123456789";
let port = 0;
let base = "";
let child: ChildProcess;
let smsOutbox = "";
const sids: string[] = [];

/** First port in 8200–8230 nobody listens on (other lanes run their own children). */
async function freePort(): Promise<number> {
  for (let p = 8230; p >= 8200; p--) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer().once("error", () => resolve(false)).once("listening", () => srv.close(() => resolve(true)));
      srv.listen(p, "0.0.0.0");
    });
    if (ok) return p;
  }
  throw new Error("No free port in 8200–8230");
}

type Who = { cookie: string };
async function session(userId: number, orgId: string): Promise<Who> {
  const sid = randomUUID(); sids.push(sid);
  await pool.query("insert into session(sid, sess, expire) values ($1, $2, now() + interval '1 hour')",
    [sid, JSON.stringify({ cookie: { maxAge: 3600000 }, passport: { user: userId }, activeOrgId: orgId })]);
  const sig = createHmac("sha256", SESSION_SECRET).update(sid).digest("base64").replace(/=+$/, "");
  return { cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` };
}

async function http(method: string, url: string, opts: { who?: Who | null; bearer?: string | null; body?: unknown; raw?: Buffer; type?: string; form?: Record<string, string> } = {}) {
  const headers: Record<string, string> = {};
  if (opts.who) headers.cookie = opts.who.cookie;
  if (opts.bearer !== null) headers.authorization = `Bearer ${opts.bearer ?? VOICE_SECRET}`;
  let body: BodyInit | undefined;
  if (opts.raw) { body = opts.raw; headers["content-type"] = opts.type ?? "audio/wav"; }
  else if (opts.form) { body = new URLSearchParams(opts.form).toString(); headers["content-type"] = "application/x-www-form-urlencoded"; }
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  const r = await fetch(base + url, { method, headers, body });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, text };
}
const internal = (method: string, p: string, body?: unknown, bearer?: string | null) => http(method, `/api/voice-internal${p}`, { body, bearer });
const crm = (who: Who, method: string, p: string, body?: unknown) => http(method, `/api/crm/voice${p}`, { who, body, bearer: null });

const textsTo = (to: string) => existsSync(smsOutbox)
  ? readFileSync(smsOutbox, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === to)
  : [];
const usage = async (orgId: string) => (await pool.query("select * from voice_usage where org_id = $1", [orgId])).rows[0];
const newSid = () => `CAvitest${randomUUID().replace(/-/g, "")}`;

let A: Account, N: Account, C: Account, F: { userId: number };
let a: Who, n: Who, c: Who, field: Who;
let numberA: { id: string; phoneNumber: string };
const leadTech = fakePhone();

const shared: { leadSid?: string; leadCallId?: string; customerId?: string; escalationId?: number; spammer?: string; infoCallId?: string; blockedSid?: string } = {};

describe.skipIf(process.env.CRM_TEST_SINGLE_PORT === "true")("Call Assistant calls over HTTP (child server)", () => {
  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    smsOutbox = path.join(process.cwd(), "tmp", `voice-calls-sms-${port}.jsonl`);
    rmSync(smsOutbox, { force: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env, PORT: String(port), NODE_ENV: "development", DEV_AUTH_BYPASS_USER1: "false", CRM_DEMO_AUTOLOGIN: "false",
      SESSION_SECRET, VOICE_INTERNAL_SECRET: VOICE_SECRET, EMAIL_FORCE_SINK: "1", STRIPE_SECRET_KEY: "", GOOGLE_PLACES_API_KEY: "",
      SCRAPE_SCHEDULER_DISABLED: "true", GBP_SYNC_DISABLED: "true", SMS_OUTBOX_PATH: smsOutbox, VOICE_ESCALATION_WORKER_ENABLED: "false",
    };
    // No carrier, no bucket: nothing in this suite can leave the box.
    for (const k of ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER", "SIGNALWIRE_SIGNING_KEY",
      "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) delete env[k];
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    mkdirSync("tmp", { recursive: true });
    const log = createWriteStream(`tmp/voice-calls-${port}.log`);
    child.stdout!.pipe(log); child.stderr!.pipe(log);

    A = await makeAccount(pool, bag, { orgName: "Acme Siding" });
    N = await makeAccount(pool, bag, { orgName: "No Addon Co", addon: false });
    C = await makeAccount(pool, bag, { orgName: "Other Org" });
    numberA = await makeNumber(pool, A.orgId, "Main line");
    await setProfile(pool, A.orgId, {
      company: { name: "Acme Siding", timezone: "UTC" },
      serviceArea: { defaultStateCode: "WA" },
      persona: { presetId: "janice", assistantName: "Janice" },
      escalations: { rules: [{ id: "lead-tech", kinds: ["urgent"], channel: "sms", recipientName: "Lead Tech", recipient: leadTech }] },
    });
    const { rows: [fu] } = await pool.query("insert into users(email, email_verified) values ($1, true) returning id", [`voice-field-${randomUUID()}@example.invalid`]);
    bag.users.push(fu.id);
    F = { userId: fu.id };
    await pool.query("insert into crm_members(org_id, user_id, email, role, status) values ($1, $2, 'field@example.invalid', 'field', 'active')", [A.orgId, fu.id]);

    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(`Voice calls test server exited (see tmp/voice-calls-${port}.log)`);
      try { if ((await fetch(base + "/api/auth/me")).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Voice calls test server did not start");
    a = await session(A.userId, A.orgId);
    n = await session(N.userId, N.orgId);
    c = await session(C.userId, C.orgId);
    field = await session(F.userId, A.orgId);
  }, 120_000);

  afterAll(async () => {
    if (child?.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    await cleanup(pool, bag);
    await pool.query("delete from session where sid = any($1::text[])", [sids]);
    await pool.end();
    rmSync(smsOutbox, { force: true });
  });

  describe("engine → app", () => {
    it("refuses a missing or wrong bearer", async () => {
      expect((await internal("POST", "/calls", {}, null)).status).toBe(401);
      expect((await internal("POST", "/calls", {}, "wrong-secret-wrong-secret")).status).toBe(401);
    });

    it("a call to nobody's number is 404; a malformed start is 400", async () => {
      expect((await internal("POST", "/calls", { callSid: newSid(), to: "+15550100001", from: fakePhone() })).body).toMatchObject({ code: "unknown_number" });
      expect((await internal("POST", "/calls", { callSid: "x" })).status).toBe(400);
    });

    it("start → mid-call urgent alert → end report files the lead, texts the lead tech once and meters the minutes", async () => {
      const sid = newSid(); shared.leadSid = sid;
      const caller = fakePhone();
      const start = await internal("POST", "/calls", { callSid: sid, to: numberA.phoneNumber, from: caller, startedAt: new Date().toISOString(), engine: "constructhub-voice", model: "truthcode-api", persona: "janice", profileVersion: 1 });
      expect(start.status).toBe(201);
      shared.leadCallId = start.body.callId;
      // A retried start never creates a second row.
      expect((await internal("POST", "/calls", { callSid: sid, to: numberA.phoneNumber })).body.callId).toBe(start.body.callId);

      const alert = await internal("POST", `/calls/${sid}/events`, { type: "alert", kind: "urgent", summary: "water coming through the ceiling", slots: { first_name: "Dana", address: "12 Elm St" } });
      expect(alert.status).toBe(200);
      expect(alert.body).toMatchObject({ delivered: true });
      expect(alert.body.escalationId).toBeGreaterThan(0);
      shared.escalationId = alert.body.escalationId;
      expect(textsTo(leadTech)).toHaveLength(1);

      const report = {
        endedAt: new Date().toISOString(), durationSeconds: 125, outcome: "lead_submitted", summary: "Dana has an active leak over the kitchen; wants siding and flashing looked at.",
        transcript: [
          { role: "assistant", text: "Thanks for calling Acme Siding, this is Janice. What can I help you with?", t: "0.8" },
          { role: "caller", text: "Water is coming through my kitchen ceiling.", t: "4.2" },
          { role: "assistant", text: "I'm sorry. What's the street address and city?", t: "7.0" },
          { role: "caller", text: "12 Elm Street in Tacoma.", t: "10.1" },
        ],
        slots: { need: "Leak over the kitchen, siding and flashing", address: "12 Elm St", city: "Tacoma", first_name: "Dana", email: "dana.calls@example.invalid" },
        events: [{ t: "6.0", type: "alert", kind: "urgent" }],
        alerts: [{ kind: "urgent", summary: "water coming through the ceiling" }],
        lead: { requested: true },
      };
      const end = await internal("PUT", `/calls/${sid}`, report);
      expect(end.status).toBe(200);
      expect(end.body).toMatchObject({ callId: start.body.callId, outcome: "lead_submitted", blocked: false, escalations: [shared.escalationId] });
      expect(end.body.customerId).toBeTruthy();
      expect(end.body.projectId).toBeTruthy();
      shared.customerId = end.body.customerId;

      // The engine retries the end report: same answer, nothing done twice.
      const retry = await internal("PUT", `/calls/${sid}`, report);
      expect(retry.body).toEqual(end.body);
      expect(textsTo(leadTech)).toHaveLength(1);
      const { rows: [cust] } = await pool.query("select * from crm_customers where id = $1", [end.body.customerId]);
      expect(cust).toMatchObject({ org_id: A.orgId, phone: caller, first_name: "Dana", city: "Tacoma", state: "WA" });
      expect(cust.notes).toMatch(/^VIRTUAL FORM — filled out by Janice, Acme Siding's virtual assistant, on a phone call to the Main line line\./);
      expect((await pool.query("select count(*)::int n from crm_customers where org_id = $1 and phone = $2", [A.orgId, caller])).rows[0].n).toBe(1);
      const { rows: [call] } = await pool.query("select * from voice_calls where call_sid = $1", [sid]);
      expect(call).toMatchObject({ billed_minutes: 3, duration_seconds: 125, outcome: "lead_submitted", customer_id: end.body.customerId, caller_name: "Dana" });
      expect(call.lead_delivered_at).not.toBeNull();
      expect(call.transcript).toHaveLength(4);
      // The app's own mid-call event survives the engine's event list.
      expect(call.events.some((e: any) => e.type === "alert" && e.detail?.source === "app")).toBe(true);
      expect(call.flags.processedAt).toBeTruthy();
      expect(call.flags.processingAt).toBeUndefined();
      expect(call.flags.alertedKinds).toEqual(["urgent"]);
      expect(await usage(A.orgId)).toMatchObject({ calls: 1, minutes: 3, included_minutes: 500, overage_minutes: 0, account_user_id: A.userId });
    });

    it("two end reports racing for one call: exactly one does the work, minutes counted once", async () => {
      const sid = newSid();
      await internal("POST", "/calls", { callSid: sid, to: numberA.phoneNumber, from: fakePhone() });
      const report = { durationSeconds: 61, outcome: "info", summary: "Asked whether we install vinyl windows.", transcript: [{ role: "caller", text: "Do you do windows?" }] };
      const before = await usage(A.orgId);
      const results = await Promise.all([1, 2, 3].map(() => internal("PUT", `/calls/${sid}`, report)));
      for (const r of results) expect([200, 409]).toContain(r.status);
      expect(results.some((r) => r.status === 200)).toBe(true);
      const after = await usage(A.orgId);
      expect(after.calls - before.calls).toBe(1);
      expect(after.minutes - before.minutes).toBe(2);
      shared.infoCallId = results.find((r) => r.status === 200)!.body.callId;
    });

    it("two near-certain spam calls from one number block it; the next call is rejected pre-answer and costs nothing", async () => {
      const spammer = fakePhone(); shared.spammer = spammer;
      const bells = async () => (await pool.query("select count(*)::int n from crm_notifications where org_id = $1", [A.orgId])).rows[0].n;
      const bellsBefore = await bells();
      for (const [i, expectBlocked] of [[1, false], [2, true]] as const) {
        const sid = newSid();
        await internal("POST", "/calls", { callSid: sid, to: numberA.phoneNumber, from: spammer });
        const r = await internal("PUT", `/calls/${sid}`, {
          durationSeconds: 40, outcome: "spam", summary: `pitch ${i}`, spam: { confidence: 0.97, reason: "Google listing verification pitch" },
          slots: { first_name: "Telemarketer" }, lead: { requested: true }, alerts: [{ kind: "human", summary: "wants the owner" }],
        });
        expect(r.body).toMatchObject({ outcome: "spam", blocked: expectBlocked, customerId: null, escalations: [] });
      }
      // Spam notifies nobody and files nothing.
      expect(await bells()).toBe(bellsBefore);
      expect((await pool.query("select count(*)::int n from crm_customers where org_id = $1 and phone = $2", [A.orgId, spammer])).rows[0].n).toBe(0);

      const bl = await internal("GET", `/blocklist?to=${encodeURIComponent(numberA.phoneNumber)}&from=${encodeURIComponent(spammer)}`);
      expect(bl.body).toMatchObject({ orgId: A.orgId, blocked: true, strikes: 2 });
      expect((await internal("GET", `/blocklist?to=${encodeURIComponent(numberA.phoneNumber)}&from=${encodeURIComponent(fakePhone())}`)).body.blocked).toBe(false);
      expect((await internal("GET", "/blocklist?to=%2B15550100002&from=%2B15550100003")).status).toBe(404);

      // The engine <Reject>s and reports the call without ever POSTing /calls.
      const before = await usage(A.orgId);
      const sid = newSid(); shared.blockedSid = sid;
      const r = await internal("PUT", `/calls/${sid}`, { to: numberA.phoneNumber, from: spammer, durationSeconds: 0, outcome: "blocked" });
      expect(r.body).toMatchObject({ outcome: "blocked", blocked: true });
      const after = await usage(A.orgId);
      expect(after).toMatchObject({ calls: before.calls + 1, minutes: before.minutes, blocked_calls: before.blocked_calls + 1 });
      expect(after.spam_calls).toBeGreaterThanOrEqual(2);
    });

    it("carrier status: a call that never streamed gets its outcome; unknown sids are acknowledged", async () => {
      const sid = newSid();
      await internal("POST", "/calls", { callSid: sid, to: numberA.phoneNumber, from: fakePhone() });
      expect((await internal("POST", "/status", { callSid: sid, callStatus: "no-answer", duration: "0" })).body).toEqual({ ok: true, known: true });
      const { rows: [row] } = await pool.query("select * from voice_calls where call_sid = $1", [sid]);
      expect(row.outcome).toBe("hangup");
      expect(row.ended_at).not.toBeNull();
      expect(row.events.at(-1)).toMatchObject({ type: "status", detail: { callStatus: "no-answer", source: "app" } });
      expect((await internal("POST", "/status", { callSid: newSid(), callStatus: "completed" })).body).toEqual({ ok: true, known: false });
    });

    it("recordings: R2 not configured → 503 (never a fake key); a non-WAV body → 400", async () => {
      const wav = Buffer.alloc(44 + 1600);
      wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(36 + 1600, 4); wav.write("WAVE", 8, "ascii");
      wav.write("fmt ", 12, "ascii"); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
      wav.write("data", 36, "ascii"); wav.writeUInt32LE(1600, 40);
      const up = await http("POST", `/api/voice-internal/recordings/${shared.leadSid}`, { raw: wav });
      expect(up.status).toBe(503);
      expect(up.body.code).toBe("r2_unconfigured");
      expect((await http("POST", `/api/voice-internal/recordings/${shared.leadSid}`, { body: { a: 1 } })).status).toBe(400);
      expect((await http("POST", `/api/voice-internal/recordings/${newSid()}`, { raw: wav })).status).toBe(404);
    });
  });

  describe("browser → app", () => {
    it("an org without the add-on gets the standard 402 plan prompt", async () => {
      const r = await crm(n, "GET", "/calls");
      expect(r.status).toBe(402);
      expect(r.body).toMatchObject({ code: "plan_required", addon: "call_assistant" });
    });

    it("lists the org's calls without spam; spam=1 shows spam and blocked; filters work", async () => {
      const all = await crm(a, "GET", "/calls");
      expect(all.status).toBe(200);
      const outcomes = all.body.calls.map((x: any) => x.outcome);
      expect(outcomes).toContain("lead_submitted");
      expect(outcomes).not.toContain("spam");
      expect(outcomes).not.toContain("blocked");
      expect(all.body.calls[0]).not.toHaveProperty("transcript");
      const spamList = await crm(a, "GET", "/calls?spam=1");
      expect(new Set(spamList.body.calls.map((x: any) => x.outcome))).toEqual(new Set(["spam", "blocked"]));
      expect(spamList.body.total).toBe(3);
      const byName = await crm(a, "GET", "/calls?q=Dana");
      expect(byName.body.calls.map((x: any) => x.id)).toEqual([shared.leadCallId]);
      const leadsOnly = await crm(a, "GET", "/calls?outcome=lead_submitted&limit=1&page=1");
      expect(leadsOnly.body).toMatchObject({ total: 1, page: 1, limit: 1 });
      expect((await crm(a, "GET", "/calls?outcome=nonsense")).status).toBe(400);
      // Another org sees none of it.
      expect((await crm(c, "GET", "/calls")).body.total).toBe(0);
    });

    it("one call: transcript, slots, linked client, escalations; another org gets 404; no recording → 404", async () => {
      const r = await crm(a, "GET", `/calls/${shared.leadCallId}`);
      expect(r.status).toBe(200);
      expect(r.body.transcript).toHaveLength(4);
      expect(r.body.slots).toMatchObject({ first_name: "Dana", city: "Tacoma" });
      expect(r.body.customer).toMatchObject({ id: shared.customerId });
      expect(r.body.number).toMatchObject({ label: "Main line" });
      expect(r.body.escalations).toHaveLength(1);
      expect(r.body.escalations[0]).toMatchObject({ id: shared.escalationId, state: "waiting", kindLabel: "Emergency", recipientName: "Lead Tech" });
      expect(r.body.recordingUrl).toBeNull();
      expect((await crm(a, "GET", `/calls/${shared.leadCallId}/recording`)).status).toBe(404);
      expect((await crm(c, "GET", `/calls/${shared.leadCallId}`)).status).toBe(404);
      expect((await crm(c, "GET", `/calls/${shared.leadCallId}/recording`)).status).toBe(404);
    });

    it("the spam ledger: listed blocked; field members can read but not unblock; the owner unblocks and blocks by hand", async () => {
      const ledger = await crm(a, "GET", "/spam");
      const entry = ledger.body.entries.find((e: any) => e.phoneNumber === shared.spammer);
      expect(entry).toMatchObject({ blocked: true, strikes: 2, blockedBy: "auto" });
      expect((await crm(field, "GET", "/spam")).status).toBe(200);
      expect((await crm(field, "POST", `/spam/${entry.id}/unblock`)).status).toBe(403);
      expect((await crm(c, "POST", `/spam/${entry.id}/unblock`)).status).toBe(404);
      const un = await crm(a, "POST", `/spam/${entry.id}/unblock`);
      expect(un.body).toMatchObject({ unblocked: true, entry: { blocked: false, strikes: 0 } });
      expect((await internal("GET", `/blocklist?to=${encodeURIComponent(numberA.phoneNumber)}&from=${encodeURIComponent(shared.spammer!)}`)).body.blocked).toBe(false);
      expect((await crm(a, "POST", "/spam/block", { phoneNumber: "call me" })).status).toBe(400);
      const manual = fakePhone();
      const blocked = await crm(a, "POST", "/spam/block", { phoneNumber: manual });
      expect(blocked.status).toBe(201);
      expect(blocked.body.entry).toMatchObject({ phoneNumber: manual, blocked: true, blockedBy: A.memberId });
      expect((await internal("GET", `/blocklist?to=${encodeURIComponent(numberA.phoneNumber)}&from=${encodeURIComponent(manual)}`)).body.blocked).toBe(true);
    });

    it("an escalation reply by text confirms it (HELP still gets HELP); any member can close it", async () => {
      const help = await http("POST", "/api/crm/sms/inbound", { form: { From: leadTech, To: "+15550100000", Body: "HELP" }, bearer: null });
      expect(help.text).toContain("ConstructHub account alerts");
      expect((await pool.query("select confirmed_at from voice_escalations where id = $1", [shared.escalationId])).rows[0].confirmed_at).toBeNull();
      const ok = await http("POST", "/api/crm/sms/inbound", { form: { From: leadTech, Body: "OK on my way" }, bearer: null });
      expect(ok.text).toContain("<Message>Got it, thanks.</Message>");
      const open = await crm(a, "GET", "/escalations?open=1");
      expect(open.body.escalations.find((e: any) => e.id === shared.escalationId)).toMatchObject({ state: "confirmed", replyText: "OK on my way" });

      expect((await crm(c, "POST", `/escalations/${shared.escalationId}/close`)).status).toBe(404);
      const closed = await crm(field, "POST", `/escalations/${shared.escalationId}/close`, { reason: "handled on site" });
      expect(closed.body).toMatchObject({ closed: true, escalation: { state: "closed" } });
      expect((await crm(a, "POST", `/escalations/${shared.escalationId}/close`)).status).toBe(404);
      expect((await crm(a, "GET", "/escalations?open=1")).body.escalations.some((e: any) => e.id === shared.escalationId)).toBe(false);
    });

    it("transcripts and summaries never reach the request log", async () => {
      await new Promise((r) => setTimeout(r, 300));
      const log = readFileSync(`tmp/voice-calls-${port}.log`, "utf8");
      expect(log).toContain(`GET /api/crm/voice/calls/${shared.leadCallId} 200`);
      expect(log).not.toContain("Water is coming through my kitchen ceiling");
      expect(log).not.toContain("active leak over the kitchen");
    });

    it("the public Got-it link refuses a forged token", async () => {
      const r = await http("GET", `/api/public/voice/escalations/${shared.escalationId}/confirm?t=${"0".repeat(40)}`, { bearer: null });
      expect(r.status).toBe(404);
      expect(r.text).toContain("This link is not valid.");
    });
  });
});
