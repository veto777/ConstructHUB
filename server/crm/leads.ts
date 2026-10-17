/**
 * Leads — every inquiry from every intake in one list (/crm/leads), owner request 2026-10-17: "If a user wants
 * their forms to be synced, create a script they can add to their forms page so the software can also add all
 * those to leads, and create a leads page on this CRM and a way to connect it all to one place."
 *
 * Intakes that write a crm_leads row:
 * - form_sync       the script on the contractor's own site (GET /form-sync.js → POST /api/public/form-sync/:token)
 * - website_form    the hosted ConstructHUB form (server/crm/lead-capture.ts; it also creates the client, as before)
 * - call_assistant  a Call Assistant lead (server/voice/leads.ts; it also creates or links the client, as before)
 * - import          POST /api/crm/leads/import (owner only, idempotent by external_id)
 *
 * One token per company: the form-sync script uses the same lead-capture token as the hosted form, so rotating it
 * on Integrations stops both.
 *
 * A form-sync lead never edits a client. It is matched to one (email, or phone on its last 10 digits) and linked;
 * "Convert" on the Leads page is the only thing that creates a client from it.
 */
import express, { type Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmLeads, crmCustomers, crmLeadSources, crmProjects, voiceNumbers, CRM_LEAD_LIST_STATUSES, CRM_LEAD_SOURCES, CRM_PROJECT_STATUSES,
  type CrmLead,
} from "@shared/schema";
import { and, desc, eq, ilike, isNull, or, sql, inArray } from "drizzle-orm";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import {
  clientIp, leadTokenOf, mintLeadToken, notifyLeadReceived, orgForLeadToken, orgOwnerMember, websiteLeadSourceId,
} from "./lead-capture";
import { allow } from "./client-auth";
import { portalBaseUrl } from "../site-context";
import { formSyncScript, SENSITIVE_FIELD_SOURCE, HONEYPOT_FIELDS } from "./form-sync-script";
import { logActivity } from "./activity";
import { queueCrmEvent, customerEventPayload, projectEventPayload } from "./integrations";
import { divisionScopeOf } from "./divisions";
import { nextDocNumber } from "./entities";
import { adoptHoverMeasurementsForProject } from "./hover-share";

type GetUser = (req: any, res: any) => any;

export { LEADS_DDL } from "./leads-schema";

// ── Pure helpers (unit-tested in leads.test.ts) ─────────────────────────────

export const FORM_SYNC_PATH = "/api/public/form-sync";
export const FORM_SYNC_BODY_LIMIT = "32kb";
export const MAX_FIELDS = 60;
const MAX_KEY = 100;
const MAX_VALUE = 2000;
const DEDUPE_MINUTES = 10;

/** Field names never stored: the same rule the script applies in the browser. */
export const SENSITIVE_FIELD = new RegExp(SENSITIVE_FIELD_SOURCE, "i");

/** Every value a string, trimmed and truncated; sensitive names, empties and anything past 60 fields dropped. */
export function sanitizeFields(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= MAX_FIELDS) break;
    const key = String(k).trim().slice(0, MAX_KEY);
    if (!key || SENSITIVE_FIELD.test(key)) continue;
    const val = Array.isArray(v) ? v.filter((x) => typeof x !== "object").join(", ")
      : v != null && typeof v !== "object" ? String(v) : "";
    const trimmed = val.trim().slice(0, MAX_VALUE);
    if (!trimmed) continue;
    out[key] = trimmed;
    n++;
  }
  return out;
}

