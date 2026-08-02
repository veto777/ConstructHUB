/**
 * Auto-backup: the owner gets their book of business by email, on a schedule.
 *
 * Three sections — clients, estimates, invoices — exported with NO new deps:
 *   - "csv"  → three plain attachments (clients.csv, estimates.csv,
 *              invoices.csv), RFC 4180 quoting written by hand.
 *   - "xlsx" → ONE SpreadsheetML 2003 XML workbook with three sheets, sent as
 *              .xls. Excel and Google Sheets both open it; the UI labels the
 *              format "Excel (.xls)" so nobody expects a real .xlsx binary.
 *
 * Settings live in crm_orgs.custom_fields->'backup' (merged, never a
 * wholesale replace — the HCP importer and other features share that jsonb).
 *
 * The scheduler is a setInterval registered on boot from
 * registerCrmBackupRoutes (which server/routes.ts calls once): the app runs
 * as a SINGLE instance, so an in-process timer is sufficient — a
 * multi-instance deploy would need a leader lock. It ticks every 15 minutes,
 * runs at most one backup per org at a time, and a failure never crashes the
 * app: it is logged and stamped onto the org record (backup.lastError),
 * which the Settings card surfaces.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { crmOrgs, crmCustomers, crmEstimates, crmInvoices, crmMembers } from "@shared/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireOrg, requireOwnerRole, type OrgContext } from "./tenancy";
import { sendWithFallback } from "../email";

type GetUser = (req: any, res: any) => any;

// ── Config (custom_fields->'backup') ─────────────────────────────────────────

export type BackupFrequency = "weekly" | "biweekly";
export type BackupFormat = "csv" | "xlsx";

export interface BackupConfig {
  enabled: boolean;
  frequency: BackupFrequency;
  format: BackupFormat;
  email: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export function backupConfigOf(customFields: unknown): BackupConfig {
  const b = ((customFields as Record<string, unknown> | null | undefined)?.backup ?? {}) as Record<string, unknown>;
  return {
    enabled: b.enabled === true,
    frequency: b.frequency === "biweekly" ? "biweekly" : "weekly",
    format: b.format === "xlsx" ? "xlsx" : "csv",
    email: typeof b.email === "string" ? b.email : null,
    lastSentAt: typeof b.lastSentAt === "string" ? b.lastSentAt : null,
    lastError: typeof b.lastError === "string" ? b.lastError : null,
    lastErrorAt: typeof b.lastErrorAt === "string" ? b.lastErrorAt : null,
  };
}

export const BACKUP_FREQUENCY_MS: Record<BackupFrequency, number> = {
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
};

/**
 * Due when enabled and (never sent) or (lastSentAt + frequency <= now).
 * A corrupt lastSentAt is treated as "never sent" — a backup is cheap, a
 * silently-dead schedule is not.
 */
