/**
 * Websites as a research identifier (owner, 2026-10-22: "also add websites as a search as well!"). For each website
 * the customer gives, the bot reads the homepage and a few likely contact/about/license pages and pulls out:
 *
 *   - schema.org JSON-LD (LocalBusiness and its kinds, Organization): name, telephone, address;
 *   - phone numbers (text and tel: links), street addresses, and license numbers next to a license label
 *     ("Lic #", "License No.", "CSLB", "ROC", "Registration #") or in a Florida license form ("CGC1512345");
 *   - business name candidates (JSON-LD, og:site_name, the title, a copyright line), shown in the report only.
 *
 * The phones, addresses and license numbers are then searched like the customer's own identifiers (runner.ts), each
 * one carrying the host it came from. A site that can't be read is reported as such; it never fails the order.
 *
 * Fetching goes through Site Scan's safeFetch (server/sitescan/http.ts): http(s) on 80/443 only, no credentials in
 * the URL, every hop's host resolved and refused unless every address is public unicast (no loopback, private,
 * link-local, CGNAT, multicast or documentation ranges, IPv4 or IPv6), the validated address pinned into the socket
 * (no second lookup, no DNS rebinding), at most 5 redirects each re-checked, 10 s per request and 2 MB per body.
 * On top of that: at most MAX_PAGES pages per site, only pages on the site's own host after the homepage, only HTML,
 * and a time budget for the whole site.
 */
import * as cheerio from "cheerio";
import { safeFetch, type PageResponse } from "../sitescan/http";
import { cleanAddress, cleanLicenseNumber, formatPhone, type WebsiteRead } from "@shared/research-reports";
import type { IdQuery } from "./identifiers";

/** Pages read per website: the homepage plus up to three contact/about/license pages. */
export const MAX_PAGES = 4;
/** The whole site, every page included. */
export const SITE_BUDGET_MS = 30_000;
/** What one site may add to the search. */
export const MAX_PER_SITE = { names: 5, phones: 5, addresses: 5, licenseNumbers: 8 } as const;
/** Characters of HTML parsed per page (safeFetch already stops at 2 MB). */
const MAX_HTML = 800_000;

export type Extracted = { names: string[]; phones: string[]; addresses: string[]; licenseNumbers: string[] };

const BUSINESS_TYPES = /business|organization|organisation|contractor|electrician|plumber|roofing|hvac|locksmith|mover|painter|homeandconstruction|professionalservice|store|company|corporation/i;
/** Words that make a candidate a page title rather than a name ("Home", "Contact Us"). */
const NOT_A_NAME = /^(home|homepage|welcome|contact( us)?|about( us)?|services?|index|untitled|page not found|404|blog|menu)$/i;

const tidy = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

function pushUnique(list: string[], v: string | null | undefined, max: number, key = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "")) {
  if (!v || list.length >= max) return;
  const k = key(v);
  if (k && !list.some((x) => key(x) === k)) list.push(v);
}

/** A JSON-LD address (a string or a PostalAddress) as one line. */
function jsonLdAddress(a: any): string | null {
  if (!a) return null;
  if (typeof a === "string") return tidy(a) || null;
  if (Array.isArray(a)) return jsonLdAddress(a[0]);
  if (typeof a !== "object") return null;
  const street = tidy(a.streetAddress);
  if (!street) return null;
  const region = [tidy(a.addressRegion), tidy(a.postalCode)].filter(Boolean).join(" ");
  return [street, tidy(a.addressLocality), region].filter(Boolean).join(", ");
}

