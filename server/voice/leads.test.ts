/**
 * Lead delivery into the CRM (SPEC § 10) against the real lane DB: phone
 * matching (formatted numbers, alt phone, org scope, archived clients), the
 * "Call Assistant" lead source, the VIRTUAL FORM note, the pipeline project,
 * the notifications (bell + the leadReceived email + profile SMS recipients,
 * metered), and that a second delivery for the same call pings nobody.
 *
 * Sends never leave the box: SignalWire env is unset (texts go to the log
 * provider's outbox) and EMAIL_FORCE_SINK=1 (mail goes to tmp/email-outbox.jsonl).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { cleanup, fakePhone, made, makeAccount, makeCall, setProfile, waitForActivity, type Account } from "./calls-fixtures";

process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.EMAIL_FORCE_SINK = "1";
for (const k of ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER"]) delete process.env[k];
const SMS_OUTBOX = path.join(process.cwd(), "tmp", `voice-leads-sms-${process.pid}.jsonl`);
process.env.SMS_OUTBOX_PATH = SMS_OUTBOX;
const EMAIL_OUTBOX = path.join(process.cwd(), "tmp", "email-outbox.jsonl");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const bag = made();

let leads: typeof import("./leads");
let orgProfile: typeof import("./org-profile");
let a: Account, other: Account;

const emailsTo = (addr: string) => fs.existsSync(EMAIL_OUTBOX)
  ? fs.readFileSync(EMAIL_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to.some((t: string) => t.includes(addr)))
  : [];
const smsTo = (to: string) => fs.existsSync(SMS_OUTBOX)
  ? fs.readFileSync(SMS_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === to)
  : [];
const callRow = async (id: string) => (await import("../db")).db.query.voiceCalls.findFirst({ where: (c, { eq }) => eq(c.id, id) });

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_a\d+)?$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Requires a ConstructHUB development lane DB");
  const { ensureVoiceSchema } = await import("./schema");
  await ensureVoiceSchema(pool);
  leads = await import("./leads");
  orgProfile = await import("./org-profile");
  a = await makeAccount(pool, bag, { orgName: "Acme Siding" });
  other = await makeAccount(pool, bag, { orgName: "Other Roofing" });
  await setProfile(pool, a.orgId, {
    company: { name: "Acme Siding LLC", spokenName: "Acme Siding" },
    serviceArea: { defaultStateCode: "WA" },
    persona: { presetId: "janice", assistantName: "Janice" },
    leadDelivery: { crm: { tags: ["call-assistant", "phone"] }, email: { extraRecipients: ["office-extra@example.invalid"] } },
  });
});

afterAll(async () => {
  await cleanup(pool, bag);
  await pool.end();
  fs.rmSync(SMS_OUTBOX, { force: true });
  const { pool: appPool } = await import("../db");
  await appPool.end();
});

describe("leadFactsFrom", () => {
  it("prefers the decision slots, normalizes phone and email, falls back to caller id", () => {
    const call = { fromNumber: "+18135550142", callerName: null, callerEmail: null, callerAddress: null, callerCity: null, serviceNeeded: "siding" };
    expect(leads.leadFactsFrom(call, { first_name: " Dana ", email: "Dana@Example.COM", address: "12 Elm St", city: "Tacoma", need: "Hardie siding", best_time: "mornings" }))
      .toEqual({ phone: "+18135550142", name: "Dana", email: "dana@example.com", address: "12 Elm St", city: "Tacoma", need: "Hardie siding", bestTime: "mornings" });
    // A bad email slot is dropped, not stored; a callback slot beats caller id.
    expect(leads.leadFactsFrom(call, { email: "not an email", phone: "(253) 555-0100" })).toMatchObject({ email: null, phone: "+12535550100", need: "siding" });
  });

  it("prettyPhone formats US numbers and never invents one", () => {
    expect(leads.prettyPhone("+18135550142")).toBe("(813) 555-0142");
    expect(leads.prettyPhone(null)).toBe("unknown");
  });
});

describe("streetOnly (integration: the engine's address slot often carries the city)", () => {
  it("drops a trailing city (and a state/ZIP after it), never part of the street", async () => {
    const { streetOnly } = await import("./leads");
    expect(streetOnly("55 Oak Lane, Bellingham", "Bellingham")).toBe("55 Oak Lane");
    expect(streetOnly("55 Oak Lane, bellingham, WA 98225", "Bellingham")).toBe("55 Oak Lane");
    expect(streetOnly("123 4th Ave, NE", "Seattle")).toBe("123 4th Ave, NE");
    expect(streetOnly("Bellingham", "Bellingham")).toBe("Bellingham");
    expect(streetOnly("55 Oak Lane, Bellingham", null)).toBe("55 Oak Lane, Bellingham");
  });
});

describe("lead delivery (real DB)", () => {
  it("findCustomerByPhone matches formatted phone and alt phone inside the org only, never archived clients", async () => {
    const phone = fakePhone(), alt = fakePhone(), archived = fakePhone();
    const ten = phone.slice(2);
    const pretty = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
    const { rows: [c1] } = await pool.query("insert into crm_customers(org_id, display_name, phone, portal_token) values ($1, 'Pat Pretty', $2, gen_random_uuid()) returning id", [a.orgId, pretty]);
    const { rows: [c2] } = await pool.query("insert into crm_customers(org_id, display_name, phone, alt_phone, portal_token) values ($1, 'Alex Alt', '+12065550000', $2, gen_random_uuid()) returning id", [a.orgId, alt]);
    await pool.query("insert into crm_customers(org_id, display_name, phone, archived_at, portal_token) values ($1, 'Old', $2, now(), gen_random_uuid())", [a.orgId, archived]);
    expect((await leads.findCustomerByPhone(a.orgId, phone))?.id).toBe(c1.id);
    expect((await leads.findCustomerByPhone(a.orgId, alt))?.id).toBe(c2.id);
    expect(await leads.findCustomerByPhone(other.orgId, phone)).toBeNull();
    expect(await leads.findCustomerByPhone(a.orgId, archived)).toBeNull();
    expect(await leads.findCustomerByPhone(a.orgId, "12")).toBeNull();
  });

  it("a new caller becomes a client + pipeline project, with the VIRTUAL FORM note, and the org is notified once", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    expect(ctx).toMatchObject({ assistantName: "Janice", companyName: "Acme Siding", version: 1 });
    const c = await makeCall(pool, a.orgId);
    await pool.query("update voice_calls set summary = 'Wants a quote to replace cedar siding.' where id = $1", [c.id]);
    const call = (await callRow(c.id))!;
    const slots = { need: "Siding replacement", address: "77 Birch Ln", city: "Bellingham", first_name: "Dana", email: "dana.caller@example.invalid", best_time: "after 3pm" };

    const d = await leads.deliverLead({ ctx, call, slots, numberLabel: "Main line" });
    expect(d).toMatchObject({ created: true, alreadyDelivered: false });
    const { rows: [cust] } = await pool.query("select * from crm_customers where id = $1", [d.customerId]);
    expect(cust).toMatchObject({ org_id: a.orgId, display_name: "Dana", first_name: "Dana", phone: c.from, email: "dana.caller@example.invalid", address_line1: "77 Birch Ln", city: "Bellingham", state: "WA" });
    expect(cust.tags).toEqual(["call-assistant", "phone"]);
    expect(cust.notes).toMatch(/^VIRTUAL FORM — filled out by Janice, Acme Siding's virtual assistant, on a phone call to the Main line line\./);
    expect(cust.notes).toContain("Need: Siding replacement");
    expect(cust.notes).toContain("Best time to call: after 3pm");
    expect(cust.notes).toContain(`[call ${c.callSid}]`);
    expect(cust.portal_token).toMatch(/^[0-9a-f]{48}$/);
    const { rows: sources } = await pool.query("select * from crm_lead_sources where org_id = $1", [a.orgId]);
    expect(sources.map((s) => s.name)).toEqual(["Call Assistant"]);
    expect(cust.lead_source_id).toBe(sources[0].id);

    const { rows: [proj] } = await pool.query("select * from crm_projects where id = $1", [d.projectId]);
    expect(proj).toMatchObject({ customer_id: cust.id, name: "Siding replacement — Bellingham", status: "lead", city: "Bellingham", description: "Wants a quote to replace cedar siding." });

    const { rows: bell } = await pool.query("select * from crm_notifications where org_id = $1 and type = 'call.lead'", [a.orgId]);
    expect(bell).toHaveLength(1);
    expect(bell[0]).toMatchObject({ member_id: a.memberId, title: "New phone lead — Dana", link: `/crm/clients/${cust.id}` });
    expect(d.notified).toMatchObject({ bell: true, email: 2 });
    const mail = emailsTo(a.email).filter((m) => m.subject.includes("New phone lead — Dana"));
    expect(mail).toHaveLength(1);
    expect(mail[0].to[0]).toContain("office-extra@example.invalid");
    expect(mail[0].html).toContain("Siding replacement");
    expect((await waitForActivity(pool, a.orgId, "call.lead")).length).toBe(1);

    // The end-of-call report delivers the same call again: nothing new, nobody pinged twice.
    await pool.query("update voice_calls set customer_id = $2, project_id = $3, lead_delivered_at = now() where id = $1", [c.id, d.customerId, d.projectId]);
    const again = await leads.deliverLead({ ctx, call: (await callRow(c.id))!, slots: { ...slots, email: "" }, numberLabel: "Main line" });
    expect(again).toMatchObject({ customerId: d.customerId, projectId: d.projectId, created: false, alreadyDelivered: true, notified: { bell: false, email: 0, sms: 0 } });
    expect((await pool.query("select count(*)::int n from crm_customers where org_id = $1 and phone = $2", [a.orgId, c.from])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int n from crm_projects where customer_id = $1", [cust.id])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int n from crm_notifications where org_id = $1 and type = 'call.lead'", [a.orgId])).rows[0].n).toBe(1);
    expect(emailsTo(a.email).filter((m) => m.subject.includes("New phone lead — Dana"))).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 200));
    expect((await waitForActivity(pool, a.orgId, "call.lead")).length).toBe(1);
  });

  it("an existing client is matched by phone, topped up (never overwritten) and gets the note appended", async () => {
    const ctx = (await orgProfile.loadOrgVoiceContext(a.orgId))!;
    const phone = fakePhone();
    const { rows: [existing] } = await pool.query(
      "insert into crm_customers(org_id, display_name, first_name, phone, city, notes, tags, portal_token) values ($1, 'Robin Regular', 'Robin', $2, 'Everett', 'VIP', '{}', gen_random_uuid()) returning id", [a.orgId, phone]);
    const c = await makeCall(pool, a.orgId, { from: phone });
    const d = await leads.deliverLead({ ctx, call: (await callRow(c.id))!, slots: { first_name: "Rob", city: "Seattle", email: "robin@example.invalid", need: "gutter repair" } });
    expect(d).toMatchObject({ customerId: existing.id, created: false });
    const { rows: [cust] } = await pool.query("select * from crm_customers where id = $1", [existing.id]);
    expect(cust).toMatchObject({ display_name: "Robin Regular", first_name: "Robin", city: "Everett", email: "robin@example.invalid" });
    expect(cust.notes).toMatch(/^VIP\n\nVIRTUAL FORM — filled out by Janice/);
    expect(cust.tags).toEqual(["call-assistant", "phone"]);
  });

  it("createProject off → client only; SMS recipients get a metered text", async () => {
    const b = await makeAccount(pool, bag, { orgName: "Beta Builders" });
    const smsTarget = "+15550130077";
    await setProfile(pool, b.orgId, {
      company: { name: "Beta Builders" },
      leadDelivery: { crm: { createProject: false }, email: { enabled: false }, sms: { enabled: true, recipients: [smsTarget] } },
    });
    const ctx = (await orgProfile.loadOrgVoiceContext(b.orgId))!;
    const c = await makeCall(pool, b.orgId);
    const d = await leads.deliverLead({ ctx, call: (await callRow(c.id))!, slots: { need: "deck", first_name: "Sam" } });
    expect(d.projectId).toBeNull();
    expect(d.notified.sms).toBe(1);
    const texts = smsTo(smsTarget);
    expect(texts).toHaveLength(1);
    expect(texts[0].body).toContain("New phone lead — Sam");
    // Metered against the owner's monthly text allowance like every other org text.
    const month = new Date().toISOString().slice(0, 7);
    const { rows: [used] } = await pool.query("select used from growth_budgets where key = $1 and period = '0'", [`quota:user:${b.userId}:texts:${month}`]);
    expect(Number(used?.used ?? 0)).toBeGreaterThanOrEqual(1);
    expect(emailsTo(b.email)).toHaveLength(0);
  });
});
