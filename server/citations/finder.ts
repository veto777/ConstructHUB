/**
 * Finding one business on one directory — the reusable script behind the citation audit (owner 2026-10-15).
 *
 *   1. A listing link the owner already saved is verified first.
 *   2. The directory's own search page is loaded (HTTP, then a browser if the site needs one); links on it that
 *      look like listings and whose card names the business become candidates. If the page is readable, lists
 *      other businesses and none is ours, the business is "not found" there.
 *   3. With no candidate, a web search limited to the directory (Google Programmable Search when configured,
 *      otherwise DuckDuckGo's HTML results) supplies up to three listing links.
 *   4. Each candidate page is read and its name / phone / address compared with the business
 *      (server/directories/nap.ts — structured data first, then a careful single-business fallback).
 *
 * Every answer carries how it was reached and what was seen. A page that could not be read is "unconfirmed",
 * never "not listed" (CLAUDE.md: unknown is null, never a guess).
 */
import * as cheerio from "cheerio";
import { analyzeDirectoryProfile, normalizeName, normalizePhone, type FieldResult, type NapProfile } from "../directories/nap";
import { cseConfigured } from "../seo/rank-sources/google-cse";
import { loadPage, loadHttp, type Loaded, type Loader } from "./fetch";
import { onDirectory, type CitationDirectory, type SearchQuery } from "./directories";

export type FindResult = "match" | "mismatch" | "not_found" | "unconfirmed" | "unsupported";
export type How = "listing_url" | "search_page" | "web_search" | "none";
export type Found = {
  result: FindResult;
  listingUrl: string | null;
  /** One plain sentence for the owner. */
  reason: string;
  how: How;
  /** Name / phone / address compared field by field (confirmed results only). */
  fields: Record<string, FieldResult> | null;
  /** Address could not be read: listed and the phone matches, but the address is unverified. */
  partial: boolean;
  evidence: { checked: string[]; candidates: string[]; searchUrl: string | null; title: string | null };
};

export type BusinessProfile = Omit<NapProfile, "city" | "state"> & { city: string; state: string; zip: string };

export type FinderDeps = {
  load: Loader;
  webSearch: (q: string, dir: CitationDirectory) => Promise<string[]>;
  /** Hard cap for one directory, ms. */
  budgetMs?: number;
};

const MAX_CANDIDATES = 3;

export const nameTokens = (name: string) => normalizeName(name).split(" ").filter((t) => t.length > 1);
/** Share of the business's name tokens present in a text (1 = all). */
export function nameOverlap(name: string, text: string): number {
  const want = nameTokens(name);
  if (!want.length) return 0;
  const have = new Set(normalizeName(text).split(" "));
  return want.filter((t) => have.has(t)).length / want.length;
}
const hasPhone = (phone: string | null, text: string) => {
  const d = phone ? normalizePhone(phone) : "";
  return d.length >= 10 && normalizePhone(text.replace(/\D+/g, " ")).includes(d) || (d.length >= 10 && text.replace(/\D/g, "").includes(d));
};

export function placeOf(p: BusinessProfile): string {
  const cs = [p.city, p.state].filter(Boolean).join(", ");
  return cs || p.zip || "";
}

type Candidate = { url: string; from: How; score: number };

/** JSON-escaped HTML (Next.js / React pages carry their results inside a script) read as plain text. */
const unescapeJson = (s: string) => s.replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/&amp;/g, "&");

/**
 * Listing links on a search page whose card names the business. Two readings of the same page: the links in the
 * document, and every listing-shaped URL anywhere in the HTML (search results many sites render from embedded JSON),
 * each judged by the text around it. Exported for tests.
 */
