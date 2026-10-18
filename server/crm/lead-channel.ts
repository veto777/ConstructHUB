/**
 * Where a lead came from, the way a contractor thinks of it: Google Ads, Google search, Facebook, Yelp, Nextdoor,
 * the website itself, a phone call. Read only from what arrived with the lead — the click ids and utm_* tags the
 * form-sync script and the owner's sites send with the fields, the page URL's query string, the referrer, the
 * import notes. A lead with no trail is "Website" (the site it came through), never a guessed channel.
 *
 * Pure: no DB, shared by the list and the detail routes (presentLead) and unit-tested on its own.
 */

export type LeadChannelKey =
  | "google_ads" | "google" | "meta_ads" | "facebook" | "instagram" | "microsoft_ads" | "bing" | "tiktok" | "youtube"
  | "yelp" | "nextdoor" | "angi" | "thumbtack" | "houzz" | "campaign" | "referral" | "website" | "phone" | "manual";

export type LeadChannel = {
  key: LeadChannelKey;
  /** What the From column says: "Google Ads", "Facebook", "Website", "Phone call". */
  label: string;
  /** The second half of the line when there is one: the campaign, the referring site, "AI receptionist". */
  detail: string | null;
};

type LeadLike = {
  source: string;
  sourceLabel?: string | null;
  pageUrl?: string | null;
  fields?: Record<string, string> | null;
  message?: string | null;
};

/** The tracking keys, in the spellings the sites and the script use (leading underscores and dashes ignored). */
const TRACK_KEYS = ["utm_source", "utm_medium", "utm_campaign", "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "referrer", "referer", "landing"] as const;
type TrackKey = (typeof TRACK_KEYS)[number];

const normKey = (k: string) => k.toLowerCase().replace(/^_+/, "").replace(/-/g, "_").replace(/^http_/, "");

/** Every tracking value the lead carries: its fields first, then the page URL's and the landing URL's query strings. */
export function leadTracking(lead: LeadLike): Partial<Record<TrackKey, string>> {
  const out: Partial<Record<TrackKey, string>> = {};
  const take = (k: string, v: unknown) => {
    const key = normKey(k) as TrackKey;
    if (!TRACK_KEYS.includes(key) || out[key]) return;
    const s = typeof v === "string" ? v.trim() : "";
    if (s) out[key] = s.slice(0, 500);
  };
  for (const [k, v] of Object.entries(lead.fields ?? {})) take(k, v);
  for (const url of [lead.pageUrl, out.landing]) {
    if (!url) continue;
    try { new URL(url).searchParams.forEach((v, k) => take(k, v)); } catch { /* not a URL */ }
  }
  return out;
}

/**
 * The script's attribution envelope ({ utm_source, gclid, referrer, landing, … }, read on the visitor's landing page)
 * as `_`-prefixed lead fields — tracking keys only, so a site cannot smuggle extra fields past the form's own.
 */
export function attributionFields(a: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!a || typeof a !== "object" || Array.isArray(a)) return out;
  for (const [k, v] of Object.entries(a)) {
    const key = normKey(k) as TrackKey;
    if (!TRACK_KEYS.includes(key) || typeof v !== "string") continue;
    const s = v.trim().slice(0, 500);
    if (s) out[`_${key}`] = s;
  }
  return out;
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null; } catch { return null; }
};

const PAID_MEDIUM = /^(cpc|ppc|paid|paid[-_ ]?social|paidsocial|display|cpm|sem|ads?)$/i;

