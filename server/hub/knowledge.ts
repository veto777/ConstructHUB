/**
 * Hub's knowledge pack (guardrails §9): server/data/hub-knowledge.md, rendered
 * once at boot. Every plan name, price and limit in it is a {{TOKEN}} filled
 * from the price book (shared/plans.ts, shared/plan-copy.ts) — nothing is
 * typed by hand. The pack holds public facts only; it never sees a request,
 * a user or the database.
 *
 * The full pack is ~60k characters, too slow to prefill on every call, so each
 * call gets the CORE sections plus the feature sections that match the
 * question (or the page / preset), capped at KNOWLEDGE_SLICE_MAX characters.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  PLANS, PLAN_KEYS, ADDONS, ADDON_MAX_QUANTITY, AGENCY_LOCATION_BANDS, ANNUAL_MONTHS, LEGACY_BAND_ANNUAL_MONTHS, SALES_THRESHOLD_CENTS,
  GBP_REINSTATEMENT_CENTS, gridCreditCost,
} from "@shared/plans";
import {
  pricingKnowledge, joinNames, planNamesWhere, formatUsd, TRIAL_LABEL, SALES_REP_LABEL, SALES_THRESHOLD_LABEL,
  SALES_HREF, PROTECTED_SITE_PLANS, COMPETITOR_INTEL_PLANS, TEXTING_PLANS, CRM_SEATS_LINE, TEXTING_EITHER_LINE, CLIENT_NUMBER_INCLUDED_PLANS,
  CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SEPARATE_LINE, CALL_ASSISTANT_FROM_PRICE, callAssistantAvailabilityLine, callAssistantPricing, callAssistantIncludesLine,
  callAssistantYearlyNote, callAssistantAboveTopLine,
  CALL_ASSISTANT_SPAM, callAssistantMinuteRule, callAssistantOverageRule, callAssistantSpamAllowanceLine, callAssistantTierAdvice, callAssistantTierNumbersLine, callAssistantTiersLine,
} from "@shared/plan-copy";
import { VOICE_PERSONA_LIST } from "@shared/voice-personas";
import { HUB_PAGES, type PageKey } from "@shared/hub-links";
import { CRM_ADDONS, CRM_PLANS, CRM_PLAN_KEYS, CRM_EXTRA_SEAT_MONTHLY_CENTS, CRM_EXTRA_SEAT_ANNUAL_CENTS } from "@shared/crm-plans";
import { SEO_CREDIT_PACKS } from "@shared/seo-credits";
import { ALACARTE, ALACARTE_KEYS, ALACARTE_PRICING_HREF, ALACARTE_ANNUAL_MONTHS, alacartePriceCents } from "@shared/alacarte";
import { SEO_PLAN_LIMITS } from "@shared/plans";

export const KNOWLEDGE_FILE = "hub-knowledge.md";
/** Characters of knowledge one model call may carry (keeps TruthCoder prefill fast). */
export const KNOWLEDGE_SLICE_MAX = 24_000;
/** Sent with every call: rules, what ConstructHUB is, getting started, the price book, quick answers, glossary. */
export const CORE_SECTIONS = [0, 1, 2, 3, 28, 29] as const;
/** Feature sections a free-text question can pull in, at most. */
const MAX_FEATURE_SECTIONS = 3;

/** dev: server/data/…, built: dist/data/… (script/build.ts copies server/data). */
function packPath(): string {
  const here = import.meta.dirname || __dirname;
  const candidates = [path.join(here, "data", KNOWLEDGE_FILE), path.join(here, "..", "data", KNOWLEDGE_FILE)];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`hub: knowledge pack ${KNOWLEDGE_FILE} not found`);
  return found;
}