export function candidatesFromSearchPage(html: string, baseUrl: string, dir: CitationDirectory, profile: BusinessProfile): { candidates: Candidate[]; listingLinks: number; namePresent: boolean; phonePresent: boolean } {
  const $ = cheerio.load(html);
  const seen = new Map<string, Candidate>();
  let listingLinks = 0;
  const keep = (url: string, score: number) => { const prev = seen.get(url); if (!prev || prev.score < score) seen.set(url, { url, from: "search_page", score }); };
  // Reading 2: URLs in the raw HTML (JSON included), judged by the 700 characters around each.
  const raw = unescapeJson(html);
  const hostRe = dir.url.replace(/\./g, "\\.");
  const urlRe = new RegExp(`https?://(?:[a-z0-9-]+\\.)*${hostRe}(/[^\\s"'<>\\\\)\\]]*)`, "gi");
  // Each URL's neighbourhood stops at the previous and next listing URL, so one result's text never vouches for another.
  const hits = [...raw.matchAll(urlRe)].map((m) => ({ m, start: m.index!, end: m.index! + m[0].length }))
    .filter(({ m }) => { try { const u = new URL(m[0]); return dir.listingPath.test(`${u.pathname}${u.search}`) && u.pathname !== "/"; } catch { return false; } });
  for (let i = 0; i < hits.length; i++) {
    const { m, start, end } = hits[i];
    let abs: URL;
    try { abs = new URL(m[0]); } catch { continue; }
    const from = Math.max(0, start - 700, i > 0 ? hits[i - 1].end : 0);
    const to = Math.min(raw.length, end + 700, i + 1 < hits.length ? hits[i + 1].start : raw.length);
    const around = raw.slice(from, to).replace(/<[^>]+>/g, " ");
    const overlap = nameOverlap(profile.name ?? "", around);
    if (overlap < 0.75) continue;
    abs.hash = "";
    keep(abs.href, overlap * 8 + (hasPhone(profile.phone, around) ? 10 : 0));
  }
  $("script,style,noscript,template").remove();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    let abs: URL;
    try { abs = new URL(href, baseUrl); } catch { return; }
    if (!/^https?:$/.test(abs.protocol) || !onDirectory(abs.href, dir)) return;
    const target = `${abs.pathname}${abs.search}`;
    if (!dir.listingPath.test(target) || abs.pathname === "/") return;
    listingLinks++;
    // The card around the link: the link's text, then its ancestors (up to four), stopping at the first one that
    // holds another listing link — that is the list, not this card — until something names the business.
    const isListingLink = (el: any) => { const h = $(el).attr("href") || ""; try { const u = new URL(h, baseUrl); return onDirectory(u.href, dir) && dir.listingPath.test(`${u.pathname}${u.search}`) && u.pathname !== "/"; } catch { return false; } };
    let node: any = $(a), text = $(a).text(), overlap = nameOverlap(profile.name ?? "", text), hops = 0;
    while (overlap < 0.75 && hops < 4 && node.parent().length) {
      const parent = node.parent();
      if (parent.find("a[href]").filter((_: number, el: any) => isListingLink(el) && el !== a).length > 0) break;
      node = parent; text = node.text(); overlap = nameOverlap(profile.name ?? "", text); hops++;
    }
    if (overlap < 0.75) return;
    abs.hash = "";
    keep(abs.href, overlap * 10 + (hasPhone(profile.phone, text) ? 10 : 0) + (profile.city && normalizeName(text).includes(normalizeName(profile.city)) ? 2 : 0) - hops * 0.5);
  });
  // The page as text, JSON-rendered results included.
  const pageText = raw.replace(/<script[\s\S]*?<\/script>/gi, (m) => m.replace(/<[^>]+>/g, " ")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  listingLinks = Math.max(listingLinks, hits.length);
  return {
    candidates: [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES),
    listingLinks,
    namePresent: nameOverlap(profile.name ?? "", pageText) >= 0.75,
    phonePresent: hasPhone(profile.phone, pageText),
  };
}

/** Links from a web search, kept to the directory (and to listing-looking paths when the directory has a shape). */
export function filterWebResults(urls: string[], dir: CitationDirectory): string[] {
  const out: string[] = [];
  for (const u of urls) {
    try {
      const x = new URL(u);
      if (!onDirectory(x.href, dir) || x.pathname === "/") continue;
      x.hash = "";
      if (!out.includes(x.href)) out.push(x.href);
    } catch { /* not a URL */ }
  }
  const shaped = out.filter((u) => { const x = new URL(u); return dir.listingPath.test(`${x.pathname}${x.search}`); });
  return (shaped.length ? shaped : out).slice(0, MAX_CANDIDATES);
}

// ── web search ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Google Programmable Search when its id and key are set (the clean, paid path); otherwise the free engines' HTML. */
export const webSearchMode = (): "cse" | "web" | "off" => {
  const v = (process.env.CITATION_WEB_SEARCH || "").trim().toLowerCase();
  if (v === "off") return "off";
  if (v === "web" || v === "ddg" || v === "bing") return "web";
  return cseConfigured() ? "cse" : "web";
};

