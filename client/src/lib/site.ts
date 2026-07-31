/**
 * Which face of ConstructHUB is this browser tab?
 *
 * portal.constructhub.us / portal.constructhub.app / demo.constructhub.us
 *   → ConstructHub CRM (its own product, its own identity)
 * everything else → the marketing site
 *
 * Kept in lockstep with server/site-context.ts (PORTAL_PREFIX env; the demo
 * instance runs PORTAL_PREFIX=demo). The server also enforces noindex/robots
 * on CRM hosts; this is purely what the SPA renders.
 */
const CRM_HOST_PREFIXES = ["portal.", "demo."];

/** The product identity every CRM surface carries. */
export const CRM_NAME = "ConstructHub CRM";

/** Local dev: ?portal=1 or VITE_FORCE_PORTAL=true renders the CRM on localhost. */
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
  return CRM_HOST_PREFIXES.some((p) => host.startsWith(p)) || forcedPortal();
}

/**
 * The homeowner client portal (client.constructhub.*) — magic-link sign-in,
 * estimates/invoices/contracts in one place. A separate product face from both
 * marketing and the CRM. Kept in lockstep with server/site-context.ts
 * (CLIENT_PREFIX env).
 *
 * Local dev: ?client=1 or VITE_FORCE_CLIENT=true renders it on localhost
 * (takes precedence over the portal force flags).
 */
export function isClientPortal(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env?.VITE_FORCE_CLIENT === "true") return true;
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith("client.")) return true;
  try {
    return new URLSearchParams(window.location.search).get("client") === "1";
  } catch {
    return false;
  }
}

/** The CRM origin for the domain currently being browsed. */
export function portalUrl(path = "/"): string {
  if (typeof window === "undefined") return path;
  const host = window.location.hostname.toLowerCase();
  const prefix = CRM_HOST_PREFIXES.find((p) => host.startsWith(p));
  if (prefix) return path;
  return `${window.location.protocol}//${CRM_HOST_PREFIXES[0]}${host}${path}`;
}

/** The marketing origin for the domain currently being browsed. */
export function marketingUrl(path = "/"): string {
  if (typeof window === "undefined") return path;
  const host = window.location.hostname.toLowerCase();
  const prefix = CRM_HOST_PREFIXES.find((p) => host.startsWith(p));
  if (!prefix) return path;
  return `${window.location.protocol}//${host.slice(prefix.length)}${path}`;
}
