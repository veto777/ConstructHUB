import { createHmac, timingSafeEqual } from "crypto";
import { isIP } from "net";
import { z } from "zod";

// Pure request guards and normalisers for server/routes.ts (unit-tested in
// route-guards.test.ts). Nothing here touches the database or the network.

// Anonymous form input goes into staff email HTML: escape every field, and keep
// header values (subject) on one line so CR/LF cannot add headers.
export const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const oneLine = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
export const firstZodMessage = (err: z.ZodError, fallback = "Invalid input") => err.errors[0]?.message || fallback;

// The visitor IP is req.ip: Express applies `trust proxy` (server/index.ts), so a
// client-supplied X-Forwarded-For entry cannot choose the stored address.
export function visitorIp(req: any): string {
  const raw = String(req.ip || req.socket?.remoteAddress || "").trim();
  return raw.replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/, "$1") || "unknown";
}

// Country/city come only from Cloudflare's edge headers on proxied requests.
// Missing or unknown ("XX", Tor "T1") stays null — never guessed.
export function edgeGeo(req: any): { country: string | null; city: string | null } {
  const code = String(req.headers?.["cf-ipcountry"] || "").trim().toUpperCase();
  const cityHeader = req.headers?.["cf-ipcity"];
  return {
    country: /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null,
    city: typeof cityHeader === "string" && cityHeader.trim() ? cityHeader.trim().slice(0, 100) : null,
  };
}

// Click Guard / Google Ads exclusions: a single IP, a CIDR range, or an IPv4
// last-octet wildcard (1.2.3.*). Very wide ranges are refused.
export function normalizeBlockedIp(value: unknown): string | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v.length > 64) return null;
  if (isIP(v)) return v.replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/, "$1");
  const wildcard = v.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\*$/);
  if (wildcard) return isIP(`${wildcard[1]}.0`) === 4 ? v : null;
  const cidr = v.match(/^([^/]+)\/(\d{1,3})$/);
  if (cidr) {
    const family = isIP(cidr[1]);
    const bits = Number(cidr[2]);
    if (family === 4 && bits >= 16 && bits <= 32) return v;
    if (family === 6 && bits >= 32 && bits <= 128) return v;
  }
  return null;
}

export function isPublicIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if ((a === 169 && b === 254) || (a === 192 && b === 168)) return false;
  if ((a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127)) return false;
  return true;
}

