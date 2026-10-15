/**
 * Guest calls to a Salesforce Experience Cloud site's own Apex controllers: the same requests its public search
 * page makes for an anonymous visitor (no login, no token: `aura.token=null`). Used by the Arizona Registrar of
 * Contractors search (azroc.my.site.com), checked live 2026-10-15; that site's robots.txt allows every path we use.
 *
 * The page's framework id (fwuid) and app version change with each Salesforce release, so they are read from the
 * public page itself and re-read once if the site answers that the client is out of date.
 */
import { politeFetch } from "../../http";

export type AuraSite = { origin: string; /** A public page of the site, e.g. "/AZRoc/s/contractor-search". */ page: string };

type Ctx = { fwuid: string; app: string; at: number };
const contexts = new Map<string, Ctx>();
const CTX_TTL = 3 * 3600_000;

/** fwuid + the loaded app version, as embedded (URL-encoded) in the page's bootstrap links. */
export function auraContextOf(html: string): { fwuid: string; app: string } | null {
  let dec = html;
  try { dec = decodeURIComponent(html.replace(/%(?![0-9A-Fa-f]{2})/g, "%25")); } catch { /* keep raw */ }
  const fwuid = dec.match(/"fwuid":"([^"]+)"/)?.[1];
  const app = dec.match(/"APPLICATION@markup:\/\/siteforce:communityApp":"([^"]+)"/)?.[1];
  return fwuid && app ? { fwuid, app } : null;
}

async function context(site: AuraSite, fresh = false): Promise<Ctx> {
  const key = site.origin + site.page;
  const have = contexts.get(key);
  if (have && !fresh && Date.now() - have.at < CTX_TTL) return have;
  const res = await politeFetch(site.origin + site.page, {}, { minDelayMs: 1000 });
  if (!res.ok) throw new Error(`${new URL(site.origin).host} returned HTTP ${res.status}`);
  const ctx = auraContextOf(await res.text());
  if (!ctx) throw new Error(`${new URL(site.origin).host}: the search page changed (no framework id)`);
  const out = { ...ctx, at: Date.now() };
  contexts.set(key, out);
  return out;
}

/** One Apex action, as the page's own component calls it. Returns the action's returnValue. */
export async function auraApex<T = unknown>(site: AuraSite, descriptor: string, params: Record<string, unknown>, retried = false): Promise<T> {
  const ctx = await context(site, retried);
  const prefix = site.page.match(/^(\/[^/]+)\/s\//)?.[1] ?? "";
  const body = new URLSearchParams({
    message: JSON.stringify({ actions: [{ id: "1;a", descriptor, callingDescriptor: "UNKNOWN", params }] }),
    "aura.context": JSON.stringify({ mode: "PROD", fwuid: ctx.fwuid, app: "siteforce:communityApp", loaded: { "APPLICATION@markup://siteforce:communityApp": ctx.app }, dn: [], globals: {}, uad: true }),
    "aura.pageURI": site.page,
    "aura.token": "null",
  });
  const res = await politeFetch(`${site.origin}${prefix}/s/sfsites/aura?r=1&aura.ApexAction.execute=1`, {
    method: "POST", body: body.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", accept: "application/json" },
  }, { minDelayMs: 1000 });
  const text = (await res.text()).replace(/^while\(1\);\s*/, "");
  if (/clientOutOfSync|markup:\/\/aura:invalidSession/.test(text) && !retried) return auraApex<T>(site, descriptor, params, true);
  if (!res.ok) throw new Error(`${new URL(site.origin).host} returned HTTP ${res.status}`);
  let data: any;
  try { data = JSON.parse(text.replace(/^\*\/|\/\*-secure-\s*|\s*\*\/$/g, "")); } catch { throw new Error(`${new URL(site.origin).host} returned an unexpected payload`); }
  const action = data?.actions?.[0];
  if (action?.state !== "SUCCESS") throw new Error(`${new URL(site.origin).host}: ${String(action?.error?.[0]?.message ?? action?.state ?? "no answer").slice(0, 160)}`);
  return action.returnValue as T;
}
