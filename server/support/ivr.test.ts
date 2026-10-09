import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { CLIPS, freshIvrState, ivrTurn, ticketClips, type IvrDeps } from "./ivr";
import type { Account } from "./line";

const ACCT: Account = { userId: 7, crmOrgId: null, email: "owner@example.com", phones: ["+15555550123"], ref: "12345678" };
function deps(over: Partial<IvrDeps> = {}) {
  const sent: { ch: string; acct: boolean }[] = [], tickets: (string | null)[] = [];
  let t = 1_000_000;
  const d: IvrDeps = {
    now: () => t,
    findAccount: async (ref) => (ref.value === "12345678" || ref.value === "CRM1234567" ? ACCT : null),
    sendCode: async (a, _r, ch) => { sent.push({ ch, acct: !!a }); return { allowed: true, hash: a ? "H:424242" : null }; },
    hashCode: (c) => `H:${c}`,
    openTicket: async (_s, _c, rec) => { tickets.push(rec); return { number: "T-00012" }; },
    ...over,
  };
  return { d, sent, tickets, tick: (ms: number) => { t += ms; } };
}
const go = async (d: IvrDeps, s = freshIvrState(), ...keys: string[]) => { let r; for (const k of keys) r = await ivrTurn(s, { digits: k }, "+1", d); return { s, r: r! }; };

describe("keypad line (overflow)", () => {
  it("happy path: number → text → code → payment → recording → ticket number read back", async () => {
    const { d, sent, tickets } = deps();
    const { s, r } = await go(d, undefined, "12345678", "1", "424242", "1");
    expect(r).toEqual({ play: ["record"], record: true, end: false }); expect(s.verified).toBe(true);
    expect(sent).toEqual([{ ch: "sms", acct: true }]);
    const done = await ivrTurn(s, { recording: { sid: "RE123456789", seconds: 20 } }, "+1", d);
    expect(done.end).toBe(true); expect(done.play).toEqual(["ticket_is", "t", "d0", "d0", "d0", "d1", "d2", "ticket_tail"]);
    expect(tickets).toEqual(["RE123456789"]);
  });
  it("7 digits is a CRM number", async () => { const { d } = deps(); const { s } = await go(d, undefined, "1234567"); expect(s.userId).toBe(7); });
  it("a made-up number hears exactly the same clips and nothing is sent to anyone", async () => {
    const a = deps(), b = deps();
    const ra = await go(a.d, undefined, "12345678", "2"), rb = await go(b.d, undefined, "87654321", "2");
    expect(rb.r).toEqual(ra.r); expect(b.sent).toEqual([{ ch: "email", acct: false }]);
    expect((await ivrTurn(rb.s, { digits: "424242" }, "+1", b.d)).play).toEqual(["bad_code"]);
  });
  it("star resends the other way; at most two codes", async () => {
    const { d, sent } = deps(); const { s } = await go(d, undefined, "12345678", "1");
    expect((await ivrTurn(s, { digits: "*" }, "+1", d)).play).toEqual(["sent_email"]);
    expect(await ivrTurn(s, { digits: "*" }, "+1", d)).toEqual({ play: ["send_refused"], end: true });
    expect(sent.map((x) => x.ch)).toEqual(["sms", "email"]);
  });
  it("three wrong codes end the call without a ticket", async () => {
    const { d, tickets } = deps(); const { s, r } = await go(d, undefined, "12345678", "2", "111111", "222222", "333333");
    expect(r).toEqual({ play: ["code_giveup"], end: true }); expect(s.verified).toBe(false);
    expect((await ivrTurn(s, { recording: { sid: "RE1234567890", seconds: 9 } }, "+1", d)).end).toBe(true); expect(tickets).toEqual([]);
  });
  it("can't skip verification by pressing ahead", async () => {
    const { d, tickets } = deps(); const s = freshIvrState(); s.step = "ivr_record";
    expect((await ivrTurn(s, { recording: { sid: "RE1234567890", seconds: 9 } }, "+1", d)).play).toEqual(["code_giveup"]); expect(tickets).toEqual([]);
  });
  it("only serious issues: 'anything else' and a non-blocking app problem don't open a ticket", async () => {
    const a = deps(); expect((await go(a.d, undefined, "12345678", "2", "424242", "5")).r.play).toEqual(["not_serious"]);
    const b = deps(); expect((await go(b.d, undefined, "12345678", "2", "424242", "3", "2")).r.play).toEqual(["not_serious"]);
    const c = deps(); expect((await go(c.d, undefined, "12345678", "2", "424242", "3", "1")).r.record).toBe(true);
  });
  it("an empty recording gets one retry, then the ticket opens without one", async () => {
    const { d, tickets } = deps(); const { s } = await go(d, undefined, "12345678", "2", "424242", "2");
    expect((await ivrTurn(s, { recording: null }, "+1", d)).play).toEqual(["record_again"]);
    expect((await ivrTurn(s, { recording: { sid: "RE1", seconds: 1 } }, "+1", d)).end).toBe(true); expect(tickets).toEqual([null]);
  });
  it("silence: prompt again, hang up after three", async () => {
    const { d } = deps(); const s = freshIvrState();
    expect((await ivrTurn(s, { silence: true }, "+1", d)).play[0]).toBe("still_there");
    await ivrTurn(s, { silence: true }, "+1", d);
    expect(await ivrTurn(s, { silence: true }, "+1", d)).toEqual({ play: ["silent_bye"], end: true });
  });
  it("ticket numbers become digit clips", () => { expect(ticketClips("T-00305")).toEqual(["t", "d0", "d0", "d3", "d0", "d5"]); });
  it("every clip has its recorded audio, and the clip text names the real support address", () => {
    const dir = path.join(import.meta.dirname, "..", "data", "support-audio");
    for (const id of Object.keys(CLIPS)) expect(fs.existsSync(path.join(dir, `${id}.mp3`)), id).toBe(true);
    for (const t of Object.values(CLIPS)) expect(t).not.toMatch(/dot com/);
  });
});