/** "siding-skagit" stays as typed; an unknown utm_source becomes a readable name ("home_advisor" → "Home advisor"). */
const readable = (s: string) => {
  const t = s.replace(/[_+]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  return t ? t[0].toUpperCase() + t.slice(1) : null;
};

/** A known site by its utm_source value or referrer host; null for anything else. */
function knownSite(s: string): { key: LeadChannelKey; label: string } | null {
  const v = s.toLowerCase();
  // google.com, google.ca, google.co.uk — not google.evil.com.
  if (/(^|\.)google\.(com|[a-z]{2}|[a-z]{2,3}\.[a-z]{2})$|^(google|adwords|googleads)$/.test(v)) return { key: "google", label: "Google" };
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$|^(facebook|fb)$/.test(v)) return { key: "facebook", label: "Facebook" };
  if (/(^|\.)instagram\.com$|^(instagram|ig)$/.test(v)) return { key: "instagram", label: "Instagram" };
  if (/^meta$/.test(v)) return { key: "facebook", label: "Meta" };
  if (/(^|\.)bing\.com$|^(bing|microsoft)$/.test(v)) return { key: "bing", label: "Bing" };
  if (/(^|\.)(youtube\.com|youtu\.be)$|^youtube$/.test(v)) return { key: "youtube", label: "YouTube" };
  if (/(^|\.)tiktok\.com$|^tiktok$/.test(v)) return { key: "tiktok", label: "TikTok" };
  if (/(^|\.)yelp\.com$|^yelp$/.test(v)) return { key: "yelp", label: "Yelp" };
  if (/(^|\.)nextdoor\.com$|^nextdoor$/.test(v)) return { key: "nextdoor", label: "Nextdoor" };
  if (/(^|\.)(angi\.com|angieslist\.com|homeadvisor\.com)$|^(angi|angieslist|angies_list|homeadvisor|home_advisor)$/.test(v)) return { key: "angi", label: "Angi" };
  if (/(^|\.)thumbtack\.com$|^thumbtack$/.test(v)) return { key: "thumbtack", label: "Thumbtack" };
  if (/(^|\.)houzz\.com$|^houzz$/.test(v)) return { key: "houzz", label: "Houzz" };
  return null;
}

export function leadChannel(lead: LeadLike): LeadChannel {
  // The line it rang on is the source label, shown under the channel already.
  if (lead.source === "call_assistant") return { key: "phone", label: "Phone call", detail: null };
  if (lead.source === "manual") return { key: "manual", label: "Added by hand", detail: null };
  // The historical loader marks the AI receptionist's entries; her messages open with VIRTUAL FORM.
  if (lead.source === "import" && (/ai-phone-janice/i.test(lead.fields?.flags ?? "") || /^\s*VIRTUAL FORM\b/i.test(lead.message ?? ""))) {
    return { key: "phone", label: "Phone call", detail: "AI receptionist" };
  }

  const t = leadTracking(lead);
  const src = (t.utm_source ?? "").toLowerCase();
  const paid = PAID_MEDIUM.test(t.utm_medium ?? "");
  const campaign = t.utm_campaign?.slice(0, 60) || null;

  // Click ids are the surest sign: an ad was clicked.
  if (t.gclid || t.gbraid || t.wbraid || (paid && knownSite(src)?.key === "google")) return { key: "google_ads", label: "Google Ads", detail: campaign };
  if (t.msclkid || (paid && knownSite(src)?.key === "bing")) return { key: "microsoft_ads", label: "Microsoft Ads", detail: campaign };
  const metaSrc = knownSite(src)?.key === "facebook" || knownSite(src)?.key === "instagram";
  if ((t.fbclid && paid) || (paid && metaSrc)) return { key: "meta_ads", label: "Meta Ads", detail: campaign };
  if (t.ttclid || (paid && knownSite(src)?.key === "tiktok")) return { key: "tiktok", label: "TikTok Ads", detail: campaign };

  // A utm_source names the channel outright.
  if (src) {
    const known = knownSite(src);
    if (known) return { key: known.key, label: known.label, detail: campaign };
    return { key: "campaign", label: readable(t.utm_source!) ?? "Campaign", detail: campaign };
  }
  // Facebook puts fbclid on every outbound link, paid or not: a click from Facebook or Instagram.
  if (t.fbclid) return { key: "facebook", label: "Facebook", detail: campaign };

  // The referrer: the site the visitor came from, unless it is the site itself.
  const site = hostOf(lead.pageUrl) ?? hostOf(t.landing);
  const ref = hostOf(t.referrer ?? t.referer);
  if (ref && ref !== site && !(site && (ref.endsWith(`.${site}`) || site.endsWith(`.${ref}`)))) {
    const known = knownSite(ref);
    if (known) return { key: known.key, label: known.label, detail: null };
    return { key: "referral", label: "Referral", detail: ref };
  }

  return { key: "website", label: "Website", detail: null };
}
