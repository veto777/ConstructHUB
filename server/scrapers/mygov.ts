import type { AdapterCtx, PermitRecord, PortalAdapter } from "./types";
import { politeFetch, PortalBlockedError } from "./polite-fetch";

/** Only the current public portal has a verified anonymous lookup API. */
export function myGovTenant(value: string): string {
  const url = new URL(value);
  const match = /^\/([a-z0-9_]+)(?:\/(?:lookup|module|templates))?\/?$/i.exec(url.pathname);
  if (!/^https?:$/.test(url.protocol) || url.hostname !== "public.mygov.us" || url.port || url.username || url.password || !match) {
    throw new Error("Unsupported MyGov URL: expected public.mygov.us/<tenant> (legacy app/login URLs are not searchable)");
  }
  return `https://public.mygov.us/${match[1]}`;
}

type Row = Record<string, unknown>;
function object(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
export function parseMyGovLocations(value: unknown): { address: string; location_id: number }[] {
  if (!Array.isArray(value) || value.some(r => !object(r) || typeof r.address !== "string" || typeof r.location_id !== "number" || !Number.isSafeInteger(r.location_id) || r.location_id <= 0)) {
    throw new Error("MyGov lookup response is not a location array");
  }
  return value;
}
export function parseMyGovModules(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(r => !object(r) || typeof r.module !== "string" || typeof r.total_projects !== "number" || !Number.isSafeInteger(r.total_projects) || r.total_projects < 0)) {
    throw new Error("MyGov response is not a public module list");
  }
  return value;
}
export function parseMyGovProjects(value: unknown, address: string, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">): PermitRecord[] {
  if (!object(value) || !Array.isArray(value.projects)) throw new Error("MyGov response is not a project list");
  return value.projects.map((row: unknown) => {
    if (!object(row) || row.module !== "pi" || !str(row.code_id)) throw new Error("MyGov permit row has no permit number or incorrect module");
    return {
      permitNumber: str(row.code_id)!, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
      address, parcel: null, lat: null, lng: null, permitType: str(row.title), workClass: null,
      description: str(row.description), status: str(row.status_title),
      // date_created is project creation, not a verified application/issue date.
      issuedAt: null, appliedAt: null, expiresAt: null, valuation: null,
      contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
      // The accordion has no record-specific URL; do not invent a deep link.
      sourceUrl: null, raw: row,
    };
  });
}

export function assertMyGovPage(html: string, url: string): void {
  if (/captcha|cf-chl-|cf-turnstile|verify you are human|access denied/i.test(html)) {
    throw new PortalBlockedError(url, 403, "MyGov public portal presented an access challenge");
  }
  if (!/MG\.iCityId\s*=\s*[1-9]\d*/.test(html) || !/id=["']address-lookup["']/.test(html)) {
    throw new Error("MyGov tenant does not expose the expected public address lookup");
  }
}

async function searchAddress(ctx: AdapterCtx, value: string): Promise<PermitRecord[]> {
  const base = myGovTenant(ctx.searchUrl);
  if (value.trim().length < 3) throw new Error("MyGov address lookup requires at least three characters");
  const cookies = new Map<string, string>();
  const options = { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) };
  async function request(url: string, body?: URLSearchParams): Promise<string> {
    const headers = new Headers({ Accept: body ? "application/json" : "text/html" });
    if (cookies.size) headers.set("Cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    if (body) headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
    const response = await politeFetch(url, { method: body ? "POST" : "GET", headers, body, redirect: "manual" }, options);
    if (!response.ok) throw new Error(`MyGov HTTP ${response.status} at ${url}`);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    if (/captcha|cf-chl-|cf-turnstile|verify you are human|access denied/i.test(text)) {
      throw new PortalBlockedError(url, 403, "MyGov public portal presented an access challenge");
    }
    return text;
  }
  async function post(path: string, fields: Record<string, string>): Promise<unknown> {
    const text = await request(path, new URLSearchParams(fields));
    try { return JSON.parse(text); } catch { throw new Error(`MyGov returned non-JSON at ${path}`); }
  }
  assertMyGovPage(await request(`${base}/lookup`), `${base}/lookup`);
  const locations = parseMyGovLocations(await post(`${base}/getLookupResults`, { address_search: value.trim() }));
  if (locations.length > 50) throw new Error(`MyGov matched ${locations.length} locations; use a more specific address (maximum 50)`);
  const results: PermitRecord[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    const fields = { location_id: String(location.location_id) };
    const modules = parseMyGovModules(await post("https://public.mygov.us/oac/home/getLocationModules", fields));
    const permits = modules.find(m => m.module === "pi");
    if (!permits || permits.total_projects === 0) continue;
    const records = parseMyGovProjects(await post("https://public.mygov.us/oac/home/getLocationModuleProjects", { ...fields, module: "pi" }), location.address, ctx);
    if (records.length !== permits.total_projects) throw new Error("MyGov project count changed or the public result is incomplete; retry search");
    for (const record of records) {
      const key = `${record.raw?.id}:${record.address}`;
      if (!seen.has(key)) { seen.add(key); results.push(record); }
    }
  }
  return results;
}

const adapter: PortalAdapter = {
  platform: "MyGov", aliases: ["MyGov Permits & Licenses", "MyGov public portal", "MyGov permits"],
  capabilities: { search: ["address"], listRecent: false, detail: false },
  async search(ctx, q) {
    myGovTenant(ctx.searchUrl);
    if (q.type !== "address") throw new Error(`MyGov public lookup does not support ${q.type} search; only address is verified`);
    return searchAddress(ctx, q.value);
  },
  async listRecent(ctx) {
    myGovTenant(ctx.searchUrl);
    ctx.log("MyGov public address lookup has no verified date-listing API; recent permits unsupported");
    return [];
  },
};
export default adapter;