/** "your-name" / "firstName" / "contact[email]" → "your name" / "first name" / "contact email". */
export function normalizeFieldName(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE_RE = /^[+()\d][\d\s().+-]{8,22}$/;

export type MappedLead = {
  name: string | null; email: string | null; phone: string | null; addressLine1: string | null;
  city: string | null; state: string | null; postalCode: string | null; service: string | null; message: string | null;
};

/** Which lead field a form field's name is, by name alone (null = keep it only in `fields`). */
export function fieldRole(rawName: string): keyof MappedLead | "first" | "last" | null {
  const k = normalizeFieldName(rawName);
  const w = ` ${k} `;
  if (/e ?mail/.test(k)) return "email";
  if (/phone|\btel\b|telephone|mobile|\bcell\b/.test(k)) return "phone";
  if (/\b(first|fname|given)\b/.test(k) || /^first ?name$/.test(k)) return "first";
  if (/\b(last|lname|surname|family)\b/.test(k)) return "last";
  if (/\b(zip|postal|postcode|zipcode)\b/.test(k)) return "postalCode";
  if (/\b(city|town)\b/.test(k)) return "city";
  if (/\b(state|province)\b/.test(k)) return "state";
  if (/\b(address|street|addr)\b/.test(k) && !/\b(ip|web|url)\b/.test(k) && !/\b2\b|line 2/.test(k)) return "addressLine1";
  if (/\b(message|comments?|details|notes?|description|inquiry|enquiry|question|questions|how can we help|tell us)\b/.test(k)) return "message";
  if (/\b(service|services|project|interest|interested|job type|type of work|work type|trade)\b/.test(k)) return "service";
  if (/\b(name|fullname|full name|your name|contact name)\b/.test(w) && !/\b(company|business|org|organization|form|file|user|username|domain|site)\b/.test(k)) return "name";
  return null;
}

/** Map a form's raw fields onto the lead columns by name; email and phone fall back to a value that looks like one. */
export function mapLeadFields(fields: Record<string, string>): MappedLead {
  const out: MappedLead = { name: null, email: null, phone: null, addressLine1: null, city: null, state: null, postalCode: null, service: null, message: null };
  let first: string | null = null;
  let last: string | null = null;
  for (const [k, v] of Object.entries(fields)) {
    const role = fieldRole(k);
    if (!role) continue;
    if (role === "first") { first ??= v; continue; }
    if (role === "last") { last ??= v; continue; }
    if (role === "email" && !EMAIL_RE.test(v)) continue;
    // "message" and "details" on one form are both what the person wrote: keep both.
    if (role === "message" && out.message != null && out.message !== v) { out.message = `${out.message}\n\n${v}`; continue; }
    if (out[role] == null) out[role] = v;
  }
  if (!out.name && (first || last)) out.name = [first, last].filter(Boolean).join(" ");
  if (!out.email) out.email = Object.values(fields).find((v) => EMAIL_RE.test(v)) ?? null;
  if (!out.phone) {
    out.phone = Object.values(fields).find((v) => PHONE_VALUE_RE.test(v) && digitsOf(v).length >= 10 && digitsOf(v).length <= 11) ?? null;
  }
  if (out.email) out.email = out.email.toLowerCase().slice(0, 200);
  const cap = (s: string | null, n: number) => (s == null ? null : s.slice(0, n));
  return {
    name: cap(out.name, 200), email: out.email, phone: cap(out.phone, 40), addressLine1: cap(out.addressLine1, 200),
    city: cap(out.city, 120), state: cap(out.state, 40), postalCode: cap(out.postalCode, 20),
    service: cap(out.service, 300), message: cap(out.message, 5000),
  };
}

const digitsOf = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** The phone's comparison key: its last 10 digits once a leading US 1 is stripped; null when fewer than 10. */
export function phoneKey(phone: string | null | undefined): string | null {
  let d = digitsOf(phone);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 10 ? d.slice(-10) : null;
}

/** Honeypot fields of the owner's sites (company_url, website): filled = a bot. */
export function honeypotTripped(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return HONEYPOT_FIELDS.some((k) => {
    const v = (raw as Record<string, unknown>)[k];
    return v != null && typeof v !== "object" && String(v).trim() !== "";
  });
}

const firstOf = (fields: Record<string, string>, keys: string[]) => {
  for (const k of keys) if (fields[k]) return fields[k];
  return null;
};

/**
 * Where the form was, from the tracking keys the sites send themselves (_pageUrl / pageUrl / sourceUrl,
 * _pageTitle / page_title / pageTitle, site_brand, source). They stay in `fields` too; only these columns read them.
 */
export function pageMetaFrom(fields: Record<string, string>): { pageUrl: string | null; title: string | null; brand: string | null; source: string | null } {
  const url = firstOf(fields, ["_pageUrl", "pageUrl", "page_url", "sourceUrl", "source_url"]);
  return {
    pageUrl: url && /^https?:\/\//i.test(url) ? url.slice(0, 500) : null,
    title: firstOf(fields, ["_pageTitle", "page_title", "pageTitle"])?.slice(0, 200) ?? null,
    brand: firstOf(fields, ["site_brand", "siteBrand", "brand"])?.slice(0, 120) ?? null,
    source: firstOf(fields, ["source", "_source"])?.slice(0, 120) ?? null,
  };
}

/** text/plain (sendBeacon), application/json or urlencoded → the payload, or null when it can't be read. */
export function parseFormSyncBody(raw: unknown, contentType: string | undefined): {
  fields: Record<string, unknown>; pageUrl: string | null; formId: string | null; formName: string | null; title: string | null;
} | null {
  const ct = String(contentType || "").toLowerCase();
  let text: string;
  if (Buffer.isBuffer(raw)) text = raw.toString("utf8");
  else if (typeof raw === "string") text = raw;
  else if (raw && typeof raw === "object") text = JSON.stringify(raw);
  else return null;
  if (!text.trim()) return null;
  let obj: any;
  if (ct.includes("application/x-www-form-urlencoded")) {
    obj = Object.fromEntries(new URLSearchParams(text));
  } else {
    try { obj = JSON.parse(text); } catch {
      // A beacon is always JSON; a plain urlencoded string sent as text/plain is accepted too.
      if (/^[^{[]/.test(text) && text.includes("=")) obj = Object.fromEntries(new URLSearchParams(text));
      else return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const hasEnvelope = obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields);
  return {
    fields: hasEnvelope ? obj.fields : obj,
    pageUrl: hasEnvelope ? str(obj.pageUrl, 500) : null,
    formId: hasEnvelope ? str(obj.formId, 120) : null,
    formName: hasEnvelope ? str(obj.formName, 120) : null,
    title: hasEnvelope ? str(obj.title, 200) : null,
  };
}

/** The website host of a page URL ("columbusroofing.com"), or null. */
export function hostOf(url: string | null | undefined): string | null {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") || null : null; } catch { return null; }
}

/** The CORS headers of the public endpoint: any site may post (the token is the credential; it only creates). */
export function setFormSyncCors(res: any): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Mounted in server/index.ts BEFORE the app's 50 MB JSON parser: CORS (and the preflight) for every answer, then
 * the body as raw bytes capped at 32 KB, whatever its content type (sendBeacon sends text/plain).
 */
export function registerFormSyncBodyParser(app: Express): void {
  app.use(FORM_SYNC_PATH, (req, res, next) => {
    setFormSyncCors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  }, express.raw({ type: () => true, limit: FORM_SYNC_BODY_LIMIT }));
}

// ── Recording a lead ────────────────────────────────────────────────────────

/** The org's live client with this email, else with this phone (phone or alt phone, last 10 digits). */
export async function matchCustomer(orgId: string, email: string | null, phone: string | null): Promise<string | null> {
  if (email) {
    const [row] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), isNull(crmCustomers.archivedAt), sql`lower(${crmCustomers.email}) = ${email.toLowerCase()}`))
      .orderBy(desc(crmCustomers.createdAt)).limit(1);
    if (row) return row.id;
  }
  const key = phoneKey(phone);
  if (key) {
    const last10 = (col: any) => sql`right(regexp_replace(regexp_replace(coalesce(${col}, ''), '[^0-9]', '', 'g'), '^1(?=[0-9]{10}$)', ''), 10)`;
    const [row] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), isNull(crmCustomers.archivedAt),
        sql`(${last10(crmCustomers.phone)} = ${key} or ${last10(crmCustomers.altPhone)} = ${key})`))
      .orderBy(desc(crmCustomers.createdAt)).limit(1);
    if (row) return row.id;
  }
  return null;
}

