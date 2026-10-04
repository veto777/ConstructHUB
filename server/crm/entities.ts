import { invoiceRefundTotals } from "./refund-summary";
import { objectPolicy, canShareWholeClientPortal } from "./object-access";
import { csvCell } from "./csv";
/**
 * CRM entities — customers, projects, jobs, estimates, plus the org-wide
 * Documents Center lists (filtered estimates/invoices for /crm/estimates and
 * /crm/invoices; see parseDocQuery).
 *
 * Two rules hold everywhere in this file:
 *   1. Every query is scoped by the caller's active org. Never trust an org id
 *      from the request.
 *   2. Prices and costs are stripped server-side based on permissions, not
 *      hidden in the UI. A PM shared onto a client list must not be able to read
 *      pricing out of the JSON.
 */
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmCustomers, crmProjects, crmJobs, crmEstimates, crmEstimateItems,
  crmEstimateEvents, crmLeadSources, crmInvoices, crmInvoiceItems,
  crmEstimateOptions, crmEstimateDiscounts, crmEngagementSessions,
  crmPayments, crmCustomerNotes, crmClientComments, crmFinanceClicks,
  crmAttachments, crmAppointments, crmChangeOrders, crmPunchItems,
  crmDailyLogs, crmSelections, crmBudgetLines, crmCommitments,
  crmCostEntries, crmPhases, crmMeasurements, crmNotifications,
  CRM_PROJECT_STATUSES, CRM_JOB_STATUSES, CRM_LINE_ITEM_KINDS,
  CRM_PROJECT_STAGE_META, CRM_ESTIMATE_STATUSES, CRM_INVOICE_STATUSES,
} from "@shared/schema";
import {
  and, eq, desc, asc, ilike, or, sql, isNull, isNotNull, inArray, gte, lte, lt,
} from "drizzle-orm";
import { logTeamActivity, projectStageLabel } from "./stats";
import { requireOrg, requirePermission, requireOwnerRole, type OrgContext } from "./tenancy";
import { logActivity } from "./activity";
import {
  divisionScopeOf, divisionVisible, divisionMapsForOrg, docDivisionFromMaps, getDivision,
} from "./divisions";
import { priceFloorViolation } from "./price-floor";
import { nextDocNumber as allocateDocNumber } from "./doc-number";

type GetUser = (req: any, res: any) => any;

const token = () => randomBytes(24).toString("hex");

// ── Documents Center list params ────────────────────────────────────────────
// The org-wide Documents Center (/crm/estimates, /crm/invoices) needs real
// filtering — the #1 complaint about HCP. Document mode is strictly opt-in:
// passing any of these params switches a list endpoint from its legacy
// bare-array shape to { rows, total, filtered }. No params at all = exactly
// yesterday's behaviour, so every existing caller and test is untouched.

interface DocQuery {
  statuses: string[];
  dateField: "created" | "sent";
  from: Date | null;
  to: Date | null;
  q: string;
  sort: "newest" | "oldest" | "largest";
  /** Page window. The default (500 from 0) is the historical cap. */
  limit: number;
  offset: number;
}

/**
 * A user's search text as a LIKE/ILIKE "contains" pattern. %, _ and \ are
 * escaped, so a search for "%" finds a literal percent sign instead of
 * matching every row.
 */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

// ── Estimate expiry ─────────────────────────────────────────────────────────

/**
 * Sent estimates expire. Default: 7 days from the moment it is sent — long
 * enough to decide, short enough that pricing doesn't go stale. Stamped at
 * send time (not at create), so a draft sitting in the pipeline doesn't burn
 * its validity window before the client ever sees it. (portal.ts re-exports
 * both — the send route is their main user.)
 */
export const ESTIMATE_EXPIRY_DAYS = 7;
export function estimateExpiryOnSend(sentAt: Date, days: number = ESTIMATE_EXPIRY_DAYS): Date {
  return new Date(sentAt.getTime() + days * 86_400_000);
}

/**
 * "Expired" is DERIVED, never written by a job: an estimate that went out
 * (sent/viewed), was never answered, and is past its expiry date. Same idea
 * as an invoice's derived "overdue".
 */
export function estimateIsExpired(
  e: { status: string; expiresAt: Date | null; approvedAt: Date | null; declinedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (e.status === "expired") return true;
  return (e.status === "sent" || e.status === "viewed") &&
    !!e.expiresAt && e.expiresAt.getTime() < now.getTime() &&
    !e.approvedAt && !e.declinedAt;
}

// ── Estimate totals (pure) ──────────────────────────────────────────────────

type TotalsLine = { kind: string; unitPriceCents: number; quantityMilli: number; taxable: boolean };

/** The recalcEstimate math as a pure function — integer cents, rounded once per step. */
export function estimateTotals(items: TotalsLine[], taxRateBps: number) {
  let subtotal = 0, taxable = 0, discount = 0;
  for (const i of items) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { discount += Math.abs(line); continue; }
    subtotal += line;
    if (i.taxable) taxable += line;
  }
  const taxBase = Math.max(0, taxable - discount);
  const tax = Math.round((taxBase * (taxRateBps || 0)) / 10000);
  const total = Math.max(0, subtotal - discount + tax);
  return { subtotalCents: subtotal, discountCents: discount, taxCents: tax, totalCents: total };
}

const usd = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Why a deposit is not acceptable, or null. The public pay route charges the
 * deposit whenever one is set, so a deposit above the total would bill the
 * client more than the whole job.
 */
export function depositRefusal(depositCents: number | null | undefined, totalCents: number): string | null {
  if (!depositCents || depositCents <= 0) return null;
  if (depositCents > totalCents) {
    return `The deposit (${usd(depositCents)}) can't be more than the estimate total (${usd(totalCents)}).`;
  }
  return null;
}

// ── Document numbers ────────────────────────────────────────────────────────

/**
 * The next per-org document number ("E-1234", "P-1001"), allocated under the
 * per-org, per-series lock in doc-number.ts — the one allocator every series
 * shares, so a plain create, a Quick Bid and a portal selection copy all
 * serialise on the same lock, and a hard delete can never hand out a number
 * that is still in use (count(*)+1 did both). Call it INSIDE the transaction
 * that inserts the row. The table argument must be the prefix's own table.
 */
export async function nextDocNumber(
  tx: any,
  table: typeof crmEstimates | typeof crmProjects,
  orgId: string,
  prefix: "E" | "P",
): Promise<string> {
  if ((table === crmEstimates) !== (prefix === "E")) {
    throw new Error(`nextDocNumber: prefix ${prefix} does not number this table`);
  }
  return allocateDocNumber(tx, prefix, orgId);
}

/**
 * Parse the document-mode params, or return null when the request is a legacy
 * call. `statusTriggers` is true for endpoints that never had a status param
 * (invoices) — there, even a single status value means document mode; on
 * estimates a lone ?status=x stays legacy and only a comma list opts in.
 */
function parseDocQuery(
  query: Record<string, any>,
  allowedStatuses: readonly string[],
  derivedStatuses: string[] = [],
  statusTriggers = false,
): DocQuery | null {
  const has = (k: string) => query[k] !== undefined && String(query[k]).trim() !== "";
  const rawStatus = String(query.status || "").trim();
  const docMode =
    has("from") || has("to") || has("q") || has("sort") || has("dateField") ||
    rawStatus.includes(",") || (statusTriggers && rawStatus !== "");
  if (!docMode) return null;

  const statuses = rawStatus
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowedStatuses.includes(s) || derivedStatuses.includes(s));

  const parseDate = (v: any, endOfDay: boolean): Date | null => {
    const s = String(v || "").trim();
    if (!s) return null;
    // A bare date means the whole day, not midnight-to-midnight misses.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? `${s}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : s;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  };

  const sortRaw = String(query.sort || "newest");
  const int = (v: any, dflt: number, min: number, max: number) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  return {
    statuses,
    dateField: query.dateField === "sent" ? "sent" : "created",
    from: parseDate(query.from, false),
    to: parseDate(query.to, true),
    q: String(query.q || "").trim().slice(0, 200),
    sort: sortRaw === "oldest" || sortRaw === "largest" ? sortRaw : "newest",
    limit: int(query.limit, 500, 1, 500),
    offset: int(query.offset, 0, 0, 1_000_000),
  };
}

// ── Presenters: the permission boundary ─────────────────────────────────────

/** Cost is stricter than price — a rep may see price but never margin. */
function presentEstimateItem(i: typeof crmEstimateItems.$inferSelect, ctx: OrgContext) {
  const base = {
    id: i.id, sortOrder: i.sortOrder, kind: i.kind, name: i.name,
    description: i.description, quantityMilli: i.quantityMilli, unit: i.unit,
    taxable: i.taxable, hiddenFromClient: i.hiddenFromClient,
  };
  return {
    ...base,
    unitPriceCents: ctx.permissions.seePrices ? i.unitPriceCents : undefined,
    unitCostCents: ctx.permissions.seeCosts ? i.unitCostCents : undefined,
  };
}

