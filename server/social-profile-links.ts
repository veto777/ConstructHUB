/**
 * Server side of shared/social-profile-links.ts: expands a short link (pin.it, fb.me, t.co …) to the profile link it
 * redirects to. Every hop must land on the platform's own domains (cleanSocialLink checks each one), so the
 * fetch can never be pointed at anything else.
 */
import { cleanSocialLink, SOCIAL_LINK_LABELS } from "@shared/social-profile-links";

type Fetch = (url: string, init: { method: string; redirect: "manual"; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

async function expandShortLink(key: string, start: string, fetchImpl: Fetch): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop < 6; hop++) {
    let r;
    try {
      r = await fetchImpl(url, { method: "HEAD", redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; ConstructHUB link check)" }, signal: AbortSignal.timeout(8000) });
      if (r.status === 405 || r.status === 403) r = await fetchImpl(url, { method: "GET", redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (compatible; ConstructHUB link check)" }, signal: AbortSignal.timeout(8000) });
    } catch { return null; }
    const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!next) break;
    let abs: string;
    try { abs = new URL(next, url).toString(); } catch { return null; }
    const c = cleanSocialLink(key, abs);
    if (c.url === null) return null; // redirected off the platform
    url = c.url;
  }
  const final = cleanSocialLink(key, url);
  return final.url === null || final.short ? null : final.url;
}

/** Every link cleaned and expanded, or the first problem as a sentence naming the platform. */
export async function resolveSocialLinks(input: Record<string, string | undefined>, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<{ links: Record<string, string>; error?: string }> {
  const links: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const c = cleanSocialLink(key, raw ?? "");
    if (c.url === null) return { links, error: c.error };
    if (!c.url) { links[key] = ""; continue; }
    if (!c.short) { links[key] = c.url; continue; }
    const expanded = await expandShortLink(key, c.url, fetchImpl);
    if (!expanded) return { links, error: `Could not expand the short ${SOCIAL_LINK_LABELS[key] ?? key} link. Open it in your browser and paste the full profile link instead.` };
    links[key] = expanded;
  }
  return { links };
}
