import { beforeEach, describe, expect, it, vi } from "vitest";
import { partnerGroup } from "@shared/media-inbox";
import { duplicateProblem, emailFingerprint, holdingReply, latestPerCompany, machineReason } from "./guard";

// The worker's database calls are replaced: these tests check what gets SENT (owner, 2026-10-25: no duplicates).
const db = vi.hoisted(() => ({
  pending: [] as any[],
  silent: [] as any[],
  recent: new Map<string, { at: Date; body: string }[]>(),
  emailedSince: new Set<number>(),
  folded: [] as { ids: number[]; replyId: number | null }[],
  finished: [] as { id: number; status: string; reason: string | null }[],
  followedUp: [] as number[],
  saved: 0,
}));
vi.mock("./store", () => ({
  pending: async () => db.pending,
  repliesToday: async () => 0,
  thread: async (_k: string | null, id: number) => db.pending.filter((m) => m.id === id).map((m) => ({ direction: "in", from: m.fromEmail, at: m.receivedAt, subject: m.subject, body: m.body })),
  upsertPartner: async () => ({ partner: { id: 7 }, newlyAgreed: false }),
  savePrices: async () => 0,
  recentOutboundTo: async (to: string) => db.recent.get(to.toLowerCase()) ?? [],
  saveOutbound: async () => ++db.saved,
  finishMessage: async (id: number, status: string, reason: string | null) => { db.finished.push({ id, status, reason }); },
  markFolded: async (ids: number[], replyId: number | null) => { db.folded.push({ ids, replyId }); },
  silentThreads: async () => db.silent,
  emailedPartnerSince: async (partnerId: number) => db.emailedSince.has(partnerId),
  markFollowedUp: async (id: number) => { db.followedUp.push(id); },
  optOut: async () => undefined,
  partnerIdForEmail: async () => null,
  addAgreedPartner: async () => undefined,
}));
vi.mock("../backlinks/store", () => ({ isSuppressed: async () => false }));

const { answerPending, followUpSilent, sendAutomatic, workerDeps, DuplicateSend } = await import("./worker");

const sent: { to: string; body: string }[] = [];
const decision = (reply: string) => ({
  relevant: true, noReplyNeeded: false, needsOwner: false, reply, ownerQuestion: null, summary: "", provider: "test", prices: [],
  company: null, kind: "news", stage: "talking", agreement: null, toFinalize: null, costTerms: null, apiTerms: null, minCommitment: null,
});
const inbound = (id: number, fromEmail: string, minutes: number, body = `email ${id}`) => ({
  id, body, partnerId: null, messageId: `<m${id}@x>`, threadKey: `t${id}`, fromEmail, fromName: "Ann Lee", cc: null,
  subject: "Re: Local contractor news", references: [], attempts: 0, receivedAt: new Date(Date.UTC(2026, 9, 18, 0, minutes)).toISOString(),
});

beforeEach(() => {
  Object.assign(db, { pending: [], silent: [], recent: new Map(), emailedSince: new Set(), folded: [], finished: [], followedUp: [], saved: 0 });
  sent.length = 0;
  workerDeps.sendMail = async (m: any) => { sent.push({ to: m.to, body: m.body }); return `<sent${sent.length}@constructhub.us>`; };
  workerDeps.decide = async () => decision("Hi Ann,\n\nThanks — could you send your submission guidelines?\n\nBest regards,") as any;
});

describe("machineReason — help-desk acknowledgements are never answered (MHFL Sentinel, 2026-10-17)", () => {
  const p = { fromEmail: "info@mhflsentinel.com" };
  it.each(["Thanks for your message", "Thank you for contacting us", "We have received your request", "Your request has been received", "Auto: away", "Automatic response"])(
    "%s is automatic and is read for a next step", (subject) => expect(machineReason({ ...p, subject })).toMatch(/^Automatic message/));
  it("a person's reply to our reply is not", () => expect(machineReason({ ...p, subject: "Re: Thanks for your message" })).toBeNull());
  it("X-Autoreply and Precedence: auto_reply are automatic", () => {
    expect(machineReason({ ...p, subject: "Re: hello", autoReply: "yes" })).toMatch(/^Automatic message/);
    expect(machineReason({ ...p, subject: "Re: hello", precedence: "auto_reply" })).toMatch(/^Automatic message/);
  });
});

describe("duplicateProblem — the same address is not emailed twice", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it("nothing recent: fine", () => expect(duplicateProblem("Hi,\n\nNew question", [], now)).toBeNull());
  it("an email in the last 30 minutes: wait", () => expect(duplicateProblem("Hi,\n\nNew question", [{ at: ago(5), body: "other" }], now)?.kind).toBe("soon"));
  it("the same words within 14 days: never, whatever the greeting", () => {
    const r = duplicateProblem(holdingReply("Jacob"), [{ at: ago(3 * 1440), body: holdingReply(null) }], now);
    expect(r?.kind).toBe("same");
  });
  it("the same words 15 days ago and nothing recent: fine", () => expect(duplicateProblem(holdingReply(null), [{ at: ago(15 * 1440), body: holdingReply(null) }], now)).toBeNull());
  it("fingerprints ignore the greeting, case and spacing", () => expect(emailFingerprint("Hi Ann,\n\nThank  you.")).toBe(emailFingerprint("Hello,\nthank you.")));
});

