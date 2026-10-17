/**
 * The complete HOVER file: every capture becomes client + project + photos + 3D link + PDF + takeoff.
 *
 * This module is the DB half of shared/hover-takeoff.ts (the pure extraction + quote rules):
 *   - the org's takeoff rules (crm_orgs.custom_fields.takeoffRules — outside the "hover" block, so
 *     disconnecting HOVER keeps them; defaults 5 % roof waste, siding rounded up to 100 ft²);
 *   - applyHoverTakeoff / backfillHoverTakeoffs: re-derive raw_payload.takeoff and the crm_measurements
 *     numeric columns from the full_json already stored in raw_payload.fullJson — ZERO HOVER calls,
 *     idempotent (a row whose derived values are unchanged is not written);
 *   - ensureHoverProject: a capture whose client has no project at the job's address gets one
 *     (status lead, the client's division), never for an ambiguous or staff-contact match, never twice;
 *   - getCustomerTakeoff: the best takeoff for a client — a STABLE export, see its doc comment.
 *
 * Fetching from HOVER (job detail, full_json, the PDF) stays in hover.ts, which owns the tokens.
 */
import { db } from "../db";
import { crmCustomers, crmMeasurements, crmOrgs, crmProjects } from "@shared/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  extractHoverTakeoff, normalizeTakeoffRules, takeoffColumns, takeoffSummary, reapplyTakeoffRules, DEFAULT_TAKEOFF_RULES,
  type HoverTakeoff, type TakeoffRules,
} from "@shared/hover-takeoff";
import {
  normalizeHoverAddress, linkMeasurementToProject, adoptHoverMeasurementsForProject, rankHoverMeasurements,
  projectAddressKey, CLOSED_PROJECT_STATUSES,
} from "./hover-share";
import { nextDocNumber } from "./doc-number";
import { queueCrmEvent, projectEventPayload } from "./integrations";

type MeasurementRow = typeof crmMeasurements.$inferSelect;

// ── Org rules ───────────────────────────────────────────────────────────────

export async function readTakeoffRules(orgId: string): Promise<TakeoffRules> {
  const [org] = await db.select({ customFields: crmOrgs.customFields }).from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const stored = (org?.customFields as any)?.takeoffRules;
  return stored ? normalizeTakeoffRules(stored) : { ...DEFAULT_TAKEOFF_RULES };
}

/** Atomic jsonb merge (never read-modify-write — the "hover" block's rotating token lives next door). */
export async function writeTakeoffRules(orgId: string, rules: TakeoffRules): Promise<TakeoffRules> {
  const clean = normalizeTakeoffRules(rules);
  await db.update(crmOrgs).set({
    customFields: sql`jsonb_set(coalesce(${crmOrgs.customFields}, '{}'::jsonb), '{takeoffRules}', ${JSON.stringify(clean)}::jsonb)`,
    updatedAt: new Date(),
  }).where(eq(crmOrgs.id, orgId));
  return clean;
}

// ── Takeoff on a measurement row ────────────────────────────────────────────

/** The stored full_json (whole, or its compact derivation copy), when it is usable — not the {trimmed:true} stand-in. */
export function storedFullJson(raw: any): any | null {
  const fj = raw?.fullJson;
  return fj && typeof fj === "object" && fj.trimmed !== true ? fj : null;
}

/** A stored takeoff of the current shape, or null. */
function storedTakeoff(raw: any): HoverTakeoff | null {
  const t = raw?.takeoff;
  return t && typeof t === "object" && t.version === 1 ? (t as HoverTakeoff) : null;
}

/**
 * The takeoff for a row under `rules`: re-derived from the stored full_json; else the stored takeoff with the
 * CURRENT rules re-applied to its measured values (a row whose document was not kept still follows rule changes).
 */
export function takeoffOfRow(row: Pick<MeasurementRow, "rawPayload">, rules: TakeoffRules): HoverTakeoff | null {
  const raw = (row.rawPayload ?? {}) as any;
  const fj = storedFullJson(raw);
  if (fj) return extractHoverTakeoff(fj, rules);
  const stored = storedTakeoff(raw);
  return stored ? reapplyTakeoffRules(stored, rules) : null;
}

