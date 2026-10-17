/**
 * Division WORKSPACES — the owner keeps each division of the company apart
 * (Alpine Exteriors, 2026-10-17: "keep divisions separate even for the owner
 * so everything is not in one place").
 *
 *   PUT  /api/crm/divisions/workspace         remember the workspace pick ("all" or a division) on the member
 *   GET  /api/crm/divisions/overview          per-division dashboard KPIs side by side + Unassigned + an
 *                                             explicitly labelled company total (never summed into a division)
 *   GET  /api/crm/divisions/unassigned        "Sort unassigned records" preview: a suggested division per
 *                                             unassigned client / project / estimate, from REAL links only
 *   POST /api/crm/divisions/unassigned/apply  apply the suggestions (all, or only some divisions'), logged
 *   POST /api/crm/divisions/assign            put one record in a division (or back to unassigned), logged
 *
 * The workspace itself is enforced centrally: requireOrg (tenancy.ts) resolves
 * ctx.activeDivisionId from the x-crm-division header / the saved pick, and
 * divisionScopeOf(ctx) confines every list, total and detail route to it
 * through the one object policy (object-access.ts). Only UNPINNED members
 * (the owner, division-less admins) switch; a member pinned to a division
 * never leaves it — the header is ignored for them and this PUT answers 403.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmDivisions, crmMembers, crmCustomers, crmProjects, crmEstimates, crmInvoices, crmPayments,
  type CrmDivision,
} from "@shared/schema";
import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { divisionLabel, normalizeUsState, sortDivisions } from "@shared/divisions";
import { requireOrg, requirePermission, type OrgContext } from "./tenancy";
import { canSwitchDivision, divisionMapsForOrg, pinnedDivisionOf, type DivisionMaps } from "./divisions";
import { objectDivision, type ObjectKind } from "./object-access";
import { logActivity, recordActivity } from "./activity";
import { customerAddressStates } from "./customer-address-state";
import { workerInterval } from "../workers";

type GetUser = (req: any, res: any) => any;

export const UNASSIGNED = "unassigned";

// ── This-month window, in the org's time zone (pure — unit-tested) ─────────

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the current calendar month began in `timeZone` (UTC on an unknown zone). */
export function monthStartIn(now: Date, timeZone: string | null | undefined): Date {
  const tz = timeZone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(now);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const guess = new Date(Date.UTC(y, m - 1, 1) - tzOffsetMs(now, tz));
    // Re-take the offset AT the month start (a DST change since then moves it an hour).
    return new Date(Date.UTC(y, m - 1, 1) - tzOffsetMs(guess, tz));
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}

// ── KPIs per division (bucketed by the same resolution the workspaces use) ─

export type Kpi = { count: number; totalCents?: number };
export type DivisionKpis = {
  openEstimates: Kpi;
  wonThisMonth: Kpi;
  invoicedThisMonth: Kpi;
  collectedThisMonth: Kpi;
  outstanding: Kpi;
  activeProjects: Kpi;
  clients: { count: number };
  records: { customers: number; projects: number; estimates: number; invoices: number };
};

const OPEN_ESTIMATE = new Set(["sent", "viewed"]);
const OPEN_INVOICE = new Set(["sent", "partial"]);
const CLOSED_PROJECT = new Set(["cancelled", "paid"]);
const NOT_ISSUED_INVOICE = new Set(["draft", "void"]);

const emptyKpis = (): DivisionKpis => ({
  openEstimates: { count: 0, totalCents: 0 }, wonThisMonth: { count: 0, totalCents: 0 },
  invoicedThisMonth: { count: 0, totalCents: 0 }, collectedThisMonth: { count: 0, totalCents: 0 },
  outstanding: { count: 0, totalCents: 0 }, activeProjects: { count: 0, totalCents: 0 },
  clients: { count: 0 }, records: { customers: 0, projects: 0, estimates: 0, invoices: 0 },
});
const add = (k: Kpi, cents: number) => { k.count += 1; k.totalCents = (k.totalCents ?? 0) + cents; };
const MONEY_KEYS = ["openEstimates", "wonThisMonth", "invoicedThisMonth", "collectedThisMonth", "outstanding", "activeProjects"] as const;

