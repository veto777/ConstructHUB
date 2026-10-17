/**
 * "Send it for me" against the lane's database (as worker.test.ts): the send time across business days and time
 * zones, the Hold link's signature and expiry, Hold, an edit stopping the send (through the running dev server's
 * PATCH route), exactly one send under concurrency, and no send with a blocking issue, no credit or an edit.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { pool } from "../db";
import { ensurePressSchema } from "./schema";
import * as store from "./store";
import { holdSend, holdToken, releaseHash, scheduleSend, sendAtFor, sendDue, sendDeps, sendOne, verifyHoldToken, zonedTime } from "./send";
import { autopilotDeps, runAutopilotFor, saveSettings } from "./autopilot";
import { draftDeps } from "./draft";
import type { PressReleaseInput, PressReleaseText } from "@shared/press";

process.env.SESSION_SECRET ||= "vitest-press-hold";
const tag = `vs${Date.now().toString(36)}`;
const users: number[] = [];
const releaseIds: number[] = [];
const notes: { userId: number; kind: string; title: string; body?: string; actionUrl?: string }[] = [];

const input: PressReleaseInput = {
  newsType: "expansion", companyName: "Ridgeline Roofing", website: "https://ridgeline.example", city: "Columbus", state: "OH", contactName: "Dana Ortiz",
  contactEmail: "dana@ridgeline.example", contactPhone: "(614) 555-0142", details: "We added a second repair crew on November 1 after storm repair requests doubled across the county.",
  spokesperson: "Dana Ortiz", spokespersonTitle: "Owner", quoteNotes: "", about: "Roofing since 2014 in Franklin County.", photos: [],
};
const good: PressReleaseText = {
  headline: "Ridgeline Roofing Adds a Second Repair Crew in Franklin County",
  subheadline: "The Columbus roofer answers a year of storm damage with a dedicated repair team",
  dateline: "COLUMBUS, OH / October 15, 2026 /",
  body: Array(6).fill("Ridgeline Roofing today announced a second full-time crew dedicated to roof repairs and storm response, starting November 1. Repair requests more than doubled after the February and September wind storms, and homeowners were waiting up to three weeks for a leak repair. The company expects the new crew to bring that wait to under five business days. “Nobody with a leak wants to hear three weeks,” said Dana Ortiz, owner of Ridgeline Roofing. “We built this crew so a homeowner gets a tarp the same day.”").join("\n\n"),
  boilerplate: "About Ridgeline Roofing\nRidgeline Roofing is a residential roofing contractor in Columbus, Ohio, founded in 2014.",
  mediaContact: "Dana Ortiz\nRidgeline Roofing\ndana@ridgeline.example\n(614) 555-0142",
};
const bad: PressReleaseText = { ...good, headline: "AMAZING News: Ridgeline Roofing Is the Best!" };

async function newUser(tz?: string): Promise<number> {
  const { rows: [u] } = await pool.query(`INSERT INTO users (email, company_name, display_name) VALUES ($1,'Ridgeline Roofing','Dana Ortiz') RETURNING id`, [`${tag}-${users.length}@press.test`]);
  users.push(u.id);
  if (tz) await pool.query(`INSERT INTO crm_orgs (name, owner_user_id, timezone) VALUES ('Ridgeline Roofing',$1,$2)`, [u.id, tz]);
  return u.id;
}
async function credit(userId: number, credits = 2) {
  const o = await store.createOrder({ userId, email: "x@press.test", packageKey: "program_12", tier: "budget", credits, amountCents: 1 });
  await store.markPaid(o.id, `cs_${tag}_${o.id}`);
  return o.id;
}
async function draft(userId: number, text: PressReleaseText = good) {
  const r = await store.createRelease(userId, "budget", input);
  releaseIds.push(r.id);
  return store.updateRelease(r.id, { text });
}
/** A release whose send time has just passed (as the worker would find it). */
async function due(userId: number, text: PressReleaseText = good) {
  const r = await draft(userId, text);
  return store.updateRelease(r.id, { send_for_me: true, send_at: new Date(Date.now() - 60_000), send_hash: releaseHash(r) });
}

const origNotify = sendDeps.notify, origApNotify = autopilotDeps.notify, origReady = autopilotDeps.writerReady, origDraft = draftDeps.draftRelease;
beforeAll(async () => {
  await ensurePressSchema(pool);
  sendDeps.notify = (async (userId: number, kind: string, m: any) => { notes.push({ userId, kind, title: m.title, body: m.body, actionUrl: m.actionUrl }); return { inApp: true, email: "off" }; }) as any;
  autopilotDeps.notify = (async () => ({ inApp: true, email: "off" })) as any;
  autopilotDeps.writerReady = () => true;
  draftDeps.draftRelease = async () => ({ ...good });
});
afterAll(async () => {
  sendDeps.notify = origNotify; autopilotDeps.notify = origApNotify; autopilotDeps.writerReady = origReady; draftDeps.draftRelease = origDraft;
  await pool.query(`DELETE FROM press_releases WHERE id = ANY($1) OR user_id = ANY($2)`, [releaseIds, users]);
  await pool.query(`DELETE FROM press_orders WHERE user_id = ANY($1)`, [users]);
  for (const t of ["press_autopilot", "press_autopilot_runs", "press_idea_marks"]) await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM crm_divisions WHERE org_id IN (SELECT id FROM crm_orgs WHERE owner_user_id = ANY($1))`, [users]);
  await pool.query(`DELETE FROM crm_orgs WHERE owner_user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
  await pool.end();
});
beforeEach(() => { notes.length = 0; });

