/**
 * Is this name a business or a person? (audit 2026-10-15, decision 5). Enforcement records are kept for companies
 * only (FCRA), so a pack that reads names from a roster or a PDF must not take "David Power" for a business. A name
 * counts as a business only when it carries
 *   - a corporate suffix (Inc, LLC, Corp, Co, Company, Ltd, LP, LLP, PLLC, PC, PA) or "& Sons"/"Bros", or
 *   - a "dba" / "d/b/a" / "doing business as" form, or
 *   - a trade or business word that is not a common surname (Electric, Plumbing, Construction, Services, …), or
 *   - a single word (people are listed with at least two names).
 * Everything else, a bare two- or three-word name above all, is a person: when in doubt the row is dropped from
 * enforcement rather than pinned on a business.
 */

const SUFFIX = /\b(?:inc|incorporated|llc|l\s?l\s?c|corp|corporation|co|company|companies|ltd|limited|lp|llp|lllp|pllc|pc|p\s?c|pa|plc|na|assn|association|cooperative|co-op)\b\.?/i;
const FAMILY = /&\s*sons?\b|\band sons?\b|\bbros\b|\bbrothers\b/i;
const DBA = /\bd\/?b\/?a\b|\bdoing business as\b|\ba\/k\/a\b|\bt\/a\b|\btrading as\b/i;
/**
 * Trade and business words that are not common U.S. surnames. Words that are surnames as well (Power, Mason,
 * Carpenter, Painter, Stone, Wood, Glass, Homes, Turner, Crane, Fuller, Brick, Field, Hall, Bell, …) are left out
 * on purpose: "David Power" and "Joe Mason" are people.
 */
const TRADE = new Set(`
  air alarm alarms appliance appliances architects architecture asphalt associates bath baths builders building
  buildings cabinet cabinets carpentry ceilings center centre cleaning concrete conditioning consolidated
  construction constructors consultants consulting contracting contractor contractors controls cooling corporate
  custom demolition design designs development developers doors drainage drilling drywall electric electrical
  electricians electronics elevator elevators energy engineering engineers enterprise enterprises environmental
  equipment erectors excavating excavation exteriors fabrication fabricators fence fencing fire fireplace fireplaces
  flooring floors foundation foundations framing garage gas general glazing grading group gutter gutters handyman
  hauling heating holdings home improvement improvements industrial industries installation installations
  installers insulation interiors irrigation kitchen kitchens landscape landscaping lawn lighting maintenance
  management manufacturing masonry mechanical mechanics metals mobile network networks paving pest plumbing pools
  products project projects properties property protection pump pumping realty refrigeration remodeling remodelers
  renovation renovations repair repairs residential restoration roofing roofers sales sanitation security septic
  service services sheet siding signs solar solutions specialties specialty sprinkler sprinklers steel storage
  structures supply surfaces systems technical technologies technology telecom telecommunications tile tiling
  towers tree trucking underground utilities utility ventilation waterproofing welding wells windows wiring works
`.trim().split(/\s+/));
const TRADE_STEMS = /^(?:hvac|hvacr|plumb|electr|construct|roof|remodel|excavat|landscap|renovat|insulat|irrigat|refrigerat|waterproof)/i;

/** True when the name reads as a business by the rules above. */
export function looksLikeBusiness(name: string | null | undefined): boolean {
  const t = (name ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (SUFFIX.test(t) || FAMILY.test(t) || DBA.test(t)) return true;
  const words = t.toLowerCase().split(/[^a-z0-9&']+/).filter(Boolean);
  if (words.some((w) => TRADE.has(w) || TRADE_STEMS.test(w) || /\d/.test(w))) return true;
  // "LAST, FIRST" is a person; a single word with no comma is a trade name.
  return words.length === 1 && !t.includes(",");
}
