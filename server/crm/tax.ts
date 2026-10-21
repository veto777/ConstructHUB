/**
 * Sales tax for an estimate, from the job-site address.
 *
 * Owner (2026-10-21): "every customer has an address and the address attached
 * should indicate the city and you can assess the tax based on that city" —
 * and "florida doesnt have tax but WA does": whether a contractor charges the
 * customer sales tax at all depends on the state's treatment of real-property
 * construction (shared/construction-tax-treatment.ts), not only the city rate.
 * Sales tax on construction is due at the JOB SITE (WA DOR), so the address is
 * the project's site address when there is a project, else the client's
 * service address.
 *
 * Resolution order — first hit wins:
 *
 *   0. an explicit taxRateBps on the create call (the dialog's Tax % field,
 *      which the user can always edit) — the hook below never overrides it
 *   1. the division's own per-city override (custom_fields->taxRates.cities,
 *      case-insensitive city match) — the org's configuration beats the table
 *   2. the state's construction treatment says contractors don't charge sales
 *      tax on real-property jobs (e.g. FL) → 0, source "construction-exempt"
 *   3. the official rate for the job site: in WA, the street address placed by
 *      WA DOR's own address lookup (server/sales-tax/wa-address.ts — a Blaine
 *      mailing address can be unincorporated Whatcom PTBA at 8.9%, not the City
 *      of Blaine at 9.1%); otherwise / when that fails, the job-site city in the
 *      state DOR table (sales_tax_rates, server/sales-tax/store.ts; ZIP
 *      disambiguates)
 *   4. the division default (custom_fields->taxRates.default)
 *   5. the org default (crm_orgs.default_tax_rate_bps)
 *   6. 0, source "none" — and the label says no rate was found, never silently
 *
 * "Depends" states (e.g. TX: taxable only for commercial repair/remodel) still
 * get the city rate, and the label names the condition so the user decides.
 *
 * Every resolution carries a one-line `label` the New estimate dialog shows
 * under Tax % ("Bellingham, WA · 9.2% (WA DOR, Q4 2026)"), served by
 * GET /api/crm/tax/estimate-rate. The chosen rate and where it came from are
 * logged on the estimate at custom_fields->taxSource (taxSourceRecord) — also
 * when the dialog sent an explicit rate (then source "manual" when the user
 * changed it, with the suggestion kept).
 *
 * Wiring: entities.ts owns the estimate routes and is untouched; the hook
 * below is registered BEFORE them in routes.ts and only fills in
 * req.body.taxRateBps when the caller omitted it.
 */
import type { Express } from "express";
import { db, pool } from "../db";
import { crmCustomers, crmEstimates, crmOrgs, crmProjects } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { getDivision } from "./divisions";
import { normalizeUsState } from "@shared/divisions";
import { stateOfAddress } from "@shared/us-address-state";
import { constructionTaxTreatment, type ConstructionTaxTreatment } from "@shared/construction-tax-treatment";
import { lookupByLocationCode, lookupOfficialRate, type OfficialLookup, type OfficialRate } from "../sales-tax/store";
import { lookupWaAddress } from "../sales-tax/wa-address";
import { pctToBps } from "../sales-tax/types";

type GetUser = (req: any, res: any) => any;

export type TaxRateSource = "city" | "construction-exempt" | "official" | "division" | "org" | "none";

/** Why the official table did not give the rate (only on a fallback). */
export type TaxFallbackReason = "no_city" | "no_state" | "not_loaded" | "no_match";

