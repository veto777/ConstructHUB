/**
 * Which face of ConstructHUB is this browser tab?
 *
 * portal.constructhub.us / portal.constructhub.app  → the CRM ("portal")
 * everything else                                    → the marketing site
 *
 * Kept in lockstep with server/site-context.ts. The server also enforces this
 * (noindex + robots on portal hosts); this is purely what the SPA renders.
 */
const PORTAL_PREFIX = "portal.";

/** Local dev: ?portal=1 or VITE_FORCE_PORTAL=true renders the portal on localhost. */
function forcedPortal(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env?.VITE_FORCE_PORTAL === "true") return true;
  try {
    return new URLSearchParams(window.location.search).get("portal") === "1";
  } catch {
    return false;
  }
}

export function isPortal(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host.startsWith(PORTAL_PREFIX) || forcedPortal();
}

/** The portal origin for the domain currently being browsed. */
export function portalUrl(path = "/"): string {
  if (typeof window === "undefined") return path;
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith(PORTAL_PREFIX)) return path;
  return `${window.location.protocol}//${PORTAL_PREFIX}${host}${path}`;
}

/** The marketing origin for the domain currently being browsed. */
export function marketingUrl(path = "/"): string {
  if (typeof window === "undefined") return path;
  const host = window.location.hostname.toLowerCase();
  if (!host.startsWith(PORTAL_PREFIX)) return path;
  return `${window.location.protocol}//${host.slice(PORTAL_PREFIX.length)}${path}`;
}
