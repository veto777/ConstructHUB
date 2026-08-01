/**
 * Measurement report import — HOVER today, CladAI over the wire tomorrow.
 *
 * A contractor drags a HOVER PDF (or pastes the report text) onto
 * /crm/reports; we parse out the contact block and the roof measurements,
 * show a PREVIEW, and only on confirm create the crm_customers row (dedupe-
 * matched on email/phone, the same idiom as POST /api/crm/customers) plus a
 * crm_measurements row linked to it. The client's own portal then shows the
 * report next to their estimates and invoices.
 *
 * ⚠️ TOWER BOUNDARY (schema.ts crmMeasurements note): CladAI is a SEPARATE
 * project shared with outside devs. It must only ever reach us through the
 * webhook below — authenticated by an org API key, over HTTPS — never by
 * reading its files, database or code. The webhook is that door; nothing in
 * this file imports anything CladAI-side.
 *
 * No pdf npm dependency exists in this project, so PDF text extraction here
 * is deliberately minimal: inflate FlateDecode streams and pull the text-
 * showing operators (Tj/TJ). When that yields nothing useful (scanned PDFs,
 * exotic encodings) the answer is a 422 telling the user to paste the report
 * text — the paste box is the documented, always-works fallback.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { inflateSync } from "zlib";
import multer from "multer";
import { z } from "zod";
import { db } from "../db";
import { crmCustomers, crmMeasurements, crmProjects } from "@shared/schema";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { requireApiKey } from "./integrations";
import { requireClient } from "./client-auth";

type GetUser = (req: any, res: any) => any;

const token = () => randomBytes(24).toString("hex");
const MAX_BYTES = 25 * 1024 * 1024; // 25MB cap, upload or paste
// The source text rides inside raw_payload so the report can be re-downloaded
// without a filesystem; cap it well above any real report.
const SOURCE_TEXT_CAP = 400_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

// ── The parser ──────────────────────────────────────────────────────────────

export interface ParsedReportContact {
  name: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface ParsedReportMeasurements {
  squares: number | null;
  roofAreaSf: number | null;
  pitch: string | null; // "6/12"
  facetCount: number | null;
  wastePercent: number | null;
  ridgeLf: number | null;
  hipLf: number | null;
  valleyLf: number | null;
  eaveLf: number | null;
  rakeLf: number | null;
}

export interface ParsedReport {
  provider: "hover" | "other";
  contact: ParsedReportContact;
  measurements: ParsedReportMeasurements;
  warnings: string[];
}

const STREET_SUFFIX =
  "Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Circle|Cir|Boulevard|Blvd|Way|Terrace|Ter|Place|Pl|Trail|Trl|Highway|Hwy|Parkway|Pkwy|Loop|Run|Crossing|Xing";

function firstMatch(text: string, re: RegExp, group = 1): string | null {
  const m = re.exec(text);
  const v = m?.[group]?.trim();
  return v ? v : null;
}

function num(s: string | null): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Tolerant parser for HOVER-style report text, with a generic fallback that
 * takes the first email/phone/address-shaped strings it can find. Every field
 * is independently optional — a partial parse still previews fine, and the
 * warnings tell the user what to fill in by hand.
 */
