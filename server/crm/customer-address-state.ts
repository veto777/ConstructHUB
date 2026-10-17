/**
 * The US state each client's work is in, read from every ADDRESS we hold for them (owner, 2026-10-17:
 * "the unassigned should be assigned based on address … if you don't know where they go, pull the addresses
 * from forms"). First source that yields a state wins:
 *   1. the client record (state field, ZIP, address text), then its billing state/ZIP;
 *   2. their projects' site addresses;
 *   3. their HOVER captures' addresses;
 *   4. website lead-form submissions — linked to the client, or carrying the client's email or phone
 *      (last 10 digits) — their address fields, ZIP and any address-like form answer.
 * Only addresses are read (shared/us-address-state.ts); names, area codes or which website a form came
 * from are never evidence.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { crmDivisions, crmLeads, crmMeasurements } from "@shared/schema";
import { normalizeUsState } from "@shared/divisions";
import { stateFromAddressText, stateFromZip, stateOfAddress } from "@shared/us-address-state";

export type AddressStateSource = "client" | "billing" | "project" | "hover" | "lead_form";

type CustomerLike = {
  id: string; email?: string | null; phone?: string | null; state?: string | null; postalCode?: string | null;
  addressLine1?: string | null; city?: string | null; billingState?: string | null; billingPostalCode?: string | null;
};
type ProjectLike = { customerId: string; state?: string | null; postalCode?: string | null; addressLine1?: string | null; city?: string | null };

const phone10 = (p?: string | null) => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};
const email = (e?: string | null) => String(e ?? "").trim().toLowerCase() || null;

/** A lead-form submission's state: its address columns, then any answer whose key looks like an address. */
export function leadFormState(l: {
  state?: string | null; postalCode?: string | null; addressLine1?: string | null; city?: string | null; fields?: Record<string, unknown> | null;
}): string | null {
  const direct = stateOfAddress(l);
  if (direct) return direct;
  for (const [k, v] of Object.entries(l.fields ?? {})) {
    if (typeof v !== "string" || !/(address|street|city|state|zip|postal|location)/i.test(k)) continue;
    const s = /^(state|province)$/i.test(k.trim()) ? normalizeUsState(v) : /(zip|postal)/i.test(k) ? stateFromZip(v) : stateFromAddressText(v);
    if (s) return s;
  }
  return null;
}

export async function customerAddressStates(
  orgId: string, customers: CustomerLike[], projects: ProjectLike[],
): Promise<Map<string, { state: string; source: AddressStateSource }>> {
  const out = new Map<string, { state: string; source: AddressStateSource }>();
  const set = (id: string, state: string | null, source: AddressStateSource) => {
    if (state && !out.has(id)) out.set(id, { state, source });
  };
  for (const c of customers) {
    set(c.id, stateOfAddress(c), "client");
    set(c.id, normalizeUsState(c.billingState) ?? stateFromZip(c.billingPostalCode), "billing");
  }
  const missing = () => customers.filter((c) => !out.has(c.id));
  if (!missing().length) return out;

  for (const p of projects) if (!out.has(p.customerId)) set(p.customerId, stateOfAddress(p), "project");
  if (!missing().length) return out;

  const measurements = await db.select({
    customerId: crmMeasurements.customerId, state: crmMeasurements.state, postalCode: crmMeasurements.postalCode,
    addressLine1: crmMeasurements.addressLine1, city: crmMeasurements.city,
  }).from(crmMeasurements).where(eq(crmMeasurements.orgId, orgId));
  for (const m of measurements) if (m.customerId && !out.has(m.customerId)) set(m.customerId, stateOfAddress(m), "hover");
  const still = missing();
  if (!still.length) return out;

  const byEmail = new Map<string, string[]>();
  const byPhone = new Map<string, string[]>();
  for (const c of still) {
    const e = email(c.email);
    const p = phone10(c.phone);
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), c.id]);
    if (p) byPhone.set(p, [...(byPhone.get(p) ?? []), c.id]);
  }
  const leads = await db.select({
    customerId: crmLeads.customerId, email: crmLeads.email, phone: crmLeads.phone, state: crmLeads.state,
    postalCode: crmLeads.postalCode, addressLine1: crmLeads.addressLine1, city: crmLeads.city, fields: crmLeads.fields,
  }).from(crmLeads).where(and(eq(crmLeads.orgId, orgId)));
  const stillIds = new Set(still.map((c) => c.id));
  for (const l of leads) {
    const ids = new Set<string>();
    if (l.customerId && stillIds.has(l.customerId)) ids.add(l.customerId);
    for (const id of byEmail.get(email(l.email) ?? "") ?? []) ids.add(id);
    for (const id of byPhone.get(phone10(l.phone) ?? "") ?? []) ids.add(id);
    if (!ids.size) continue;
    const st = leadFormState(l);
    // A form shared by several clients (same email/phone on two records) still names one address.
    for (const id of ids) set(id, st, "lead_form");
  }
  return out;
}

/**
 * The division a NEW client belongs to by its address: the one division whose state matches. Null when the
 * address names no state, or names a state no division (or several) covers — the hourly sort retries later
 * with every other address source.
 */
export async function divisionIdForAddress(orgId: string, address: {
  state?: string | null; postalCode?: string | null; addressLine1?: string | null; city?: string | null;
}): Promise<string | null> {
  const st = stateOfAddress(address);
  if (!st) return null;
  const divisions = await db.select({ id: crmDivisions.id, state: crmDivisions.state })
    .from(crmDivisions).where(eq(crmDivisions.orgId, orgId));
  const hits = divisions.filter((d) => normalizeUsState(d.state) === st);
  return hits.length === 1 ? hits[0].id : null;
}
