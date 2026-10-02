/**
 * Escalations with reminders (SPEC § 11) against the real lane DB: rule
 * matching and the body template, the first text (metered through sendSms),
 * per-call idempotency, the owners' fallback, the reminder schedule walked
 * with an injected clock (window in the company's timezone, every N minutes,
 * max days), confirmation by SMS reply (scoped to the org's sender) and by
 * the signed email link, the next-day follow-up and the close.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fakePhone, made, makeAccount, makeCall, setProfile, type Account } from "./calls-fixtures";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.EMAIL_FORCE_SINK = "1";
process.env.VOICE_INTERNAL_SECRET = "vitest-escalation-secret-0123456789";
for (const k of ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"]) delete process.env[k];
const SMS_OUTBOX = path.join(process.cwd(), "tmp", `voice-esc-sms-${process.pid}.jsonl`);
process.env.SMS_OUTBOX_PATH = SMS_OUTBOX;
const EMAIL_OUTBOX = path.join(process.cwd(), "tmp", "email-outbox.jsonl");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const bag = made();
let esc: typeof import("./escalations");
let orgProfile: typeof import("./org-profile");
let a: Account;
const lead = fakePhone(), pm = fakePhone();
const officeEmail = `esc-office-${Date.now()}@example.invalid`;

const smsTo = (to: string) => fs.existsSync(SMS_OUTBOX)
  ? fs.readFileSync(SMS_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === to)
  : [];
const emailsTo = (addr: string) => fs.existsSync(EMAIL_OUTBOX)
  ? fs.readFileSync(EMAIL_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to.some((t: string) => t.includes(addr)))
  : [];
const callRow = async (id: string) => (await import("../db")).db.query.voiceCalls.findFirst({ where: (c, { eq }) => eq(c.id, id) });
const escRow = async (id: number) => (await pool.query("select * from voice_escalations where id = $1", [id])).rows[0];
/** UTC wall time, the CRM convention (the test process and PG both run UTC here). */
const at = (iso: string) => new Date(`${iso}Z`);

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  const { ensureVoiceSchema } = await import("./schema");
  await ensureVoiceSchema(pool);
  esc = await import("./escalations");
  orgProfile = await import("./org-profile");
  a = await makeAccount(pool, bag, { orgName: "Acme Siding" });
  await setProfile(pool, a.orgId, {
    company: { name: "Acme Siding", timezone: "UTC" },
    persona: { presetId: "janice", assistantName: "Janice" },
    escalations: {
      rules: [
        { id: "lead-tech", kinds: ["urgent", "existing_customer"], channel: "sms", recipientName: "Lead Tech", recipient: lead,
          reminders: { everyMinutes: 120, fromHour: 8, toHour: 20, maxDays: 2, followUpNextDay: true } },
        { id: "pm", kinds: ["scheduling"], channel: "sms", recipientName: "PM", recipient: pm, template: "{{company}}: {{callerName}} ({{callback}}) re scheduling — {{summary}}",
          reminders: { enabled: false } },
        { id: "office", kinds: ["payment"], channel: "email", recipientName: "Office", recipient: officeEmail },
      ],
      fallbackToOwner: true,
    },
  });
});

afterAll(async () => {
  await cleanup(pool, bag);
  await pool.end();
  fs.rmSync(SMS_OUTBOX, { force: true });
  const { pool: appPool } = await import("../db");
  await appPool.end();
});