export function parseMeasurementReport(raw: string): ParsedReport {
  const text = raw.replace(/\r\n?/g, "\n");
  const warnings: string[] = [];

  const looksHover =
    /hover/i.test(text.slice(0, 2000)) || /prepared\s+for/i.test(text);
  const provider: "hover" | "other" = looksHover ? "hover" : "other";

  // ── Contact block ───────────────────────────────────────────────────────
  // HOVER: "Prepared for" then the name (same line after a colon, or the next
  // non-empty line). Generic: Homeowner/Customer/Client labels.
  let name = firstMatch(text, /prepared\s+for[:\s]+([^\n,]+)/i);
  if (!name && /prepared\s+for/i.test(text)) {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => /prepared\s+for/i.test(l));
    name = lines.slice(at + 1).find((l) => l.trim().length > 2)?.trim() ?? null;
  }
  name =
    name ??
    firstMatch(text, /(?:homeowner|customer|client|property\s+owner|contact\s+name)\s*[:\-]\s*([^\n,]+)/i);

  const email = firstMatch(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const phone = firstMatch(text, /(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/);

  const addressLine1 = firstMatch(
    text,
    new RegExp(`^\\s*(\\d{1,6}\\s+[^\\n,]{2,60}?(?:${STREET_SUFFIX})\\.?(?:\\s+(?:Apt|Unit|Suite|Ste|#)\\s*\\w+)?)\\s*$`, "im"),
  );
  let city: string | null = null;
  let state: string | null = null;
  let postalCode: string | null = null;
  const csz = /([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/.exec(text);
  if (csz) {
    city = csz[1].trim();
    state = csz[2];
    postalCode = csz[3];
  }

  // ── Roof measurements ───────────────────────────────────────────────────
  const roofAreaSf =
    num(firstMatch(text, /total\s+roof\s+area\s*[:\-]?\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sf|ft²)/i)) ??
    num(firstMatch(text, /roof\s+area\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sf|ft²)/i)) ??
    num(firstMatch(text, /total\s+roof\s+area\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i));

  let squares = num(firstMatch(text, /(?:roof\s+)?squares\s*[:\-]?\s*([\d,]+(?:\.\d+)?)/i));
  if (squares === null && roofAreaSf !== null) squares = Math.round(roofAreaSf) / 100;

  let pitch = firstMatch(text, /predominant\s+pitch\s*[:\-]?\s*(\d{1,2}\s*\/\s*12)/i);
  pitch = (pitch ?? firstMatch(text, /(\d{1,2}\s*\/\s*12)/))?.replace(/\s+/g, "") ?? null;

  const facetCount =
    num(firstMatch(text, /(?:roof\s+)?facets?\s*[:\-]?\s*(\d+)/i)) ??
    num(firstMatch(text, /(\d+)\s+(?:roof\s+)?facets?/i));

  const wastePercent =
    num(firstMatch(text, /waste(?:\s+(?:factor|percentage|suggestion))?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/i)) ??
    num(firstMatch(text, /(\d+(?:\.\d+)?)\s*%\s*waste/i));

  const lf = (label: string) =>
    num(firstMatch(text, new RegExp(`${label}\\s*[:\\-]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:ft|lf|lineal)`, "i")));

  const contact: ParsedReportContact = { name, email, phone, addressLine1, city, state, postalCode };
  const measurements: ParsedReportMeasurements = {
    squares, roofAreaSf, pitch,
    facetCount: facetCount === null ? null : Math.round(facetCount),
    wastePercent,
    ridgeLf: lf("ridges?"),
    hipLf: lf("hips?"),
    valleyLf: lf("valleys?"),
    eaveLf: lf("eaves?"),
    rakeLf: lf("rakes?"),
  };

  if (!name && !email && !phone) warnings.push("No contact found — check the name, email and phone before confirming.");
  if (!addressLine1 && !city) warnings.push("No property address found.");
  if (squares === null && roofAreaSf === null) warnings.push("No roof measurements found.");

  return { provider, contact, measurements, warnings };
}

/** Anything at all worth previewing? An empty parse must not mint a draft row. */
export function parseHasContent(p: ParsedReport): boolean {
  const c = p.contact;
  const m = p.measurements;
  return Boolean(
    c.name || c.email || c.phone || c.addressLine1 || c.city ||
    m.squares !== null || m.roofAreaSf !== null || m.pitch || m.facetCount !== null,
  );
}

// ── Minimal PDF text extraction (no dependency) ─────────────────────────────

function pdfUnescape(s: string): string {
  return s.replace(/\\(n|r|t|\(|\)|\\|[0-7]{1,3})/g, (_m, esc) => {
    if (esc === "n") return "\n";
    if (esc === "r") return "\r";
    if (esc === "t") return "\t";
    if (/^[0-7]/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    return esc;
  });
}

/**
 * Pull text out of a PDF buffer the smallest honest way: inflate each
 * FlateDecode stream and collect the strings shown by Tj/TJ operators.
 * Returns "" when the PDF doesn't cooperate — the caller turns that into a
 * 422 pointing at the paste box.
 */
export function extractPdfText(buf: Buffer): string {
  const src = buf.toString("latin1");
  const out: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(src))) {
    let data: Buffer;
    try {
      data = inflateSync(Buffer.from(m[1], "latin1"));
    } catch {
      continue; // not a flate stream (images, xref) — skip
    }
    const s = data.toString("latin1");
    for (const tm of s.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)) out.push(pdfUnescape(tm[1]));
    for (const am of s.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const parts = [...am[1].matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((p) => pdfUnescape(p[1]));
      if (parts.length) out.push(parts.join(""));
    }
  }
  return out.join("\n").replace(/[ \t]+/g, " ").trim();
}

