import type { AdapterCtx, PermitRecord, PortalAdapter } from "./types";
import { inflateRawSync } from "node:zlib";
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

// ---------------------------------------------------------------------------------------------------------------
// Name/company search through tenant-published permit reports.
//
// The public lookup is address-only and its project rows carry no contractor/applicant/owner fields (verified
// 2026-10-14). Some tenants, though, publish permit reports under /<tenant>/templates?module=reports that anyone can
// download anonymously (GET /<tenant>/downloadReport?moduleName=pi&id=<n>); a few of those are Excel files with a
// permit-number column and named-contact columns. Only reports verified live on 2026-10-14 to carry both are listed
// here; every other tenant keeps address-only search. A report covers only its own window (one month, one year, open
// permits...): the observed issued-date range is recorded on every record (raw.report), never assumed from the title.
// ---------------------------------------------------------------------------------------------------------------

export type MyGovNameReport = { id: number; title: string };
export const MYGOV_NAME_REPORTS: Record<string, { jurisdiction: string; reports: MyGovNameReport[] }> = {
  crowley_tx: { jurisdiction: "Crowley, TX", reports: [
    { id: 313, title: "Yearly Report of ALL Issued Permits (posted monthly) (Excel)" },
    { id: 375, title: "Report of Open Permits (Excel)" },
  ] },
  tx_texarkana: { jurisdiction: "Texarkana, TX", reports: [
    { id: 280, title: "Permits Issued in the last year - YTD" },
    { id: 370, title: "Permits Issued in the last month" },
  ] },
  little_elm_tx: { jurisdiction: "Little Elm, TX", reports: [
    { id: 15, title: "All Issued Permits - Commercial, Residential, and Pools (Within One Month) (LOCATIONS)" },
  ] },
  lancaster_tx: { jurisdiction: "Lancaster, TX", reports: [{ id: 15, title: "DCAD Report [LOCATIONS]" }] },
  tx_abilene: { jurisdiction: "Abilene, TX", reports: [
    { id: 371, title: "TCADBuildingPermitsWithProjInfo" },
    { id: 423, title: "Irrigation Permits" },
  ] },
  paris_texas: { jurisdiction: "Paris, TX", reports: [{ id: 372, title: "All Permits Media w/ Solar" }] },
};

const MAX_REPORT_BYTES = 25 * 1024 * 1024;

/** Minimal ZIP reader (stored/deflate entries, no ZIP64) — enough for the XLSX files MyGov generates. */
export function unzipEntries(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("MyGov report is not a ZIP/XLSX file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("MyGov report ZIP directory is corrupt");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (size === 0xffffffff || local === 0xffffffff) throw new Error("MyGov report uses ZIP64, which is not supported");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("MyGov report ZIP entry is corrupt");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`MyGov report ZIP entry uses unsupported compression ${method}`);
  }
  return out;
}

function xmlText(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_m, d, h, n) =>
    d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()])
    .replace(/_x000[aAdD]_/g, "\n");
}
function textRuns(xml: string): string {
  return Array.from(xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), m => xmlText(m[1])).join("");
}
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? "") n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** First worksheet of an XLSX as rows of cell strings (positional, empty cells ""). */
export function readXlsxRows(buf: Buffer): string[][] {
  const files = unzipEntries(buf);
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("MyGov report XLSX has no first worksheet");
  const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const shared = Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g), m => textRuns(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));
  const rows: string[][] = [];
  for (const row of sheet.toString("utf8").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? "";
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
      const index = ref ? columnIndex(ref) : cells.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") {
        if (v === undefined || !/^\d+$/.test(v) || Number(v) >= shared.length) throw new Error("MyGov report references a missing shared string");
        value = shared[Number(v)];
      } else if (type === "inlineStr") value = textRuns(body);
      else if (v !== undefined) value = xmlText(v);
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/** Labelled-role columns. Everything else with names goes to raw.listedNames (role unknown or stated in the text). */
const CONTRACTOR_COLUMNS = ["Contractor Name"];
const APPLICANT_COLUMNS = ["Applicant"];
const LISTED_COLUMNS = ["Contractor Contact", "Credential Contacts", "Collaborators", "Property Contacts", "Issued To", "CO Issued To", "TCO Issued To", "CC Issued To", "Owners"];
/** Contact details and staff columns are never copied into the record (staff are not permit parties). */
const DROPPED_COLUMNS = /phone|mobile|e-?mail|physical address|mailing address|project contacts details|^created by$|^project manager$|issued by$/i;