export type LeadInput = MappedLead & {
  source: (typeof CRM_LEAD_SOURCES)[number];
  sourceLabel?: string | null;
  pageUrl?: string | null;
  fields?: Record<string, string> | null;
  externalId?: string | null;
  receivedAt?: Date | null;
  status?: (typeof CRM_LEAD_LIST_STATUSES)[number];
  customerId?: string | null;
};

/**
 * Store one lead: deduped (same org, same email or phone, same message within 10 minutes = the existing lead),
 * spam when nobody can be reached, linked to the client it matches. Returns the row and whether it is new.
 */
export async function recordLead(orgId: string, input: LeadInput): Promise<{ lead: CrmLead; created: boolean }> {
  const reachable = !!(input.email || input.phone);
  const status = input.status ?? (reachable ? "new" : "spam");
  const key = phoneKey(input.phone);
  const message = (input.message ?? "").trim();
  const lockKey = `lead:${orgId}:${input.email ?? ""}:${key ?? input.phone ?? ""}`;

  return db.transaction(async (tx) => {
    // Two copies of one submission (a double click, a beacon plus a retry) serialise here, so only one row lands.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    // A row with its own dedupe key (an import row, a call) is deduped by that key alone: a historical lead must
    // not fold into a live one that happens to share the email.
    if (reachable && !input.externalId) {
      const same = [
        input.email ? sql`lower(${crmLeads.email}) = ${input.email.toLowerCase()}` : null,
        key ? sql`right(regexp_replace(regexp_replace(coalesce(${crmLeads.phone}, ''), '[^0-9]', '', 'g'), '^1(?=[0-9]{10}$)', ''), 10) = ${key}` : null,
        !key && input.phone ? sql`${crmLeads.phone} = ${input.phone}` : null,
      ].filter(Boolean) as any[];
      const [dupe] = await tx.select().from(crmLeads).where(and(
        eq(crmLeads.orgId, orgId),
        or(...same),
        sql`coalesce(btrim(${crmLeads.message}), '') = ${message}`,
        sql`${crmLeads.receivedAt} > now() - make_interval(mins => ${DEDUPE_MINUTES})`,
      )).orderBy(desc(crmLeads.receivedAt)).limit(1);
      if (dupe) return { lead: dupe, created: false };
    }
    const customerId = input.customerId ?? (reachable ? await matchCustomer(orgId, input.email, input.phone) : null);
    const values = {
      orgId, source: input.source, sourceLabel: input.sourceLabel ?? null,
      name: input.name, email: input.email, phone: input.phone, addressLine1: input.addressLine1, city: input.city,
      state: input.state, postalCode: input.postalCode, service: input.service, message: input.message,
      pageUrl: input.pageUrl ?? null, fields: input.fields ?? null, status, customerId,
      externalId: input.externalId ?? null, receivedAt: input.receivedAt ?? new Date(),
    };
    if (values.externalId) {
      const [row] = await tx.insert(crmLeads).values(values).onConflictDoNothing().returning();
      if (row) return { lead: row, created: true };
      const [existing] = await tx.select().from(crmLeads).where(and(eq(crmLeads.orgId, orgId),
        eq(crmLeads.source, input.source), eq(crmLeads.externalId, values.externalId))).limit(1);
      return { lead: existing, created: false };
    }
    const [row] = await tx.insert(crmLeads).values(values).returning();
    return { lead: row, created: true };
  });
}