export function knowledgeTokens(): Record<string, string> {
  return {
    PRICING_KNOWLEDGE: pricingKnowledge(),
    TRIAL_LABEL, SALES_REP_LABEL, SALES_THRESHOLD_LABEL, SALES_HREF,
    PROTECTED_SITE_PLANS, COMPETITOR_INTEL_PLANS, TEXTING_PLANS, CRM_SEATS_LINE,
    AGENCY_PLAN: PLANS.agency.name,
    AUTO_REPLY_PLANS: planNamesWhere((p) => p.limits.autoPublishAiReplies),
    DRAFT_ONLY_REPLY_PLANS: planNamesWhere((p) => !p.limits.autoPublishAiReplies),
    // Module gates read from the price book (shared/plans.ts PlanModules), so the pack's
    // "which plans" lines can never drift from what checkout and entitlements enforce.
    ADS_MANAGER_PLANS: planNamesWhere((p) => p.modules.adsManager),
    CLOUDFLARE_PLANS: planNamesWhere((p) => p.modules.cloudflareSearchConsole),
    DOMAINS_MAIL_PLANS: planNamesWhere((p) => p.modules.domainsMailAlerts),
    AGENCY_WORKSPACE_PLANS: planNamesWhere((p) => p.modules.agencyWorkspace),
    MASTER_CLASS_PLANS: planNamesWhere((p) => p.modules.masterClass),
    CLIENT_TEXTING_INCLUDED_PLANS: planNamesWhere((p) => p.limits.clientTexting === "included"),
    TEXTING_EITHER_LINE, CLIENT_NUMBER_INCLUDED_PLANS,
    TEXTING_ADDON_PLANS: joinNames(ADDONS.texting_number.availableOn.map((k) => PLANS[k].name)),
    GUARD_CADENCE_LINE: joinNames(PLAN_KEYS.map((k) => `${PLANS[k].name} every ${PLANS[k].limits.guardCadenceMinutes} minutes`)),
    REVIEW_TEMPLATES_LINE: joinNames(PLAN_KEYS.map((k) => `${PLANS[k].name} ${PLANS[k].limits.reviewTemplates}`)),
    GRID_CREDIT_COSTS: [3, 5, 7, 9, 11, 13, 15].map((n) => `${n}x${n} = ${gridCreditCost(n)}`).join(", "),
    ADDON_MAX_QUANTITY: String(ADDON_MAX_QUANTITY),
    GBP_REINSTATEMENT_PRICE: formatUsd(GBP_REINSTATEMENT_CENTS),
    ANNUAL_MONTHS: String(ANNUAL_MONTHS),
    ANNUAL_FREE_MONTHS: String(12 - ANNUAL_MONTHS),
    CALL_ASSISTANT_SEPARATE_LINE,
    CALL_ASSISTANT_FROM_PRICE,
    CALL_ASSISTANT_YEARLY_NOTE: callAssistantYearlyNote(),
    CALL_ASSISTANT_ABOVE_TOP: callAssistantAboveTopLine(),
    CALL_ASSISTANT_RULE_OWN_NUMBERS: CALL_ASSISTANT_NUMBER_RULES.ownNumbers,
    CALL_ASSISTANT_RULE_CANCEL: CALL_ASSISTANT_NUMBER_RULES.cancel,
    CALL_ASSISTANT_RULE_PAYMENT: CALL_ASSISTANT_NUMBER_RULES.payment,
    CALL_ASSISTANT_INCLUDES_LINE: callAssistantIncludesLine(),
    CALL_ASSISTANT_TIERS_LINE: callAssistantTiersLine(),
    CALL_ASSISTANT_TIER_ADVICE: callAssistantTierAdvice(),
    CALL_ASSISTANT_MINUTE_RULE: callAssistantMinuteRule(),
    CALL_ASSISTANT_OVERAGE_RULE: callAssistantOverageRule(),
    CALL_ASSISTANT_TIER_COUNT: callAssistantPricing().tierCountWord,
    CALL_ASSISTANT_SPAM_SCREEN: CALL_ASSISTANT_SPAM.screen,
    CALL_ASSISTANT_SPAM_BLOCK: CALL_ASSISTANT_SPAM.block,
    CALL_ASSISTANT_SPAM_REPORT: CALL_ASSISTANT_SPAM.report,
    CALL_ASSISTANT_SPAM_FORWARDING: CALL_ASSISTANT_SPAM.forwarding,
    CALL_ASSISTANT_TIER_NUMBERS: callAssistantTierNumbersLine(),
    CALL_ASSISTANT_SPAM_FREE: callAssistantSpamAllowanceLine().replace(/^./, (c) => c.toUpperCase()),
    CALL_ASSISTANT_AVAILABILITY: callAssistantAvailabilityLine(),
    CALL_ASSISTANT_STATUS: callAssistantPricing().comingSoon ? "coming soon, not for sale yet" : `a separate service with its own subscription, from ${CALL_ASSISTANT_FROM_PRICE}`,
    // Every tool à la carte (shared/alacarte.ts, owner 2026-10-10): one line per item, both tiers, derived — never typed.
    ALACARTE_LINES: alacarteLines().map((l) => `- ${l}`).join("\n"),
    ALACARTE_HREF: ALACARTE_PRICING_HREF,
    ALACARTE_ANNUAL_MONTHS: String(ALACARTE_ANNUAL_MONTHS),
    // "Janice, Sofia and Maya (women's voices) and Gabe, Marcus and Ethan (men's voices)".
    CALL_ASSISTANT_PERSONAS: `${joinNames(VOICE_PERSONA_LIST.filter((p) => p.gender === "female").map((p) => p.name))} (women's voices) and ${joinNames(VOICE_PERSONA_LIST.filter((p) => p.gender === "male").map((p) => p.name))} (men's voices)`,
  };
}