function tidy(v: string | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
}
/** "Jane Roe, Roe Roofing LLC, 9035551234, jane@roe.test" → "Jane Roe, Roe Roofing LLC" (contact details dropped). */
export function stripContactDetails(v: string): string | null {
  return tidy(v.split(",").map(s => s.trim()).filter(s => s && !/@/.test(s) && !(/^[\d\s().+-]+$/.test(s) && s.replace(/\D/g, "").length >= 7)).join(", "));
}
/** "A Co (Electrical Contractor), B Co (Plumbing Master)" → one entry per contact; entries with no name are dropped. */
function splitContacts(v: string): string[] {
  return v.split(/(?<=\)),\s*/).map(s => tidy(s)).filter((s): s is string => !!s && /[a-z0-9]/i.test(s.replace(/\([^)]*\)/g, "")));
}
/** MM/DD/YYYY[ at h:mm AM] → YYYY-MM-DD; anything else → null. */
export function myGovReportDate(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\b/.exec((v ?? "").trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

type ReportMeta = { id: number; title: string; url: string; permits: number; issuedFrom: string | null; issuedTo: string | null };

/**
 * Parse one downloaded report into one PermitRecord per permit (rows repeat once per contact). A permit is the
 * permit number + address + type: Texarkana's report reuses a number for unrelated projects, which must not merge.
 */
export function parseMyGovReport(rows: string[][], meta: Omit<ReportMeta, "permits" | "issuedFrom" | "issuedTo">, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">): PermitRecord[] {
  const header = (rows[0] ?? []).map(h => h.trim());
  const col = (name: string) => header.indexOf(name);
  const permitCol = col("Permit Number");
  if (permitCol < 0) throw new Error(`MyGov report "${meta.title}" has no Permit Number column`);
  const has = (names: string[]) => names.some(n => col(n) >= 0);
  if (!has(CONTRACTOR_COLUMNS) && !has(APPLICANT_COLUMNS) && !has(LISTED_COLUMNS) && col("Name") < 0) {
    throw new Error(`MyGov report "${meta.title}" has no name columns`);
  }
  const get = (r: string[], ...names: string[]) => { for (const n of names) { const i = col(n); const v = i >= 0 ? tidy(r[i]) : null; if (v) return v; } return null; };
  const kept = header.map((h, i) => ({ h, i })).filter(({ h }) => h && !DROPPED_COLUMNS.test(h));
  const byPermit = new Map<string, PermitRecord & { raw: { listedNames: string[]; rows: Record<string, string>[]; report?: ReportMeta } }>();
  for (const r of rows.slice(1)) {
    const permitNumber = tidy(r[permitCol]);
    if (!permitNumber) continue;
    const identity = [permitNumber, get(r, "Project Address"), get(r, "Template name", "Permit Title")].join("\u0000");
    let rec = byPermit.get(identity);
    if (!rec) {
      const valuation = Number(get(r, "Project Valuation"));
      rec = {
        permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
        address: get(r, "Project Address"), parcel: null, lat: null, lng: null,
        permitType: get(r, "Template name", "Permit Title"), workClass: null,
        description: get(r, "Permit Description"), status: get(r, "Status (Permit)", "Status (Project)"),
        issuedAt: myGovReportDate(get(r, "Permit Issued Date", "Permit Issued Date Time") ?? undefined),
        // "Date Started" is project creation in MyGov, not a verified application date.
        appliedAt: null, expiresAt: myGovReportDate(get(r, "Expire Date") ?? undefined),
        valuation: Number.isFinite(valuation) && valuation > 0 ? valuation : null,
        contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
        // The report file is the public source; MyGov has no per-record page.
        sourceUrl: meta.url, raw: { listedNames: [], rows: [] },
      };
      byPermit.set(identity, rec);
    }
    const contractor = get(r, ...CONTRACTOR_COLUMNS);
    if (contractor && !rec.contractorName) rec.contractorName = contractor;
    const applicant = get(r, ...APPLICANT_COLUMNS);
    if (applicant && !rec.applicantName) rec.applicantName = stripContactDetails(applicant);
    const names: string[] = [];
    const person = get(r, "Name"), business = get(r, "Business Name");
    if (person || business) names.push([person, business].filter(Boolean).join(" / "));
    for (const n of LISTED_COLUMNS) { const v = get(r, n); if (v) names.push(...splitContacts(v)); }
    for (const n of names) if (!rec.raw.listedNames.includes(n)) rec.raw.listedNames.push(n);
    rec.raw.rows.push(Object.fromEntries(kept.map(({ h, i }) => [h, r[i] ?? ""]).filter(([, v]) => v !== "")));
  }
  const records = Array.from(byPermit.values());
  const dates = records.map(r => r.issuedAt).filter((d): d is string => !!d).sort();
  const report: ReportMeta = { ...meta, permits: records.length, issuedFrom: dates[0] ?? null, issuedTo: dates[dates.length - 1] ?? null };
  for (const r of records) r.raw.report = report;
  return records;
}

const nameTokens = (v: string) => v.toLowerCase().split(/[^a-z0-9&']+/).filter(w => w.length >= 2);
/** Every word of the query is a whole word of ONE name field of the record (same rule as the research matcher). */
export function myGovNameMatches(query: string, record: PermitRecord): boolean {
  const want = nameTokens(query);
  if (!want.length) return false;
  const listed = Array.isArray(record.raw?.listedNames) ? (record.raw!.listedNames as string[]) : [];
  return [record.contractorName, record.applicantName, record.ownerName, ...listed]
    .some(f => { if (!f) return false; const have = new Set(nameTokens(f)); return want.every(w => have.has(w)); });
}

function dispositionName(header: string | null): string | null {
  const m = /filename="([^"]+)"/i.exec(header ?? "");
  return m ? m[1] : null;
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function searchReports(ctx: AdapterCtx, tenant: string, value: string): Promise<PermitRecord[]> {
  const entry = MYGOV_NAME_REPORTS[tenant];
  if (!entry) throw new Error("MyGov tenant publishes no verified report with names; requested search field unavailable");
  if (!nameTokens(value).length) throw new Error("MyGov name search needs at least one word of two or more characters");
  const options = { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs), timeoutMs: 60_000 };
  const out = new Map<string, PermitRecord>();
  for (const report of entry.reports) {
    const url = `https://public.mygov.us/${tenant}/downloadReport?moduleName=pi&id=${report.id}`;
    const response = await politeFetch(url, { headers: { Accept: "application/octet-stream" }, redirect: "manual" }, options);
    if (!response.ok) throw new Error(`MyGov HTTP ${response.status} at ${url}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) throw new Error(`MyGov report "${report.title}" is too large (${declared} bytes)`);
    const file = dispositionName(response.headers.get("content-disposition"));
    // The tenant can rename or repurpose a report id; refuse anything that is not the verified Excel report.
    if (!file || squash(file) !== squash(`${report.title}.xlsx`)) throw new Error(`MyGov report ${report.id} is no longer "${report.title}" (got ${file ?? "no file name"})`);
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > MAX_REPORT_BYTES) throw new Error(`MyGov report "${report.title}" is too large`);
    const records = parseMyGovReport(readXlsxRows(buf), { id: report.id, title: report.title, url }, ctx);
    const meta = records[0]?.raw?.report as ReportMeta | undefined;
    ctx.log(`MyGov report "${report.title}": ${records.length} permits${meta?.issuedFrom ? `, issued ${meta.issuedFrom} to ${meta.issuedTo}` : ""}`);
    for (const r of records) {
      const identity = [r.permitNumber, r.address, r.permitType].join("\u0000");
      if (!out.has(identity) && myGovNameMatches(value, r)) out.set(identity, r);
    }
  }
  return Array.from(out.values());
}

/**
 * Jurisdiction adapter for a tenant listed in MYGOV_NAME_REPORTS: the public address lookup plus name/company search
 * over that tenant's verified public reports. Registered by jurisdiction so tenants without such a report keep their
 * honest address-only capability.
 */
export function myGovReportAdapter(tenant: string): PortalAdapter {
  if (!MYGOV_NAME_REPORTS[tenant]) throw new Error(`No verified MyGov name report for ${tenant}`);
  const base = `https://public.mygov.us/${tenant}`;
  return {
    platform: "MyGov",
    capabilities: { search: ["address", "name", "company"], listRecent: false, detail: false },
    async search(ctx, q) {
      if (myGovTenant(ctx.searchUrl) !== base) throw new Error(`MyGov report search for ${tenant} cannot serve ${ctx.searchUrl}`);
      if (q.type === "address") return adapter.search(ctx, q);
      if (q.type === "name" || q.type === "company") return searchReports(ctx, tenant, q.value);
      throw new Error(`MyGov does not support ${q.type} search; requested search field unavailable`);
    },
    listRecent: (ctx, since) => adapter.listRecent(ctx, since),
  };
}