/** Parse Bing's HTML results page into result URLs. Exported for tests. */
export function parseBing(html: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  $("li.b_algo h2 a[href], li.b_algo a.tilk[href], #b_results h2 a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    if (/^https?:\/\//.test(href) && !/bing\.com\//.test(href) && !urls.includes(href)) urls.push(href);
  });
  return urls;
}

/** Parse DuckDuckGo's HTML results page into result URLs. Exported for tests. */
export function parseDuckDuckGo(html: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  $("a.result__a, a.result__url, .result__body a[href], a.result-link, a[href*='uddg=']").each((_, a) => {
    const href = $(a).attr("href") || "";
    let u = href;
    try {
      const x = new URL(href, "https://duckduckgo.com");
      const uddg = x.searchParams.get("uddg");
      if (uddg) u = uddg;
      else if (x.hostname.endsWith("duckduckgo.com")) return;
      else u = x.href;
    } catch { return; }
    if (/^https?:\/\//.test(u) && !urls.includes(u)) urls.push(u);
  });
  return urls;
}

export async function defaultWebSearch(q: string, dir: CitationDirectory): Promise<string[]> {
  const mode = webSearchMode();
  if (mode === "off") return [];
  if (mode === "cse") {
    const env = process.env;
    const key = (env.GOOGLE_CSE_KEY || env.GOOGLE_PLACES_API_KEY || "").trim();
    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.search = new URLSearchParams({ key, cx: env.GOOGLE_CSE_CX!.trim(), q, gl: "us", hl: "en", num: "10", safe: "off" }).toString();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
      const json: any = await r.json().catch(() => ({}));
      if (!r.ok) return [];
      return (Array.isArray(json?.items) ? json.items : []).map((it: any) => (typeof it?.link === "string" ? it.link : "")).filter(Boolean);
    } catch { return []; }
  }
  void dir;
  // DuckDuckGo answers a bot wall with 202; its two HTML hosts behave differently per network, so both are tried, then Bing.
  for (const base of ["https://lite.duckduckgo.com/lite/?q=", "https://duckduckgo.com/html/?q=", "https://html.duckduckgo.com/html/?q="]) {
    const page = await loadHttp(`${base}${encodeURIComponent(q)}`);
    if (page.blocked || page.status !== 200) continue;
    const urls = parseDuckDuckGo(page.body);
    if (urls.length) return urls;
  }
  const bing = await loadHttp(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`);
  if (!bing.blocked && bing.status === 200) return parseBing(bing.body);
  return [];
}

export const defaultDeps: FinderDeps = { load: loadPage, webSearch: defaultWebSearch, budgetMs: 90_000 };

// ── the check ─────────────────────────────────────────────────────────────────────────────────────────────────────
function verdictFromPage(page: Loaded, profile: BusinessProfile, how: How): Found | null {
  if (page.blocked || page.status < 200 || page.status >= 300 || !page.body) return null;
  const a = analyzeDirectoryProfile({ url: page.url, status: page.status, body: page.body }, profile);
  const base = { listingUrl: page.url, how, evidence: { checked: [], candidates: [], searchUrl: null, title: a.evidence.title } };
  if (a.evidence.confirmation === "confirmed" && a.nap) {
    const addressUnread = ["street_address", "city", "postal_code"].every((f) => a.nap!.fields[f]?.result === "missing") && profile.service_area_only !== true;
    const wrong = Object.values(a.nap.fields).some((f) => f.result === "differs" && f.required);
    if (wrong) {
      const diffs = Object.entries(a.nap.fields).filter(([, f]) => f.result === "differs").map(([k]) => k.replace("_", " "));
      return { ...base, result: "mismatch", partial: false, fields: a.nap.fields, reason: `Listed, but the ${diffs.join(" and ")} on the site ${diffs.length > 1 ? "differ" : "differs"} from your Google Business Profile.` };
    }
    return { ...base, result: "match", partial: addressUnread, fields: a.nap.fields, reason: addressUnread ? "Listed; name and phone match. The site does not show the address in a form a program can read, so check it by eye." : "Listed; name, phone and address match your Google Business Profile." };
  }
  // No structured data: the page itself names the business and shows its phone.
  const $ = cheerio.load(page.body);
  $("script,style,noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  if (nameOverlap(profile.name ?? "", $("title").text() + " " + $("h1").first().text()) >= 0.75 && hasPhone(profile.phone, text)) {
    return { ...base, result: "match", partial: true, fields: null, reason: "Listed; the page names your business and shows your phone number. The address could not be read by a program, so check it by eye." };
  }
  return null;
}

export async function checkDirectory(dir: CitationDirectory, profile: BusinessProfile, knownListingUrl: string | null, deps: FinderDeps = defaultDeps): Promise<Found> {
  const evidence: Found["evidence"] = { checked: [], candidates: [], searchUrl: null, title: null };
  const t0 = Date.now();
  const budget = deps.budgetMs ?? 90_000;
  const outOfTime = () => Date.now() - t0 > budget;
  if (dir.manualOnly) return { result: "unsupported", listingUrl: knownListingUrl, reason: dir.manualOnly, how: "none", fields: null, partial: false, evidence };

  const candidates: Candidate[] = [];
  let best: Found | null = null;
  // A listing link the owner saved is the first thing read: confirmed there, the search is only a duplicate check.
  if (knownListingUrl && onDirectory(knownListingUrl, dir)) {
    const page = await deps.load(knownListingUrl, dir.mode);
    evidence.checked.push(knownListingUrl);
    best = verdictFromPage(page, profile, "listing_url");
    if (best && best.result === "match" && !best.partial) return { ...best, evidence: { ...evidence, title: best.evidence.title } };
    if (!best) candidates.push({ url: knownListingUrl, from: "listing_url", score: 100 });
  }

  const q: SearchQuery = { name: profile.name ?? "", city: profile.city, state: profile.state, zip: profile.zip, place: placeOf(profile) };
  let searchSaysNotFound = false, searchBlocked = false, searchNamePhone = false;
  if (dir.search && q.name) {
    const url = dir.search(q);
    evidence.searchUrl = url;
    const page = await deps.load(url, dir.mode);
    evidence.checked.push(url);
    if (page.blocked || page.status < 200 || page.status >= 300) searchBlocked = true;
    else {
      const found = candidatesFromSearchPage(page.body, page.url, dir, profile);
      for (const c of found.candidates) if (!candidates.some((x) => x.url === c.url)) candidates.push(c);
      searchNamePhone = found.namePresent && found.phonePresent;
      // The page lists businesses, none of them ours.
      searchSaysNotFound = !found.namePresent && found.listingLinks >= 3;
    }
  }

  if (candidates.length === 0 && q.name && !outOfTime()) {
    const query = `site:${dir.url} "${q.name}" ${q.city || q.zip}`.trim();
    const urls = filterWebResults(await deps.webSearch(query, dir), dir);
    for (const u of urls) candidates.push({ url: u, from: "web_search", score: 1 });
  }
  evidence.candidates = candidates.map((c) => c.url);

  for (const c of candidates.slice(0, MAX_CANDIDATES + 1)) {
    if (outOfTime()) break;
    if (c.from === "listing_url" && evidence.checked.includes(c.url)) continue;   // read above
    const page = await deps.load(c.url, dir.mode);
    evidence.checked.push(c.url);
    const v = verdictFromPage(page, profile, c.from);
    if (!v) continue;
    if (!best || (best.partial && !v.partial) || (best.result === "mismatch" && v.result === "match" && !v.partial)) best = v;
    if (best.result === "match" && !best.partial) break;
  }
  if (best) return { ...best, evidence: { ...evidence, title: best.evidence.title } };

  if (searchNamePhone) {
    return { result: "match", listingUrl: candidates[0]?.url ?? null, how: "search_page", fields: null, partial: true, evidence,
      reason: `${dir.name}'s own search shows your business with your phone number. The listing page itself could not be read, so check the address by eye.` };
  }
  if (candidates.length) {
    return { result: "unconfirmed", listingUrl: null, how: candidates[0].from, fields: null, partial: false, evidence,
      reason: `Found what looks like your listing, but ${dir.name} would not let a program read it. Open the link and mark the row yourself.` };
  }
  if (searchSaysNotFound) {
    return { result: "not_found", listingUrl: null, how: "search_page", fields: null, partial: false, evidence,
      reason: `Searched ${dir.name} for “${q.name}” in ${q.place || "your area"}: it lists other businesses, not yours.` };
  }
  return { result: "unconfirmed", listingUrl: null, how: "none", fields: null, partial: false, evidence,
    reason: searchBlocked ? `${dir.name} blocks automatic checks and the web search found no listing. Use Search and mark the row yourself.`
      : dir.search ? `${dir.name}'s search did not show your business and the web search found no listing — not proof it is missing. Use Search and mark the row yourself.`
      : `${dir.name} has no search a program can use and the web search found no listing. Use Search and mark the row yourself.` };
}
