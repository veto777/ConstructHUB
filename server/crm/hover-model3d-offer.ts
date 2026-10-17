/**
 * Who may be offered the in-app 3D viewer (server/crm/hover-model3d.ts). Kept free of route/session imports so the
 * client payloads (client-auth.ts, portal.ts) can use it without an import cycle.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { crmCustomers, crmMeasurements, crmProjects } from "@shared/schema";
import {
  hoverMeasurementsForCustomer, normalizeHoverAddress, projectAddressKey, rankHoverMeasurements, shareIsLive,
} from "./hover-share";

type MeasurementRow = typeof crmMeasurements.$inferSelect;

/** A refusal from HOVER is re-checked after this long. */
export const UNAVAILABLE_TTL_MS = 12 * 3600_000;

/**
 * AUTHORIZATION — may a client open the viewer routes for this measurement at all? A ready HOVER capture of a
 * customer the caller already proved is theirs. Availability (is there a mesh / a wireframe) is the loaders' answer,
 * never a reason to refuse an authorized request.
 */
export function viewer3dAuthorized(m: Pick<MeasurementRow, "provider" | "status" | "rawPayload">): boolean {
  const raw = (m.rawPayload ?? {}) as any;
  return m.provider === "hover" && m.status === "ready" && !!raw.hoverJobId;
}

/**
 * AVAILABILITY — is it worth showing the client a "Your home in 3D" card? Yes unless the mesh is KNOWN unavailable
 * (within the re-check window) and there is neither a live share link nor a cached wireframe. Once the window passes
 * the card comes back so the next open re-asks HOVER.
 */
export function viewer3dOffered(m: Pick<MeasurementRow, "provider" | "rawPayload"> & { status?: string | null }, now = new Date()): boolean {
  const raw = (m.rawPayload ?? {}) as any;
  if (m.provider !== "hover" || !raw.hoverJobId) return false;
  if (m.status !== undefined && m.status !== null && m.status !== "ready") return false;
  if (shareIsLive(raw.share, now)) return true;
  const st = (raw.model3d ?? {}) as { status?: string; checkedAt?: string; wireframes?: Record<string, { attachmentId?: string } | undefined> };
  if (st.status !== "unavailable") return true;
  const checked = st.checkedAt ? new Date(st.checkedAt).getTime() : NaN;
  if (!Number.isFinite(checked) || now.getTime() - checked >= UNAVAILABLE_TTL_MS) return true;
  return Object.values(st.wireframes ?? {}).some((w) => !!w?.attachmentId);
}

/**
 * The HOVER capture behind a public estimate's 3D viewer: that estimate's org + customer only, ranked by the
 * estimate's project and address. `offeredOnly` (the page's card flag) skips captures with nothing to show; the
 * viewer routes take the best-ranked AUTHORIZED one, preferring an offered one.
 */
export async function viewerMeasurementForEstimate(
  est: { orgId: string; customerId: string; projectId?: string | null }, opts: { offeredOnly?: boolean } = {},
): Promise<MeasurementRow | null> {
  const rows = (await hoverMeasurementsForCustomer(est.orgId, est.customerId)).filter((r) => viewer3dAuthorized(r));
  if (!rows.length) return null;
  const [c] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, est.orgId), eq(crmCustomers.id, est.customerId))).limit(1);
  let addressKey = normalizeHoverAddress(c?.addressLine1, c?.postalCode);
  if (est.projectId) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    if (p) addressKey = projectAddressKey(p, c ?? null);
  }
  const ranked = rankHoverMeasurements(rows, { projectId: est.projectId ?? null, addressKey });
  const offered = ranked.find((r) => viewer3dOffered(r)) ?? null;
  return opts.offeredOnly ? offered : offered ?? ranked[0] ?? null;
}
