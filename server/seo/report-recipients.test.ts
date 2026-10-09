/**
 * Who may get an account's SEO report emails — without a database or a mailer
 * (review S-3). The store is in memory; the mailer records what it was asked
 * to send.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ pool: { query: vi.fn(async () => { throw new Error("no database in this suite"); }) } }));
vi.mock("../entitlements", () => ({ getEntitlements: async () => { throw new Error("not used"); } }));
vi.mock("../growth-limits", () => ({ takeBudget: async () => true }));
vi.mock("../ops/issues", () => ({ recordIssue: async () => {} }));

import {
  brandLabel, BRAND_MAX, confirmationEmail, confirmRecipient, CONFIRM_LIMITS, ensureRecipients, isAgency, limitsFor, makeConfirmToken, MAX_CONFIRM_TRIES,
  parseConfirmToken, recipientDeps, recipientStatuses, refuseRecipient, reportFromAddress, reportSender, type RecipientRow, type RecipientStore,
} from "./report-recipients";

const T0 = new Date("2026-10-09T12:00:00Z"), DAY = 86_400_000;
const KEY = "test-secret-for-report-confirmations";
const ENT_STANDARD = { accessPlan: "pro", allowances: { seoKeywords: 50 } } as any;
const ENT_AGENCY = { accessPlan: "agency", allowances: { seoKeywords: 1000 } } as any;

/** An in-memory stand-in for the two tables, with the account's own addresses. */
function memoryStore(owned: Record<number, string[]> = {}) {
  const rows = new Map<string, RecipientRow & { userId: number }>();
  const blocks = new Set<string>(), optouts = new Set<string>();
  const k = (u: number, e: string) => `${u}|${e}`;
  const store: RecipientStore & { rows_: typeof rows; blocks: Set<string>; optouts: Set<string> } = {
    rows_: rows, blocks, optouts,
    async rows(userId, emails) { return emails.map((e) => rows.get(k(userId, e))).filter((r): r is RecipientRow & { userId: number } => !!r); },
    async ownedAddresses(userId) { return owned[userId] ?? []; },
    async distinctCount(userId) { return [...rows.values()].filter((r) => r.userId === userId && r.source === "customer").length; },
    async lastConfirmSentTo(email) { const at = [...rows.values()].filter((r) => r.email === email && r.confirmSentAt).map((r) => r.confirmSentAt!.getTime()); return at.length ? new Date(Math.max(...at)) : null; },
    async globallyBlocked(email) { return blocks.has(email); },
    async optedOut(userId, email) { return optouts.has(k(userId, email)); },
    async insertPending(userId, email) { if (!rows.has(k(userId, email))) rows.set(k(userId, email), { userId, email, status: "pending", source: "customer", nonce: null, confirmSentAt: null, confirmTries: 0 }); },
    async markConfirmationSent(userId, email, nonce, at) { const r = rows.get(k(userId, email))!; r.nonce = nonce; r.confirmSentAt = at; r.confirmTries++; },
    async setConfirmed(userId, email, source, _at) { const r = rows.get(k(userId, email)); if (r) { r.status = "confirmed"; r.source = source; } else rows.set(k(userId, email), { userId, email, status: "confirmed", source, nonce: null, confirmSentAt: null, confirmTries: 0 }); },
    async block(userId, email, _at) { const r = rows.get(k(userId, email)); if (r) { r.status = "blocked"; r.nonce = null; } else rows.set(k(userId, email), { userId, email, status: "blocked", source: "customer", nonce: null, confirmSentAt: null, confirmTries: 0 }); blocks.add(email); },
  };
  return store;
}

type Sent = { userId: number; key: string; to: string; subject: string; html: string; text: string; from?: string };
let sent: Sent[], issues: any[], budget: Record<string, number>, budgetLimit: Record<string, number>, now: Date, store: ReturnType<typeof memoryStore>;
const original = { ...recipientDeps };
const tokenOf = (userId: number, email: string) => {
  const m = sent.filter((s) => s.userId === userId && s.to === email).at(-1)!.text.match(/report-confirm\?t=([^\s]+)/)!;
  return decodeURIComponent(m[1]);
};