/** Drop the dollar totals for a seat without "See prices" (counts stay). */
function countOnly(k: DivisionKpis): DivisionKpis {
  const out: any = { ...k };
  for (const key of MONEY_KEYS) out[key] = { count: k[key].count };
  return out;
}

type Bucketer = (kind: ObjectKind, row: any) => Promise<string>;

/** The org's divisions (tab order) plus a bucketer: row → division id, or UNASSIGNED. */
async function bucketerFor(orgId: string): Promise<{ divisions: CrmDivision[]; bucket: Bucketer; maps: DivisionMaps }> {
  const divisions = sortDivisions(await db.select().from(crmDivisions).where(eq(crmDivisions.orgId, orgId)));
  const known = new Set(divisions.map((d) => d.id));
  const maps = await divisionMapsForOrg(orgId);
  const members = await db.select({ id: crmMembers.id, divisionId: crmMembers.divisionId })
    .from(crmMembers).where(eq(crmMembers.orgId, orgId));
  const memberDiv = new Map(members.map((m) => [m.id, m.divisionId]));
  const bucket: Bucketer = async (kind, row) => {
    const d = await objectDivision(kind, row, maps, (id) => memberDiv.get(id) ?? null);
    // A division id that no longer exists counts as unassigned — it shows in no workspace.
    return d && known.has(d) ? d : UNASSIGNED;
  };
  return { divisions, bucket, maps };
}

export async function divisionOverviewFor(ctx: OrgContext, now = new Date()) {
  const orgId = ctx.org.id;
  const { divisions, bucket } = await bucketerFor(orgId);
  const since = monthStartIn(now, ctx.org.timezone);
  const per = new Map<string, DivisionKpis>([[UNASSIGNED, emptyKpis()], ...divisions.map((d) => [d.id, emptyKpis()] as [string, DivisionKpis])]);
  const at = (k: string) => per.get(k)!;

  for (const e of await db.select().from(crmEstimates).where(eq(crmEstimates.orgId, orgId))) {
    const k = at(await bucket("estimates", e));
    k.records.estimates += 1;
    if (OPEN_ESTIMATE.has(e.status)) add(k.openEstimates, e.totalCents ?? 0);
    if (e.status === "approved" && e.approvedAt && e.approvedAt >= since) add(k.wonThisMonth, e.approvedTotalCents ?? e.totalCents ?? 0);
  }
  for (const p of await db.select().from(crmProjects).where(eq(crmProjects.orgId, orgId))) {
    const k = at(await bucket("projects", p));
    k.records.projects += 1;
    if (!p.archivedAt && !CLOSED_PROJECT.has(p.status)) add(k.activeProjects, p.contractValueCents ?? 0);
  }
  for (const i of await db.select().from(crmInvoices).where(eq(crmInvoices.orgId, orgId))) {
    const k = at(await bucket("invoices", i));
    k.records.invoices += 1;
    const issuedAt = i.sentAt ?? i.createdAt;
    if (!NOT_ISSUED_INVOICE.has(i.status) && issuedAt && issuedAt >= since) add(k.invoicedThisMonth, i.totalCents ?? 0);
    if (OPEN_INVOICE.has(i.status)) add(k.outstanding, Math.max(0, (i.totalCents ?? 0) - (i.paidCents ?? 0)));
  }
  for (const p of await db.select().from(crmPayments)
    .where(and(eq(crmPayments.orgId, orgId), eq(crmPayments.status, "succeeded")))) {
    const paidAt = p.paidAt ?? p.createdAt;
    if (!paidAt || paidAt < since) continue;
    add(at(await bucket("payments", p)).collectedThisMonth, p.amountCents ?? 0);
  }
  for (const c of await db.select().from(crmCustomers).where(eq(crmCustomers.orgId, orgId))) {
    const k = at(await bucket("customers", c));
    k.records.customers += 1;
    if (!c.archivedAt) k.clients.count += 1;
  }

  // The company total is its own, explicitly labelled row — never folded into a division's card.
  const total = emptyKpis();
  for (const k of per.values()) {
    for (const key of MONEY_KEYS) { total[key].count += k[key].count; total[key].totalCents! += k[key].totalCents ?? 0; }
    total.clients.count += k.clients.count;
    for (const r of Object.keys(total.records) as (keyof DivisionKpis["records"])[]) total.records[r] += k.records[r];
  }
  const show = (k: DivisionKpis) => (ctx.permissions.seePrices ? k : countOnly(k));
  return {
    monthStart: since.toISOString(),
    activeDivisionId: ctx.activeDivisionId ?? null,
    divisions: divisions.map((d) => ({
      id: d.id, name: d.name, code: d.code, city: d.city, state: d.state,
      isHeadquarters: d.isHeadquarters, label: divisionLabel(d), kpis: show(at(d.id)),
    })),
    unassigned: show(at(UNASSIGNED)),
    companyTotal: show(total),
  };
}

