import { z } from "zod";

/**
 * Other review sites on a review profile (owner, 2026-10-10: "let users add their own BBB links, etc").
 *
 * A review profile (review_templates.other_review_links) holds up to MAX_OTHER_REVIEW_LINKS pasted links, one per
 * site: Yelp, BBB, Houzz, Angi, HomeAdvisor, Facebook, Nextdoor, Thumbtack, or "other" with the owner's own label.
 * A request copies the profile's links when it is sent (review_requests.other_review_links), the way it copies the
 * Google link, so editing the profile later never changes a page a client already has. The client page shows them
 * on the "one more thing" step after the Google step, to every client whatever the score: like the Google link,
 * they are offered, never gated, and no reward is tied to them.
 */
export const REVIEW_PLATFORMS = [
  { key: "yelp", label: "Yelp", hint: "yelp.com/writeareview/biz/..." },
  { key: "bbb", label: "BBB", hint: "bbb.org/.../customer-reviews" },
  { key: "houzz", label: "Houzz", hint: "houzz.com/pro/..." },
  { key: "angi", label: "Angi", hint: "angi.com/companylist/..." },
  { key: "homeadvisor", label: "HomeAdvisor", hint: "homeadvisor.com/rated..." },
  { key: "guildquality", label: "GuildQuality", hint: "guildquality.com/..." },
  { key: "facebook", label: "Facebook", hint: "facebook.com/.../reviews" },
  { key: "nextdoor", label: "Nextdoor", hint: "nextdoor.com/pages/..." },
  { key: "thumbtack", label: "Thumbtack", hint: "thumbtack.com/..." },
  { key: "other", label: "Other", hint: "the page where a client writes a review" },
] as const;
export type ReviewPlatformKey = (typeof REVIEW_PLATFORMS)[number]["key"];
const PLATFORM_KEYS = REVIEW_PLATFORMS.map((p) => p.key) as [ReviewPlatformKey, ...ReviewPlatformKey[]];

export const MAX_OTHER_REVIEW_LINKS = 8;
export const MAX_REVIEW_LINK_LABEL = 40;

export const otherReviewLinkSchema = z.object({
  platform: z.enum(PLATFORM_KEYS),
  /** The site's name when platform is "other"; dropped for a known site. */
  label: z.string().trim().max(MAX_REVIEW_LINK_LABEL).optional(),
  url: z.string().trim().min(1).max(2000),
});
export type OtherReviewLink = z.infer<typeof otherReviewLinkSchema>;

/** A pasted review-page address as an http(s) URL, or null when it is not a web address. */
export function normalizeReviewUrl(raw: unknown): string | null {
  let v = String(raw ?? "").trim();
  if (!v || v.length > 2000 || /\s/.test(v)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = `https://${v}`;
  let url: URL;
  try { url = new URL(v); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.href;
}

/** "Yelp", "BBB", … or the owner's own name for an "other" link. */
export function reviewLinkLabel(link: Pick<OtherReviewLink, "platform" | "label">): string {
  if (link.platform === "other") return link.label?.trim() || "another review site";
  return REVIEW_PLATFORMS.find((p) => p.key === link.platform)?.label ?? link.platform;
}

/**
 * The stored or submitted list, cleaned: the first bad row is reported, URLs are normalized, one link per site
 * ("other" rows one per address), at most MAX_OTHER_REVIEW_LINKS. Anything that is not a list (an old row,
 * a missing column) is an empty list.
 */
export function normalizeOtherReviewLinks(value: unknown): { links: OtherReviewLink[]; error: string | null } {
  if (!Array.isArray(value)) return { links: [], error: value == null ? null : "Review links must be a list." };
  const links: OtherReviewLink[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const parsed = otherReviewLinkSchema.safeParse(value[i]);
    if (!parsed.success) return { links, error: `Review site ${i + 1}: pick a site and paste the address of its review page.` };
    const row = parsed.data;
    const url = normalizeReviewUrl(row.url);
    if (!url) return { links, error: `${reviewLinkLabel(row)}: paste the full address of your review page (https://...).` };
    const label = row.platform === "other" ? (row.label?.trim() || "") : undefined;
    if (row.platform === "other" && !label) return { links, error: "Name the site for an \"Other\" review link." };
    const key = row.platform === "other" ? `other:${url.toLowerCase()}` : row.platform;
    if (seen.has(key)) continue;
    seen.add(key);
    if (links.length >= MAX_OTHER_REVIEW_LINKS) return { links, error: `Up to ${MAX_OTHER_REVIEW_LINKS} other review sites per profile.` };
    links.push(label === undefined ? { platform: row.platform, url } : { platform: row.platform, label, url });
  }
  return { links, error: null };
}

/** The label Google carries as a routing destination. */
export const GOOGLE_DESTINATION_LABEL = "Google";

/** A place the client can be routed to: Google, or one of the owner's pasted other sites. */
export type ReviewDestination = { platform: ReviewPlatformKey | "google"; label?: string; url: string };

/** Google first when it has a link, then the profile's/request's other sites, in order. */
export function reviewDestinations(googleUrl: string | null | undefined, otherLinks: unknown): ReviewDestination[] {
  const dests: ReviewDestination[] = [];
  const g = typeof googleUrl === "string" ? googleUrl.trim() : "";
  if (g) dests.push({ platform: "google", url: g });
  for (const l of normalizeOtherReviewLinks(otherLinks).links) dests.push(l);
  return dests;
}

/** "Google", "Yelp", … or the owner's own name for an "other" destination. */
export function destinationLabel(d: ReviewDestination): string {
  if (d.platform === "google") return GOOGLE_DESTINATION_LABEL;
  return reviewLinkLabel({ platform: d.platform, label: d.label });
}

/** The primary destination's URL: `preferred` when it is one of `dests`, else the first (Google when present). */
export function resolvePrimaryUrl(dests: ReviewDestination[], preferred: unknown): string {
  const want = typeof preferred === "string" ? preferred.trim() : "";
  if (want && dests.some((d) => d.url === want)) return want;
  return dests[0]?.url ?? "";
}

/**
 * The primary URL to STORE on a profile or request: "" (Google, the default) when `preferred` is empty, the
 * Google link, or not one of the other sites; otherwise the matching other-site URL. Empty is read back as Google.
 */
export function normalizePrimaryReviewUrl(preferred: unknown, googleUrl: string | null | undefined, otherLinks: unknown): string {
  const want = typeof preferred === "string" ? preferred.trim() : "";
  if (!want) return "";
  const g = typeof googleUrl === "string" ? googleUrl.trim() : "";
  if (g && want === g) return "";
  const other = normalizeOtherReviewLinks(otherLinks).links.find((l) => l.url === want);
  return other ? other.url : "";
}
