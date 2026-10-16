/**
 * Directory rows that are not places (audit wave 2, #6): the permit directory inherited ~140 "city" rows from the
 * Replit import whose names are USPS postal aliases, not jurisdictions — unique-ZIP organisations ("AARP, CA",
 * "IRS, CT", "QVC, NC"), campus and base abbreviations ("ABAC, GA", "UCF, FL", "JBLM, WA"), city shorthands
 * ("KC, MO", "SLC, UT") and mail facilities ("Suburb Maryland Fac, MD"). None of them issues permits.
 *
 * Rule (no guessing, no new data): a city row is a postal alias when
 *   - its name, compared loosely ("St."/"Saint", case, punctuation), is NOT in the sourced place list
 *     (server/data/all-cities.json — the list every seeded city comes from; it does carry the real one-word places
 *     such as Arp TX, Una SC, Cid NC, DISH TX, IXL OK) nor the name of a directory row that has a link, and
 *   - it never had a source link (link status "none") and has no portal, search link or issuing jurisdiction.
 * A row with any link, a dead-link history or an issuer is never hidden (St. Paul MN, Winston-Salem NC stay).
 * The rows stay in the database and still come back for a typed search (flagged `postalAlias`); only the default
 * listing and the headline counts leave them out.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { permitDatabases } from "@shared/schema";

/** "St. Paul, MN" / "Saint Paul, MN", "Winston-Salem" / "Winston Salem", "Coeur d'Alene" / "Coeur D Alene" → one key. */
export function placeKey(jurisdiction: string): string {
  return jurisdiction
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bsainte\b/g, "ste").replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]/g, "");
}

/** The sourced city list as loose "City, ST" keys; null when the data file is missing (then nothing is hidden). */
let sourcedPlaces: Set<string> | null | undefined;
export function sourcedPlaceKeys(): Set<string> | null {
  if (sourcedPlaces !== undefined) return sourcedPlaces;
  const file = join(import.meta.dirname || __dirname, "data", "all-cities.json");
  if (!existsSync(file)) return (sourcedPlaces = null);
  const rows: { city: string; stateCode: string }[] = JSON.parse(readFileSync(file, "utf8"));
  return (sourcedPlaces = new Set(rows.map((r) => placeKey(`${r.city}, ${r.stateCode}`))));
}

/** Pure: the rows of `candidates` (never-linked, issuer-less city rows) whose name is no known place. */
export function postalAliasRows<T extends { jurisdiction: string }>(candidates: T[], places: Set<string> | null, linkedNames: string[] = []): T[] {
  if (!places) return [];
  const linked = new Set(linkedNames.map(placeKey));
  return candidates.filter((r) => { const k = placeKey(r.jurisdiction); return !places.has(k) && !linked.has(k); });
}

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; ids: number[] } | null = null;

/** Ids of the postal-alias rows (cached ten minutes; the directory changes only through seeds and pipelines). */
export async function postalAliasIds(): Promise<number[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  const places = sourcedPlaceKeys();
  if (!places) return (cache = { at: Date.now(), ids: [] }).ids;
  const link = sql`coalesce(nullif(${permitDatabases.portalUrl}, ''), nullif(${permitDatabases.searchUrl}, ''))`;
  const candidates = await db.select({ id: permitDatabases.id, jurisdiction: permitDatabases.jurisdiction })
    .from(permitDatabases)
    .where(and(
      eq(permitDatabases.jurisdictionType, "city"),
      eq(permitDatabases.linkStatus, "none"),
      isNull(permitDatabases.issuedBy),
      sql`${link} is null`,
    ));
  const linked = await db.select({ jurisdiction: permitDatabases.jurisdiction }).from(permitDatabases).where(sql`${link} is not null`);
  const ids = postalAliasRows(candidates, places, linked.map((r) => r.jurisdiction)).map((r) => r.id);
  cache = { at: Date.now(), ids };
  return ids;
}
