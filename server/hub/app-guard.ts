/**
 * The iPhone apps sell nothing (owner, 2026-10-04 — App Store 3.1.3(f)): inside
 * either app Gabe must not quote prices or plans or suggest buying. This is a
 * deterministic guard, not a prompt rule: the native shells add a token to
 * their user agent (`ConstructHUBApp/<v>` / `ConstructHUBCRM/<v>` — the same
 * token client/src/lib/app-shell.ts reads), and a request carrying it gets the
 * one fixed answer for any price / plan / buying question — never the model,
 * whose knowledge pack carries the price book.
 */
import { variants } from "./prefilter";

/** The app shells' user-agent token (keep in step with client/src/lib/app-shell.ts). */
export const APP_UA_RE = /\bConstructHUB(?:App|CRM)\/\d[\w.]*/;

export function hubAppRequest(userAgent: string | undefined | null): boolean {
  return APP_UA_RE.test(userAgent ?? "");
}

/**
 * Presets whose answers quote prices, name plan tiers, walk through checkout or
 * hand the visitor to a sales rep. In the app these get the fixed line instead
 * of the template or cached model answer.
 */
export const APP_SALES_PRESETS: ReadonlySet<string> = new Set([
  "pricing", "which-plan", "trial", "get-started", "agency", "done-for-you",
  "master-class", "call-assistant", "call-number",
]);

// Price / plan / buying vocabulary. Matched against the cleaned plain and folded
// copies (so "Gr0wth" or "$ 149" still read), the way the pre-filter matches.
const SALES_RES: RegExp[] = [
  /\b(how much|price|prices|pricing|cost|costs|costing|fee|fees|expensive|cheap|cheaper|discount|overage)\b/,
  /\$\s?\d/,
  /\b(per month|per minute|per year|a month|monthly|yearly|annual|annually|per location)\b/,
  /\b(plan|plans|tier|tiers|add[- ]?ons?|subscription|subscriptions|subscribe|subscribed|membership|trial|trials)\b/,
  /\b(upgrade|downgrade|billing|checkout|cart|refund|invoice|invoices|receipt|payment method|card|cards)\b/,
  /\b(buy|buying|purchase|purchasing|pay for|paying|sales rep|talk to sales|talk to a sales|sales team)\b/,
  /\b(seats?|credits?)\b/,
  // Plan and tier names. "Pro", "Crew" and "Fleet" are left out on purpose — contractors say
  // "I'm a pro" and "my crew" in ordinary feature questions; "the Crew tier" still matches "tier".
  /\b(starter|growth|agency|lite|solo)\b/,
  /\bfree\b/,
];

/**
 * Does this free-text question ask about prices, plans or buying? Deliberately
 * a superset of the sales presets: in the app the honest answer to every one of
 * these is the fixed line, so over-matching only costs a polite redirect, while
 * under-matching would let a price through to the reviewer.
 */
export function appSalesQuestion(raw: string): boolean {
  const v = variants(String(raw ?? ""));
  return SALES_RES.some((re) => re.test(v.plain) || re.test(v.folded));
}

/** The billing deep link the pre-filter's own-account table uses (prefilter.ts OWN_LINKS). */
const BILLING_LINK_PATH = "/settings?tab=billing";

/**
 * App-mode override for a pre-filter refusal: replies that quote a sales rep or
 * point at Settings → Billing sell something the app doesn't have. Returns the
 * reply code to send instead, or null to keep the pre-filter's own reply.
 */
export function appPrefilterOverride(reply: string, linkPath?: string): "R_APP_PRICING" | null {
  if (reply === "R_SALES") return "R_APP_PRICING";
  if (reply === "R_OWN_DATA" && linkPath === BILLING_LINK_PATH) return "R_APP_PRICING";
  return null;
}

// Sales content beyond a bare price: a plan/tier name presented as something to buy or
// included-with, purchase vocabulary, per-unit pricing. Over-blocking only costs the
// polite fixed line; under-blocking would put "included with the Pro plan" on a phone.
const APP_OUTPUT_LEAK_RES: RegExp[] = [
  /\b(starter|growth|agency|lite|solo|crew|fleet|pro)\b[\w'’-]*\s+(plan|tier)\b/,
  /\b(plan|plans|tier|tiers)\b.{0,40}\b(included|include|includes|comes with|offers?|gets?)\b/,
  /\b(included|include|includes|comes with)\b.{0,30}\b(plan|tier|subscription)\b/,
  /\b(add-?ons?|addons?)\b/,
  /\b(upgrade|downgrade|subscribe|subscription|subscriptions|checkout|trial|trials)\b/,
  /\b(billing|sales rep|talk to sales|stripe'?s? secure checkout|payment method)\b/,
  /\bper\s+(month|minute|year|seat|location|number)\b/,
  /\b(no free plan|one trial per customer)\b/,
];

/** App-mode output gate: no answer in the app may state a price, name a plan to buy or point at Pricing. */
export function appAnswerBlocked(text: string): boolean {
  if (/\$\s?\d/.test(text) || /\]\(\/pricing/.test(text)) return true;
  const v = variants(text);
  return APP_OUTPUT_LEAK_RES.some((re) => re.test(v.plain) || re.test(v.folded));
}
