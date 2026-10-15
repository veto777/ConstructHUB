/**
 * The seven social profile links a Google Business Profile carries (url_facebook … url_youtube), cleaned the
 * way Google wants them: one full https link per platform, on that platform's own domain, without tracking
 * query strings. Shared by the Social Profiles tab (inline errors) and the save route (final word).
 * (shared/social-links.ts is ConstructHUB's own accounts; this file is about a customer's listing.)
 *
 * Owner 2026-10-15: two links pasted into one box and a pin.it short link reached the form; Google would have
 * refused both. A short link is accepted here and expanded on the server (server/social-links.ts).
 */
export const SOCIAL_LINK_LABELS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", pinterest: "Pinterest", tiktok: "TikTok", twitter: "X (Twitter)", youtube: "YouTube",
};

/** The domains a platform's profile link may live on. Subdomains of these count (m., business., api.). */
export const SOCIAL_LINK_HOSTS: Record<string, string[]> = {
  facebook: ["facebook.com", "fb.com", "fb.me"],
  instagram: ["instagram.com", "instagr.am"],
  linkedin: ["linkedin.com", "lnkd.in"],
  pinterest: ["pinterest.com", "pin.it"],
  tiktok: ["tiktok.com"],
  twitter: ["x.com", "twitter.com", "t.co"],
  youtube: ["youtube.com", "youtu.be"],
};

/** Short-link domains: fine to paste, but the listing needs the profile link they redirect to. */
export const SOCIAL_SHORT_HOSTS = ["fb.me", "instagr.am", "lnkd.in", "pin.it", "vm.tiktok.com", "vt.tiktok.com", "t.co", "youtu.be"];

export type CleanSocialLink = { url: string; short: boolean; error: null } | { url: null; short: false; error: string };

const hostMatches = (host: string, allowed: string[]) => allowed.some((h) => host === h || host.endsWith("." + h));

/** The blank-or-clean link for one platform, or the sentence to show under its box. */
export function cleanSocialLink(key: string, raw: string): CleanSocialLink {
  const label = SOCIAL_LINK_LABELS[key] ?? key;
  const v = (raw ?? "").trim();
  if (!v) return { url: "", short: false, error: null };
  if ((v.match(/https?:\/\//gi) ?? []).length > 1) return { url: null, short: false, error: `Two links are pasted together in ${label}. Clear the box and paste one link.` };
  if (/\s/.test(v)) return { url: null, short: false, error: `The ${label} link has a space in it. Paste the link on its own.` };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return { url: null, short: false, error: `Enter the full ${label} link, starting with https://` }; }
  const host = u.hostname.toLowerCase();
  const allowed = SOCIAL_LINK_HOSTS[key];
  if (!allowed) return { url: null, short: false, error: `Unknown platform ${key}` };
  const ok = hostMatches(host, allowed) || (key === "pinterest" && /^(www\.)?pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host));
  if (!ok) return { url: null, short: false, error: `That isn't a ${label} link — it points to ${host}.` };
  const short = hostMatches(host, SOCIAL_SHORT_HOSTS);
  u.protocol = "https:";
  u.hash = "";
  if (!short) u.search = ""; // invite_code, utm_*, igsh … are not part of a profile link
  if (!u.pathname || u.pathname === "/") return short ? { url: u.toString(), short, error: null } : { url: null, short: false, error: `The ${label} link needs your profile after the domain, like https://${allowed[0]}/yourbusiness` };
  return { url: u.toString(), short, error: null };
}