// ── "Sort unassigned records" (suggestions from real links only) ──────────

export type SuggestionReason = "project" | "customer_project" | "customer_state" | "project_state";
export type UnassignedRecord = {
  kind: "customer" | "project" | "estimate";
  id: string;
  label: string;
  customerId: string | null;
  customerName: string | null;
  state: string | null;
  suggestedDivisionId: string | null;
  reason: SuggestionReason | null;
};

export const SUGGESTION_REASON_TEXT: Record<SuggestionReason, string> = {
  project: "its project's division",
  customer_project: "the client's most recent project's division",
  customer_state: "the client's address (client record, projects, HOVER or website forms)",
  project_state: "the project's address state",
};

/**
 * Pure: suggest a division per unassigned record. Signals, first hit wins:
 *   estimate → its project's division → the client's most recent project with
 *              a division → the client's service-address state → its project's
 *              address state;
 *   project  → the client's most recent project with a division → the client's
 *              service-address state → the project's own address state;
 *   client   → its most recent project with a division → its service-address state.
 * A state counts only when it matches EXACTLY ONE division's state. Nothing
 * else (names, area codes, ZIP guesses) is ever used; no hit → no suggestion.
 */
export function suggestDivisions(input: {
  divisions: { id: string; state: string | null }[];
  customers: { id: string; displayName: string; state: string | null; createdAt?: Date | null }[];
  projects: { id: string; customerId: string; name: string; number?: string | null; divisionId: string | null; state: string | null; createdAt: Date | null }[];
  estimates: { id: string; customerId: string; projectId: string | null; number: string | null; title: string | null }[];
  unassigned: { customers: Set<string>; projects: Set<string>; estimates: Set<string> };
}): UnassignedRecord[] {
  const known = new Set(input.divisions.map((d) => d.id));
  const byState = new Map<string, string[]>();
  for (const d of input.divisions) {
    const st = normalizeUsState(d.state);
    if (st) byState.set(st, [...(byState.get(st) ?? []), d.id]);
  }
  const stateMatch = (raw: string | null | undefined): string | null => {
    const st = normalizeUsState(raw);
    const hits = st ? byState.get(st) ?? [] : [];
    return hits.length === 1 ? hits[0] : null;
  };
  const customers = new Map(input.customers.map((c) => [c.id, c]));
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const latestProjectDivision = new Map<string, string>();
  for (const p of [...input.projects].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))) {
    if (p.divisionId && known.has(p.divisionId) && !latestProjectDivision.has(p.customerId)) latestProjectDivision.set(p.customerId, p.divisionId);
  }
  const pick = (...tries: [string | null | undefined, SuggestionReason][]) => {
    for (const [d, reason] of tries) if (d) return { suggestedDivisionId: d, reason };
    return { suggestedDivisionId: null, reason: null };
  };
  const out: UnassignedRecord[] = [];
  for (const c of input.customers) {
    if (!input.unassigned.customers.has(c.id)) continue;
    out.push({
      kind: "customer", id: c.id, label: c.displayName, customerId: c.id, customerName: c.displayName, state: c.state,
      ...pick([latestProjectDivision.get(c.id), "customer_project"], [stateMatch(c.state), "customer_state"]),
    });
  }
  for (const p of input.projects) {
    if (!input.unassigned.projects.has(p.id)) continue;
    const c = customers.get(p.customerId);
    out.push({
      kind: "project", id: p.id, label: [p.number, p.name].filter(Boolean).join(" · "), customerId: p.customerId,
      customerName: c?.displayName ?? null, state: c?.state ?? p.state,
      // The project's OWN address first: a client with a FL job and a WA job gets each in its own division.
      ...pick([latestProjectDivision.get(p.customerId), "customer_project"], [stateMatch(p.state), "project_state"], [stateMatch(c?.state), "customer_state"]),
    });
  }
  for (const e of input.estimates) {
    if (!input.unassigned.estimates.has(e.id)) continue;
    const c = customers.get(e.customerId);
    const p = e.projectId ? projects.get(e.projectId) : undefined;
    const projDiv = p?.divisionId && known.has(p.divisionId) ? p.divisionId : null;
    out.push({
      kind: "estimate", id: e.id, label: [e.number, e.title].filter(Boolean).join(" · ") || "Estimate", customerId: e.customerId,
      customerName: c?.displayName ?? null, state: c?.state ?? p?.state ?? null,
      ...pick([projDiv, "project"], [stateMatch(p?.state), "project_state"], [latestProjectDivision.get(e.customerId), "customer_project"],
        [stateMatch(c?.state), "customer_state"]),
    });
  }
  return out;
}

