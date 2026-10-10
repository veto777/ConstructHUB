import * as cheerio from "cheerio";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";
import { politeText, PortalBlockedError } from "./polite-fetch";

type Row = Record<string, unknown>;
type Filter = { name: string; operator: string; entity: "Permit"; value: string | number };
type Bootstrap = { api: string; token: string; tenants: Row[] };
const bootstrapCache = new Map<string, { expires: number; value: Bootstrap }>();
const fieldNames = ["PermitNo", "LegalAddress", "LegalAddr", "PermitDate", "ApplicaDate1", "ExperationDate", "PermStatus", "PermitType", "ConstructionType", "Description", "PrintKey", "ConstCost", "ApplName"];
const string = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;

export function citysquaredTenant(searchUrl: string): { origin: string; tenant: string } {
  const url = new URL(searchUrl);
  const match = /^#\/app\/(?:map\/)?([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.hash);
  if (url.protocol !== "https:" || !/^(www\.)?citysquared\.com$/i.test(url.hostname) || url.port || url.username || url.password || !match || match[1] === "map") {
    throw new Error("Not a supported CitySquared municipality URL");
  }
  return { origin: url.origin, tenant: match[1] };
}
function serviceOrigin(value: unknown): string {
  if (typeof value !== "string") throw new Error("CitySquared service origin missing");
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^(?:services\d+\.)?municity5\.com$/i.test(url.hostname) || url.port || url.username || url.password || url.pathname !== "/") {
    throw new Error("Unrecognized CitySquared public service host");
  }
  return url.origin;
}
export function parseCitysquaredBootstrap(html: string, script: string): string {
  if (!html.includes("app-root")) throw new Error("CitySquared app shell not found");
  // This is the same anonymous service identifier embedded in the public web app,
  // not a user credential. Never log, persist, or manufacture a user token.
  const token = /ServiceToken\s*:\s*["']([a-f0-9-]{36})["']/i.exec(script)?.[1];
  if (!token) throw new Error("CitySquared anonymous service identifier not found in public bundle");
  return token;
}
function challenge(url: string, text: string): void {
  if (/cf-chl-|g-recaptcha|h-captcha|<title>\s*(?:Just a moment|Attention Required)|verify you are human/i.test(text)) {
    throw new PortalBlockedError(url, 403, "CitySquared public endpoint presents an anti-bot challenge");
  }
}
async function publicJson<T = unknown>(url: string, init: RequestInit | undefined, options: { minDelayMs: number }): Promise<T> {
  const body = await politeText(url, init, options);
  challenge(url, body);
  return JSON.parse(body) as T;
}
async function bootstrap(ctx: AdapterCtx, origin: string): Promise<Bootstrap> {
  const cached = bootstrapCache.get(origin);
  if (cached && cached.expires > Date.now()) return cached.value;
  const opts = { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) };
  const html = await politeText(`${origin}/`, undefined, opts);
  challenge(origin, html);
  const $ = cheerio.load(html);
  const src = $("script[src]").toArray().map(el => $(el).attr("src")!).find(src => /(?:^|\/)main\.[a-z0-9]+\.js(?:\?|$)/i.test(src));
  if (!src) throw new Error("CitySquared main bundle not found");
  const scriptUrl = new URL(src, `${origin}/`);
  if (scriptUrl.origin !== origin) throw new Error("CitySquared main bundle unexpectedly changed hosts");
  const settings = await publicJson<Row>(`${origin}/app.settings.json`, undefined, opts);
  const api = serviceOrigin(settings.ApiUrl);
  const script = await politeText(scriptUrl.href, undefined, opts);
  challenge(scriptUrl.href, script);
  const token = parseCitysquaredBootstrap(html, script);
  const tenants = await publicJson<unknown>(`${api}/M5Services/M5Service.svc/Service/3018/Tenants`, { headers: { SourceId: "2", Authorization: `Token ${token}` } }, opts);
  if (!Array.isArray(tenants) || !tenants.every(t => t && typeof t.TenantName === "string")) throw new Error("CitySquared tenant directory schema changed");
  const value = { api, token, tenants };
  bootstrapCache.set(origin, { expires: Date.now() + 60 * 60 * 1000, value });
  return value;
}

