/**
 * HOVER 3D models on projects, estimates and the client's pages.
 *
 * A HOVER job's own viewer (https://hover.to/3d/<jobId>) needs a HOVER login, so a homeowner can't open it. What a
 * homeowner CAN open is a job SHARE: https://hover.to/shared/<token>, made with the Share button in the HOVER app
 * (or, for interior jobs only, POST /api/v3/jobs/{id}/job_share). HOVER lists those per user at
 * GET /api/v1/job_shares?current_user_id=<id> (developers.hover.to/reference/list-job-share-links). We store the
 * one picked for a job on its measurement as raw_payload.share and show it to the client only while it is live.
 *
 * This module is the HOVER-free half: share-link validation, share picking, name and address keys, and linking a
 * measurement to the customer's project. The calls to HOVER live in hover.ts (it owns the tokens); this file never
 * fetches anything, so a pasted link can never make the server call an arbitrary URL.
 */
import { db } from "../db";
import { crmCustomers, crmMeasurements, crmProjects } from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

// ── Address + name keys ─────────────────────────────────────────────────────

/** USPS street suffixes and directions, long form → the short form both sides collapse to. */
const STREET_WORDS: Record<string, string> = {
  street: "st", avenue: "ave", av: "ave", drive: "dr", road: "rd", lane: "ln", court: "ct", place: "pl", boulevard: "blvd",
  circle: "cir", terrace: "ter", highway: "hwy", parkway: "pkwy", trail: "trl", loop: "loop", way: "way", plaza: "plz",
  square: "sq", crescent: "cres", cove: "cv", point: "pt", ridge: "rdg", heights: "hts",
  north: "n", south: "s", east: "e", west: "w", northwest: "nw", northeast: "ne", southwest: "sw", southeast: "se",
};

/**
 * Canonical service-address key: the street line (before any ", City, ST" tail) lowercased, punctuation stripped,
 * USPS suffixes and directions collapsed ("1110 Warren Street" / "1110 WARREN St." / "1110 Warren Street, Bellingham,
 * WA" → "1110 warren st"), plus the 5-digit zip. The SAME normalization runs on both sides, so formatting never
 * decides a match. Null when either side is too thin to trust.
 */
export function normalizeHoverAddress(line1?: string | null, zip?: string | null): string | null {
  const raw = String(line1 ?? "");
  const parts = raw.split(/[,\r\n]/);
  const line = parts[0]
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .replace(/#\s*/g, "unit ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
  // "412 Cedar Ridge Dr, Apt 2" — the unit after the comma is part of the address, never the city: two apartments
  // of one building are two homes, not one.
  const unit = parts.slice(1).map((t) => t.toLowerCase().match(/^\s*(?:apt|apartment|unit|ste|suite|bldg|lot|#)\s*\.?\s*([a-z0-9-]+)\s*$/)?.[1]).find(Boolean);
  const zip5 = String(zip ?? "").replace(/\D/g, "").slice(0, 5);
  if (!line || zip5.length !== 5) return null;
  return `${line}${unit && !new RegExp(`\\b(?:apt|unit|ste|suite|bldg|lot) ${unit}\\b`).test(line) ? ` unit ${unit}` : ""}|${zip5}`;
}

/**
 * A person's full name as a match key: case, accents, punctuation and spacing ignored ("Mary-Jane O'Neil" and
 * "mary jane  oneil" are the same key). Apostrophes and periods join ("O'Neil" → "oneil", "St." → "st"); hyphens
 * and other punctuation split. Null unless there are at least two words (first + last) — a single word is far too
 * weak to attach a property to someone.
 */
export function normalizePersonName(name?: string | null): string | null {
  const s = String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!s) return null;
  return s.split(" ").length >= 2 ? s : null;
}

/** Every name key a customer record answers to: its display name, and first + last when both are set. */
export function customerNameKeys(c: { displayName?: string | null; firstName?: string | null; lastName?: string | null }): Set<string> {
  const keys = new Set<string>();
  const d = normalizePersonName(c.displayName);
  if (d) keys.add(d);
  if (c.firstName && c.lastName) {
    const fl = normalizePersonName(`${c.firstName} ${c.lastName}`);
    if (fl) keys.add(fl);
  }
  return keys;
}

// ── Share links ─────────────────────────────────────────────────────────────

export interface HoverShare {
  url: string;
  token: string;
  imageUrl: string | null;
  videoUrl: string | null;
  expiresAt: string | null;
  source: "hover-api" | "manual";
  jobShareId?: string | null;
  savedAt: string;
}

const SHARE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * The ONLY share link we accept: https://hover.to/shared/<token>, optionally with HOVER's documented ?model_id=<n>.
 * Exact host (no subdomains, no port, no credentials), nothing else in the path, no other query, no fragment.
 * Returns the canonical form, or null. Pure string checks: nothing is ever fetched.
 */
export function parseHoverShareUrl(input: unknown): { url: string; token: string } | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 400) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "hover.to" || u.port || u.username || u.password || u.hash) return null;
  const m = /^\/shared\/([^/]+)\/?$/.exec(u.pathname);
  if (!m || !SHARE_TOKEN.test(m[1])) return null;
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => k !== "model_id")) return null;
  const modelId = u.searchParams.get("model_id");
  if (keys.length > 1 || (modelId !== null && !/^\d{1,12}$/.test(modelId))) return null;
  const token = m[1];
  return { url: `https://hover.to/shared/${token}${modelId ? `?model_id=${modelId}` : ""}`, token };
}