beforeEach(() => {
  sent = []; issues = []; budget = {}; budgetLimit = {}; now = T0; store = memoryStore({ 1: ["owner@acme.test", "crew@acme.test"] });
  recipientDeps.store = store;
  recipientDeps.now = () => now;
  recipientDeps.secret = () => KEY;
  recipientDeps.entitlements = async () => ENT_STANDARD;
  recipientDeps.recordIssue = async (i) => { issues.push(i); };
  recipientDeps.takeBudget = async (key, limit) => { budgetLimit[key] = limit; budget[key] = (budget[key] ?? 0) + 1; return budget[key] <= limit; };
  recipientDeps.sendEmail = async (userId, key, email) => { sent.push({ userId, key, to: email.to!, subject: email.subject, html: email.html, text: email.text!, from: email.from }); return true; };
});
afterEach(() => { Object.assign(recipientDeps, original); });

describe("the confirmation token", () => {
  it("round-trips, is bound to the account, address and nonce, and expires", () => {
    const nonce = "abcdefghijklmnopqrstuv";
    const t = makeConfirmToken(1, " Client@Theirs.com ", nonce, new Date(T0.getTime() + 7 * DAY), KEY)!;
    expect(parseConfirmToken(t, T0, KEY)).toEqual({ ok: true, claim: { userId: 1, email: "client@theirs.com", nonce } });
    expect(parseConfirmToken(t, new Date(T0.getTime() + 7 * DAY), KEY)).toEqual({ ok: false, reason: "expired" });
    expect(parseConfirmToken(t, T0, "another-key")).toEqual({ ok: false, reason: "invalid" });
    // A changed account or address does not verify; a mangled token is simply invalid.
    expect(parseConfirmToken(t.replace(/^1\./, "2."), T0, KEY)).toEqual({ ok: false, reason: "invalid" });
    expect(parseConfirmToken(t.slice(0, -2), T0, KEY)).toEqual({ ok: false, reason: "invalid" });
    expect(parseConfirmToken("", T0, KEY)).toEqual({ ok: false, reason: "invalid" });
    expect(parseConfirmToken(undefined, T0, KEY)).toEqual({ ok: false, reason: "invalid" });
  });
  it("cannot be made or read without a secret", () => {
    expect(makeConfirmToken(1, "a@b.co", "abcdefghijklmnopqrstuv", T0, "")).toBeNull();
    expect(parseConfirmToken("1.x.y.1.z", T0, "")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("adding recipients", () => {
  it("sends one confirmation to a new address and skips it until confirmed; confirming makes it a recipient", async () => {
    const r = await ensureRecipients(1, ["Client@Theirs.com"], { brand: "Acme Roofing" });
    expect(r.status).toEqual({ "client@theirs.com": "pending" });
    expect(r.confirmationsSent).toEqual(["client@theirs.com"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Confirm: SEO reports from Acme Roofing");
    expect(sent[0].text).toContain("/api/seo/report-confirm?t=");
    expect(sent[0].text).toContain("/api/seo/report-refuse?t=");
    expect(sent[0].text).not.toMatch(/\.pdf/i);
    // Asked again (the scheduler's next pass): still pending, and NOT mailed again inside the cooldown.
    const again = await ensureRecipients(1, ["client@theirs.com"]);
    expect(again.status["client@theirs.com"]).toBe("pending");
    expect(sent).toHaveLength(1);
    // The link confirms exactly this (account, address); a second click is harmless.
    const token = tokenOf(1, "client@theirs.com");
    expect(await confirmRecipient(token)).toBe("confirmed");
    expect(await confirmRecipient(token)).toBe("already");
    expect((await ensureRecipients(1, ["client@theirs.com"])).status["client@theirs.com"]).toBe("confirmed");
    expect(await recipientStatuses(1, ["client@theirs.com"])).toEqual([{ email: "client@theirs.com", status: "confirmed" }]);
  });
  it("a link for one account does not confirm the address for another, and an expired or used-up link does nothing", async () => {
    await ensureRecipients(1, ["client@theirs.com"]);
    const token = tokenOf(1, "client@theirs.com");
    // Another account adds the same address a week later (its own confirmation goes out): the first token still only speaks for account 1.
    now = new Date(T0.getTime() + 8 * DAY);
    await ensureRecipients(2, ["client@theirs.com"]);
    expect(await confirmRecipient(token)).toBe("expired");
    expect((await recipientStatuses(2, ["client@theirs.com"]))[0].status).toBe("pending");
    expect(await confirmRecipient(tokenOf(2, "client@theirs.com"))).toBe("confirmed");
    expect((await recipientStatuses(1, ["client@theirs.com"]))[0].status).toBe("pending");
  });
  it("confirms the account's own addresses on sight: the owner and verified team members", async () => {
    const r = await ensureRecipients(1, ["Owner@Acme.test", "crew@acme.test", "stranger@x.test"]);
    expect(r.status).toEqual({ "owner@acme.test": "confirmed", "crew@acme.test": "confirmed", "stranger@x.test": "pending" });
    expect(sent.map((s) => s.to)).toEqual(["stranger@x.test"]);
    // ... and only for that account: to account 2 the same owner address is a stranger.
    const other = await ensureRecipients(2, ["owner@acme.test"]);
    expect(other.status["owner@acme.test"]).toBe("pending");
  });
  it("'this wasn't me' blocks the address for that account and for every other account, with no further email", async () => {
    await ensureRecipients(1, ["victim@x.test"]);
    expect(await refuseRecipient(tokenOf(1, "victim@x.test"))).toBe("blocked");
    expect(await confirmRecipient(tokenOf(1, "victim@x.test"))).toBe("invalid");   // the link is used up
    expect((await ensureRecipients(1, ["victim@x.test"])).status["victim@x.test"]).toBe("blocked");
    const other = await ensureRecipients(2, ["victim@x.test"]);
    expect(other.status["victim@x.test"]).toBe("blocked");
    expect(sent).toHaveLength(1);
    expect(store.blocks.has("victim@x.test")).toBe(true);
    // The owner's own address stays theirs even if someone else's attempt was refused.
    store.blocks.add("owner@acme.test");
    expect((await ensureRecipients(1, ["owner@acme.test"])).status["owner@acme.test"]).toBe("confirmed");
  });
  it("an address that unsubscribed from this account's reports is blocked for it", async () => {
    store.optouts.add("1|gone@x.test");
    expect((await ensureRecipients(1, ["gone@x.test"])).status["gone@x.test"]).toBe("blocked");
    expect(sent).toHaveLength(0);
  });
  it("sends nothing when no secret can sign the link, and says so on the issue desk", async () => {
    recipientDeps.secret = () => "";
    const r = await ensureRecipients(1, ["client@theirs.com"]);
    expect(r.status["client@theirs.com"]).toBe("pending");
    expect(sent).toHaveLength(0);
    expect(issues.map((i) => i.key)).toEqual(["seo-report-confirm-no-secret"]);
  });
});

describe("limits", () => {
  it("per account: confirmation emails a day, more for Agency", async () => {
    const emails = Array.from({ length: 7 }, (_, i) => `c${i}@x.test`);
    const r = await ensureRecipients(1, emails);
    expect(r.confirmationsSent).toHaveLength(CONFIRM_LIMITS.standard.confirmationsPerDay);
    expect(r.pending).toHaveLength(7);                 // the rest are pending too — just not mailed yet
    expect(budgetLimit["seo:report-confirm:1"]).toBe(5);
    expect(issues.filter((i) => i.key === "seo-report-confirm-limit:confirmations-per-day:1")).toHaveLength(2);
    expect(issues[0].severity).toBe("warning");
    sent = []; budget = {};
    // Agency: a higher daily allowance (fresh addresses — the ones above are inside their per-recipient cooldown).
    const a = await ensureRecipients(3, emails.map((e) => `agency-${e}`), { ent: ENT_AGENCY });
    expect(a.confirmationsSent).toHaveLength(7);
    expect(budgetLimit["seo:report-confirm:3"]).toBe(CONFIRM_LIMITS.agency.confirmationsPerDay);
  });
  it("per account: distinct typed recipients in total (own addresses do not count); over it, not added", async () => {
    recipientDeps.takeBudget = async () => true;
    const many = Array.from({ length: 20 }, (_, i) => `r${i}@x.test`);
    const r = await ensureRecipients(1, [...many, "owner@acme.test"]);
    expect(r.limited).toEqual([]);
    const over = await ensureRecipients(1, ["r0@x.test", "one-more@x.test", "crew@acme.test"]);
    expect(over.status).toEqual({ "r0@x.test": "pending", "one-more@x.test": "limited", "crew@acme.test": "confirmed" });
    expect(issues.at(-1)).toMatchObject({ key: "seo-report-confirm-limit:distinct-recipients:1", detail: { limit: 20, email: "o***@x.test" } });
    expect(sent.find((s) => s.to === "one-more@x.test")).toBeUndefined();
    expect(limitsFor(ENT_AGENCY).distinctRecipients).toBe(100);
    expect(isAgency({ accessPlan: "pro", allowances: { seoKeywords: -1 } } as any)).toBe(true);
    expect(isAgency(null)).toBe(false);
  });
  it("per recipient: one confirmation email in 7 days, whoever asks; later, a reminder — but never more than a few", async () => {
    await ensureRecipients(1, ["shared@x.test"]);
    const r2 = await ensureRecipients(2, ["shared@x.test"]);
    expect(r2.status["shared@x.test"]).toBe("pending");
    expect(sent).toHaveLength(1);
    expect(issues.at(-1).key).toBe("seo-report-confirm-limit:recipient-cooldown:2");
    // A week on, account 2's pass sends its own; account 1's row is on its first try still, so the week after it may remind.
    now = new Date(T0.getTime() + 7 * DAY);
    expect((await ensureRecipients(2, ["shared@x.test"])).confirmationsSent).toEqual(["shared@x.test"]);
    now = new Date(T0.getTime() + 14 * DAY);
    expect((await ensureRecipients(1, ["shared@x.test"])).confirmationsSent).toEqual(["shared@x.test"]);
    // Account 1 never mails the address more than MAX_CONFIRM_TRIES times, however long it stays pending.
    for (let week = 3; week < 12; week++) { now = new Date(T0.getTime() + week * 7 * DAY); await ensureRecipients(1, ["shared@x.test"]); }
    expect(sent.filter((s) => s.userId === 1 && s.to === "shared@x.test")).toHaveLength(MAX_CONFIRM_TRIES);
  });
});

describe("the confirmation email", () => {
  it("carries only a short, escaped brand name — never the customer's markup — and leaves from the reports sender", () => {
    const evil = `<script>alert(1)</script>PayPal Security: your account is limited, see attached\n\nURGENT`.repeat(3);
    const label = brandLabel(evil);
    expect(label.length).toBeLessThanOrEqual(BRAND_MAX);
    expect(label).not.toMatch(/[\n\r\t]/);
    const m = confirmationEmail(evil, "Client@Theirs.com", "tok.en");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).not.toContain("see attached");          // cut by the length limit
    expect(m.to).toBe("client@theirs.com");
    expect(m.from).toBe('"ConstructHUB Reports" <reports@constructhub.us>');
    expect(m.text).toContain("Nothing is sent to you unless you confirm");
    expect(brandLabel("")).toBe("A ConstructHUB customer");
    expect(brandLabel("  Acme   Roofing \u0007 ")).toBe("Acme Roofing");
  });
  it("sender address is configurable and never the billing address", () => {
    expect(reportFromAddress({} as any)).toBe("reports@constructhub.us");
    expect(reportFromAddress({ SEO_REPORT_FROM: " no-reply@mail.constructhub.us " } as any)).toBe("no-reply@mail.constructhub.us");
    expect(reportSender({} as any)).not.toContain("billing@");
  });
});

describe("recipients saved before confirmations existed", () => {
  it("show as unconfirmed, and the next send mails them the confirmation instead of a report — except the account's own", async () => {
    // Production schedules hold addresses with no recipient row at all.
    const legacy = ["owner@acme.test", "client@theirs.com"];
    expect(await recipientStatuses(1, legacy)).toEqual([{ email: "owner@acme.test", status: "confirmed" }, { email: "client@theirs.com", status: "unconfirmed" }]);
    // The scheduler's pass: the owner is confirmed; the client is now pending and was sent the confirmation.
    const r = await ensureRecipients(1, legacy, { brand: "Acme Roofing" });
    expect(r.status).toEqual({ "owner@acme.test": "confirmed", "client@theirs.com": "pending" });
    expect(sent.map((s) => s.to)).toEqual(["client@theirs.com"]);
    expect(await recipientStatuses(1, legacy)).toEqual([{ email: "owner@acme.test", status: "confirmed" }, { email: "client@theirs.com", status: "pending" }]);
  });
});
