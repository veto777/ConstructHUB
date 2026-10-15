import * as cheerio from "cheerio";
import { accelaSearchUrl, assertAccelaAgency, parseAccelaResults, parseAccelaDetail } from "../scraper";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

type Document = { url: string; html: string };
const GRID = "table[id*='gdvPermitList'], table[id*='GridView'], table[id*='dgPermit']";
const NO_RESULTS = /no records found|no records match|no results found|search returned no results|no records? (?:were )?found/i;

/** Only classic ACA URLs. New Accela /core/index portals are a different product. */
export function accelaPortalUrl(value: string): string {
  const u = new URL(value);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password ||
      !/^\/[\w-]+(?:\/?|\/(?:Default|Welcome|Login)\.aspx|\/Cap\/CapHome\.aspx|\/customization\/common\/home\.aspx)$/i.test(u.pathname)) {
    throw new Error("Not a classic Accela Citizen Access portal URL");
  }
  if (u.protocol === "http:") u.protocol = "https:";
  u.hash = "";
  assertAccelaAgency(u.href, u.href);
  return u.href;
}

/** Dedicated hosts often use /CitizenAccess/ as an application path, not an agency code.
 * Bind their agency only from the portal's own same-application ACA stylesheet URL. */
export function accelaAgencyCode(portal: string, html: string): string | undefined {
  const u = new URL(portal);
  if (u.hostname.endsWith(".accela.com") || !/^\/(?:CitizenAccess|Permits|portal|devservices)\//i.test(u.pathname)) return undefined;
  const $ = cheerio.load(html);
  const codes = new Set<string>();
  $("link[href]").each((_i, e) => {
    const link = new URL($(e).attr("href")!, portal);
    if (link.origin !== u.origin || link.pathname.split("/")[1]?.toLowerCase() !== u.pathname.split("/")[1]?.toLowerCase() || !/\/Handlers\/CustomizedCssStyle\.ashx$/i.test(link.pathname)) return;
    const code = link.searchParams.get("agencyCode");
    if (code && /^[\w-]+$/.test(code)) codes.add(code);
  });
  if (codes.size > 1) throw new Error("Accela portal declares conflicting agencies");
  return [...codes][0];
}

function agencyUrl(url: string, code?: string): string {
  if (!code) return url;
  const u = new URL(url);
  u.pathname = u.pathname.replace(/^\/[^/]+/, `/${code}`);
  return u.href;
}

export function assertAccelaScope(portal: string, target: string, code?: string): void {
  if (!code) return assertAccelaAgency(portal, target);
  // Check origin/application first, then use the shared helper with the verified agency.
  const pathOnly = new URL(target);
  for (const key of [...pathOnly.searchParams.keys()]) if (/^(agencyCode|agency)$/i.test(key)) pathOnly.searchParams.delete(key);
  assertAccelaAgency(portal, pathOnly.href);
  assertAccelaAgency(agencyUrl(portal, code), agencyUrl(target, code));
}

export function isoDate(value: string | null | undefined): string | null {
  if (!value || (value.includes("T") && !Number.isFinite(Date.parse(value)))) return null;
  const m = value.trim().match(/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:$|T)/);
  if (!m) return null;
  const date = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[6]}-${m[4].padStart(2, "0")}-${m[5].padStart(2, "0")}`;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

export function assertAccelaResponse(html: string, url: string): void {
  const $ = cheerio.load(html);
  $("script,style").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  if (/verify (?:that )?you are (?:a )?human|access denied|request (?:was )?blocked|captcha|incapsula incident|just a moment|checking your browser/i.test(text) ||
      $("iframe[src*='captcha'], iframe[src*='Incapsula'], iframe[src*='challenges.cloudflare.com'], .g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form").length) {
    throw new PortalBlockedError(url, 403, "Accela access challenge; no bypass attempted");
  }
  if (/too many (?:records|results)|exceeds? the maximum|maximum number of (?:records|results)/i.test(text)) {
    throw new Error("Accela returned too many results; refine the search or date window");
  }
}

/** Serialize successful controls, including the untouched live ViewState/CSRF tokens. */
export function accelaForm(html: string): URLSearchParams {
  const $ = cheerio.load(html);
  const body = new URLSearchParams();
  $("form input[name], form select[name], form textarea[name]").each((_i, e) => {
    const el = $(e);
    const type = el.attr("type") || "";
    if (el.is(":disabled") || /^(submit|button|image|file)$/i.test(type) ||
        (/^(checkbox|radio)$/i.test(type) && !el.is(":checked"))) return;
    const val = el.val();
    for (const v of Array.isArray(val) ? val : [val ?? ""]) body.append(el.attr("name")!, String(v));
  });
  if (!body.has("__VIEWSTATE")) throw new Error("Accela WebForms state missing (login wall or unsupported portal)");
  return body;
}

export function postback(href: string): { target: string; argument: string } {
  const m = href.match(/__doPostBack\(['"]([^'"]+)['"],\s*['"]([^'"]*)['"]\)/) ||
    href.match(/WebForm_PostBackOptions\(["']([^"']+)["'],\s*["']([^"']*)["']/);
  if (!m) throw new Error("Unsupported Accela postback control");
  return { target: m[1], argument: m[2] };
}

class Session {
  private cookies = new Map<string, string>();
  agencyCode?: string;
  constructor(readonly ctx: AdapterCtx, readonly portal: string) {}
  async request(url: string, body?: URLSearchParams, referer?: string): Promise<Document> {
    assertAccelaScope(this.portal, url, this.agencyCode);
    for (let redirects = 0; redirects < 6; redirects++) {
      const response = await politeFetch(url, {
        method: body ? "POST" : "GET", redirect: "manual",
        headers: { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...(referer ? { referer } : {}) }, body: body?.toString(),
      }, { minDelayMs: Math.max(1000, this.ctx.politeness.minDelayMs), timeoutMs: 45000 });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0];
        const index = pair.indexOf("=");
        if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Accela redirect is missing its destination");
        const next = new URL(location, url).href;
        assertAccelaScope(this.portal, next, this.agencyCode);
        if (![307, 308].includes(response.status)) body = undefined;
        referer = url; url = next;
        continue;
      }
      if (!response.ok) throw new Error(`Accela HTTP ${response.status} at ${url}`);
      const html = await response.text();
      assertAccelaResponse(html, url);
      return { url, html };
    }
    throw new Error("Accela redirect limit exceeded");
  }
  async submit(doc: Document, event: { target: string; argument: string }, body = accelaForm(doc.html)): Promise<Document> {
    const $ = cheerio.load(doc.html);
    const url = new URL($("form").first().attr("action") || doc.url, doc.url).href;
    body.set("__EVENTTARGET", event.target);
    body.set("__EVENTARGUMENT", event.argument);
    body.delete("__ASYNCPOST");
    return this.request(url, body, doc.url);
  }
  async open(): Promise<Document> {
    let doc = await this.request(this.portal);
    // Do not turn a random ASP.NET page into an assumed Accela tenant.
    // A city-branded landing page (Plantation, FL) may carry no Accela marker but link to its own Cap/CapHome search;
    // that search page must still prove it is Accela below.
    const agencyPath = new URL(this.portal).pathname.split("/")[1]?.toLowerCase();
    const $landing = cheerio.load(doc.html);
    const linksOwnSearch = $landing("a[href]").toArray().some((a) => {
      try {
        const u = new URL($landing(a).attr("href")!, doc.url);
        return u.origin === new URL(this.portal).origin && u.pathname.split("/")[1]?.toLowerCase() === agencyPath && /\/Cap\/CapHome\.aspx$/i.test(u.pathname);
      } catch { return false; }
    });
    if (!/Accela|appAca|ACA_CS_FIELD/i.test(doc.html) && !new URL(this.portal).hostname.endsWith(".accela.com") && !linksOwnSearch) throw new Error("URL did not return an Accela portal");
    this.agencyCode = accelaAgencyCode(this.portal, doc.html);
    const target = new URL(accelaSearchUrl(this.portal, doc.html));
    target.searchParams.delete("IsToShowInspection");
    target.searchParams.delete("globalsearch");
    if (target.href !== doc.url) doc = await this.request(target.href);
    if (!/appAca|ACA_CS_FIELD/.test(doc.html) || !cheerio.load(doc.html)("a[id*='btnNewSearch']").length) throw new Error("Accela public search unavailable (login required or invalid module)");
    // A custom landing page declares no agency; the Accela search page itself does.
    this.agencyCode ??= accelaAgencyCode(this.portal, doc.html);
    return doc;
  }
}

function setField(html: string, body: URLSearchParams, selector: string, value: string): void {
  const $ = cheerio.load(html);
  const el = $(selector).not(":disabled,[type=hidden]").first();
  const name = el.attr("name");
  if (!name) throw new Error(`Accela does not expose the requested search field: ${selector}`);
  body.set(name, value);
}

export function accelaSearchForm(html: string, q: { type: PermitSearchType; value: string }): URLSearchParams {
  const body = accelaForm(html);
  const $ = cheerio.load(html);
  const value = q.value.trim();
  if (!value) throw new Error("Accela search value is empty");
  // Tenant defaults often silently restrict historical permit lookups to the last year.
  $("input[id*='txtGSStartDate'],input[id*='txtGSEndDate']").each((_i, el) => body.set($(el).attr("name")!, ""));
  if (q.type === "address") {
    const parts = value.match(/^(\d+)\s+(.+)$/);
    if (parts) setField(html, body, "input[id*='txtGSNumber_ChildControl0'],input[id*='txtHouseNumberFrom']", parts[1]);
    const words = (parts?.[2] ?? value).split(/\s+/);
    const abbreviations: Record<string, string> = { street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", court: "ct", highway: "hwy", place: "pl", terrace: "ter", parkway: "pkwy", circle: "cir", north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw" };
    const normalize = (word: string) => { const key = word.replace(/\./g, "").toLowerCase(); return abbreviations[key] || key; };
    const choose = (selector: string, word: string) => {
      const select = $(selector).first();
      const option = select.find("option").filter((_i, o) => normalize($(o).text().trim()) === normalize(word)).first();
      if (!select.attr("name") || !option.attr("value")) return false;
      body.set(select.attr("name")!, option.attr("value")!);
      return true;
    };
    if (words.length > 1 && choose("select[id*='ddlGSDirection']", words[0])) words.shift();
    else if (words.length > 1 && choose("select[id*='ddlGSDirection']", words[words.length - 1])) words.pop();
    if (words.length > 1 && choose("select[id*='ddlGSStreetSuffix']", words[words.length - 1])) words.pop();
    setField(html, body, "input[id*='txtGSStreetName'],input[id*='txtStreetName']", words.join(" "));
  } else if (q.type === "permit") {
    setField(html, body, "input[id*='txtGSPermitNumber'],input[id*='txtPermitNumber']", value);
  } else {
    const fields: Partial<Record<PermitSearchType, string>> = {
      company: "input[id*='txtGSBusiName'],input[id$='_txtBusiName']",
      license: "input[id*='txtGSLicenseNumber'],input[id$='_txtLicenseNumber']",
      name: "input[id*='txtGSLastName'],input[id$='_txtLastName']",
      keyword: "input[id*='txtGSProjectName']",
    };
    if (!fields[q.type]) throw new Error(`Accela does not support ${q.type} search`);
    setField(html, body, fields[q.type]!, value);
  }
  $("input[id*='chkCrossModuleSearch']").each((_i, el) => body.delete($(el).attr("name")!));
  return body;
}

/** Supplement the shared detail parser for ACA's public licensed-professional template. */
export function accelaDetailFields(html: string, number: string, portal: string, url: string, code?: string) {
  assertAccelaScope(portal, url, code);
  const detail = parseAccelaDetail(html, number, agencyUrl(portal, code), agencyUrl(url, code));
  if (!detail) return null;
  const $ = cheerio.load(html);
  const names = new Set<string>(), licenses = new Set<string>();
  $("table[id='tbl_licensedps'] > tbody > tr > td:last-child").each((_i, cell) => {
    const body = $(cell).clone();
    body.find("table,script,style,a.__cf_email__,a[id='link_licenseProfessional']").remove();
    body.find("br").replaceWith("\n");
    const lines = body.text().split("\n").map(line => line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const person: string[] = [];
    for (const line of lines.slice(0, 2)) {
      if (/^\d|^P\.?\s*O\.?\s*Box\b|^CCB\b|\b(?:contractor|electrician)\s+[\w-]*\d/i.test(line)) break;
      person.push(line);
    }
    if (person.length) names.add(person.join(" / "));
    for (const line of lines) {
      const license = line.match(/\b(?:CCB|contractor|electrician|plumber|license|architect|engineer)\b.*?\s([A-Z0-9-]*\d[A-Z0-9-]*)$/i);
      if (license) licenses.add(license[1]);
    }
  });
  if ($("table[id='tbl_licensedps']").length) {
    detail.Contractor = [...names].join("; ");
    detail["Contractor license"] = [...licenses].join("; ");
  }
  return detail;
}

export function parseAccelaRecords(html: string, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, portal: string, url: string, code?: string): PermitRecord[] {
  assertAccelaScope(portal, url, code);
  assertAccelaResponse(html, url);
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  // Oregon customizes the header, but the underlying grid is still ACA.
  // Normalize only the parser input; raw rows below remain byte-for-byte original.
  const normalized = cheerio.load(html);
  normalized(GRID).find("th").each((_i, th) => {
    if (/^Permit\/Application Number$/i.test(normalized(th).text().trim())) normalized(th).text("Permit Number");
  });
  const parsed = parseAccelaResults(normalized.html());
  if (!parsed.length) {
    $("script,style").remove();
    if (NO_RESULTS.test($("body").text())) return [];
    throw new Error("Accela returned neither records nor an explicit no-results response");
  }
  return parsed.map(r => {
    const link = $(GRID).find("a").filter((_i, a) => $(a).text().trim() === r.permitNumber).first();
    const row = link.closest("tr");
    const href = link.attr("href");
    let sourceUrl = /\/Cap\/CapDetail\.aspx/i.test(url) ? url : null;
    if (href && !/^javascript:/i.test(href)) {
      const resolved = new URL(href, url).href;
      assertAccelaScope(portal, resolved, code);
      if (/\/Cap\/CapDetail\.aspx/i.test(resolved)) sourceUrl = resolved;
    }
    const location = (row.get(0) as unknown as { sourceCodeLocation?: { startOffset: number; endOffset: number } })?.sourceCodeLocation;
    const detail = sourceUrl === url ? accelaDetailFields(html, r.permitNumber!, portal, url, code) : null;
    const cellValue = (pattern: RegExp) => {
      const table = row.closest("table");
      const headers = table.find("tr").filter((_i, tr) => $(tr).children("th").length > 0).first().children("th");
      const index = headers.toArray().findIndex(th => pattern.test($(th).text().trim()));
      return index < 0 ? null : row.children("td").eq(index).text().replace(/\s+/g, " ").trim() || null;
    };
    const valuation = detail?.["Job value"]?.replace(/[$,\s]/g, "");
    return {
      permitNumber: r.permitNumber!, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
      address: detail?.Address || cellValue(/^(?:.* )?address$|^location$/i) || row.find("[id$='_lblPermitAddress']").text().trim() || null,
      parcel: detail?.Parcel || cellValue(/^parcel(?: number| #)?$/i) || r.parcelNumber || null,
      permitType: r.permitType ?? null, workClass: null, lat: null, lng: null,
      description: detail?.Description || r.description || null, status: r.status ?? null,
      issuedAt: isoDate(detail?.Issued || r.issuedDate),
      appliedAt: isoDate(detail?.Applied) || isoDate(cellValue(/^(?:application|applied) date$/i)),
      expiresAt: isoDate(detail?.Expires || r.expirationDate),
      contractorName: detail?.Contractor || r.contractorName || null, contractorLicense: detail?.["Contractor license"] || null,
      applicantName: detail?.Applicant || cellValue(/^applicant(?: name)?$/i), ownerName: detail?.Owner || cellValue(/^owner(?: name)?$/i),
      valuation: valuation && /^\d+(?:\.\d+)?$/.test(valuation) ? Number(valuation) : null, sourceUrl,
      raw: { html: location ? html.slice(location.startOffset, location.endOffset) : html },
    };
  });
}

async function collect(session: Session, initial: Document, budget = { pages: 0 }): Promise<PermitRecord[]> {
  let doc = initial;
  const results = new Map<string, PermitRecord>();
  for (let page = 1; page <= 10; page++) {
    if (++budget.pages > 10) throw new Error("Accela search exceeds 10 pages; narrow the search or date window");
    const batch = parseAccelaRecords(doc.html, session.ctx, session.portal, doc.url, session.agencyCode);
    if (page > 1 && (!batch.length || batch.every(r => results.has(r.permitNumber)))) throw new Error("Accela pagination did not advance");
    batch.forEach(r => results.set(r.permitNumber, r));
    const $ = cheerio.load(doc.html);
    const next = $(GRID).find("a").filter((_i, a) => /^Next\s*>?$/i.test($(a).text().trim()) && !$(a).is("[disabled],.aspNetDisabled")).first();
    const href = next.attr("href");
    if (!href) return [...results.values()];
    if (budget.pages === 10) throw new Error("Accela search exceeds 10 pages; narrow the search or date window");
    doc = await session.submit(doc, postback(href));
  }
  throw new Error("Accela pagination limit exceeded");
}

export function accelaRecentForm(html: string, since: string, until: string): URLSearchParams {
  const start = isoDate(since), end = isoDate(until);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(since) || !start || !end || start > end) throw new Error("Accela requires a valid ISO date range");
  const us = (value: string) => `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
  const body = accelaForm(html);
  setField(html, body, "input[id*='txtGSStartDate']", us(start));
  setField(html, body, "input[id*='txtGSEndDate']", us(end));
  const $ = cheerio.load(html);
  $("input[id*='chkCrossModuleSearch']").each((_i, el) => body.delete($(el).attr("name")!));
  return body;
}

