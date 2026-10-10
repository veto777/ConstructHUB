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

export function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
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
      $("iframe[src*='captcha'], iframe[src*='Incapsula'], .g-recaptcha, .h-captcha, #challenge-form").length) {
    throw new PortalBlockedError(url, 403, "Accela access challenge; no bypass attempted");
  }
  if (/too many (?:records|results)|(?:refine|narrow) your search|exceeds? the maximum|maximum number of (?:records|results)/i.test(text)) {
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
  constructor(readonly ctx: AdapterCtx, readonly portal: string) {}
  async request(url: string, body?: URLSearchParams, referer?: string): Promise<Document> {
    assertAccelaAgency(this.portal, url);
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
        assertAccelaAgency(this.portal, next);
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
    if (!/Accela|appAca|ACA_CS_FIELD/i.test(doc.html) && !new URL(this.portal).hostname.endsWith(".accela.com")) throw new Error("URL did not return an Accela portal");
    let target = new URL(accelaSearchUrl(this.portal, doc.html));
    target.searchParams.delete("IsToShowInspection");
    target.searchParams.delete("globalsearch");
    if (target.href !== doc.url) doc = await this.request(target.href);
    if (!/appAca|ACA_CS_FIELD/.test(doc.html) || !cheerio.load(doc.html)("a[id*='btnNewSearch']").length) throw new Error("Accela public search unavailable (login required or invalid module)");
    return doc;
  }
}

function setField(html: string, body: URLSearchParams, selector: string, value: string): void {
  const $ = cheerio.load(html);
  const el = $(selector).not(":disabled").first();
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
    setField(html, body, "input[id*='txtGSStreetName'],input[id*='txtStreetName']", parts?.[2] ?? value);
  } else if (q.type === "permit") {
    setField(html, body, "input[id*='txtGSPermitNumber'],input[id*='txtPermitNumber']", value);
  } else throw new Error(`Accela does not support ${q.type} search`);
  return body;
}

export function parseAccelaRecords(html: string, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, portal: string, url: string): PermitRecord[] {
  assertAccelaAgency(portal, url);
  assertAccelaResponse(html, url);
  const $ = cheerio.load(html);
  const parsed = parseAccelaResults(html);
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
      assertAccelaAgency(portal, resolved);
      if (/\/Cap\/CapDetail\.aspx/i.test(resolved)) sourceUrl = resolved;
    }
    return {
      permitNumber: r.permitNumber!, jurisdiction: ctx.jurisdiction, databaseId: ctx.databaseId,
      address: r.address || null, parcel: r.parcelNumber ?? null, permitType: r.permitType ?? null,
      description: r.description ?? null, status: r.status ?? null,
      issuedAt: isoDate(r.issuedDate), appliedAt: null, expiresAt: isoDate(r.expirationDate),
      contractorName: r.contractorName ?? null, contractorLicense: null,
      applicantName: r.applicantName ?? null, ownerName: null, sourceUrl,
      raw: { html: row.length ? $.html(row) : html },
    };
  });
}

async function collect(session: Session, initial: Document): Promise<PermitRecord[]> {
  let doc = initial;
  const results = new Map<string, PermitRecord>();
  for (let page = 1; page <= 10; page++) {
    const batch = parseAccelaRecords(doc.html, session.ctx, session.portal, doc.url);
    if (page > 1 && (!batch.length || batch.every(r => results.has(r.permitNumber)))) throw new Error("Accela pagination did not advance");
    batch.forEach(r => results.set(r.permitNumber, r));
    const $ = cheerio.load(doc.html);
    const next = $(GRID).find("a").filter((_i, a) => /^Next\s*>?$/i.test($(a).text().trim()) && !$(a).is("[disabled],.aspNetDisabled")).first();
    const href = next.attr("href");
    if (!href) return [...results.values()];
    if (page === 10) throw new Error("Accela search exceeds 10 pages; narrow the search or date window");
    doc = await session.submit(doc, postback(href));
  }
  throw new Error("Accela pagination limit exceeded");
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
    "Accela Citizen Access (Online Building Permit Portal)"
],
  capabilities: { search: ["address", "permit"], listRecent: false, detail: false },
  async search(ctx, q) {
    const session = new Session(ctx, accelaPortalUrl(ctx.searchUrl));
    const doc = await session.open();
    const body = accelaSearchForm(doc.html, q);
    const href = cheerio.load(doc.html)("a[id*='btnNewSearch']").first().attr("href")!;
    return collect(session, await session.submit(doc, postback(href), body));
  },
  async listRecent() { return []; },
};
export default adapter;
