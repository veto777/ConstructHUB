import * as cheerio from "cheerio";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";
import { politeText, PortalBlockedError } from "./polite-fetch";

async function publicJson(url: string, options: { minDelayMs: number }): Promise<unknown> {
  const body = await politeText(url, undefined, options);
  if (/cf-chl-|g-recaptcha|h-captcha|<title>\s*(?:Just a moment|Attention Required)|verify you are human/i.test(body)) {
    throw new PortalBlockedError(url, 403, "GovBuilt JSON endpoint presents an anti-bot challenge");
  }
  return JSON.parse(body);
}

const filters: Partial<Record<PermitSearchType, string>> = {
  address: "Address", permit: "ReferenceNumber", name: "Name",
};

/** GovBuilt tenants are isolated by host, including URLs into AdvancedForms. */
export function govbuiltBase(searchUrl: string): string {
  const url = new URL(searchUrl);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.govbuilt\.com$/i.test(url.hostname) || url.port || url.username || url.password) {
    throw new Error("Not a supported GovBuilt tenant URL");
  }
  return url.origin;
}

export function govbuiltRequest(base: string, q: { type: PermitSearchType; value: string }, page = 1): string {
  const filter = filters[q.type];
  if (!filter) throw new Error(`GovBuilt does not support ${q.type} permit search`);
  if (!q.value.trim()) throw new Error("GovBuilt search requires a nonempty value");
  const url = new URL("/PublicReport/GetAllContentToolModels", base);
  url.search = new URLSearchParams({
    searchText: q.value.trim(), filter, contentType: "case", type: "", days: "0", subType: "",
    isHideClosedStatus: "false", Start: String(page), Length: "100", SortBy: "Created Date", SortType: "desc", draw: String(page),
  }).toString();
  return url.href;
}

const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const number = (v: unknown): number | null => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v)) ? Number(v) : null;

export type GovbuiltPage = { rows: Record<string, unknown>[]; total: number };
export function parseGovbuiltPage(value: unknown): GovbuiltPage {
  if (!value || typeof value !== "object") throw new Error("Invalid GovBuilt JSON response");
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.data) || !Number.isInteger(data.recordsFiltered) || Number(data.recordsFiltered) < 0 || data.error) {
    throw new Error("GovBuilt response is not a successful paginated search");
  }
  if (!data.data.every(row => row && typeof row === "object" && !Array.isArray(row) && typeof row.contentItemId === "string" && typeof row.title === "string")) {
    throw new Error("GovBuilt search row schema changed");
  }
  return { rows: data.data, total: Number(data.recordsFiltered) };
}

/** Generic cases and business licenses are not represented as building permits. */
export function parseGovbuiltRecord(row: Record<string, unknown>, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction" | "searchUrl">): PermitRecord | null {
  if (row.submissionType !== row.caseDisplayText || !/\bpermit\b/i.test(String(row.type ?? ""))) return null;
  const permitNumber = text(row.number) ?? text(row.title);
  if (!permitNumber) throw new Error("GovBuilt permit has no reference number");
  let location: Record<string, unknown> = {};
  if (typeof row.applicationLocation === "string" && row.applicationLocation.trim()) {
    try { location = JSON.parse(row.applicationLocation) ?? {}; } catch { /* optional map data */ }
  }
  const lat = number(location.Latitude), lng = number(location.Longitude);
  const base = govbuiltBase(ctx.searchUrl);
  return {
    permitNumber, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
    address: text(row.address), parcel: null,
    lat: lat !== null && Math.abs(lat) <= 90 ? lat : null,
    lng: lng !== null && Math.abs(lng) <= 180 ? lng : null,
    permitType: text(row.type), workClass: text(row.subtype), description: null, status: text(row.status),
    issuedAt: null, appliedAt: null, expiresAt: null, valuation: null,
    // The public grid labels this only "Name". It is not evidence of a contractor or applicant role.
    contractorName: null, contractorLicense: null, applicantName: null, ownerName: null,
    sourceUrl: row.showCaseDetailsReport === true && text(row.contentItemId)
      ? `${base}/PublicReport/GetAllCaseDetailsData/${encodeURIComponent(String(row.contentItemId))}` : null,
    raw: row,
  };
}