/** A media URL HOVER gave us for a share (image/video) — https on hover.to only, or dropped. */
export function safeHoverMediaUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 600) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (u.hostname !== "hover.to" && !u.hostname.endsWith(".hover.to")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Is this stored share usable by a homeowner right now? */
export function shareIsLive(share: Partial<HoverShare> | null | undefined, now: Date = new Date()): boolean {
  if (!share || !parseHoverShareUrl(share.url)) return false;
  if (share.expiresAt) {
    const t = new Date(share.expiresAt).getTime();
    if (!Number.isFinite(t) || t <= now.getTime()) return false;
  }
  return true;
}

/** HOVER's job_share record → our stored share (null when its url isn't a valid share link). */
export function shareFromJobShare(js: any, now: Date = new Date()): HoverShare | null {
  const parsed = parseHoverShareUrl(js?.url);
  if (!parsed) return null;
  return {
    url: parsed.url,
    token: parsed.token,
    imageUrl: safeHoverMediaUrl(js?.image_url),
    videoUrl: safeHoverMediaUrl(js?.video_url),
    expiresAt: typeof js?.expires_at === "string" ? js.expires_at : null,
    source: "hover-api",
    jobShareId: js?.id != null ? String(js.id) : null,
    savedAt: now.toISOString(),
  };
}

/**
 * The best HOVER share for a job: same job_id, a valid share URL, not expired (flag or date), latest expiry first
 * (a share with no expiry counts as latest). Null when none qualifies — an expired share is never picked.
 */
export function pickJobShare(shares: any[], jobId: string, now: Date = new Date()): HoverShare | null {
  const exp = (s: any) => (s?.expires_at ? new Date(s.expires_at).getTime() : Number.POSITIVE_INFINITY);
  const candidates = (Array.isArray(shares) ? shares : [])
    .filter((s) => s && String(s.job_id) === String(jobId) && s.expired !== true)
    .filter((s) => { const t = exp(s); return !Number.isNaN(t) && t > now.getTime(); })
    .sort((a, b) => exp(b) - exp(a));
  for (const s of candidates) {
    const share = shareFromJobShare(s, now);
    if (share) return share;
  }
  return null;
}

/**
 * Should a share HOVER listed replace what's stored? A contractor-pasted link that is still live wins (they chose
 * it); otherwise the API's pick is taken. When the list came back complete and has nothing for the job, a stored
 * API share is dropped (it was deleted or expired at HOVER); a manual one is kept.
 */
export function mergeShare(stored: HoverShare | null | undefined, listed: HoverShare | null, now: Date = new Date()): HoverShare | null {
  if (stored?.source === "manual" && shareIsLive(stored, now)) return stored;
  if (listed) return listed;
  if (stored?.source === "manual") return stored;
  return null;
}

/** What a client page may see: only a live share; the login-only hover.to/3d link is never included. */
export function clientShareView(raw: any, now: Date = new Date()): { url: string; imageUrl: string | null; expiresAt: string | null } | null {
  const share = raw?.share as HoverShare | undefined;
  if (!shareIsLive(share, now)) return null;
  return { url: parseHoverShareUrl(share!.url)!.url, imageUrl: safeHoverMediaUrl(share!.imageUrl), expiresAt: share!.expiresAt ?? null };
}

// ── Project linking ─────────────────────────────────────────────────────────

/** Project statuses that are finished — a measurement never attaches to one by the "single open project" rule. */
export const CLOSED_PROJECT_STATUSES = new Set(["complete", "invoiced", "paid", "cancelled"]);

type ProjectLite = Pick<typeof crmProjects.$inferSelect, "id" | "status" | "addressLine1" | "postalCode" | "archivedAt" | "createdAt">;
type CustomerAddr = { addressLine1?: string | null; postalCode?: string | null };

/** A project's service address key: its own site address, else (no site address set) the customer's. */
export function projectAddressKey(p: Pick<ProjectLite, "addressLine1" | "postalCode">, customer: CustomerAddr | null): string | null {
  if (p.addressLine1) return normalizeHoverAddress(p.addressLine1, p.postalCode || customer?.postalCode);
  return normalizeHoverAddress(customer?.addressLine1, customer?.postalCode);
}

/**
 * Which of the customer's projects a HOVER job belongs to (pure):
 *   1. a project whose service address normalizes equal to the job's (open ones first, then the newest);
 *   2. else the customer's ONLY open project;
 *   3. else null — never a guess.
 */
export function chooseProjectForJob(
  projects: ProjectLite[], customer: CustomerAddr | null, jobLine1?: string | null, jobZip?: string | null,
): string | null {
  const live = projects.filter((p) => !p.archivedAt);
  const isOpen = (p: ProjectLite) => !CLOSED_PROJECT_STATUSES.has(p.status);
  const key = normalizeHoverAddress(jobLine1, jobZip);
  if (key) {
    const atAddress = live
      .filter((p) => projectAddressKey(p, customer) === key)
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a))
        || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    if (atAddress.length) return atAddress[0].id;
  }
  const open = live.filter(isOpen);
  return open.length === 1 ? open[0].id : null;
}

