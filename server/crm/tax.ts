/**
 * Sales tax by address city.
 *
 * An estimate can still carry an explicit taxRateBps (the create dialog's
 * "Tax %" field) — that always wins. When the caller leaves it unset, the
 * rate is resolved for the job address:
 *
 *   city match (case-insensitive) in the division's override map
 *   → division default
 *   → org default (crm_orgs.default_tax_rate_bps)
 *   → 0 ("none")
 *
 * The per-division override map lives on the division row at
 * custom_fields->taxRates: { default: bps, cities: { CityName: bps } },
 * editable via PATCH /api/crm/divisions/:id (divisions.ts). The chosen rate
 * and its source are logged on the estimate at custom_fields->taxSource.
 *
 * Wiring: entities.ts owns the estimate routes and is untouched; the hook
 * below is registered BEFORE them in routes.ts and only fills in
 * req.body.taxRateBps when the caller omitted it.
 */
import type { Express } from "express";
import { db } from "../db";
import { crmCustomers, crmEstimates, crmOrgs, crmProjects } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "./tenancy";
import { getDivision } from "./divisions";

type GetUser = (req: any, res: any) => any;

export type TaxRateSource = "city" | "division" | "org" | "none";

export type TaxResolution = {
  bps: number;
  source: TaxRateSource;
  /** The city key that matched, exactly as configured (city source only). */
  matchedCity?: string;
};

export type DivisionTaxRates = {
  default?: number | null;
  cities?: Record<string, number>;
};

// The estimate create schema accepts 0..3000 bps (30%); never inject a rate
// the route would then reject.
const clampBps = (n: number) => Math.min(3000, Math.max(0, Math.round(n)));

/** Read custom_fields->taxRates off a division row, tolerating junk. */
export function divisionTaxRates(customFields: unknown): DivisionTaxRates | null {
  const rates = (customFields as Record<string, unknown> | null | undefined)?.taxRates;
  if (!rates || typeof rates !== "object") return null;
  const r = rates as Record<string, unknown>;
  const out: DivisionTaxRates = {};
  if (typeof r.default === "number" && Number.isFinite(r.default)) out.default = r.default;
  if (r.cities && typeof r.cities === "object") {
    const cities: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.cities as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) cities[k] = v;
    }
    out.cities = cities;
  }
  return out;
}

/**
 * Pure resolution (unit-tested in tax.test.ts). First hit wins:
 * city override → division default → org default → none.
 */
export function resolveTaxRateBps(args: {
  city?: string | null;
  divisionCustomFields?: unknown;
  orgDefaultTaxRateBps?: number | null;
}): TaxResolution {
  const rates = divisionTaxRates(args.divisionCustomFields);
  const city = (args.city ?? "").trim().toLowerCase();
  if (rates?.cities && city) {
    for (const [name, bps] of Object.entries(rates.cities)) {
      if (name.trim().toLowerCase() === city) {
        return { bps: clampBps(bps), source: "city", matchedCity: name };
      }
    }
  }
  if (rates?.default != null) return { bps: clampBps(rates.default), source: "division" };
  if (args.orgDefaultTaxRateBps != null && Number.isFinite(args.orgDefaultTaxRateBps)) {
    return { bps: clampBps(args.orgDefaultTaxRateBps), source: "org" };
  }
  return { bps: 0, source: "none" };
}

/**
 * Resolve the rate for a would-be estimate: the project's site address (and
 * its division) when there is a project, else the customer's service address.
 */
export async function resolveEstimateTaxRate(
  orgId: string,
  args: { customerId: string; projectId?: string | null },
): Promise<TaxResolution> {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  let city: string | null = null;
  let divisionCustomFields: unknown = null;

  if (args.projectId) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.id, args.projectId))).limit(1);
    if (p) {
      city = p.city;
      const div = await getDivision(orgId, p.divisionId);
      divisionCustomFields = div?.customFields ?? null;
    }
  }
  if (!city) {
    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, args.customerId))).limit(1);
    city = cust?.city ?? null;
  }

  return resolveTaxRateBps({
    city,
    divisionCustomFields,
    orgDefaultTaxRateBps: org?.defaultTaxRateBps ?? null,
  });
}

/** Record how the rate was chosen on the estimate row (best-effort). */
async function stampTaxSource(orgId: string, estimateId: string, r: TaxResolution): Promise<void> {
  const [est] = await db.select({ customFields: crmEstimates.customFields }).from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.id, estimateId))).limit(1);
  if (!est) return;
  await db.update(crmEstimates).set({
    customFields: {
      ...((est.customFields as Record<string, unknown> | null) ?? {}),
      taxSource: { source: r.source, bps: r.bps, matchedCity: r.matchedCity ?? null },
    },
  }).where(eq(crmEstimates.id, estimateId));
}

export function registerCrmTaxHooks(app: Express, getDevUser: GetUser): void {
  /**
   * Pre-route hook for estimate creation (registered BEFORE the entity
   * routes). Only acts when the caller omitted taxRateBps entirely — an
   * explicit rate, 0 included, always wins. Resolution failures are swallowed:
   * the entity route still runs and creates the estimate with its default.
   */
  app.post("/api/crm/estimates", async (req: any, res, next) => {
    try {
      if (req.body && typeof req.body === "object" && req.body.taxRateBps === undefined) {
        const user = getDevUser(req, res);
        if (!user) return; // getDevUser already sent the 401
        const ctx = await requireOrg(req, res, user.id);
        if (!ctx) return;
        const customerId = String(req.body.customerId ?? "");
        if (customerId) {
          const r = await resolveEstimateTaxRate(ctx.org.id, {
            customerId,
            projectId: req.body.projectId ?? null,
          });
          req.body.taxRateBps = r.bps;
          // The row doesn't exist yet; log the source once the entity handler
          // responds with the created estimate (presentEstimate carries `id`).
          const origJson = res.json.bind(res);
          res.json = (body: any) => {
            const id = body?.id;
            if (id && r.source !== "none") {
              stampTaxSource(ctx.org.id, String(id), r).catch(() => {});
            }
            return origJson(body);
          };
        }
      }
    } catch {
      // best-effort — fall through to the entity route unchanged
    }
    next();
  });
}
