/**
 * The interleavings of an automatic send with an edit or a rewrite (review of press-auto, Kimi): the approval is one
 * transaction on the locked release row (approve.ts), every text/input write is guarded on an editable status
 * (store.updateEditable), a rewrite stops the schedule before the writer starts, and submitReady sends only the text
 * that was approved (approved_hash).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { pool } from "../db";
import { ensurePressSchema } from "./schema";
import * as store from "./store";
import { approveDeps, approveRelease } from "./approve";
import { draftDeps, writeDraft } from "./draft";
import { sendDeps, sendDue, sendOne } from "./send";
import { submitReady, workerDeps } from "./worker";
import type { PressReleaseInput, PressReleaseText } from "@shared/press";

const tag = `vr${Date.now().toString(36)}`;
const users: number[] = [];
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
const rewritten: PressReleaseText = { ...good, headline: "Ridgeline Roofing Starts a Repair Crew for Storm Damage" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function account(credits = 3): Promise<number> {
  const { rows: [u] } = await pool.query(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [`${tag}-${users.length}@press.test`]);
  users.push(u.id);
  const o = await store.createOrder({ userId: u.id, email: "x@press.test", packageKey: "program_12", tier: "budget", credits, amountCents: 1 });
  await store.markPaid(o.id, `cs_${tag}_${o.id}`);
  return u.id;
}
async function due(userId: number) {
  const r = await store.createRelease(userId, "budget", input);
  const withText = await store.updateRelease(r.id, { text: good });
  return store.updateRelease(r.id, { send_for_me: true, send_at: new Date(Date.now() - 60_000), send_hash: store.releaseHash(withText) });
}

const origAfterLock = approveDeps.afterLock, origRevise = draftDeps.reviseRelease, origDraft = draftDeps.draftRelease, origNotify = sendDeps.notify;
const origSendMail = workerDeps.sendMail, origWorkerNotify = workerDeps.notify;
const notes: string[] = [];
beforeAll(async () => {
  await ensurePressSchema(pool);
  sendDeps.notify = (async (_u: number, kind: string) => { notes.push(kind); return { inApp: true, email: "off" }; }) as any;
  workerDeps.notify = (async (_u: number, kind: string) => { notes.push(kind); return { inApp: true, email: "off" }; }) as any;
});
afterAll(async () => {
  approveDeps.afterLock = origAfterLock; draftDeps.reviseRelease = origRevise; draftDeps.draftRelease = origDraft; sendDeps.notify = origNotify;
  workerDeps.sendMail = origSendMail; workerDeps.notify = origWorkerNotify;
  await pool.query(`DELETE FROM press_messages WHERE release_id IN (SELECT id FROM press_releases WHERE user_id = ANY($1))`, [users]);
  await pool.query(`DELETE FROM press_releases WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM press_orders WHERE user_id = ANY($1)`, [users]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users]);
  await pool.end();
});
beforeEach(() => { approveDeps.afterLock = origAfterLock; notes.length = 0; });

describe("an automatic send racing an edit or a rewrite", () => {
  it("an edit that arrives after the claim waits for the approval and is refused; the approved text is what is ready", async () => {
    const u = await account();
    const r = await due(u);
    let edit: Promise<store.ReleaseRow | null> | null = null;
    approveDeps.afterLock = async (id) => {
      if (id !== r.id) return;
      edit = store.updateEditable(r.id, { text: rewritten }); // the customer's save, mid-approval
      await sleep(150); // it is now waiting on the row lock
    };
    expect(await sendOne(r.id, r.send_at!)).toMatchObject({ outcome: "sent" });
    expect(await edit).toBeNull(); // → 409 "This release was already approved"
    const after = (await store.getRelease(r.id))!;
    expect(after.status).toBe("ready");
    expect(after.text?.headline).toBe(good.headline);
    expect(after.approved_hash).toBe(store.releaseHash(after));
    expect(after.send_for_me).toBe(false);
  });

  it("an edit that lands first stops the send (the hash is checked on the locked row)", async () => {
    const u = await account();
    const r = await due(u);
    expect(await store.updateEditable(r.id, { text: rewritten })).not.toBeNull();
    expect(await sendOne(r.id, r.send_at!)).toMatchObject({ outcome: "edited" });
    const after = (await store.getRelease(r.id))!;
    expect(after).toMatchObject({ status: "draft", send_at: null, send_for_me: false, order_id: null });
    expect(notes).toEqual(["press.needs_fix"]);
  });

  it("a rewrite during a pass: the schedule stops before the writer starts, and the pass sends nothing", async () => {
    const u = await account();
    const r = await due(u);
    let release!: () => void;
    draftDeps.reviseRelease = async () => { await new Promise<void>((ok) => { release = ok; }); return { ...rewritten }; };
    // The rewrite route: stop the schedule first, then let the writer work.
    expect(await store.updateEditable(r.id, { send_at: null, send_for_me: false, send_note: "Rewritten" })).not.toBeNull();
    const writing = writeDraft((await store.getRelease(r.id))!, "Shorter");
    await sleep(50);
    expect((await sendDue()).some((x) => x.id === r.id)).toBe(false);
    expect(await sendOne(r.id, r.send_at!)).toMatchObject({ outcome: "lost_race" });
    release();
    const upd = await writing;
    expect(upd).toMatchObject({ status: "draft", order_id: null });
    expect(upd.text?.headline).toBe(rewritten.headline);
  });

  it("a rewrite that finishes after the release was approved is refused and keeps the approved text", async () => {
    const u = await account();
    const r = await store.updateRelease((await store.createRelease(u, "budget", input)).id, { text: good });
    let release!: () => void;
    draftDeps.reviseRelease = async () => { await new Promise<void>((ok) => { release = ok; }); return { ...rewritten }; };
    const writing = writeDraft(r, "Shorter").then(() => "written", (e) => e);
    await sleep(50);
    expect((await approveRelease(r.id, { userId: u, kick: false })).ok).toBe(true);
    release();
    expect(await writing).toBeInstanceOf(store.NotEditableError);
    const after = (await store.getRelease(r.id))!;
    expect(after.status).toBe("ready");
    expect(after.text?.headline).toBe(good.headline);
  });

  it("submitReady sends only the approved text; a changed one goes back to a draft with its credit kept", async () => {
    const u = await account();
    const env = { e: process.env.PRESS_EMAIL, p: process.env.PRESS_APP_PASSWORD, w: process.env.PRESS_WIRE_EMAIL };
    process.env.PRESS_EMAIL = "press@test"; process.env.PRESS_APP_PASSWORD = "x"; process.env.PRESS_WIRE_EMAIL = "editorial@wire.test";
    const sent: string[] = [];
    workerDeps.sendMail = async (m) => { sent.push(m.subject); return `<race-${sent.length}-${tag}@test>`; };
    try {
      const ok = await store.updateRelease((await store.createRelease(u, "budget", input)).id, { text: good });
      expect((await approveRelease(ok.id, { userId: u, kick: false })).ok).toBe(true);
      const changed = await store.updateRelease((await store.createRelease(u, "budget", input)).id, { text: good });
      expect((await approveRelease(changed.id, { userId: u, kick: false })).ok).toBe(true);
      // A stray write after approval (nothing in the app may do this; the submit check is the last line).
      await pool.query(`UPDATE press_releases SET text = jsonb_set(text, '{headline}', '"Changed After Approval"') WHERE id=$1`, [changed.id]);
      await submitReady();
      expect(sent.some((s) => s.includes(good.headline))).toBe(true);
      expect(sent.some((s) => s.includes("Changed After Approval"))).toBe(false);
      const back = (await store.getRelease(changed.id))!;
      expect(back.status).toBe("draft");
      expect(back.order_id).not.toBeNull(); // re-approving takes no new credit
      expect(back.last_error).toMatch(/changed after it was approved/);
      expect(notes).toContain("press.needs_fix");
      expect((await store.getRelease(ok.id))!.status).toBe("submitted");
    } finally {
      process.env.PRESS_EMAIL = env.e ?? ""; process.env.PRESS_APP_PASSWORD = env.p ?? ""; process.env.PRESS_WIRE_EMAIL = env.w ?? "";
    }
  });
});