export function isBackupDue(cfg: BackupConfig, now: Date = new Date()): boolean {
  if (!cfg.enabled) return false;
  if (!cfg.lastSentAt) return true;
  const last = Date.parse(cfg.lastSentAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= BACKUP_FREQUENCY_MS[cfg.frequency];
}

// ── CSV (RFC 4180, by hand) ───────────────────────────────────────────────────

export type CellValue = string | number | null;
export interface BackupSection {
  name: string;
  headers: string[];
  rows: CellValue[][];
}

export function csvCell(v: CellValue): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CellValue[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ── SpreadsheetML 2003 ("Excel" without a dependency) ────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlCell(v: CellValue): string {
  if (v === null || v === undefined) return `<Cell/>`;
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`;
}

export function toSpreadsheetXml(sections: BackupSection[]): string {
  const sheets = sections
    .map((s) => {
      const rows = [s.headers, ...s.rows]
        .map((r) => `      <Row>${r.map(xmlCell).join("")}</Row>`)
        .join("\n");
      return `  <Worksheet ss:Name="${xmlEscape(s.name)}">\n    <Table>\n${rows}\n    </Table>\n  </Worksheet>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n${sheets}\n</Workbook>\n`;
}

// ── Export builder ────────────────────────────────────────────────────────────

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
/** Integer cents → exact dollars (cents are integers, so /100 is 2dp-exact). */
export const centsToDollars = (c: number | null | undefined): number | null =>
  c === null || c === undefined ? null : c / 100;

export async function buildBackupSections(orgId: string): Promise<BackupSection[]> {
  const customers = await db
    .select()
    .from(crmCustomers)
    .where(eq(crmCustomers.orgId, orgId))
    .orderBy(asc(crmCustomers.createdAt));
  const estimates = await db
    .select()
    .from(crmEstimates)
    .where(eq(crmEstimates.orgId, orgId))
    .orderBy(asc(crmEstimates.createdAt));
  const invoices = await db
    .select()
    .from(crmInvoices)
    .where(eq(crmInvoices.orgId, orgId))
    .orderBy(asc(crmInvoices.createdAt));

  const customerName = new Map(customers.map((c) => [c.id, c.displayName]));

  const clientSection: BackupSection = {
    name: "Clients",
    headers: [
      "id", "displayName", "firstName", "lastName", "companyName", "email", "phone", "altPhone",
      "addressLine1", "addressLine2", "city", "state", "postalCode",
      "tags", "hcpId", "customFields", "notes", "archivedAt", "createdAt",
    ],
    rows: customers.map((c) => [
      c.id, c.displayName, c.firstName, c.lastName, c.companyName, c.email, c.phone, c.altPhone,
      c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode,
      (c.tags ?? []).join("; "),
      String((c.customFields as any)?.hcpId ?? "") || null,
      c.customFields ? JSON.stringify(c.customFields) : null,
      c.notes, iso(c.archivedAt), iso(c.createdAt),
    ]),
  };

  const estimateSection: BackupSection = {
    name: "Estimates",
    headers: [
      "id", "number", "title", "status", "customer",
      "subtotal", "discount", "tax", "total", "approvedTotal", "deposit",
      "sentAt", "sentToEmail", "approvedAt", "declinedAt", "expiresAt", "createdAt",
    ],
    rows: estimates.map((e) => [
      e.id, e.number, e.title, e.status, customerName.get(e.customerId) ?? null,
      centsToDollars(e.subtotalCents), centsToDollars(e.discountCents), centsToDollars(e.taxCents),
      centsToDollars(e.totalCents), centsToDollars(e.approvedTotalCents), centsToDollars(e.depositCents),
      iso(e.sentAt), e.sentToEmail, iso(e.approvedAt), iso(e.declinedAt), iso(e.expiresAt), iso(e.createdAt),
    ]),
  };

  const invoiceSection: BackupSection = {
    name: "Invoices",
    headers: [
      "id", "number", "title", "status", "customer",
      "subtotal", "discount", "tax", "total", "paid", "balanceDue",
      "dueAt", "sentAt", "paidAt", "voidedAt", "createdAt",
    ],
    rows: invoices.map((i) => [
      i.id, i.number, i.title, i.status, customerName.get(i.customerId) ?? null,
      centsToDollars(i.subtotalCents), centsToDollars(i.discountCents), centsToDollars(i.taxCents),
      centsToDollars(i.totalCents), centsToDollars(i.paidCents),
      centsToDollars(i.totalCents - i.paidCents),
      iso(i.dueAt), iso(i.sentAt), iso(i.paidAt), iso(i.voidedAt), iso(i.createdAt),
    ]),
  };

  return [clientSection, estimateSection, invoiceSection];
}

export interface BackupAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export function buildAttachments(sections: BackupSection[], format: BackupFormat, dateStamp: string): BackupAttachment[] {
  if (format === "xlsx") {
    return [{
      filename: `constructhub-backup-${dateStamp}.xls`,
      contentType: "application/vnd.ms-excel",
      content: toSpreadsheetXml(sections),
    }];
  }
  return sections.map((s) => ({
    filename: `${s.name.toLowerCase()}-${dateStamp}.csv`,
    contentType: "text/csv",
    content: toCsv(s.headers, s.rows),
  }));
}

export interface BackupStats {
  rows: { clients: number; estimates: number; invoices: number };
  bytes: number;
  format: BackupFormat;
  recipient: string;
  files: string[];
}

// ── Send ─────────────────────────────────────────────────────────────────────

type OrgRow = typeof crmOrgs.$inferSelect;

/** Recipient resolution: configured address → org email → the owner's seat. */
async function resolveRecipient(org: OrgRow, cfg: BackupConfig): Promise<string | null> {
  if (cfg.email) return cfg.email;
  if (org.email) return org.email;
  const [owner] = await db
    .select({ email: crmMembers.email })
    .from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.role, "owner"), eq(crmMembers.status, "active")))
    .orderBy(asc(crmMembers.createdAt))
    .limit(1);
  return owner?.email ?? null;
}

/** Generate the export and email it. Throws on failure — the caller stamps. */
export async function sendBackupForOrg(org: OrgRow, cfg: BackupConfig): Promise<BackupStats> {
  const recipient = await resolveRecipient(org, cfg);
  if (!recipient) throw new Error("No backup recipient — set an email in Settings → Auto-backup.");

  const sections = await buildBackupSections(org.id);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const attachments = buildAttachments(sections, cfg.format, dateStamp);
  const rows = {
    clients: sections[0].rows.length,
    estimates: sections[1].rows.length,
    invoices: sections[2].rows.length,
  };
  const bytes = attachments.reduce((n, a) => n + Buffer.byteLength(a.content, "utf8"), 0);

  await sendWithFallback({
    to: recipient,
    subject: `Your ConstructHub CRM backup — ${org.name} (${dateStamp})`,
    text:
      `Attached: your ${org.name} backup as of ${dateStamp}.\n\n` +
      `Clients: ${rows.clients}\nEstimates: ${rows.estimates}\nInvoices: ${rows.invoices}\n\n` +
      (cfg.format === "xlsx"
        ? `One Excel workbook (.xls) with three sheets: Clients, Estimates, Invoices.\n`
        : `Three CSV files: clients, estimates, invoices.\n`) +
      `\nManage auto-backup in Settings → Auto-backup.`,
    attachments,
  });

  return { rows, bytes, format: cfg.format, recipient, files: attachments.map((a) => a.filename) };
}

/** Merge a patch into custom_fields->'backup' — the rest of the jsonb is never touched. */
async function stampBackup(orgId: string, patch: Partial<BackupConfig>): Promise<void> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  if (!org) return;
  const customFields = { ...((org.customFields as Record<string, unknown> | null) ?? {}) };
  customFields.backup = { ...backupConfigOf(org.customFields), ...patch };
  await db.update(crmOrgs).set({ customFields, updatedAt: new Date() }).where(eq(crmOrgs.id, orgId));
}

// ── Scheduler (single-instance — see the module docstring) ───────────────────

export const BACKUP_SCHEDULER_TICK_MS = 15 * 60 * 1000;
/** Orgs with a backup in flight right now — caps concurrency at 1 per org. */
const running = new Set<string>();
let schedulerStarted = false;

export async function runDueBackups(now: Date = new Date()): Promise<void> {
  const orgs = await db
    .select()
    .from(crmOrgs)
    .where(sql`${crmOrgs.customFields} -> 'backup' ->> 'enabled' = 'true'`);
  for (const org of orgs) {
    const cfg = backupConfigOf(org.customFields);
    if (!isBackupDue(cfg, now)) continue;
    if (running.has(org.id)) continue;
    running.add(org.id);
    try {
      await sendBackupForOrg(org, cfg);
      await stampBackup(org.id, { lastSentAt: now.toISOString(), lastError: null, lastErrorAt: null });
      console.log(`[crm-backup] sent scheduled backup for org ${org.id} (${org.name})`);
    } catch (e: any) {
      // Never crash the app over a backup: log + stamp, the card surfaces it.
      console.error(`[crm-backup] org ${org.id} failed:`, e?.message || e);
      await stampBackup(org.id, {
        lastError: String(e?.message || e).slice(0, 500),
        lastErrorAt: now.toISOString(),
      }).catch(() => {});
    } finally {
      running.delete(org.id);
    }
  }
}

export function startBackupScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const timer = setInterval(() => {
    runDueBackups().catch((e) => console.error("[crm-backup] tick failed:", e?.message || e));
  }, BACKUP_SCHEDULER_TICK_MS);
  timer.unref();
}

// ── Routes (owner only, always — admins get 403) ─────────────────────────────

const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["weekly", "biweekly"]),
  format: z.enum(["csv", "xlsx"]),
  email: z.string().email().max(320),
});

export function registerCrmBackupRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    return requireOrg(req, res, user.id);
  }

  app.get("/api/crm/backups/settings", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    const cfg = backupConfigOf(ctx.org.customFields);
    res.json({
      ...cfg,
      // The form always shows a concrete address — the one a send would use.
      email: cfg.email ?? ctx.org.email ?? ctx.member.email,
    });
  });

  app.put("/api/crm/backups/settings", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    const parsed = backupSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid backup settings", issues: parsed.error.issues });

    // Merge — lastSentAt/lastError survive a settings save.
    await stampBackup(ctx.org.id, parsed.data);
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, ctx.org.id)).limit(1);
    res.json(backupConfigOf(org?.customFields));
  });

  app.post("/api/crm/backups/send-now", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    if (running.has(ctx.org.id)) {
      return res.status(409).json({ message: "A backup is already running for this organization" });
    }

    const cfg = backupConfigOf(ctx.org.customFields);
    running.add(ctx.org.id);
    try {
      const stats = await sendBackupForOrg(ctx.org, cfg);
      const sentAt = new Date().toISOString();
      await stampBackup(ctx.org.id, { lastSentAt: sentAt, lastError: null, lastErrorAt: null });
      res.json({ ok: true, sentAt, ...stats });
    } catch (e: any) {
      const message = String(e?.message || e).slice(0, 500);
      await stampBackup(ctx.org.id, { lastError: message, lastErrorAt: new Date().toISOString() }).catch(() => {});
      res.status(500).json({ message: `Backup failed: ${message}` });
    } finally {
      running.delete(ctx.org.id);
    }
  });

  // The scheduler boots with the routes — the app is a single instance, so
  // this interval is the only one (see the module docstring).
  startBackupScheduler();
}
