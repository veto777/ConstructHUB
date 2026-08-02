/**
 * Auto-backup (server/crm/backups.ts).
 *
 * Pure unit tests: CSV quoting (RFC 4180), SpreadsheetML 2003 structure
 * (well-formed XML, three sheets, money intact), and the due calculation
 * (weekly / every-2-weeks / never-run / disabled).
 *
 * Dev-server tests (need DEV_AUTH_BYPASS_USER1=true on :8119): the routes
 * are owner-only (an admin gets 403 on all three), and the honest end-to-end
 * path — enable backup → send-now → the email outbox holds the attachment
 * with parseable content (sendWithFallback sinks outside production, and the
 * sink records attachments base64 — see server/email.ts).
 */
// backups.ts pulls in tenancy → ../stripe, which throws without a key at
// module scope. A dummy value is enough for import (no Stripe calls here).
process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import { fileURLToPath } from "url";
import pg from "pg";
import type { BackupSection } from "./backups";

const {
  backupConfigOf, isBackupDue, csvCell, toCsv, toSpreadsheetXml,
  centsToDollars, buildAttachments,
} = await import("./backups");

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev",
});
const q = <T = any>(text: string, params: any[] = []) =>
  pool.query(text, params).then((r) => r.rows as T[]);

const OUTBOX =
  process.env.CRM_TEST_OUTBOX ??
  fileURLToPath(new URL("../../tmp/email-outbox.jsonl", import.meta.url));

type OutboxMail = {
  at: string; to: string[]; subject: string | null; text: string | null;
  attachments?: { filename: string | null; contentType: string | null; size: number; contentBase64: string | null }[];
};

function outbox(): OutboxMail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as OutboxMail; } catch { return null; } })
    .filter((m): m is OutboxMail => m !== null);
}

async function api(path: string, opts: RequestInit = {}, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body, cookie: setCookie?.split(";")[0] ?? cookie };
}

/** Minimal well-formedness check: every tag nests and closes (self-closing
 *  tags and <? … ?> declarations aside). No deps — a full parser would be one. */
function assertWellFormedXml(xml: string) {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^"'<>])*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = re.exec(xml))) {
    scanned++;
    const [, closing, name, , selfClose] = m;
    if (closing) {
      expect(stack.pop(), `closing </${name}> matches`).toBe(name);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  expect(scanned, "xml has tags").toBeGreaterThan(0);
  expect(stack, "all tags closed").toEqual([]);
  // No unescaped markup-significant chars may appear in character data.
  const textOnly = xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(re, "");
  expect(textOnly, "no unescaped angle brackets in text").not.toMatch(/[<>]/);
}

// ── Pure: CSV ─────────────────────────────────────────────────────────────────

describe("backup CSV quoting", () => {
  it("quotes commas, quotes, CR and LF; doubles internal quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(1234.56)).toBe("1234.56");
    // Numbers and plain strings are NOT over-quoted.
    expect(csvCell("Smith")).toBe("Smith");
  });

  it("toCsv emits CRLF rows with a header and a trailing newline", () => {
    const csv = toCsv(["id", "name"], [["1", "Acme, Inc"], ["2", 'Bob "B"']]);
    expect(csv).toBe('id,name\r\n1,"Acme, Inc"\r\n2,"Bob ""B"""\r\n');
  });
});

// ── Pure: SpreadsheetML ───────────────────────────────────────────────────────

describe("backup SpreadsheetML workbook", () => {
  const sections: BackupSection[] = [
    { name: "Clients", headers: ["id", "name", "note"], rows: [["c1", "A & B <Co>", 'He said "yo"']] },
    { name: "Estimates", headers: ["number", "total"], rows: [["E-1001", 1234.56], ["E-1002", 0]] },
    { name: "Invoices", headers: ["number", "total", "paid"], rows: [["I-2001", 999.99, 500]] },
  ];
  const xml = toSpreadsheetXml(sections);

  it("is well-formed XML with the Excel mso declaration", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    assertWellFormedXml(xml);
  });

  it("has exactly three worksheets in order", () => {
    const names = [...xml.matchAll(/<Worksheet ss:Name="([^"]+)">/g)].map((m) => m[1]);
    expect(names).toEqual(["Clients", "Estimates", "Invoices"]);
  });

  it("keeps money values intact as Number cells", () => {
    expect(xml).toContain('<Cell><Data ss:Type="Number">1234.56</Data></Cell>');
    expect(xml).toContain('<Cell><Data ss:Type="Number">999.99</Data></Cell>');
    expect(xml).toContain('<Cell><Data ss:Type="Number">0</Data></Cell>');
    // Cents → dollars is exact (integer cents / 100).
    expect(centsToDollars(123456)).toBe(1234.56);
    expect(centsToDollars(0)).toBe(0);
    expect(centsToDollars(null)).toBe(null);
    expect(centsToDollars(undefined)).toBe(null);
  });

  it("XML-escapes string values", () => {
    expect(xml).toContain("A &amp; B &lt;Co&gt;");
    expect(xml).toContain("He said &quot;yo&quot;");
    expect(xml).not.toContain("A & B");
  });

  it("buildAttachments: csv = three files, xlsx = one .xls workbook", () => {
    const csvFiles = buildAttachments(sections, "csv", "2026-08-02");
    expect(csvFiles.map((f) => f.filename)).toEqual([
      "clients-2026-08-02.csv", "estimates-2026-08-02.csv", "invoices-2026-08-02.csv",
    ]);
    expect(csvFiles.every((f) => f.contentType === "text/csv")).toBe(true);

    const xlsFiles = buildAttachments(sections, "xlsx", "2026-08-02");
    expect(xlsFiles.length).toBe(1);
    expect(xlsFiles[0].filename).toBe("constructhub-backup-2026-08-02.xls");
    expect(xlsFiles[0].content).toBe(xml);
  });
});

