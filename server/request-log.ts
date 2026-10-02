/**
 * Which API responses the request log may echo. Express matches routes
 * case-insensitively ("/api/Hub/chat" reaches the Hub router), so every
 * exclusion here compares a lower-cased path.
 */

/** Response bodies that are never captured (Hub replies: guardrails §2/§8; site-scan tokens; domain and mail settings). */
const NEVER_CAPTURED = ["/api/agency", "/api/sitescan", "/api/admin/sitescan", "/api/domains", "/api/mail-alerts", "/api/hub"];
/** Bodies with secrets (QR seeds, recovery codes, signed upload URLs, provider credentials). */
const NEVER_LOGGED = ["/api/auth/", "/api/gbp/connect", "/api/social", "/api/ads", "/api/cloudflare", "/api/gsc"];

/** Site-scan paths carry 64-hex report tokens in the URL; the log shows ":token" instead. */
export function isSiteScanPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.startsWith("/api/agency") || p.startsWith("/api/sitescan") || p.startsWith("/api/admin/sitescan");
}

/** True only when the JSON body of a response to `path` may be written to the request log. */
export function responseBodyLoggable(path: string): boolean {
  const p = path.toLowerCase();
  return !NEVER_CAPTURED.some((prefix) => p.startsWith(prefix)) && !NEVER_LOGGED.some((prefix) => p.startsWith(prefix));
}