describe("send time", () => {
  it("is 2 business days later at 10:00 in the customer's zone", () => {
    const iso = (d: Date) => d.toISOString();
    // Wed Oct 21 2026 → Fri Oct 23, 10:00 EDT (UTC-4).
    expect(iso(sendAtFor(new Date("2026-10-21T15:00:00Z"), "America/New_York"))).toBe("2026-10-23T14:00:00.000Z");
    // Fri → Tue; Sat and Sun → Tue.
    expect(iso(sendAtFor(new Date("2026-10-16T15:00:00Z"), "America/New_York"))).toBe("2026-10-20T14:00:00.000Z");
    expect(iso(sendAtFor(new Date("2026-10-17T15:00:00Z"), "America/New_York"))).toBe("2026-10-20T14:00:00.000Z");
    expect(iso(sendAtFor(new Date("2026-10-18T15:00:00Z"), "America/New_York"))).toBe("2026-10-20T14:00:00.000Z");
    // 11 PM Friday in New York is still Friday there (already Saturday in UTC).
    expect(iso(sendAtFor(new Date("2026-10-17T03:00:00Z"), "America/New_York"))).toBe("2026-10-20T14:00:00.000Z");
    // Across the end of daylight saving (Nov 1): Thu Oct 29 → Mon Nov 2, 10:00 EST (UTC-5).
    expect(iso(sendAtFor(new Date("2026-10-29T15:00:00Z"), "America/New_York"))).toBe("2026-11-02T15:00:00.000Z");
    // Another zone, and a bad one falls back to New York.
    expect(iso(sendAtFor(new Date("2026-10-21T15:00:00Z"), "America/Los_Angeles"))).toBe("2026-10-23T17:00:00.000Z");
    expect(iso(sendAtFor(new Date("2026-10-21T15:00:00Z"), "Not/AZone"))).toBe("2026-10-23T14:00:00.000Z");
    expect(iso(zonedTime(2026, 7, 1, 10, "Europe/London"))).toBe("2026-07-01T09:00:00.000Z");
  });
});

