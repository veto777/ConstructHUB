/**
 * The CRM Permits tab: permit offices + property-records offices for a project's city and state.
 * The matching rules live in ../permit-jurisdiction (pure); this file only reads the directory.
 */
import { db } from "../db";
import { permitDatabases, propertyAppraisers, counties } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { resolvePermitOffices, type DirectoryRow, type PermitResolution } from "../permit-jurisdiction";

/** The whole permit directory for one state, each row with the county it sits in. */
export async function directoryRowsForState(stateCode: string): Promise<DirectoryRow[]> {
  // A row's state is the ", ST" on its own jurisdiction ("Bentonville, AR"); a county_id alone is not trusted for
  // it (some seed rows point at a county in another state) — the resolver checks the county's state separately.
  return db.select({
    id: permitDatabases.id, name: permitDatabases.name, jurisdiction: permitDatabases.jurisdiction,
    jurisdictionType: permitDatabases.jurisdictionType, countyId: permitDatabases.countyId,
    countyName: counties.name, countyStateCode: counties.stateCode,
    portalUrl: permitDatabases.portalUrl, searchUrl: permitDatabases.searchUrl,
    isActive: permitDatabases.isActive, linkStatus: permitDatabases.linkStatus,
    lastVerifiedAt: permitDatabases.lastVerifiedAt,
    issuedBy: permitDatabases.issuedBy, issuedBySource: permitDatabases.issuedBySource,
  }).from(permitDatabases)
    .leftJoin(counties, eq(counties.id, permitDatabases.countyId))
    .where(sql`upper(right(trim(${permitDatabases.jurisdiction}), 4)) = ${`, ${stateCode.toUpperCase()}`}`);
}

export function permitSuggestPayload(r: PermitResolution) {
  return {
    // HARD RULE: only real, verified, liveness-checked rows. Never synthesise.
    portals: r.offices.map((o) => ({
      id: o.id, name: o.name, jurisdiction: o.jurisdiction, jurisdictionType: o.jurisdictionType,
      portalUrl: o.portalUrl, searchUrl: o.searchUrl,
      phone: null as string | null, // legacy contacts have no current source evidence
      linkStatus: o.linkStatus, lastVerifiedAt: o.lastVerifiedAt ?? null,
    })),
    jurisdiction: r.place,
    basis: r.basis,
    note: r.note,
    counties: r.counties.map((c) => c.name),
    issuedBy: r.issuedBy,
    issuedBySource: r.issuedBySource,
  };
}

export async function suggestPermitOffices(cityRaw: string, stateRaw: string) {
  const city = cityRaw.trim();
  const state = stateRaw.trim();
  if (!state) {
    return { portals: [], appraisers: [], message: "Add a state to the project first so offices can be matched safely." };
  }
  let stateCode = /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null;
  if (!stateCode) {
    const [byName] = await db.select({ code: counties.stateCode }).from(counties)
      .where(sql`lower(${counties.state}) = lower(${state})`).limit(1);
    stateCode = byName?.code ? byName.code.toUpperCase() : null;
  }
  if (!stateCode) {
    return { portals: [], appraisers: [], message: `"${state}" is not a US state we recognise — use the two-letter code so offices can be matched safely.` };
  }
  const resolution = resolvePermitOffices(city, stateCode, city ? await directoryRowsForState(stateCode) : []);
  // Property records are a county office: only the counties the place itself is on record in — never a county
  // (or an appraisal district) that merely has the city's name in its own.
  const countyIds = resolution.counties.map((c) => c.id);
  const appraisers = !countyIds.length ? [] : await db.select({
    id: propertyAppraisers.id, name: propertyAppraisers.name, county: counties.name,
    portalUrl: propertyAppraisers.portalUrl, searchUrl: propertyAppraisers.searchUrl,
    linkStatus: propertyAppraisers.linkStatus, lastVerifiedAt: propertyAppraisers.lastVerifiedAt,
  }).from(propertyAppraisers)
    .innerJoin(counties, eq(propertyAppraisers.countyId, counties.id))
    .where(and(eq(propertyAppraisers.isActive, true),
      sql`${propertyAppraisers.linkStatus} in ('live', 'verified', 'unconfirmed')`,
      eq(counties.stateCode, stateCode),
      inArray(propertyAppraisers.countyId, countyIds))).limit(10);
  return { ...permitSuggestPayload(resolution), appraisers };
}
