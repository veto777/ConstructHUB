/**
 * Transactional email (dedupe + sink) and Stripe event receipts, against the
 * local lane DB. EMAIL_FORCE_SINK keeps every send in tmp/email-outbox.jsonl.
 */
process.env.EMAIL_FORCE_SINK = "1";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../db";
import { ensureAccountSchema } from "./schema";
import { emailLayout, emailWasSent, escapeHtml, htmlToText, sendTransactionalEmail } from "./email";
import { attributeBillingEvent, recordBillingEvent, releaseBillingEvent } from "./billing-events";

const OUTBOX = path.join(process.cwd(), "tmp", "email-outbox.jsonl");
const outbox = () => (fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

const users: number[] = [], keys: string[] = [], events: string[] = [];
const dedupe = (s: string) => { const k = `ACCT-${s}-${randomUUID()}`; keys.push(k); return k; };

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Local lane development database required");
  await ensureAccountSchema();
  const { rows: [u] } = await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`acct-l1-email-${randomUUID()}@example.invalid`]);
  users.push(u.id);
});
afterAll(async () => {
  await pool.query("DELETE FROM email_log WHERE dedupe_key=ANY($1::text[])", [keys]);
  await pool.query("DELETE FROM billing_events WHERE stripe_event_id=ANY($1::text[])", [events]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
});

describe("emailLayout", () => {
  it("renders title, rows, button and footer in HTML and text, escaping everything", () => {
    const { html, text } = emailLayout({
      title: "Receipt <b>#1</b>", intro: "Thanks & welcome", preheader: "pre",
      rows: [["Amount", "$79.00"], ["Invoice", "INV-0001"], ["Skipped", null], ["Also skipped", ""], ["Count", 3]],
      cta: { label: "View invoice", url: "https://constructhub.us/settings?tab=billing&x=\"1\"" },
      footer: "Why: you're a customer",
    });
    expect(html).toContain("Receipt &lt;b&gt;#1&lt;/b&gt;");
    expect(html).not.toContain("<b>#1</b>");
    expect(html).toContain("Thanks &amp; welcome");
    expect(html).toContain("$79.00");
    expect(html).toContain("INV-0001");
    expect(html).not.toContain("Skipped");
    expect(html).toContain("&amp;x=&quot;1&quot;");
    expect(html).toContain("chub-logo-square-text.png");
    expect(text).toContain("Receipt <b>#1</b>");
    expect(text).toContain("Amount: $79.00");
    expect(text).toContain("Count: 3");
    expect(text).toContain("View invoice: https://constructhub.us/settings?tab=billing&x=\"1\"");
    expect(text).toContain("Why: you're a customer");
    expect(text).not.toContain("Skipped");
  });

  it("helpers escape and flatten", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    expect(htmlToText("<p>Hello&nbsp;<b>there</b></p><p>Line &amp; two<br>three</p>")).toBe("Hello there\nLine & two\nthree");
  });
});

describe("sendTransactionalEmail", () => {
  it("sends once per dedupe key through the sink, with a text twin", async () => {
    const uid = users[0], key = dedupe("receipt");
    const { html, text } = emailLayout({ title: "ACCT receipt", rows: [["Amount", "$29.00"]] });
    expect(await sendTransactionalEmail(uid, "receipt", key, { subject: `ACCT ${key}`, html, text })).toBe(true);
    expect(await sendTransactionalEmail(uid, "receipt", key, { subject: `ACCT ${key}`, html, text })).toBe(false);
    expect(await emailWasSent(key)).toBe(true);
    const sent = outbox().filter((m) => m.subject === `ACCT ${key}`);
    expect(sent).toHaveLength(1);
    const { rows: [u] } = await pool.query("SELECT email FROM users WHERE id=$1", [uid]);
    expect(sent[0].to).toEqual([u.email]);
    expect(sent[0].text).toContain("Amount: $29.00");
    expect(sent[0].html).toContain("ACCT receipt");
    const { rows: [log] } = await pool.query("SELECT user_id, kind FROM email_log WHERE dedupe_key=$1", [key]);
    expect(log).toEqual({ user_id: uid, kind: "receipt" });
  });

  it("honours an explicit recipient and derives the text twin when none is given", async () => {
    const key = dedupe("welcome");
    const { html } = emailLayout({ title: "ACCT welcome", rows: [["Plan", "Pro"]] });
    expect(await sendTransactionalEmail(users[0], "welcome", key, { subject: `ACCT ${key}`, html, to: "acct-l1-invitee@example.invalid" })).toBe(true);
    const sent = outbox().find((m) => m.subject === `ACCT ${key}`);
    expect(sent?.to).toEqual(["acct-l1-invitee@example.invalid"]);
    expect(sent?.text).toContain("ACCT welcome");
    expect(sent?.text).toContain("Plan Pro");
    expect(sent?.text).not.toMatch(/<[a-z]/);
  });

  it("releases the dedupe key when the send fails, so a retry can deliver", async () => {
    const key = dedupe("failed");
    await expect(sendTransactionalEmail(-1, "receipt", key, { subject: `ACCT ${key}`, html: "<p>x</p>" })).rejects.toThrow(/no email address/);
    expect(await emailWasSent(key)).toBe(false);
    expect(await sendTransactionalEmail(users[0], "receipt", key, { subject: `ACCT ${key}`, html: "<p>x</p>" })).toBe(true);
  });

  it("rejects a call without the dedupe key", async () => {
    await expect(sendTransactionalEmail(users[0], "receipt", "", { subject: "x", html: "x" })).rejects.toThrow(/required/);
  });
});

describe("recordBillingEvent", () => {
  it("claims an event once, can attribute it later and release it for a retry", async () => {
    const id = `evt_ACCT_${randomUUID()}`; events.push(id);
    expect(await recordBillingEvent({ id, type: "invoice.paid" })).toBe(true);
    expect(await recordBillingEvent({ id, type: "invoice.paid", userId: users[0] })).toBe(false);
    await attributeBillingEvent(id, users[0]);
    const { rows: [row] } = await pool.query("SELECT type, user_id, received_at FROM billing_events WHERE stripe_event_id=$1", [id]);
    expect(row.type).toBe("invoice.paid");
    expect(row.user_id).toBe(users[0]);
    expect(Math.abs(new Date(row.received_at).getTime() - Date.now())).toBeLessThan(60_000);
    await releaseBillingEvent(id);
    expect(await recordBillingEvent({ id, type: "invoice.paid", userId: users[0] })).toBe(true);
    await expect(recordBillingEvent({ id: "" })).rejects.toThrow(/event.id/);
  });
});