// VPN Shield redirect targets run in the customer's page: http(s) only.
export function safeRedirectUrl(value: unknown): string | null {
  const v = String(value ?? "").trim();
  if (!v || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

// Tracked-domain labels: a bare hostname (scheme, path and port dropped).
export function normalizeTrackedDomain(value: unknown): string | null {
  let v = String(value ?? "").trim();
  if (!v || v.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
  let host: string;
  try { host = new URL(v).hostname.toLowerCase().replace(/\.$/, ""); } catch { return null; }
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(host) ? host : null;
}

// Click Guard domain settings: only these keys, each in the range the UI offers.
const settingInt = (label: string, min: number, max: number) =>
  z.number({ invalid_type_error: `${label} must be a whole number from ${min} to ${max}` })
    .int(`${label} must be a whole number from ${min} to ${max}`)
    .min(min, `${label} must be a whole number from ${min} to ${max}`)
    .max(max, `${label} must be a whole number from ${min} to ${max}`);
export const clickGuardSettingsInput = z.object({
  clickThreshold: settingInt("Click threshold", 1, 20),
  blockDays: settingInt("Block duration", 1, 90),
  exclusionListRate: settingInt("Exclusion list length", 50, 500),
  manualExcludeIps: z.string().max(20000),
  whitelistIps: z.string().max(20000),
  countryMode: z.enum(["allow", "block"]),
  detectDeviceId: z.boolean(),
  blockByCountry: z.boolean(),
  blockJsDisabled: z.boolean(),
  vpnBlocking: z.boolean(),
  behaviorAnalysis: z.boolean(),
  ipRangeExclusion: z.boolean(),
  aggressiveBlocking: z.boolean(),
}).partial().strict().refine(v => Object.keys(v).length > 0, "No settings to update");

// The exclusion list is fetched by the owner's Google Ads Script, not by the
// public page tag, so it needs a key the page source never contains.
export function exclusionListKey(trackingId: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET || "dev-only-insecure-session-secret")
    .update(`click-guard-exclusion:${trackingId}`).digest("base64url").slice(0, 32);
}
export function exclusionKeyMatches(trackingId: string, key: unknown): boolean {
  if (typeof key !== "string") return false;
  const expected = Buffer.from(exclusionListKey(trackingId));
  const given = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Google's formatted_address is "street, city, ST zip, country". Locations keep
// city/state/zip in their own columns, so `address` holds only the street line
// (everything before the locality). Null when Google gives no street (e.g. a
// service-area business) — never the full string, which the UI would repeat.
export function placeStreetLine(d: any): string | null {
  const comps: any[] = Array.isArray(d?.address_components) ? d.address_components : [];
  const part = (type: string) => comps.find(c => Array.isArray(c.types) && c.types.includes(type))?.long_name as string | undefined;
  const formatted = typeof d?.formatted_address === "string" ? d.formatted_address : "";
  const locality = part("locality") || part("postal_town") || part("sublocality");
  if (formatted && locality) {
    const segments = formatted.split(",").map((x: string) => x.trim());
    const at = segments.findIndex((x: string) => x === locality);
    if (at === 0) return null;
    if (at > 0) return segments.slice(0, at).join(", ");
  }
  const street = [part("street_number"), part("route")].filter(Boolean).join(" ");
  if (!street) return null;
  const unit = part("subpremise");
  return unit ? `${street} #${unit}` : street;
}

// PUT /api/locations/:id — the fields an owner may edit. Google-sourced metrics
// (review counts, photo counts, rank) and provider links are never client-set.
export const SOCIAL_PROFILE_KEYS = ["facebook", "instagram", "linkedin", "pinterest", "tiktok", "twitter", "youtube"] as const;
const isHttpsUrl = (v: string) => { try { return new URL(v).protocol === "https:"; } catch { return false; } };
const isHttpUrl = (v: string) => { try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; } };
const socialLink = z.string().trim().max(500, "Social profile links must be under 500 characters")
  .refine(v => v === "" || isHttpsUrl(v), "Social profile links must be full https:// links");
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const textList = z.array(z.string().trim().max(200)).max(100).nullable();
export const locationUpdateInput = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(300),
  address: optionalText(500),
  city: optionalText(200),
  state: optionalText(100),
  zipCode: optionalText(20),
  country: optionalText(100),
  phone: optionalText(50),
  website: z.string().trim().max(500).refine(v => v === "" || isHttpUrl(v), "Website must be a full http(s):// link").nullable(),
  description: optionalText(5000),
  categories: textList,
  services: textList,
  serviceAreas: textList,
  tags: textList,
  notifyFields: textList,
  openingDate: optionalText(40),
  openStatus: optionalText(40),
  socialProfiles: z.object(Object.fromEntries(SOCIAL_PROFILE_KEYS.map(k => [k, socialLink])) as Record<typeof SOCIAL_PROFILE_KEYS[number], typeof socialLink>).partial().strict(),
  notificationEmail: z.union([z.literal(""), z.string().trim().max(254).email("Enter a valid notification email")]).nullable()
    .transform(v => v || null),
  gbpManagementEnabled: z.boolean(),
}).partial().strict();

// The signed-in owner opening their own review link (the eye-icon preview) is
// not the customer: nothing they do there is recorded on the request.
export const isOwnerPreview = (req: any, request: { userId: number }) => !!req.user && req.user.id === request.userId;

// Review links must point at Google (g.page, goo.gl, share.google or google.<tld>).
export const GOOGLE_REVIEW_LINK_MESSAGE = "Paste your Google review link (https://g.page/r/... or a Google Maps link to your business)";
export function googleReviewLink(resolved: string): string | null {
  let u: URL;
  try { u = new URL(resolved.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const google = /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(host)
    || /^(?:[a-z0-9-]+\.)*(?:goo\.gl|g\.page|share\.google)$/.test(host);
  if (!google) return null;
  // A bare Google homepage (what a broken short link redirects to) is not a review link.
  if (/(^|\.)google\./.test(host) && u.pathname === "/" && !u.search) return null;
  u.protocol = "https:";
  return u.toString();
}
