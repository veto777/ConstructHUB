/**
 * The press pipeline against a real database with a fake wire: credits, approval, the hold when the mailbox is not
 * configured, the submission email, and the wire's answers (live → customer emailed; changes → revised draft;
 * report → report stored and emailed with the attachment).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { pool } from "../db";
import { ensurePressSchema } from "./schema";
import * as store from "./store";
import { applyReplies, readInbox, submissionMail, submitReady, workerDeps } from "./worker";
import type { Inbound } from "./mailbox";
import type { PressReleaseInput, PressReleaseText } from "@shared/press";

const OWNER = 1;
const input: PressReleaseInput = { newsType: "expansion", companyName: "Vitest Roofing", website: "https://vitest.example", city: "Bellingham", state: "WA", contactName: "Pat Vitest", contactEmail: "pat@vitest.example", contactPhone: "(360) 555-0100", details: "Vitest Roofing added a second repair crew on November 1 after a year of storm work doubled repair requests across Whatcom County.", spokesperson: "Pat Vitest", spokespersonTitle: "Owner", quoteNotes: "", about: "Roofing since 2014.", photos: [] };
const text: PressReleaseText = { headline: "Vitest Roofing Adds a Second Repair Crew", subheadline: "", dateline: "BELLINGHAM, WA / October 15, 2026 /", body: "Vitest Roofing today announced a second repair crew.", boilerplate: "About Vitest Roofing\nA roofer.", mediaContact: "Pat Vitest\npat@vitest.example" };

const sent: { to: string; subject: string; body: string; attachments?: { filename: string }[] }[] = [];
let inbox: Inbound[] = [];
const origFetch = workerDeps.fetchSince, origSend = workerDeps.sendMail, origRead = workerDeps.readWireReply, origRevise = workerDeps.reviseRelease;

describe("press pipeline", () => {
  let orderId = 0; const releaseIds: number[] = [];
  beforeAll(async () => {
    await ensurePressSchema(pool);
    workerDeps.sendMail = async (m) => { sent.push({ to: m.to, subject: m.subject, body: m.body, attachments: m.attachments }); return `<out-${sent.length}@test>`; };
    workerDeps.fetchSince = async () => ({ uidValidity: "1", messages: inbox });
    workerDeps.readWireReply = async (m) => {
      if (/LIVE/.test(m.subject)) return { kind: "live", liveUrl: "https://www.example-wire.com/news/vitest-roofing", notes: null, summary: "live", report: null };
      if (/CHANGES/.test(m.subject)) return { kind: "changes", liveUrl: null, notes: "Remove the exclamation mark in the headline. Add the owner's full name.", summary: "changes", report: null };
      if (/REPORT/.test(m.subject)) return { kind: "report", liveUrl: null, notes: null, summary: "report", report: { summary: "Distributed to 312 outlets.", outlets: 312, views: 1480, clicks: 37, pickups: [{ outlet: "Yahoo Finance", url: "https://finance.yahoo.com/x" }] } };
      return { kind: "other", liveUrl: null, notes: null, summary: "unclear", report: null };
    };
    workerDeps.reviseRelease = async (_i, t, notes) => ({ ...t, headline: t.headline.replace("!", ""), body: `${t.body}\n\n(revised: ${notes.slice(0, 20)})` });
    process.env.PRESS_EMAIL = ""; process.env.PRESS_APP_PASSWORD = ""; process.env.PRESS_WIRE_EMAIL = "";
    // A clean lane: what an interrupted earlier run may have left (unmatched emails carry no release id).
    await pool.query("DELETE FROM press_messages WHERE message_id LIKE '%@wire.test>' OR message_id LIKE '<out-%@test>'");
    await pool.query("DELETE FROM press_inbox_state WHERE mailbox IN ('', 'press@test')");
    const o = await store.createOrder({ userId: OWNER, email: "owner@test", packageKey: "program_12", tier: "budget", credits: 14, amountCents: 1_168_800 });
    orderId = o.id;
  });
  afterAll(async () => {
    workerDeps.fetchSince = origFetch; workerDeps.sendMail = origSend; workerDeps.readWireReply = origRead; workerDeps.reviseRelease = origRevise;
    await pool.query("DELETE FROM press_messages WHERE release_id = ANY($1) OR message_id LIKE '%@wire.test>' OR message_id LIKE '<out-%@test>'", [releaseIds]);
    await pool.query("DELETE FROM press_releases WHERE id = ANY($1)", [releaseIds]);
    await pool.query("DELETE FROM press_orders WHERE id=$1", [orderId]);
    await pool.query("DELETE FROM press_inbox_state WHERE mailbox IN ('', 'press@test')");
    await pool.end();
  });
  beforeEach(() => { sent.length = 0; inbox = []; });

  it("credits: none until paid, 14 after; a release takes one, a cancel gives it back", async () => {
    expect((await store.creditsLeft(OWNER)).budget).toBe(0);
    expect(await store.markPaid(orderId, "cs_test_1")).toBe(true);
    expect(await store.markPaid(orderId, "cs_test_1")).toBe(false);
    expect((await store.creditsLeft(OWNER)).budget).toBe(14);
    const r = await store.createRelease(OWNER, "budget", input); releaseIds.push(r.id);
    expect(r.code).toMatch(/^CH-PR-[0-9A-F]{6}$/);
    expect(await store.spendCredit(r.id, OWNER, "budget")).toBe(true);
    expect((await store.creditsLeft(OWNER)).budget).toBe(13);
    expect(await store.spendCredit(r.id, OWNER, "premium")).toBe(false);
    await store.refundCredit(r.id);
    expect((await store.creditsLeft(OWNER)).budget).toBe(14);
    await store.updateRelease(r.id, { status: "cancelled" });
  });

  it("holds an approved release, visibly, until the mailbox and wire address exist; then sends it with its code", async () => {
    const r = await store.createRelease(OWNER, "budget", input); releaseIds.push(r.id);
    await store.spendCredit(r.id, OWNER, "budget");
    await store.updateRelease(r.id, { text, status: "ready" });
    expect(await submitReady()).toMatchObject({ sent: 0, held: 1 });
    expect((await store.getRelease(r.id))!.last_error).toMatch(/mailbox/);
    process.env.PRESS_EMAIL = "press@test"; process.env.PRESS_APP_PASSWORD = "x"; process.env.PRESS_WIRE_EMAIL = "editorial@wire.test";
    expect(await submitReady()).toMatchObject({ sent: 1, held: 0, failed: 0 });
    const after = (await store.getRelease(r.id))!;
    expect(after.status).toBe("submitted");
    expect(after.submitted_at).toBeTruthy();
    expect(sent[0].to).toBe("editorial@wire.test");
    expect(sent[0].subject).toContain(after.code);
    expect(sent[0].body).toContain("Vitest Roofing today announced");
    expect(submissionMail(after).body).toContain("Budget");
    const thread = await store.threadFor(r.id);
    expect(thread.filter((m) => m.direction === "out").length).toBe(1);
  });

  it("the wire's emails: live → the customer gets the link; changes → a revised draft to approve again; report → stored and emailed", async () => {
    const r = (await store.releasesInStatus("submitted")).find((x) => releaseIds.includes(x.id))!;
    const mail = (uid: number, subject: string, extra: Partial<Inbound> = {}): Inbound => ({ uid, messageId: `<in-${uid}@wire.test>`, threadKey: `t${uid}`, fromEmail: "editorial@wire.test", fromName: "Editorial", to: "press@test", subject, body: "Hello", references: [], date: new Date(), attachments: [], autoSubmitted: null, ...extra });
    inbox = [mail(1, `Re: CHANGES needed [${r.code}]`), mail(2, "Newsletter (no code)", { autoSubmitted: "auto-generated" }), mail(3, "Question about billing")];
    expect(await readInbox()).toMatchObject({ read: 3, unmatched: 1 });
    // The unmatched email was already put aside for a person when it was read; only the coded one is applied.
    expect(await applyReplies()).toMatchObject({ applied: 1, held: 0, failed: 0 });
    expect((await store.listMessages({ status: "needs_owner" })).some((m) => m.subject === "Question about billing")).toBe(true);
    let now = (await store.getRelease(r.id))!;
    expect(now.status).toBe("changes_requested");
    expect(now.wire_notes).toMatch(/exclamation/);
    expect(now.text!.body).toContain("revised");
    expect(sent.some((m) => m.to === "pat@vitest.example" && /asked for changes/.test(m.subject))).toBe(true);
    // The customer approves again: the credit is kept (order_id set), and it is sent again in the same thread.
    await store.updateRelease(r.id, { status: "ready" });
    expect(await submitReady()).toMatchObject({ sent: 1 });
    expect((await store.threadFor(r.id)).filter((m) => m.direction === "out" && m.to_email === "editorial@wire.test").length).toBe(2);
    expect((await store.creditsLeft(OWNER)).budget).toBe(13);
    sent.length = 0;
    inbox = [mail(4, `Your release is LIVE [${r.code}]`)];
    await readInbox(); await applyReplies();
    now = (await store.getRelease(r.id))!;
    expect(now.status).toBe("live");
    expect(now.live_url).toBe("https://www.example-wire.com/news/vitest-roofing");
    expect(sent[0]).toMatchObject({ to: "pat@vitest.example" });
    expect(sent[0].subject).toMatch(/live/);
    expect(sent[0].body).toContain("https://www.example-wire.com/news/vitest-roofing");
    sent.length = 0;
    inbox = [mail(5, `Distribution REPORT [${r.code}]`, { attachments: [{ name: "report.csv", url: "", contentType: "text/csv", size: 10, text: "outlet,url\nYahoo Finance,https://finance.yahoo.com/x" }] })];
    await readInbox(); await applyReplies();
    now = (await store.getRelease(r.id))!;
    expect(now.status).toBe("reported");
    expect(now.report).toMatchObject({ outlets: 312, views: 1480, clicks: 37 });
    expect(now.report!.pickups[0].outlet).toBe("Yahoo Finance");
    expect(sent[0].subject).toMatch(/report/);
    expect(sent[0].body).toContain("312");
    const state = await store.getState("press@test");
    expect(state.last_uid).toBe(5);
    const counts = await store.counts();
    expect(counts.messages.needs_owner).toBeGreaterThanOrEqual(1);
  });
});
