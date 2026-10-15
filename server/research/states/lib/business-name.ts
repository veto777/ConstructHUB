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

/** Personal suffixes ("JR.", "III"): a person's name form, never a business's. */
const PERSONAL_SUFFIX = /^(?:jr|sr|ii|iii|iv|v)\.?$/i;
/** Surname particles of compound surnames ("VAN DYKE", "DE LA CRUZ", "MC DONALD", "ST JOHN"). */
const SURNAME_PARTICLES = new Set("van von der den ter de da das dos del dela della de' di du la le lo mc mac st st. saint ste san santa bin ben al el o' d'".split(" "));
/** The start of an entity word that a fixed-width field cut off (LL, IN, I, COR, LT, PLL…). */
const TRUNCATED_ENTITY = /^(?:l|ll|i|in|inc|co|cor|corp|corpo|lt|ltd|li|lim|p|pl|pll|pllc|pa|l\.?l)\.?$/i;
const NAME_WORD = /^(?:[a-z]\.?|[a-z][a-z'’-]*\.?)$/i;

/**
 * How a "LAST, FIRST" roster prints a person (A10, decision 3): "SMITH, JOHN", "GREEN, GENERAL H, JR.", "VAN DYKE,
 * GENERAL H", "DE LA CRUZ, MARIA", "SMITH JR, JOHN", "JOHN SMITH JR".
 *   - "person": the name has a personal form — one surname (after its particles and suffix) before the comma and one to
 *     three name words or initials after it, or a personal suffix and no entity word at the end; a trade word in it
 *     ("GENERAL") doesn't change that;
 *   - "ambiguous": a two-or-more-word name before the comma and a first name after it ("AIR CONDITIONING, JESSE"):
 *     it might be a person, so it isn't shown to be a business;
 *   - null: no personal form (the caller's business rules decide). An entity word at the end ("…, LLC") is never a
 *     personal form.
 */
export function personNameForm(name: string | null | undefined): "person" | "ambiguous" | null {
  const t = (name ?? "").replace(/\s+/g, " ").trim();
  if (!t || TRAILING_SUFFIX.test(t) || FAMILY.test(t) || DBA.test(t)) return null;
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  const words = (s: string) => s.split(" ").filter(Boolean);
  if (parts.length === 1) {
    const w = words(t);
    // "JOHN SMITH JR": a personal suffix ends a two-to-four-word name of plain name words ("ACME ROOFING II", with a
    // trade word, might be either: ambiguous).
    if (!(w.length >= 2 && w.length <= 5 && PERSONAL_SUFFIX.test(w[w.length - 1]) && w.every((x) => NAME_WORD.test(x)))) return null;
    return w.some((x) => TRADE.has(x.toLowerCase())) ? "ambiguous" : "person";
  }
  // Suffix parts after the first name ("…, JR.", "…, III") are dropped; any other extra part is no personal form.
  const [last, first, ...rest] = parts;
  if (rest.some((p) => !words(p).every((x) => PERSONAL_SUFFIX.test(x)))) return null;
  const firstWords = words(first).filter((x) => !PERSONAL_SUFFIX.test(x));
  if (!firstWords.length || firstWords.length > 3 || !firstWords.every((x) => NAME_WORD.test(x))) return null;
  // "PAVERS AND", "AND SCREENS": a joining word is no part of a first name.
  if (firstWords.some((x) => /^(?:and|of|the|&)$/i.test(x))) return null;
  const lastWords = words(last).filter((x) => !PERSONAL_SUFFIX.test(x));
  if (!lastWords.length || !lastWords.every((x) => NAME_WORD.test(x))) return null;
  // DBPR cuts long names at a fixed width: "KREATIVE REMODELING SPECIALISTS, LL" ends in a cut-off entity word.
  if (lastWords.length >= 2 && firstWords.length === 1 && TRUNCATED_ENTITY.test(firstWords[0])) return null;
  const core = lastWords.filter((x) => !SURNAME_PARTICLES.has(x.toLowerCase()));
  if (core.length === 1 || (core.length === 0 && lastWords.length === 1)) return "person";
  // Two or more words before the comma with a first name after it: may be a person ("ST. JOHN SMITH, MARY"), may be
  // a business ("AIR CONDITIONING, JESSE"). Not shown to be a business; a trade word after the comma makes it one.
  return firstWords.length <= 2 && !firstWords.some((x) => TRADE.has(x.toLowerCase().replace(/\.$/, ""))) ? "ambiguous" : null;
}
