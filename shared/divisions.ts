/**
 * Division labels and state matching, shared by the CRM server (Divisions
 * overview, "Sort unassigned records") and the client (switcher, header badge,
 * Divisions tab).
 *
 * Alpine Exteriors runs two divisions that are BOTH named "Alpine Exteriors",
 * so a division is labelled by its code + region ("FL · Florida",
 * "WA · Washington"), the region coming from the division's own state. With no
 * recognisable state the label falls back to the division's name.
 */

/** USPS state/territory codes → names (reference data, not guessed). */
export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
);

/**
 * A free-text state ("WA", "wa", "Washington", " washington ") → its USPS
 * code, or null when it is not exactly a state code or a state name.
 */
export function normalizeUsState(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\.$/, "");
  if (!s) return null;
  const up = s.toUpperCase();
  if (US_STATE_NAMES[up]) return up;
  return NAME_TO_CODE[s.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

type DivisionLike = { id?: string; name: string; code: string; state?: string | null };

/** "FL · Florida" (code · region from the division's state), else "FL · <name>". */
export function divisionLabel(d: DivisionLike): string {
  const st = normalizeUsState(d.state);
  const region = st ? US_STATE_NAMES[st] : d.name;
  return region ? `${d.code} · ${region}` : d.code;
}

/** Divisions in tab/switcher order: by code, alphabetically (FL before WA). */
export function sortDivisions<T extends DivisionLike>(divisions: readonly T[]): T[] {
  return [...divisions].sort((a, b) => a.code.localeCompare(b.code, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name));
}

/** The request header carrying the division workspace: "all" or a division id. */
export const CRM_DIVISION_HEADER = "x-crm-division";