/**
 * The à la carte price book as Gabe may state it: "GridRank — $49/month or $539/year on its own; $29/month or
 * $319/year as an add-on to any Business Tools or CRM plan". Every figure from shared/alacarte.ts.
 */
export function alacarteLines(): string[] {
  return ALACARTE_KEYS.map((k) => {
    const it = ALACARTE[k];
    const per = it.unit ? ` per ${it.unit}` : "";
    return `${it.name} — ${formatUsd(alacartePriceCents(k, "standalone", "month"))}/month or ${formatUsd(alacartePriceCents(k, "standalone", "year"))}/year on its own${per}; `
      + `${formatUsd(alacartePriceCents(k, "addon", "month"))}/month or ${formatUsd(alacartePriceCents(k, "addon", "year"))}/year as an add-on to any Business Tools or CRM plan${per}`;
  });
}

/** Strip builder comments and fill every {{TOKEN}}; an unknown token is a boot error, never a blank. */
export function renderPack(raw: string, tokens = knowledgeTokens()): string {
  return raw
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
      if (!(key in tokens)) throw new Error(`hub: knowledge pack has an unknown token ${key}`);
      return tokens[key];
    })
    .trim();
}

export type Section = { num: number; title: string; text: string };

/** "## N. Title" sections, in order. The "# ConstructHUB knowledge pack" title line is dropped. */
export function splitSections(pack: string): Section[] {
  // Only numbered headings split: the price book inside section 3 has its own "## " heading.
  return pack.split(/\n(?=## \d+\. )/).flatMap((chunk) => {
    const m = chunk.match(/^## (\d+)\. ([^\n]+)/);
    return m ? [{ num: Number(m[1]), title: m[2].trim(), text: chunk.trim() }] : [];
  });
}

/** Words that pull a feature section into a free-text question's knowledge. */
const SECTION_KEYWORDS: Record<number, RegExp> = {
  4: /\b(permits?|portals?|databases?|directory|property|appraisers?|assessors?|search history|jurisdictions?|county|counties)\b/,
  5: /\b(locations?|connect(ing)? google|business profile|gbp|gmb|listings?|sync(ing)?|import from gbp|insights?|unlink)\b/,
  6: /\b(profile guard|guard|lockdown|snapshot|watched fields|edits? (to|on) my (listing|profile))\b/,
  7: /\b(edit monitor|gmb monitor|review response generator|response generator)\b/,
  8: /\b(reviews?|review requests?|ai repl(y|ies)|replies|reply|referral|reminders?)\b/,
  9: /\b(posts?|posting|updates?|offers?|events?|schedul\w* posts?|publish\w*)\b/,
  10: /\b(photo optimizer|photos?|watermark|exif|geotag\w*|media library|folders?)\b/,
  11: /\b(ranking grid|rank(ing|ings)?|grid|heatmap|credits?)\b/,
  12: /\b(site scan|website scan|scan my (site|website)|seo audit|pagespeed|free scan|free website scan)\b/,
  13: /\b(citations?|nap|directories|yelp|bbb|bing places|apple maps)\b/,
  14: /\b(social( media)?|blotato|facebook|instagram|linkedin|tiktok|youtube|pinterest|threads|bluesky|auto mode)\b/,
  15: /\b(click guard|click[- ]fraud|fraud|blocked ips?|ip exclusions?|tracking (code|script)|google ads script)\b/,
  16: /\b(ip tracker|visitors?|visitor list|traffic sources?)\b/,
  17: /\b(vpn( shield)?|proxy|proxies|datacenter)\b/,
  18: /\b(competitors?|competitor intel|market scan|bs meter)\b/,
  19: /\b(google ads|ads guide|lsa|local services|mcc|manager account|ad fraud|ads consultant|leads? from google)\b/,
  20: /\b(cloudflare|search console|gsc|sitemaps?|nameservers?|edge)\b/,
  21: /\b(domains?|dns|registrar|mail alerts?|forwarding|gmail)\b/,
  22: /\b(agency|agencies|clients? workspace|white[- ]label|bulk actions?|onboarding)\b/,
  23: /\b(reinstat\w*|suspend\w*|suspension)\b/,
  24: /\b(crm|estimates?|invoices?|payments?|stripe|price ?book|pipeline|projects?|schedule|calendar|messages?|team|roles?|seats?|texting|texts?|sms|hover|import|backups?|divisions?|client portal|clients?)\b/,
  25: /\b(notifications?|2fa|two[- ]factor|security|password|sign[- ]?in|log ?in|account activity|delete (my )?account|recovery codes?)\b/,
  26: /\b(master ?class|course|modules?|llc|licens\w*|bond\w*|insurance|state[- ]by[- ]state)\b/,
  27: /\b(done[- ]for[- ]you|dfy|sales rep|talk to (a )?sales|seo (program|package)s?|website build|business formation|complete business build|custom work|quote)\b/,
  30: /\b(call assistant|receptionist|answer(?:s|ing)? (?:the|my|our) (?:phone|calls?)|phone (?:calls?|numbers?|lines?)|local numbers?|missed calls?|voicemail|call forwarding|forward(?:ing)? (?:my |our )?(?:calls?|lines?|numbers?)|agent studio|janice|sofia|maya|marcus|ethan|personas?|call log|recordings?|transcripts?|spam calls?|robocalls?|telemarketers?)\b/,
};

export type KnowledgeBook = {
  pack: string;
  sections: Map<number, Section>;
  /** dollarAmounts(pack): the only amounts an answer may state (O8). */
  allowedCents: Set<number>;
  /** sha256 over the rendered pack, for the preset cache key. */
  packHash: string;
};

export function buildBook(pack: string): KnowledgeBook {
  const list = splitSections(pack);
  return {
    pack,
    sections: new Map(list.map((s) => [s.num, s])),
    allowedCents: new Set(dollarAmounts(pack)),
    packHash: createHash("sha256").update(pack).digest("hex"),
  };
}

let cached: KnowledgeBook | null = null;
/** The rendered pack, loaded once. */
export function knowledgeBook(): KnowledgeBook {
  return cached ??= buildBook(renderPack(fs.readFileSync(packPath(), "utf8")));
}

/** Feature sections for a question: the page's own section first, then the best keyword matches. */
export function sectionsFor(texts: readonly string[], pageKey?: PageKey, extra: readonly number[] = []): number[] {
  const scores = new Map<number, number>();
  const haystack = texts.map((t) => t.toLowerCase());
  haystack.forEach((text, i) => {
    const weight = i === haystack.length - 1 ? 3 : 1; // the newest message counts most
    for (const [num, re] of Object.entries(SECTION_KEYWORDS)) {
      const hits = text.match(new RegExp(re.source, "g"))?.length ?? 0;
      if (hits) scores.set(Number(num), (scores.get(Number(num)) ?? 0) + hits * weight);
    }
  });
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([n]) => n);
  const page = pageKey ? HUB_PAGES[pageKey].sections : [];
  const out: number[] = [];
  for (const n of [...extra, ...ranked.slice(0, MAX_FEATURE_SECTIONS), ...page]) {
    if (!out.includes(n) && !(CORE_SECTIONS as readonly number[]).includes(n)) out.push(n);
  }
  return out;
}

