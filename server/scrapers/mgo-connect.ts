import type { PortalAdapter } from "./types";
import { politeJson, PortalBlockedError } from "./polite-fetch";

/** No tenant guessing for shared home/login URLs. */
export function mgoJurisdiction(value: string): number {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || !["mgoconnect.org", "www.mgoconnect.org", "mygovernmentonline.org", "www.mygovernmentonline.org", "www.mypermitnow.org", "mypermitnow.org"].includes(url.hostname) || url.port || url.username || url.password) {
    throw new Error("URL is not a MyGovernmentOnline / MGO Connect portal");
  }
  if (!/^(www\.)?mgoconnect\.org$/.test(url.hostname) || !/^\/cp(?:\/|$)/.test(url.pathname)) {
    throw new Error("MGO legacy/login URL has no supported anonymous tenant search");
  }
  const ids = [...url.searchParams].filter(([k]) => k.toUpperCase() === "JID").map(([, v]) => v);
  if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0]) || !Number.isSafeInteger(Number(ids[0]))) {
    throw new Error("MGO Connect URL must contain one numeric JID; shared portal URLs do not identify a jurisdiction");
  }
  return Number(ids[0]);
}

type Menu = { item: { link: string; isLoginRequired: boolean; isActive: boolean }; children: Menu[] };
export function mgoSearchRequiresLogin(value: unknown): boolean {
  if (!Array.isArray(value)) throw new Error("MGO returned an invalid public jurisdiction menu");
  const found: boolean[] = [];
  function visit(rows: unknown[]): void {
    for (const raw of rows) {
      const row = raw as Menu;
      if (!row?.item || typeof row.item.link !== "string" || typeof row.item.isLoginRequired !== "boolean" || !Array.isArray(row.children)) {
        throw new Error("MGO returned an invalid public jurisdiction menu entry");
      }
      if (row.item.isActive && row.item.link === "databind:UI.navigation.search") found.push(row.item.isLoginRequired);
      visit(row.children);
    }
  }
  visit(value);
  if (!found.length) throw new Error("MGO jurisdiction menu does not expose permit search");
  return found.every(Boolean);
}

// A diagnostic adapter, deliberately not advertised as a working scraper. All
// three surveyed tenants require login. Never turn that failure into no results.
const adapter: PortalAdapter = {
  platform: "MGO Connect", aliases: ["MyGovernmentOnline (MGO Connect)", "MyGovernmentOnline (MGO)"],
  capabilities: { search: [], listRecent: false, detail: false },
  async search(ctx) {
    const jid = mgoJurisdiction(ctx.searchUrl);
    const url = `https://api.mgoconnect.org/cp/GetJurisdictionMenu/${jid}`;
    const menu = await politeJson(url, {}, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    if (mgoSearchRequiresLogin(menu)) {
      throw new PortalBlockedError(ctx.searchUrl, 401, `MGO Connect jurisdiction ${jid} marks public permit search as login-required; anonymous scraping unavailable`);
    }
    throw new Error("MGO menu allows guest search, but its anonymous record API has not been verified; adapter support is unavailable");
  },
  async listRecent(ctx) {
    mgoJurisdiction(ctx.searchUrl);
    ctx.log("MGO Connect anonymous date listing is unverified/login-gated; recent permits unsupported");
    return [];
  },
};
export default adapter;
