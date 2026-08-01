/**
 * Migration center — the self-serve half of "bring your data with you".
 *
 * Contractors leaving Jobber / Leap / QuickBooks / Excel export CSVs; this
 * module wires the HTTP endpoints around the pure parsing/mapping code in
 * migrate-lib.ts: preview (parse + auto-map + validate, no writes) and import
 * (org-scoped writes with the SAME dedupe rule as customer create —
 * lower(email) or digit-normalized phone, ?force=1 to override). Money is
 * integer cents end to end.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { db } from "../db";
import {
  crmCustomers, crmEstimates, crmEstimateItems, crmInvoices, crmInvoiceItems,
} from "@shared/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { recalcEstimate } from "./entities";
import { sendWithFallback } from "../email";
import {
  MAX_CSV_BYTES, MAX_ROWS, MIGRATE_ENTITIES, MIGRATE_FIELDS,
  parseCsv, guessMapping, applyMapping, validateRecord,
  parseMoneyToCents, mapEstimateStatus, mapInvoiceStatus,
  type MigrateEntity,
} from "./migrate-lib";

type GetUser = (req: any, res: any) => any;

const token = () => randomBytes(24).toString("hex");

// ── Import execution ────────────────────────────────────────────────────────

interface RowOutcome {
  row: number; // 1-based data row number (header is row 0)
  status: "created" | "skipped" | "error";
  id?: string;
  message?: string;
}

/** The customer-create dedupe idiom, factored for reuse here. */
async function findCustomerDupe(orgId: string, email?: string | null, phone?: string | null) {
  const dupeOn = [
    email ? sql`lower(${crmCustomers.email}) = ${email.toLowerCase()}` : null,
    phone ? sql`regexp_replace(${crmCustomers.phone}, '[^0-9]', '', 'g') = ${phone.replace(/\D/g, "")}` : null,
  ].filter(Boolean) as any[];
  if (!dupeOn.length) return null;
  const [existing] = await db
    .select()
    .from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), isNull(crmCustomers.archivedAt), or(...dupeOn) as any))
    .limit(1);
  return existing ?? null;
}

async function importCustomerRow(
  ctx: OrgContext,
  rec: Record<string, string>,
  force: boolean,
): Promise<{ id: string } | { dupe: string }> {
  const email = rec.email || null;
  const phone = rec.phone || null;
  if (!force) {
    const dupe = await findCustomerDupe(ctx.org.id, email, phone);
    if (dupe) return { dupe: dupe.displayName };
  }
  const displayName =
    rec.displayName ||
    rec.companyName ||
    [rec.firstName, rec.lastName].filter(Boolean).join(" ").trim();
  const [row] = await db
    .insert(crmCustomers)
    .values({
      orgId: ctx.org.id,
      ownerMemberId: ctx.member.id,
      displayName,
      firstName: rec.firstName || null,
      lastName: rec.lastName || null,
      companyName: rec.companyName || null,
      email,
      phone,
      altPhone: rec.altPhone || null,
      addressLine1: rec.addressLine1 || null,
      city: rec.city || null,
      state: rec.state || null,
      postalCode: rec.postalCode || null,
      notes: rec.notes || null,
      portalToken: token(),
    } as any)
    .returning();
  return { id: row.id };
}

