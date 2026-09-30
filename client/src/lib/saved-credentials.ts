/**
 * API keys, tokens and account sign-ins an account has saved so ConstructHUB
 * can work with another service for it. Each source is a read-only list plus a
 * disconnect route that answer WITHOUT the module's plan, so a saved credential
 * always stays removable (server/ads/routes.ts, server/cloudflare/routes.ts,
 * server/mail-alerts/gmail.ts; registrar keys in server/domains/routes.ts).
 * Every disconnect asks for a recent sign-in (step-up re-auth, handled by
 * apiRequest). Used by Settings → API keys and the plan_required card.
 */
import type { ModuleKey } from "@shared/plans";

export type SavedCredential = {
  /** Unique across every source. */
  key: string;
  /** "Cloudflare", "Porkbun", … */
  service: string;
  /** What identifies this one: an email, a label, a manager account ID. */
  label: string;
  /** What kind of secret ConstructHUB holds for it. */
  kind: "API key" | "API token" | "Google sign-in";
  disconnect: { url: string; body: unknown };
};

export type CredentialSource = {
  /** GET list route (also the react-query key). */
  url: string;
  module: ModuleKey;
  /** The page where these are added and used. */
  manageHref: string;
  manageLabel: string;
  /** What this source holds, for sentences ("Nothing is saved for Cloudflare, …"). */
  serviceName: string;
  items: (data: any) => SavedCredential[];
  /**
   * The server may not offer this list yet (a 404, the plan gate's 402, or the
   * SPA's HTML fallback): the source is then left out instead of reported as an error.
   */
  optional?: boolean;
};

const REGISTRAR_NAMES: Record<string, string> = { porkbun: "Porkbun", namecom: "Name.com" };

export const CREDENTIAL_SOURCES: CredentialSource[] = [
  {
    url: "/api/domains/saved-connections",
    module: "domainsMailAlerts",
    manageHref: "/domains",
    manageLabel: "Domains",
    serviceName: "registrar API keys (Porkbun, Name.com)",
    optional: true,
    items: (d) =>
      (d?.items ?? []).map((c: any) => ({
        key: `registrar-${c.id}`,
        service: REGISTRAR_NAMES[c.provider] ?? String(c.provider ?? "Registrar"),
        label: String(c.label ?? ""),
        kind: "API key" as const,
        disconnect: { url: "/api/domains/disconnect", body: { ids: [c.id] } },
      })),
  },
  ...(["cloudflare", "gsc"] as const).map((provider): CredentialSource => ({
    url: `/api/${provider}/saved-connections`,
    module: "cloudflareSearchConsole",
    manageHref: provider === "gsc" ? "/search-console" : "/cloudflare",
    manageLabel: provider === "gsc" ? "Search Console" : "Cloudflare",
    serviceName: provider === "gsc" ? "Search Console" : "Cloudflare",
    items: (d) =>
      (d?.items ?? []).map((c: any) => ({
        key: `${provider}-${c.id}`,
        service: provider === "gsc" ? "Search Console" : "Cloudflare",
        label: String(c.label ?? ""),
        kind: provider === "gsc" ? "Google sign-in" as const : "API token" as const,
        disconnect: { url: `/api/${provider}/disconnect`, body: { ids: [c.id] } },
      })),
  })),
  {
    url: "/api/ads/saved-connection",
    module: "adsManager",
    manageHref: "/ads-manager",
    manageLabel: "Agency Ads & LSA",
    serviceName: "Google Ads",
    items: (d) =>
      d?.saved
        ? [{
            key: "ads",
            service: "Google Ads",
            label: d.managerId ? `Manager account ${d.managerId}` : "Manager account",
            kind: "Google sign-in" as const,
            disconnect: { url: "/api/ads/disconnect", body: { confirm: true } },
          }]
        : [],
  },
  {
    url: "/api/mail-alerts/oauth/saved-connections",
    module: "domainsMailAlerts",
    manageHref: "/mail-alerts",
    manageLabel: "Mail alerts",
    serviceName: "Gmail",
    items: (d) =>
      (d?.items ?? []).map((g: any) => ({
        key: `gmail-${g.subject}`,
        service: "Gmail",
        label: String(g.email ?? ""),
        kind: "Google sign-in" as const,
        disconnect: { url: "/api/mail-alerts/oauth/disconnect", body: { subject: g.subject } },
      })),
  },
];

/** Query function for an optional list: null when the server doesn't offer it (yet). */
export async function fetchOptionalList(url: string): Promise<unknown | null> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.status === 404 || res.status === 402 || (res.ok && !json)) return null;
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  return res.json();
}

/** The server's confirmation for a disconnect ({ message } or { results: [{ message }] }). */
export function disconnectMessage(response: any): string {
  return response?.message ?? response?.results?.[0]?.message ?? "Disconnected.";
}