/** Every object in a JSON-LD document (arrays, @graph, nested values), bounded. */
function jsonLdNodes(doc: unknown): any[] {
  const out: any[] = [];
  const walk = (v: unknown, depth: number) => {
    if (out.length > 200 || depth > 6 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    out.push(v);
    for (const x of Object.values(v as Record<string, unknown>)) if (x && typeof x === "object") walk(x, depth + 1);
  };
  walk(doc, 0);
  return out;
}

const typeOf = (n: any): string => (Array.isArray(n?.["@type"]) ? n["@type"].join(" ") : tidy(n?.["@type"]));

/** A phone pattern in running text: (206) 555-0142, 206.555.0142, +1 206 555 0142. */
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g;
/** A street address on one line: a house number, up to five words, a USPS suffix, then maybe a unit, city, state, ZIP. */
const STREET_RE = new RegExp(
  String.raw`\b\d{1,6}[A-Za-z]?(?:-\d{1,5})?\s+(?:[NSEW]\.?\s+|North\s+|South\s+|East\s+|West\s+)?(?:[A-Za-z0-9.'-]+\s+){0,4}?` +
  String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Court|Ct|Way|Parkway|Pkwy|Highway|Hwy|Place|Pl|Circle|Cir|Terrace|Ter|Trail|Trl|Pike|Plaza|Plz|Square|Sq|Loop|Route|Rte|Freeway|Fwy|Expressway|Expy)\b\.?` +
  String.raw`(?:\s*(?:[NSEW]{1,2})\b\.?)?(?:,?\s*(?:Suite|Ste|Unit|Apt|Bldg|#)\.?\s*#?[A-Za-z0-9-]+)?` +
  String.raw`(?:,?\s+[A-Za-z][A-Za-z .'-]{1,40}?,?\s+[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?)?`,
  "g",
);
/** "City, ST 12345" on its own line, to finish a street found on the line before. */
const LOCALITY_RE = /^[A-Za-z][A-Za-z .'-]{1,40},?\s+[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?$/;
/** A license number after a label. The label words are dropped; ROC keeps its prefix (Arizona writes "ROC 123456"). */
const LABELED_LICENSE_RE = /\b(?:(?:contractor'?s?|state|general|electrical|plumbing|mechanical)\s+)?(?:lic(?:ense|ence)?|reg(?:istration)?|cert(?:ificate)?)(?![a-z])\.?\s*(?:no\.?|number|num\.?|#)?\s*[:#.]?\s*((?:[A-Z]{1,5}[-\s]?)?\d[A-Z0-9-]{2,14})\b|\bCSLB\s*(?:lic(?:ense)?\.?\s*)?(?:no\.?|#)?\s*[:#]?\s*(\d{5,8})\b|\b(ROC)\s*[-#:]?\s*(\d{5,7})\b/gi;
/** Florida's license forms (CGC, CBC, CRC, EC, CFC, CAC …) and the like, written without a label. */
const FORM_LICENSE_RE = /\b(C[GBRPMUAF]C|CCC|EC|EF|ER|ES|CFC|CAC|CMC|CPC|CUC)\s?-?(\d{6,8})\b/g;

/** Strips what isn't the page's visible text and returns its lines (block elements end a line). */
function pageLines($: cheerio.CheerioAPI): string[] {
  $("script, style, noscript, template, svg, iframe").remove();
  $("br").replaceWith("\n");
  $("p, div, li, td, th, tr, h1, h2, h3, h4, h5, h6, address, footer, header, section, article, dd, dt, nav, ul, ol, table, form").each((_, el) => { $(el).append("\n"); });
  return ($("body").text() || $.root().text()).split(/\n+/).map((l) => tidy(l)).filter((l) => l.length > 0 && l.length < 400);
}

/**
 * The identifiers on one page of HTML (pure, so it can be tested). `host` is the site's own host, used to ignore a
 * copyright line that names only the domain.
 */
export function extractFromHtml(html: string, host = ""): Extracted {
  const out: Extracted = { names: [], phones: [], addresses: [], licenseNumbers: [] };
  const $ = cheerio.load(html.slice(0, MAX_HTML));
  // 1. JSON-LD: the site's own statement of its name, phone and address.
  $('script[type="application/ld+json"]').each((_, el) => {
    let doc: unknown;
    try { doc = JSON.parse($(el).contents().text().trim()); } catch { return; }
    for (const n of jsonLdNodes(doc)) {
      const t = typeOf(n);
      if (!t || !BUSINESS_TYPES.test(t) || /WebSite|WebPage|BreadcrumbList|ImageObject|SearchAction/i.test(t)) continue;
      const name = tidy(n.legalName || n.name);
      if (name && name.length <= 120 && !NOT_A_NAME.test(name)) pushUnique(out.names, name, MAX_PER_SITE.names);
      for (const tel of [n.telephone, ...(Array.isArray(n.contactPoint) ? n.contactPoint.map((c: any) => c?.telephone) : [n.contactPoint?.telephone])].flat()) {
        pushUnique(out.phones, formatPhone(tidy(tel)), MAX_PER_SITE.phones);
      }
      for (const a of Array.isArray(n.address) ? n.address : [n.address]) pushUnique(out.addresses, (() => { const l = jsonLdAddress(a); return l ? cleanAddress(l) : null; })(), MAX_PER_SITE.addresses);
    }
  });
  // 2. Name candidates the page itself carries.
  const og = tidy($('meta[property="og:site_name"]').attr("content"));
  if (og && og.length <= 120 && !NOT_A_NAME.test(og)) pushUnique(out.names, og, MAX_PER_SITE.names);
  const title = tidy($("title").first().text()).split(/\s+[|–—-]\s+|\s*\|\s*/).map(tidy).filter((x) => x && !NOT_A_NAME.test(x));
  // tel: links before the text (a site's main number is usually a link).
  $('a[href^="tel:"]').each((_, el) => pushUnique(out.phones, formatPhone(decodeURIComponent(($(el).attr("href") ?? "").slice(4))), MAX_PER_SITE.phones));
  const lines = pageLines($);
  const text = lines.join("\n");
  // A copyright line: "© 2024 Acme Electric LLC. All rights reserved."
  const copy = text.match(/(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}\s*(?:[-–]\s*\d{4})?\s*)?([A-Z][A-Za-z0-9&.,' -]{2,80}?)(?:\.|,)?\s*(?:All rights|\n|$)/i);
  const copyName = copy ? tidy(copy[1]).replace(/[.,]+$/, "") : "";
  if (copyName && !/^(all rights|copyright)/i.test(copyName) && copyName.toLowerCase() !== host) pushUnique(out.names, copyName, MAX_PER_SITE.names);
  // A contact or about page's title names the page, not the business ("Contact Mr. Electric").
  if (title[0] && title[0].length <= 80 && !/^(contact|about|our |services?\b|welcome)/i.test(title[0])) pushUnique(out.names, title[0], MAX_PER_SITE.names);
  // 3. Phones in the text.
  for (const m of text.matchAll(PHONE_RE)) pushUnique(out.phones, formatPhone(m[0]), MAX_PER_SITE.phones);
  // 4. Street addresses, a line at a time (a street line can be finished by the "City, ST ZIP" line under it).
  lines.forEach((line, i) => {
    for (const m of line.matchAll(STREET_RE)) {
      let a = tidy(m[0]);
      if (!/\b\d{5}(?:-\d{4})?$/.test(a) && LOCALITY_RE.test(lines[i + 1] ?? "")) a = `${a}, ${lines[i + 1]}`;
      pushUnique(out.addresses, cleanAddress(a.replace(/[,.]+$/, "")), MAX_PER_SITE.addresses);
    }
  });
  // 5. License numbers: next to a license label, or in a Florida license form.
  for (const m of text.matchAll(LABELED_LICENSE_RE)) {
    const v = m[1] ?? m[2] ?? (m[3] && m[4] ? `ROC${m[4]}` : null);
    if (!v) continue;
    const digits = v.replace(/\D/g, "");
    // A year or a ZIP after "Licensed since" / "License 2024" is not a number.
    if (digits.length < 4 || /^(19|20)\d{2}$/.test(v.replace(/[\s-]/g, ""))) continue;
    pushUnique(out.licenseNumbers, cleanLicenseNumber(v.replace(/\s+/g, "")), MAX_PER_SITE.licenseNumbers);
  }
  for (const m of text.matchAll(FORM_LICENSE_RE)) pushUnique(out.licenseNumbers, cleanLicenseNumber(`${m[1]}${m[2]}`), MAX_PER_SITE.licenseNumbers);
  return out;
}

/** Contact, about and license pages linked from the homepage, on the site's own host, best first. */
export function likelyPages(html: string, base: string): string[] {
  const $ = cheerio.load(html.slice(0, MAX_HTML));
  const baseUrl = new URL(base);
  const scored: { url: string; score: number }[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || /^(mailto|tel|javascript|data):/i.test(href) || href.startsWith("#")) return;
    let u: URL;
    try { u = new URL(href, baseUrl); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || hostKey(u.hostname) !== hostKey(baseUrl.hostname)) return;
    u.hash = "";
    const label = `${u.pathname} ${$(el).text()}`.toLowerCase();
    const score = /contact/.test(label) ? 3 : /licen[sc]|credential|insur/.test(label) ? 2 : /about|company|who-we-are|our-story|team/.test(label) ? 1 : 0;
    if (score && u.pathname !== "/" && !/\.(pdf|jpe?g|png|gif|zip|docx?)$/i.test(u.pathname)) scored.push({ url: u.href, score });
  });
  const out: string[] = [];
  for (const s of scored.sort((a, b) => b.score - a.score)) if (!out.includes(s.url)) out.push(s.url);
  // Common paths when the homepage links none (a site built with a script menu).
  if (!out.length) for (const p of ["/contact", "/contact-us", "/about", "/about-us"]) out.push(new URL(p, baseUrl).href);
  return out;
}

const hostKey = (h: string) => h.toLowerCase().replace(/^www\d*\./, "").replace(/\.$/, "");
const isHtml = (r: PageResponse) => { const t = r.headers["content-type"] ?? ""; return !t || /html|xml/i.test(t); };

export type WebsiteDeps = { fetch: (url: string, allowed?: (url: string) => boolean) => Promise<PageResponse>; now: () => number };
const defaultDeps: WebsiteDeps = { fetch: safeFetch, now: Date.now };

/** Reads one website. Never throws: a site that can't be read comes back with read=false and the reason. */
export async function readWebsite(host: string, deps: WebsiteDeps = defaultDeps): Promise<WebsiteRead> {
  const out: WebsiteRead = { host, read: false, pages: [], note: "", names: [], phones: [], addresses: [], licenseNumbers: [] };
  const started = deps.now();
  const merge = (e: Extracted) => {
    for (const k of ["names", "phones", "addresses", "licenseNumbers"] as const) for (const v of e[k]) pushUnique(out[k], v, MAX_PER_SITE[k]);
  };
  const withBudget = <T>(p: Promise<T>): Promise<T> => {
    const left = SITE_BUDGET_MS - (deps.now() - started);
    if (left <= 0) return Promise.reject(new Error("time budget for this website ran out"));
    return Promise.race([p, new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error("time budget for this website ran out")), left); t.unref?.(); })]);
  };
  let home: PageResponse | null = null;
  let lastError = "";
  for (const url of [`https://${host}/`, `http://${host}/`]) {
    try {
      const r = await withBudget(deps.fetch(url));
      if (r.status >= 200 && r.status < 300 && isHtml(r)) { home = r; break; }
      lastError = r.status >= 400 ? `the site answered HTTP ${r.status}` : "the homepage isn't a web page";
    } catch (err: any) {
      lastError = String(err?.message ?? err).slice(0, 160);
    }
  }
  if (!home) { out.note = `Could not read the website (${lastError || "no answer"}).`; return out; }
  const siteHost = hostKey(new URL(home.url).hostname);
  out.read = true;
  out.pages.push(home.url);
  merge(extractFromHtml(home.body, siteHost));
  // Only the site's own pages after the homepage (a redirect to another host is not followed for these).
  const sameSite = (u: string) => { try { return hostKey(new URL(u).hostname) === siteHost; } catch { return false; } };
  let failed = 0;
  for (const url of likelyPages(home.body, home.url).slice(0, MAX_PAGES - 1)) {
    if (out.pages.length >= MAX_PAGES) break;
    try {
      const r = await withBudget(deps.fetch(url, sameSite));
      if (r.status < 200 || r.status >= 300 || !isHtml(r) || out.pages.includes(r.url)) continue;
      out.pages.push(r.url);
      merge(extractFromHtml(r.body, siteHost));
    } catch (err: any) {
      failed++;
      if (/time budget/.test(String(err?.message))) break;
    }
  }
  const redirected = siteHost !== hostKey(host) ? ` (it redirects to ${siteHost})` : "";
  const found = out.phones.length + out.addresses.length + out.licenseNumbers.length;
  out.note = `Read ${out.pages.length} page(s)${redirected}; ${found ? `found ${[
    out.phones.length && `${out.phones.length} phone(s)`, out.addresses.length && `${out.addresses.length} address(es)`, out.licenseNumbers.length && `${out.licenseNumbers.length} license number(s)`,
  ].filter(Boolean).join(", ")}` : "found no phone, street address or license number"}${failed ? `; ${failed} page(s) could not be read` : ""}.`;
  return out;
}

/** Every website of a subject, one after another (each bounded by SITE_BUDGET_MS). */
export async function readWebsites(hosts: string[] | undefined, deps: WebsiteDeps = defaultDeps): Promise<WebsiteRead[]> {
  const out: WebsiteRead[] = [];
  for (const h of hosts ?? []) {
    try { out.push(await readWebsite(h, deps)); }
    catch (err: any) { out.push({ host: h, read: false, pages: [], note: `Could not read the website (${String(err?.message ?? err).slice(0, 160)}).`, names: [], phones: [], addresses: [], licenseNumbers: [] }); }
  }
  return out;
}

/** What the websites add to the search: their license numbers, phones and addresses, each carrying its host. */
export function websiteIds(reads: WebsiteRead[]): IdQuery[] {
  return [
    ...reads.flatMap((r) => r.licenseNumbers.map((value) => ({ type: "license" as const, value, from: r.host }))),
    ...reads.flatMap((r) => r.phones.map((value) => ({ type: "phone" as const, value, from: r.host }))),
    ...reads.flatMap((r) => r.addresses.map((value) => ({ type: "address" as const, value, from: r.host }))),
  ];
}
