/**
 * GET /api/account/integrations — one row per connectable service, read from
 * the tables each module already keeps (nothing is probed live here):
 *
 *   google_business  gbp_grants                      (Google accounts linked for Business Profile)
 *   google_ads       ads_grants + ads_accounts        (Google Ads manager account)
 *   cloudflare       edge_connections + edge_assets   (provider='cloudflare')
 *   search_console   edge_connections + edge_assets   (provider='gsc')
 *   blotato          social_connections               (social media publishing)
 *   registrars       domain_connections + managed_domains
 *   gmail_alerts     mail_alert_grants + mail_alert_addresses
 *
 * Status is only what the stored rows say: `reconnect` when the module itself
 * flagged the grant (reconnect_required / needs_reconnect / an expired Google
 * token with no refresh token), `connected` when a grant or connection row
 * exists, otherwise `not_connected`. Agency-only services say which plan
 * includes them when the account's plan does not.
 *
 * Shape: { items: [{ id, service, status: connected|not_connected|reconnect, detail, manageHref }] }
 */
import type { Express, NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { fromNativeApp } from "../app-shell";
import { getEntitlements, textingNumbersAllowance } from "../entitlements";
import { ADDONS, PLANS, UNLIMITED, planForModule, type ModuleKey, type PlanModules } from "@shared/plans";

export type IntegrationStatus = "connected" | "not_connected" | "reconnect";
export type IntegrationItem = { id: string; service: string; status: IntegrationStatus; detail: string; manageHref: string };

/** "a@x.test" / "a@x.test and b@y.test" / "a@x.test, b@y.test and 2 more". */
export function listNames(names: string[], max = 2): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (!shown.length) return "";
  if (!rest) return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${shown.join(", ")} and ${rest} more`;
}
const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** A missing module table (schema not ensured yet) means nothing is connected there; any other error is real. */
async function rowsOf<T extends Record<string, any>>(sql: string, params: unknown[]): Promise<T[]> {
  try { return (await pool.query<T>(sql, params)).rows; }
  catch (e: any) { if (e?.code === "42P01") return []; throw e; }
}

type Builder = (userId: number, modules: PlanModules) => Promise<IntegrationItem>;

/** The upgrade note for an Agency-only service the plan does not include. */
const includedWith = (module: ModuleKey) => `Included with the ${PLANS[planForModule(module)].name} plan.`;

const googleBusiness: Builder = async (userId) => {
  const grants = await rowsOf<{ email: string; reconnect_required: boolean }>("SELECT email, reconnect_required FROM gbp_grants WHERE user_id=$1 ORDER BY email", [userId]);
  const item = { id: "google_business", service: "Google Business Profile", manageHref: "/google-business" };
  if (!grants.length) return { ...item, status: "not_connected", detail: "No Google account connected." };
  const stale = grants.filter((g) => g.reconnect_required).map((g) => g.email);
  if (stale.length) return { ...item, status: "reconnect", detail: `${listNames(stale)} ${stale.length === 1 ? "needs" : "need"} to be reconnected.` };
  return { ...item, status: "connected", detail: grants.length === 1 ? `Connected as ${grants[0].email}.` : `${n(grants.length, "Google account")}: ${listNames(grants.map((g) => g.email))}.` };
};

const googleAds: Builder = async (userId, modules) => {
  const [grant] = await rowsOf<{ manager_id: string; reconnect_required: boolean; verified: boolean }>("SELECT manager_id, reconnect_required, verified FROM ads_grants WHERE user_id=$1", [userId]);
  const item = { id: "google_ads", service: "Google Ads manager", manageHref: "/ads-manager" };
  if (!grant) return { ...item, status: "not_connected", detail: modules.adsManager ? "No Google Ads manager account connected." : includedWith("adsManager") };
  if (grant.reconnect_required) return { ...item, status: "reconnect", detail: `Manager account ${grant.manager_id} needs to be reconnected.` };
  const [{ c }] = await rowsOf<{ c: number }>("SELECT count(*)::int c FROM ads_accounts WHERE user_id=$1 AND NOT manager", [userId]).then((r) => (r.length ? r : [{ c: 0 }]));
  return { ...item, status: "connected", detail: `Manager account ${grant.manager_id}${grant.verified ? "" : " (not yet verified)"} · ${n(c, "client account")}.` };
};

/** Cloudflare and Search Console share edge_connections; a Google token that expired with no refresh token cannot renew itself. */
function edgeBuilder(provider: "cloudflare" | "gsc", id: string, service: string, manageHref: string, assetNoun: string): Builder {
  return async (userId, modules) => {
    const conns = await rowsOf<{ label: string; expired_no_refresh: boolean }>(
      "SELECT COALESCE(email, token_name, subject) AS label, (expires_at IS NOT NULL AND expires_at < now() AND refresh_token IS NULL) AS expired_no_refresh FROM edge_connections WHERE user_id=$1 AND provider=$2 ORDER BY id",
      [userId, provider]);
    const item = { id, service, manageHref };
    if (!conns.length) return { ...item, status: "not_connected", detail: modules.cloudflareSearchConsole ? `No ${service} connection.` : includedWith("cloudflareSearchConsole") };
    const stale = conns.filter((c) => c.expired_no_refresh).map((c) => c.label);
    if (stale.length) return { ...item, status: "reconnect", detail: `${listNames(stale)} ${stale.length === 1 ? "needs" : "need"} to be reconnected.` };
    const [assets] = await rowsOf<{ total: number; removed: number }>(
      "SELECT count(*)::int total, count(*) FILTER (WHERE status='access_removed')::int removed FROM edge_assets WHERE user_id=$1 AND provider=$2", [userId, provider]);
    const total = assets?.total ?? 0, removed = assets?.removed ?? 0;
    return {
      ...item, status: "connected",
      detail: `${n(conns.length, "connection")} (${listNames(conns.map((c) => c.label))}) · ${n(total, assetNoun)}${removed ? ` (${removed} access removed)` : ""}.`,
    };
  };
}

const blotato: Builder = async (userId) => {
  const conns = await rowsOf<{ business_id: number | null; accounts: number }>(
    "SELECT business_id, CASE WHEN jsonb_typeof(accounts)='array' THEN jsonb_array_length(accounts) ELSE 0 END AS accounts FROM social_connections WHERE user_id=$1 ORDER BY business_id NULLS FIRST", [userId]);
  const item = { id: "blotato", service: "Blotato (social media)", manageHref: "/social-media" };
  if (!conns.length) return { ...item, status: "not_connected", detail: "No Blotato API key connected." };
  const accounts = conns.reduce((s, c) => s + c.accounts, 0);
  const scoped = conns.filter((c) => c.business_id != null).length;
  return { ...item, status: "connected", detail: `${n(accounts, "social account")} linked · ${conns.some((c) => c.business_id == null) ? "agency-wide key" : "per-business keys"}${scoped ? ` · ${n(scoped, "business")} with ${scoped === 1 ? "its" : "their"} own key` : ""}.` };
};

const registrars: Builder = async (userId, modules) => {
  const conns = await rowsOf<{ provider: string; label: string }>("SELECT provider, label FROM domain_connections WHERE user_id=$1 ORDER BY id", [userId]);
  const [domains] = await rowsOf<{ c: number }>("SELECT count(*)::int c FROM managed_domains WHERE user_id=$1", [userId]);
  const item = { id: "registrars", service: "Domain registrars", manageHref: "/domains" };
  const monitored = domains?.c ?? 0;
  if (!conns.length) {
    return { ...item, status: "not_connected", detail: !modules.domainsMailAlerts ? includedWith("domainsMailAlerts") : monitored ? `No registrar API key; ${n(monitored, "domain")} monitored manually.` : "No registrar API key connected." };
  }
  return { ...item, status: "connected", detail: `${listNames(conns.map((c) => `${c.provider}: ${c.label}`))} · ${n(monitored, "domain")} monitored.` };
};

const gmailAlerts: Builder = async (userId, modules) => {
  const grants = await rowsOf<{ email: string; needs_reconnect: boolean }>("SELECT email, needs_reconnect FROM mail_alert_grants WHERE user_id=$1 ORDER BY email", [userId]);
  const [address] = await rowsOf<{ one: number }>("SELECT 1 AS one FROM mail_alert_addresses WHERE user_id=$1", [userId]);
  const item = { id: "gmail_alerts", service: "Gmail alert forwarding", manageHref: "/mail-alerts" };
  if (!grants.length) {
    if (!modules.domainsMailAlerts && !address) return { ...item, status: "not_connected", detail: includedWith("domainsMailAlerts") };
    return address
      ? { ...item, status: "connected", detail: "Forwarding address set; no Gmail account connected." }
      : { ...item, status: "not_connected", detail: "No Gmail account connected and no forwarding address yet." };
  }
  const stale = grants.filter((g) => g.needs_reconnect).map((g) => g.email);
  if (stale.length) return { ...item, status: "reconnect", detail: `${listNames(stale)} ${stale.length === 1 ? "needs" : "need"} to be reconnected.` };
  return { ...item, status: "connected", detail: `${grants.length === 1 ? `Reading ${grants[0].email}` : `Reading ${n(grants.length, "Gmail account")}: ${listNames(grants.map((g) => g.email))}`}${address ? " · forwarding address set" : ""}.` };
};

/** Client texting on our carrier: dedicated numbers in use against the plan's included count (textingNumbersIncluded) plus texting_number add-ons. */
const clientTexting: Builder = async (userId) => {
  const [row] = await rowsOf<{ n: number }>(
    `SELECT count(DISTINCT custom_fields->'sms'->>'fromNumber')::int n FROM crm_orgs
      WHERE owner_user_id=$1 AND custom_fields->'sms'->>'mode'='dedicated' AND custom_fields->'sms'->>'fromNumber' IS NOT NULL`, [userId]);
  const used = row?.n ?? 0;
  const ent = await getEntitlements(userId);
  const allowance = textingNumbersAllowance(ent);
  const item = { id: "client_texting", service: "Client texting", manageHref: "/crm/settings" };
  if (allowance === 0) {
    return { ...item, status: "not_connected", detail: `No number on our carrier yet — add the ${ADDONS.texting_number.name} add-on, or move to the ${PLANS[planForModule("agencyWorkspace")].name} plan, which includes one.` };
  }
  if (!used) {
    return { ...item, status: "not_connected", detail: allowance === UNLIMITED ? "No dedicated number assigned yet." : `${allowance === 1 ? "One number" : `${allowance} numbers`} included with your plan; none assigned yet.` };
  }
  return { ...item, status: "connected", detail: allowance === UNLIMITED ? `${n(used, "dedicated number")} on our carrier.` : `${n(used, "dedicated number")} on our carrier · ${allowance} included with your plan.` };
};

/** Display order. */
export const INTEGRATION_BUILDERS: readonly Builder[] = [
  googleBusiness,
  googleAds,
  edgeBuilder("cloudflare", "cloudflare", "Cloudflare", "/cloudflare", "zone"),
  edgeBuilder("gsc", "search_console", "Google Search Console", "/search-console", "property"),
  blotato,
  registrars,
  gmailAlerts,
  clientTexting,
];

export async function integrationItems(userId: number): Promise<IntegrationItem[]> {
  const { modules } = await getEntitlements(userId);
  return Promise.all(INTEGRATION_BUILDERS.map((build) => build(userId, modules)));
}

export function registerIntegrationsRoute(app: Express, auth: (req: any, res: any) => any) {
  app.get("/api/account/integrations", (req: Request, res: Response, next: NextFunction) => {
    const u = auth(req, res); if (!u) return;
    integrationItems(u.id)
      .then((items) => {
        res.setHeader("Cache-Control", "no-store");
        // The iPhone apps sell nothing (App Store 3.1.3(f)): no plan names there — the same words as AppLocked.
        const app = fromNativeApp(req);
        res.json({ items: app ? items.map((i) => (i.detail && /^Included with the .+ plan\.$/.test(i.detail) ? { ...i, detail: "Not on this account." } : i)) : items });
      })
      .catch(next);
  });
}