function presentEstimate(e: typeof crmEstimates.$inferSelect, ctx: OrgContext) {
  const money = ctx.permissions.seePrices;
  return {
    id: e.id, customerId: e.customerId, projectId: e.projectId, number: e.number,
    divisionId: e.divisionId,
    title: e.title, status: e.status, introText: e.introText, termsText: e.termsText,
    subtotalCents: money ? e.subtotalCents : undefined,
    discountCents: money ? e.discountCents : undefined,
    taxRateBps: money ? e.taxRateBps : undefined,
    taxCents: money ? e.taxCents : undefined,
    totalCents: money ? e.totalCents : undefined,
    depositCents: money ? e.depositCents : undefined,
    // What the client actually signed for: the total after any optional
    // discounts they ticked (null until approval), and those discounts.
    approvedTotalCents: money ? e.approvedTotalCents : undefined,
    selectedDiscounts: money ? e.selectedDiscounts : undefined,
    sentAt: e.sentAt, sentToEmail: e.sentToEmail,
    firstViewedAt: e.firstViewedAt, lastViewedAt: e.lastViewedAt, viewCount: e.viewCount,
    approvedAt: e.approvedAt, declinedAt: e.declinedAt, declineReason: e.declineReason,
    signatureName: e.signatureName, expiresAt: e.expiresAt,
    // Derived: out, unanswered and past its expiry date (see estimateIsExpired).
    expired: estimateIsExpired(e),
    createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

/** Documents Center rows: the list never renders intro/terms, so they don't ship. */
function presentEstimateRow(e: typeof crmEstimates.$inferSelect, ctx: OrgContext) {
  const { introText: _intro, termsText: _terms, ...row } = presentEstimate(e, ctx);
  return row;
}

function presentProject(p: typeof crmProjects.$inferSelect, ctx: OrgContext) {
  const money = ctx.permissions.seePrices;
  return {
    ...p,
    contractValueCents: money ? p.contractValueCents : undefined,
    budgetCents: ctx.permissions.seeCosts ? p.budgetCents : undefined,
    stageLabel: CRM_PROJECT_STAGE_META[p.status]?.label ?? p.status,
    stageGroup: CRM_PROJECT_STAGE_META[p.status]?.group ?? "Other",
  };
}

/** Recompute totals from line items. Client-supplied totals are ignored. */
async function recalcEstimate(orgId: string, estimateId: string) {
  const items = await db.select().from(crmEstimateItems)
    .where(and(eq(crmEstimateItems.orgId, orgId), eq(crmEstimateItems.estimateId, estimateId)));
  const [est] = await db.select().from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.id, estimateId))).limit(1);
  if (!est) return null;

  const t = estimateTotals(items, est.taxRateBps || 0);
  const [row] = await db.update(crmEstimates).set({
    subtotalCents: t.subtotalCents, discountCents: t.discountCents, taxCents: t.taxCents,
    totalCents: t.totalCents, updatedAt: new Date(),
  }).where(eq(crmEstimates.id, estimateId)).returning();
  return row;
}

async function logEvent(orgId: string, estimateId: string, type: string, actor: string, req?: any, meta?: any) {
  await db.insert(crmEstimateEvents).values({
    orgId, estimateId, type, actor,
    ip: req ? String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() : null,
    userAgent: req ? String(req.headers["user-agent"] || "").slice(0, 300) : null,
    meta: meta ?? null,
  }).catch(() => {});
}

// ── Owner-only hard deletes (test-document cleanup) ─────────────────────────

/**
 * Why an estimate may NOT be deleted, or null when it can. An approved
 * estimate is a signed contract — it is never deletable. Every other state
 * (draft/sent/viewed/declined/expired/cancelled) is fair game.
 */
export function estimateDeleteRefusal(e: { status: string; approvedAt: Date | null }): string | null {
  if (e.approvedAt || e.status === "approved") {
    return "This estimate has been approved and signed — it is a contract and cannot be deleted.";
  }
  return null;
}

/** Delete one estimate's child rows inside a transaction. */
async function deleteEstimateChildren(tx: any, orgId: string, estimateIds: string[]) {
  if (!estimateIds.length) return;
  await tx.delete(crmEstimateOptions)
    .where(and(eq(crmEstimateOptions.orgId, orgId), inArray(crmEstimateOptions.estimateId, estimateIds)));
  await tx.delete(crmEstimateDiscounts)
    .where(and(eq(crmEstimateDiscounts.orgId, orgId), inArray(crmEstimateDiscounts.estimateId, estimateIds)));
  await tx.delete(crmEstimateItems)
    .where(and(eq(crmEstimateItems.orgId, orgId), inArray(crmEstimateItems.estimateId, estimateIds)));
  await tx.delete(crmEstimateEvents)
    .where(and(eq(crmEstimateEvents.orgId, orgId), inArray(crmEstimateEvents.estimateId, estimateIds)));
  await tx.delete(crmEngagementSessions)
    .where(and(eq(crmEngagementSessions.orgId, orgId), eq(crmEngagementSessions.docType, "estimate"),
      inArray(crmEngagementSessions.docId, estimateIds)));
}

/** Delete one invoice's child rows inside a transaction. */
async function deleteInvoiceChildren(tx: any, orgId: string, invoiceIds: string[]) {
  if (!invoiceIds.length) return;
  await tx.delete(crmInvoiceItems)
    .where(and(eq(crmInvoiceItems.orgId, orgId), inArray(crmInvoiceItems.invoiceId, invoiceIds)));
  await tx.delete(crmEngagementSessions)
    .where(and(eq(crmEngagementSessions.orgId, orgId), eq(crmEngagementSessions.docType, "invoice"),
      inArray(crmEngagementSessions.docId, invoiceIds)));
}

/** A deletion note on the client's activity (Client 360 notes surface). */
async function logDeletionNote(orgId: string, customerId: string, memberId: string, body: string) {
  await db.insert(crmCustomerNotes).values({
    orgId, customerId, authorMemberId: memberId, body,
  }).catch(() => {});
}

// ── Validation ──────────────────────────────────────────────────────────────

