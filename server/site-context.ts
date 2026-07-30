/**
 * Host routing for ConstructHUB.
 *
 * One app, one database, two faces:
 *   - marketing  — constructhub.us / constructhub.app (+ www)
 *   - portal     — portal.constructhub.us / portal.constructhub.app  ← the CRM
 *
 * Both domains serve the same Express app and the same Postgres. Marketing
 * traffic on a non-primary domain is 301'd to the primary so Google sees one
 * canonical origin; the portal is never redirected and is always noindex.
 *
 * Hosts are matched against an allowlist, never trusted from the Host header,
 * because getBaseUrl() output ends up in invitation links and OAuth callbacks.
 */

/**
 * Registrable domains this deployment answers for.
 *
 * NOTE the spelling: we own **constructionhub.app** (Namecheap veto7777, in the
 * same Cloudflare account as constructhub.us). The shorter "constructhub.app"
 * is registered to someone else at GoDaddy — do not add it.
 */
export const SITE_DOMAINS: string[] = (process.env.SITE_DOMAINS ||
  "constructhub.us,constructionhub.app")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** The one marketing origin everything else canonicalizes to. */
export const PRIMARY_DOMAIN = (process.env.PRIMARY_DOMAIN || SITE_DOMAINS[0] || "constructhub.us").toLowerCase();

/** Subdomain that serves the CRM. */
export const PORTAL_PREFIX = (process.env.PORTAL_PREFIX || "portal").toLowerCase();

export const PORTAL_HOSTS: string[] = SITE_DOMAINS.map((d) => `${PORTAL_PREFIX}.${d}`);

/** Every hostname we will echo back in an absolute URL. */
const ALLOWED_HOSTS = new Set<string>([
  ...SITE_DOMAINS,
  ...SITE_DOMAINS.map((d) => `www.${d}`),
  ...PORTAL_HOSTS,
]);

export function normalizeHost(raw: unknown): string {
  return String(raw || "").toLowerCase().split(":")[0].trim();
}

/** The hostname of this request, honouring the tunnel's forwarded header. */
export function requestHost(req: any): string {
  return normalizeHost(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
}

export function isPortalHost(host: string): boolean {
  return PORTAL_HOSTS.includes(normalizeHost(host));
}

export function isKnownHost(host: string): boolean {
  return ALLOWED_HOSTS.has(normalizeHost(host));
}

/** Registrable domain for a known host ("portal.constructhub.app" → "constructhub.app"). */
export function siteDomainOf(host: string): string {
  const h = normalizeHost(host);
  return SITE_DOMAINS.find((d) => h === d || h.endsWith(`.${d}`)) || PRIMARY_DOMAIN;
}

/**
 * Absolute origin to use in emails, invite links and OAuth callbacks.
 *
 * Stays on the caller's own domain when it is one we recognise — so an invite
 * sent from portal.constructhub.app links back to .app, not .us — and falls
 * back to the primary domain for anything unrecognised. That fallback is the
 * security-relevant part: it stops a spoofed Host header from planting an
 * attacker's origin in an outgoing email.
 */
/**
 * Origin to use for the Google OAuth redirect_uri.
 *
 * Google rejects any redirect_uri that is not registered verbatim in the Cloud
 * Console ("Error 400: redirect_uri_mismatch"), so this is deliberately
 * stricter than siteBaseUrl():
 *   - "www." is stripped, so www and apex share ONE registered callback
 *   - the host must appear in OAUTH_HOSTS, otherwise we fall back to the
 *     primary domain rather than emit a URI Google will reject
 *
 * Every host listed here must also be registered as an Authorized redirect URI
 * (as `https://<host>/api/auth/google/callback`) in the Google Cloud Console.
 */
export const OAUTH_HOSTS: string[] = (
  process.env.OAUTH_HOSTS || [...SITE_DOMAINS, ...PORTAL_HOSTS].join(",")
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export function oauthBaseUrl(req: any): string {
  if (process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT) {
    return siteBaseUrl(req);
  }
  let host = requestHost(req);
  if (host.startsWith("www.")) host = host.slice(4); // www + apex share one callback
  if (OAUTH_HOSTS.includes(host)) return `https://${host}`;
  return `https://${PRIMARY_DOMAIN}`;
}

export function siteBaseUrl(req: any): string {
  if (process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT) {
    const proto = req?.headers?.["x-forwarded-proto"] || req?.protocol || "http";
    const host = requestHost(req) || "localhost:5000";
    const port = String(req?.headers?.host || "").split(":")[1];
    return `${proto}://${host}${port ? `:${port}` : ""}`;
  }
  const host = requestHost(req);
  if (isKnownHost(host)) return `https://${host}`;
  return `https://${PRIMARY_DOMAIN}`;
}
