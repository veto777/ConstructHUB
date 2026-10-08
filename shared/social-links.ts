/**
 * ConstructHUB's official social accounts — the one list every footer, the landing strip, the sign-up page,
 * the welcome email and the Organization JSON-LD (`sameAs`) read.
 *
 * A wrong link is worse than none (CLAUDE.md): add an account here only with its real, checked URL.
 * Checked 2026-10-08:
 *   - YouTube: the handle page answers 200 and carries channel id UCRsxhhzhirrQCnqETChhyFw.
 *   - Instagram: 200, page title "Construct HUB (@constructhubapp)".
 *   - TikTok: 200, the page data names uniqueId "construct.hub" (statusCode 0).
 *   - LinkedIn: the profile URL is the `creator.url` in the public JSON-LD of the account's own post
 *     (urn:li:ugcPost:7513788256031993858, creator "Construct HUB"). LinkedIn answers every signed-out
 *     profile request with its bot status 999, so the post is the proof, not the profile page.
 * A new account is one more entry below (and, for a new platform, an icon in
 * client/src/components/social-links.tsx).
 */
export type SocialKey = "youtube" | "instagram" | "tiktok" | "linkedin";

export type SocialLink = {
  key: SocialKey;
  /** The platform's name, as shown ("YouTube"). */
  name: string;
  url: string;
  /** The account as people would type it. */
  handle: string;
  /** Accessible name of the icon link. */
  label: string;
  /** The only host(s) this URL may be on (the test enforces it). */
  hosts: readonly string[];
};

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { key: "youtube", name: "YouTube", url: "https://www.youtube.com/@ConstructHUB-t3v", handle: "@ConstructHUB-t3v", label: "ConstructHUB on YouTube", hosts: ["www.youtube.com"] },
  { key: "instagram", name: "Instagram", url: "https://www.instagram.com/constructhubapp/", handle: "@constructhubapp", label: "ConstructHUB on Instagram", hosts: ["www.instagram.com"] },
  { key: "tiktok", name: "TikTok", url: "https://www.tiktok.com/@construct.hub", handle: "@construct.hub", label: "ConstructHUB on TikTok", hosts: ["www.tiktok.com"] },
  { key: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com/in/construct-hub-796b59441", handle: "Construct HUB", label: "ConstructHUB on LinkedIn", hosts: ["www.linkedin.com"] },
];

/** The YouTube channel (the walkthrough videos). */
export const YOUTUBE_CHANNEL_URL = SOCIAL_LINKS.find((l) => l.key === "youtube")!.url;

/** Every account URL, for schema.org `sameAs`. */
export const SOCIAL_URLS: readonly string[] = SOCIAL_LINKS.map((l) => l.url);