/**
 * A Call Assistant lead on the Leads list (server/voice/leads.ts calls this after it made or linked the client).
 * One row per call (external_id = the call id); the end report fills what the mid-call delivery did not have yet.
 * Never throws: the voice flow must not break over the Leads list.
 */
export async function recordCallAssistantLead(args: {
  orgId: string; callId: string; customerId: string; numberLabel?: string | null; receivedAt?: Date | null;
  facts: { name: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; need: string | null };
  state: string | null; summary: string | null;
}): Promise<void> {
  try {
    const f = args.facts;
    const message = [f.need ? `Need: ${f.need}` : null, args.summary?.trim() || null].filter(Boolean).join("\n") || null;
    await db.insert(crmLeads).values({
      orgId: args.orgId, source: "call_assistant", sourceLabel: args.numberLabel || "Call Assistant",
      name: f.name, email: f.email, phone: f.phone, addressLine1: f.address, city: f.city, state: args.state,
      service: f.need, message, status: "new", customerId: args.customerId, externalId: args.callId,
      fields: Object.fromEntries(Object.entries({ name: f.name, email: f.email, phone: f.phone, address: f.address, city: f.city, need: f.need })
        .filter(([, v]) => !!v)) as Record<string, string>,
      receivedAt: args.receivedAt ?? new Date(),
    }).onConflictDoUpdate({
      target: [crmLeads.orgId, crmLeads.source, crmLeads.externalId],
      targetWhere: sql`external_id IS NOT NULL`,
      set: {
        name: sql`coalesce(${crmLeads.name}, excluded.name)`,
        email: sql`coalesce(${crmLeads.email}, excluded.email)`,
        phone: sql`coalesce(${crmLeads.phone}, excluded.phone)`,
        addressLine1: sql`coalesce(${crmLeads.addressLine1}, excluded.address_line1)`,
        city: sql`coalesce(${crmLeads.city}, excluded.city)`,
        state: sql`coalesce(${crmLeads.state}, excluded.state)`,
        service: sql`coalesce(${crmLeads.service}, excluded.service)`,
        message: sql`coalesce(excluded.message, ${crmLeads.message})`,
        customerId: sql`coalesce(${crmLeads.customerId}, excluded.customer_id)`,
        updatedAt: new Date(),
      },
    });
  } catch (e: any) {
    console.error("[crm] call-assistant lead row failed:", e?.message || e);
  }
}