// ── Shared: dedupe-match or create the customer ─────────────────────────────

const digits = (s: string) => s.replace(/\D/g, "");

async function matchCustomer(orgId: string, email?: string | null, phone?: string | null) {
  const conds = [
    email ? sql`lower(${crmCustomers.email}) = ${email.toLowerCase()}` : null,
    phone && digits(phone).length >= 7
      ? sql`regexp_replace(${crmCustomers.phone}, '[^0-9]', '', 'g') = ${digits(phone)}`
      : null,
  ].filter(Boolean) as any[];
  if (!conds.length) return null;
  const [existing] = await db
    .select()
    .from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), isNull(crmCustomers.archivedAt), or(...conds) as any))
    .limit(1);
  return existing ?? null;
}

async function createCustomer(
  orgId: string,
  ownerMemberId: string | null,
  c: ParsedReportContact & { companyName?: string | null },
) {
  const displayName =
    c.name?.trim() || c.email || c.phone || "Measurement report import";
  const nameParts = c.name?.trim().split(/\s+/) ?? [];
  const [row] = await db
    .insert(crmCustomers)
    .values({
      orgId,
      displayName,
      firstName: nameParts.length > 1 ? nameParts[0] : null,
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(" ") : null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      addressLine1: c.addressLine1 ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      postalCode: c.postalCode ?? null,
      ownerMemberId,
      portalToken: token(),
      notes: "Created from an imported measurement report.",
    } as any)
    .returning();
  return row;
}

/** Human units from the parser/webhook → the milli columns the schema stores. */
const milli = (v?: number | null) => (v === null || v === undefined ? null : Math.round(v * 1000));

function measurementColumns(m: ParsedReportMeasurements) {
  return {
    squaresMilli: milli(m.squares),
    roofAreaSfMilli: milli(m.roofAreaSf),
    predominantPitch: m.pitch ?? null,
    facetCount: m.facetCount ?? null,
    wasteSuggestionBps: m.wastePercent === null ? null : Math.round(m.wastePercent * 100),
    ridgeLfMilli: milli(m.ridgeLf),
    hipLfMilli: milli(m.hipLf),
    valleyLfMilli: milli(m.valleyLf),
    eaveLfMilli: milli(m.eaveLf),
    rakeLfMilli: milli(m.rakeLf),
  };
}

