/**
 * Markets — the places a company sells in, finer than a state: "Tampa", "St Petersburg", "Bellingham", "McKinney".
 * Stored per org on crm_orgs.custom_fields.leadMarkets; a lead is filed under a market from what is on the row
 * (server/crm/lead-state.ts): its own city, a city named in its message, the site it came through, or a phone area
 * code that belongs to exactly one market. Aliases let a market cover the towns around it ("stpete", "clearwater"
 * under St Petersburg) — the owner's call, editable, never inferred by the code.
 */
import { normalizeUsState } from "./divisions";

export type LeadMarket = {
  /** Stable key, e.g. "tampa". */
  key: string;
  name: string;
  state: string;
  /** Lower-case place names that mean this market (the name itself is always included). */
  aliases: string[];
  /** NANP area codes that fall in this market. A code shared by two markets resolves only the state. */
  areaCodes: string[];
};

export const UNKNOWN_MARKET = "unknown";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
/** letters only, lower-case — how place names are compared against hosts and text. */
export const placeKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function leadMarketsOf(customFields: unknown): LeadMarket[] {
  const raw = (customFields as Record<string, any> | null | undefined)?.leadMarkets;
  if (!Array.isArray(raw)) return [];
  const out: LeadMarket[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || !m.name) continue;
    const state = normalizeUsState(m.state);
    if (!state) continue;
    const name = String(m.name).trim().slice(0, 60);
    const aliases = Array.isArray(m.aliases) ? m.aliases.map((a: unknown) => String(a).trim().toLowerCase()).filter(Boolean) : [];
    out.push({
      key: String(m.key || slug(name)).slice(0, 40),
      name, state,
      aliases: [...new Set([name.toLowerCase(), ...aliases])],
      areaCodes: Array.isArray(m.areaCodes) ? m.areaCodes.map((c: unknown) => String(c).replace(/\D/g, "")).filter((c: string) => c.length === 3) : [],
    });
  }
  return out;
}
