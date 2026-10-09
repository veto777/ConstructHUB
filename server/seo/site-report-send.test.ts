/**
 * The send pass only mails addresses that stand confirmed (review S-3): a
 * pending, unconfirmed, blocked or over-limit address is skipped and counted,
 * never mailed the report. Mailer, report builder and recipient rules are
 * stand-ins; the delivery table is a tiny in-memory map.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ deliveries: new Map<string, { state: string; token: string }>() }));
vi.mock("../db", () => ({
  pool: {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      if (/FROM sitescan_branding/.test(q)) return { rows: [{ name: "Acme Roofing", logo: null }], rowCount: 1 };
      if (/SELECT company_name FROM users/.test(q)) return { rows: [{ company_name: "Acme" }], rowCount: 1 };
      if (/SELECT email FROM seo_report_optouts/.test(q)) return { rows: [], rowCount: 0 };
      if (/SELECT 1 FROM seo_report_optouts/.test(q)) return { rows: [], rowCount: 0 };
      if (/^INSERT INTO seo_report_deliveries/.test(q)) {
        const k = `${params[0]}|${params[1]}|${params[2]}`;
        if (db.deliveries.has(k)) return { rows: [], rowCount: 0 };
        db.deliveries.set(k, { state: "pending", token: params[3] });
        return { rows: [{ state: "pending" }], rowCount: 1 };
      }
      if (/^SELECT state FROM seo_report_deliveries/.test(q)) { const d = db.deliveries.get(`${params[0]}|${params[1]}|${params[2]}`); return { rows: d ? [d] : [], rowCount: d ? 1 : 0 }; }
      if (/^UPDATE seo_report_deliveries SET state='sent'/.test(q)) { const d = db.deliveries.get(`${params[0]}|${params[1]}|${params[2]}`); if (d && d.token === params[3]) d.state = "sent"; return { rows: [], rowCount: d ? 1 : 0 }; }
      return { rows: [], rowCount: 0 };
    }),
  },
}));
const mail = vi.hoisted(() => ({ sent: [] as { to: string; from?: string; subject: string; attachments: number }[] }));
vi.mock("../account/email", async (actual) => ({
  ...(await actual<typeof import("../account/email")>()),
  sendTransactionalEmail: vi.fn(async (_u: number, _kind: string, _key: string, email: any) => { mail.sent.push({ to: email.to, from: email.from, subject: email.subject, attachments: email.attachments?.length ?? 0 }); return true; }),
}));
vi.mock("../entitlements", () => ({ getEntitlements: async () => ({ allowances: { seoKeywords: 50 }, modules: { scheduledReports: true, whiteLabel: true } }) }));
vi.mock("./site-report", async (actual) => ({
  ...(await actual<typeof import("./site-report")>()),
  buildSiteReport: async () => ({ domain: "example.com", generatedAt: "2026-10-09T12:00:00Z", rankings: null, comparedWith: null, backlinks: null, audit: null, searchConsole: null, work: null, ai: null, visibility: null } as any),
  reportIsEmpty: () => false,
  reportHighlights: () => [["Keywords tracked", "12"]],
  renderReportPdf: async () => Buffer.from("%PDF-1.4 stub"),
}));
const standing = vi.hoisted(() => ({ status: {} as Record<string, string>, confirmationsSent: [] as string[], calls: [] as string[][] }));
vi.mock("./report-recipients", async (actual) => ({
  ...(await actual<typeof import("./report-recipients")>()),
  ensureRecipients: async (_u: number, emails: string[]) => {
    standing.calls.push(emails);
    const status = Object.fromEntries(emails.map((e) => [e.toLowerCase(), standing.status[e.toLowerCase()] ?? "pending"]));
    const by = (s: string) => Object.keys(status).filter((e) => status[e] === s);
    return { status, confirmed: by("confirmed"), pending: by("pending"), blocked: by("blocked"), limited: by("limited"), confirmationsSent: standing.confirmationsSent };
  },
}));

import { sendSiteReport } from "./site-report-send";

beforeEach(() => { db.deliveries.clear(); mail.sent.length = 0; standing.calls.length = 0; standing.status = {}; standing.confirmationsSent = []; });

describe("sendSiteReport and recipient standing", () => {
  it("mails only confirmed addresses; pending, legacy, blocked and over-limit ones are skipped and reported", async () => {
    standing.status = { "owner@acme.test": "confirmed", "client@theirs.com": "pending", "nope@x.test": "blocked", "extra@x.test": "limited" };
    standing.confirmationsSent = ["client@theirs.com"];
    const r = await sendSiteReport(1, 7, ["Owner@Acme.test", "client@theirs.com", "legacy@old.test", "nope@x.test", "extra@x.test"], "now-1");
    expect(standing.calls).toHaveLength(1);
    expect(mail.sent.map((m) => m.to)).toEqual(["owner@acme.test"]);
    expect(mail.sent[0].attachments).toBe(1);
    expect(r).toMatchObject({ sent: 1, skipped: 4, failed: 0, empty: false, pending: ["client@theirs.com", "legacy@old.test"], optedOut: ["nope@x.test"], limited: ["extra@x.test"], confirmationsSent: ["client@theirs.com"] });
  });
  it("the report leaves from the reports sender, not the billing address", async () => {
    standing.status = { "owner@acme.test": "confirmed" };
    await sendSiteReport(1, 7, ["owner@acme.test"], "now-2");
    expect(mail.sent[0].from).toBe('"ConstructHUB Reports" <reports@constructhub.us>');
    expect(mail.sent[0].from).not.toContain("billing@");
  });
  it("a pending address is never mailed the report, even on a retry of the same period", async () => {
    standing.status = { "client@theirs.com": "pending" };
    await sendSiteReport(1, 7, ["client@theirs.com"], "w2970");
    standing.status = { "client@theirs.com": "pending" };
    const r = await sendSiteReport(1, 7, ["client@theirs.com"], "w2970");
    expect(mail.sent).toHaveLength(0);
    expect(r.pending).toEqual(["client@theirs.com"]);
    expect(db.deliveries.size).toBe(0);     // nothing was even claimed for it
  });
});