/** The org's lead source with this name (the "Call Assistant" one server/voice/leads.ts uses), created on first use. */
async function leadSourceIdNamed(orgId: string, name: string): Promise<string> {
  const [existing] = await db.select().from(crmLeadSources)
    .where(and(eq(crmLeadSources.orgId, orgId), sql`lower(${crmLeadSources.name}) = ${name.toLowerCase()}`)).limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(crmLeadSources).values({ orgId, name }).returning();
  return row.id;
}

// ── Presenting ──────────────────────────────────────────────────────────────

const SOURCE_NAMES: Record<string, string> = {
  website_form: "ConstructHUB form", form_sync: "Website form", call_assistant: "Call Assistant", import: "Import", manual: "Added by hand",
};

function presentLead(l: CrmLead, customers: Map<string, string>) {
  return {
    ...l,
    sourceName: SOURCE_NAMES[l.source] ?? l.source,
    customer: l.customerId && customers.has(l.customerId) ? { id: l.customerId, displayName: customers.get(l.customerId)! } : null,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

const statusSchema = z.object({ status: z.enum(CRM_LEAD_LIST_STATUSES as unknown as [string, ...string[]]) });

const convertSchema = z.object({
  customerId: z.string().max(64).nullish(),
  name: z.string().trim().max(200).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(40).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  addToPipeline: z.boolean().optional(),
});

const importRowSchema = z.object({
  externalId: z.string().trim().min(1).max(200).nullish(),
  sourceLabel: z.string().trim().max(200).nullish(),
  // Only "import" is accepted (the other sources have their own intakes); sent by the historical loader.
  source: z.literal("import").optional(),
  name: z.string().trim().max(200).nullish(),
  firstName: z.string().trim().max(100).nullish(),
  lastName: z.string().trim().max(100).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  address: z.string().trim().max(200).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(40).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  service: z.string().trim().max(300).nullish(),
  message: z.string().trim().max(5000).nullish(),
  pageUrl: z.string().trim().max(500).nullish(),
  status: z.enum(CRM_LEAD_LIST_STATUSES as unknown as [string, ...string[]]).optional(),
  receivedAt: z.string().max(40).nullish(),
  fields: z.record(z.any()).nullish(),
});

/** Leads per import request; the historical loader sends batches of 1,000. */
export const IMPORT_BATCH_MAX = 1000;

export function formSyncSnippet(origin: string, token: string): string {
  return `<script src="${origin}/form-sync.js" data-token="${token}" async></script>`;
}

export function registerCrmLeadRoutes(app: Express, getDevUser: GetUser): void {
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  /** The script itself. Public and cacheable; the endpoint inside it is this deployment's portal host. */
  app.get("/form-sync.js", (req: any, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(formSyncScript(portalBaseUrl(req)));
  });

  /**
   * Public intake from the script. Like the hosted form, a tripped rate limit answers the same { ok: true } as a
   * real lead; only an unknown token says so (404), so a site owner who rotated it can tell.
   */
  app.post(`${FORM_SYNC_PATH}/:token`, async (req: any, res) => {
    setFormSyncCors(res);
    const org = await orgForLeadToken(String(req.params.token || ""));
    if (!org) return res.status(404).json({ message: "This form sync link is no longer active." });
    const body = parseFormSyncBody(req.body, req.headers["content-type"]);
    if (!body) return res.status(400).json({ message: "Send the form fields as JSON." });
    // A bot filled a honeypot: the same answer as a real lead, nothing stored.
    if (honeypotTripped(body.fields)) return res.status(201).json({ ok: true });
    const fields = sanitizeFields(body.fields);
    if (!Object.keys(fields).length) return res.status(400).json({ message: "No form fields were sent." });
    // 20 per visitor IP and 300 per company per 15 minutes (the client-auth fixed-window buckets).
    if (!allow(`formsync:ip:${clientIp(req)}`, 20) || !allow(`formsync:org:${org.id}`, 300)) {
      return res.status(201).json({ ok: true });
    }
    const mapped = mapLeadFields(fields);
    const meta = pageMetaFrom(fields);
    const pageUrl = meta.pageUrl ?? body.pageUrl;
    const host = hostOf(pageUrl);
    const { lead, created } = await recordLead(org.id, {
      ...mapped, source: "form_sync",
      sourceLabel: [meta.brand ?? host, body.formName || body.formId].filter(Boolean).join(" · ").slice(0, 200) || null,
      pageUrl, fields,
    });
    if (created && lead.status === "new") {
      const owner = await orgOwnerMember(org);
      notifyLeadReceived(org, owner, {
        id: lead.id, name: lead.name || lead.email || lead.phone || "Someone", email: lead.email, phone: lead.phone, message: lead.message,
      }, {
        link: `/crm/leads?lead=${lead.id}`,
        via: host ? `a form on ${host}` : "a form on your website",
        waiting: "The lead is waiting on the Leads page of your CRM.",
      }).catch((e: any) => console.error("[crm] form-sync notify failed:", e?.message || e));
    }
    res.status(201).json({ ok: true });
  });

  /** The Leads list: paged, filtered by status (default new), source and search; counts per status for the tabs. */
  app.get("/api/crm/leads", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const int = (v: any, dflt: number, min: number, max: number) => {
      const n = parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
    };
    const limit = int(req.query.limit, 50, 1, 200);
    const offset = int(req.query.offset, 0, 0, 1_000_000);
    const status = String(req.query.status || "new");
    if (status !== "all" && !(CRM_LEAD_LIST_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ message: `status must be one of: all, ${CRM_LEAD_LIST_STATUSES.join(", ")}.` });
    }
    const source = req.query.source ? String(req.query.source) : null;
    if (source && source !== "all" && !(CRM_LEAD_SOURCES as readonly string[]).includes(source)) {
      return res.status(400).json({ message: `source must be one of: all, ${CRM_LEAD_SOURCES.join(", ")}.` });
    }
    const q = String(req.query.q || "").trim().slice(0, 200);
    const base: any[] = [eq(crmLeads.orgId, ctx.org.id)];
    if (source && source !== "all") base.push(eq(crmLeads.source, source));
    if (q) {
      const pat = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const conds: any[] = [ilike(crmLeads.name, pat), ilike(crmLeads.email, pat), ilike(crmLeads.phone, pat),
        ilike(crmLeads.addressLine1, pat), ilike(crmLeads.city, pat), ilike(crmLeads.message, pat),
        ilike(crmLeads.service, pat), ilike(crmLeads.sourceLabel, pat)];
      const digits = digitsOf(q);
      if (digits.length >= 4 && /^[\d\s().+-]+$/.test(q)) {
        conds.push(sql`regexp_replace(coalesce(${crmLeads.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
      }
      base.push(or(...conds));
    }
    const countRows = await db.select({ status: crmLeads.status, n: sql<number>`count(*)::int` })
      .from(crmLeads).where(and(...base)).groupBy(crmLeads.status);
    const counts = Object.fromEntries(CRM_LEAD_LIST_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const r of countRows) counts[r.status] = (counts[r.status] ?? 0) + r.n;
    const where = status === "all" ? base : [...base, eq(crmLeads.status, status)];
    const rows = await db.select().from(crmLeads).where(and(...where))
      .orderBy(desc(crmLeads.receivedAt), desc(crmLeads.id)).limit(limit).offset(offset);
    const custIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean) as string[])];
    const customers = new Map<string, string>();
    if (custIds.length) {
      for (const c of await db.select({ id: crmCustomers.id, displayName: crmCustomers.displayName }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), inArray(crmCustomers.id, custIds)))) customers.set(c.id, c.displayName);
    }
    const total = status === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : counts[status] ?? 0;
    const [{ any }] = await db.select({ any: sql<number>`count(*)::int` }).from(crmLeads).where(eq(crmLeads.orgId, ctx.org.id));
    res.json({ rows: rows.map((r) => presentLead(r, customers)), total, counts, limit, offset, everAny: any > 0 });
  });

  /**
   * The "Connect your lead sources" panel: per source, whether it is set up and when its last lead came in; the
   * script tag and hosted form link for the seats that manage integrations (the token only creates leads, but it is
   * still the company's to hand out).
   */
  app.get("/api/crm/leads/connect", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const stats = await db.select({
      source: crmLeads.source, n: sql<number>`count(*)::int`, lastAt: sql<Date | null>`max(${crmLeads.receivedAt})`.mapWith(crmLeads.receivedAt),
    }).from(crmLeads).where(eq(crmLeads.orgId, ctx.org.id)).groupBy(crmLeads.source);
    const stat = (s: string) => {
      const r = stats.find((x) => x.source === s);
      return { count: r?.n ?? 0, lastLeadAt: r?.lastAt ?? null };
    };
    const canIntegrations = ctx.permissions.manageIntegrations === true;
    let token = leadTokenOf(ctx.org);
    if (!token && canIntegrations) token = await mintLeadToken(ctx.org.id);
    const origin = portalBaseUrl(req);
    const [{ numbers }] = await db.select({ numbers: sql<number>`count(*)::int` }).from(voiceNumbers)
      .where(and(eq(voiceNumbers.orgId, ctx.org.id), eq(voiceNumbers.status, "active" as any)));
    const hover = (ctx.org.customFields as any)?.hover;
    res.json({
      canIntegrations,
      formSync: { ...stat("form_sync"), connected: stat("form_sync").count > 0, snippet: canIntegrations && token ? formSyncSnippet(origin, token) : null },
      websiteForm: { ...stat("website_form"), connected: !!token, formUrl: canIntegrations && token ? `${origin}/lead-form/${token}` : null },
      callAssistant: { ...stat("call_assistant"), connected: numbers > 0 },
      hover: { connected: !!(hover && typeof hover.refreshTokenEnc === "string"), lastSyncAt: hover?.lastSyncAt ?? null },
      import: stat("import"),
    });
  });

  /** One lead (the bell's link opens it: /crm/leads?lead=<id>). */
  app.get("/api/crm/leads/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const [lead] = await db.select().from(crmLeads).where(and(eq(crmLeads.orgId, ctx.org.id), eq(crmLeads.id, String(req.params.id)))).limit(1);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    const customers = new Map<string, string>();
    if (lead.customerId) {
      const [c] = await db.select({ id: crmCustomers.id, displayName: crmCustomers.displayName }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, lead.customerId))).limit(1);
      if (c) customers.set(c.id, c.displayName);
    }
    res.json(presentLead(lead, customers));
  });

  app.patch("/api/crm/leads/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: `Status must be one of: ${CRM_LEAD_LIST_STATUSES.join(", ")}.` });
    const [row] = await db.update(crmLeads).set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(crmLeads.orgId, ctx.org.id), eq(crmLeads.id, String(req.params.id)))).returning();
    if (!row) return res.status(404).json({ message: "Lead not found" });
    res.json(row);
  });

  /**
   * Convert: link the lead to a client (customerId given) or create one from it. A new client needs an address
   * (owner rule: every client has one). addToPipeline puts a project in the first pipeline stage, as New lead does.
   */
  app.post("/api/crm/leads/:id/convert", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = convertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Check the client's details.", issues: parsed.error.issues });
    const body = parsed.data;
    if (body.addToPipeline && !ctx.permissions.manageJobs) return res.status(403).json({ message: "Requires permission: manageJobs" });
    const [lead] = await db.select().from(crmLeads).where(and(eq(crmLeads.orgId, ctx.org.id), eq(crmLeads.id, String(req.params.id)))).limit(1);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    let customer: typeof crmCustomers.$inferSelect | undefined;
    let createdClient = false;
    if (body.customerId) {
      [customer] = await db.select().from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, body.customerId))).limit(1);
      if (!customer) return res.status(400).json({ message: "Client not found in this organization" });
    } else {
      const addressLine1 = body.addressLine1 || lead.addressLine1;
      if (!addressLine1) return res.status(400).json({ message: "Enter the client's address." });
      const displayName = (body.name || lead.name || lead.email || lead.phone || "").trim().slice(0, 200);
      if (!displayName) return res.status(400).json({ message: "Enter the client's name." });
      const leadSourceId = lead.source === "call_assistant" ? await leadSourceIdNamed(ctx.org.id, "Call Assistant")
        : lead.source === "form_sync" || lead.source === "website_form" ? await websiteLeadSourceId(ctx.org.id) : null;
      const notes = [lead.service ? `Service: ${lead.service}` : null, lead.message, lead.pageUrl ? `Sent from ${lead.pageUrl}` : null]
        .filter(Boolean).join("\n").slice(0, 20000) || null;
      [customer] = await db.insert(crmCustomers).values({
        orgId: ctx.org.id, displayName, email: lead.email, phone: lead.phone,
        addressLine1, city: body.city ?? lead.city, state: body.state ?? lead.state, postalCode: body.postalCode ?? lead.postalCode,
        notes, leadSourceId, ownerMemberId: ctx.member.id, divisionId: divisionScopeOf(ctx),
        tags: lead.source === "form_sync" || lead.source === "website_form" ? ["website-lead"] : null,
        portalToken: randomBytes(24).toString("hex"),
      }).returning();
      createdClient = true;
      logActivity(ctx, "customer.created", { entityType: "customer", entityId: customer.id, customerId: customer.id, meta: { name: customer.displayName, fromLead: lead.id } });
      queueCrmEvent(ctx.org.id, "customer.created", { ...customerEventPayload(customer), source: `lead_${lead.source}` });
    }

    let project: typeof crmProjects.$inferSelect | null = null;
    if (body.addToPipeline) {
      const c = customer!;
      project = await db.transaction(async (tx) => {
        const number = await nextDocNumber(tx, crmProjects, ctx.org.id, "P");
        const [row] = await tx.insert(crmProjects).values({
          orgId: ctx.org.id, customerId: c.id, number, status: CRM_PROJECT_STATUSES[0],
          name: `${(lead.service ? `${c.displayName} — ${lead.service}` : c.displayName).slice(0, 193)} — lead`.slice(0, 200),
          description: lead.message, addressLine1: c.addressLine1, city: c.city, state: c.state, postalCode: c.postalCode,
          divisionId: c.divisionId ?? divisionScopeOf(ctx),
        } as any).returning();
        return row;
      });
      queueCrmEvent(ctx.org.id, "project.created", projectEventPayload(project));
      await adoptHoverMeasurementsForProject(project);
    }

    const [updated] = await db.update(crmLeads).set({ status: "converted", customerId: customer!.id, updatedAt: new Date() })
      .where(eq(crmLeads.id, lead.id)).returning();
    res.json({ lead: updated, customer: { id: customer!.id, displayName: customer!.displayName }, createdClient, projectId: project?.id ?? null });
  });

  /** Bulk import (owner only): a JSON array of leads, idempotent by externalId. */
  app.post("/api/crm/leads/import", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    if (ctx.member.role !== "owner") return res.status(403).json({ message: "Only the account owner can import leads." });
    const list = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.leads) ? req.body.leads : null;
    if (!list) return res.status(400).json({ message: "Send a JSON array of leads." });
    if (list.length > IMPORT_BATCH_MAX) return res.status(400).json({ message: `Import ${IMPORT_BATCH_MAX.toLocaleString("en-US")} leads at a time at most.` });
    let inserted = 0, skipped = 0;
    const errors: { index: number; message: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = importRowSchema.safeParse(list[i]);
      if (!p.success) { errors.push({ index: i, message: p.error.issues[0]?.message || "Invalid lead" }); continue; }
      const r = p.data;
      const fields = sanitizeFields(r.fields ?? {});
      const receivedAt = r.receivedAt && !Number.isNaN(Date.parse(r.receivedAt)) ? new Date(r.receivedAt) : null;
      const email = r.email && EMAIL_RE.test(r.email) ? r.email.toLowerCase() : null;
      const name = r.name || [r.firstName, r.lastName].filter(Boolean).join(" ") || null;
      const { created } = await recordLead(ctx.org.id, {
        name, email, phone: r.phone || null, addressLine1: r.addressLine1 || r.address || null, city: r.city ?? null,
        state: r.state ?? null, postalCode: r.postalCode ?? null, service: r.service ?? null, message: r.message ?? null,
        source: "import", sourceLabel: r.sourceLabel ?? "Import", pageUrl: r.pageUrl ?? null,
        fields: Object.keys(fields).length ? fields : null, externalId: r.externalId ?? null, receivedAt,
        status: r.status as any,
      });
      if (created) inserted++; else skipped++;
    }
    res.json({ inserted, skipped, errors });
  });
}
