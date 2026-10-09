/**
 * Hub output filter (guardrails §6). Every model reply — chat answers and the
 * cached preset answers alike — passes through filterOutput() before it can
 * reach a browser. Model output is attacker-controlled: a reply that fails a
 * check is never repaired and sent, it is replaced by R_FALLBACK. The only
 * repairs are the strip / rewrite / truncate steps marked below.
 *
 * Provider-neutral: the O2 strip removes TruthCoder's tool-call and reasoning markup and is a
 * no-op on a plain markdown answer, so an OpenAI-style reply (bold, bullets, a numbered list)
 * passes through as written and every content check still applies to it — fixtures in
 * output-filter.test.ts, "OpenAI-style answers".
 *
 * Pure: no DB, no request, no model.
 */
import {
  PLANS, PLAN_KEYS, ADDONS, AGENCY_LOCATION_BANDS, ANNUAL_MONTHS, GBP_REINSTATEMENT_CENTS, SALES_THRESHOLD_CENTS, TRIAL_DAYS,
  CALL_ASSISTANT_TIERS, CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE, type PlanKey,
} from "@shared/plans";
import { CRM_PLANS, CRM_PLAN_KEYS, CRM_TRIAL_DAYS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS } from "@shared/crm-plans";
import { hubLinkFor } from "@shared/hub-links";
import { DFY_CATALOG, COURSE_BUNDLE } from "../catalog";
import {
  cleanText, HOST_SOURCE, OWN_HOST_RE, BRACKET_DOT_RE, SPELLED_DOMAIN_RE, EMAIL_OBFUSCATED_RE, EMAIL_SPACED_RE,
  PHONE_RE, SPELLED_DIGITS_RE, VANITY_PHONE_RE, ADDRESS_CASED_RE,
} from "./prefilter";
import { promptInstructionText, NOT_SURE_LINE, REDIRECT_LINE, CANARY } from "./prompt";
import { knowledgeBook, dollarAmounts, type KnowledgeBook } from "./knowledge";
import { cleanAiText, REASONING_LEAK, RESIDUAL_MARKUP } from "../ai-output";
import { SEO_CREDIT_PACKS } from "@shared/seo-credits";
import { SEO_PLAN_LIMITS } from "@shared/plans";

export type OCode = "O1" | "O2" | "O4" | "O6" | "O7" | "O8" | "O9" | "O10" | "O11" | "O12" | "O13" | "O14" | "O15" | "O16" | "O17" | "O18";
export type ModelOutput = { content?: string | null; finishReason?: string | null; toolCalls?: unknown; functionCall?: unknown };
/**
 * `echo`: the request's own turns. A reply may not repeat a run of the visitor's words (O18);
 * text that is in an earlier (signed, already filtered) Gabe answer or in the knowledge pack is fine.
 */
export type FilterOptions = { publicOnly: boolean; canary?: string; book?: KnowledgeBook; echo?: { user: readonly string[]; assistant?: readonly string[] } };
export type FilterResult = { ok: true; text: string } | { ok: false; code: OCode };

class Blocked extends Error { constructor(readonly code: OCode) { super(code); } }
const block = (code: OCode): never => { throw new Blocked(code); };

const NEG = /\b(no|not|never|nothing|none|isn'?t|aren'?t|doesn'?t|don'?t|can'?t|cannot|won'?t|neither|nor)\b/i;
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
/** A non-global copy, so .test() carries no lastIndex between calls. */
const once = (re: RegExp) => new RegExp(re.source, re.flags.replace("g", ""));
/** A negation in the few words right before position `at` ("not a scam", "isn't free"). */
const negatedAt = (s: string, at: number) => NEG.test(s.slice(Math.max(0, at - 24), at));