/** Set projectId on a measurement that has a customer but no project yet. Returns the project id set, or null. */
export async function linkMeasurementToProject(orgId: string, measurementId: string): Promise<string | null> {
  const [m] = await db.select().from(crmMeasurements)
    .where(and(eq(crmMeasurements.orgId, orgId), eq(crmMeasurements.id, measurementId))).limit(1);
  if (!m || m.projectId || !m.customerId) return m?.projectId ?? null;
  const [cust] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, m.customerId))).limit(1);
  const projects = await db.select().from(crmProjects)
    .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.customerId, m.customerId)));
  const projectId = chooseProjectForJob(projects, cust ?? null, m.addressLine1, m.postalCode);
  if (!projectId) return null;
  await db.update(crmMeasurements).set({ projectId, updatedAt: new Date() })
    .where(and(eq(crmMeasurements.id, m.id), isNull(crmMeasurements.projectId)));
  return projectId;
}

/**
 * A project was just created: adopt the customer's HOVER measurements that have no project yet and were captured
 * at this project's service address. Never throws (project creation must not fail over this).
 */
export async function adoptHoverMeasurementsForProject(
  project: Pick<typeof crmProjects.$inferSelect, "id" | "orgId" | "customerId" | "addressLine1" | "postalCode">,
): Promise<number> {
  try {
    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, project.orgId), eq(crmCustomers.id, project.customerId))).limit(1);
    const key = projectAddressKey(project, cust ?? null);
    if (!key) return 0;
    const rows = await db.select({ id: crmMeasurements.id, addressLine1: crmMeasurements.addressLine1, postalCode: crmMeasurements.postalCode })
      .from(crmMeasurements)
      .where(and(
        eq(crmMeasurements.orgId, project.orgId),
        eq(crmMeasurements.provider, "hover"),
        eq(crmMeasurements.customerId, project.customerId),
        isNull(crmMeasurements.projectId),
      ));
    let n = 0;
    for (const r of rows) {
      if (normalizeHoverAddress(r.addressLine1, r.postalCode) !== key) continue;
      await db.update(crmMeasurements).set({ projectId: project.id, updatedAt: new Date() })
        .where(and(eq(crmMeasurements.id, r.id), isNull(crmMeasurements.projectId)));
      n++;
    }
    return n;
  } catch (e: any) {
    console.error("[hover] project adoption failed:", String(e?.message || e).slice(0, 160));
    return 0;
  }
}