/** Key-order-independent JSON (jsonb hands keys back in its own order). */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const COLUMN_KEYS = [
  "squaresMilli", "roofAreaSfMilli", "wallAreaSfMilli", "ridgeLfMilli", "hipLfMilli", "valleyLfMilli",
  "eaveLfMilli", "rakeLfMilli", "perimeterLfMilli", "predominantPitch", "stories", "facetCount", "wasteSuggestionBps",
] as const;

/**
 * Re-derive one HOVER row from its stored full_json (else its stored takeoff under the current rules):
 * raw_payload.takeoff + .summary and the numeric columns.
 * Returns "updated", "unchanged" (nothing written) or "skipped" (no full_json / nothing in it).
 * The raw_payload write is a jsonb merge of the two keys only, so concurrent writers (PDF, share, photos) keep theirs.
 */
export async function applyHoverTakeoff(
  row: MeasurementRow, rules: TakeoffRules, dryRun = false,
): Promise<"updated" | "unchanged" | "skipped"> {
  const raw = (row.rawPayload ?? {}) as any;
  const takeoff = takeoffOfRow(row, rules);
  if (!takeoff) return "skipped";
  const cols = takeoffColumns(takeoff);
  const summary = takeoffSummary(takeoff);
  const same = COLUMN_KEYS.every((k) => (row as any)[k] === (cols as any)[k])
    && stableJson(raw.takeoff ?? null) === stableJson(takeoff)
    && stableJson(raw.summary ?? null) === stableJson(summary);
  if (same) return "unchanged";
  if (dryRun) return "updated";
  await db.update(crmMeasurements).set({
    ...cols,
    rawPayload: sql`coalesce(${crmMeasurements.rawPayload}, '{}'::jsonb) || ${JSON.stringify({ takeoff, summary })}::jsonb`,
    updatedAt: new Date(),
  } as any).where(eq(crmMeasurements.id, row.id));
  return "updated";
}

export interface TakeoffBackfillReport { checked: number; updated: number; unchanged: number; skipped: number }

/**
 * Idempotent back-fill of every HOVER measurement (one org, or every org when orgId is omitted) from the
 * full_json already stored — no HOVER calls. Run by every sync and by scripts/backfill-hover-takeoffs.ts.
 * A second run reports updated: 0.
 */
export async function backfillHoverTakeoffs(orgId?: string, opts: { dryRun?: boolean } = {}): Promise<TakeoffBackfillReport> {
  const where = [eq(crmMeasurements.provider, "hover"), sql`(${crmMeasurements.rawPayload} ? 'fullJson' or ${crmMeasurements.rawPayload} ? 'takeoff')`];
  if (orgId) where.push(eq(crmMeasurements.orgId, orgId));
  const rows = await db.select().from(crmMeasurements).where(and(...where));
  const rulesByOrg = new Map<string, TakeoffRules>();
  const report: TakeoffBackfillReport = { checked: rows.length, updated: 0, unchanged: 0, skipped: 0 };
  for (const r of rows) {
    if (!rulesByOrg.has(r.orgId)) rulesByOrg.set(r.orgId, await readTakeoffRules(r.orgId));
    const outcome = await applyHoverTakeoff(r, rulesByOrg.get(r.orgId)!, opts.dryRun === true);
    report[outcome]++;
  }
  return report;
}

// ── Auto project ────────────────────────────────────────────────────────────

export interface EnsureProjectResult { projectId: string | null; created: boolean; reason?: string }

/** A capture ordered by the org's own staff: the client record was made from the address only. */
function staffOrdered(raw: any, cust: typeof crmCustomers.$inferSelect): boolean {
  if (raw?.staffContact === true) return true;
  const cf = (cust.customFields ?? {}) as any;
  return cf.hoverAutoCreated === true && /ordered by your own team/i.test(cust.notes ?? "");
}

/**
 * Make sure the measurement belongs to a project. Order:
 *   1. already linked → that project;
 *   2. a project of the client at the job's address (open ones first, then the newest);
 *   3. a project this job already auto-created but someone archived → nothing (never recreated);
 *   4. create one: "<job label> — <street>" (or the street), status lead, the client's division, the job's address.
 * An ambiguous address match, a staff-ordered capture, a client flagged hoverAmbiguous, an archived client or a
 * job without a street + 5-digit zip never creates: those fall back to the old link rules only
 * (linkMeasurementToProject — the address, else the client's single open project). A per-client advisory lock + re-check inside the
 * transaction keeps two captures at one address from making two projects.
 */
