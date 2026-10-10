import { load } from "cheerio";
import { politeFetch, PortalBlockedError } from "./polite-fetch";
import type { AdapterCtx, PermitRecord, PermitSearchType, PortalAdapter } from "./types";

export class IworqUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IworqUnsupportedError";
  }
}

type PortalLocation = { url: URL; tenant: string; kind: "home" | "permits" | "application" | "request" };

/** Accept only catalogued iWorQ portal routes, never government landing pages. */
export function parsePortalUrl(value: string): PortalLocation {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^(?:[a-z0-9_-]+\.)?portal\.iworq\.net$/i.test(url.hostname)) {
    throw new IworqUnsupportedError(`Not an iWorQ HTTPS permit portal: ${value}`);
  }
  const home = /^\/portalhome\/([a-z0-9_-]+)\/?$/i.exec(url.pathname);
  const records = /^\/([a-z0-9_-]+)\/permits\/\d+\/?$/i.exec(url.pathname);
  const form = /^\/([a-z0-9_-]+)\/new-(permit|request)\/\d+\/\d+\/?$/i.exec(url.pathname);
  const tenant = home?.[1] ?? records?.[1] ?? form?.[1];
  if (!tenant) throw new IworqUnsupportedError(`Unsupported iWorQ permit URL shape: ${value}`);
  // Do not replay stored queries or CAPTCHA tokens.
  url.search = "";
  url.hash = "";
  return { url, tenant, kind: home ? "home" : records ? "permits" : form?.[2].toLowerCase() === "permit" ? "application" : "request" };
}

/** Follow actual published links; the agency DSN can differ from the host slug. */
export function discoverSearchUrls(html: string, pageUrl: string): string[] {
  const $ = load(html);
  const base = new URL(pageUrl);
  const found = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const candidate = parsePortalUrl(new URL($(el).attr("href")!, base).href);
      if (candidate.kind === "permits" && candidate.url.origin === base.origin) found.add(candidate.url.href);
    } catch { /* Not a permit listing link. */ }
  });
  return [...found];
}

type SearchField = { value: string; label: string };
export type SearchForm = { action: string; fields: SearchField[]; captcha: boolean };

export function inspectSearchForm(html: string, pageUrl: string): SearchForm {
  const $ = load(html);
  const select = $('select[name="searchField"]');
  const form = select.closest("form");
  if (select.length !== 1 || form.length !== 1 || !form.find('input[name="search"]').length) {
    if (/captcha|verify you are human|just a moment|access denied/i.test($("title, h1").text()) || $("#recaptcha-container, #cf-challenge-running").length) {
      throw new PortalBlockedError(pageUrl, 403, `iWorQ challenge prevents public search at ${pageUrl}`);
    }
    if ($('input[type="password"]').length || /enter your access code/i.test($("body").text())) {
      throw new IworqUnsupportedError(`iWorQ requires login or an access code at ${pageUrl}; public records only`);
    }
    throw new IworqUnsupportedError(`No public permit search form at ${pageUrl}; application/inspection-only portal or unsupported layout`);
  }
  const action = new URL(form.attr("action") || pageUrl, pageUrl);
  if (action.origin !== new URL(pageUrl).origin || (form.attr("method") || "get").toLowerCase() !== "get") {
    throw new IworqUnsupportedError(`Unverified iWorQ search form action at ${pageUrl}`);
  }
  const fields = select.find("option").map((_, e) => ({ value: $(e).attr("value") ?? "", label: $(e).text().trim() })).get();
  return {
    action: action.href,
    fields,
    // Scripts appear in the shared template even when no challenge is active.
    // Inspect the search control itself, not merely the word "captcha".
    captcha: form.find(".g-recaptcha, .h-captcha, [data-sitekey], [name='g-recaptcha-response'], [name='h-captcha-response']").length > 0 ||
      /(?:grecaptcha|hcaptcha)\s*\./i.test(form.attr("onsubmit") ?? ""),
  };
}

