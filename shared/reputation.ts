/**
 * Reputation Desk (/admin/reputation, /reputation, /reputation/scan): reputation restoration for people and
 * businesses. A free public scan reads page 1–2 of Google and the autocomplete for a name; a case runs the
 * work on it:
 *
 *   suppress      push negative results down: track every result's position over time, plan and track the
 *                 owned assets (sites, profiles, articles, press, video) built to outrank them
 *   remove        removal requests per negative URL, by playbook (Google, Bing, YouTube, DMCA, NCII, mugshots,
 *                 complaint and review sites), with the request text drafted and the status tracked
 *   autocomplete  Google's predictions for the name, checked on every scan; negative ones are reported through
 *                 Google's own "report inappropriate predictions" flow
 *   brokers       people-search / data-broker opt-outs from the registry (server/data/data-brokers.json)
 *   wikipedia     notability sources, a draft and the disclosed-paid-editing route (Wikimedia Terms of Use)
 *   reviews       business reviews and listings (the GBP review tools and Directory Sync already in ConstructHUB)
 *   growth        the SEO, PPC, social and web-design services sold alongside
 *
 * Shared by the server (server/reputation/*) and the pages. Everything shown comes from a real search result,
 * a registry entry or what an operator recorded — never generated data.
 */

export const REP_SUBJECT_KINDS = ["person", "business"] as const;
export type RepSubjectKind = (typeof REP_SUBJECT_KINDS)[number];