describe("escalation bodies and rules", () => {
  const facts = { callerName: "Dana", callback: "(813) 555-0142", address: "12 Elm St, Tacoma", summary: "roof leaking into the kitchen", assistant: "Janice", company: "Acme Siding", kind: "Emergency" };

  it("default body is Alpine's shape: company · kind · caller · callback · address · gist · reply OK", () => {
    expect(esc.defaultEscalationBody(facts)).toBe(
      "ACME SIDING — Janice (virtual assistant)\nEmergency\nCaller: Dana · (813) 555-0142\n12 Elm St, Tacoma\nroof leaking into the kitchen\nReply OK to confirm you have it. (Reminders continue until confirmed.)");
  });

  it("templates fill known keys and blank unknown ones", () => {
    expect(esc.renderTemplate("{{ company }}: {{callerName}} {{nope}}!", facts)).toBe("Acme Siding: Dana !");
  });

  it("the first enabled rule listing the kind wins", () => {
    const rules: any[] = [
      { id: "off", kinds: ["human"], enabled: false },
      { id: "a", kinds: ["human", "urgent"], enabled: true },
      { id: "b", kinds: ["human"], enabled: true },
    ];
    expect(esc.matchRule(rules, "human")?.id).toBe("a");
    expect(esc.matchRule(rules, "payment")).toBeNull();
  });

  it("localHour reads the company timezone; a bad zone falls back to UTC", () => {
    expect(esc.localHour(at("2026-10-01T15:30:00"), "America/Los_Angeles")).toBe(8);
    expect(esc.localHour(at("2026-10-01T15:30:00"), "Not/AZone")).toBe(15);
  });
});