const customerSchema = z.object({
  displayName: z.string().min(1).max(200),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  altPhone: z.string().max(40).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  leadSourceId: z.string().max(64).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  displayName: "Client name", firstName: "First name", lastName: "Last name",
  companyName: "Company name", email: "Email", phone: "Phone", altPhone: "Alternate phone",
  addressLine1: "Address", addressLine2: "Address line 2", city: "City", state: "State",
  postalCode: "ZIP code", leadSourceId: "Lead source", notes: "Notes", tags: "Tags",
  customFields: "Custom fields",
};

/** One sentence for the first thing wrong with a customer body — the toast
 *  shows `message`; the raw `issues` stay in the response for API callers. */
export function customerIssueMessage(issues: z.ZodIssue[]): string {
  const issue = issues[0];
  const field = String(issue?.path?.[0] ?? "");
  if (!issue) return "Invalid customer";
  if (field === "email") return "Enter a valid email address.";
  if (field === "displayName" && issue.code === "too_small") return "Enter the client's name.";
  const label = CUSTOMER_FIELD_LABELS[field];
  if (!label) return "Invalid customer";
  if (issue.code === "too_big") {
    if (field === "tags") {
      return issue.path.length === 1
        ? `Use ${issue.maximum} tags at most.`
        : `Each tag can be ${issue.maximum} characters at most.`;
    }
    return `${label} is too long (${issue.maximum} characters at most).`;
  }
  return `${label} isn't valid.`;
}

/** The customer fields a PATCH body actually changes (arrays and objects
 *  compare by value; a missing and a null value are the same "empty"). */
export function changedCustomerFields(before: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  const norm = (v: unknown) => JSON.stringify(v ?? null);
  return Object.keys(patch).filter((k) => norm(before[k]) !== norm(patch[k]));
}

const projectSchema = z.object({
  customerId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(CRM_PROJECT_STATUSES as unknown as [string, ...string[]]).optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  trades: z.array(z.string().max(60)).max(20).nullable().optional(),
  projectManagerMemberId: z.string().max(64).nullable().optional(),
  salesMemberId: z.string().max(64).nullable().optional(),
  divisionId: z.string().max(64).nullable().optional(),
  contractValueCents: z.number().int().min(0).nullable().optional(),
  budgetCents: z.number().int().min(0).nullable().optional(),
  permitNumber: z.string().max(80).nullable().optional(),
  parcelNumber: z.string().max(80).nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

const jobSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(200),
  trade: z.string().max(60).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(CRM_JOB_STATUSES as unknown as [string, ...string[]]).optional(),
  assignedMemberIds: z.array(z.string().max(64)).max(50).nullable().optional(),
  customFields: z.record(z.any()).nullable().optional(),
});

const itemSchema = z.object({
  kind: z.enum(CRM_LINE_ITEM_KINDS as unknown as [string, ...string[]]).default("labor"),
  name: z.string().min(1).max(300),
  // Long-form scope text — HCP-depth per-line verbiage, multi-line bullets.
  description: z.string().max(8000).nullable().optional(),
  quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
  unit: z.string().max(20).nullable().optional(),
  unitPriceCents: z.number().int().min(0).max(1_000_000_00).default(0),
  unitCostCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
  taxable: z.boolean().default(true),
  hiddenFromClient: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export function registerCrmEntityRoutes(app: Express, getDevUser: GetUser): void {
  /** Boilerplate every authed route needs: user + org + optional permission. */
  async function ctxFor(req: any, res: any, perm?: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (perm && !requirePermission(res, ctx, perm)) return null;
    return ctx;
  }

  // ── Customers ─────────────────────────────────────────────────────────────

  /** The client book for /crm/clients: paged rows (?paged=1) with whole-book
   *  bid-outcome tab counts (bidCounts) and ?q= search; without paged params it
   *  returns the legacy newest-500 array every picker relies on. */
  app.get("/api/crm/customers", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const q = String(req.query.q || "").trim().slice(0, 200);
    const where = [eq(crmCustomers.orgId, ctx.org.id), isNull(crmCustomers.archivedAt)];
    if (q) {
      // Wildcards in the search text are literal; city / ZIP / company match
      // too; and a phone typed any way ("5035599433", "(503) 559-9433")
      // matches the stored number digit-for-digit.
      const pat = likeContains(q);
      const conds: any[] = [
        ilike(crmCustomers.displayName, pat),
        ilike(crmCustomers.email, pat),
        ilike(crmCustomers.phone, pat),
        ilike(crmCustomers.addressLine1, pat),
        ilike(crmCustomers.city, pat),
        ilike(crmCustomers.postalCode, pat),
        ilike(crmCustomers.companyName, pat),
      ];
      const digits = q.replace(/\D/g, "");
      if (digits.length >= 4 && /^[\d\s().+-]+$/.test(q)) {
        conds.push(sql`regexp_replace(coalesce(${crmCustomers.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`);
      }
      where.push(or(...conds) as any);
    }

    // Bid outcome per client, for the Won / Undecided / Declined tabs: any
    // approved estimate wins; else an open (sent/viewed) one means undecided;
    // else any declined means declined; no bids → "none".
    const outcomesFor = async (ids: string[]) => {
      const outcome = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        const agg = await db.select({
          customerId: crmEstimates.customerId,
          approved: sql<number>`count(*) filter (where ${crmEstimates.status} = 'approved')::int`,
          open: sql<number>`count(*) filter (where ${crmEstimates.status} in ('sent','viewed'))::int`,
          declined: sql<number>`count(*) filter (where ${crmEstimates.status} = 'declined')::int`,
        }).from(crmEstimates).where(and(eq(crmEstimates.orgId, ctx.org.id), inArray(crmEstimates.customerId, chunk)))
          .groupBy(crmEstimates.customerId);
        for (const a of agg) {
          outcome.set(a.customerId,
            a.approved > 0 ? "won" : a.open > 0 ? "undecided" : a.declined > 0 ? "declined" : "none");
        }
      }
      return outcome;
    };
    // The client list itself is shareable with a PM; pricing lives elsewhere.
    const present = (rows: (typeof crmCustomers.$inferSelect)[], outcome: Map<string, string>) =>
      rows.map((c) => ({ ...c, portalToken: undefined, bidStatus: outcome.get(c.id) ?? "none" }));

    // Paged mode (opt-in with ?paged=1, or any limit/offset): { rows, total,
    // bidCounts, limit, offset }. bidCounts cover EVERY client the caller may
    // see (under the same search), not just the returned page, so the tabs
    // count the whole book. ?bidStatus=won|undecided|declined|none filters on
    // the server, so a tab pages through every matching client rather than
    // the pages loaded so far; total is the number of clients that match
    // (search and bidStatus), so the list can say "Showing 100 of 2,527".
    const paged = req.query.paged === "1" || req.query.limit !== undefined || req.query.offset !== undefined
      || req.query.bidStatus !== undefined;
    if (paged) {
      const int = (v: any, dflt: number, min: number, max: number) => {
        const n = parseInt(String(v ?? ""), 10);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
      };
      const limit = int(req.query.limit, 100, 1, 500);
      const offset = int(req.query.offset, 0, 0, 1_000_000);
      const bidStatus = req.query.bidStatus === undefined || req.query.bidStatus === "" || req.query.bidStatus === "all"
        ? null : String(req.query.bidStatus);
      if (bidStatus && !["won", "undecided", "declined", "none"].includes(bidStatus)) {
        return res.status(400).json({ message: "bidStatus must be one of: won, undecided, declined, none." });
      }
      const all = await objectPolicy(ctx).filter("customers",
        await db.select().from(crmCustomers).where(and(...where)).orderBy(desc(crmCustomers.createdAt)));
      const outcome = await outcomesFor(all.map((c) => c.id));
      const bidCounts = { won: 0, undecided: 0, declined: 0, none: 0 } as Record<string, number>;
      for (const c of all) bidCounts[outcome.get(c.id) ?? "none"] += 1;
      const matching = bidStatus ? all.filter((c) => (outcome.get(c.id) ?? "none") === bidStatus) : all;
      const page = matching.slice(offset, offset + limit);
      return res.json({ rows: present(page, outcome), total: matching.length, bidCounts, limit, offset });
    }

    // Legacy shape: bare array of the newest 500 (every picker relies on it).
    let rows = await db.select().from(crmCustomers).where(and(...where))
      .orderBy(desc(crmCustomers.createdAt)).limit(500);
    rows = await objectPolicy(ctx).filter("customers", rows);
    res.json(present(rows, await outcomesFor(rows.map((c) => c.id))));
  });

  /** Creates the client (portal token minted with the row) for the New-client
   *  dialog on /crm/clients and the quick-builder step 1; a 409 names existing
   *  email/phone matches unless ?force=1. */
  app.post("/api/crm/customers", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: customerIssueMessage(parsed.error.issues), issues: parsed.error.issues });
    }

    // Dedupe. Leap admits it cannot merge customer records or move a job between
    // them ("the answer is no, not currently"), so their users accumulate
    // duplicates permanently. Refuse the duplicate at the door instead, and tell
    // the caller which record already exists.
    const dupeOn = [
      parsed.data.email ? sql`lower(${crmCustomers.email}) = ${parsed.data.email.toLowerCase()}` : null,
      parsed.data.phone ? sql`regexp_replace(${crmCustomers.phone}, '[^0-9]', '', 'g') = ${parsed.data.phone.replace(/\D/g, "")}` : null,
    ].filter(Boolean) as any[];
    if (dupeOn.length && req.query.force !== "1") {
      const existing = await db.select().from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), isNull(crmCustomers.archivedAt),
          or(...dupeOn) as any)).limit(3);
      if (existing.length) {
        return res.status(409).json({
          message: "A client with that email or phone already exists.",
          matches: existing.map((c) => ({
            id: c.id, displayName: c.displayName, email: c.email, phone: c.phone,
          })),
          hint: "Open the existing client, or POST again with ?force=1 to create anyway.",
        });
      }
    }

    // The client portal is created WITH the customer — that's the requirement.
    const [row] = await db.insert(crmCustomers).values({
      ...parsed.data, orgId: ctx.org.id, ownerMemberId: ctx.member.id, portalToken: token(),
    } as any).returning();
    logActivity(ctx, "customer.created", {
      entityType: "customer", entityId: row.id, customerId: row.id,
      meta: { name: row.displayName },
    });
    res.status(201).json({ ...row, portalToken: undefined, portalPath: canShareWholeClientPortal(ctx) ? `/portal/${row.portalToken}` : undefined });
  });

  /**
   * Bulk client export — one CSV of the org's clients. Gated by the
   * exportData permission (owner by default, grantable per seat on the team
   * page); every export lands in the activity log as data.exported.
   * Registered BEFORE /api/crm/customers/:id so "export.csv" is never read
   * as a customer id.
   */
  app.get("/api/crm/customers/export.csv", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "exportData");
    if (!ctx) return;

    let rows = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), isNull(crmCustomers.archivedAt)))
      .orderBy(asc(crmCustomers.displayName)).limit(10000);

    rows = await objectPolicy(ctx).filter("customers", rows);
    const header = ["id", "name", "email", "phone", "address", "city", "state", "postal_code", "notes", "created_at"];
    const lines = rows.map((c) => [
      c.id, c.displayName, c.email, c.phone, c.addressLine1, c.city, c.state, c.postalCode, c.notes,
      c.createdAt ? new Date(c.createdAt).toISOString() : "",
    ].map(csvCell).join(","));
    const csv = [header.join(","), ...lines].join("\n") + "\n";

    logActivity(ctx, "data.exported", {
      entityType: "customers", meta: { rows: rows.length },
    });
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${ctx.org.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-clients.csv"`);
    res.send(csv);
  });

  /** One client for /crm/clients/:id (identity card, projects, estimates) and
   *  every picker's prefetch; portalPath is included only for seats that may
   *  share the whole-client portal. */
  app.get("/api/crm/customers/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [c] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!c) return res.status(404).json({ message: "Customer not found" });

    const projects = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.customerId, c.id)))
      .orderBy(desc(crmProjects.createdAt));
    const estimates = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.customerId, c.id)))
      .orderBy(desc(crmEstimates.createdAt));

    res.json({
      customer: { ...c, portalToken: undefined },
      // Only someone who can manage customers gets the shareable portal link.
      portalPath: canShareWholeClientPortal(ctx) ? `/portal/${c.portalToken}` : undefined,
      projects: (await objectPolicy(ctx).filter("projects", projects)).map((p) => presentProject(p, ctx)),
      estimates: (await objectPolicy(ctx).filter("estimates", estimates)).map((e) => presentEstimate(e, ctx)),
    });
  });

  /** Field edits from the client page's Edit dialog; the activity log names
   *  only the fields that actually changed. */
  app.patch("/api/crm/customers/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageCustomers");
    if (!ctx) return;
    const parsed = customerSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: customerIssueMessage(parsed.error.issues), issues: parsed.error.issues });
    }
    const [before] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!before) return res.status(404).json({ message: "Customer not found" });
    const [row] = await db.update(crmCustomers)
      .set({ ...parsed.data, updatedAt: new Date() } as any)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.id)))
      .returning();
    if (!row) return res.status(404).json({ message: "Customer not found" });
    // The audit line names only what really changed — a client (or API
    // caller) resending the whole record must not log every field as edited.
    const fields = changedCustomerFields(before as Record<string, unknown>, parsed.data);
    if (fields.length) {
      logActivity(ctx, "customer.updated", {
        entityType: "customer", entityId: row.id, customerId: row.id,
        meta: { fields },
      });
    }
    res.json({ ...row, portalToken: undefined });
  });

  /**
   * Hard-delete a client — OWNER only (requireOwnerRole, never a permission
   * flag), for cleaning up test records. A client with ANY estimates,
   * invoices, projects or calendar visits is refused with 409 (the counts in
   * the body, for the confirm dialog) unless ?force=1 is passed, which
   * deletes the whole tree transactionally (documents, line items, payments,
   * jobs, the projects' change orders / punch list / daily logs / selections
   * / budget, costs and phases, measurements, notes, comments, visits —
   * everything under the client).
   */
  app.delete("/api/crm/customers/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    const orgId = ctx.org.id;
    const [c] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, req.params.id))).limit(1);
    if (!c) return res.status(404).json({ message: "Customer not found" });

    const countOf = async (t: any, col: any) => {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(t)
        .where(and(eq(t.orgId, orgId), eq(col, c.id)));
      return n;
    };
    const estimates = await countOf(crmEstimates, crmEstimates.customerId);
    const invoices = await countOf(crmInvoices, crmInvoices.customerId);
    const projects = await countOf(crmProjects, crmProjects.customerId);
    // Visits on the calendar — the client's own, or booked against one of
    // their projects, whatever the date. They go with the client (no FK
    // would catch them, and a visit for a deleted client is an orphan on the
    // schedule), so a client with visits needs the same confirmation as one
    // with documents, and the count names them.
    const [{ n: appointments }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmAppointments)
      .where(and(
        eq(crmAppointments.orgId, orgId),
        or(
          eq(crmAppointments.customerId, c.id),
          sql`${crmAppointments.projectId} in (select ${crmProjects.id} from ${crmProjects} where ${crmProjects.orgId} = ${orgId} and ${crmProjects.customerId} = ${c.id})`,
        ),
      ));
    const force = req.query.force === "1";
    if ((estimates || invoices || projects || appointments) && !force) {
      return res.status(409).json({
        message: `This client has ${estimates} estimate(s), ${invoices} invoice(s), ${projects} project(s) ` +
          `and ${appointments} scheduled visit(s). Deleting removes the entire tree — every document, ` +
          "project record (change orders, punch list, daily logs, selections, budget and costs) and visit — " +
          "call DELETE again with ?force=1 to confirm.",
        estimates, invoices, projects, appointments,
      });
    }

    await db.transaction(async (tx) => {
      const estIds = (await tx.select({ id: crmEstimates.id }).from(crmEstimates)
        .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.customerId, c.id)))).map((r: any) => r.id);
      const invIds = (await tx.select({ id: crmInvoices.id }).from(crmInvoices)
        .where(and(eq(crmInvoices.orgId, orgId), eq(crmInvoices.customerId, c.id)))).map((r: any) => r.id);
      const projIds = (await tx.select({ id: crmProjects.id }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.customerId, c.id)))).map((r: any) => r.id);

      await deleteEstimateChildren(tx, orgId, estIds);
      await deleteInvoiceChildren(tx, orgId, invIds);
      await tx.delete(crmPayments)
        .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.customerId, c.id)));
      if (estIds.length) {
        await tx.delete(crmAttachments)
          .where(and(eq(crmAttachments.orgId, orgId), inArray(crmAttachments.refId, estIds)));
      }
      if (invIds.length) {
        await tx.delete(crmInvoices)
          .where(and(eq(crmInvoices.orgId, orgId), inArray(crmInvoices.id, invIds)));
      }
      if (estIds.length) {
        await tx.delete(crmEstimates)
          .where(and(eq(crmEstimates.orgId, orgId), inArray(crmEstimates.id, estIds)));
      }
      // Calendar visits: the client's own, plus any booked against their projects.
      await tx.delete(crmAppointments)
        .where(and(
          eq(crmAppointments.orgId, orgId),
          projIds.length
            ? or(eq(crmAppointments.customerId, c.id), inArray(crmAppointments.projectId, projIds))
            : eq(crmAppointments.customerId, c.id),
        ));
      await tx.delete(crmMeasurements)
        .where(and(
          eq(crmMeasurements.orgId, orgId),
          projIds.length
            ? or(eq(crmMeasurements.customerId, c.id), inArray(crmMeasurements.projectId, projIds))
            : eq(crmMeasurements.customerId, c.id),
        ));
      await tx.delete(crmChangeOrders)
        .where(and(eq(crmChangeOrders.orgId, orgId), eq(crmChangeOrders.customerId, c.id)));
      if (projIds.length) {
        // Everything hanging off the projects — "the entire tree" means the
        // field and job-cost records too, or a public change-order link keeps
        // serving a deleted client's work.
        await tx.delete(crmChangeOrders)
          .where(and(eq(crmChangeOrders.orgId, orgId), inArray(crmChangeOrders.projectId, projIds)));
        await tx.delete(crmPunchItems)
          .where(and(eq(crmPunchItems.orgId, orgId), inArray(crmPunchItems.projectId, projIds)));
        await tx.delete(crmDailyLogs)
          .where(and(eq(crmDailyLogs.orgId, orgId), inArray(crmDailyLogs.projectId, projIds)));
        await tx.delete(crmSelections)
          .where(and(eq(crmSelections.orgId, orgId), inArray(crmSelections.projectId, projIds)));
        await tx.delete(crmCostEntries)
          .where(and(eq(crmCostEntries.orgId, orgId), inArray(crmCostEntries.projectId, projIds)));
        await tx.delete(crmCommitments)
          .where(and(eq(crmCommitments.orgId, orgId), inArray(crmCommitments.projectId, projIds)));
        await tx.delete(crmBudgetLines)
          .where(and(eq(crmBudgetLines.orgId, orgId), inArray(crmBudgetLines.projectId, projIds)));
        await tx.delete(crmPhases)
          .where(and(eq(crmPhases.orgId, orgId), inArray(crmPhases.projectId, projIds)));
        await tx.delete(crmAttachments)
          .where(and(eq(crmAttachments.orgId, orgId), inArray(crmAttachments.refId, projIds)));
        await tx.delete(crmJobs)
          .where(and(eq(crmJobs.orgId, orgId), inArray(crmJobs.projectId, projIds)));
        await tx.delete(crmProjects)
          .where(and(eq(crmProjects.orgId, orgId), inArray(crmProjects.id, projIds)));
      }
      await tx.delete(crmCustomerNotes)
        .where(and(eq(crmCustomerNotes.orgId, orgId), eq(crmCustomerNotes.customerId, c.id)));
      await tx.delete(crmClientComments)
        .where(and(eq(crmClientComments.orgId, orgId), eq(crmClientComments.customerId, c.id)));
      await tx.delete(crmFinanceClicks)
        .where(and(eq(crmFinanceClicks.orgId, orgId), eq(crmFinanceClicks.customerId, c.id)));
      await tx.delete(crmAttachments)
        .where(and(eq(crmAttachments.orgId, orgId), eq(crmAttachments.refId, c.id)));
      // Bell items that open this client (their page or inbox thread) or one
      // of their projects — left behind they would link to a deleted record.
      const linkPrefix = (path: string) => `${path.replace(/[\\%_]/g, "\\$&")}%`;
      await tx.delete(crmNotifications)
        .where(and(eq(crmNotifications.orgId, orgId), or(
          sql`${crmNotifications.link} like ${linkPrefix(`/crm/clients/${c.id}`)}`,
          sql`${crmNotifications.link} like ${linkPrefix(`/crm/inbox?c=${c.id}`)}`,
          ...projIds.map((id) => sql`${crmNotifications.link} like ${linkPrefix(`/crm/projects/${id}`)}`),
        )));
      await tx.delete(crmCustomers)
        .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, c.id)));
    });

    console.log(`[crm] owner ${ctx.member.id} deleted customer ${c.id} (${c.displayName}) in org ${orgId}` +
      (force ? ` — force tree: ${estimates} estimates, ${invoices} invoices, ${projects} projects, ${appointments} visits` : ""));
    logActivity(ctx, "customer.deleted", {
      entityType: "customer", entityId: c.id, customerId: c.id,
      meta: { name: c.displayName, force },
    });
    res.json({ ok: true, deleted: c.id, force });
  });

  // ── Projects ──────────────────────────────────────────────────────────────

  /** The pipeline board's payload: the newest 2000 cards plus UNcapped
   *  per-stage counts and totalProjects, so tall columns still count true. */
  app.get("/api/crm/projects", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const where = [eq(crmProjects.orgId, ctx.org.id), isNull(crmProjects.archivedAt)];
    if (req.query.status) where.push(eq(crmProjects.status, String(req.query.status)));
    if (req.query.customerId) where.push(eq(crmProjects.customerId, String(req.query.customerId)));
    // A field tech without viewAllJobs sees only projects they're PM on.
    if (!ctx.permissions.viewAllJobs) {
      const allowed = await objectPolicy(ctx).filter("projects", await db.select().from(crmProjects).where(eq(crmProjects.orgId, ctx.org.id)));
      where.push(inArray(crmProjects.id, allowed.map(p => p.id)));
    }
    // A division-scoped member sees ONLY their division's projects — the
    // unassigned commons stay with owners and division-less members (STRICT).
    const divScope = divisionScopeOf(ctx.member);
    if (divScope) {
      where.push(eq(crmProjects.divisionId, divScope));
    }

    // Accurate per-stage totals (a COUNT, never capped) so the board can show
    // the true book even when the card list is bounded — a mature org must not
    // see empty columns just because older projects fell past the row cap.
    const countRows = await db.select({
      status: crmProjects.status,
      n: sql<number>`count(*)::int`,
    }).from(crmProjects).where(and(...where)).groupBy(crmProjects.status);
    const stageCounts: Record<string, number> = {};
    for (const r of countRows) stageCounts[r.status] = r.n;

    const rows = await db.select().from(crmProjects).where(and(...where))
      .orderBy(desc(crmProjects.createdAt)).limit(2000);
    res.json({
      projects: rows.map((p) => presentProject(p, ctx)),
      stages: CRM_PROJECT_STATUSES.map((s) => ({ key: s, ...CRM_PROJECT_STAGE_META[s] })),
      stageCounts,
      totalProjects: Object.values(stageCounts).reduce((a, b) => a + b, 0),
    });
  });

  /** New project/lead for the client page's Add-to-pipeline and the pipeline's
   *  New-lead dialog; numbered P-#### under the per-org lock, lands in the
   *  first stage. */
  app.post("/api/crm/projects", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = projectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid project", issues: parsed.error.issues });

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, parsed.data.customerId))).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found in this organization" });
    if (parsed.data.divisionId) {
      const div = await getDivision(ctx.org.id, parsed.data.divisionId);
      if (!div) return res.status(400).json({ message: "Division not found in this organization" });
    }

    // Number and insert in one transaction under the per-org number lock —
    // never count(*)+1, which repeats after a delete and races.
    const row = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, crmProjects, ctx.org.id, "P");
      const [inserted] = await tx.insert(crmProjects).values({
        ...parsed.data, divisionId: parsed.data.divisionId ?? divisionScopeOf(ctx.member), orgId: ctx.org.id, number,
      } as any).returning();
      return inserted;
    });
    res.status(201).json(presentProject(row, ctx));
  });

  /** Card moves (board drag&drop / stage menu), the edit dialog and contract
   *  value; stageChangedAt restarts only when the status actually changes. */
  app.patch("/api/crm/projects/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = projectSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid project", issues: parsed.error.issues });
    if (parsed.data.customerId) {
      const [customer] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, parsed.data.customerId))).limit(1);
      if (!customer) return res.status(400).json({ message: "Customer not found in this organization" });
    }
    // budget is cost-side data
    if (parsed.data.budgetCents !== undefined && !ctx.permissions.seeCosts) {
      return res.status(403).json({ message: "Requires permission: seeCosts" });
    }
    if (parsed.data.divisionId) {
      const div = await getDivision(ctx.org.id, parsed.data.divisionId);
      if (!div) return res.status(400).json({ message: "Division not found in this organization" });
    }
    const [before] = await db.select({ status: crmProjects.status }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, req.params.id))).limit(1);
    const patch: any = { ...parsed.data, updatedAt: new Date() };
    // Time-in-stage restarts only on a real move — the edit dialog and API
    // callers may resend the unchanged status with other edits.
    if (parsed.data.status && before?.status !== parsed.data.status) patch.stageChangedAt = new Date();
    const [row] = await db.update(crmProjects).set(patch)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Project not found" });
    if (parsed.data.status && before && before.status !== parsed.data.status) {
      await logTeamActivity({
        orgId: ctx.org.id, memberId: ctx.member.id,
        type: "projectStage",
        title: `moved ${row.name} to ${projectStageLabel(row.status)}`,
        link: `/crm/projects/${row.id}`,
      });
    }
    res.json(presentProject(row, ctx));
  });

  /** One project for /crm/projects/:id — the board list caps at the newest
   *  2000, so a direct link to an older project must not depend on it. */
  app.get("/api/crm/projects/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    // A malformed id (a mistyped link) is simply not found — never a Postgres uuid error.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) {
      return res.status(404).json({ message: "Project not found" });
    }
    const [row] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, req.params.id))).limit(1);
    if (!row || !(await objectPolicy(ctx).visible("projects", row.id))) {
      return res.status(404).json({ message: "Project not found" });
    }
    res.json(presentProject(row, ctx));
  });

  // ── Jobs (per-trade scopes) ───────────────────────────────────────────────

  app.get("/api/crm/jobs", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const where = [eq(crmJobs.orgId, ctx.org.id)];
    if (req.query.projectId) where.push(eq(crmJobs.projectId, String(req.query.projectId)));
    const rows = await db.select().from(crmJobs).where(and(...where)).orderBy(desc(crmJobs.createdAt)).limit(500);
    let visible = ctx.permissions.viewAllJobs
      ? rows
      : rows.filter((j) => (j.assignedMemberIds || []).includes(ctx.member.id));
    // Division scoping follows the job's project.
    const divScope = divisionScopeOf(ctx.member);
    if (divScope) {
      const maps = await divisionMapsForOrg(ctx.org.id);
      visible = visible.filter((j) => divisionVisible(divScope, maps.byProject.get(j.projectId) ?? null));
    }
    res.json({ jobs: visible, statuses: CRM_JOB_STATUSES });
  });

  app.post("/api/crm/jobs", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = jobSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid job", issues: parsed.error.issues });
    const [proj] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, parsed.data.projectId))).limit(1);
    if (!proj) return res.status(400).json({ message: "Project not found in this organization" });
    const [row] = await db.insert(crmJobs).values({ ...parsed.data, orgId: ctx.org.id } as any).returning();
    res.status(201).json(row);
  });

  app.patch("/api/crm/jobs/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageJobs");
    if (!ctx) return;
    const parsed = jobSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid job", issues: parsed.error.issues });
    if (parsed.data.projectId) {
      const [project] = await db.select({ id: crmProjects.id }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, parsed.data.projectId))).limit(1);
      if (!project) return res.status(400).json({ message: "Project not found in this organization" });
    }
    const [beforeJob] = await db.select({ status: crmJobs.status }).from(crmJobs)
      .where(and(eq(crmJobs.orgId, ctx.org.id), eq(crmJobs.id, req.params.id))).limit(1);
    const [row] = await db.update(crmJobs).set({ ...parsed.data, updatedAt: new Date() } as any)
      .where(and(eq(crmJobs.orgId, ctx.org.id), eq(crmJobs.id, req.params.id))).returning();
    if (!row) return res.status(404).json({ message: "Job not found" });
    if (parsed.data.status && beforeJob && beforeJob.status !== parsed.data.status) {
      await logTeamActivity({
        orgId: ctx.org.id, memberId: ctx.member.id,
        type: "jobStatus",
        title: parsed.data.status === "scheduled"
          ? `scheduled ${row.name}`
          : `moved job ${row.name} to ${row.status.replace(/_/g, " ")}`,
        link: `/crm/projects/${row.projectId}`,
      });
    }
    res.json(row);
  });

  // ── Estimates ─────────────────────────────────────────────────────────────

  /** The /crm/estimates Documents Center list: doc-mode (statuses/date range/search/sort + filtered/total counts) with a single status, otherwise the legacy newest-500 array the client page and pickers use. */
  app.get("/api/crm/estimates", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const dq = parseDocQuery(req.query, CRM_ESTIMATE_STATUSES);
    if (!dq) {
      // Legacy shape: bare array, single-value status filter, 500-row cap.
      const where = [eq(crmEstimates.orgId, ctx.org.id)];
      if (req.query.customerId) where.push(eq(crmEstimates.customerId, String(req.query.customerId)));
      if (req.query.status) where.push(eq(crmEstimates.status, String(req.query.status)));
      let rows = await db.select().from(crmEstimates).where(and(...where))
        .orderBy(desc(crmEstimates.createdAt)).limit(500);
      rows = await objectPolicy(ctx).filter("estimates", rows);
      return res.json(rows.map((e) => presentEstimate(e, ctx)));
    }

    // ── Documents Center mode: SQL-level status list / date range / search /
    // sort, customer name joined in, and count summary for "23 of 451".
    const dateCol = dq.dateField === "sent" ? crmEstimates.sentAt : crmEstimates.createdAt;
    const where: any[] = [eq(crmEstimates.orgId, ctx.org.id)];
    if (req.query.customerId) where.push(eq(crmEstimates.customerId, String(req.query.customerId)));
    if (dq.statuses.length) {
      // "expired" is derived (nothing writes it on a timer): a sent/viewed,
      // unanswered estimate past its expiry — plus any row a person marked
      // expired by hand. `lt` binds through the column, so the timestamp
      // comparison happens in the same (UTC) terms the rows were written in.
      // The mirror image: Sent / Viewed alone leave out the derived-expired
      // rows (the list shows those as expired), unless Expired is ticked too.
      const now = new Date();
      const withExpired = dq.statuses.includes("expired");
      const open = dq.statuses.filter((s) => s === "sent" || s === "viewed");
      const rest = dq.statuses.filter((s) => s !== "sent" && s !== "viewed");
      const conds: any[] = [];
      if (rest.length) conds.push(inArray(crmEstimates.status, rest));
      if (open.length) {
        conds.push(withExpired
          ? inArray(crmEstimates.status, open)
          : and(
            inArray(crmEstimates.status, open),
            or(
              isNull(crmEstimates.expiresAt),
              gte(crmEstimates.expiresAt, now),
              isNotNull(crmEstimates.approvedAt),
              isNotNull(crmEstimates.declinedAt),
            ),
          ));
      }
      if (withExpired) {
        conds.push(and(
          inArray(crmEstimates.status, ["sent", "viewed"]),
          isNotNull(crmEstimates.expiresAt),
          lt(crmEstimates.expiresAt, now),
          isNull(crmEstimates.approvedAt),
          isNull(crmEstimates.declinedAt),
        ));
      }
      where.push(conds.length === 1 ? conds[0] : (or(...conds) as any));
    }
    if (dq.from) where.push(gte(dateCol, dq.from));
    if (dq.to) where.push(lte(dateCol, dq.to));
    if (dq.q) {
      const pat = likeContains(dq.q);
      where.push(or(
        ilike(crmEstimates.number, pat),
        ilike(crmEstimates.title, pat),
        ilike(crmCustomers.displayName, pat),
      ) as any);
    }
    const order = dq.sort === "oldest" ? asc(crmEstimates.createdAt)
      : dq.sort === "largest" ? desc(crmEstimates.totalCents)
      : desc(crmEstimates.createdAt);
    const joinCust = and(
      eq(crmCustomers.id, crmEstimates.customerId),
      eq(crmCustomers.orgId, ctx.org.id),
    );

    const divScope = divisionScopeOf(ctx.member);
    let rows: { doc: typeof crmEstimates.$inferSelect; customerName: string | null }[];
    let filtered: number;
    let total: number;
    if (divScope || !ctx.permissions.viewAllJobs) {
      const access = objectPolicy(ctx);
      const all = await db.select({ doc: crmEstimates, customerName: crmCustomers.displayName })
        .from(crmEstimates).leftJoin(crmCustomers, joinCust)
        .where(and(...where)).orderBy(order);
      const ids = new Set((await access.filter("estimates", all.map(r => r.doc))).map(r => r.id));
      const visible = all.filter(r => ids.has(r.doc.id));
      filtered = visible.length;
      rows = visible.slice(dq.offset, dq.offset + dq.limit);
      total = (await access.filter("estimates", await db.select().from(crmEstimates).where(eq(crmEstimates.orgId, ctx.org.id)))).length;
    } else {
      // A stable tiebreak (id) so pages never repeat or skip a row that
      // shares a timestamp/total with its neighbour.
      rows = await db.select({ doc: crmEstimates, customerName: crmCustomers.displayName })
        .from(crmEstimates).leftJoin(crmCustomers, joinCust)
        .where(and(...where)).orderBy(order, asc(crmEstimates.id)).limit(dq.limit).offset(dq.offset);
      const [{ n: f }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(crmEstimates).leftJoin(crmCustomers, joinCust).where(and(...where));
      filtered = f;
      const [{ n: t }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(crmEstimates).where(eq(crmEstimates.orgId, ctx.org.id));
      total = t;
    }
    res.json({
      // List rows are slim — no intro/terms text (a 2,700-row org was
      // shipping 5 MB of terms the table never shows).
      rows: rows.map((r) => ({ ...presentEstimateRow(r.doc, ctx), customerName: r.customerName ?? null })),
      total,
      filtered,
      limit: dq.limit,
      offset: dq.offset,
    });
  });

  // routes.ts registers entity routes before ops routes, so this handler is
  // the one Express serves for GET /api/crm/invoices. The legacy branch
  // reproduces the original ops.ts behaviour exactly (bare array, 403 without
  // seePrices, project/customer filters, division scoping); document params
  // unlock the Documents Center filters. Do not "fix" the duplication in
  // ops.ts — that file belongs to the construction-side module.
  app.get("/api/crm/invoices", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!ctx.permissions.seePrices) return res.status(403).json({ message: "Requires permission: seePrices" });
    const dq = parseDocQuery(req.query, CRM_INVOICE_STATUSES, ["overdue"], true);
    if (!dq) {
      const where = [eq(crmInvoices.orgId, ctx.org.id)];
      if (req.query.projectId) where.push(eq(crmInvoices.projectId, String(req.query.projectId)));
      if (req.query.customerId) where.push(eq(crmInvoices.customerId, String(req.query.customerId)));
      let rows = await db.select().from(crmInvoices).where(and(...where))
        .orderBy(desc(crmInvoices.createdAt)).limit(500);
      const divScope = divisionScopeOf(ctx.member);
      if (divScope) {
        const maps = await divisionMapsForOrg(ctx.org.id);
        rows = rows.filter((i) => divisionVisible(divScope, docDivisionFromMaps(maps, i)));
      }
      rows = await objectPolicy(ctx).filter("invoices", rows);
      return res.json(await invoiceRefundTotals(ctx.org.id, rows));
    }

    // ── Documents Center mode. "overdue" is derived, never stored: an open
    // (sent/partial) invoice past its due date with a balance still due.
    const overdueSql = sql`(${crmInvoices.status} in ('sent','partial') and ${crmInvoices.dueAt} is not null and ${crmInvoices.dueAt} < now() and ${crmInvoices.paidCents} < ${crmInvoices.totalCents})`;
    const dateCol = dq.dateField === "sent" ? crmInvoices.sentAt : crmInvoices.createdAt;
    const where: any[] = [eq(crmInvoices.orgId, ctx.org.id)];
    if (req.query.projectId) where.push(eq(crmInvoices.projectId, String(req.query.projectId)));
    if (req.query.customerId) where.push(eq(crmInvoices.customerId, String(req.query.customerId)));
    if (dq.statuses.length) {
      const plain = dq.statuses.filter((s) => s !== "overdue");
      const conds: any[] = [];
      if (plain.length) conds.push(inArray(crmInvoices.status, plain));
      if (dq.statuses.includes("overdue")) conds.push(overdueSql);
      where.push(conds.length === 1 ? conds[0] : (or(...conds) as any));
    }
    if (dq.from) where.push(gte(dateCol, dq.from));
    if (dq.to) where.push(lte(dateCol, dq.to));
    if (dq.q) {
      const pat = likeContains(dq.q);
      where.push(or(
        ilike(crmInvoices.number, pat),
        ilike(crmInvoices.title, pat),
        ilike(crmCustomers.displayName, pat),
      ) as any);
    }
    const order = dq.sort === "oldest" ? asc(crmInvoices.createdAt)
      : dq.sort === "largest" ? desc(crmInvoices.totalCents)
      : desc(crmInvoices.createdAt);
    const joinCust = and(
      eq(crmCustomers.id, crmInvoices.customerId),
      eq(crmCustomers.orgId, ctx.org.id),
    );

    const isOverdue = (i: typeof crmInvoices.$inferSelect) =>
      (i.status === "sent" || i.status === "partial") &&
      i.dueAt != null && new Date(i.dueAt).getTime() < Date.now() &&
      (i.paidCents ?? 0) < (i.totalCents ?? 0);

    const divScope = divisionScopeOf(ctx.member);
    let rows: { doc: typeof crmInvoices.$inferSelect; customerName: string | null }[];
    let filtered: number;
    let total: number;
    if (divScope || !ctx.permissions.viewAllJobs) {
      const access = objectPolicy(ctx);
      const all = await db.select({ doc: crmInvoices, customerName: crmCustomers.displayName })
        .from(crmInvoices).leftJoin(crmCustomers, joinCust)
        .where(and(...where)).orderBy(order);
      const ids = new Set((await access.filter("invoices", all.map(r => r.doc))).map(r => r.id));
      const visible = all.filter(r => ids.has(r.doc.id));
      filtered = visible.length;
      rows = visible.slice(dq.offset, dq.offset + dq.limit);
      total = (await access.filter("invoices", await db.select().from(crmInvoices).where(eq(crmInvoices.orgId, ctx.org.id)))).length;
    } else {
      rows = await db.select({ doc: crmInvoices, customerName: crmCustomers.displayName })
        .from(crmInvoices).leftJoin(crmCustomers, joinCust)
        .where(and(...where)).orderBy(order, asc(crmInvoices.id)).limit(dq.limit).offset(dq.offset);
      const [{ n: f }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(crmInvoices).leftJoin(crmCustomers, joinCust).where(and(...where));
      filtered = f;
      const [{ n: t }] = await db.select({ n: sql<number>`count(*)::int` })
        .from(crmInvoices).where(eq(crmInvoices.orgId, ctx.org.id));
      total = t;
    }
    res.json({
      rows: await invoiceRefundTotals(ctx.org.id, rows.map((r) => ({ ...r.doc, customerName: r.customerName ?? null, overdue: isOverdue(r.doc) }))),
      total,
      filtered,
      limit: dq.limit,
      offset: dq.offset,
    });
  });

  /** Creates the estimate (client-page dialog, quick builder, /crm/estimates/new); totals are always recomputed server-side, and a tax hook fills an omitted taxRateBps from the job address before this runs. */
  app.post("/api/crm/estimates", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const schema = z.object({
      customerId: z.string().min(1),
      projectId: z.string().nullable().optional(),
      // Explicit letterhead division (FL/WA). Null → resolved from the project.
      divisionId: z.string().max(64).nullable().optional(),
      title: z.string().max(200).default("Estimate"),
      introText: z.string().max(8000).nullable().optional(),
      termsText: z.string().max(20000).nullable().optional(),
      taxRateBps: z.number().int().min(0).max(3000).default(0),
      depositCents: z.number().int().min(0).nullable().optional(),
      items: z.array(itemSchema).max(300).default([]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid estimate", issues: parsed.error.issues });
    const d = parsed.data;

    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, d.customerId))).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found in this organization" });
    if (d.projectId) {
      const [project] = await db.select({ id: crmProjects.id }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, d.projectId))).limit(1);
      if (!project) return res.status(400).json({ message: "Project not found in this organization" });
    }
    if (d.divisionId) {
      const div = await getDivision(ctx.org.id, d.divisionId);
      if (!div) return res.status(400).json({ message: "Division not found in this organization" });
    }

    // Price-floor lock: non-owners may price above the floor, never below.
    const floorMsg = await priceFloorViolation(ctx, d.items);
    if (floorMsg) return res.status(422).json({ message: floorMsg });

    const depositMsg = depositRefusal(d.depositCents, estimateTotals(d.items, d.taxRateBps).totalCents);
    if (depositMsg) return res.status(400).json({ message: depositMsg });

    const est = await db.transaction(async (tx) => {
      const number = await nextDocNumber(tx, crmEstimates, ctx.org.id, "E");
      const [row] = await tx.insert(crmEstimates).values({
        orgId: ctx.org.id, customerId: d.customerId, projectId: d.projectId ?? null,
        divisionId: d.divisionId ?? divisionScopeOf(ctx.member),
        number, title: d.title, introText: d.introText ?? null,
        termsText: d.termsText ?? ctx.org.termsAndConditions ?? null,
        taxRateBps: d.taxRateBps, depositCents: d.depositCents ?? null,
        publicToken: token(), createdByMemberId: ctx.member.id,
        // No expiry on a draft — the 7-day clock starts when it is SENT
        // (portal.ts), so a draft never burns its validity window unsent.
      } as any).returning();
      return row;
    });

    if (d.items.length) {
      await db.insert(crmEstimateItems).values(
        d.items.map((it, idx) => ({ ...it, orgId: ctx.org.id, estimateId: est.id, sortOrder: it.sortOrder ?? idx })) as any,
      );
    }
    const fresh = await recalcEstimate(ctx.org.id, est.id);
    await logEvent(ctx.org.id, est.id, "created", ctx.member.id, req);
    logActivity(ctx, "estimate.created", {
      entityType: "estimate", entityId: est.id, customerId: est.customerId,
      meta: { number: est.number, totalCents: fresh?.totalCents ?? est.totalCents },
    });
    res.status(201).json(presentEstimate(fresh ?? est, ctx));
  });

  /** Estimate detail for /crm/estimates/:id: estimate + line items + event trail + customer + publicPath (the /e/<token> client link). */
  app.get("/api/crm/estimates/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const [e] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!e) return res.status(404).json({ message: "Estimate not found" });
    const items = await db.select().from(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, e.id)))
      .orderBy(asc(crmEstimateItems.sortOrder));
    const events = await db.select().from(crmEstimateEvents)
      .where(and(eq(crmEstimateEvents.orgId, ctx.org.id), eq(crmEstimateEvents.estimateId, e.id)))
      .orderBy(desc(crmEstimateEvents.createdAt)).limit(100);
    const [cust] = await db.select().from(crmCustomers)
      .where(eq(crmCustomers.id, e.customerId)).limit(1);
    res.json({
      estimate: presentEstimate(e, ctx),
      items: items.map((i) => presentEstimateItem(i, ctx)),
      // The client's IP is audit data, not team reading material — same /24
      // redaction the engagement endpoint applies (portal.ts redactIpPrefix).
      events: events.map((ev) => ({
        ...ev,
        // Event payloads can contain totalCents even when the document's
        // monetary fields are hidden from this role.
        meta: ctx.permissions.seePrices ? ev.meta : null,
        ip: ev.ip ? ev.ip.replace(/^((?:\d{1,3}\.){2}\d{1,3})\.\d{1,3}$/, "$1.x") : ev.ip,
      })),
      customer: cust ? { id: cust.id, displayName: cust.displayName, email: cust.email, phone: cust.phone } : null,
      publicPath: ctx.permissions.manageEstimates ? `/e/${e.publicToken}` : undefined,
    });
  });

  app.put("/api/crm/estimates/:id/items", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({ items: z.array(itemSchema).max(300) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid items", issues: parsed.error.issues });
    const [e] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!e) return res.status(404).json({ message: "Estimate not found" });
    if (e.approvedAt) return res.status(409).json({ message: "This estimate has been approved and can no longer be edited." });

    // Price-floor lock: non-owners may price above the floor, never below.
    const floorMsg = await priceFloorViolation(ctx, parsed.data.items);
    if (floorMsg) return res.status(422).json({ message: floorMsg });

    const depositMsg = depositRefusal(e.depositCents, estimateTotals(parsed.data.items, e.taxRateBps).totalCents);
    if (depositMsg) return res.status(400).json({ message: `${depositMsg} Lower the deposit first.` });

    await db.delete(crmEstimateItems)
      .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, e.id)));
    if (parsed.data.items.length) {
      await db.insert(crmEstimateItems).values(
        parsed.data.items.map((it, idx) => ({ ...it, orgId: ctx.org.id, estimateId: e.id, sortOrder: it.sortOrder ?? idx })) as any,
      );
    }
    const fresh = await recalcEstimate(ctx.org.id, e.id);
    logActivity(ctx, "estimate.updated", {
      entityType: "estimate", entityId: e.id, customerId: e.customerId,
      meta: { number: e.number, fields: ["items"] },
    });
    res.json(presentEstimate(fresh ?? e, ctx));
  });

  /**
   * Edit an estimate — title, intro/scope verbiage, terms, tax, deposit,
   * division, project, status, and (wholesale) line items. Works after the
   * estimate has been SENT: the client link always renders the current rows,
   * and a re-send (portal.ts) mints a fresh expiry window. The one hard wall
   * is a signed approval — an approved estimate is a contract (409, same as
   * the items PUT). Totals are always recomputed server-side; client-supplied
   * totals are ignored.
   */
  app.patch("/api/crm/estimates/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageEstimates");
    if (!ctx) return;
    const parsed = z.object({
      title: z.string().min(1).max(200).optional(),
      introText: z.string().max(8000).nullable().optional(),
      termsText: z.string().max(20000).nullable().optional(),
      taxRateBps: z.number().int().min(0).max(3000).optional(),
      depositCents: z.number().int().min(0).nullable().optional(),
      projectId: z.string().max(64).nullable().optional(),
      divisionId: z.string().max(64).nullable().optional(),
      // "approved" is never set here — approval is the client's signature.
      status: z.enum(["draft", "sent", "viewed", "declined", "expired", "cancelled"]).optional(),
      items: z.array(itemSchema).max(300).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid estimate", issues: parsed.error.issues });
    const d = parsed.data;

    const [e] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!e) return res.status(404).json({ message: "Estimate not found" });
    if (e.approvedAt) return res.status(409).json({ message: "This estimate has been approved and can no longer be edited." });

    if (d.projectId) {
      const [proj] = await db.select({ id: crmProjects.id }).from(crmProjects)
        .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, d.projectId))).limit(1);
      if (!proj) return res.status(400).json({ message: "Project not found in this organization" });
    }
    if (d.divisionId) {
      const div = await getDivision(ctx.org.id, d.divisionId);
      if (!div) return res.status(400).json({ message: "Division not found in this organization" });
    }
    if (d.items) {
      // Price-floor lock: non-owners may price above the floor, never below.
      const floorMsg = await priceFloorViolation(ctx, d.items);
      if (floorMsg) return res.status(422).json({ message: floorMsg });
    }

    // Status by hand: only transitions a person can truthfully make. "viewed"
    // and "expired" are facts the system records (a client open, a lapsed
    // expiry) — an estimate may keep one, never be switched to it here.
    const statusTo = d.status !== undefined && d.status !== e.status ? d.status : undefined;
    if (statusTo === "viewed" || statusTo === "expired") {
      return res.status(400).json({
        message: statusTo === "viewed"
          ? "\"Viewed\" is recorded automatically when the client opens the estimate."
          : "\"Expired\" follows from the expiry date — use Extend to change it, or Send to start a fresh window.",
      });
    }

    // The deposit is what the pay route charges, so it can never exceed the
    // total. Checked against the totals this PATCH would produce, whenever it
    // touches the deposit, the lines or the tax rate.
    if (d.depositCents !== undefined || d.items || d.taxRateBps !== undefined) {
      const lines = d.items ?? await db.select().from(crmEstimateItems)
        .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, e.id)));
      const total = estimateTotals(lines, d.taxRateBps ?? e.taxRateBps ?? 0).totalCents;
      const depositMsg = depositRefusal(d.depositCents !== undefined ? d.depositCents : e.depositCents, total);
      if (depositMsg) return res.status(400).json({ message: depositMsg });
    }

    const { items, ...fields } = d;
    const patch: any = { updatedAt: new Date() };
    for (const k of ["title", "introText", "termsText", "taxRateBps", "depositCents", "projectId", "divisionId", "status"] as const) {
      if (fields[k] !== undefined) patch[k] = fields[k];
    }
    const now = new Date();
    if (statusTo === "sent") {
      // Marked sent outside the app (handed over on paper, emailed from
      // elsewhere): the send clock starts now, exactly as a real send does,
      // so the rest of the system (tracking strip, expiry, filters) agrees.
      if (!e.sentAt) patch.sentAt = now;
      if (!e.expiresAt || e.expiresAt.getTime() < now.getTime()) patch.expiresAt = estimateExpiryOnSend(now);
    }
    if (statusTo === "declined" && !e.declinedAt) patch.declinedAt = now;
    if (statusTo && statusTo !== "declined" && (e.declinedAt || e.status === "declined")) {
      // Leaving "declined" clears the old decline — the same revival a re-send does.
      patch.declinedAt = null;
      patch.declineReason = null;
    }
    await db.update(crmEstimates).set(patch)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, e.id)));
    if (statusTo) {
      await logEvent(ctx.org.id, e.id, `marked_${statusTo}`, ctx.member.id, req, {
        from: e.status, to: statusTo, manual: true,
      });
    }

    if (items) {
      await db.delete(crmEstimateItems)
        .where(and(eq(crmEstimateItems.orgId, ctx.org.id), eq(crmEstimateItems.estimateId, e.id)));
      if (items.length) {
        await db.insert(crmEstimateItems).values(
          items.map((it, idx) => ({ ...it, orgId: ctx.org.id, estimateId: e.id, sortOrder: it.sortOrder ?? idx })) as any,
        );
      }
    }

    const fresh = await recalcEstimate(ctx.org.id, e.id);
    const changed = [...Object.keys(patch).filter((k) => k !== "updatedAt"), ...(items ? ["items"] : [])];
    await logEvent(ctx.org.id, e.id, "updated", ctx.member.id, req, {
      fields: changed, afterSend: !!e.sentAt,
    });
    logActivity(ctx, "estimate.updated", {
      entityType: "estimate", entityId: e.id, customerId: e.customerId,
      meta: { number: e.number, fields: changed },
    });
    res.json(presentEstimate(fresh ?? e, ctx));
  });

  /**
   * Hard-delete an estimate — OWNER only, for cleaning up test documents.
   * An approved estimate is a signed contract: 409, never deletable. Every
   * other status (draft/sent/viewed/declined/expired/cancelled) deletes with
   * its children (options, discounts, items, events, engagement) in one
   * transaction, and leaves a deletion note on the client's activity.
   */
  app.delete("/api/crm/estimates/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requireOwnerRole(res, ctx)) return;
    const [e] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!e) return res.status(404).json({ message: "Estimate not found" });
    const refusal = estimateDeleteRefusal(e);
    if (refusal) return res.status(409).json({ message: refusal });

    await db.transaction(async (tx) => {
      await deleteEstimateChildren(tx, ctx.org.id, [e.id]);
      await tx.delete(crmEstimates)
        .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, e.id)));
    });

    console.log(`[crm] owner ${ctx.member.id} deleted estimate ${e.number ?? e.id} (${e.id}) in org ${ctx.org.id}`);
    await logDeletionNote(ctx.org.id, e.customerId, ctx.member.id,
      `Estimate ${e.number ?? e.id} ("${e.title}") was permanently deleted by the account owner.`);
    logActivity(ctx, "estimate.deleted", {
      entityType: "estimate", entityId: e.id, customerId: e.customerId,
      meta: { number: e.number, title: e.title },
    });
    res.json({ ok: true, deleted: e.id });
  });

  app.get("/api/crm/lead-sources", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const rows = await db.select().from(crmLeadSources)
      .where(and(eq(crmLeadSources.orgId, ctx.org.id), eq(crmLeadSources.active, true)))
      .orderBy(asc(crmLeadSources.name));
    res.json(rows);
  });

  app.post("/api/crm/lead-sources", async (req: any, res) => {
    const ctx = await ctxFor(req, res, "manageSettings");
    if (!ctx) return;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ message: "name required" });
    const [row] = await db.insert(crmLeadSources).values({ orgId: ctx.org.id, name }).returning();
    res.status(201).json(row);
  });
}

export { recalcEstimate, logEvent, presentEstimate, presentEstimateItem };
