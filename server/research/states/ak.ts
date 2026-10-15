/**
 * Alaska. Checked live 2026-10-15.
 *
 *   Live enforcement (companies only):
 *     DCCED business licenses (Division of Corporations, Business and Professional Licensing), from the department's
 *       public ArcGIS map service (maps.commerce.alaska.gov, Economics_Related/Business_Licenses layer 2). The layer's
 *       own description: a subset of the CBPL business-license download, active licenses with an Alaska physical
 *       address matched to a community (about 12% of active licenses drop out); refreshed monthly. A business license
 *       is not a contractor license: it is shown as business standing.
 *
 * Contractor registrations, electrical/mechanical administrator licenses and the CBPL download files are on
 * www.commerce.alaska.gov, which answers every request with a DataDome CAPTCHA (see `blocked`).
 */
import type { EnforcementHit } from "@shared/research-reports";
import { clean } from "../bulk";
import type { LiveEnforcementSearch, StatePack } from "./types";
import { fetchJson, nameMatches } from "./lib/g8-common";
import { capNote, noteOf, withNote } from "../notes";

const LAYER = "https://maps.commerce.alaska.gov/server/rest/services/Economics_Related/Business_Licenses/MapServer/2";
const CBPL_SEARCH = "https://www.commerce.alaska.gov/cbp/main/search/professional";

const esriDay = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null);

async function searchBusinessLicenses(name: string): Promise<EnforcementHit[]> {
  const words = name.toUpperCase().replace(/[^A-Z0-9&' -]/g, " ").split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  // One condition only: the department's firewall rejects a where clause with AND in it. The longest word narrows
  // the query; every word is matched here.
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
  const where = `UPPER(BusinessName) LIKE '%${longest.replace(/'/g, "''")}%'`;
  const features = await queryAll(where);
  return withNote(toHits(name, features), noteOf(features));
}

/** The layer's own page size (maxRecordCount 2000, supportsPagination true; checked 2026-10-15). */
const PAGE = 2000;
/** A hard stop: past this many pages the report says the list was cut, rather than hammering the server. */
const MAX_PAGES = 10;

/** Every row matching `where`, paged by resultOffset in OBJECTID order; stops when a page repeats or at MAX_PAGES. */
type Page = { features?: { attributes: Record<string, unknown> }[]; exceededTransferLimit?: boolean; error?: unknown };
export async function queryAll(where: string, get: (url: string) => Promise<Page> = (url) => fetchJson<Page>(url, {}, "Alaska business licenses")): Promise<Record<string, unknown>[] & { note?: string }> {
  const out: Record<string, unknown>[] = [];
  let firstOfLast: unknown = undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ where, outFields: "OBJECTID,LicenseNumber,BusinessName,Status,IssueDate,ExpireDate,PhysicalLine1,PhysicalLine2,PhysicalCity,PhysicalState,PhysicalZipOut,CommunityName", returnGeometry: "false", orderByFields: "OBJECTID", resultOffset: String(page * PAGE), resultRecordCount: String(PAGE), f: "json" });
    const body = await get(`${LAYER}/query?${q}`);
    if (body.error || !Array.isArray(body.features)) throw new Error("Alaska business licenses returned an unexpected payload");
    const rows = body.features.map((f) => f.attributes);
    // A server that ignores resultOffset hands back the same page again: stop instead of looping.
    if (page > 0 && rows.length && rows[0].OBJECTID === firstOfLast) throw new Error("Alaska business licenses repeated a page (paging not honored)");
    firstOfLast = rows[0]?.OBJECTID;
    out.push(...rows);
    if (!body.exceededTransferLimit && rows.length < PAGE) return out;
  }
  return withNote(out, capNote(out.length, null, "business-license rows for this word"));
}

function toHits(name: string, rows: Record<string, unknown>[]): EnforcementHit[] {
  return rows.filter((a) => nameMatches(name, String(a.BusinessName ?? ""))).map((a) => ({
    state: "AK", source: "Alaska DCCED business licenses", sourceUrl: CBPL_SEARCH, category: "business_status" as const,
    name: clean(String(a.BusinessName ?? "")), id: clean(String(a.LicenseNumber ?? "")), date: esriDay(a.IssueDate), endDate: esriDay(a.ExpireDate),
    status: clean(String(a.Status ?? "")) ? `Business license: ${clean(String(a.Status))}` : "Business license", city: clean(String(a.PhysicalCity ?? "")) ?? clean(String(a.CommunityName ?? "")),
    address: ["PhysicalLine1", "PhysicalLine2", "PhysicalCity", "PhysicalState", "PhysicalZipOut"].map((k) => clean(a[k] == null ? null : String(a[k]))).filter(Boolean).join(" ") || null,
    detail: esriDay(a.ExpireDate) ? `Expires ${esriDay(a.ExpireDate)}` : null, amount: null, adverse: null,
  }));
}

const liveEnforcement: LiveEnforcementSearch[] = [{
  source: "Alaska DCCED business licenses",
  scope: "Active business licenses with an Alaska address (about 88% of them; the state's map layer, refreshed monthly)",
  search: searchBusinessLicenses,
}];

export const pack: StatePack = {
  state: "AK",
  checked: "2026-10-15",
  liveEnforcement,
  blocked: [
    "CBPL professional-license search and download files (www.commerce.alaska.gov/cbp), which hold construction contractor registrations and electrical/mechanical administrator licenses: DataDome CAPTCHA (HTTP 403) on every request",
    "DOLWD Mechanical Inspection certificates of fitness (electricians, plumbers): no public lookup or list published",
    "DOLWD Wage and Hour public-construction debarment list (dol.alaska.gov/lss/debarments.htm): live and readable, but empty today (no company listed), so nothing to search or verify",
  ],
};
