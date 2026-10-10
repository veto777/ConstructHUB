import * as cheerio from "cheerio";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";
import { politeFetch, PortalBlockedError } from "./polite-fetch";

export function permitEyesPublicUrl(input: string): string {
  const u = new URL(input);
  if (u.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)?permiteyes\.us$/i.test(u.hostname) || u.username || u.password) {
    throw new Error("Unsupported PermitEyes portal: expected the public PHP layout on permiteyes.us");
  }
  if (!/^\/[a-z0-9_-]+\/(?:[a-z0-9_-]+\.php)?$/i.test(u.pathname)) throw new Error("Unsupported PermitEyes tenant path");
  const file = u.pathname.split("/").pop()!;
  if (!/publicview\.php$/i.test(file)) u.pathname = u.pathname.replace(/[^/]*$/, "publicview.php");
  u.search = ""; u.hash = "";
  return u.href;
}

export type PermitEyesLayout = { endpoint: string; headers: string[]; address: number; permit: number; name: number; applied: number; issued: number; status: number; description: number; type: number };
const text = (s: string): string => cheerio.load(s).text().replace(/\s+/g, " ").trim();
export function permitEyesDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year < 70 ? 2000 : 1900;
  const iso = `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function parsePermitEyesLayout(html: string, pageUrl: string): PermitEyesLayout {
  if (/captcha|cf-chl-|verify you are human/i.test(html)) throw new PortalBlockedError(pageUrl, 403, "PermitEyes challenge");
  const $ = cheerio.load(html);
  const table = $("#BuildingPublicHome").length ? $("#BuildingPublicHome") : $("#PublicHome");
  if (!table.length) {
    if ($('input[type="password"]').length) throw new PortalBlockedError(pageUrl, 401, "PermitEyes public lookup requires login");
    throw new Error("Unrecognized PermitEyes public table");
  }
  const headers = table.find("thead tr").first().find("th").map((_, e) => $(e).text().trim()).get();
  const index = (re: RegExp) => headers.findIndex(h => re.test(h));
  const path = table.attr("id") === "BuildingPublicHome"
    ? $('a[data-url]').filter((_, e) => $(e).attr("href") === "#buildingpublichometab").attr("data-url")
    : html.match(/["']url["']\s*:\s*["'](ajax\/getpublichome\.php)["']/)?.[1];
  if (!path) throw new Error("Missing PermitEyes public AJAX endpoint");
  const endpoint = new URL(path, pageUrl);
  if (endpoint.origin !== new URL(pageUrl).origin || !endpoint.pathname.startsWith(new URL(".", pageUrl).pathname)) throw new Error("Invalid PermitEyes AJAX endpoint");
  const layout = { endpoint: endpoint.href, headers, address: index(/^Site Address$/i), permit: index(/^Permit Number$/i), name: index(/^Applicant(?: Name)?$/i), applied: index(/^Appl\. Date$/i), issued: index(/^Issue Date$/i), status: index(/^Appl\. Status$/i), description: index(/^(?:Brief Description|Description of Work)$/i), type: index(/^Appl\. Type$/i) };
  if ([layout.address, layout.permit, layout.applied, layout.issued].some(i => i < 0)) throw new Error("Unsupported PermitEyes column layout");
  return layout;
}

export function permitEyesRequest(layout: PermitEyesLayout, column: number, value: string, start = 0): URLSearchParams {
  const body = new URLSearchParams({ draw: String(start / 100 + 1), start: String(start), length: "100", "search[value]": "", "search[regex]": "false", "order[0][column]": String(layout.applied), "order[0][dir]": "desc" });
  layout.headers.forEach((_, i) => {
    body.set(`columns[${i}][data]`, String(i)); body.set(`columns[${i}][name]`, "");
    body.set(`columns[${i}][searchable]`, "true"); body.set(`columns[${i}][orderable]`, "true");
    body.set(`columns[${i}][search][value]`, i === column ? value : "");
    body.set(`columns[${i}][search][regex]`, "false");
  });
  return body;
}

export function parsePermitEyesResults(payload: unknown, layout: PermitEyesLayout, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, pageUrl: string): { records: PermitRecord[]; total: number; rowCount: number } {
  const data = payload as { data?: unknown; recordsFiltered?: unknown; error?: unknown };
  if (!data || data.error || !Array.isArray(data.data) || !/^\d+$/.test(String(data.recordsFiltered))) throw new Error("Invalid PermitEyes result envelope");
  const records: PermitRecord[] = [];
  for (const row of data.data) {
    if (!Array.isArray(row) || row.length !== layout.headers.length || !row.every(c => typeof c === "string")) throw new Error("Unexpected PermitEyes result row");
    const cell = (i: number) => i < 0 ? null : text(row[i]) || null;
    const permitNumber = cell(layout.permit);
    // Pending applications have no permit number. Do not invent one from the application ID.
    if (!permitNumber) continue;
    const $ = cheerio.load(row.join(""));
    const link = $(".view_app").first();
    const folder = link.attr("data-folderpath"), file = link.attr("data-permit-file"), id = link.attr("data-application-id");
    let sourceUrl: string | null = null;
    if (folder && file && id && /^[a-z0-9_-]+$/i.test(folder) && /^[a-z0-9_-]+\.php$/i.test(file)) {
      const u = new URL(`${folder}/${file}`, pageUrl);
      u.search = new URLSearchParams({ application_id: id, permit_file: file, permit_editfile: link.attr("data-permit-editfile") ?? "", PermitId: link.attr("data-permit-id") ?? "" }).toString();
      sourceUrl = u.href;
    }
    records.push({ permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction, address: cell(layout.address), permitType: cell(layout.type), status: cell(layout.status), description: cell(layout.description), issuedAt: permitEyesDate(cell(layout.issued)), appliedAt: permitEyesDate(cell(layout.applied)), contractorName: null, contractorLicense: null, applicantName: cell(layout.name), ownerName: null, parcel: null, valuation: null, expiresAt: null, sourceUrl, raw: { cells: row } });
  }
  return { records, total: Number(data.recordsFiltered), rowCount: data.data.length };
}

async function read(ctx: AdapterCtx, url: string, init?: RequestInit): Promise<string> {
  const response = await politeFetch(url, init, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
  if (!response.ok) throw new Error(`PermitEyes HTTP ${response.status}: ${url}`);
  if (/login(?:user)?\.php/i.test(new URL(response.url || url).pathname)) throw new PortalBlockedError(url, 401, "PermitEyes redirected to login");
  const body = await response.text();
  if (/cf-chl-|captcha|verify you are human/i.test(body)) throw new PortalBlockedError(url, 403, "PermitEyes challenge");
  return body;
}

async function query(ctx: AdapterCtx, type: PermitSearchType | "issued", value: string): Promise<PermitRecord[]> {
  const pageUrl = permitEyesPublicUrl(ctx.searchUrl);
  const layout = parsePermitEyesLayout(await read(ctx, pageUrl), pageUrl);
  const column = type === "address" ? layout.address : type === "permit" ? layout.permit : type === "name" ? layout.name : type === "issued" ? layout.issued : -1;
  if (column < 0) throw new Error(`PermitEyes does not support ${type} search`);
  const records: PermitRecord[] = [];
  const seenPages = new Set<string>();
  for (let start = 0; start < 100000;) {
    const body = await read(ctx, layout.endpoint, { method: "POST", body: permitEyesRequest(layout, column, value, start) });
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new Error("PermitEyes returned non-JSON search response"); }
    const page = parsePermitEyesResults(payload, layout, ctx, pageUrl);
    const signature = JSON.stringify((payload as { data: unknown }).data);
    if (page.rowCount && seenPages.has(signature)) throw new Error("PermitEyes repeated a result page");
    seenPages.add(signature);
    records.push(...page.records);
    start += page.rowCount;
    if (start >= page.total) return records;
    if (!page.rowCount) throw new Error("PermitEyes returned an incomplete listing");
  }
  throw new Error("PermitEyes listing exceeds safe pagination limit");
}

const adapter: PortalAdapter = {
  platform: "PermitEyes",
  aliases: ["PermitEyes (Building Division)", "PermitEyes (Online Building Permit Applications)"],
  capabilities: { search: ["address", "permit", "name"], listRecent: true, detail: false },
  async search(ctx, q) {
    if (!q.value?.trim()) throw new Error("PermitEyes requires a nonempty search value");
    return query(ctx, q.type, q.value.trim());
  },
  async listRecent(ctx, since) {
    const date = new Date(since);
    if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(since) || !Number.isFinite(date.getTime())) throw new Error("Invalid since date");
    const start = date.toISOString().slice(0, 10), end = new Date().toISOString().slice(0, 10);
    if (start > end) { permitEyesPublicUrl(ctx.searchUrl); return []; }
    const records = await query(ctx, "issued", `${start} | ${end}`);
    if (records.some(r => !r.issuedAt || r.issuedAt < start || r.issuedAt > end)) throw new Error("PermitEyes did not honor the issue-date filter");
    return records;
  },
};
export default adapter;