// O4
const ACTIVE = /<script|<iframe|<object|<embed|<svg|<style|<img|\bon(click|error|load|mouse\w+|focus|blur|submit|change|key\w+)\s*=|javascript:|vbscript:|\bdata:[a-z]+\/|```|!\[/i;

// O6
const MD_LINK = /\[([^\]\n]{1,80})\]\(([^)\s]+)\)/g;
const OWN_URL = /^https?:\/\/(?:www\.)?constructhub\.us(\/\S*)?$/i;
const PLAIN_OWN_HOST = /^(?:www\.|portal\.)?constructhub\.us$/i;
const IP_LITERAL = /\d{1,3}(?:\.\d{1,3}){3}/;
const OTHER_SCHEME = /\b(mailto|tel|sms|ftp|file|intent|chrome|about):/i;
const BARE_URL = /\bhttps?:\/\/[^\s)<>\]]+|\bwww\.[^\s)<>\]]+/gi;
const PROTOCOL_RELATIVE = /(?<![\w:/])\/\/[^\s/]+/;
/** Any host, any TLD ("constructhub-billing.shop", "constructhub.ru"); only ConstructHUB's own host may appear. */
const BARE_DOMAIN = new RegExp(HOST_SOURCE, "giu");
const ANY_HOST = new RegExp(HOST_SOURCE, "giu");
const BRACKET_DOT = once(BRACKET_DOT_RE);
const SPELLED_DOMAIN = once(SPELLED_DOMAIN_RE);

// O7
// The same patterns the egress redaction uses (prefilter.ts), so a contact detail the visitor
// could not send out cannot come back in a reply either.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const EIN = /\b\d{2}-\d{7}\b/;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/;
const CONTACT: RegExp[] = [
  EMAIL, once(EMAIL_SPACED_RE), once(EMAIL_OBFUSCATED_RE), SSN, EIN, CARD, once(PHONE_RE), /\d(?:[\s.()-]{0,3}\d){6,}/,
  once(SPELLED_DIGITS_RE), once(VANITY_PHONE_RE), ADDRESS_CASED_RE,
];
/** "Acme Roofing and Lone Star Builders both use ConstructHUB": a named business said to be a customer. */
const BUSINESS = /\b[A-Z][\w&'.-]*(?:\*\*)?(?: [A-Z][\w&'.-]*)* (Roofing|Construction|Builders|Building|Contracting|Contractors|Plumbing|Electric|Electrical|HVAC|Remodeling|Renovations?|Homes|Exteriors|Siding|Painting|Landscaping|Concrete|Solar|Restoration|Gutters|LLC|Inc|Corp)\b/;
const TENANT_CLAIM = /\b(uses?|using|used|rel(y|ies) on|(is|are) on|signed up|customers?|subscribers?|members?|clients? of|(their|its) (plan|account|trial|subscription))\b/i;

// O10
const PLAN_NAMES = PLAN_KEYS.map((k) => PLANS[k].name);
// The CRM is sold on its own plans ("the CRM plan", "CRM Essentials"), so its
// names are sold names too (shared/crm-plans.ts).
const CRM_PLAN_WORDS = ["CRM", ...CRM_PLAN_KEYS.flatMap((k) => CRM_PLANS[k].name.split(" "))];
const PLAN_WORD_OK = new Set([
  // The AI Call Assistant's tiers ("the 500 minutes tier", "the Call Assistant tier") are sold names too (shared/plans.ts CALL_ASSISTANT_TIERS).
  ...PLAN_NAMES, ...CRM_PLAN_WORDS, ...CALL_ASSISTANT_TIERS.map((t) => t.name), "Assistant", "Every", "Each", "Any", "Which", "This", "That", "Your", "The", "No", "Paid", "Monthly", "Annual",
  "Yearly", "Pricing", "A", "An", "One", "Our", "My", "Their", "Current", "New", "Same", "Right", "Cheapest", "Higher",
  "Lower", "Bigger", "Larger", "Smaller", "Other", "Different", "Cloudflare", "Blotato", "Google", "Stripe",
  "ConstructHUB", "ConstructHub", "Change", "Choose", "Switch", "Pick", "Select", "Compare", "Upgrade", "Downgrade", "Cancel",
]);
// From server/pricing-copy.test.ts: the plans sold before 2026-09-30 and retired copy.
const LEGACY_PLAN = /\b(Standard|Professional|Business|Premium|Gold|Platinum)\s+(plan|plans|member|members|subscriber|subscribers|tier)\b/i;
const LEGACY_WORDS = [/\bPlatinum\b/, /\$995\b/, /\$499\/mo/, /Unlimited everything/i, /\$9,999/, /billed separately/i, /separate membership/i];
const COMMERCIAL: RegExp[] = [
  /\b\d+\s?%\s?(off|discount)/i, /\bcoupons?\b/i, /\bpromo(tion|tional)? codes?\b/i, /\bdiscount codes?\b/i,
  /\blifetime (deal|plan|access)\b/i, /\bmoney[- ]back\b/i, /\bprice[- ]match/i, /\bfree trial/i, /\bunlimited\b/i,
  /\b(half|\d+\s?(%|percent))[ -]?(off|price|discount|cheaper)\b/i, /\bsave (\d+\s?(%|percent)|half|up to)(?!\w)/i,
  /\bfirst (month|week|year|\d+ (days|weeks|months))( is| are)? (free|on us|at no (cost|charge))\b/i,
  /\bfree for (the first|a|one|your first|\d+) (month|week|year|days?|weeks|months)\b/i,
  /\bpay (only |just )?once\b/i, /\bI can (approve|offer|give you|knock|get you|do)\b[^.]{0,40}\b(deal|discount|price|rate|special|off|down)\b/i,
];
/** Commercial claims checked per sentence and blocked unless negated in that sentence. */
const COMMERCIAL_UNLESS_NEGATED: RegExp[] = [
  // "Pro is free right now", "Starter costs nothing", "the Pro plan is free for contractors"
  /\b(Starter|Pro|Growth|Agency|ConstructHUB|(the|a|any|every|each|your|this|that|our) ([\w-]+ )?(plan|tier|subscription|membership|package))( plan| tier)?\s(is|are|costs?|comes|will be|becomes)( (now|currently|totally|completely|100%|entirely|also|still|actually|just|basically|always))? (free|nothing|zero|0 dollars)\b(?! to\b)/i,
  /\b(Starter|Pro|Growth|Agency|ConstructHUB)( plan| tier)?'s (now |currently |totally |completely |100% |entirely |actually |basically )?(free|nothing)\b(?=\s*([.!?,;]|$|now\b|today\b|this\b|for (everyone|contractors|you|all|new)\b|right now\b))/i,
  /\bcosts? (you )?nothing\b/i, /\bzero dollars\b/i,
  /\b(keep|use|own|have|access)\b[^.]{0,40}\bforever\b/i,
  // savings promises (the pack: "no savings are guaranteed")
  /\b(save|saves|saving) you (money|cash|\$|on (ad|your) (spend|budget))/i, /\bfrom costing you\b/i, /\bcosting you money\b/i,
  /\b(no more|stops?|stopping) wast(ed|ing) (ad )?(spend|money|clicks|budget)\b/i,
  // ranking promises ("Growth puts you at #1 on Google Maps within 30 days, promised")
  /\bpromise[sd]?\b/i, /(#\s?1|number one|first place|top spot|top (3|three))\b[^.]{0,40}\b(google|maps|rank\w*|results|search)\b/i,
];
/** "N months free" is how the pack describes yearly billing; any other free stretch is a promotion. */
const FREE_STRETCH = /\b(\w+) (free )?(months?|weeks?|days?) (free|on us|at no (cost|charge))\b/i;
const YEARLY = new RegExp(String.raw`\b(year|years|yearly|annual|annually|${ANNUAL_MONTHS} times)\b`, "i");
/** Discount talk about ConstructHUB's own plans. CRM estimate/invoice discounts are a real feature. */
const DISCOUNT = /\bdiscount(s|ed)?\b/i;
const DISCOUNT_PLAN_CONTEXT = /\b(Starter|Pro|Growth|Agency|plans?|subscription|ConstructHUB|checkout|code|approve|special|launch|signups?|sign-?ups?|first month)\b|\$/i;
const DISCOUNT_CRM_CONTEXT = /\b(estimates?|invoices?|line items?|price book|clients?|customers?|reviews?|referral|offers?)\b/i;
/** Promo-code-like tokens next to checkout/code words ("Mention BUILD20 at checkout"). */
const PROMO_TOKEN = /\b[A-Z]{3,}\d{2,}\b/;
const PROMO_CONTEXT = /\b(checkout|code|coupon|promo|mention|enter|apply|use|redeem)\b/i;
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90 };
const NUM = String.raw`(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|sixty|ninety)`;
/** Every way of stating a trial length: "14-day trial", "two-week trial", "the trial lasts 14 days", "try any plan for 14 days". */
const TRIAL_LENGTHS: RegExp[] = [
  new RegExp(String.raw`\b${NUM}[\s-](day|week|month)s?[\s-](free[\s-])?trial`, "gi"),
  new RegExp(String.raw`\btrial(?: period)? (?:lasts|is|runs|of|length is|gives you|covers)(?: for| about| only| just| a full)? ${NUM}[\s-](day|week|month)s?\b`, "gi"),
  new RegExp(String.raw`\btry(?: out)? (?:it|constructhub|any plan|a plan|the plan|every plan|each plan|all plans|starter|pro|growth|agency|the platform|us|everything|them)(?: out)?(?: free| for free)? for ${NUM}[\s-](day|week|month)s?\b`, "gi"),
];
/** Owner-maintained: things ConstructHUB does not sell. Blocked unless negated in the same sentence. */
export const NOT_SOLD: RegExp[] = [
  /\bwhite[- ]label(ed|ing)? (reseller|resale|program|platform|app|version|product|dashboard|crm|software)\b/i,
  /\bresell(er|ing)? (program|plan|rights)\b/i, /\b(iphone|android|ios|mobile|native) (apps?|applications?)\b/i, /\bpublic api\b/i,
  /\bapi access\b/i, /\bzapier\b/i, /\baffiliate program\b/i, /\bpartner program\b/i, /\b(phone|live chat|24\/7) support\b/i,
  // Owner, 2026-10-08: the SEO tools come with the Agency plan only; nothing SEO is sold à la carte and no such price exists.
  // (\b does not see "à" as a word character, so the boundary is written out.)
  /\bseo (add-?ons?|addon)\b/i, /\b(rank[- ]?track\w*|keyword[- ]research|backlinks?) (add-?ons?|addon)\b/i, /(?:^|[^\p{L}])[àa][ -]la[ -]carte(?![\p{L}])/iu,
  /\b(add-?ons?|addon|upgrade) for (the |your )?(seo|rank[- ]?track\w*|keyword[- ]research|backlinks?)\b/i,
  // Owner, 2026-10-08: the AI Call Assistant is a separate service with its own subscription — never "an add-on to
  // the Pro plan", and no plan or CRM plan includes it.
  /\bcall assistant\b[^.]{0,40}\b(an? )?(add-?on|addon) (to|for|on|of) (the |a |any |your |every )?(?:[\w,]+[- ]){0,6}plans?\b/i,
  /\b(starter|pro|growth|agency|every|any|all|each|crm)( plan)?s? (include|includes|come with|comes with|gets?|has|have)\b[^.]{0,30}\bcall assistant\b/i,
];
/** A sentence about the SEO tools (for the amounts it may carry). */
const SEO_TOPIC = /\b(seo|rank[- ]?track\w*|keyword[- ]research|backlinks?)\b/i;
/** In a sentence about SEO, an amount may only be the price of a plan that includes the tools… */
const SEO_PLAN_CENTS: ReadonlySet<number> = new Set(
  PLAN_KEYS.filter((k) => PLANS[k].limits.seoKeywords !== 0).flatMap((k) => [PLANS[k].monthlyCents, PLANS[k].annualCents]));
/** …or, next to a credit / data word, the monthly SEO data allowance or a prepaid pack (shared/seo-credits.ts). */
const SEO_CREDIT_CENTS: ReadonlySet<number> = new Set([...SEO_CREDIT_PACKS, ...PLAN_KEYS.map((k) => SEO_PLAN_LIMITS[k].seoCreditCents).filter((c) => c > 0)]);
const SEO_CREDIT_CUE = /\b(credits?|prepaid|packs?|data|allowance)\b/i;
/** An add-on's own prices (never the SEO data amounts ADDON_CENTS also carries). */
const ADDON_PRICE_CENTS: ReadonlySet<number> = new Set(Object.values(ADDONS).flatMap((a) => [a.monthlyCents, a.annualCents, ...(a.setupCents ? [a.setupCents] : [])]));
/** ADDON_CUE without the SEO data words, so "SEO data" alone never opens the add-on exemption. */
const addonCueWithoutSeo = (s: string) => ADDON_CUE.test(s.replace(/\bseo data\b|\bdata credit\b/gi, " "));
/**
 * The founding member offer has no public number of places, no customer count and no deadline
 * (owner, 2026-10-08). A count is read by its SUBJECT, not its wording: a number — in digits or
 * spelled out ("twelve", "two thousand", "a dozen", "thousands of") — within two words of a
 * people / places noun — "We have 500 founding members", "over 1,000 customers", "only 200 spots
 * left", "the first 10,000 sign-ups", "twelve customers" — or the subject first and its number
 * after ("our customers number 12,000", "customer count: twelve thousand", "contractors, 2,000 of
 * them"). The one such number the pack states is a plan's seat allowance ("10 agency seats",
 * "2 extra seats"): "seats" counts only next to a scarcity word.
 */
const COUNT_SUBJECT = String.raw`(customers?|users?|members?|founding members?|founders?|subscribers?|contractors?|companies|businesses|agencies|people|sign-?ups?|spots?|places?|slots?|seats?)`;
const SMALL_NUMBER = String.raw`(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)`;
const BIG_NUMBER = String.raw`(?:hundred|thousand|million)`;
/**
 * "one" counts too ("We have one customer") — but only before a customer-y subject, never before the
 * allowance words ("one user per seat", "one place to see every call"), see COUNT_ONE_SUBJECT.
 */
const COUNT_WORDS = String.raw`(\d[\d,]*|${SMALL_NUMBER}(?:[- ]${SMALL_NUMBER})?(?: ${BIG_NUMBER})?|(?:a|one|several|many|a few|a couple of) (?:${BIG_NUMBER}|dozen)(?: ${BIG_NUMBER})?|(?:hundreds|thousands|millions|dozens)(?: of thousands)?|(?:one|a single|just one|only one|exactly one))`;
const COUNT_ONE_SUBJECT = /^(customers?|members?|founding members?|founders?|subscribers?|contractors?|companies|businesses|agencies|sign-?ups?)$/i;
const ONE_WORD = /^(one|a single|just one|only one|exactly one)$/i;
/** The words such a claim puts between the number and its subject ("500 happy paying customers"); any other word means the number counts something else ("30 sites contractors should be on"). */
const COUNT_ADJ = String.raw`(?:founding|founder|new|first|paying|happy|active|early|loyal|satisfied|real|local|small|big|registered|signed-up|verified|more|extra|additional|other|agency|team|crm|included)`;
/** The words that make a count of ONE a product quantity, not a customer claim ("one team member", "one extra seat"); every other adjective ("one local / new / first / paying customer") is a claim. */
const QUANTITY_ADJ = /^(?:\s*(?:more|extra|additional|other|agency|team|crm|included))+\s*$/i;
const COUNT_CLAIM = new RegExp(String.raw`\b${COUNT_WORDS}\s+(?:of\s+)?((?:${COUNT_ADJ}\s+){0,2})${COUNT_SUBJECT}\b`, "gi");
/** Subject first: "customers number 12,000", "the customer count is twelve thousand", "contractors: over 2,000", "members now total 5,000". */
const COUNT_REVERSED = new RegExp(String.raw`\b${COUNT_SUBJECT}\b(?: base| count| total| number)?(?:\s+(?:on|in|at|across|using|of) (?:the |our |this )?\w+)?(?:\s+(?:now|already|currently|today))?\s*(?::|—|–|-|\bis\b|\bare\b|\b(?:has|have|had) (?:now |already )?(?:reached|passed|surpassed|hit|topped)\b|\bnumbers?\b|\bnumbering\b|\btotals?\b|\btotaling\b|\bstands? at\b|\breach(?:ed|es)?\b|\bexceeds?\b|\btops?\b|\bpassed\b|\bsurpassed\b|\bhit\b|\bof\b)\s+(?:at |around |about |over |more than |nearly |roughly |some |already |now )*${COUNT_WORDS}\b`, "gi");
/** "contractors, 2,000 of them". */
const COUNT_OF_THEM = new RegExp(String.raw`\b${COUNT_SUBJECT}\b[^.]{0,20}?\b${COUNT_WORDS} of (?:them|whom|which)\b`, "gi");
const SCARCE = /\b(left|remaining|available|only|first|limited|last|open)\b/i;
/** True when the sentence states how many customers / members / spots there are ("seats": only with a scarcity word next to the number). */
function statesCount(s: string): boolean {
  const seatsOnly = (subject: string, m: RegExpMatchArray) =>
    /^seats?$/i.test(subject) && !SCARCE.test(s.slice(Math.max(0, m.index! - 24), m.index! + m[0].length + 24));
  // A count of one is a customer count with a customer-y subject, bare or with any claim word ("one customer",
  // "a single contractor", "one paying / local / new / first customer") — never a product quantity ("one user
  // per seat", "one team member", "one extra seat").
  // …and "one contractor account" / "one customer record" counts a thing of the customer's, not customers.
  const compound = (m: RegExpMatchArray) => /^\s+(?:accounts?|plans?|seats?|locations?|profiles?|records?|numbers?|logins?|portals?|dashboards?)\b/i.test(s.slice(m.index! + m[0].length));
  const oneOk = (count: string, subject: string, m: RegExpMatchArray, adjectives = "") =>
    !ONE_WORD.test(count) || (COUNT_ONE_SUBJECT.test(subject) && !QUANTITY_ADJ.test(adjectives) && !compound(m));
  for (const m of s.matchAll(COUNT_CLAIM)) if (!seatsOnly(m[3], m) && oneOk(m[1], m[3], m, m[2])) return true;
  for (const m of s.matchAll(COUNT_REVERSED)) if (!seatsOnly(m[1], m) && oneOk(m[2], m[1], m)) return true;
  for (const m of s.matchAll(COUNT_OF_THEM)) if (!seatsOnly(m[1], m) && oneOk(m[2], m[1], m)) return true;
  return false;
}
const DAY_WORDS = String.raw`(\d|tonight|today|tomorrow|midnight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|this (week|month|weekend|year)|next (week|month|year)|end of (the )?(week|month|year))`;
/** A limit with no subject, a deadline for the offer, urgency. */
const FOUNDING_LIMITS: RegExp[] = [
  /\b(limited to|capped at|a cap of|maximum of)\s+\d[\d,]*\b/i,
  new RegExp(String.raw`\b(founding|founders?'?|lifetime|locked[- ]in|offer)\b[^.]{0,60}\b(ends?|expires?|expiring|deadline|closes?|closing|until|through|before)\b[^.]{0,20}\b${DAY_WORDS}\b`, "i"),
  /\b(hurry|act (fast|now)|while (supplies|spots|places|seats|it) lasts?|before (it'?s|they'?re) gone|don'?t miss out)\b/i,
];

// O11
const SALES_ONLY_NAMES: string[] = [
  ...Object.values(DFY_CATALOG).map((item) => item.name.split(" — ")[0]),
  ...COURSE_BUNDLE.name.split(" — "), "Master Class", "Complete Business Build", "SEO program",
];

// O12
const ACTION_DONE = /\bI(?:'ve| have| just| already)? (sent|emailed|texted|created|scheduled|booked|updated|changed|cancel+ed|refunded|upgraded|downgraded|deleted|reset|added|submitted|forwarded|processed|applied|issued|switched|moved|credited|approved|extended|waived|activated|unlocked|granted|enabled|removed|went ahead)\b/i;
const ACTION_WILL = /\bI(?:'ll| will| am going to|'m going to) (send|email|text|create|schedule|book|update|change|cancel|refund|upgrade|downgrade|delete|reset|add|submit|forward|process|apply|issue|switch|move|credit|approve|extend|waive|activate|unlock|grant)\b/i;
const ACCESS = /\b(i can see|i see (that )?your|your account (shows|has|is)|our (records|database|system|logs) shows?|i('ve| have) access|according to your (account|records)|i (checked|looked (up|at)) your|looking at your (account|subscription|records|data|usage|invoices|billing)|your (plan|account|subscription|billing) (shows|says|lists|indicates|is set to)( that)? (you|you'?re|pro|starter|growth|agency|\d))\b/i;
/** "Your refund has been processed" (not "once your payment has been processed, …"). */
const PASSIVE_DONE = /\byour (\w+ ){0,2}(refunds?|plan|account|subscription|card|payments?|invoices?|seats?|locations?|request|password|trial|order|charge|cancellation|upgrade|downgrade|credit) (has|have) (now |just |already )?been (processed|refunded|applied|upgraded|downgraded|cancel+ed|changed|sent|issued|credited|switched|moved|updated|reset|deleted|removed|added|submitted|approved|extended|waived|activated)\b/i;
const CONDITIONAL = /\b(once|after|when|if|until|as soon as|before|whether)\b/i;
/** A one-word "Sent!" / "Refunded!" sentence. */
const DONE_EXCLAIM = /^(sent|refunded|upgraded|downgraded|cancel+ed|processed|switched|applied|submitted|credited|issued)[!.]?$/i;
const APPLIED_REFUND = /\bapplied an? (full |partial )?(refund|credit|discount)\b/i;
const HUMAN = /\bi('m| am) (a )?(human|real person|person|employee|staff|team member)\b/i;
const NOT_A_BOT = /\bnot an? (bot|ai|robot|machine|chatbot|computer|program)\b/i;
const REAL_PERSON = /\breal (person|human|rep|representative|agent|employee|staff member|team member|people)\b/gi;
/** "I'm Mike from the ConstructHUB team", "Mike, ConstructHUB billing team", "my name is Mike". */
const STAFF_SIGNOFF: RegExp[] = [
  /\b(I'?m|I am|this is|it'?s|my name is)\s+(?!Gabe\b)[A-Z][a-z]+\b[^.]{0,30}\b(from|with|on|at|of) (the )?ConstructHUB\b/,
  /\b(?!Gabe\b)[A-Z][a-z]{1,15}, (the |your )?ConstructHUB('s)? (\w+ )?(team|billing|support|sales|staff|rep|representative|agent|office)\b/,
  /\bmy name is (?!Gabe\b)[A-Z]/,
];
/** A real ConstructHUB button label ("I submitted the form — mark reported"), not a claim. */
const UI_LABELS = /\bI submitted the form\s*[—–-]\s*mark reported\b/gi;

// O13
const LEAKS: RegExp[] = [
  /system prompt/i, /\bmy (instructions|rules|guidelines|prompt)\b/i, /\bi was (told|instructed|programmed)\b/i,
  /\bknowledge (pack|base) (says|states)\b/i, /\bhard rules\b/i, /\binternal reference\b/i, /\bas an ai language model\b/i,
  /\btruthcoder?\b/i, /\bopenai\b/i, /gpt/i, /qwen/i, /llama/i, /abliterat/i, /ollama/i, /\blocalhost\b/i,
  /127\.0\.0\.1/, /\bvb\d/i, /ai_integrations/i, /\bapi[_ ]?key\s*(is|=|:)\s*\S/i, /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/,
  // The provider's agent tools, which the model sometimes "calls" as text (cleanAiText strips them; none may remain).
  /\b(web_research|web_search|tool_calls?)\b/i, /\bfunction=/i,
  // The SEO data vendor and our wholesale cost (owner white-label rule, server/seo/README-white-label.md): never named,
  // however the name is spaced ("Data For SEO") — checked on the text as the browser shows it too.
  /\bdata\s?for\s?seo\b/i, /\bwholesale (cost|costs|price|prices|rate|rates|data)\b/i,
  // The model talking about its task instead of doing it ("the system prompt", "let me re-read the rules", "**Wait...**").
  ...REASONING_LEAK,
];

// O14
const CODE: RegExp[] = [/\bdef \w+\(/, /\bfunction\s*\(/, /\bconsole\./, /\bimport\s+[\w{*].*\bfrom\s+['"]/, /#include/, /\bSELECT\b.+\bFROM\b/];
const PROFANITY = /\b(fuck\w*|shit\w*|bitch\w*|asshole\w*|bastard\w*|cunt\w*|motherf\w*|slut\w*|whore\w*|retard\w*|f[a@]gg?ot\w*|n[i1]gg(er|a)\w*|dickhead\w*|piss off)\b/i;
/**
 * Other companies Gabe never names, as letters only: a name matches however it is cased, spaced or
 * hyphenated ("House Call Pro", "Job-ber", "ANGI"), but never inside a longer word ("changing").
 * Google, Stripe, Cloudflare, SignalWire, Gmail, Blotato, HOVER, NETR Online and the citation and
 * social sites the pack lists (Yelp, BBB, Apple Maps, Bing Places, Facebook…) are named in the pack.
 */
export const COMPETITOR_NAMES: readonly string[] = [
  "jobber", "housecallpro", "housecall", "servicetitan", "buildertrend", "jobnimbus", "coconstruct", "brightlocal", "whitespark",
  "localfalcon", "clickcease", "tracemyip", "birdeye", "angi", "angieslist", "homeadvisor", "thumbtack", "semrush", "ahrefs",
  "yext", "acculynx", "procore", "companycam", "roofr", "workiz", "fieldedge", "servicem8", "kickserv", "houzz", "gorilladesk",
  "contractorforeman", "barkcom", "networx", "clickguardcom", "ppcprotect", "fraudblocker", "gohighlevel", "highlevel", "hubspot",
  "salesforce", "nicejob", "gradeus", "jobtread", "thryv", "knowify", "markate", "roofsnap", "eagleview", "jobprogress",
  "marketsharp", "salesrabbit", "improveit360", "buildxact", "fieldpulse", "servicefusion", "localiq", "gatherup",
  "reviewtrackers", "porchcom",
];
/** Names that are also English words: matched only as written (capitalised). */
const COMPETITORS_CASED: RegExp[] = [/\bPodium\b/, /\bMoz\b/, /\bJoist\b/, /\bScorpion\b/, /\bLeap (CRM|app|software)\b/];
const COMPETITOR_SET = new Set(COMPETITOR_NAMES);
/** True when the text names a company from the list above (in any spacing, hyphenation or case). */
export function mentionsCompetitor(text: string): boolean {
  if (COMPETITORS_CASED.some((re) => re.test(text))) return true;
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < Math.min(words.length, i + 4); j++) {
      joined += words[j];
      if (COMPETITOR_SET.has(joined)) return true;
    }
  }
  return false;
}
/** Trash talk about anyone (a competitor, "every other CRM"); "junk folder" is an email word. */
const DISPARAGE = /\b(junk|garbage|crap|scams?|scammers?|rip-?offs?|rips? (\w+ )?off|ripping (\w+ )?off|over-?priced|sucks?|clunky|bloated|a joke|waste of (money|time)|overcharges?|overcharging)\b(?! (mail|folder|email|box|filter))/gi;

// The spec's ten words plus more English-only function words ("That's outside my job site…" has just one of the ten).
const FUNCTION_WORDS = /\b(the|and|to|you|your|is|a|of|in|for|i|my|it|or|on|with|can|how|what|that|this|be|are|at|about|if|we|do|an|as|by|from|not|our)\b/gi;
export const MAX_REPLY_CHARS = 1200;

const normWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
let rulesGrams: Set<string> | null = null;
/**
 * 8-word windows of the prompt's instruction text (HARD RULES, STYLE, the trailing reminder),
 * minus the reply lines the rules tell the model to say. The persona sentence, LINKS and
 * KNOWLEDGE are not in it: Gabe may say who he is and quote the pack.
 */
function rulesNgrams(): Set<string> {
  if (rulesGrams) return rulesGrams;
  const text = promptInstructionText().split(REDIRECT_LINE).join(" ").split(NOT_SURE_LINE).join(" ");
  const words = normWords(text);
  rulesGrams = new Set<string>();
  for (let i = 0; i + 8 <= words.length; i++) rulesGrams.add(words.slice(i, i + 8).join(" "));
  return rulesGrams;
}

function toCents(numeric: string): number {
  return Math.round(Number(numeric.replace(/,/g, "")) * 100);
}

// ---------------------------------------------------------------- O9 plan-price binding
type PlanInfo = (typeof PLANS)[PlanKey];
const PLAN_BY_NAME = new Map<string, PlanInfo>(PLAN_KEYS.map((k) => [PLANS[k].name.toLowerCase(), PLANS[k]]));
const PLAN_ALT = PLAN_KEYS.map((k) => PLANS[k].name).join("|");
const PLAN_NAME_RE = new RegExp(String.raw`\b(${PLAN_ALT})\b`, "g");
/** A line that is only a plan name ("**Pro**", "Pro:"); the lines under it are about that plan. */
const PLAN_HEADING = new RegExp(String.raw`^\s*(?:[-*•]\s*)?(?:\*\*)?\s*(${PLAN_ALT})(?: plan)?\s*(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$`);
const UNIT = String.raw`(\/\s?mo(?:nth)?\b|\/\s?m\b|per mo(?:nth)?\b|a month\b|every month\b|each month\b|monthly\b|\/\s?yr\b|\/\s?year\b|per year\b|a year\b|every year\b|each year\b|per annum\b|annual(?:ly)?\b|yearly\b)`;
const AMOUNT = String.raw`\$\s?(\d[\d,]*(?:\.\d{1,2})?)`;
const AMOUNT_UNIT = new RegExp(String.raw`${AMOUNT}\s*${UNIT}?`, "gi");
/** "Pro is $29", "Pro: $29/month", "**Pro** — $29", "Pro costs just $29". */
const BOUND_BEFORE = new RegExp(String.raw`\b(${PLAN_ALT})\b(?: plan| tier)?(?:\*\*)?\s*(?:[:(—–=-]|is|costs?|runs?|at|comes in at|is priced at|is just|is only|only|just|for)?\s*(?:just |only )?${AMOUNT}\s*${UNIT}?`, "gi");
/** "$29/month for Pro", "$29 on the Pro plan". */
const BOUND_AFTER = new RegExp(String.raw`${AMOUNT}\s*${UNIT}?\s*(?:for|on) (?:the )?(${PLAN_ALT})\b`, "gi");
/** "Starter and Pro are both $29/month": one price for several plans is always wrong (no two plans cost the same). */
const BOTH_ALL = /\b(both|all( of them| three| four)?)\b[^.$]{0,25}\$|\$[^.]{0,25}\b(both|all)\b|\b(are|cost|costs|run|priced at) (both|all)\b/i;
/** The sentence is about an add-on, a location band, the texting setup fee or reinstatement. */
const ADDON_CUE = /\b(add-?ons?|addon|extra (agency |crm )?(locations?|seats?|protected websites?|websites?)|additional (locations?|seats?|websites?)|per[- ]location|each (additional |extra )?location|for locations|locations? (above|over|\d)|texting number|texts|setup fee|one-time|scan pack|competitor scans?|per seat|protected websites?|reinstatement|per project|bands?|call assistant|call minutes?|per minute|extra .{0,30}number|seo data|data credit)\b/i;
/** Add-on, band and service amounts (never a plan's own price), the Call Assistant's tiers, extra number and overage among them. */
const ADDON_CENTS: ReadonlySet<number> = (() => {
  const cents = new Set<number>([GBP_REINSTATEMENT_CENTS]);
  for (const addon of Object.values(ADDONS)) {
    cents.add(addon.monthlyCents); cents.add(addon.annualCents);
    if (addon.setupCents) cents.add(addon.setupCents);
    for (const c of dollarAmounts(addon.description)) cents.add(c);
  }
  for (const band of AGENCY_LOCATION_BANDS) if (band.centsPerLocation > 0) { cents.add(band.centsPerLocation); cents.add(band.centsPerLocation * ANNUAL_MONTHS); }
  // SEO data: the monthly allowance of each plan that has the tools (0 on the others) and the prepaid credit packs.
  for (const key of PLAN_KEYS) if (SEO_PLAN_LIMITS[key].seoCreditCents > 0) cents.add(SEO_PLAN_LIMITS[key].seoCreditCents);
  for (const pack of SEO_CREDIT_PACKS) cents.add(pack);
  return cents;
})();

function priceOk(plan: PlanInfo, cents: number, unit: string | undefined): boolean {
  if (!unit) return cents === plan.monthlyCents || cents === plan.annualCents;
  return cents === (/yr|year|annum|annual/i.test(unit) ? plan.annualCents : plan.monthlyCents);
}

// ---------------------------------------------------------------- O9 Call Assistant price binding
/**
 * The AI Call Assistant's prices are bound to the service and to its tiers (Codex audits
 * 2026-10-09): in a sentence about the Call Assistant every $ amount must be one of ITS
 * amounts — a tier's monthly or yearly price, the extra number's (only where the sentence says
 * "extra number"), the overage rate (only beside "minute") — unless the sentence also names
 * the plan (or the CRM, or another add-on) the amount belongs to. "The AI Call Assistant
 * costs $29/month" is refused although $29 is a listed price, and so is "costs $5/month".
 * A minutes figure next to a price must be a tier with that price: "the 500 minutes tier is
 * $349/month" is refused, and so is any priced tier the price book doesn't list ("10,000
 * minutes — $999/month": above 5,000 minutes is a sales conversation, never a price). The
 * service is the subject of a line under a Call Assistant heading, and of a sentence that
 * continues one about it ("It costs …", "The price is …"), not only of the sentence that
 * names it (callAssistantSentences).
 */
const CA_TOPIC = /\b(call assistant|assistant tier|assistant'?s? (?:price|tier|minutes|subscription)|minutes? tiers?|call minutes?|included minutes|extra (?:local |phone )?numbers?|ai receptionist|answers? (?:the|your) phone)\b/i;
/** A line that is only the service's name ("**AI Call Assistant**", "### Call Assistant pricing:"): the lines under it are about it. */
const CA_HEADING = /^\s*(?:#+\s*)?(?:[-*•]\s*)?(?:\*\*)?\s*(?:the )?(?:AI )?Call Assistant(?:'s)?(?: tiers?| pricing| prices?| plans?| subscription)?\s*(?:\*\*)?\s*:?\s*$/i;
/**
 * Any other heading-like line ends the service's section: a markdown heading, a bold-only line, a short label
 * ending in a colon, a line that is only a plan's name (the bold may already be stripped: "Pro"), or a section
 * word on its own ("Pricing", "Plans", "Add-ons", "CRM").
 */
const OTHER_HEADING = new RegExp(String.raw`^\s*(?:#+\s+\S|(?:[-*•]\s*)?\*\*[^*\n]{1,60}\*\*\s*:?\s*$|[A-Z][\w &/'-]{0,40}:\s*$|(?:\*\*)?\s*(?:${PLAN_KEYS.map((k) => PLANS[k].name).join("|")})(?: plan)?\s*(?:\*\*)?\s*:?\s*$|(?:\*\*)?\s*(?:pricing|prices|plans|add-?ons|the crm|crm|crm plans|done[- ]for[- ]you|services|seo|faq|summary|notes?|other products?)\s*(?:\*\*)?\s*:?\s*$)`, "i");
/** A sentence that continues the one before it about the service: "It costs …", "The price is …", "Each tier …". */
const CA_CONTINUES = /^(?:it|its|it's|this|that|the service|the price|the prices|pricing|prices|tiers|the tiers|each tier|every tier|a tier|the subscription|the cost|costs?)\b/i;
const CA_TIER_BY_MINUTES = new Map(CALL_ASSISTANT_TIERS.map((t) => [t.includedMinutes, t]));
/** The service's own amounts, each bound to its billing unit: a monthly price with "/year" (or the reverse) is wrong (checkCallAssistantPrices). */
const CA_TIER_MONTHLY_CENTS: ReadonlySet<number> = new Set(CALL_ASSISTANT_TIERS.map((t) => t.monthlyCents));
const CA_TIER_ANNUAL_CENTS: ReadonlySet<number> = new Set(CALL_ASSISTANT_TIERS.map((t) => t.annualCents));
const yearlyUnit = (unit: string | undefined) => !!unit && /yr|year|annum|annual/i.test(unit);
/** A tier amount with the unit it is sold at: monthly with a monthly unit or none, yearly with a yearly unit or none. */
const caTierAmountOk = (cents: number, unit: string | undefined) =>
  (CA_TIER_MONTHLY_CENTS.has(cents) && (!unit || !yearlyUnit(unit))) || (CA_TIER_ANNUAL_CENTS.has(cents) && (!unit || yearlyUnit(unit)));
/** A list marker at the start of a line ("- ", "* ", "1. ", "2) "): consumed before the subject is tracked. */
const LIST_MARKER = /^\s*(?:[-*•]|\d{1,3}[.)])\s+/;
const CA_NUMBER_CENTS: ReadonlySet<number> = new Set([ADDONS.call_number.monthlyCents, ADDONS.call_number.annualCents]);
/** The dash before an amount joins it to what precedes ("10,000 minutes — $999/month"): read as "at". */
const CA_DASH_PRICE = /\s*[—–-]\s*(?=\$\s?\d)/g;

/** A sentence that names another product changes the subject: a platform plan, the CRM, the SEO tools, done-for-you. */
const OTHER_PRODUCT = new RegExp(String.raw`\b(?:${PLAN_KEYS.map((k) => PLANS[k].name).join("|")}|CRM|SEO|rank[- ]?track\w*|done[- ]for[- ]you|Click Guard|Master Class)\b`);
/**
 * Sentences for the Call Assistant check, each carrying the service's name when it is still the subject:
 * under a Call Assistant heading (across blank lines, until another heading-like line — "**Other product**",
 * "### Pricing", "Plans:" — starts a new section), or after a sentence about the service, across paragraphs
 * ("The Call Assistant answers your calls.\n\nIt costs …"), until another product is named or a heading
 * changes the subject.
 */
function callAssistantSentences(text: string): string[] {
  const out: string[] = [];
  let head = false, previous = false;
  for (const raw of text.split("\n")) {
    if (CA_HEADING.test(raw)) { head = true; previous = false; continue; }
    if (OTHER_HEADING.test(raw)) { head = false; previous = false; continue; }
    if (!raw.trim()) continue;
    const line = raw.replace(LIST_MARKER, "");
    for (const sentence of sentencesOf(line)) {
      const about = CA_TOPIC.test(sentence);
      if (!about && OTHER_PRODUCT.test(sentence)) { previous = false; out.push(sentence); continue; }
      const carried: boolean = head || (previous && !about && CA_CONTINUES.test(sentence));
      out.push(carried ? `Call Assistant: ${sentence}` : sentence);
      previous = about || carried;
    }
  }
  return out;
}
const CRM_CENTS: ReadonlySet<number> = new Set([
  ...CRM_PLAN_KEYS.flatMap((k) => [CRM_PLANS[k].monthlyCents, CRM_PLANS[k].annualCents, Math.round(CRM_PLANS[k].annualCents / 12)]),
  CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS,
]);
/**
 * In a sentence about the Call Assistant, an amount that is not the service's own is allowed only where it sits in
 * ANOTHER product's clause: the product named right before it ("Pro is $79/month", "the CRM: $39/month", "Pro
 * ($79/month, $790/year)", "extra numbers are $5/month or $50/year each") or right after it ("$79/month for Pro",
 * "$19/month per location"), and the amounts chained to that one ("or $790/year"). Naming a product somewhere in
 * the sentence exempts nothing: "The Call Assistant works with CRM and costs $39/month" prices the service.
 */
type CaBinder = { before: RegExp; after: RegExp; ok: (name: string, cents: number, unit: string | undefined) => boolean };
const CA_BIND_CONNECT = String.raw`(?:[:(—–=-]|is|are|costs?|runs?|adds?|at|starts? at|comes in at|is priced at|is just|is only|only|just|for)?`;
const CA_BIND_CHAIN = new RegExp(String.raw`^\s*(?:,|·|\bor\b|\band\b)\s*(?:or |and )?${AMOUNT}\s*${UNIT}?`, "i");
const caBinder = (nameAlt: string, ok: CaBinder["ok"]): CaBinder => ({
  before: new RegExp(String.raw`\b(${nameAlt})\b(?:\*\*)?\s*${CA_BIND_CONNECT}\s*(?:just |only |from )?${AMOUNT}\s*${UNIT}?`, "gi"),
  after: new RegExp(String.raw`${AMOUNT}\s*${UNIT}?\s*(?:each\s+)?(?:for|on|per) (?:the |a |an |each |every |one )?(${nameAlt})\b`, "gi"),
  ok,
});
const CA_BINDERS: readonly CaBinder[] = [
  caBinder(String.raw`(?:${PLAN_ALT})(?: plan| tier)?`, (name, cents, unit) => {
    const plan = PLAN_BY_NAME.get(name.toLowerCase().replace(/ (?:plan|tier)$/, ""));
    return !!plan && priceOk(plan, cents, unit);
  }),
  caBinder(String.raw`(?:the )?CRM(?: (?:Basic|Essentials|Max))?(?: plans?| subscriptions?| seats?)?`, (_n, cents) => CRM_CENTS.has(cents)),
  caBinder(
    String.raw`extra (?:agency |crm )?(?:locations?|seats?|protected websites?|websites?)|additional (?:locations?|seats?|websites?)|locations?|seats?|protected websites?|websites?|(?:client )?texting numbers?|(?:the )?setup fee|competitor scan packs?|scan packs?|competitor scans?|reinstatement`,
    (_n, cents) => ADDON_PRICE_CENTS.has(cents) || cents === GBP_REINSTATEMENT_CENTS),
  caBinder(String.raw`(?:extra|additional|another|second) (?:call assistant |local |phone )?numbers?|(?:local |phone )?numbers?`, (_n, cents) => CA_NUMBER_CENTS.has(cents)),
];
/** The positions (of the "$") of the amounts in `sentence` that sit in another product's clause, at that product's price. */
function caBoundElsewhere(sentence: string): Set<number> {
  const at = new Set<number>();
  for (const b of CA_BINDERS) {
    for (const m of sentence.matchAll(b.before)) {
      if (!b.ok(m[1], toCents(m[2]), m[3])) continue;
      at.add(m.index! + m[0].indexOf("$"));
      // The amounts chained to it belong to the same product ("Pro ($79/month, $790/year)").
      for (let end = m.index! + m[0].length; ;) {
        const c = sentence.slice(end).match(CA_BIND_CHAIN);
        if (!c || !b.ok(m[1], toCents(c[1]), c[2])) break;
        at.add(end + c.index! + c[0].indexOf("$"));
        end += c.index! + c[0].length;
      }
    }
    for (const m of sentence.matchAll(b.after)) if (b.ok(m[3], toCents(m[1]), m[2])) at.add(m.index!);
  }
  return at;
}
/** "500 minutes", "1,000 call minutes", "5,000 included minutes". */
const CA_MINUTES = /\b(\d[\d,]*)\s*(?:call |included )?minutes?\b/gi;
/** A rate, not a tier price: "$0.50 a minute", "$0.50/min", "50 cents per minute". */
const PER_MINUTE_UNIT = /^\s*(?:a|per|each|\/)\s*min(?:ute)?s?\b/i;
/** What ends the clause a minutes figure prices: a stop, or the next thing priced ("extra numbers are $5/mo"). */
const CA_CLAUSE_END = /[.;:—–]|\bextra\b|\bthen\b|\babove\b|\bover\b|\bbeyond\b|\bspam\b/i;
const caUnitOk = (tier: { monthlyCents: number; annualCents: number }, cents: number, unit: string | undefined) =>
  !unit ? cents === tier.monthlyCents || cents === tier.annualCents : cents === (/yr|year|annum|annual/i.test(unit) ? tier.annualCents : tier.monthlyCents);

/** The amounts in `text` with their unit, skipping per-minute rates. */
function pricedAmounts(text: string): { cents: number; unit: string | undefined }[] {
  const out: { cents: number; unit: string | undefined }[] = [];
  for (const m of text.matchAll(AMOUNT_UNIT)) {
    if (!m[2] && PER_MINUTE_UNIT.test(text.slice(m.index! + m[0].length))) continue;
    out.push({ cents: toCents(m[1]), unit: m[2] });
  }
  return out;
}
/** The one amount right before a minutes figure, joined to it ("$249/month for", "$999/mo buys", "$349 a month —"). */
const CA_PRICE_THEN_MINUTES = new RegExp(String.raw`${AMOUNT}\s*${UNIT}?\s*(?:[—–:]|\b(?:for|gets? you|you(?: will|'ll)? get|gives you|buys?(?: you)?|includes?|covers?|comes with|with|at|is|a month for|per month for))?\s*(?:the |a |about |up to |your )?$`, "i");
/** The next minutes figure ends the clause the one before it prices ("500 minutes at $249/month, 1,000 minutes at $349/month"). */
const CA_NEXT_MINUTES = /\b\d[\d,]*\s*(?:call |included )?minutes?\b/i;
/** A minutes figure this small is a cadence or a wait ("every 15 minutes", "valid 10 minutes"), never a tier's allowance. */
const CA_TIER_MINUTES_MIN = 100;

function checkCallAssistantPrices(raw: string): void {
  const sentence = raw.replace(CA_DASH_PRICE, " at ");
  const topic = CA_TOPIC.test(sentence);
  // 1. A minutes figure prices the clause after it ("500 minutes … $249/month or $2,739/year") and the
  //    amount joined to it before ("$249/month for 500 minutes", "$999/mo buys 5,000 minutes"): each such
  //    amount must be that tier's price for its unit, and a figure that is no tier may carry no price.
  for (const m of sentence.matchAll(CA_MINUTES)) {
    const minutes = Number(m[1].replace(/,/g, ""));
    if (!topic && minutes < CA_TIER_MINUTES_MIN) continue;
    const tier = CA_TIER_BY_MINUTES.get(minutes) ?? null;
    const after = sentence.slice(m.index! + m[0].length, m.index! + m[0].length + 90).split(CA_CLAUSE_END)[0].split(CA_NEXT_MINUTES)[0];
    const beforeAll = sentence.slice(Math.max(0, m.index! - 60), m.index!);
    const before = beforeAll.slice(beforeAll.search(/[^.;:—–]*$/));
    const joined = before.match(CA_PRICE_THEN_MINUTES);
    const bound = [...pricedAmounts(after), ...(joined ? pricedAmounts(joined[0]) : [])];
    for (const { cents, unit } of bound) {
      if (cents === SALES_THRESHOLD_CENTS) continue;
      if (!tier || !caUnitOk(tier, cents, unit)) block("O9");
    }
  }
  // 2. In a sentence about the service, every amount is one of its own — or sits in the clause of another
  //    product it is the price of (a plan, the CRM, another add-on, the extra number: caBoundElsewhere). Each
  //    amount is bound where it stands; naming a product elsewhere in the sentence exempts nothing.
  if (!topic) return;
  const elsewhere = caBoundElsewhere(sentence);
  const minute = /\bminutes?\b/i.test(sentence);
  for (const m of sentence.matchAll(AMOUNT_UNIT)) {
    const cents = toCents(m[1]);
    if (caTierAmountOk(cents, m[2]) || cents === SALES_THRESHOLD_CENTS) continue;
    // The overage rate only beside "minute": "costs $0.50" is not the service's price.
    if (minute && cents === CALL_ASSISTANT_OVERAGE_CENTS_PER_MINUTE) continue;
    if (elsewhere.has(m.index!)) continue;
    block("O9");
  }
}

/** Sentences for O9, with the lines under a bare plan heading read as that plan's ("**Pro**\n- $29/month"). */
function planSentences(text: string): string[] {
  const out: string[] = [];
  let head: string | null = null;
  for (const line of text.split("\n")) {
    const h = line.match(PLAN_HEADING);
    if (h) { head = h[1]; continue; }
    if (!line.trim()) { head = null; continue; }
    for (const sentence of sentencesOf(line)) out.push(head ? `${head}: ${sentence}` : sentence);
  }
  return out;
}

/**
 * Every $ amount in a sentence that names a plan must be a price of a plan it names (unit-aware:
 * "/month" is the monthly price, "/year" the yearly one) — or, when the sentence is about an
 * add-on, an add-on amount; an amount right next to a plan name must be that plan's own price.
 */
function checkPlanPrices(sentence: string): void {
  const names = [...new Set((sentence.match(PLAN_NAME_RE) ?? []).map((n) => n.toLowerCase()))];
  if (!names.length) return;
  const plans = names.map((n) => PLAN_BY_NAME.get(n)!);
  const cue = ADDON_CUE.test(sentence);
  const exempt = (cents: number) => cents === SALES_THRESHOLD_CENTS || (cue && ADDON_CENTS.has(cents));
  for (const m of sentence.matchAll(AMOUNT_UNIT)) {
    const cents = toCents(m[1]);
    if (!exempt(cents) && !plans.some((p) => priceOk(p, cents, m[2]))) block("O9");
  }
  if (plans.length >= 2 && BOTH_ALL.test(sentence)) block("O9");
  for (const m of sentence.matchAll(BOUND_BEFORE)) {
    const cents = toCents(m[2]);
    if (!exempt(cents) && !priceOk(PLAN_BY_NAME.get(m[1].toLowerCase())!, cents, m[3])) block("O9");
  }
  for (const m of sentence.matchAll(BOUND_AFTER)) {
    const cents = toCents(m[1]);
    if (!exempt(cents) && !priceOk(PLAN_BY_NAME.get(m[3].toLowerCase())!, cents, m[2])) block("O9");
  }
}

// ---------------------------------------------------------------- O18 echo
/** A reply may not repeat 9 consecutive words of the visitor's text (12 for a plain question it is answering). Shorter echoes are left to the content checks: a contractor describing their business ("with three crews and two offices in Texas") is often echoed back. */
const ECHO_WORDS = 9;
const ECHO_QUESTION_WORDS = 12;
const QUESTION_START = /^(how|what|what's|whats|where|where's|when|why|which|who|can|could|do|does|did|is|are|should|would|will|may|am)\b/i;
const packGramCache = new WeakMap<KnowledgeBook, Set<string>>();

function grams(words: readonly string[], n: number, into = new Set<string>()): Set<string> {
  for (let i = 0; i + n <= words.length; i++) into.add(words.slice(i, i + n).join(" "));
  return into;
}

/** 7-word windows that are fine to repeat: the knowledge pack's own wording. */
function packGrams(book: KnowledgeBook): Set<string> {
  let g = packGramCache.get(book);
  if (!g) { g = grams(normWords(book.pack), ECHO_WORDS); packGramCache.set(book, g); }
  return g;
}

/** True when the reply carries a run of the visitor's own words that is not grounded text. */
function echoesVisitor(reply: string, echo: NonNullable<FilterOptions["echo"]>, book: KnowledgeBook): boolean {
  const statement = new Set<string>();
  const question = new Set<string>();
  for (const turn of echo.user) {
    for (const part of cleanText(turn).split(/(?<=[.!?:;])\s+|\n+/)) {
      const words = normWords(part);
      const isQuestion = /\?\s*$/.test(part.trim()) && QUESTION_START.test(part.trim());
      if (isQuestion) grams(words, ECHO_QUESTION_WORDS, question); else grams(words, ECHO_WORDS, statement);
    }
  }
  if (!statement.size && !question.size) return false;
  const pack = packGrams(book);
  const earlier = new Set<string>();
  for (const a of echo.assistant ?? []) grams(normWords(cleanText(a)), ECHO_WORDS, earlier);
  const grounded = (window: string) => pack.has(window) || earlier.has(window);
  const words = normWords(reply);
  for (let i = 0; i + ECHO_WORDS <= words.length; i++) {
    const seven = words.slice(i, i + ECHO_WORDS).join(" ");
    if (statement.has(seven) && !grounded(seven)) return true;
    if (i + ECHO_QUESTION_WORDS <= words.length && question.has(words.slice(i, i + ECHO_QUESTION_WORDS).join(" "))) {
      for (let j = i; j + ECHO_WORDS <= i + ECHO_QUESTION_WORDS; j++) if (!grounded(words.slice(j, j + ECHO_WORDS).join(" "))) return true;
    }
  }
  return false;
}

/** Last sentence end (or line end) at or before `limit`; -1 if none. */
function lastSentenceEnd(text: string, limit: number): number {
  let best = -1;
  for (const m of text.slice(0, limit + 1).matchAll(/[.!?](?=\s|$)|\n/g)) best = m.index! + (m[0] === "\n" ? 0 : 1);
  return best;
}

function checkHref(href: string, publicOnly: boolean): { path: string; keepLink: boolean } {
  if (/[@\\]|%2f|%5c|\.\./i.test(href) || IP_LITERAL.test(href) || OTHER_SCHEME.test(href)) block("O6");
  let path = href;
  if (!href.startsWith("/") || href.startsWith("//")) {
    const own = href.match(OWN_URL);
    if (!own) return block("O6");
    path = own[1] || "/";
  }
  const link = hubLinkFor(path);
  if (!link) block("O6");
  return { path, keepLink: !publicOnly || link!.public };
}

/**
 * O5 + O17 + style: the formatting the browser would otherwise hide or join. Runs BEFORE the
 * content checks, so what is checked is what is delivered ("$_5_", "$`5`", "Truth😀Coder" or
 * "evil .com" can't pass as one thing and render as another). Must settle in one pass.
 */
function tidy(input: string): string {
  // O5 — other tags, headings, quotes, tables, entities (strip)
  // A bare structural tag named in prose ("paste it in your <head> section") keeps its name as a
  // plain word; every other tag is removed. No angle bracket survives either way.
  let t = input.replace(/<\/?(head|body|html|header|footer|title)>/gi, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^[ \t]*#+[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(" – "))
    .replace(/&#x?[0-9a-f]+;?/gi, "")
    .replace(/&(amp|nbsp);/gi, (m) => (m.toLowerCase() === "&amp;" ? "&" : " "))
    .replace(/&[a-z]{2,8};/gi, "");

  // O17 — markdown whitelist (strip): **bold**, "- " / "1. " lists, allowlisted links
  t = t.split("\n").map((line) => {
    let l = line.replace(/^(\s*)[*+•]\s+/, "$1- ").replace(/^(\s*)(\d+)\)\s+/, "$1$2. ");
    if (/^\s*([-*_]\s*){3,}$/.test(l)) return "";
    l = l.replace(/`([^`]*)`/g, "$1").replace(/~~([^~]+)~~/g, "$1").replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2");
    const bold = (l.match(/\*\*/g) ?? []).length;
    l = bold % 2 === 0
      ? l.replace(/\*\*/g, "\u0003").replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2").replace(/\u0003/g, "**")
      : l.replace(/\*\*/g, "");
    return l.replace(/[ \t]+$/g, "");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Style: no emoji (strip). Runs of spaces read as one space in the browser, so they are one here too.
  return t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
}

/**
 * O7–O15 and O18 on one rendering of the reply (links already reduced to their text). Called on
 * the text as written and again as the browser shows it, with **bold** markers removed, so
 * "$**5**", "Open**AI**" and "bob@**acme**.com" are read the way a visitor reads them.
 */
/** "19 dollars", "USD 19", "19 bucks" as "$19": every price check reads one notation. */
function asDollars(text: string): string {
  return text.replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:dollars|usd|bucks)\b/gi, "$$$1").replace(/\busd\s?\$?(\d[\d,]*(?:\.\d{1,2})?)/gi, "$$$1");
}

function checkContent(linkless: string, opts: FilterOptions, book: KnowledgeBook, canary: string): void {
  const money = asDollars(linkless);
  const sentences = sentencesOf(money);

  // O7 — contact details and identifiers, and a named business said to be a ConstructHUB customer
  for (const re of CONTACT) if (re.test(linkless)) block("O7");
  for (const s of sentences) if (BUSINESS.test(s) && TENANT_CLAIM.test(s) && /\b(constructhub|hub|gabe)\b/i.test(s)) block("O7");

  // O6 (continued) — link text is read too: "[constructhub-refund.site/claim](/pricing)" names a host as
  // much as bare text does; so do "acme[.]com" and "constructhub dot help".
  for (const m of linkless.matchAll(ANY_HOST)) if (!OWN_HOST_RE.test(m[1])) block("O6");
  if (BRACKET_DOT.test(linkless) || SPELLED_DOMAIN.test(linkless)) block("O6");

  // O8 — money (on the one notation: a written-out "19 dollars" is checked as "$19")
  for (const m of money.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)(\s?[kKmM]\b)?/g)) {
    if (m[2]) block("O8");
    const cents = toCents(m[1]);
    if (!book.allowedCents.has(cents)) block("O8");
    if (cents === SALES_THRESHOLD_CENTS && !/^\s*(or more|and up|and above|\+)/i.test(money.slice(m.index! + m[0].length))) block("O8");
  }
  for (const m of linkless.matchAll(/\b(\d[\d,]*(?:\.\d{1,2})?)\s?(dollars|usd|bucks)\b|\busd\s?\$?(\d[\d,]*(?:\.\d{1,2})?)/gi)) {
    if (!book.allowedCents.has(toCents(m[1] ?? m[3]))) block("O8");
  }
  if (/[€£¥₹]\s?\d|\b\d[\d,.]*\s?(eur|euros?)\b/i.test(linkless)) block("O8");
  for (const m of linkless.matchAll(/\b(\d+)\s?(cents?\b|¢)/gi)) if (!book.allowedCents.has(Number(m[1]))) block("O8");
  if (/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b[\w\s-]{0,30}\b(dollars|bucks)\b/i.test(linkless)) block("O8");

  // O9 — plan-price binding (on the one money notation), and the Call Assistant's own (with the service's
  // context carried under its headings and into the sentences that continue one about it)
  for (const s of planSentences(money)) checkPlanPrices(s);
  for (const s of callAssistantSentences(money)) checkCallAssistantPrices(s);

  // O10 — commercial claims. "Unlimited" is a sold plan name on the 2026-10-09
  // ladder (shared/plans.ts), never a claim: mask capitalized name mentions
  // (bare, or with "the/to/on/with" before it, or "plan/tier" after) so the
  // sweep never reads the name as an "unlimited" promise. Lowercase "unlimited"
  // and every other claim stay blocked.
  const commercialText = linkless.replace(/\b(?:the |to |on |with |from )?Unlimited(?: plan| tier)?\b/g, "Top plan");
  for (const re of COMMERCIAL) if (re.test(commercialText)) block("O10");
  for (const m of linkless.matchAll(/\bfree (plan|tier|version|forever|month)/gi)) {
    const before = linkless.slice(0, m.index!).split(/\s+/).filter(Boolean).slice(-4).join(" ");
    if (!NEG.test(before) && !/there'?s no$/i.test(before)) block("O10");
  }
  for (const re of TRIAL_LENGTHS) {
    for (const m of linkless.matchAll(re)) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1].toLowerCase()];
      // The CRM is a separate product with its own trial length (shared/crm-plans.ts):
      // that length is right only in a sentence about the CRM.
      const about = linkless.slice(Math.max(0, m.index! - 200), m.index! + m[0].length + 40);
      const crmTrial = n === CRM_TRIAL_DAYS && m[2].toLowerCase() === "day" && /\bCRM\b/.test(about);
      if (!crmTrial && (n !== TRIAL_DAYS || m[2].toLowerCase() !== "day")) block("O10");
    }
  }
  for (const m of linkless.matchAll(/\b([A-Z][A-Za-z]*) ([Pp]lan|[Tt]ier|[Pp]ackage|[Mm]embership)\b/g)) {
    if (!PLAN_WORD_OK.has(m[1])) block("O10");
  }
  if (LEGACY_PLAN.test(linkless) || LEGACY_WORDS.some((re) => re.test(linkless))) block("O10");
  for (const s of sentences) {
    const rest = s.replace(/\bGoogle Guarantee(d)?\b/gi, "");
    if (/guarante/i.test(rest) && !NEG.test(rest)) block("O10");
    if (NOT_SOLD.some((re) => re.test(s)) && !NEG.test(s)) block("O10");
    for (const re of COMMERCIAL_UNLESS_NEGATED) {
      const m = s.match(re);
      if (m && !NEG.test(`${s.slice(0, m.index)} ${s.slice(m.index! + m[0].length)}`)) block("O10");
    }
    if (FREE_STRETCH.test(s) && !YEARLY.test(s) && !NEG.test(s)) block("O10");
    if (DISCOUNT.test(s) && DISCOUNT_PLAN_CONTEXT.test(s) && !DISCOUNT_CRM_CONTEXT.test(s) && !YEARLY.test(s) && !NEG.test(s)) block("O10");
    if (PROMO_TOKEN.test(s) && PROMO_CONTEXT.test(s)) block("O10");
    // A price next to anything SEO is allowed only as the Agency plan's own price in a sentence that names Agency,
    // or, in a sentence about credit, as the SEO data allowance or a prepaid pack; a real add-on's price only with an
    // add-on cue that is not "SEO data" itself. "The SEO upgrade costs $349/month" and "SEO costs $19 a month" are refused.
    if (SEO_TOPIC.test(s)) {
      const agency = /\bAgency\b/.test(s), credit = SEO_CREDIT_CUE.test(s), addon = addonCueWithoutSeo(s);
      for (const m of s.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) {
        const cents = toCents(m[1]);
        if (cents === SALES_THRESHOLD_CENTS || (agency && SEO_PLAN_CENTS.has(cents)) || (credit && SEO_CREDIT_CENTS.has(cents)) || (addon && ADDON_PRICE_CENTS.has(cents))) continue;
        block("O10");
      }
    }
    // A count of customers / members / places, a limit, or a deadline for the founding offer (none exists).
    if (statesCount(s) || FOUNDING_LIMITS.some((re) => re.test(s))) block("O10");
  }

  // O11 — a sales-only item next to a price
  for (const s of sentences) {
    if (!/\$\s?\d/.test(s)) continue;
    const lower = s.toLowerCase();
    if (SALES_ONLY_NAMES.some((name) => lower.includes(name.toLowerCase()))) block("O11");
  }

  // O12 — claims to act, to see accounts, or to be a person
  const claims = linkless.replace(UI_LABELS, " ");
  if (ACTION_DONE.test(claims) || ACTION_WILL.test(claims) || ACCESS.test(claims) || HUMAN.test(claims)) block("O12");
  if (NOT_A_BOT.test(claims) || APPLIED_REFUND.test(claims) || STAFF_SIGNOFF.some((re) => re.test(claims))) block("O12");
  for (const s of sentencesOf(claims)) {
    if (DONE_EXCLAIM.test(s)) block("O12");
    const passive = s.match(PASSIVE_DONE);
    if (passive && !CONDITIONAL.test(s.slice(0, passive.index))) block("O12");
    // "a real person" is a self-claim only next to I / me / this is (the assisted import's "a person moves your data" is not).
    if (/\b(I|I'm|I am|me|this is|you'?re (talking|chatting)|you are (talking|chatting))\b/i.test(s)) {
      for (const m of s.matchAll(REAL_PERSON)) if (!/\b(not|n't|no)\b[^.]{0,6}$/i.test(s.slice(Math.max(0, m.index! - 12), m.index))) block("O12");
    }
  }

  // O13 — leakage
  if (canary && linkless.toLowerCase().includes(canary.toLowerCase())) block("O13");
  // The canary however it is spelled out: spaced, comma-separated, upper-case, reversed, or just its hex part.
  if (canary) {
    const compact = linkless.toLowerCase().replace(/[^a-z0-9]/g, "");
    const code = canary.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hex = code.replace(/^hub/, "");
    const reverse = (x: string) => [...x].reverse().join("");
    if ([code, reverse(code), hex, reverse(hex)].some((c) => c.length >= 8 && compact.includes(c))) block("O13");
  }
  if (LEAKS.some((re) => re.test(linkless))) block("O13");
  const words = normWords(linkless);
  const ruleGrams = rulesNgrams();
  for (let i = 0; i + 8 <= words.length; i++) if (ruleGrams.has(words.slice(i, i + 8).join(" "))) block("O13");

  // O14 — off-script content
  if (CODE.some((re) => re.test(linkless))) block("O14");
  for (const m of linkless.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    if (/[a-z]/.test(m[0]) && /[A-Z]/.test(m[0]) && /[0-9+/]/.test(m[0])) block("O14");
  }
  if (/\b[0-9a-f]{24,}\b/i.test(linkless)) block("O14");
  if (PROFANITY.test(linkless) || mentionsCompetitor(linkless)) block("O14");
  for (const m of linkless.matchAll(DISPARAGE)) if (!negatedAt(linkless, m.index!)) block("O14");

  // O15 — language
  const letters = linkless.match(/\p{L}/gu) ?? [];
  if (letters.length && letters.filter((ch) => ch.charCodeAt(0) > 127).length / letters.length > 0.1) block("O15");
  if (linkless.length > 80 && (linkless.match(FUNCTION_WORDS)?.length ?? 0) < 2) block("O15");

  // O18 — the visitor's own words coming back (the "finish with this exact sign-off line" piggyback)
  if (opts.echo && echoesVisitor(linkless, opts.echo, book)) block("O18");
}

function run(out: ModelOutput, opts: FilterOptions): string {
  const book = opts.book ?? knowledgeBook();
  const canary = opts.canary ?? CANARY;

  // O1 — finish reason, tool calls, empty
  if (!["stop", "length"].includes(String(out.finishReason ?? ""))) block("O1");
  const hasTools = Array.isArray(out.toolCalls) ? out.toolCalls.length > 0 : !!out.toolCalls;
  if (hasTools || out.functionCall) block("O1");
  let t = typeof out.content === "string" ? out.content : "";
  if (!t.trim()) block("O1");

  // O2 — reasoning blocks and tool-call markup (strip; what survives, or a reply that was only that, blocks).
  // cleanAiText is the TruthCoder cleaner every AI path uses: <think>/<thinking>/<reasoning>… blocks (an
  // unclosed one takes everything after it), XML / bracket / JSON tool calls and "web_research" lines,
  // the gateway's "RESEARCH — LAW n" preamble, leading planning paragraphs ("Let me think…", "Okay, so
  // the user wants…"), a trailing "**Wait...** the prompt…" and "Final answer:" labels.
  t = cleanAiText(t);
  if (!t.trim() || RESIDUAL_MARKUP.test(t)) block("O2");

  // O3 — normalise (strip). Combining marks NFKC could not compose ("$̲" + "5") only hide characters
  // from the checks in an English answer, so they go too.
  t = cleanText(t).replace(/\p{M}/gu, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!t) block("O1");

  // O4 — active content (before and after the tidy, so "<`script`>" can't become "<script>")
  if (ACTIVE.test(t)) block("O4");
  if (/<\/?visitor>/i.test(t)) block("O13");

  // O5 + O17 + style (strip), before any content check. Formatting that only settles over several
  // passes ("$<i>_</i>5_") is not something Gabe writes: block it rather than guess what it shows.
  t = tidy(t);
  if (tidy(t) !== t) block("O17");
  if (ACTIVE.test(t)) block("O4");
  if (!t) block("O1");

  // O6 — links and domains (rewrite / block)
  // Links are parked as placeholders; the checks below read their text, never their (checked) path.
  const kept: string[] = [];
  const keptText: string[] = [];
  const park = (markdown: string, text: string) => { kept.push(markdown); keptText.push(text); return `\u0001${kept.length - 1}\u0002`; };
  t = t.replace(MD_LINK, (_, text: string, href: string) => {
    const { path, keepLink } = checkHref(href, opts.publicOnly);
    return park(keepLink ? `[${text}](${path})` : text, text);
  });
  if (OTHER_SCHEME.test(t) || PROTOCOL_RELATIVE.test(t)) block("O6");
  t = t.replace(BARE_URL, (raw) => {
    const url = raw.replace(/[.,;:!?]+$/, "");
    const trail = raw.slice(url.length);
    const { path, keepLink } = checkHref(url.startsWith("www.") ? `https://${url}` : url, opts.publicOnly);
    const link = hubLinkFor(path)!;
    return park(keepLink ? `[${link.label}](${path})` : link.label, link.label) + trail;
  });
  t = t.replace(BARE_DOMAIN, (raw, host: string, pathPart: string | undefined) => {
    if (!PLAIN_OWN_HOST.test(host)) return block("O6");
    if (!pathPart || pathPart === "/") return raw;
    const { path, keepLink } = checkHref(`https://${host.replace(/^portal\./i, "")}${pathPart.replace(/[.,;:!?]+$/, "")}`, opts.publicOnly);
    const link = hubLinkFor(path)!;
    return park(keepLink ? `[${link.label}](${path})` : link.label, link.label);
  });
  const linkless = t.replace(/\u0001(\d+)\u0002/g, (_, i: string) => keptText[Number(i)]);
  const restore = (s: string) => s.replace(/\u0001(\d+)\u0002/g, (_, i: string) => kept[Number(i)]);

  // O7–O15, O18 — on the text as written, and as the browser shows it (**bold** is formatting, not text).
  checkContent(linkless, opts, book, canary);
  const shown = linkless.replace(/\*\*/g, "");
  if (shown !== linkless) checkContent(shown, opts, book, canary);

  // O16 — length (truncate / block). Truncation only removes text, so every check above still holds.
  t = restore(t);
  if (out.finishReason === "length") {
    const end = lastSentenceEnd(t, t.length);
    if (end <= 0) block("O16");
    t = t.slice(0, end).trim();
  }
  if (t.length > MAX_REPLY_CHARS) {
    const end = lastSentenceEnd(t, MAX_REPLY_CHARS);
    if (end <= 0) block("O16");
    t = t.slice(0, end).trim();
  }
  const lines = t.split("\n").filter((l) => l.trim());
  if (lines.length > 14 || lines.filter((l) => /^\s*([-*+•]|\d+[.)])\s/.test(l)).length > 8) block("O16");
  if (!t) block("O1");
  return t;
}

/** Run every check in order. Block -> { ok: false, code }; the caller sends R_FALLBACK. */
export function filterOutput(out: ModelOutput, opts: FilterOptions): FilterResult {
  try {
    return { ok: true, text: run(out, opts) };
  } catch (err) {
    if (err instanceof Blocked) return { ok: false, code: err.code };
    // Fail closed: an unexpected error in a check is a block, never a pass.
    return { ok: false, code: "O1" };
  }
}