/** Limit projection to visible Permit columns returned by the tenant's PublicFields endpoint. */
export function citysquaredPublicFields(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error("Invalid CitySquared PublicFields response");
  const fields = new Set<string>();
  for (const group of value) {
    if (!group || typeof group !== "object" || !Array.isArray(group.ColumnInfo)) throw new Error("CitySquared public field group schema changed");
    if (group.IsPublic !== true) continue;
    for (const column of group.ColumnInfo) {
      if (column.Entity === "Permit" && column.IsVisible === true && fieldNames.includes(column.ColumnName)) fields.add(column.ColumnName);
    }
  }
  return fields;
}

export function citysquaredRequest(fields: Set<string>, filter: Filter | Filter[], afterId = 0, limit = 100): Row {
  const filters = Array.isArray(filter) ? filter : [filter];
  for (const item of filters) if (!fields.has(item.name)) throw new Error(`CitySquared tenant does not expose ${item.name} publicly`);
  if (!fields.has("PermitNo")) throw new Error("CitySquared tenant does not expose permit numbers publicly");
  return {
    base: "Permit", fields: [{ Permit: "Permit_ID" }, ...[...fields].map(name => ({ Permit: name }))],
    filters: [...filters, ...(afterId ? [{ name: "Permit_ID", operator: "greaterthan", entity: "Permit", value: afterId }] : [])],
    limit, sort: "Permit.Permit_ID", order: "asc", includeDeleted: false,
    fieldsToSearchBy: "", defaultSort: "", relationships: { Parents: [], Children: [], Siblings: [] },
  };
}

export function parseCitysquaredPage(value: unknown): { rows: Row[]; total: number } {
  if (!value || typeof value !== "object") throw new Error("Invalid CitySquared search response");
  const result = value as Row;
  if (!Array.isArray(result.Data) || !Number.isInteger(result.MaxRecordCount) || Number(result.MaxRecordCount) < result.Data.length || result.Count !== result.Data.length) {
    throw new Error("CitySquared response is not a successful paginated search");
  }
  let previous = 0;
  for (const row of result.Data) {
    if (!row || typeof row !== "object" || !Number.isInteger(row.Permit_ID) || row.Permit_ID <= previous) throw new Error("CitySquared permit rows are missing IDs or not ordered");
    previous = row.Permit_ID;
  }
  return { rows: result.Data, total: Number(result.MaxRecordCount) };
}

export function citysquaredDate(value: unknown): string | null {
  const input = string(value);
  const date = input && /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(input)?.[1];
  if (!date || date < "1700-01-01") return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}
export function parseCitysquaredRecord(row: Row, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction" | "searchUrl">): PermitRecord | null {
  const permitNumber = string(row.PermitNo);
  if (!permitNumber) return null; // Real legacy rows can have no issued permit number.
  const { origin, tenant } = citysquaredTenant(ctx.searchUrl);
  const cost = typeof row.ConstCost === "number" ? row.ConstCost : string(row.ConstCost)?.replace(/[$,]/g, "");
  return {
    permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
    address: string(row.LegalAddress) ?? string(row.LegalAddr), parcel: string(row.PrintKey), lat: null, lng: null,
    permitType: string(row.PermitType), workClass: string(row.ConstructionType), description: string(row.Description), status: string(row.PermStatus),
    issuedAt: citysquaredDate(row.PermitDate), appliedAt: citysquaredDate(row.ApplicaDate1), expiresAt: citysquaredDate(row.ExperationDate),
    valuation: cost !== null && cost !== undefined && cost !== "" && Number.isFinite(Number(cost)) ? Number(cost) : null,
    contractorName: null, contractorLicense: null, applicantName: string(row.ApplName), ownerName: null,
    sourceUrl: Number.isInteger(row.Permit_ID) ? `${origin}/#/app/${tenant}/entity/Permit/${row.Permit_ID}` : null,
    raw: row,
  };
}

