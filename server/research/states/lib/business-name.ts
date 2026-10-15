/**
 * Is this name a business or a person? (audit 2026-10-15, decision 5). Enforcement records are kept for companies
 * only (FCRA), so a pack that reads names from a roster or a PDF must not take "David Power" for a business. A name
 * counts as a business only when it carries
 *   - a corporate suffix (Inc, LLC, Corp, Co, Company, Ltd, LP, LLP, PLLC, PC, PA) or "& Sons"/"Bros", or
 *   - a "dba" / "d/b/a" / "doing business as" form, or
 *   - a trade or business word that is not a common surname (Electric, Plumbing, Construction, Services, …), as a
 *     WHOLE word ("Roofing" counts, "Roofner" does not; audit round 2, decision 3), or
 *   - "The …" or "<name> of <place>".
 * Everything else is a person: a bare two- or three-word name above all, and a single word too (a surname alone,
 * "SMITH", is not shown to be a business; round 3, decision 3). When in doubt the row is dropped from
 * enforcement rather than pinned on a business. This is a fallback: a source that publishes an entity type or a
 * license class (corporation, sole proprietor, journeyman, …) uses that instead. It may decide whether a record
 * counts as a business's for enforcement; it never sets a license's holder (round 3, decision 3), so it never
 * unlocks an address or phone.
 */

const SUFFIX = /\b(?:inc|incorporated|llc|l\s?l\s?c|corp|corporation|co|company|companies|ltd|limited|lp|llp|lllp|pllc|pc|p\s?c|pa|plc|na|assn|association|cooperative|co-op)\b\.?/i;
const FAMILY = /&\s*sons?\b|\band sons?\b|\bbros\b|\bbrothers\b/i;
const DBA = /\bd\/?b\/?a\b|\bdoing business as\b|\ba\/k\/a\b|\bt\/a\b|\btrading as\b/i;
/**
 * Trade and business words that are not common U.S. surnames. Words that are surnames as well (Power, Mason,
 * Carpenter, Painter, Stone, Wood, Wells, Kitchen, Glass, Homes, Turner, Crane, Fuller, Brick, Field(s), Hall, Bell,
 * Steel, Sales, Towers, Bath, Home, Gas, Doors, Lawn, Tree, Pool, Pump, Fence, Booth, Gardner, Plummer, …) are left
 * out on purpose: "David Power", "Joe Mason" and "John Steel" are people.
 */
const TRADE = new Set(`
  air alarm alarms appliance appliances architects architecture asphalt associates baths builders building buildings
  cabinet cabinets carpentry ceilings cleaning concrete conditioning consolidated construction constructors
  consultants consulting contracting contractor contractors controls cooling corporate custom demolition design
  designs development developers drainage drilling drywall electric electrical electricians electronics elevator
  elevators energy engineering engineers enterprise enterprises environmental equipment erectors excavating
  excavation exteriors fabrication fabricators fencing fire fireplace fireplaces flooring floors foundation
  foundations framing garage general glazing grading group gutter gutters handyman hauling heating holdings
  improvement improvements industrial industries installation installations installers insulation interiors
  irrigation kitchens landscape landscaping lighting maintenance management manufacturing masonry mechanical
  mechanics metals network networks paving plumbing pools products project projects properties property protection
  pumping realty refrigeration remodeling remodelers renovation renovations repair repairs residential restoration
  roofing roofers sanitation security septic service services sheet siding solar solutions specialties specialty
  sprinkler sprinklers storage structures supply surfaces systems technical technologies technology telecom
  telecommunications tile tiling trucking painting painters graphics sunrooms patios const ironworks woodworking
  granite backhoe countertops imports detection studio resort casino underground utilities utility ventilation
  waterproofing welding windows wiring hvac hvacr plumbers plumber electrician constructing roofs remodel excavators
  landscapers landscaper renovators insulators refrigerating waterproofers
`.trim().split(/\s+/));

/**
 * Entity forms as the name's last word only (", LLC", " INC", " CO." at the end; round 4, decision 4): for a source
 * that prints people as "LAST, FIRST", where "CO, JOHN" or "PA, MARY" is a surname, not an entity form.
 */
export const TRAILING_SUFFIX = /(?:^|[\s,])(?:inc|incorporated|llc|l\.?\s?l\.?\s?c|corp|corporation|co|company|companies|ltd|limited|lp|l\.p|llp|l\.l\.p|lllp|pllc|p\.?l\.?l\.?c|pc|p\.\s?c|pa|p\.\s?a|plc|na|assn|association|cooperative|co-op)\.?\s*$/i;

/** True when the name reads as a business by the rules above. */
export const looksLikeBusiness = (name: string | null | undefined): boolean => readsAsBusiness(name, SUFFIX);
/** looksLikeBusiness, with a corporate suffix counted only as the name's last word (TRAILING_SUFFIX). */
export const looksLikeBusinessTrailingSuffix = (name: string | null | undefined): boolean => readsAsBusiness(name, TRAILING_SUFFIX);

function readsAsBusiness(name: string | null | undefined, suffix: RegExp): boolean {
  const t = (name ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (suffix.test(t) || FAMILY.test(t) || DBA.test(t)) return true;
  const words = t.toLowerCase().split(/[^a-z0-9&']+/).filter(Boolean);
  // Digits are no sign of a business: names in rosters and PDFs often carry a case number or a date.
  if (words.some((w) => TRADE.has(w))) return true;
  // "The …" / "(THE)" and "<name> of <place>" franchises ("Paul Davis of Reno Lake Tahoe") are businesses.
  if (/^the\s|\(the\)/i.test(t) || (/\sof\s/i.test(t) && words.length >= 4)) return true;
  // Anything else (a bare name, a single word that may be a surname) is not shown to be a business.
  return false;
}