/** CORE + the given feature sections, within KNOWLEDGE_SLICE_MAX characters. */
export function knowledgeSlice(book: KnowledgeBook, featureSections: readonly number[]): string {
  const parts: Section[] = [];
  let size = 0;
  for (const num of CORE_SECTIONS) {
    const s = book.sections.get(num);
    if (s) { parts.push(s); size += s.text.length + 2; }
  }
  for (const num of featureSections) {
    const s = book.sections.get(num);
    if (!s || parts.includes(s)) continue;
    if (size + s.text.length + 2 > KNOWLEDGE_SLICE_MAX) continue;
    parts.push(s); size += s.text.length + 2;
  }
  // Core first (same text on every call, so the model server's prefix cache covers it), then features.
  const core = parts.filter((s) => (CORE_SECTIONS as readonly number[]).includes(s.num));
  const features = parts.filter((s) => !core.includes(s)).sort((a, b) => a.num - b.num);
  return [...core, ...features].map((s) => s.text).join("\n\n");
}

/** Every "$1,234" / "$0.02" amount in a text, in cents. */
export function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g)].map((m) =>
    Math.round(Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`) * 100));
}

/**
 * Every amount the price book can state, in cents: plan monthly/annual, add-on
 * monthly/annual/setup and the per-unit prices in their descriptions (the AI
 * Call Assistant's tiers, extra number and overage among them — a separate
 * service, but its prices are listed prices), Agency band rates (monthly and
 * annual), the sales threshold and the reinstatement price. No intro or
 * launch price exists any more.
 */
export function priceBookCents(): Set<number> {
  const cents = new Set<number>([SALES_THRESHOLD_CENTS, GBP_REINSTATEMENT_CENTS]);
  for (const key of PLAN_KEYS) { cents.add(PLANS[key].monthlyCents); cents.add(PLANS[key].annualCents); }
  for (const addon of Object.values(ADDONS)) {
    cents.add(addon.monthlyCents); cents.add(addon.annualCents);
    if (addon.setupCents) cents.add(addon.setupCents);
    for (const c of dollarAmounts(addon.description)) cents.add(c);
  }
  for (const band of AGENCY_LOCATION_BANDS) {
    if (band.centsPerLocation > 0) { cents.add(band.centsPerLocation); cents.add(band.centsPerLocation * LEGACY_BAND_ANNUAL_MONTHS); }
  }
  // The CRM's own price book (a separate product): each plan monthly, yearly and
  // the yearly price per month, and the extra seat.
  for (const key of CRM_PLAN_KEYS) {
    const plan = CRM_PLANS[key];
    cents.add(plan.monthlyCents); cents.add(plan.annualCents); cents.add(Math.round(plan.annualCents / 12));
  }
  cents.add(CRM_EXTRA_SEAT_MONTHLY_CENTS); cents.add(CRM_EXTRA_SEAT_ANNUAL_CENTS);
  // The CRM's own add-ons (JobCam), monthly and yearly.
  for (const addon of Object.values(CRM_ADDONS)) { cents.add(addon.monthlyCents); cents.add(addon.annualCents); }
  // Every tool à la carte (shared/alacarte.ts): both tiers, monthly and yearly.
  for (const k of ALACARTE_KEYS) for (const tier of ["standalone", "addon"] as const) for (const i of ["month", "year"] as const) cents.add(alacartePriceCents(k, tier, i));
  // SEO data: the monthly allowance of each plan that has the tools (0 on the others) and the prepaid credit packs (shared/seo-credits.ts).
  for (const key of PLAN_KEYS) if (SEO_PLAN_LIMITS[key].seoCreditCents > 0) cents.add(SEO_PLAN_LIMITS[key].seoCreditCents);
  for (const pack of SEO_CREDIT_PACKS) cents.add(pack);
  return cents;
}
