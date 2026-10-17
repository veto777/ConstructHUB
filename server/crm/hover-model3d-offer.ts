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

/** Is there anything 3D for this measurement worth offering a client (a mesh not known to be unavailable, or a live share)? */
export function viewer3dOffered(m: Pick<MeasurementRow, "provider" | "rawPayload">, now = new Date()): boolean {
  const raw = (m.rawPayload ?? {}) as any;
  if (m.provider !== "hover" || !raw.hoverJobId) return false;
  if (shareIsLive(raw.share, now)) return true;
  const st = (raw.model3d ?? {}) as { status?: string; wireframes?: Record<string, { attachmentId?: string } | undefined> };
  if (st.status === "unavailable") {
    return Object.values(st.wireframes ?? {}).some((w) => !!w?.attachmentId);
  }
  return true;
}

/** The HOVER measurement a public estimate's "Your home in 3D" shows: that estimate's org + customer only. */
export async function viewerMeasurementForEstimate(est: { orgId: string; customerId: string; projectId?: string | null }):
Promise<MeasurementRow | null> {
  const rows = (await hoverMeasurementsForCustomer(est.orgId, est.customerId)).filter((r) => r.status === "ready");
  if (!rows.length) return null;
  const [c] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, est.orgId), eq(crmCustomers.id, est.customerId))).limit(1);
  let addressKey = normalizeHoverAddress(c?.addressLine1, c?.postalCode);
  if (est.projectId) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    if (p) addressKey = projectAddressKey(p, c ?? null);
  }
  return rankHoverMeasurements(rows, { projectId: est.projectId ?? null, addressKey }).find((r) => viewer3dOffered(r)) ?? null;
}