/** Public case report, only fetched when the search row explicitly enables it. */
export function parseGovbuiltDetail(html: string, record: PermitRecord): PermitRecord {
  const $ = cheerio.load(html);
  const values = new Map<string, string>();
  $("table.info-table td").each((_i, cell) => {
    const label = $(cell).children("b").first().text().trim().replace(/:$/, "");
    const copy = $(cell).clone();
    copy.children("b").remove();
    if (label) values.set(label, copy.text().trim());
  });
  const number = [...values.entries()].find(([label]) => /Number$/.test(label))?.[1];
  if (!$("table.permit").length || number !== record.permitNumber) throw new Error("GovBuilt public detail does not match the requested permit");
  const descriptionCard = $(".card").filter((_i, el) => $(el).children("h5").first().text().trim() === "Description").first().clone();
  descriptionCard.children("h5").remove();
  const description = descriptionCard.text().trim();
  return {
    ...record, parcel: text(values.get("Parcel #")),
    description: description && description !== "No Description Available" ? description : null,
    workClass: text(values.get("Sub Types")) ?? record.workClass,
    status: text(values.get("Status")) ?? record.status,
    raw: { row: record.raw, html },
  };
}

const adapter: PortalAdapter = {
  platform: "GovBuilt",
  aliases: ["GovBuilt online permit portal", "GovBuilt permitting platform", "GovBuilt (PDS of Kenton County)", "GovBuilt permitting portal", "GovBuilt online services portal"],
  capabilities: { search: ["address", "permit", "name"], listRecent: false, detail: true },
  async search(ctx, q) {
    const base = govbuiltBase(ctx.searchUrl);
    govbuiltRequest(base, q); // Validate before network access.
    const opts = { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) };
    const pageUrl = `${base}/activitysearchtool`;
    const html = await politeText(pageUrl, undefined, opts);
    if (/cf-chl-|g-recaptcha|h-captcha|verify you are human/i.test(html)) throw new PortalBlockedError(pageUrl, 403, "GovBuilt public search presents an anti-bot challenge");
    const $ = cheerio.load(html);
    if (!$("#publicContentTable").length || !$("#filter-dropdown option").toArray().some(el => $(el).attr("value") === filters[q.type])) {
      if ($('input[type="password"]').length) throw new PortalBlockedError(pageUrl, 401, "GovBuilt tenant requires login");
      throw new Error("GovBuilt tenant has no supported public Activity Search Tool/filter");
    }
    const records: PermitRecord[] = [];
    const seen = new Set<string>();
    let read = 0;
    let excluded = 0;
    for (let page = 1; page <= 100; page++) {
      const data = parseGovbuiltPage(await publicJson(govbuiltRequest(base, q, page), opts));
      if (data.rows.length === 0 && read < data.total) throw new Error("GovBuilt pagination ended before the reported total");
      for (const row of data.rows) {
        const id = String(row.contentItemId);
        if (seen.has(id)) throw new Error("GovBuilt repeated a row while paging; refusing partial results");
        seen.add(id);
        const record = parseGovbuiltRecord(row, ctx);
        if (record) records.push(record);
        else excluded++;
      }
      read += data.rows.length;
      if (read >= data.total) {
        if (excluded) ctx.log(`GovBuilt omitted ${excluded} cases not explicitly labeled as permits`);
        if (excluded && records.length === 0) throw new Error("GovBuilt returned cases without an explicit permit classification; cannot report a genuine no-results search");
        return records;
      }
    }
    throw new Error("GovBuilt search exceeded 100 pages; narrow the query");
  },
  async detail(ctx, permitNumber) {
    const results = (await adapter.search(ctx, { type: "permit", value: permitNumber })).filter(record => record.permitNumber.toLowerCase() === permitNumber.trim().toLowerCase());
    if (results.length > 1) throw new Error("GovBuilt permit number is ambiguous");
    const record = results[0];
    if (!record) return null;
    if (!record.sourceUrl) return record;
    const html = await politeText(record.sourceUrl, undefined, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    if (/cf-chl-|g-recaptcha|h-captcha|verify you are human/i.test(html)) throw new PortalBlockedError(record.sourceUrl, 403, "GovBuilt detail presents an anti-bot challenge");
    return parseGovbuiltDetail(html, record);
  },
  async listRecent(ctx) {
    govbuiltBase(ctx.searchUrl);
    ctx.log("GovBuilt exposes creation/activity dates, not a verified issued/applied date listing; alerts unsupported");
    return [];
  },
};
export default adapter;