describe("latestPerCompany — one answer per company per pass", () => {
  it("groups by company record, then domain, then address; the latest is answered", () => {
    const g = latestPerCompany([
      { id: 1, partnerId: null, fromEmail: "editor@cfu.org" }, { id: 2, partnerId: null, fromEmail: "news@cfu.org" },
      { id: 3, partnerId: 9, fromEmail: "a@gmail.com" }, { id: 4, partnerId: 9, fromEmail: "b@other.com" },
      { id: 5, partnerId: null, fromEmail: "x@gmail.com" }, { id: 6, partnerId: null, fromEmail: "y@gmail.com" },
    ]);
    expect(g.map((x) => [x.answer.id, x.folded.map((f) => f.id)])).toEqual([[2, [1]], [4, [3]], [5, []], [6, []]]);
  });
});

describe("answerPending — three emails from one outlet get one answer (CFU, 2026-10-18)", () => {
  it("answers the latest and marks the earlier two answered by it", async () => {
    db.pending = [inbound(463, "editor@cfu.org", 0), inbound(465, "editor@cfu.org", 2), inbound(489, "editor@cfu.org", 6)];
    const r = await answerPending();
    expect(sent).toHaveLength(1);
    expect(r.replied).toBe(1);
    expect(db.finished.map((f) => f.id)).toEqual([489]);
    expect(db.folded).toEqual([{ ids: [463, 465], replyId: 1 }]);
  });
  it("a second identical holding reply is not sent: it waits for the owner", async () => {
    workerDeps.decide = async () => { throw new Error("model down"); };
    db.pending = [{ ...inbound(900, "jpotter@wlla.tv", 0), attempts: 2 }];
    db.recent.set("jpotter@wlla.tv", [{ at: new Date(Date.now() - 2 * 86_400_000), body: holdingReply("Jacob") }]);
    await answerPending();
    expect(sent).toHaveLength(0);
    expect(db.finished[0]).toMatchObject({ id: 900, status: "needs_owner" });
  });
  it("emailed them minutes ago: no reply this pass, the email stays waiting", async () => {
    db.pending = [inbound(901, "share@abc15.com", 0)];
    db.recent.set("share@abc15.com", [{ at: new Date(Date.now() - 4 * 60_000), body: "Hi,\n\nSomething else." }]);
    await answerPending();
    expect(sent).toHaveLength(0);
    expect(db.finished).toHaveLength(0);
  });
});

describe("followUpSilent — one follow-up per company, not one per thread (MHFL / GlobeNewswire, 2026-10-22)", () => {
  const thread = (lastId: number, partnerId: number, to: string) => ({
    lastId, threadKey: `t${lastId}`, to, cc: null, lastMessageId: `<l${lastId}@x>`, references: [], partnerId, company: "MHFL Sentinel",
    domain: "mhflsentinel.com", contactName: null, triedEmails: [to], followups: 0, firstSubject: "Local contractor news", firstBody: "Hi,\n\nOur first email.",
  });
  it("sends one and closes the company's other silent threads", async () => {
    db.silent = [thread(1126, 3, "info@mhflsentinel.com"), thread(1131, 3, "info@mhflsentinel.com"), thread(1138, 3, "info@mhflsentinel.com")];
    const r = await followUpSilent();
    expect(r.followedUp).toBe(1);
    expect(sent).toHaveLength(1);
    expect(db.followedUp.sort()).toEqual([1126, 1131, 1138]);
  });
  it("none while another thread with the company is fresh", async () => {
    db.silent = [thread(1175, 4, "support@globenewswire.com")];
    db.emailedSince.add(4);
    await followUpSilent();
    expect(sent).toHaveLength(0);
    expect(db.followedUp).toEqual([1175]);
  });
});

describe("sendAutomatic — the door for automatic email", () => {
  it("refuses a repeat with DuplicateSend", async () => {
    db.recent.set("a@b.com", [{ at: new Date(), body: "Hi,\n\nSame." }]);
    await expect(sendAutomatic({ to: "a@b.com", subject: "s", body: "Hello,\n\nSame." })).rejects.toBeInstanceOf(DuplicateSend);
    expect(sent).toHaveLength(0);
  });
});

describe("partnerGroup — how the Partnerships page files companies", () => {
  it.each([
    [{ kind: "news", domain: "accessnewswire.com", company: "ACCESS Newswire" }, "wire"],
    [{ kind: "news", domain: "einpresswire.com", company: "EIN Presswire" }, "wire"],
    [{ kind: "news", domain: "notified.com", company: "Notified" }, "wire"],
    [{ kind: "news", domain: "canyon-news.com", company: "Canyon News" }, "news"],
    [{ kind: "directory", domain: "locoldeal.com", company: "LocolDeal" }, "directory"],
    [{ kind: "pbn", domain: "x.com", company: "X" }, "article"],
    [{ kind: "other", domain: "momnt.com", company: "Momnt" }, "other"],
  ] as const)("%o → %s", (p, g) => expect(partnerGroup(p as any)).toBe(g));
});