describe("hold link", () => {
  it("is signed and expires at the send time", () => {
    const at = new Date(Date.now() + 3_600_000);
    const t = holdToken(42, at);
    expect(verifyHoldToken(t)).toEqual({ releaseId: 42, sendAt: new Date(Math.floor(at.getTime() / 1000) * 1000) });
    const [id, exp, sig] = t.split(".");
    expect(verifyHoldToken(`43.${exp}.${sig}`)).toBeNull(); // another release
    expect(verifyHoldToken(`${id}.${Number(exp) + 3600}.${sig}`)).toBeNull(); // a later time
    expect(verifyHoldToken(`${id}.${exp}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyHoldToken(t, new Date(at.getTime() + 1000))).toBeNull(); // expired
    expect(verifyHoldToken("nonsense")).toBeNull();
  });

  it("holds the scheduled release, and only for the time it was made for", async () => {
    const u = await newUser("America/New_York");
    await credit(u);
    const r = await draft(u);
    const s = await scheduleSend(r);
    expect(s.scheduled).toBe(true);
    if (!s.scheduled) return;
    expect(notes[0]).toMatchObject({ kind: "press.send_scheduled", actionUrl: expect.stringMatching(/^\/api\/public\/press-hold\?t=/) });
    expect(notes[0].title).toMatch(/^Your press release goes out (Mon|Tue|Wed|Thu|Fri), [A-Z][a-z]{2} \d{1,2} at 10:00 AM E[SD]T$/);
    const tok = verifyHoldToken(decodeURIComponent(notes[0].actionUrl!.split("t=")[1]))!;
    expect(tok.releaseId).toBe(r.id);
    expect(await holdSend(r.id, { sendAt: new Date(tok.sendAt.getTime() + 60_000) })).toBe(false);
    expect(await holdSend(r.id, { sendAt: tok.sendAt })).toBe(true);
    const after = (await store.getRelease(r.id))!;
    expect(after.send_at).toBeNull();
    expect(after.send_for_me).toBe(false);
    expect(after.status).toBe("draft");
    expect(await holdSend(r.id, { sendAt: tok.sendAt })).toBe(false);
  });
});

describe("sending at the time", () => {
  it("sends exactly once however many passes run at once, through the approve path", async () => {
    const u = await newUser();
    const orderId = await credit(u, 2);
    const r = await due(u);
    const results = (await Promise.all([sendDue(), sendDue(), sendDue(), sendOne(r.id, r.send_at!)])).flat().filter((x) => x.id === r.id);
    expect(results.filter((x) => x.outcome === "sent")).toHaveLength(1);
    const after = (await store.getRelease(r.id))!;
    expect(after.status).toBe("ready");
    expect(after.order_id).toBe(orderId);
    expect(after.send_at).toBeNull();
    expect((await store.getOrder(orderId))!.credits_used).toBe(1);
    expect((await sendDue()).some((x) => x.id === r.id)).toBe(false);
  });

  it("never sends with a blocking issue, without a credit, or after an edit", async () => {
    const u = await newUser();
    // Scheduling refuses a draft with a blocking issue and tells the customer what to fix.
    const b = await draft(u, bad);
    await credit(u, 1);
    const s = await scheduleSend(b);
    expect(s).toMatchObject({ scheduled: false, why: "guidelines" });
    expect(notes.map((n) => n.kind)).toEqual(["press.needs_fix"]);
    expect((await store.getRelease(b.id))!.send_at).toBeNull();

    // A blocking issue at the time (the checks run again): not sent, no credit used.
    notes.length = 0;
    const blocked = await due(u, bad);
    expect(await sendOne(blocked.id, blocked.send_at!)).toMatchObject({ outcome: "guidelines" });
    expect((await store.getRelease(blocked.id))!.status).toBe("draft");
    expect(notes[0]).toMatchObject({ kind: "press.needs_fix", title: "Your press release did not go out" });

    // Edited after it was scheduled (the stored hash no longer matches): not sent.
    const edited = await due(u);
    await pool.query(`UPDATE press_releases SET text = jsonb_set(text, '{headline}', '"Ridgeline Roofing Adds a Third Crew"') WHERE id=$1`, [edited.id]);
    expect(await sendOne(edited.id, edited.send_at!)).toMatchObject({ outcome: "edited" });
    expect((await store.getRelease(edited.id))!.status).toBe("draft");

    // No credit left: not sent.
    const first = await due(u);
    expect(await sendOne(first.id, first.send_at!)).toMatchObject({ outcome: "sent" });
    const second = await due(u);
    expect(await sendOne(second.id, second.send_at!)).toMatchObject({ outcome: "no_credit" });
    expect((await store.getRelease(second.id))!).toMatchObject({ status: "draft", order_id: null, send_at: null });

    // And scheduling refuses without a credit.
    const third = await draft(u);
    expect(await scheduleSend(third)).toMatchObject({ scheduled: false, why: "no_credit" });
  });

  it("an autopilot draft with Send it for me on is scheduled, not sent", async () => {
    const u = await newUser("America/Chicago");
    await credit(u, 3);
    const { rows: [org] } = await pool.query(`SELECT id FROM crm_orgs WHERE owner_user_id=$1`, [u]);
    await pool.query(`UPDATE crm_orgs SET city='Columbus', state='OH', email='media@ridgeline.example' WHERE id=$1`, [org.id]);
    await pool.query(`INSERT INTO crm_divisions (org_id, name, code, city, state, is_headquarters, created_at) VALUES ($1,'Main','M','Columbus','OH',true, now() - interval '400 days'), ($1,'Dayton Exteriors','D','Dayton','OH',false, now() - interval '3 days')`, [org.id]);
    await saveSettings(u, { enabled: true, dayOfMonth: 1, sendForMe: true });
    const out = await runAutopilotFor(u, new Date());
    expect(out.outcome).toBe("drafted");
    const [row] = await store.listReleases(u);
    expect(row.status).toBe("draft");
    expect(row.send_at).not.toBeNull();
    expect(row.order_id).toBeNull();
    expect(notes.some((n) => n.kind === "press.send_scheduled")).toBe(true);
  });
});

describe("editing stops the send (dev server PATCH route)", () => {
  const base = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
  it("a changed draft loses its send time; an unchanged save keeps it", async () => {
    const r = await draft(1);
    await store.updateRelease(r.id, { send_for_me: true, send_at: new Date(Date.now() + 86_400_000), send_hash: releaseHash(r) });
    const same = await fetch(`${base}/api/press/releases/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: r.input, text: r.text }) });
    expect(same.status).toBe(200);
    expect((await same.json()).sendAt).not.toBeNull();
    const changed = await fetch(`${base}/api/press/releases/${r.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { ...r.input, details: `${r.input.details} The crew has two trucks.` } }) });
    expect(changed.status).toBe(200);
    const view = await changed.json();
    expect(view.sendAt).toBeNull();
    expect(view.sendForMe).toBe(false);
    expect(view.sendNote).toMatch(/edited/i);
  });
});