export async function unassignedPreviewFor(orgId: string) {
  const { divisions, bucket } = await bucketerFor(orgId);
  const customers = await db.select().from(crmCustomers).where(eq(crmCustomers.orgId, orgId));
  const projects = await db.select().from(crmProjects).where(eq(crmProjects.orgId, orgId));
  const estimates = await db.select().from(crmEstimates).where(eq(crmEstimates.orgId, orgId));
  const invoices = await db.select().from(crmInvoices).where(eq(crmInvoices.orgId, orgId));
  const unassigned = { customers: new Set<string>(), projects: new Set<string>(), estimates: new Set<string>() };
  for (const c of customers) if (await bucket("customers", c) === UNASSIGNED) unassigned.customers.add(c.id);
  for (const p of projects) if (await bucket("projects", p) === UNASSIGNED) unassigned.projects.add(p.id);
  for (const e of estimates) if (await bucket("estimates", e) === UNASSIGNED) unassigned.estimates.add(e.id);
  let invoicesUnassigned = 0;
  for (const i of invoices) if (await bucket("invoices", i) === UNASSIGNED) invoicesUnassigned += 1;

  // The client's state comes from EVERY address we hold for them (record, projects, HOVER, website forms).
  const relevant = new Set<string>(unassigned.customers);
  for (const p of projects) if (unassigned.projects.has(p.id)) relevant.add(p.customerId);
  for (const e of estimates) if (unassigned.estimates.has(e.id)) relevant.add(e.customerId);
  const addressStates = await customerAddressStates(orgId, customers.filter((c) => relevant.has(c.id)),
    projects.filter((p) => relevant.has(p.customerId)));
  const located = customers.map((c) => ({ ...c, state: addressStates.get(c.id)?.state ?? c.state }));
  const records = suggestDivisions({ divisions, customers: located, projects, estimates, unassigned });
  const zero = () => ({ customers: 0, projects: 0, estimates: 0 });
  const plural = { customer: "customers", project: "projects", estimate: "estimates" } as const;
  const byDivision: Record<string, ReturnType<typeof zero>> = Object.fromEntries(divisions.map((d) => [d.id, zero()]));
  const noSuggestion = zero();
  const reasons: Record<string, number> = {};
  for (const r of records) {
    const slot = r.suggestedDivisionId ? byDivision[r.suggestedDivisionId] : noSuggestion;
    slot[plural[r.kind]] += 1;
    if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  return {
    divisions: divisions.map((d) => ({ id: d.id, code: d.code, name: d.name, state: d.state, label: divisionLabel(d) })),
    byDivision, noSuggestion, reasons, reasonText: SUGGESTION_REASON_TEXT,
    invoicesUnassigned,
    records,
  };
}


/**
 * Put every unassigned record that HAS an address-backed suggestion into that division. Never overwrites a
 * division someone picked; records with no address anywhere stay Unassigned. Shared by the Overview's
 * "Sort" button, the hourly auto-sort and new-client creation.
 */
export async function applyUnassignedSuggestions(orgId: string, onlyDivisionIds: string[] | null = null) {
  const preview = await unassignedPreviewFor(orgId);
  const only = onlyDivisionIds ? new Set(onlyDivisionIds) : null;
  const chosen = preview.records.filter((r) => r.suggestedDivisionId && (!only || only.has(r.suggestedDivisionId)));
  const tables = { customer: crmCustomers, project: crmProjects, estimate: crmEstimates } as const;
  const known = preview.divisions.map((d) => d.id);
  const counts = { customers: 0, projects: 0, estimates: 0 };
  const byDivision: Record<string, number> = {};
  const label = new Map(preview.divisions.map((d) => [d.id, d.label]));
  if (chosen.length) {
    await db.transaction(async (tx) => {
      for (const kind of ["customer", "project", "estimate"] as const) {
        const t = tables[kind];
        const groups = new Map<string, string[]>();
        for (const r of chosen) if (r.kind === kind) groups.set(r.suggestedDivisionId!, [...(groups.get(r.suggestedDivisionId!) ?? []), r.id]);
        for (const [divisionId, ids] of groups) {
          for (let i = 0; i < ids.length; i += 500) {
            // Only rows still without a (live) division — never overwrite a pick made since the preview.
            const done = await tx.update(t).set({ divisionId, updatedAt: new Date() } as any)
              .where(and(eq(t.orgId, orgId), inArray(t.id, ids.slice(i, i + 500)),
                // Still without a LIVE division at write time — a division created and picked since the
                // preview counts (checked against the table, not the preview's list).
                or(isNull(t.divisionId), sql`not exists (select 1 from ${crmDivisions} d where d.id = ${t.divisionId} and d.org_id = ${orgId})`)))
              .returning({ id: t.id });
            counts[`${kind}s` as keyof typeof counts] += done.length;
            const l = label.get(divisionId) ?? divisionId;
            byDivision[l] = (byDivision[l] ?? 0) + done.length;
          }
        }
      }
    });
  }
  return { counts, byDivision, leftUnassigned: preview.records.length - chosen.length };
}

/** Hourly: every org with divisions gets its new unassigned records placed by address, logged as System. */
/** Cheap gate for the hourly sort: does the org have ANY client/project/estimate without a live division? */
async function hasDivisionlessRows(orgId: string): Promise<boolean> {
  const r: any = await db.execute(sql`select exists (
      select 1 from ${crmCustomers} x where x.org_id = ${orgId} and (x.division_id is null or not exists (select 1 from ${crmDivisions} d where d.id = x.division_id))
      union all select 1 from ${crmProjects} x where x.org_id = ${orgId} and (x.division_id is null or not exists (select 1 from ${crmDivisions} d where d.id = x.division_id))
      union all select 1 from ${crmEstimates} x where x.org_id = ${orgId} and (x.division_id is null or not exists (select 1 from ${crmDivisions} d where d.id = x.division_id))
    ) as any`);
  return Boolean((r.rows ?? r)[0]?.any);
}

export async function runAutoDivisionSort(): Promise<void> {
  const orgs = await db.selectDistinct({ orgId: crmDivisions.orgId }).from(crmDivisions);
  for (const { orgId } of orgs) {
    try {
      if (!(await hasDivisionlessRows(orgId))) continue;
      const out = await applyUnassignedSuggestions(orgId);
      const moved = out.counts.customers + out.counts.projects + out.counts.estimates;
      if (moved) {
        recordActivity({ orgId, actorLabel: "System", action: "divisions.unassigned_sorted",
          entityType: "division", meta: { ...out.counts, byDivision: out.byDivision, automatic: true } });
        console.log(`[divisions] auto-sorted org ${orgId}: ${JSON.stringify(out.byDivision)}`);
      }
    } catch (e: any) {
      console.error(`[divisions] auto-sort org ${orgId} failed:`, String(e?.message || e).slice(0, 200));
    }
  }
}

let autoSortStarted = false;
export function startAutoDivisionSort(): void {
  if (autoSortStarted || process.env.CRM_AUTO_DIVISION_SORT === "0") return;
  autoSortStarted = true;
  workerInterval("Division auto-sort", () => runAutoDivisionSort(), 60 * 60 * 1000, { firstAfterMs: 2 * 60 * 1000 });
}

// ── Routes ──────────────────────────────────────────────────────────────────

const workspaceBody = z.object({ workspace: z.string().min(1).max(64) });
const applyBody = z.object({ divisionIds: z.array(z.string().max(64)).max(50).optional() });
const assignBody = z.object({
  kind: z.enum(["customer", "project", "estimate"]),
  id: z.string().min(1).max(64),
  divisionId: z.string().max(64).nullable(),
});

export function registerDivisionWorkspaceRoutes(app: Express, getDevUser: GetUser): void {
  startAutoDivisionSort();
  async function ctxFor(req: any, res: any): Promise<OrgContext | null> {
    const user = getDevUser(req, res);
    if (!user) return null;
    return requireOrg(req, res, user.id);
  }
  /** Overview and sorting look across every division: unpinned seats that can see all jobs only. */
  function crossDivision(res: any, ctx: OrgContext): boolean {
    if (!canSwitchDivision(ctx.member)) {
      res.status(403).json({ message: "Your seat is pinned to one division, so other divisions are not shown to you." });
      return false;
    }
    return requirePermission(res, ctx, "viewAllJobs");
  }

  // Remember the division workspace on the member, so it follows them to another device.
  app.put("/api/crm/divisions/workspace", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    const parsed = workspaceBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "workspace must be \"all\" or a division id" });
    if (pinnedDivisionOf(ctx.member)) {
      return res.status(403).json({ message: "Your seat is pinned to one division and can't switch workspaces." });
    }
    let activeDivisionId: string | null = null;
    if (parsed.data.workspace.toLowerCase() !== "all") {
      const [d] = await db.select({ id: crmDivisions.id }).from(crmDivisions)
        .where(and(eq(crmDivisions.orgId, ctx.org.id), eq(crmDivisions.id, parsed.data.workspace))).limit(1);
      if (!d) return res.status(400).json({ message: "Division not found in this organization" });
      activeDivisionId = d.id;
    }
    await db.update(crmMembers).set({ activeDivisionId, updatedAt: new Date() })
      .where(and(eq(crmMembers.orgId, ctx.org.id), eq(crmMembers.id, ctx.member.id)));
    res.json({ activeDivisionId });
  });

  // The Divisions → Overview cards: every division's own numbers side by side.
  app.get("/api/crm/divisions/overview", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "seeReporting") || !crossDivision(res, ctx)) return;
    res.json(await divisionOverviewFor(ctx));
  });

  app.get("/api/crm/divisions/unassigned", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings") || !crossDivision(res, ctx)) return;
    res.json(await unassignedPreviewFor(ctx.org.id));
  });

  // Apply the preview's suggestions. Recomputed here — the client's copy is never trusted.
  app.post("/api/crm/divisions/unassigned/apply", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings") || !crossDivision(res, ctx)) return;
    const parsed = applyBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "divisionIds must be a list of division ids" });
    const out = await applyUnassignedSuggestions(ctx.org.id, parsed.data.divisionIds ?? null);
    logActivity(ctx, "divisions.unassigned_sorted", { entityType: "division", meta: { ...out.counts, byDivision: out.byDivision } });
    res.json({ ok: true, ...out.counts, byDivision: out.byDivision, leftUnassigned: out.leftUnassigned });
  });

  // One record into a division by hand (the records the sort could not place).
  app.post("/api/crm/divisions/assign", async (req: any, res) => {
    const ctx = await ctxFor(req, res);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageSettings") || !crossDivision(res, ctx)) return;
    const parsed = assignBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid assignment", issues: parsed.error.issues });
    const { kind, id, divisionId } = parsed.data;
    let to: CrmDivision | null = null;
    if (divisionId) {
      [to] = await db.select().from(crmDivisions)
        .where(and(eq(crmDivisions.orgId, ctx.org.id), eq(crmDivisions.id, divisionId))).limit(1);
      if (!to) return res.status(400).json({ message: "Division not found in this organization" });
    }
    const t = { customer: crmCustomers, project: crmProjects, estimate: crmEstimates }[kind];
    const [row] = await db.update(t).set({ divisionId, updatedAt: new Date() } as any)
      .where(and(eq(t.orgId, ctx.org.id), eq(t.id, id))).returning();
    if (!row) return res.status(404).json({ message: "Record not found" });
    const r: any = row;
    logActivity(ctx, "division.assigned", {
      entityType: kind, entityId: id, customerId: kind === "customer" ? id : r.customerId ?? null,
      meta: { kind, label: r.number ?? r.displayName ?? r.name ?? null, to: to ? divisionLabel(to) : null },
    });
    res.json({ ok: true, kind, id, divisionId });
  });
}
