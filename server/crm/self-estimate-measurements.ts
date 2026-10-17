/**
 * Measurements for the client self-estimate — a deliberately tiny adapter.
 *
 * The HOVER measurement-extraction lane exports
 *   getCustomerTakeoff(orgId, customerId, { addressLine1?, postalCode? }): Promise<HoverTakeoff | null>
 * from server/crm/hover-takeoff.ts. Until that lands, this reads the same
 * shape from crm_measurements.raw_payload.takeoff when a ready report carries
 * it, and otherwise answers null (the client is then asked for a rough size —
 * nothing is ever derived from the older, unreliable summary columns).
 *
 * MERGE NOTE: once hover-takeoff.ts is on main, replace the body of
 * getCustomerTakeoff below with
 *   export { getCustomerTakeoff } from "./hover-takeoff";
 * (and import its HoverTakeoff type) — measuredFromTakeoff stays as is.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { crmMeasurements } from "@shared/schema";
import { NO_MEASUREMENTS, type MeasuredQuantities } from "@shared/self-estimate";

/** The interface the HOVER lane exports (server/crm/hover-takeoff.ts). */
export type HoverTakeoff = {
  siding: { areaSqft: number; quantitySqft: number };
  roof: { areaSqft: number; wastePct: number; quantitySqft: number; squares: number; predominantPitch: string | null };
  footprint: { areaSqft: number; perimeterFt: number; stories: number };
  windows: { opening: string; widthIn: number; heightIn: number; unitedInches: number; areaSqft: number }[];
  doors: { opening: string; widthIn: number; heightIn: number; areaSqft: number }[];
  counts: { windows: number; doors: number };
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Accept only a takeoff whose numbers are real positive numbers — anything else is "not measured". */
function asTakeoff(raw: unknown): HoverTakeoff | null {
  const t = raw as any;
  if (!t || typeof t !== "object") return null;
  if (!t.siding && !t.roof && !t.counts) return null;
  return t as HoverTakeoff;
}

export async function getCustomerTakeoff(
  orgId: string,
  customerId: string,
  opts: { addressLine1?: string | null; postalCode?: string | null } = {},
): Promise<HoverTakeoff | null> {
  const rows = await db.select().from(crmMeasurements)
    .where(and(
      eq(crmMeasurements.orgId, orgId),
      eq(crmMeasurements.customerId, customerId),
      eq(crmMeasurements.status, "ready"),
    ))
    .orderBy(desc(crmMeasurements.createdAt)).limit(20);
  const withTakeoff = rows.filter((r) => asTakeoff((r.rawPayload as any)?.takeoff));
  if (!withTakeoff.length) return null;
  // The report for THIS address. When an address is known and no report
  // matches it, the answer is "not measured" — never another property's
  // numbers (a customer with a rental and a home has two takeoffs).
  const norm = (s?: string | null) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm(opts.addressLine1)) return asTakeoff((withTakeoff[0].rawPayload as any).takeoff);
  const match = withTakeoff.find((r) => norm(r.addressLine1) === norm(opts.addressLine1)
    && (!opts.postalCode || !r.postalCode || norm(r.postalCode) === norm(opts.postalCode)));
  return match ? asTakeoff((match.rawPayload as any).takeoff) : null;
}

/** The takeoff in the units the ballpark math prices from. */
export function measuredFromTakeoff(t: HoverTakeoff | null): MeasuredQuantities {
  if (!t) return NO_MEASUREMENTS;
  const windowsCount = num(t.counts?.windows) ?? (Array.isArray(t.windows) && t.windows.length ? t.windows.length : null);
  const doorsCount = num(t.counts?.doors) ?? (Array.isArray(t.doors) && t.doors.length ? t.doors.length : null);
  return {
    sidingSqft: num(t.siding?.quantitySqft),
    roofAreaSqft: num(t.roof?.areaSqft),
    roofSqft: num(t.roof?.quantitySqft),
    roofWastePct: num(t.roof?.wastePct),
    windowsCount,
    doorsCount,
    perimeterFt: num(t.footprint?.perimeterFt),
  };
}