// ── Pure: due calculation ─────────────────────────────────────────────────────

describe("backup due calculation", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  const cfg = (over: Record<string, unknown>) =>
    backupConfigOf({ backup: { enabled: true, frequency: "weekly", format: "csv", ...over } });

  it("never-run is due; disabled is never due", () => {
    expect(isBackupDue(cfg({}), now)).toBe(true);
    expect(isBackupDue(cfg({ enabled: false }), now)).toBe(false);
    expect(isBackupDue(cfg({ enabled: false, lastSentAt: "2025-01-01T00:00:00Z" }), now)).toBe(false);
  });

  it("weekly: due after 7 days, not before", () => {
    expect(isBackupDue(cfg({ lastSentAt: "2026-08-02T05:00:00Z" }), now)).toBe(false);
    expect(isBackupDue(cfg({ lastSentAt: "2026-07-26T12:00:01Z" }), now)).toBe(false); // 1s short of 7d
    expect(isBackupDue(cfg({ lastSentAt: "2026-07-26T12:00:00Z" }), now)).toBe(true);  // exactly 7d — due (>=)
    expect(isBackupDue(cfg({ lastSentAt: "2026-07-20T12:00:00Z" }), now)).toBe(true);
  });

  it("biweekly: due after 14 days, not before", () => {
    const c = cfg({ frequency: "biweekly" });
    expect(isBackupDue({ ...c, lastSentAt: "2026-07-26T12:00:00Z" }, now)).toBe(false); // 7d ago
    expect(isBackupDue({ ...c, lastSentAt: "2026-07-19T11:59:59Z" }, now)).toBe(true);  // 14d+1s ago
  });

  it("a corrupt lastSentAt is treated as never-run", () => {
    expect(isBackupDue(cfg({ lastSentAt: "not-a-date" }), now)).toBe(true);
  });

  it("unknown frequency/format values fall back to weekly/csv", () => {
    const c = backupConfigOf({ backup: { enabled: true, frequency: "daily", format: "parquet" } });
    expect(c.frequency).toBe("weekly");
    expect(c.format).toBe("csv");
    expect(backupConfigOf(null).enabled).toBe(false);
    expect(backupConfigOf(undefined).lastSentAt).toBe(null);
  });
});

// ── Dev server: owner gates + the honest send path ────────────────────────────