async function prepareSearch(session: Session, q: { type: PermitSearchType; value: string }): Promise<Document> {
  if (!q.value.trim()) throw new Error("Accela search value is empty");
  let doc = await session.open();
  if (["company", "license", "name"].includes(q.type)) {
    const $ = cheerio.load(doc.html);
    const select = $("select[id$='_ddlSearchType']");
    const option = select.find("option").filter((_i, e) => /Search by Licensed Professional/i.test($(e).text())).first();
    // Some tenants expose licensed-professional fields directly in General Search.
    if (option.length && select.attr("name")) {
      const body = accelaForm(doc.html);
      body.set(select.attr("name")!, option.attr("value")!);
      doc = await session.submit(doc, { target: select.attr("name")!, argument: "" }, body);
    }
  }
  const body = accelaSearchForm(doc.html, q);
  const href = cheerio.load(doc.html)("a[id*='btnNewSearch']").first().attr("href");
  if (!href) throw new Error("Accela search submit control missing");
  return session.submit(doc, postback(href), body);
}

const adapter: PortalAdapter = {
  platform: "Accela",
  aliases: [
    "Oregon ePermitting",
    "Accela Citizen Access",
    "Accela (BASS)",
    "Accela Citizen Access (CPPL Portal)",
    "Accela (ELM)",
    "Accela (CAGIS ezTrak)",
    "Accela (eConnect)",
    "Accela Citizen Access (Online Permit Center)",
    "Accela (PascoGateway)",
    "Accela (EZ Online Permitting)",
    "Aurora4Biz (Accela Citizen Access)",
    "Accela Citizen Access (E-Permits)",
    "Accela (DallasNow)",
    "Accela (Cabarrus County ACA, Harrisburg module)",
    "Accela (SimpliCITY)",
    "Accela Citizen Access (Building)",
    "Accela Citizen Access (city link)",
    "Oregon ePermitting (Accela)",
    "Accela (HillsGovHub)",
    "Accela (Oregon ePermitting)",
    "Accela (Develop901)",
    "Oregon ePermitting (Accela) — state BCD is the building department",
    "Accela Citizen Access (Ceres Building module)",
    "Accela (eBUILD) (independent city)",
    "Accela Citizen Access (OpenHillsboro Permit Portal)",
    "Accela Citizen Access (Cabarrus County central permitting, covers Kannapolis)",
    "Accela Citizen Access (Online Building Permit Portal)",
  ],
  capabilities: { search: ["address", "permit", "company", "license", "name", "keyword"], listRecent: true, detail: true },
  async search(ctx, q) {
    const session = new Session(ctx, accelaPortalUrl(ctx.searchUrl));
    const doc = await prepareSearch(session, q);
    const $ = cheerio.load(doc.html);
    const licenses = $("table[id*='dgvLicense'] a[id$='_lbLicense']");
    if (!licenses.length) return collect(session, doc);
    const moreLicenses = $("table[id*='dgvLicense'] a[href]").filter((_i, a) => /^Next\s*>?$/i.test($(a).text().trim()) && !$(a).is("[disabled],.aspNetDisabled"));
    if (licenses.length > 10 || moreLicenses.length) throw new Error("Accela matched too many licensed professionals; refine the business name or license number");
    const results = new Map<string, PermitRecord>();
    const budget = { pages: 0 };
    for (const link of licenses.toArray()) {
      if (budget.pages >= 10) throw new Error("Accela search exceeds 10 pages; narrow the search or date window");
      const license = $(link).text().trim();
      const name = $(link).closest("tr").find("[id$='_lblContractName']").text().trim() || null;
      const permits = await collect(session, await session.submit(doc, postback($(link).attr("href")!)), budget);
      for (const r of permits) results.set(r.permitNumber, { ...r,
        contractorLicense: r.contractorLicense || license, contractorName: r.contractorName || name,
        raw: { ...r.raw, matchedLicensedProfessional: { license, name } },
      });
    }
    return [...results.values()];
  },
  async listRecent(ctx, since) {
    if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(since) || !isoDate(since)) throw new Error("Accela requires an ISO start date");
    const session = new Session(ctx, accelaPortalUrl(ctx.searchUrl));
    const doc = await session.open();
    const $ = cheerio.load(doc.html);
    if (!$("input[id*='txtGSStartDate']").length || !$("input[id*='txtGSEndDate']").length) {
      adapter.capabilities.listRecent = false;
      ctx.log("Accela tenant does not expose General Search Start Date / End Date; recent listing unavailable");
      return [];
    }
    adapter.capabilities.listRecent = true;
    const body = accelaRecentForm(doc.html, since, new Date().toISOString());
    const href = $("a[id*='btnNewSearch']").first().attr("href")!;
    return collect(session, await session.submit(doc, postback(href), body));
  },
  async detail(ctx, permitNumber) {
    const session = new Session(ctx, accelaPortalUrl(ctx.searchUrl));
    let doc = await prepareSearch(session, { type: "permit", value: permitNumber });
    const records = parseAccelaRecords(doc.html, ctx, session.portal, doc.url, session.agencyCode);
    const record = records.find(r => r.permitNumber === permitNumber.trim());
    if (!record) {
      if (!records.length) return null;
      throw new Error("Accela did not return an exact permit-number match");
    }
    if (!record.sourceUrl) throw new Error("Accela record has no public detail link");
    if (record.sourceUrl !== doc.url) doc = await session.request(record.sourceUrl, undefined, doc.url);
    if (!accelaDetailFields(doc.html, permitNumber, session.portal, doc.url, session.agencyCode)) throw new Error("Accela detail did not confirm the requested permit number");
    const detailed = parseAccelaRecords(doc.html, ctx, session.portal, doc.url, session.agencyCode)[0];
    // Detail templates sometimes omit fields that the search row explicitly reports.
    return { ...record, ...Object.fromEntries(Object.entries(detailed).filter(([, value]) => value !== null)) } as PermitRecord;
  },
};
export default adapter;