export type TaxResolution = {
  bps: number;
  source: TaxRateSource;
  /** The city key that matched, exactly as configured (city source only). */
  matchedCity?: string;
  /** Job-site city and state the rate was resolved for. */
  city?: string | null;
  state?: string | null;
  /** The state's construction treatment, when the state is known. */
  treatment?: ConstructionTaxTreatment | null;
  /** The official table row used (official source), or null. */
  official?: OfficialRate | null;
  fallbackReason?: TaxFallbackReason;
  /** One line for the dialog, saying where the rate came from. */
  label?: string;
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

/** 920 → "9.2%", 888 → "8.88%", 0 → "0%". */
export const fmtBps = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
const fmtPct = (pct: number) => `${Number(pct.toFixed(4))}%`;

/** "No tax on job" → "no tax on job", but "GET on contractor" / "T&M …" keep their capitals. */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

const cityKeyLoose = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/** " — TX: commercial repair taxed; new/residential mostly not — check" for a "depends" state, else "". */
function dependsSuffix(t: ConstructionTaxTreatment | null | undefined): string {
  return t?.treatment === "depends" ? ` — ${t.state}: ${lowerFirst(t.shortRule)} — check` : "";
}

const place = (city: string | null | undefined, state: string | null | undefined) =>
  [city?.trim() || null, state || null].filter(Boolean).join(", ");

/**
 * Pure resolution (unit-tested in tax.test.ts) — the order in the header.
 * `official` is the job-site lookup in the state table (null/undefined when not
 * looked up, e.g. no state known).
 */
export function resolveTaxRateBps(args: {
  city?: string | null;
  state?: string | null;
  divisionCustomFields?: unknown;
  orgDefaultTaxRateBps?: number | null;
  official?: OfficialLookup | null;
}): TaxResolution {
  const rates = divisionTaxRates(args.divisionCustomFields);
  const cityRaw = (args.city ?? "").trim();
  const city = cityRaw.toLowerCase();
  const state = normalizeUsState(args.state);
  const treatment = state ? constructionTaxTreatment(state) : null;
  const base = { city: cityRaw || null, state, treatment };

  // 1. The org's own per-city override.
  if (rates?.cities && city) {
    for (const [name, bps] of Object.entries(rates.cities)) {
      if (name.trim().toLowerCase() === city) {
        const b = clampBps(bps);
        return {
          ...base, bps: b, source: "city", matchedCity: name, official: null,
          label: `${place(cityRaw, state)} · ${fmtBps(b)} (your rate for ${name})${dependsSuffix(treatment)}`,
        };
      }
    }
  }

  // 2. Contractors don't charge sales tax on real-property work in this state.
  if (treatment?.treatment === "not_taxable") {
    return {
      ...base, bps: 0, source: "construction-exempt", official: null,
      label: `${treatment.name}: ${lowerFirst(treatment.shortRule)} — ${treatment.agency} ${treatment.citation.ref}`,
    };
  }

  // 3. The official rate for the job-site city.
  const off = args.official?.match ?? null;
  if (off) {
    const where = off.matchedBy === "address"
      ? `${place(cityRaw || off.city, state ?? off.state)}${off.jurisdiction && cityKeyLoose(off.jurisdiction) !== cityKeyLoose(cityRaw) ? ` — ${off.jurisdiction}` : ""}`
      : place(off.kind === "state" ? cityRaw || null : off.city ?? cityRaw, state ?? off.state);
    const varies = off.varies ? ` — rate varies within ${off.city ?? cityRaw}; check the address` : "";
    return {
      ...base, bps: clampBps(off.rateBps), source: "official", official: off,
      label: `${where} · ${fmtPct(off.ratePct)} (${off.source}, ${off.periodLabel})${varies}${dependsSuffix(treatment)}`,
    };
  }

  const fallbackReason: TaxFallbackReason =
    !cityRaw ? "no_city" : !state ? "no_state" : args.official && args.official.loaded ? "no_match" : "not_loaded";
  const why =
    fallbackReason === "no_city" ? "No city on the address"
    : fallbackReason === "no_state" ? `No state on the address for ${cityRaw}`
    : fallbackReason === "not_loaded" ? `City rate not loaded yet for ${state}`
    : `No rate found for ${place(cityRaw, state)}`;

  // 4–6. Division default → org default → none.
  let bps = 0;
  let source: TaxRateSource = "none";
  if (rates?.default != null) { bps = clampBps(rates.default); source = "division"; }
  else if (args.orgDefaultTaxRateBps != null && Number.isFinite(args.orgDefaultTaxRateBps)) {
    bps = clampBps(args.orgDefaultTaxRateBps); source = "org";
  }
  const tail = source === "none"
    ? "no default rate set — enter the rate"
    : `using your default (${fmtBps(bps)})`;
  return { ...base, bps, source, official: null, fallbackReason, label: `${why} — ${tail}${dependsSuffix(treatment)}` };
}

/** The job-site address the estimate's tax follows, plus the division and org defaults. */
export async function estimateTaxInputs(orgId: string, args: { customerId: string; projectId?: string | null }) {
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  let addr: { city: string | null; state: string | null; postalCode: string | null; addressLine1: string | null } | null = null;
  // (addressLine1 also feeds the WA DOR address lookup.)
  let divisionId: string | null = null;

  if (args.projectId) {
    const [p] = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, orgId), eq(crmProjects.id, args.projectId))).limit(1);
    if (p) {
      divisionId = p.divisionId ?? null;
      if (p.city) addr = { city: p.city, state: p.state, postalCode: p.postalCode, addressLine1: p.addressLine1 };
    }
  }
  const [cust] = await db.select().from(crmCustomers)
    .where(and(eq(crmCustomers.orgId, orgId), eq(crmCustomers.id, args.customerId))).limit(1);
  if (!addr && cust) addr = { city: cust.city, state: cust.state, postalCode: cust.postalCode, addressLine1: cust.addressLine1 };
  if (!divisionId) divisionId = cust?.divisionId ?? null;
  const div = await getDivision(orgId, divisionId);

  // State: the address's own (state field, ZIP, address text), else the division's, else the org's.
  const state = (addr ? stateOfAddress(addr) : null) ?? normalizeUsState(div?.state) ?? normalizeUsState(org?.state);
  return {
    city: addr?.city?.trim() || null,
    state,
    zip: addr?.postalCode ?? null,
    addressLine1: addr?.addressLine1?.trim() || null,
    divisionCustomFields: div?.customFields ?? null,
    orgDefaultTaxRateBps: org?.defaultTaxRateBps ?? null,
  };
}