/**
 * Idempotent back-fill: every HOVER measurement of the org that has a customer but no project gets one by the
 * same rules as a fresh ingest. Run by every sync; rows that still have no fitting project stay null.
 */
export async function backfillHoverProjectLinks(orgId: string): Promise<{ checked: number; linked: number }> {
  const rows = await db.select().from(crmMeasurements)
    .where(and(
      eq(crmMeasurements.orgId, orgId),
      eq(crmMeasurements.provider, "hover"),
      isNotNull(crmMeasurements.customerId),
      isNull(crmMeasurements.projectId),
    ));
  if (!rows.length) return { checked: 0, linked: 0 };
  const customerIds = [...new Set(rows.map((r) => r.customerId!))];
  const [projects, customers] = await Promise.all([
    db.select().from(crmProjects).where(and(eq(crmProjects.orgId, orgId), inArray(crmProjects.customerId, customerIds))),
    db.select().from(crmCustomers).where(and(eq(crmCustomers.orgId, orgId), inArray(crmCustomers.id, customerIds))),
  ]);
  const byCustomer = new Map<string, ProjectLite[]>();
  for (const p of projects) byCustomer.set(p.customerId, [...(byCustomer.get(p.customerId) ?? []), p]);
  const custById = new Map(customers.map((c) => [c.id, c]));
  let linked = 0;
  for (const r of rows) {
    const list = byCustomer.get(r.customerId!);
    if (!list?.length) continue;
    const projectId = chooseProjectForJob(list, custById.get(r.customerId!) ?? null, r.addressLine1, r.postalCode);
    if (!projectId) continue;
    await db.update(crmMeasurements).set({ projectId, updatedAt: new Date() })
      .where(and(eq(crmMeasurements.id, r.id), isNull(crmMeasurements.projectId)));
    linked++;
  }
  return { checked: rows.length, linked };
}

// ── Choosing the model to show ──────────────────────────────────────────────

type MeasurementRow = typeof crmMeasurements.$inferSelect;

/**
 * Order a scope's HOVER measurements for display: the scope's own project first, then those at the scope's address,
 * then the newest. (Estimate pages show the first one with a live share to the client.)
 */
export function rankHoverMeasurements(
  rows: MeasurementRow[], scope: { projectId?: string | null; addressKey?: string | null },
): MeasurementRow[] {
  const score = (m: MeasurementRow) =>
    (scope.projectId && m.projectId === scope.projectId ? 2 : 0)
    + (scope.addressKey && normalizeHoverAddress(m.addressLine1, m.postalCode) === scope.addressKey ? 1 : 0);
  return [...rows].sort((a, b) => score(b) - score(a)
    || ((b.completedAt ?? b.createdAt)?.getTime() ?? 0) - ((a.completedAt ?? a.createdAt)?.getTime() ?? 0));
}

/** HOVER measurements for one customer of one org, newest first (the caller ranks them). */
export async function hoverMeasurementsForCustomer(orgId: string, customerId: string): Promise<MeasurementRow[]> {
  return db.select().from(crmMeasurements)
    .where(and(
      eq(crmMeasurements.orgId, orgId),
      eq(crmMeasurements.customerId, customerId),
      eq(crmMeasurements.provider, "hover"),
    ))
    .orderBy(desc(crmMeasurements.createdAt))
    .limit(50);
}

/**
 * The live share a client may open for an estimate: that estimate's org + customer only, ranked by the estimate's
 * project and address. Null when no measurement has a live share.
 */
export async function clientHome3dForEstimate(est: { orgId: string; customerId: string; projectId?: string | null }):
Promise<{ url: string; imageUrl: string | null; expiresAt: string | null; address: string | null } | null> {
  const rows = await hoverMeasurementsForCustomer(est.orgId, est.customerId);
  if (!rows.length) return null;
  const [c] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, est.orgId), eq(crmCustomers.id, est.customerId))).limit(1);
  let addressKey = normalizeHoverAddress(c?.addressLine1, c?.postalCode);
  if (est.projectId) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    if (p) addressKey = projectAddressKey(p, c ?? null);
  }
  for (const m of rankHoverMeasurements(rows, { projectId: est.projectId ?? null, addressKey })) {
    const v = clientShareView(m.rawPayload);
    if (v) return { ...v, address: m.addressLine1 ?? null };
  }
  return null;
}
