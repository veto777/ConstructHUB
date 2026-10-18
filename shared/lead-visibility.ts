/**
 * Lead visibility by location (owner, 2026-10-18): "some leads the owner may not want shown to everyone in the team".
 * Per team member, the states and/or markets whose leads they may see. No rule = every lead. Owners and seats that
 * run Settings always see everything. Stored on crm_orgs.custom_fields.leadVisibility = { [memberId]: rule }.
 *
 * A lead passes a rule when its state is listed, OR its market is listed. A lead whose place is unknown passes only
 * when the rule says so (`unknownToo`), so an unplaced lead is hidden by default from a restricted seat — the
 * owner's intent is "not all are shared", so the doubt goes to hiding.
 */
import { normalizeUsState } from "./divisions";

export type LeadVisibilityRule = { states: string[]; markets: string[]; unknownToo: boolean };
export type LeadVisibility = Record<string, LeadVisibilityRule>;

export function leadVisibilityOf(customFields: unknown): LeadVisibility {
  const raw = (customFields as Record<string, any> | null | undefined)?.leadVisibility;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: LeadVisibility = {};
  for (const [memberId, r] of Object.entries(raw as Record<string, any>)) {
    if (!r || typeof r !== "object") continue;
    const states = Array.isArray(r.states) ? [...new Set(r.states.map((s: unknown) => normalizeUsState(String(s))).filter(Boolean) as string[])] : [];
    const markets = Array.isArray(r.markets) ? [...new Set(r.markets.map((m: unknown) => String(m).trim()).filter(Boolean))] as string[] : [];
    if (!states.length && !markets.length) continue; // an empty rule is no rule
    out[memberId] = { states, markets, unknownToo: r.unknownToo === true };
  }
  return out;
}

/** The rule for a member, or null when they see every lead. */
export function memberLeadRule(customFields: unknown, memberId: string): LeadVisibilityRule | null {
  return leadVisibilityOf(customFields)[memberId] ?? null;
}

export function leadAllowed(rule: LeadVisibilityRule | null, place: { state: string; market: string }, unknownState = "??", unknownMarket = "unknown"): boolean {
  if (!rule) return true;
  const placed = place.state !== unknownState || place.market !== unknownMarket;
  if (!placed) return rule.unknownToo;
  return rule.states.includes(place.state) || rule.markets.includes(place.market);
}