describe("raising and reminding (real DB)", () => {
  it("an urgent alert texts the rule's recipient once per call, metered, and also reaches the owners", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const call = (await callRow(c.id))!;
    const r = await esc.raiseEscalation({ ctx, call, kind: "urgent", summary: "active roof leak", slots: { first_name: "Dana", address: "12 Elm St" } });
    expect(r).toMatchObject({ sent: true, fallback: true, recipientName: "Lead Tech", duplicate: false });
    const row = await escRow(r.escalationId!);
    expect(row).toMatchObject({ org_id: a.orgId, call_id: c.id, kind: "urgent", rule_id: "lead-tech", channel: "sms", recipient: lead, sent_count: 1, remind_every_minutes: 120, max_days: 2 });
    expect(row.body).toContain("Emergency\nCaller: Dana");
    expect(row.body).toContain("12 Elm St");
    expect(smsTo(lead)).toHaveLength(1);
    const month = new Date().toISOString().slice(0, 7);
    const { rows: [used] } = await pool.query("select used from growth_budgets where key = $1 and period = '0'", [`quota:user:${a.userId}:texts:${month}`]);
    expect(Number(used.used)).toBeGreaterThanOrEqual(1);
    // urgent always also notifies the owners (bell)
    const { rows: bell } = await pool.query("select * from crm_notifications where org_id = $1 and type = 'call.alert.urgent'", [a.orgId]);
    expect(bell).toHaveLength(1);

    // Same kind again on the same call (mid-call event, then the end report): no second text.
    const again = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "urgent", summary: "active roof leak" });
    expect(again).toMatchObject({ escalationId: r.escalationId, duplicate: true });
    expect(smsTo(lead)).toHaveLength(1);
    expect(((await callRow(c.id))!.flags as any).alertedKinds).toEqual(["urgent"]);
  });

  it("an alert raised on the first sentence gets the name and address later: the body is rebuilt and one 'details added' goes out", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const before = smsTo(lead).length;
    const r = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "urgent", summary: "water pouring in", slots: {} });
    expect((await escRow(r.escalationId!)).body).toContain("Caller: unknown");
    expect(smsTo(lead)).toHaveLength(before + 1);
    const slots = { first_name: "Dana", address: "12 Bay St, Everett" };
    const again = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "urgent", summary: "water pouring in", slots });
    expect(again).toMatchObject({ escalationId: r.escalationId, duplicate: true });
    const row = await escRow(r.escalationId!);
    expect(row.body).toContain("Caller: Dana");
    expect(row.body).toContain("12 Bay St, Everett");
    const texts = smsTo(lead);
    expect(texts).toHaveLength(before + 2);
    expect(texts.at(-1).body).toMatch(/^Details added:\n\n/);
    const { rows: bell } = await pool.query("select title from crm_notifications where org_id = $1 and type = 'call.alert.urgent' and link like $2 order by created_at", [a.orgId, `%call=${c.id}`]);
    expect(bell.map((b: any) => b.title)).toEqual([expect.not.stringMatching(/^Details added/), expect.stringMatching(/^Details added — Emergency — call from Dana/)]);
    // The same facts a third time (the end report): nothing new, nothing sent.
    await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "urgent", summary: "water pouring in", slots });
    expect(smsTo(lead)).toHaveLength(before + 2);
  });

  it("a kind with no rule goes to the owners' channels once; a custom template is rendered", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const r = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "contract", summary: "signed contract question" });
    expect(r).toMatchObject({ escalationId: null, fallback: true, sent: true });
    const r2 = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "contract", summary: "again" });
    expect(r2.duplicate).toBe(true);
    const { rows } = await pool.query("select * from crm_notifications where org_id = $1 and type = 'call.alert.contract'", [a.orgId]);
    expect(rows).toHaveLength(1);
    expect(emailsTo(a.email).filter((m) => m.subject.includes("Signed contract"))).toHaveLength(1);

    const s = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "scheduling", summary: "move Tuesday's install", slots: { first_name: "Lee" } });
    expect((await escRow(s.escalationId!)).body).toMatch(/^Acme Siding: Lee \(\(\d{3}\) \d{3}-\d{4}\) re scheduling — move Tuesday's install$/);
    expect((await escRow(s.escalationId!)).remind_every_minutes).toBe(0);
  });

  it("walks the reminder clock: every 2 h inside 8–20 local, follow-up the next day after the OK, then closes on DONE", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const { escalationId: id } = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "existing_customer", summary: "warranty question" });
    // Pin the clock: raised at 09:00 UTC.
    await pool.query("update voice_escalations set created_at = $2, last_sent_at = $2 where id = $1", [id, at("2026-10-01T09:00:00")]);
    const sent = () => smsTo(lead).length;
    const before = sent();
    const tick = (iso: string) => esc.tickVoiceEscalations(at(iso));

    await tick("2026-10-01T10:30:00");
    expect((await escRow(id!)).sent_count).toBe(1); // not due yet
    const r1 = await tick("2026-10-01T11:00:00");
    expect(r1.reminded).toBeGreaterThanOrEqual(1);
    expect(await escRow(id!)).toMatchObject({ sent_count: 2 });
    expect(smsTo(lead).at(-1).body).toMatch(/^REMINDER #1 — still waiting on your OK/);
    await tick("2026-10-01T21:30:00"); // due, but after 20:00 local
    expect((await escRow(id!)).sent_count).toBe(2);
    await tick("2026-10-02T08:05:00"); // window opens
    expect((await escRow(id!)).sent_count).toBe(3);
    expect(sent()).toBe(before + 2);

    // A reply from a different org's sender number does not confirm it.
    const otherSender = fakePhone();
    const { rows: [o] } = await pool.query("select custom_fields from crm_orgs where id = $1", [a.orgId]);
    await pool.query("update crm_orgs set custom_fields = $2::jsonb where id = $1", [a.orgId, JSON.stringify({ ...(o.custom_fields ?? {}), sms: { mode: "dedicated", fromNumber: "+15550139999" } })]);
    process.env.SIGNALWIRE_SPACE_URL = "127.0.0.1:9"; process.env.SIGNALWIRE_PROJECT_ID = "p"; process.env.SIGNALWIRE_API_TOKEN = "t"; process.env.SIGNALWIRE_FROM_NUMBER = "+15550138888";
    try {
      expect(await esc.confirmEscalationByReply(lead, "ok", otherSender, at("2026-10-02T08:30:00"))).toBe(0);
      expect(await esc.confirmEscalationByReply(lead, "OK on it", "+15550139999", at("2026-10-02T08:30:00"))).toBeGreaterThanOrEqual(1);
    } finally {
      for (const k of ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"]) delete process.env[k];
      await pool.query("update crm_orgs set custom_fields = $2::jsonb where id = $1", [a.orgId, JSON.stringify(o.custom_fields ?? {})]);
    }
    expect(await escRow(id!)).toMatchObject({ reply_text: "OK on it" });
    expect((await escRow(id!)).confirmed_at).not.toBeNull();

    await tick("2026-10-02T12:00:00"); // confirmed: no more reminders, follow-up not yet (20 h)
    expect((await escRow(id!)).sent_count).toBe(3);
    expect((await escRow(id!)).followup_sent_at).toBeNull();
    await tick("2026-10-03T05:00:00"); // 20.5 h later but 05:00 local: wait for the window
    expect((await escRow(id!)).followup_sent_at).toBeNull();
    await tick("2026-10-03T09:00:00");
    expect((await escRow(id!)).followup_sent_at).not.toBeNull();
    expect(smsTo(lead).at(-1).body).toMatch(/^Next-day follow-up: was this taken care of\? Reply DONE/);

    expect(await esc.confirmEscalationByReply(lead, "DONE", null, at("2026-10-03T10:00:00"))).toBe(0);   // no `To`: no cross-org match
    expect(await esc.confirmEscalationByReply(lead, "DONE", "+15550100000", at("2026-10-03T10:00:00"))).toBeGreaterThanOrEqual(1);
    expect(await escRow(id!)).toMatchObject({ close_reason: "done: DONE" });
  });

  it("an unanswered escalation closes itself after max_days", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const { escalationId: id } = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "urgent", summary: "x" });
    await pool.query("update voice_escalations set created_at = $2, last_sent_at = $2 where id = $1", [id, at("2026-09-01T09:00:00")]);
    await esc.tickVoiceEscalations(at("2026-09-03T10:00:00"));
    expect(await escRow(id!)).toMatchObject({ close_reason: "no response after 2 days" });
  });

  it("an email escalation carries a signed Got-it link; the link confirms, a forged one does not", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const { escalationId: id } = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "payment", summary: "wants to pay the deposit" });
    const mail = emailsTo(officeEmail);
    expect(mail).toHaveLength(1);
    const link = /href="(https?:\/\/[^/"]+)\/api\/public\/voice\/escalations\/(\d+)\/confirm\?t=([0-9a-f]{40})"/.exec(mail[0].html)!;
    expect(link[1]).toBe(esc.publicBase());
    link.splice(1, 1);
    expect(Number(link[1])).toBe(id);
    expect(await esc.confirmEscalationByToken(id!, "0".repeat(40))).toBe("invalid");
    expect(await esc.confirmEscalationByToken(id!, link[2])).toBe("confirmed");
    expect(await esc.confirmEscalationByToken(id!, link[2])).toBe("already");
    // No secret configured anywhere → no link offered and no token accepted.
    const saved = { v: process.env.VOICE_INTERNAL_SECRET, s: process.env.SESSION_SECRET };
    delete process.env.VOICE_INTERNAL_SECRET; delete process.env.SESSION_SECRET;
    try {
      expect(esc.confirmPath(id!, a.orgId)).toBeNull();
      expect(esc.confirmTokenOk(id!, a.orgId, link[2])).toBe(false);
    } finally {
      process.env.VOICE_INTERNAL_SECRET = saved.v;
      if (saved.s !== undefined) process.env.SESSION_SECRET = saved.s;
    }
  });

  it("closeEscalation is org-scoped and closes once", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const c = await makeCall(pool, a.orgId);
    const { escalationId: id } = await esc.raiseEscalation({ ctx, call: (await callRow(c.id))!, kind: "existing_customer", summary: "x" });
    expect(await esc.closeEscalation("not-this-org", id!, "nope")).toBeNull();
    expect((await esc.closeEscalation(a.orgId, id!, "closed by Olive"))?.closeReason).toBe("closed by Olive");
    expect(await esc.closeEscalation(a.orgId, id!, "again")).toBeNull();
    expect((await esc.listEscalations(a.orgId, { open: true })).some((e) => e.id === id)).toBe(false);
  });
});