/** Attach an imported document to an existing customer: email first, then exact name. */
async function resolveCustomer(orgId: string, rec: Record<string, string>) {
  if (rec.customerEmail) {
    const [c] = await db
      .select()
      .from(crmCustomers)
      .where(
        and(
          eq(crmCustomers.orgId, orgId),
          isNull(crmCustomers.archivedAt),
          sql`lower(${crmCustomers.email}) = ${rec.customerEmail.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (c) return c;
  }
  if (rec.customerName) {
    const [c] = await db
      .select()
      .from(crmCustomers)
      .where(
        and(
          eq(crmCustomers.orgId, orgId),
          isNull(crmCustomers.archivedAt),
          sql`lower(${crmCustomers.displayName}) = ${rec.customerName.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (c) return c;
  }
  return null;
}

async function importEstimateRow(
  ctx: OrgContext,
  rec: Record<string, string>,
  seq: number,
): Promise<{ id: string } | { error: string }> {
  const cust = await resolveCustomer(ctx.org.id, rec);
  if (!cust) {
    return { error: `no client in your CRM matches "${rec.customerName || rec.customerEmail}" — import clients first` };
  }
  const totalCents = parseMoneyToCents(rec.total) ?? 0;
  const status = mapEstimateStatus(rec.status);
  const [est] = await db
    .insert(crmEstimates)
    .values({
      orgId: ctx.org.id,
      customerId: cust.id,
      number: rec.number || `E-${1000 + seq}`,
      title: rec.title || "Imported estimate",
      status,
      publicToken: token(),
      createdByMemberId: ctx.member.id,
      sentAt: status !== "draft" ? new Date() : null,
    } as any)
    .returning();
  if (totalCents > 0) {
    await db.insert(crmEstimateItems).values({
      orgId: ctx.org.id,
      estimateId: est.id,
      sortOrder: 0,
      kind: "labor",
      name: "Imported total",
      quantityMilli: 1000,
      unitPriceCents: totalCents,
      taxable: false,
    } as any);
    await recalcEstimate(ctx.org.id, est.id);
  }
  return { id: est.id };
}

async function importInvoiceRow(
  ctx: OrgContext,
  rec: Record<string, string>,
  seq: number,
): Promise<{ id: string } | { error: string }> {
  const cust = await resolveCustomer(ctx.org.id, rec);
  if (!cust) {
    return { error: `no client in your CRM matches "${rec.customerName || rec.customerEmail}" — import clients first` };
  }
  const totalCents = parseMoneyToCents(rec.total) ?? 0;
  let status = mapInvoiceStatus(rec.status);
  let paidCents = parseMoneyToCents(rec.paid) ?? 0;
  if (paidCents > 0 && totalCents > 0 && paidCents >= totalCents) status = "paid";
  if (status === "paid" && paidCents === 0) paidCents = totalCents;
  if (status === "draft" && paidCents > 0) status = paidCents >= totalCents && totalCents > 0 ? "paid" : "partial";

  const [inv] = await db
    .insert(crmInvoices)
    .values({
      orgId: ctx.org.id,
      customerId: cust.id,
      number: rec.number || `I-${1000 + seq}`,
      title: rec.title || "Imported invoice",
      status,
      subtotalCents: totalCents,
      totalCents,
      paidCents,
      publicToken: token(),
      sentAt: status !== "draft" ? new Date() : null,
      paidAt: status === "paid" ? new Date() : null,
    } as any)
    .returning();
  if (totalCents > 0) {
    await db.insert(crmInvoiceItems).values({
      orgId: ctx.org.id,
      invoiceId: inv.id,
      sortOrder: 0,
      kind: "labor",
      name: "Imported total",
      quantityMilli: 1000,
      unitPriceCents: totalCents,
      taxable: false,
    } as any);
  }
  return { id: inv.id };
}

// ── Request validation ──────────────────────────────────────────────────────

function cleanMapping(entity: MigrateEntity, raw: unknown): Record<string, string | null> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fields = new Set(MIGRATE_FIELDS[entity].map((f) => f.key));
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields.has(k)) continue;
    out[k] = v == null ? null : String(v).slice(0, 200);
  }
  return out;
}

const ASSISTED_SYSTEMS: Record<string, string> = {
  jobber: "Jobber",
  leap: "Leap",
  quickbooks: "QuickBooks Online",
  housecallpro: "Housecall Pro",
  other: "another system",
};

const ADMIN_EMAIL = "support@constructhub.us";