/**
 * Resolve the rate for a would-be estimate: the project's site address (and
 * its division) when there is a project, else the customer's service address.
 */
export async function resolveEstimateTaxRate(
  orgId: string,
  args: { customerId: string; projectId?: string | null },
): Promise<TaxResolution> {
  const inputs = await estimateTaxInputs(orgId, args);
  let official: OfficialLookup | null = null;
  // WA: the exact location code for the street address, from WA DOR (falls through to the city on any miss).
  if (inputs.state === "WA" && inputs.addressLine1) {
    try {
      official = await waAddressOfficial(inputs.addressLine1, inputs.city, inputs.zip);
    } catch (e: any) {
      console.error("[crm/tax] WA address lookup failed:", e?.message ?? e);
    }
  }
  if (!official && inputs.state && inputs.city) {
    try {
      official = await lookupOfficialRate(pool, { state: inputs.state, city: inputs.city, zip: inputs.zip });
    } catch (e: any) {
      // Table missing/unreachable → behave as "not loaded"; the defaults still apply.
      console.error("[crm/tax] official rate lookup failed:", e?.message ?? e);
    }
  }
  return resolveTaxRateBps({ ...inputs, official });
}

/**
 * WA DOR's location code for a street address, as an official-table match: the rate DOR returns for the address
 * (current period), named after the location row of our WA DOR table when it has that code.
 */
export async function waAddressOfficial(addressLine1: string, city: string | null, zip: string | null, fetchImpl?: typeof fetch): Promise<OfficialLookup | null> {
  const loc = await lookupWaAddress({ addressLine1, city, zip }, fetchImpl);
  if (!loc) return null;
  const row = await lookupByLocationCode(pool, "WA", loc.locationCode).catch(() => null);
  const jurisdiction = row
    ? row.kind === "unincorporated" ? `unincorporated ${row.county} County` : row.city
    : `WA location ${loc.locationCode}`;
  return {
    loaded: true,
    match: {
      state: "WA", city: row?.kind === "city" ? row.city : null, county: row?.county ?? null, locationCode: loc.locationCode,
      kind: row?.kind ?? "special", ratePct: loc.ratePct, rateBps: pctToBps(loc.ratePct),
      effectiveDate: row?.effectiveDate ?? "", source: "WA DOR",
      sourceUrl: "https://webgis.dor.wa.gov/webapi/AddressRates.aspx",
      periodLabel: loc.periodLabel ?? row?.periodLabel ?? "", varies: false, matchedBy: "address", jurisdiction,
    },
  };
}

/** What custom_fields->taxSource records about a resolution. */
export function taxSourceRecord(r: TaxResolution) {
  return {
    source: r.source,
    bps: r.bps,
    matchedCity: r.matchedCity ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    treatment: r.treatment
      ? { treatment: r.treatment.treatment, dependsOn: r.treatment.dependsOn, agency: r.treatment.agency, citation: r.treatment.citation.url }
      : null,
    official: r.official
      ? {
        source: r.official.source, periodLabel: r.official.periodLabel, effectiveDate: r.official.effectiveDate,
        city: r.official.city, county: r.official.county, locationCode: r.official.locationCode, sourceUrl: r.official.sourceUrl,
        matchedBy: r.official.matchedBy ?? "city", jurisdiction: r.official.jurisdiction ?? null,
      }
      : null,
    fallbackReason: r.fallbackReason ?? null,
    label: r.label ?? null,
  };
}