type Session = { endpoint: string; headers: Record<string, string>; fields: Set<string> };
async function session(ctx: AdapterCtx): Promise<Session> {
  const { origin, tenant } = citysquaredTenant(ctx.searchUrl);
  const info = await bootstrap(ctx, origin);
  const entry = info.tenants.find(t => String(t.TenantName).toLowerCase() === tenant.toLowerCase());
  if (!entry) throw new Error("CitySquared municipality missing from public tenant directory");
  const api = entry.M5ServicesUrl ? serviceOrigin(entry.M5ServicesUrl) : info.api;
  const endpoint = `${api}/M5Services/M5Service.svc/Customer/${encodeURIComponent(String(entry.TenantName))}`;
  const headers = { Authorization: `Token ${info.token}`, SourceId: "2", "Content-Type": "application/json", Referer: `${origin}/` };
  const opts = { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) };
  const profile = await publicJson<Row>(`${endpoint}/PublicProfile`, { headers }, opts);
  if (profile.M5_Permits !== true) throw new PortalBlockedError(endpoint, 401, "CitySquared municipality does not expose permits to the public profile");
  const fields = citysquaredPublicFields(await publicJson(`${endpoint}/PublicFields?entity=Permit`, { headers }, opts));
  if (!fields.has("PermitNo")) throw new Error("CitySquared municipality has no supported public permit fields");
  return { endpoint, headers, fields };
}
export async function queryCitysquared(ctx: AdapterCtx, state: Session, filter: Filter | Filter[]): Promise<PermitRecord[]> {
  const results: PermitRecord[] = [];
  let afterId = 0;
  for (let page = 0; page < 100; page++) {
    const body = citysquaredRequest(state.fields, filter, afterId);
    const value = await publicJson(`${state.endpoint}/FilteredSearch`, { method: "POST", headers: state.headers, body: JSON.stringify(body) }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    const { rows, total } = parseCitysquaredPage(value);
    if (rows.length === 0 && total !== 0) throw new Error("CitySquared returned an incomplete page");
    for (const row of rows) {
      const id = Number(row.Permit_ID);
      if (id <= afterId) throw new Error("CitySquared pagination did not advance");
      afterId = id;
      const record = parseCitysquaredRecord(row, ctx);
      if (record) results.push(record);
      else ctx.log(`CitySquared skipped public legacy permit ID ${id}: no permit number`);
    }
    if (rows.length >= total) return results;
  }
  throw new Error("CitySquared search exceeded 100 pages; narrow the query");
}
export async function listRecentCitysquared(ctx: AdapterCtx, state: Session, since: string): Promise<PermitRecord[]> {
    const date = citysquaredDate(since);
    if (!date || !Number.isFinite(Date.parse(since))) throw new Error("CitySquared listRecent requires a valid ISO date");
    const dates = ["PermitDate", "ApplicaDate1"].filter(field => state.fields.has(field));
    if (!dates.length) throw new Error("CitySquared tenant exposes no issued/applied date fields");
    const results = new Map<unknown, PermitRecord>();
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const until = tomorrow.toISOString().slice(0, 10);
    if (date >= until) return [];
    for (const name of dates) {
      const records = await queryCitysquared(ctx, state, [
        { name, operator: "greaterthanorequals", entity: "Permit", value: date },
        { name, operator: "lessthan", entity: "Permit", value: until },
      ]);
      for (const record of records) {
        const actual = name === "PermitDate" ? record.issuedAt : record.appliedAt;
        if (!actual || actual < date || actual >= until) throw new Error("CitySquared server did not honor the date filter");
        results.set(record.raw?.Permit_ID, record);
      }
    }
    return [...results.values()];
}
const adapter: PortalAdapter = {
  platform: "CitySquared",
  aliases: ["CitySquared (Online Permitting Center)", "CitySquared (permit information by property)", "CitySquared (Online Building Permit Center)"],
  capabilities: { search: ["address", "permit", "name"], listRecent: true, detail: true },
  async search(ctx, q) {
    const fields: Partial<Record<PermitSearchType, string>> = { address: "LegalAddress", permit: "PermitNo", name: "ApplName" };
    const name = fields[q.type];
    if (!name || !q.value.trim()) throw new Error(`Unsupported or empty CitySquared ${q.type} search`);
    const state = await session(ctx);
    const field = name === "LegalAddress" && !state.fields.has(name) ? "LegalAddr" : name;
    return queryCitysquared(ctx, state, { name: field, operator: "like", entity: "Permit", value: q.value.trim() });
  },
  async listRecent(ctx, since) {
    if (!citysquaredDate(since) || !Number.isFinite(Date.parse(since))) throw new Error("CitySquared listRecent requires a valid ISO date");
    return listRecentCitysquared(ctx, await session(ctx), since);
  },
  async detail(ctx, permitNumber) {
    if (!permitNumber.trim()) throw new Error("CitySquared detail requires a permit number");
    const results = await queryCitysquared(ctx, await session(ctx), { name: "PermitNo", operator: "equals", entity: "Permit", value: permitNumber.trim() });
    if (results.length > 1) throw new Error("CitySquared permit number is ambiguous");
    return results[0] ?? null;
  },
};
export default adapter;