export function registerCrmMigrateRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /**
   * Parse + auto-map + validate, no writes. Returns every row so the client
   * can hand them straight back to /import with the (possibly edited) mapping.
   */
  app.post("/api/crm/migrate/preview", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;

    const entity = String(req.body?.entity || "") as MigrateEntity;
    if (!(MIGRATE_ENTITIES as readonly string[]).includes(entity)) {
      return res.status(400).json({ message: "entity must be one of: customers, estimates, invoices" });
    }
    const csv = String(req.body?.csv ?? "");
    if (!csv.trim()) return res.status(400).json({ message: "csv is empty" });
    if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
      return res.status(413).json({ message: "File is over the 2 MB limit. Split it, or use the assisted import below." });
    }

    const { headers, rows } = parseCsv(csv);
    if (!headers.length) return res.status(400).json({ message: "No header row found in that file" });
    if (rows.length > MAX_ROWS) {
      return res.status(413).json({ message: `${rows.length} rows is over the ${MAX_ROWS} row limit. Split the file, or use the assisted import below.` });
    }

    const mapping = guessMapping(entity, headers);
    const errors: { row: number; message: string }[] = [];
    rows.forEach((row, i) => {
      for (const message of validateRecord(entity, applyMapping(mapping, headers, row))) {
        errors.push({ row: i + 1, message });
      }
    });

    res.json({ entity, headers, mapping, totalRows: rows.length, rows, errors });
  });

  /**
   * The write path. Rows come back from the preview response, either as raw
   * cell arrays (with headers) or as header-keyed records; mapping is
   * field → header, exactly what the user saw (and maybe edited). Per-row
   * outcome: created | skipped (dedupe) | error. Nothing here is
   * all-or-nothing — a migration that dies on row 3,842 of 5,000 is how tools
   * lose people's trust.
   */
  app.post("/api/crm/migrate/import", async (req: any, res) => {
    const entity = String(req.body?.entity || "") as MigrateEntity;
    if (!(MIGRATE_ENTITIES as readonly string[]).includes(entity)) {
      return res.status(400).json({ message: "entity must be one of: customers, estimates, invoices" });
    }
    const perm = entity === "customers" ? "manageCustomers" : entity === "estimates" ? "manageEstimates" : "manageInvoices";
    const ctx = await ctxFor(req, res, perm);
    if (!ctx) return;

    const mapping = cleanMapping(entity, req.body?.mapping);
    if (!mapping) return res.status(400).json({ message: "mapping must be an object of field → header" });
    const rawRows = req.body?.rows;
    if (!Array.isArray(rawRows) || !rawRows.length) return res.status(400).json({ message: "rows must be a non-empty array" });
    if (rawRows.length > MAX_ROWS) {
      return res.status(413).json({ message: `Over the ${MAX_ROWS} row limit. Split the file, or use the assisted import.` });
    }

    const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : null;
    const force = req.query.force === "1";

    const results: RowOutcome[] = [];
    let created = 0;
    let skipped = 0;
    let seq = 0;
    if (entity !== "customers") {
      // Document numbering continues from the org's current count, as in
      // entities.ts — count once, then increment locally per created row.
      const table = entity === "estimates" ? crmEstimates : crmInvoices;
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.orgId, ctx.org.id));
      seq = n;
    }

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 1;
      try {
        let rec: Record<string, string>;
        if (headers) {
          // rows as raw cell arrays aligned with headers
          const cells = Array.isArray(rawRows[i]) ? rawRows[i].map(String) : null;
          if (!cells) {
            results.push({ row: rowNum, status: "error", message: "row is not an array of cells" });
            continue;
          }
          rec = applyMapping(mapping, headers, cells);
        } else {
          // rows as header-keyed records
          const obj = rawRows[i];
          if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            results.push({ row: rowNum, status: "error", message: "row is not an object keyed by header" });
            continue;
          }
          rec = {};
          for (const [field, header] of Object.entries(mapping)) {
            if (!header) continue;
            const v = (obj as Record<string, unknown>)[header];
            rec[field] = v == null ? "" : String(v).trim();
          }
        }

        const problems = validateRecord(entity, rec);
        if (problems.length) {
          results.push({ row: rowNum, status: "error", message: problems.join("; ") });
          continue;
        }

        if (entity === "customers") {
          const out = await importCustomerRow(ctx, rec, force);
          if ("dupe" in out) {
            skipped++;
            results.push({ row: rowNum, status: "skipped", message: `already exists as "${out.dupe}" (email or phone match)` });
          } else {
            created++;
            results.push({ row: rowNum, status: "created", id: out.id });
          }
        } else {
          seq++;
          const out = entity === "estimates"
            ? await importEstimateRow(ctx, rec, seq)
            : await importInvoiceRow(ctx, rec, seq);
          if ("error" in out) {
            seq--; // don't burn a number on a row that never imported
            results.push({ row: rowNum, status: "error", message: out.error });
          } else {
            created++;
            results.push({ row: rowNum, status: "created", id: out.id });
          }
        }
      } catch (e: any) {
        console.error(`[crm] migrate import row ${rowNum} failed:`, e?.message || e);
        results.push({ row: rowNum, status: "error", message: "unexpected error importing this row" });
      }
    }

    const errorCount = results.filter((r) => r.status === "error").length;
    res.json({
      created,
      skipped,
      errors: errorCount,
      results,
      hint: skipped && !force ? "Rows were skipped on an email/phone match. Re-run with ?force=1 to create them anyway." : undefined,
    });
  });

  /**
   * The assisted path — deliberately NOT fake automation. It emails the team
   * and tells the contractor a human will reach out.
   */
  app.post("/api/crm/migrate/assisted", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;

    const system = String(req.body?.system || "");
    const systemLabel = ASSISTED_SYSTEMS[system];
    if (!systemLabel) {
      return res.status(400).json({ message: "system must be one of: " + Object.keys(ASSISTED_SYSTEMS).join(", ") });
    }
    const note = String(req.body?.note ?? "").slice(0, 2000);

    try {
      await sendWithFallback({
        to: ADMIN_EMAIL,
        subject: `Migration assist requested: ${systemLabel} → ${ctx.org.name}`,
        html: `
          <p><strong>${ctx.org.name}</strong> (org ${ctx.org.id}) has asked for a hands-on migration
          from <strong>${systemLabel}</strong>.</p>
          <p>Requested by member ${ctx.member.id} (${ctx.member.email}).</p>
          ${note ? `<p>Their note:</p><blockquote>${note.replace(/</g, "&lt;")}</blockquote>` : ""}
          <p>Promised response window: within 1 business day.</p>
        `,
      });
    } catch (e: any) {
      console.error("[crm] assisted migration email failed:", e?.message || e);
      return res.status(502).json({
        message: `We couldn't send the request just now — email us directly at ${ADMIN_EMAIL} and mention ${systemLabel}.`,
      });
    }
    res.json({ ok: true, system: systemLabel });
  });
}