export async function ensureHoverProject(
  orgId: string, measurementId: string,
  opts: { ambiguous?: boolean; staffContact?: boolean; jobName?: string | null } = {},
): Promise<EnsureProjectResult> {
  const [m] = await db.select().from(crmMeasurements)
    .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.id, measurementId))).limit(1);
  if (!m) return { projectId: null, created: false, reason: "no measurement" };
  if (m.projectId) return { projectId: m.projectId, created: false };
  if (!m.customerId) return { projectId: null, created: false, reason: "no client" };
  const raw = (m.rawPayload ?? {}) as any;
  const linkOnly = async (reason: string): Promise<EnsureProjectResult> => {
    const projectId = await linkMeasurementToProject(orgId, m.id);
    return projectId ? { projectId, created: false } : { projectId: null, created: false, reason };
  };
  if (opts.ambiguous || raw.hoverAmbiguous) return linkOnly("ambiguous match");
  const [cust] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, m.customerId))).limit(1);
  if (!cust || cust.archivedAt) return linkOnly("no client");
  if ((cust.customFields as any)?.hoverAmbiguous) return linkOnly("ambiguous match");
  if (opts.staffContact || staffOrdered(raw, cust)) return linkOnly("staff-ordered capture");

  const key = normalizeHoverAddress(m.addressLine1, m.postalCode);
  if (!key) return linkOnly("no address");
  const jobId = raw.hoverJobId ? String(raw.hoverJobId) : null;

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`hover-project:${orgId}:${cust.id}`}))`);
    const projects = await tx.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.customerId, cust.id)));
    const isOpen = (p: typeof projects[number]) => !CLOSED_PROJECT_STATUSES.has(p.status);
    const atAddress = projects
      .filter((p) => !p.archivedAt && projectAddressKey(p, cust) === key)
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0];
    if (atAddress) return { project: atAddress, created: false };
    const mine = jobId ? projects.find((p) => String((p.customFields as any)?.hoverJobId ?? "") === jobId) : null;
    // This job's own project (its address edited since) — or archived by someone: never recreated.
    if (mine) return { project: mine.archivedAt ? null : mine, created: false, reason: mine.archivedAt ? "auto project archived" : undefined };
    const label = (opts.jobName ?? raw.hoverJobName ?? "").trim();
    const street = m.addressLine1!.trim();
    const name = (label && normalizeHoverAddress(label, m.postalCode) !== key ? `${label} — ${street}` : street).slice(0, 200);
    const number = await nextDocNumber(tx, "P", orgId);
    const [row] = await tx.insert(crmProjects).values({
      orgId, customerId: cust.id, number, name, status: "lead",
      addressLine1: m.addressLine1, city: m.city, state: m.state, postalCode: m.postalCode,
      divisionId: cust.divisionId ?? null,
      description: jobId ? `Created from HOVER job ${jobId}.` : "Created from a HOVER capture.",
      customFields: { hoverAutoCreated: true, ...(jobId ? { hoverJobId: jobId } : {}) },
    } as any).returning();
    return { project: row, created: true };
  });

  if (!result.project) return { projectId: null, created: false, reason: result.reason };
  await db.update(crmMeasurements).set({ projectId: result.project.id, updatedAt: new Date() })
    .where(and(eq(crmMeasurements.id, m.id), isNull(crmMeasurements.projectId)));
  if (result.created) {
    queueCrmEvent(orgId, "project.created", { ...projectEventPayload(result.project), source: "hover" });
    await db.update(crmMeasurements).set({
      rawPayload: sql`coalesce(${crmMeasurements.rawPayload}, '{}'::jsonb) || ${JSON.stringify({ autoProjectId: result.project.id })}::jsonb`,
    }).where(eq(crmMeasurements.id, m.id));
    // The client's other HOVER captures at this address belong to it too.
    await adoptHoverMeasurementsForProject(result.project);
  }
  return { projectId: result.project.id, created: result.created };
}

/**
 * Back-fill projects for existing HOVER rows (opt-in: scripts/backfill-hover-takeoffs.ts --create-projects).
 * Not part of the scheduled sync — it can add hundreds of leads to an established pipeline at once.
 */
export async function backfillHoverProjects(orgId?: string): Promise<{ checked: number; created: number; linked: number; skipped: number }> {
  const where = [eq(crmMeasurements.provider, "hover"), isNull(crmMeasurements.projectId), sql`${crmMeasurements.customerId} is not null`];
  if (orgId) where.push(eq(crmMeasurements.orgId, orgId));
  const rows = await db.select({ id: crmMeasurements.id, orgId: crmMeasurements.orgId }).from(crmMeasurements)
    .where(and(...where)).orderBy(crmMeasurements.createdAt);
  const out = { checked: rows.length, created: 0, linked: 0, skipped: 0 };
  for (const r of rows) {
    const res = await ensureHoverProject(r.orgId, r.id);
    if (res.created) out.created++;
    else if (res.projectId) out.linked++;
    else out.skipped++;
  }
  return out;
}

// ── getCustomerTakeoff (STABLE — imported by the client-facing estimate builder) ──

/**
 * The best HOVER takeoff for one client of one org, or null when none of their HOVER captures carries
 * measurements. STABLE SIGNATURE: the client-facing "build your own estimate" tool imports this.
 *
 *   getCustomerTakeoff(orgId, customerId, { addressLine1?, postalCode? }) → Promise<HoverTakeoff | null>
 *
 * - Only the org's own rows for that customer (provider "hover", status "ready") are considered.
 * - With an address, a capture at that address (normalized line1 + 5-digit zip) wins; then the newest.
 *   Without one, the client's own address ranks first.
 * - Quantities follow the org's CURRENT takeoff rules (re-derived from the stored full_json).
 * - `source` says which capture it came from; `source.pdfUrl` is a session-gated CONTRACTOR download and
 *   `source.hoverAppUrl` needs a HOVER login — a client-facing caller must not expose either.
 * Contains measurements only — no prices, no costs.
 */
export async function getCustomerTakeoff(
  orgId: string,
  customerId: string,
  opts: { addressLine1?: string | null; postalCode?: string | null } = {},
): Promise<HoverTakeoff | null> {
  const ranked = await rankedTakeoffRows(orgId, customerId, { addressLine1: opts.addressLine1, postalCode: opts.postalCode });
  return ranked[0] ?? null;
}

/** Every takeoff for a client, best first (the scope ranking of rankHoverMeasurements). */
export async function rankedTakeoffRows(
  orgId: string, customerId: string,
  scope: { addressLine1?: string | null; postalCode?: string | null; projectId?: string | null; addressKey?: string | null; rows?: MeasurementRow[] },
): Promise<HoverTakeoff[]> {
  const rows = scope.rows ?? await db.select().from(crmMeasurements)
    .where(and(
      eq(crmMeasurements.orgId, orgId),
      eq(crmMeasurements.customerId, customerId),
      eq(crmMeasurements.provider, "hover"),
      eq(crmMeasurements.status, "ready"),
    ))
    .orderBy(desc(crmMeasurements.createdAt)).limit(50);
  if (!rows.length) return [];
  let addressKey = scope.addressKey ?? normalizeHoverAddress(scope.addressLine1, scope.postalCode);
  if (!addressKey && !scope.projectId) {
    const [c] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, customerId))).limit(1);
    addressKey = normalizeHoverAddress(c?.addressLine1, c?.postalCode);
  }
  const rules = await readTakeoffRules(orgId);
  const out: HoverTakeoff[] = [];
  for (const m of rankHoverMeasurements(rows, { projectId: scope.projectId ?? null, addressKey })) {
    const t = takeoffOfRow(m, rules);
    if (!t) continue;
    out.push({ ...t, source: takeoffSource(m) });
  }
  return out;
}

export function takeoffSource(m: MeasurementRow): NonNullable<HoverTakeoff["source"]> {
  const raw = (m.rawPayload ?? {}) as any;
  return {
    measurementId: m.id,
    hoverJobId: raw.hoverJobId != null ? String(raw.hoverJobId) : null,
    hoverModelId: raw.hoverModelId != null ? String(raw.hoverModelId) : null,
    capturedAt: (m.completedAt ?? m.createdAt)?.toISOString?.() ?? null,
    address: [m.addressLine1, m.city, m.state].filter(Boolean).join(", ") || null,
    projectId: m.projectId ?? null,
    pdfUrl: raw.pdfAttachmentId ? `/api/crm/attachments/${raw.pdfAttachmentId}/file` : null,
    hoverAppUrl: typeof raw.model3dUrl === "string" && /^https:\/\/hover\.to\/3d\/\d+$/.test(raw.model3dUrl) ? raw.model3dUrl : null,
  };
}
