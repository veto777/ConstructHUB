/**
 * Pure geography for the permit-coverage map (components/permit-map.tsx): the
 * state join table and the "can the projection place this point?" guard.
 *
 * The map draws with d3's geoAlbersUsa, a composite of three insets (lower 48
 * + DC, Alaska, Hawaii). Any point outside those insets projects to null —
 * Puerto Rico, Guam, the Virgin Islands, American Samoa, the Marianas, and any
 * NaN. react-simple-maps' <Marker> destructures the projection result, so a
 * null is a TypeError that unmounts the whole page: that is how an "72":"PR"
 * entry here white-screened /search (Oct 2026). Every Marker coordinate must
 * pass placeable() first; server/permits/permit-map.test.ts proves the table
 * against the real topojson.
 */
import { geoAlbersUsa, geoCentroid } from "d3-geo";

/** State FIPS (us-atlas geography id) -> USPS code, for the states the projection can draw. */
export const FIPS_USPS: Record<string, string> = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL",
  "13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME",
  "24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH",
  "34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI",
  "45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI",
  "56":"WY",
};

// Whether a point falls inside an inset does not depend on scale or translate,
// so one default instance answers for the map's configured projection too.
const albersUsa = geoAlbersUsa();

/** True when geoAlbersUsa can place [lng, lat]: finite numbers inside one of its insets. */
export function placeable(coords: unknown): coords is [number, number] {
  if (!Array.isArray(coords) || coords.length < 2) return false;
  const [lng, lat] = coords;
  if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return albersUsa([lng, lat]) !== null;
}

/** Where to put a state's code label, or null when the state cannot be drawn. */
export function stateLabelPoint(geo: Parameters<typeof geoCentroid>[0]): [number, number] | null {
  const c = geoCentroid(geo);
  return placeable(c) ? c : null;
}