/** Record how the rate was chosen on the estimate row (best-effort). */
async function stampTaxSource(orgId: string, estimateId: string, record: Record<string, unknown>): Promise<void> {
  const [est] = await db.select({ customFields: crmEstimates.customFields }).from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.id, estimateId))).limit(1);
  if (!est) return;
  await db.update(crmEstimates).set({
    customFields: { ...((est.customFields as Record<string, unknown> | null) ?? {}), taxSource: record },
  }).where(and(eq(crmEstimates.orgId, orgId), eq(crmEstimates.id, estimateId)));
}

/** After an estimate was created with an explicit rate: log it against what the address resolves to. */
async function stampExplicitRate(estimateId: string): Promise<void> {
  const [est] = await db.select({
    orgId: crmEstimates.orgId, customerId: crmEstimates.customerId, projectId: crmEstimates.projectId, taxRateBps: crmEstimates.taxRateBps,
  }).from(crmEstimates).where(eq(crmEstimates.id, estimateId)).limit(1);
  if (!est) return;
  const r = await resolveEstimateTaxRate(est.orgId, { customerId: est.customerId, projectId: est.projectId });
  const record = r.bps === est.taxRateBps
    ? taxSourceRecord(r)
    : { source: "manual", bps: est.taxRateBps, suggested: taxSourceRecord(r) };
  await stampTaxSource(est.orgId, estimateId, record);
}

export function registerCrmTaxHooks(app: Express, getDevUser: GetUser): void {
  /**
   * What the New estimate dialog pre-fills: the rate for the client's (or
   * project's) job-site address, and the line saying where it came from.
   * Read-only; needs manageEstimates, like creating the estimate.
   */
  app.get("/api/crm/tax/estimate-rate", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Same seat that may create the estimate (the entity route enforces manageEstimates).
    if (!requirePermission(res, ctx, "manageEstimates")) return;
    const customerId = String(req.query.customerId ?? "");
    if (!customerId) return res.status(400).json({ error: "customerId is required" });
    const projectId = req.query.projectId ? String(req.query.projectId) : null;
    try {
      const [cust] = await db.select({ id: crmCustomers.id }).from(crmCustomers)
        .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, customerId))).limit(1);
      if (!cust) return res.status(404).json({ error: "Client not found" });
      const r = await resolveEstimateTaxRate(ctx.org.id, { customerId, projectId });
      res.json({
        bps: r.bps, source: r.source, label: r.label, city: r.city ?? null, state: r.state ?? null,
        treatment: r.treatment ? { treatment: r.treatment.treatment, dependsOn: r.treatment.dependsOn, shortRule: r.treatment.shortRule, agency: r.treatment.agency, citation: r.treatment.citation } : null,
        official: r.official ? { source: r.official.source, periodLabel: r.official.periodLabel, effectiveDate: r.official.effectiveDate, ratePct: r.official.ratePct, city: r.official.city, county: r.official.county } : null,
        fallbackReason: r.fallbackReason ?? null,
      });
    } catch (e: any) {
      console.error("[crm/tax] estimate-rate failed:", e?.message ?? e);
      res.status(500).json({ error: "Could not work out the tax rate" });
    }
  });

  /**
   * Pre-route hook for estimate creation (registered BEFORE the entity
   * routes). When the caller omitted taxRateBps entirely it fills in the
   * resolved rate; an explicit rate, 0 included, always wins and is only
   * logged. Resolution failures are swallowed: the entity route still runs.
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
            if (id) stampTaxSource(ctx.org.id, String(id), taxSourceRecord(r)).catch(() => {});
            return origJson(body);
          };
        }
      } else if (req.body && typeof req.body === "object" && typeof req.body.taxRateBps === "number") {
        // Explicit rate: nothing changes before the route; log it afterwards.
        const origJson = res.json.bind(res);
        res.json = (body: any) => {
          const id = body?.id;
          if (id && res.statusCode < 300) stampExplicitRate(String(id)).catch(() => {});
          return origJson(body);
        };
      }
    } catch {
      // best-effort — fall through to the entity route unchanged
    }
    next();
  });
}