/** One summary shape for list endpoints and the client portal. */
function presentReport(r: typeof crmMeasurements.$inferSelect, downloadBase: string) {
  const raw = (r.rawPayload ?? {}) as any;
  const hasSource = typeof raw.sourceText === "string" && raw.sourceText.length > 0;
  return {
    id: r.id,
    provider: r.provider,
    status: r.status,
    date: r.completedAt ?? r.createdAt,
    customerId: r.customerId,
    projectId: r.projectId,
    fileName: raw.fileName ?? null,
    contact: raw.parsed?.contact ?? null,
    addressLine1: r.addressLine1,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    squares: r.squaresMilli === null ? null : r.squaresMilli / 1000,
    roofAreaSf: r.roofAreaSfMilli === null ? null : r.roofAreaSfMilli / 1000,
    pitch: r.predominantPitch,
    facetCount: r.facetCount,
    wastePercent: r.wasteSuggestionBps === null ? null : r.wasteSuggestionBps / 100,
    downloadUrl: hasSource ? `${downloadBase}/${r.id}/download` : null,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerCrmReportRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any) {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /**
   * Upload + parse. Three ways in, all capped at 25MB:
   *   - multipart file field "file" (PDF or plain text)
   *   - JSON { text } — the paste box, always works
   *   - JSON { fileName, base64 } — a file the client already holds
   * Creates a DRAFT crm_measurements row and returns the parse for preview.
   * Nothing touches crm_customers until /confirm.
   */
  const uploadHandler = async (req: any, res: any) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;

    let text = "";
    let fileName: string | null = null;

    if (req.file) {
      fileName = String(req.file.originalname || "report").slice(0, 200);
      const isPdf =
        req.file.mimetype === "application/pdf" || /\.pdf$/i.test(fileName);
      text = isPdf ? extractPdfText(req.file.buffer) : req.file.buffer.toString("utf8");
      if (isPdf && text.length < 40) {
        return res.status(422).json({
          message:
            "Couldn't extract text from that PDF (it may be scanned). Open the report, copy the text, and paste it here instead.",
        });
      }
    } else if (typeof req.body?.base64 === "string") {
      fileName = String(req.body.fileName || "report").slice(0, 200);
      // ~4/3 expansion: check the decoded size against the same 25MB cap.
      if (req.body.base64.length > MAX_BYTES * 1.4) {
        return res.status(413).json({ message: "Report is over the 25MB limit." });
      }
      const buf = Buffer.from(req.body.base64, "base64");
      if (buf.length > MAX_BYTES) {
        return res.status(413).json({ message: "Report is over the 25MB limit." });
      }
      const isPdf = /\.pdf$/i.test(fileName);
      text = isPdf ? extractPdfText(buf) : buf.toString("utf8");
      if (isPdf && text.length < 40) {
        return res.status(422).json({
          message:
            "Couldn't extract text from that PDF (it may be scanned). Open the report, copy the text, and paste it here instead.",
        });
      }
    } else if (typeof req.body?.text === "string") {
      if (Buffer.byteLength(req.body.text, "utf8") > MAX_BYTES) {
        return res.status(413).json({ message: "Report is over the 25MB limit." });
      }
      fileName = req.body.fileName ? String(req.body.fileName).slice(0, 200) : null;
      text = req.body.text;
    } else {
      return res.status(400).json({ message: "Attach a report file or paste the report text." });
    }

    if (!text.trim()) return res.status(400).json({ message: "The report is empty." });

    const parsed = parseMeasurementReport(text);
    if (!parseHasContent(parsed)) {
      return res.status(422).json({
        message:
          "No contact or measurements found in that text. Paste the full report — including the property address and measurements page.",
      });
    }

    const [row] = await db
      .insert(crmMeasurements)
      .values({
        orgId: ctx.org.id,
        provider: parsed.provider,
        status: "draft", // becomes "ready" on confirm
        addressLine1: parsed.contact.addressLine1,
        city: parsed.contact.city,
        state: parsed.contact.state,
        postalCode: parsed.contact.postalCode,
        ...measurementColumns(parsed.measurements),
        rawPayload: {
          importSource: "report-upload",
          fileName,
          sourceText: text.slice(0, SOURCE_TEXT_CAP),
          parsed,
        },
        requestedByMemberId: ctx.member.id,
        requestedAt: new Date(),
      } as any)
      .returning();

    res.status(201).json({ id: row.id, parsed });
  };
  app.post("/api/crm/reports/upload", (req: any, res: any, next: any) => {
    if (req.is("multipart/form-data")) {
      upload.single("file")(req, res, (err: any) => {
        if (err) {
          return res
            .status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400)
            .json({ message: err.code === "LIMIT_FILE_SIZE" ? "Report is over the 25MB limit." : "Upload failed." });
        }
        void uploadHandler(req, res);
      });
      return;
    }
    void uploadHandler(req, res);
  });

  /**
   * Confirm the preview: dedupe-match (email/phone) or create the customer,
   * then flip the draft measurement to ready and link it. Optionally attach a
   * project. Passing customerId pins an existing client explicitly.
   */
  app.post("/api/crm/reports/:id/confirm", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;

    const [report] = await db
      .select()
      .from(crmMeasurements)
      .where(and(eq(crmMeasurements.id, req.params.id), eq(crmMeasurements.orgId, ctx.org.id)))
      .limit(1);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.status !== "draft") {
      return res.status(409).json({ message: "That report was already confirmed.", customerId: report.customerId });
    }

    const parsed = ((report.rawPayload as any)?.parsed ?? { contact: {} }) as ParsedReport;
    const body = req.body ?? {};

    let customer: typeof crmCustomers.$inferSelect | null = null;
    let created = false;

    if (body.customerId) {
      const [c] = await db
        .select()
        .from(crmCustomers)
        .where(and(eq(crmCustomers.id, String(body.customerId)), eq(crmCustomers.orgId, ctx.org.id)))
        .limit(1);
      if (!c) return res.status(400).json({ message: "Customer not found in this organization" });
      customer = c;
    } else {
      customer = await matchCustomer(ctx.org.id, parsed.contact.email, parsed.contact.phone);
      if (!customer) {
        customer = await createCustomer(ctx.org.id, ctx.member.id, parsed.contact);
        created = true;
      }
    }

    let projectId: string | null = null;
    if (body.projectId) {
      const [p] = await db
        .select()
        .from(crmProjects)
        .where(and(eq(crmProjects.id, String(body.projectId)), eq(crmProjects.orgId, ctx.org.id)))
        .limit(1);
      if (!p) return res.status(400).json({ message: "Project not found in this organization" });
      projectId = p.id;
    }

    const [row] = await db
      .update(crmMeasurements)
      .set({
        customerId: customer.id,
        projectId,
        status: "ready",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(crmMeasurements.id, report.id))
      .returning();

    res.status(created ? 201 : 200).json({
      created,
      customer: { ...customer, portalToken: undefined },
      report: presentReport(row, "/api/crm/reports"),
    });
  });

  /** Past imports — drafts awaiting confirm and ready reports alike. */
  app.get("/api/crm/reports", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db
      .select()
      .from(crmMeasurements)
      .where(
        and(
          eq(crmMeasurements.orgId, ctx.org.id),
          sql`${crmMeasurements.rawPayload} ->> 'importSource' is not null`,
        ),
      )
      .orderBy(desc(crmMeasurements.createdAt))
      .limit(500);
    // A report outlives its customer (clients can be deleted) — never link to
    // a customer row that isn't there.
    const ids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
    const live = new Set<string>();
    if (ids.length) {
      const custs = await db
        .select({ id: crmCustomers.id })
        .from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), inArray(crmCustomers.id, ids)));
      for (const c of custs) live.add(c.id);
    }
    res.json(
      rows.map((r) => ({
        ...presentReport(r, "/api/crm/reports"),
        customerId: r.customerId && live.has(r.customerId) ? r.customerId : null,
      })),
    );
  });

  /** Re-download the stored report text (the "file reference"). */
  app.get("/api/crm/reports/:id/download", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [row] = await db
      .select()
      .from(crmMeasurements)
      .where(and(eq(crmMeasurements.id, req.params.id), eq(crmMeasurements.orgId, ctx.org.id)))
      .limit(1);
    const raw = (row?.rawPayload ?? {}) as any;
    if (!row || typeof raw.sourceText !== "string" || !raw.sourceText) {
      return res.status(404).json({ message: "No stored report file" });
    }
    const name = String(raw.fileName || `report-${row.id}.txt`).replace(/[^\w.\-]+/g, "_");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/\.pdf$/i, "")}.txt"`);
    res.send(raw.sourceText);
  });

  /**
   * CladAI (or any future measurement provider) pushes a finished measurement
   * here — org API key, the same auth as /api/v1. Confirm-free: the provider
   * is trusted, so the customer is matched/created and the measurement lands
   * ready in one shot. Idempotent on externalId so a retried delivery never
   * duplicates.
   */
  const webhookSchema = z.object({
    externalId: z.string().max(120).optional(),
    provider: z.string().max(40).default("cladai"),
    reportUrl: z.string().max(1000).nullable().optional(),
    projectId: z.string().max(64).nullable().optional(),
    customer: z
      .object({
        name: z.string().max(200).nullable().optional(),
        email: z.string().email().max(320).nullable().optional(),
        phone: z.string().max(40).nullable().optional(),
        addressLine1: z.string().max(200).nullable().optional(),
        city: z.string().max(120).nullable().optional(),
        state: z.string().max(60).nullable().optional(),
        postalCode: z.string().max(20).nullable().optional(),
      })
      .nullable()
      .optional(),
    measurements: z
      .object({
        squares: z.number().min(0).max(100000).nullable().optional(),
        roofAreaSf: z.number().min(0).max(10_000_000).nullable().optional(),
        pitch: z.string().max(12).nullable().optional(),
        facetCount: z.number().int().min(0).max(2000).nullable().optional(),
        wastePercent: z.number().min(0).max(50).nullable().optional(),
        ridgeLf: z.number().min(0).max(1_000_000).nullable().optional(),
        hipLf: z.number().min(0).max(1_000_000).nullable().optional(),
        valleyLf: z.number().min(0).max(1_000_000).nullable().optional(),
        eaveLf: z.number().min(0).max(1_000_000).nullable().optional(),
        rakeLf: z.number().min(0).max(1_000_000).nullable().optional(),
      })
      .default({}),
  });

  app.post("/api/crm/integrations/measurements/webhook", requireApiKey, async (req: any, res) => {
    const parsed = webhookSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: { message: "Invalid measurement payload", issues: parsed.error.issues } });
    }
    const orgId = req.apiCtx.orgId;
    const p = parsed.data;

    // Idempotent delivery: same externalId → the same row, not a duplicate.
    if (p.externalId) {
      const [existing] = await db
        .select()
        .from(crmMeasurements)
        .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.externalId, p.externalId)))
        .limit(1);
      if (existing) {
        return res.json({ measurementId: existing.id, customerId: existing.customerId, created: false, duplicate: true });
      }
    }

    const m: ParsedReportMeasurements = {
      squares: p.measurements.squares ?? null,
      roofAreaSf: p.measurements.roofAreaSf ?? null,
      pitch: p.measurements.pitch ?? null,
      facetCount: p.measurements.facetCount ?? null,
      wastePercent: p.measurements.wastePercent ?? null,
      ridgeLf: p.measurements.ridgeLf ?? null,
      hipLf: p.measurements.hipLf ?? null,
      valleyLf: p.measurements.valleyLf ?? null,
      eaveLf: p.measurements.eaveLf ?? null,
      rakeLf: p.measurements.rakeLf ?? null,
    };

    let customer: typeof crmCustomers.$inferSelect | null = null;
    let customerCreated = false;
    if (p.customer && (p.customer.name || p.customer.email || p.customer.phone)) {
      customer = await matchCustomer(orgId, p.customer.email, p.customer.phone);
      if (!customer) {
        customer = await createCustomer(orgId, null, {
          name: p.customer.name ?? null,
          email: p.customer.email ?? null,
          phone: p.customer.phone ?? null,
          addressLine1: p.customer.addressLine1 ?? null,
          city: p.customer.city ?? null,
          state: p.customer.state ?? null,
          postalCode: p.customer.postalCode ?? null,
        });
        customerCreated = true;
      }
    }

    let projectId: string | null = null;
    if (p.projectId) {
      const [proj] = await db
        .select()
        .from(crmProjects)
        .where(and(eq(crmProjects.id, p.projectId), eq(crmProjects.orgId, orgId)))
        .limit(1);
      if (!proj) return res.status(400).json({ error: { message: "projectId not found in this organization" } });
      projectId = proj.id;
    }

    const [row] = await db
      .insert(crmMeasurements)
      .values({
        orgId,
        customerId: customer?.id ?? null,
        projectId,
        provider: p.provider,
        status: "ready",
        externalId: p.externalId ?? null,
        addressLine1: p.customer?.addressLine1 ?? null,
        city: p.customer?.city ?? null,
        state: p.customer?.state ?? null,
        postalCode: p.customer?.postalCode ?? null,
        ...measurementColumns(m),
        reportUrl: p.reportUrl ?? null,
        rawPayload: { importSource: "webhook", payload: p },
        completedAt: new Date(),
      } as any)
      .returning();

    res.status(201).json({ measurementId: row.id, customerId: customer?.id ?? null, created: true, customerCreated });
  });

  /** The homeowner's own copy of a stored report (client-portal session). */
  app.get("/api/client/reports/:id/download", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    const [row] = await db
      .select()
      .from(crmMeasurements)
      .where(eq(crmMeasurements.id, req.params.id))
      .limit(1);
    if (!row || !row.customerId || !client.customerIds.includes(row.customerId)) {
      return res.status(404).json({ message: "Report not found" });
    }
    const raw = (row.rawPayload ?? {}) as any;
    if (typeof raw.sourceText !== "string" || !raw.sourceText) {
      return res.status(404).json({ message: "No stored report file" });
    }
    const name = String(raw.fileName || `report-${row.id}.txt`).replace(/[^\w.\-]+/g, "_");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/\.pdf$/i, "")}.txt"`);
    res.send(raw.sourceText);
  });
}