describe("backup routes (dev server)", () => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const recipient = `vitest.backup.${stamp}@example.com`;
  const customerName = `Vitest Backup ${stamp}`;

  let cookie: string | undefined;
  let orgId: string;
  let priorBackup: unknown;
  let customerId: string | null = null;

  beforeAll(async () => {
    const me = await api("/api/crm/me");
    if (me.status !== 200) {
      throw new Error(`CRM dev server not reachable at ${BASE} (GET /api/crm/me → ${me.status}). Start it first.`);
    }
    cookie = me.cookie;
    orgId = me.body.org.id;
    priorBackup = (me.body.org.customFields as any)?.backup ?? null;

    // One fixture client (with an hcpId) so the export has a findable row.
    const cust = await api("/api/crm/customers", {
      method: "POST",
      body: JSON.stringify({ displayName: customerName, email: `vitest.backup.cust.${stamp}@example.com` }),
    }, cookie);
    expect(cust.status).toBe(201);
    customerId = cust.body.id;
    await q(`update crm_customers set custom_fields = $2 where id = $1`,
      [customerId, JSON.stringify({ hcpId: `HCP-${stamp}` })]);
  });

  afterAll(async () => {
    try {
      // Restore the org's backup config exactly as found.
      if (priorBackup === null) {
        await q(`update crm_orgs set custom_fields = coalesce(custom_fields, '{}'::jsonb) - 'backup' where id = $1`, [orgId]);
      } else {
        await q(`update crm_orgs set custom_fields = jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{backup}', $2::jsonb) where id = $1`,
          [orgId, JSON.stringify(priorBackup)]);
      }
      if (customerId) await q(`delete from crm_customers where id = $1`, [customerId]);
    } finally {
      await pool.end();
    }
  });

  it("admin gets 403 on all three backup routes (owner only), then owner is restored", async () => {
    await q(`update crm_members set role = 'admin' where org_id = $1 and user_id = 1`, [orgId]);
    try {
      const get = await api("/api/crm/backups/settings", {}, cookie);
      expect(get.status).toBe(403);
      const put = await api("/api/crm/backups/settings", {
        method: "PUT",
        body: JSON.stringify({ enabled: false, frequency: "weekly", format: "csv", email: recipient }),
      }, cookie);
      expect(put.status).toBe(403);
      const post = await api("/api/crm/backups/send-now", { method: "POST", body: "{}" }, cookie);
      expect(post.status).toBe(403);
    } finally {
      // ALWAYS restore — every other suite expects the dev user to be owner.
      await q(`update crm_members set role = 'owner' where org_id = $1 and user_id = 1`, [orgId]);
    }
    const ok = await api("/api/crm/backups/settings", {}, cookie);
    expect(ok.status).toBe(200);
  });

  it("enable → send-now → outbox holds the attachment with parseable content", async () => {
    const put = await api("/api/crm/backups/settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, frequency: "biweekly", format: "csv", email: recipient }),
    }, cookie);
    expect(put.status).toBe(200);
    expect(put.body.enabled).toBe(true);
    expect(put.body.frequency).toBe("biweekly");

    // The rest of custom_fields survived the save (merge, never clobber).
    const [cfRow] = await q<{ custom_fields: any }>(`select custom_fields from crm_orgs where id = $1`, [orgId]);
    expect(cfRow.custom_fields.backup.enabled).toBe(true);

    const since = new Date().toISOString();
    const send = await api("/api/crm/backups/send-now", { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    expect(send.body.ok).toBe(true);
    expect(send.body.recipient).toBe(recipient);
    expect(send.body.rows.clients).toBeGreaterThanOrEqual(1);
    expect(send.body.bytes).toBeGreaterThan(0);
    expect(send.body.files).toEqual(expect.arrayContaining([expect.stringMatching(/^clients-.*\.csv$/)]));

    // lastSentAt stamped on the org record.
    const [stamped] = await q<{ last: string | null }>(
      `select custom_fields->'backup'->>'lastSentAt' as last from crm_orgs where id = $1`, [orgId]);
    expect(stamped.last).toBeTruthy();

    // The outbox row: right recipient, three CSV attachments.
    const deadline = Date.now() + 8000;
    let mail: OutboxMail | undefined;
    while (Date.now() < deadline) {
      mail = outbox().find((m) =>
        m.at >= since && (m.to ?? []).includes(recipient) && (m.subject ?? "").includes("CRM backup"));
      if (mail) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(mail, "backup mail in outbox").toBeTruthy();
    const atts = mail!.attachments ?? [];
    expect(atts.length).toBe(3);
    const clientsCsv = atts.find((a) => a.filename?.startsWith("clients-"));
    expect(clientsCsv, "clients.csv attachment").toBeTruthy();

    // Parseable content: decode, split, and find the fixture row with hcpId.
    const text = Buffer.from(clientsCsv!.contentBase64!, "base64").toString("utf8");
    const lines = text.split("\r\n").filter(Boolean);
    const headers = lines[0].split(",");
    expect(headers).toContain("displayName");
    expect(headers).toContain("hcpId");
    const row = lines.find((l) => l.includes(customerName));
    expect(row, "fixture client in the export").toBeTruthy();
    expect(row!).toContain(`HCP-${stamp}`);
  });

  it("xlsx format sends one .xls workbook with three sheets", async () => {
    const put = await api("/api/crm/backups/settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, frequency: "weekly", format: "xlsx", email: recipient }),
    }, cookie);
    expect(put.status).toBe(200);

    const since = new Date().toISOString();
    const send = await api("/api/crm/backups/send-now", { method: "POST", body: "{}" }, cookie);
    expect(send.status).toBe(200);
    expect(send.body.files).toEqual([expect.stringMatching(/^constructhub-backup-.*\.xls$/)]);

    const deadline = Date.now() + 8000;
    let mail: OutboxMail | undefined;
    while (Date.now() < deadline) {
      mail = outbox().find((m) =>
        m.at >= since && (m.to ?? []).includes(recipient) && (m.subject ?? "").includes("CRM backup"));
      if (mail) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(mail, "xlsx backup mail in outbox").toBeTruthy();
    const atts = mail!.attachments ?? [];
    expect(atts.length).toBe(1);
    const xml = Buffer.from(atts[0].contentBase64!, "base64").toString("utf8");
    assertWellFormedXml(xml);
    const names = [...xml.matchAll(/<Worksheet ss:Name="([^"]+)">/g)].map((m) => m[1]);
    expect(names).toEqual(["Clients", "Estimates", "Invoices"]);
    expect(xml).toContain(customerName);
  });
});