export function selectSearchField(form: SearchForm, type: PermitSearchType): string | null {
  const preferred: Partial<Record<PermitSearchType, string>> = {
    permit: "permitnum_id", address: "propertyaddress", company: "contractor_id", name: "propertyowner",
  };
  const exact = form.fields.find(f => f.value === preferred[type]);
  if (exact) return exact.value;
  const patterns: Partial<Record<PermitSearchType, RegExp>> = {
    permit: /^(?:(?:old|trakit)\s+)?permit\s*(?:#|number|no\.?)$/i,
    address: /^(?:parcel|site|property|street)?\s*address$/i,
    company: /^(?:primary contractor|contractor(?: name)?|business name|company(?: name)?)$/i,
    name: /^(?:owner(?: name)?|applicant(?: name)?|property owner)$/i,
  };
  const pattern = patterns[type];
  return pattern ? form.fields.find(f => pattern.test(f.label))?.value ?? null : null;
}

/** No request can be built for a CAPTCHA-protected form. */
export function buildSearchUrl(html: string, pageUrl: string, q: { type: PermitSearchType; value: string }): string {
  const form = inspectSearchForm(html, pageUrl);
  if (form.captcha) throw new PortalBlockedError(pageUrl, 403, `iWorQ public permit search requires reCAPTCHA at ${pageUrl}; automated search was not submitted`);
  const field = selectSearchField(form, q.type);
  if (!field) throw new IworqUnsupportedError(`iWorQ does not expose ${q.type} search at ${pageUrl}`);
  const url = new URL(form.action);
  url.search = "";
  url.searchParams.set("searchField", field);
  url.searchParams.set("search", q.value);
  return url.href;
}

/** Only explicitly labelled dates are normalized; generic "Date" is ambiguous. */
export function parseIworqDate(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!us && !iso) return null;
  const year = Number(us?.[3] ?? iso?.[1]);
  const month = Number(us?.[1] ?? iso?.[2]);
  const day = Number(us?.[2] ?? iso?.[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export function parsePermitTable(html: string, ctx: Pick<AdapterCtx, "databaseId" | "jurisdiction">, pageUrl: string): PermitRecord[] {
  const $ = load(html, { sourceCodeLocationInfo: true });
  const table = $(".record-table table").first();
  if (!table.length) throw new Error(`Unrecognized iWorQ result page at ${pageUrl}`);
  const headers = table.find("thead th").map((_, e) => $(e).text().trim()).get();
  const out: PermitRecord[] = [];
  table.find("tbody tr").each((_, row) => {
    const fields: Record<string, string> = {};
    $(row).children("th, td").each((i, cell) => {
      const label = $(cell).attr("data-label") ?? headers[i];
      if (label) fields[label] = $(cell).text().replace(/\s+/g, " ").trim();
    });
    const get = (...labels: string[]) => {
      for (const label of labels) {
        const entry = Object.entries(fields).find(([k]) => k.toLowerCase() === label.toLowerCase());
        if (entry?.[1]) return entry[1];
      }
      return null;
    };
    const permitNumber = get("Permit #", "Permit Number", "TrakIt Permit #");
    if (!permitNumber) {
      if (/no (?:matching )?(?:permits|records|results)(?: found)?/i.test($(row).text())) return;
      throw new Error(`iWorQ result row lacks a permit number at ${pageUrl}`);
    }
    let sourceUrl: string | null = null;
    $(row).find("a[href]").each((_, a) => {
      const url = new URL($(a).attr("href")!, pageUrl);
      if (url.origin === new URL(pageUrl).origin && /^\/[^/]+\/permit\/\d+\/\d+\/?$/.test(url.pathname)) sourceUrl = url.href;
    });
    out.push({
      permitNumber, databaseId: ctx.databaseId, jurisdiction: ctx.jurisdiction,
      address: get("Parcel Address", "Site Address", "Property Address", "Address"),
      parcel: get("Parcel #", "Parcel Number"), lat: null, lng: null,
      permitType: get("Permit Type"), workClass: get("Type of Work", "Work Class"),
      description: get("Description", "Project Description"), status: get("Status", "Permit Status"),
      issuedAt: parseIworqDate(get("Issued Date", "Date Issued")),
      appliedAt: parseIworqDate(get("Application Date", "Applied Date")),
      expiresAt: parseIworqDate(get("Expiration Date", "Expires")), valuation: null,
      contractorName: get("Primary Contractor", "Contractor", "Contractor Name"),
      contractorLicense: get("Contractor License", "Contractor License #"),
      applicantName: get("Applicant Name", "Applicant"), ownerName: get("Owner", "Owner Name"),
      sourceUrl, raw: { html: row.sourceCodeLocation
        ? html.slice(row.sourceCodeLocation.startOffset, row.sourceCodeLocation.endOffset)
        : $.html(row) },
    });
  });
  return out;
}

async function fetchPage(ctx: AdapterCtx, url: string): Promise<{ html: string; url: string }> {
  // Manual redirects keep every hop rate-limited and prevent leaving iWorQ.
  for (let hop = 0; hop < 5; hop++) {
    const response = await politeFetch(url, { redirect: "manual" }, { minDelayMs: Math.max(1000, ctx.politeness.minDelayMs) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`iWorQ redirect without Location at ${url}`);
      const next = new URL(location, url);
      if (next.origin !== new URL(url).origin) throw new IworqUnsupportedError(`iWorQ redirected outside the tenant portal: ${next.href}`);
      url = next.href;
      continue;
    }
    if (!response.ok) throw new Error(`iWorQ HTTP ${response.status} at ${url}`);
    const html = await response.text();
    if (/just a moment|verify you are human|access denied|403 forbidden/i.test(load(html)("title, h1").text())) {
      throw new PortalBlockedError(url, 403, `iWorQ access challenge at ${url}`);
    }
    return { html, url };
  }
  throw new Error(`Too many iWorQ redirects at ${url}`);
}

async function searchPages(ctx: AdapterCtx): Promise<string[]> {
  const location = parsePortalUrl(ctx.searchUrl);
  if (location.kind === "permits") return [location.url.href];
  // Never visit an application/inspection form to search records. Derive the
  // published portalhome route; obtain actual DSN and module IDs from its links.
  const home = location.kind === "home" ? location.url.href : new URL(`/portalhome/${location.tenant}`, location.url).href;
  const page = await fetchPage(ctx, home);
  const links = discoverSearchUrls(page.html, page.url);
  if (!links.length) throw new IworqUnsupportedError(`No public permit search linked at ${home}; this application/inspection portal has no discoverable public records search`);
  return links;
}

const adapter: PortalAdapter = {
  platform: "iWorQ",
  aliases: [
    "iWorQ Citizen Portal", "iWorQ permit portal", "iWorQ building permit portal",
    "iWorQ citizen portal (building permits)", "iWorQ citizen portal", "iWorQ Building Permits Portal",
    "iWorQ Building Permit Portal", "iWorQ E-Permits portal", "iWorQ (Online Building Permit Application)",
    "iWorQ (Permit Portal)", "iWorQ (Building and Onsite Wastewater Permits)", "iWorQ (Online Permit Portal)",
    "iWorQ (Online Application Portal)", "iWorQ (Permit Search)", "iWorQ Online Permit Portal", "iWorQ portal",
    "iWorQ (city link redirects to portal)", "iWorQ (Paris-Bourbon County joint planning)",
    "iWorQ (Citizens Permit Portal)", "iWorQ (independent city)", "Metro Hartsville/Trousdale County (iWorQ)",
    "iWorQ (zoning & floodplain permits)", "iWorQ (Permit Management)", "iWorQ (Building and Zoning Permits)",
    "iWorQ (Building Permit)", "iWorQ Permit Portal",
  ],
  capabilities: { search: ["address", "permit", "name", "company"], listRecent: false, detail: false },
  async search(ctx, q) {
    parsePortalUrl(ctx.searchUrl);
    if (!q.value?.trim()) throw new Error("iWorQ search requires a nonempty query");
    if (!adapter.capabilities.search.includes(q.type)) throw new IworqUnsupportedError(`iWorQ ${q.type} search is not supported`);
    const urls = await searchPages(ctx);
    const records: PermitRecord[] = [];
    // Preflight every module before submitting searches: a blocked historical
    // module must not silently turn a partial search into a successful result.
    const requests: string[] = [];
    for (const url of urls) {
      const page = await fetchPage(ctx, url);
      const form = inspectSearchForm(page.html, page.url);
      if (!selectSearchField(form, q.type)) continue;
      requests.push(buildSearchUrl(page.html, page.url, q));
    }
    if (!requests.length) throw new IworqUnsupportedError(`No public iWorQ module exposes ${q.type} search at ${ctx.searchUrl}`);
    for (const request of requests) {
      let next: string | null = request;
      const visited = new Set<string>();
      while (next) {
        if (visited.has(next) || visited.size >= 100) throw new Error("iWorQ pagination repeated or exceeded 100 pages; refusing partial results");
        visited.add(next);
        const page = await fetchPage(ctx, next);
        // If the portal turns on CAPTCHA between preflight and response, stop.
        const form = inspectSearchForm(page.html, page.url);
        if (form.captcha) throw new PortalBlockedError(page.url, 403, "iWorQ search response requires reCAPTCHA");
        const $ = load(page.html);
        const error = $('.alert-danger, .alert-error, [role="alert"]').text().trim();
        if (error) throw new Error(`iWorQ search failed at ${page.url}: ${error}`);
        const rows = parsePermitTable(page.html, ctx, page.url);
        if (!rows.length && $('input[name="search"]').val() !== q.value &&
            !/no (?:matching )?(?:permits|records|results)(?: found)?/i.test($(".record-table").text())) {
          throw new Error(`iWorQ returned an empty table without confirming the search at ${page.url}`);
        }
        records.push(...rows);
        const href = load(page.html)('.pagination a[rel="next"]').attr("href");
        next = href ? new URL(href, page.url).href : null;
        if (next) {
          const candidate = new URL(next);
          const initial = new URL(request);
          if (candidate.origin !== initial.origin || candidate.pathname !== initial.pathname ||
              candidate.searchParams.get("searchField") !== initial.searchParams.get("searchField") ||
              candidate.searchParams.get("search") !== initial.searchParams.get("search")) {
            throw new Error("iWorQ pagination left the selected search; refusing partial results");
          }
        }
      }
    }
    return [...new Map(records.map(r => [r.sourceUrl ?? r.permitNumber, r])).values()];
  },
  async listRecent(ctx) {
    parsePortalUrl(ctx.searchUrl);
    ctx.log("iWorQ listRecent unsupported: no verified unprotected issue/application-date listing; alerts disabled");
    return [];
  },
};

export default adapter;