export const SENTIMENTS = ["negative", "neutral", "positive"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** owned: the subject controls it (their site, their profile). third_party: anyone else. */
export const CONTROLS = ["owned", "third_party"] as const;
export type Control = (typeof CONTROLS)[number];

export const ITEM_KINDS = ["result", "image", "video", "news", "autocomplete"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_ACTIONS = ["suppress", "remove", "monitor", "ignore"] as const;
export type ItemAction = (typeof ITEM_ACTIONS)[number];
export const ITEM_ACTION_LABELS: Record<ItemAction, string> = { suppress: "Push down", remove: "Remove", monitor: "Watch", ignore: "Ignore" };

export const ITEM_STATUSES = ["open", "in_progress", "requested", "removed", "suppressed", "denied", "done"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  open: "Open", in_progress: "Working", requested: "Request sent", removed: "Removed", suppressed: "Off page 1", denied: "Denied", done: "Done",
};

export const ASSET_KINDS = ["website", "profile", "article", "press_release", "video", "social", "wikipedia", "review_profile", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  website: "Website", profile: "Profile", article: "Article", press_release: "Press release", video: "Video", social: "Social account",
  wikipedia: "Wikipedia", review_profile: "Review profile", other: "Other",
};
export const ASSET_STATUSES = ["planned", "building", "live"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const BROKER_STATUSES = ["not_checked", "listed", "not_found", "submitted", "verify_needed", "removed", "failed"] as const;
export type BrokerStatus = (typeof BROKER_STATUSES)[number];
export const BROKER_STATUS_LABELS: Record<BrokerStatus, string> = {
  not_checked: "Not checked", listed: "Listed", not_found: "Not found", submitted: "Opt-out sent", verify_needed: "Needs verification",
  removed: "Removed", failed: "Failed",
};

export const CASE_STATUSES = ["lead", "active", "paused", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const LEAD_STATUSES = ["new", "contacted", "offer_sent", "client", "closed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", offer_sent: "Offer sent", client: "Client", closed: "Closed" };

/** The service lines a case can carry (shown as tabs; the proposal template sells them). */
export const SERVICE_LINES = [
  { key: "suppress", title: "Push negative results down", blurb: "Track every result's position and build the owned assets that outrank the bad ones." },
  { key: "remove", title: "Removals", blurb: "Google, Bing, Images, YouTube, copyright (DMCA), mugshots, non-consensual images and named complaint and review sites." },
  { key: "autocomplete", title: "Autocomplete cleanup", blurb: "Watch Google's predictions for the name and report the ones that break Google's policies." },
  { key: "brokers", title: "People-search opt-outs", blurb: "Find the client on data-broker and people-search sites and opt them out, then re-check." },
  { key: "wikipedia", title: "Wikipedia", blurb: "Notability sources, a neutral draft and a disclosed submission through Wikipedia's own process." },
  { key: "reviews", title: "Reviews & listings", blurb: "Review monitoring, responses, review requests and accurate listings everywhere." },
  { key: "growth", title: "SEO, PPC, social & web design", blurb: "The marketing services that keep a restored name strong." },
] as const;
export type ServiceLineKey = (typeof SERVICE_LINES)[number]["key"];

/** One result as stored on a scan or a check. */
export type RepResult = {
  kind: ItemKind;
  position: number;
  url: string | null;
  domain: string | null;
  title: string;
  snippet: string;
  sentiment: Sentiment;
  control: Control;
  /** Why it was labelled that way (the classifier's short reason, or the keyword that matched). */
  reason: string | null;
  /** The playbook a removal would use, when one fits (removal-playbooks.json key). */
  playbook: string | null;
};

export type RepScanReport = {
  query: string;
  kind: RepSubjectKind;
  checkedAt: string;
  results: RepResult[];
  autocomplete: { suggestion: string; sentiment: Sentiment; reason: string | null }[];
  score: number;
  grade: string;
  counts: { negativeTop10: number; negativeTop20: number; ownedTop10: number; negativeAutocomplete: number };
  classifier: string;
};

// ---------------------------------------------------------------------------------------------- scoring

/** How much a negative result costs by where it sits: page 1 hurts most, the top 3 above all. */
export function positionWeight(position: number): number {
  if (position <= 1) return 25;
  if (position === 2) return 20;
  if (position === 3) return 15;
  if (position <= 5) return 10;
  if (position <= 10) return 6;
  if (position <= 20) return 2;
  return 0;
}

/**
 * The reputation score, 0–100: 100 minus the weight of every negative result by position (images, video and
 * news count like results at their place), minus 5 per negative autocomplete prediction (at most 20), plus 2
 * per owned result on page 1 (at most 10, never above 100).
 */
export function reputationScore(results: Pick<RepResult, "position" | "sentiment" | "control">[], autocomplete: { sentiment: Sentiment }[]): number {
  let score = 100;
  for (const r of results) if (r.sentiment === "negative") score -= positionWeight(r.position);
  score -= Math.min(20, autocomplete.filter((a) => a.sentiment === "negative").length * 5);
  score += Math.min(10, results.filter((r) => r.control === "owned" && r.position <= 10).length * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreGrade(score: number): string {
  return score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";
}

export function scoreCounts(results: RepResult[], autocomplete: { sentiment: Sentiment }[]) {
  return {
    negativeTop10: results.filter((r) => r.sentiment === "negative" && r.position <= 10).length,
    negativeTop20: results.filter((r) => r.sentiment === "negative" && r.position <= 20).length,
    ownedTop10: results.filter((r) => r.control === "owned" && r.position <= 10).length,
    negativeAutocomplete: autocomplete.filter((a) => a.sentiment === "negative").length,
  };
}

// ---------------------------------------------------------------------------------------------- classification fallback

/** Words that mark a result as negative when no AI classifier is available (and as a hint to the classifier). */
export const NEGATIVE_TERMS = [
  "scam", "scammer", "fraud", "lawsuit", "sued", "arrest", "arrested", "mugshot", "charged", "indicted", "convicted", "complaint",
  "complaints", "ripoff", "rip-off", "rip off", "warning", "beware", "lawsuit", "investigation", "investigated", "allegation", "alleged",
  "accused", "misconduct", "malpractice", "fired", "bankrupt", "bankruptcy", "foreclosure", "sex offender", "dui", "dwi", "felony",
  "revoked", "suspended", "disciplin", "sanction", "violation", "cheat", "cheater", "abuse", "harass", "worst", "terrible", "avoid",
  "negative review", "1 star", "one star", "pissedconsumer", "ripoffreport", "complaintsboard", "thedirty", "scam", "exposed",
] as const;

/** Domains that are complaint or gossip sites: anything there about the subject is negative. */
export const COMPLAINT_DOMAINS = [
  "ripoffreport.com", "pissedconsumer.com", "complaintsboard.com", "thedirty.com", "scamguard.com", "reportscam.com", "dirtyscam.com",
  "repdigger.com", "shesahomewrecker.com", "cheaterland.com", "mugshots.com", "bustedmugshots.com", "arrests.org", "mugshotlook.com",
] as const;

/** Which removal playbook fits a result's domain (keys in server/data/removal-playbooks.json; checked at use). */
export const PLAYBOOK_BY_DOMAIN: Record<string, string> = {
  "youtube.com": "youtube-privacy", "youtu.be": "youtube-privacy",
  "ripoffreport.com": "ripoff-report-policy", "pissedconsumer.com": "pissedconsumer", "complaintsboard.com": "complaintsboard",
  "glassdoor.com": "glassdoor", "indeed.com": "indeed-reviews", "yelp.com": "yelp-report-review", "trustpilot.com": "trustpilot-flag", "bbb.org": "bbb-complaint-review",
  "reddit.com": "reddit-privacy", "thedirty.com": "thedirty", "justia.com": "justia", "facebook.com": "facebook-privacy", "instagram.com": "instagram-privacy",
  "tiktok.com": "tiktok-privacy-harassment", "x.com": "x-private-info", "twitter.com": "x-private-info", "mugshots.com": "mugshot-expungement-route", "bustedmugshots.com": "mugshot-expungement-route", "arrests.org": "mugshot-expungement-route",
};

const host = (d: string | null) => (d ?? "").toLowerCase().replace(/^www\./, "");
export function playbookFor(domain: string | null, kind: ItemKind): string | null {
  const h = host(domain);
  for (const [d, key] of Object.entries(PLAYBOOK_BY_DOMAIN)) if (h === d || h.endsWith(`.${d}`)) return key;
  if (kind === "autocomplete") return "google-autocomplete";
  if (kind === "image") return "google-images-general";
  return null;
}

/** The keyword fallback: negative on a complaint domain or a negative term; otherwise neutral. */
export function heuristicSentiment(text: string, domain: string | null): { sentiment: Sentiment; reason: string | null } {
  const h = host(domain);
  if (COMPLAINT_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))) return { sentiment: "negative", reason: `complaint site (${h})` };
  const t = ` ${text.toLowerCase()} `;
  const hit = NEGATIVE_TERMS.find((w) => t.includes(w));
  return hit ? { sentiment: "negative", reason: `mentions “${hit}”` } : { sentiment: "neutral", reason: null };
}

export const normalizeQuery = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, 120);

// ---------------------------------------------------------------------------------------------- plans

/**
 * Individual restoration plans (12-month term). What each covers is public; the prices are not (owner, 2026-10-24)
 * and live in server/reputation/prices.ts and the proposal template. Business and enterprise work is quoted.
 */
export const REP_PLANS = [
  { key: "foundation", name: "Foundation", negatives: "1–2 negative results", fit: "A single bad result or a thin presence",
    includes: ["Reputation audit and monthly report", "Owned assets: personal or business site and core profiles", "Ongoing content to push results down", "Ongoing monitoring of your results"] },
  { key: "restore", name: "Restore", negatives: "3–4 negative results", fit: "A few problems on page 1",
    includes: ["Everything in Foundation", "Autocomplete cleanup", "People-search opt-outs", "More placements each month"] },
  { key: "restore-pro", name: "Restore Pro", negatives: "5–6 negative results", fit: "Serious damage across page 1", badge: "Most chosen",
    includes: ["Everything in Restore", "Search ads on your name while results move", "Image and video cleanup", "Monthly strategy call"] },
  { key: "total", name: "Total Restoration", negatives: "7+ negative results", fit: "Severe or widespread damage",
    includes: ["Everything in Restore Pro", "Top-priority team", "Highest content and placement volume", "Multiple search terms"] },
] as const;
export const REP_TERM_MONTHS = 12;
