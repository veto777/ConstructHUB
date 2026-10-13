/**
 * Vetting: read a candidate with our own crawler (the SSRF-safe fetcher Site Scan uses), record what is on it,
 * and grade it. Pure parts (analyzePage, gradeSource) are separate from the fetch so they are tested on saved
 * HTML. A grade rests only on what was read: unmeasured authority is said, never assumed.
 */
import * as cheerio from "cheerio";
import type { BacklinkKind, BacklinkMetrics, BacklinkSignals, BacklinkTier, LinkType } from "@shared/backlinks";
import { safeFetch as siteFetch, type PageResponse } from "../sitescan/http";
import { normalizeDomain } from "./discover";

/** Contractor / home-service vocabulary: how on-topic a page is. */
const NICHE_WORDS = /\b(roof\w*|plumb\w*|hvac|heating|cooling|air condition\w*|electric\w*|remodel\w*|renovat\w*|contractor\w*|construction|builder\w*|home improvement|homeowner\w*|landscap\w*|kitchen|bathroom|flooring|siding|gutter\w*|window\w*|concrete|paint\w*|solar|real estate|house|home\w*|repair\w*|install\w*)\b/gi;

const SUBMISSION_PATTERNS: { hint: string; re: RegExp; kind: BacklinkKind }[] = [
  { hint: "write for us", re: /write for us/i, kind: "guest_post" },
  { hint: "guest post guidelines", re: /guest[- ]post(ing)? guidelines|contributor guidelines|submission guidelines/i, kind: "guest_post" },
  { hint: "submit a guest post", re: /submit (a )?guest post|accepting guest posts|become a contributor/i, kind: "guest_post" },
  { hint: "submit press release", re: /submit (a |your )?press release|press release submission|publish your press release/i, kind: "press_release" },
  { hint: "add your business", re: /add (your )?(business|listing|company)|list your business|claim (your )?listing|submit (your )?(business|listing|site)/i, kind: "directory" },
  { hint: "member directory", re: /member(ship)? directory|find a (member|contractor)/i, kind: "citation" },
  { hint: "resources page", re: /helpful resources|useful links|recommended (links|resources)/i, kind: "resource_page" },
  { hint: "send us a tip", re: /send (us )?a (news )?tip|submit a story|pitch us|media inquiries/i, kind: "editorial" },
];

const SPAM_PATTERNS: { hint: string; re: RegExp }[] = [
  { hint: "casino/betting", re: /\b(casino|slot(s| machine)|sportsbook|betting odds|gambling)\b/i },
  { hint: "pharma", re: /\b(viagra|cialis|pharmacy online|buy (pills|tramadol))\b/i },
  { hint: "adult", re: /\b(porn|escort(s)? service|xxx|adult dating)\b/i },
  { hint: "CBD/vape", re: /\b(cbd oil|delta[- ]8|vape juice|kratom)\b/i },
  { hint: "payday loans", re: /\b(payday loans?|title loans?|bad credit loans?)\b/i },
  { hint: "essay mills", re: /\b(essay writing service|write my essay)\b/i },
];

/** Footprints of a site that exists to sell links (a PBN or link farm), not to be read. */
const PBN_PATTERNS: { hint: string; re: RegExp }[] = [
  { hint: "sells links", re: /\b(buy (a )?(backlinks?|guest posts?)|link insertion|niche edits?|sponsored post price|guest post price)\b/i },
  { hint: "all niches", re: /\b(we accept all niches|all niches accepted|any niche)\b/i },
  { hint: "authority bait", re: /\b(DA|DR|PA)\s*\d{2}\+?\s*(guest post|site|blog)/i },
  { hint: "casino posts accepted", re: /\b(casino|cbd|crypto) (posts|articles) (are )?(accepted|allowed)\b/i },
];

/** Mentions of one spam topic before it counts (a press wire or news site names casinos in a headline now and then). */
export const SPAM_MIN_MENTIONS = 3;

const PARKED = /\b(this domain (is|may be) for sale|buy this domain|domain parking|parked free|is for sale!?|sedo|dan\.com|afternic|hugedomains)\b/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
/** Image-file and placeholder addresses scraped from markup that are not mailboxes. */
const NOT_A_MAILBOX = /\.(png|jpe?g|gif|webp|svg)$|@(example|domain|email|sentry|wixpress)\.|^(name|your|you|user|email)@/i;

/** Emails published on the page: mailto: links and plain text. Only addresses on the site's own domain or a mail provider are kept. */
export function extractEmails($: cheerio.CheerioAPI, siteDomain: string): string[] {
  const found = new Set<string>();
  $("a[href^='mailto:' i]").each((_, a) => {
    const v = decodeURIComponent(String($(a).attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0]).trim().toLowerCase();
    if (v) found.add(v);
  });
  for (const m of $.root().text().match(EMAIL) ?? []) found.add(m.toLowerCase());
  const base = siteDomain.split(".").slice(-2).join(".");
  return [...found].filter((e) => {
    if (NOT_A_MAILBOX.test(e) || e.length > 120) return false;
    const host = e.split("@")[1] ?? "";
    // The site's own domain (or a sub-domain of it), or a webmail address a small publisher runs on.
    return host === siteDomain || host.endsWith(`.${base}`) || host === base || /^(gmail|outlook|hotmail|yahoo|icloud|proton(mail)?)\.(com|me)$/.test(host);
  }).slice(0, 10);
}

/** What one fetched page says about the site. */
export function analyzePage(page: { url: string; status: number; body: string }): BacklinkSignals {
  const domain = normalizeDomain(page.url) ?? "";
  const $ = cheerio.load(page.body || "");
  $("script, style, noscript, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  const rel = { dofollow: 0, nofollow: 0, sponsored: 0 };
  let outbound = 0;
  let contactUrl: string | null = null;
  const submissionHints = new Set<string>();
  $("a[href]").each((_, a) => {
    const href = String($(a).attr("href") ?? "");
    let abs: URL | null = null;
    try { abs = new URL(href, page.url); } catch { return; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    const label = `${$(a).text()} ${abs.pathname}`.toLowerCase();
    const host = normalizeDomain(abs.href);
    if (host && host !== domain && !host.endsWith(`.${domain}`)) {
      outbound++;
      const r = String($(a).attr("rel") ?? "").toLowerCase();
      if (/sponsored/.test(r)) rel.sponsored++; else if (/nofollow|ugc/.test(r)) rel.nofollow++; else rel.dofollow++;
    } else if (!contactUrl && /\bcontact\b/.test(label)) contactUrl = abs.href;
    for (const p of SUBMISSION_PATTERNS) if (p.re.test(label)) submissionHints.add(p.hint);
  });
  const scan = `${$("title").text()} ${text}`.slice(0, 200_000);
  for (const p of SUBMISSION_PATTERNS) if (p.re.test(scan)) submissionHints.add(p.hint);
  return {
    fetchedUrl: page.url,
    httpStatus: page.status,
    https: page.url.startsWith("https:"),
    title: $("title").first().text().trim().slice(0, 200) || null,
    lang: ($("html").attr("lang") ?? "").trim().toLowerCase() || null,
    words,
    outboundLinks: outbound,
    nicheHits: (scan.match(NICHE_WORDS) ?? []).length,
    acceptsSubmissions: submissionHints.size > 0,
    submissionHints: [...submissionHints],
    // A spam topic counts when the site is ABOUT it — in the title or mentioned again and again — not when one news headline names it.
    spamHints: SPAM_PATTERNS.filter((p) => p.re.test($("title").text()) || (scan.match(new RegExp(p.re.source, "gi")) ?? []).length >= SPAM_MIN_MENTIONS).map((p) => p.hint),
    pbnHints: PBN_PATTERNS.filter((p) => p.re.test(scan)).map((p) => p.hint),
    parked: PARKED.test(scan) && words < 400,
    emails: extractEmails($, domain),
    contactUrl,
    rel,
  };
}

/** Two pages of one site (the page the search found and its home page) → one set of signals. */
export function mergeSignals(a: BacklinkSignals, b: BacklinkSignals | null): BacklinkSignals {
  if (!b) return a;
  const u = <T,>(x: T[], y: T[]) => [...new Set([...x, ...y])];
  return {
    ...a,
    // The page that loaded speaks for the site: a blocked or missing found page does not hide a home page that answered.
    ...(a.httpStatus > 0 && a.httpStatus < 400 ? {} : { fetchedUrl: b.fetchedUrl, httpStatus: b.httpStatus, https: b.https }),
    title: a.title ?? b.title,
    lang: a.lang ?? b.lang,
    words: Math.max(a.words, b.words),
    outboundLinks: Math.max(a.outboundLinks, b.outboundLinks),
    nicheHits: a.nicheHits + b.nicheHits,
    acceptsSubmissions: a.acceptsSubmissions || b.acceptsSubmissions,
    submissionHints: u(a.submissionHints, b.submissionHints),
    spamHints: u(a.spamHints, b.spamHints),
    pbnHints: u(a.pbnHints, b.pbnHints),
    parked: a.parked && b.parked,
    emails: u(a.emails, b.emails).slice(0, 10),
    contactUrl: a.contactUrl ?? b.contactUrl,
    rel: { dofollow: a.rel.dofollow + b.rel.dofollow, nofollow: a.rel.nofollow + b.rel.nofollow, sponsored: a.rel.sponsored + b.rel.sponsored },
  };
}

export type Grade = { kind: BacklinkKind; tier: BacklinkTier; score: number; reasons: string[]; linkType: LinkType };

/** The kind the page itself shows, when it shows one; otherwise the kind of search that found it. */
export function classifyKind(hint: BacklinkKind, s: BacklinkSignals): BacklinkKind {
  if (s.pbnHints.length >= 2) return "pbn";
  const shown = SUBMISSION_PATTERNS.filter((p) => s.submissionHints.includes(p.hint)).map((p) => p.kind);
  if (shown.includes(hint)) return hint;
  // Directory vs citation is decided by the search (a state search found it → a local citation).
  if (hint === "citation" && shown.includes("directory")) return "citation";
  return shown[0] ?? hint;
}

/** Answers that mean "not to robots", not "gone": the site is unconfirmed, never rejected for it (CLAUDE.md link policy). */
export const BOT_WALL = new Set([401, 403, 429, 503]);

/** A site that blocked the crawler: nothing on the page is known, so authority alone grades it — C until measured. */
function gradeBlocked(kind: BacklinkKind, status: number, m: BacklinkMetrics | null, linkType: LinkType): Grade {
  const reasons = [`Unconfirmed: the site blocked our crawler (${status}); on-page checks could not run`];
  if (!m || m.rank == null) return { kind, tier: "C", score: 30, reasons: [...reasons, "authority not measured yet"], linkType };
  if (m.spamScore != null && m.spamScore >= 40) return { kind, tier: "X", score: 0, reasons: [...reasons, `Spam score ${m.spamScore}/100`], linkType };
  const score = Math.max(0, Math.min(100, Math.round(20 + m.rank / 10)));
  reasons.push(`domain rank ${m.rank} sets the grade`);
  return { kind, tier: score >= 70 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "X", score, reasons, linkType };
}

/**
 * The grade, 0–100, with every reason that moved it. A = 70+, B = 50+, C = 30+, X below or on a hard stop.
 * Without authority numbers the tier is capped at B: on-page signs alone do not make a source "strong".
 */
export function gradeSource(hint: BacklinkKind, s: BacklinkSignals, m: BacklinkMetrics | null): Grade {
  const reasons: string[] = [];
  const kind = classifyKind(hint, s);
  const relTotal = s.rel.dofollow + s.rel.nofollow + s.rel.sponsored;
  const linkType: LinkType = relTotal < 3 ? "unknown" : s.rel.sponsored / relTotal > 0.5 ? "sponsored" : s.rel.nofollow / relTotal > 0.6 ? "nofollow" : "dofollow";
  const stop = (why: string): Grade => ({ kind, tier: "X", score: 0, reasons: [...reasons, why], linkType });
  if (BOT_WALL.has(s.httpStatus)) return gradeBlocked(kind, s.httpStatus, m, linkType);
  if (s.httpStatus >= 400 || s.httpStatus === 0) return stop(`The site answered ${s.httpStatus || "nothing"}`);
  if (s.parked) return stop("Parked or for-sale domain");
  if (s.lang && !s.lang.startsWith("en")) return stop(`Not an English site (lang="${s.lang}")`);
  if (kind === "pbn") return stop(`Looks like a private blog network / link seller (${s.pbnHints.join(", ")})`);
  if (s.spamHints.length >= 2) return stop(`Spam topics on the site (${s.spamHints.join(", ")})`);
  if (m?.spamScore != null && m.spamScore >= 40) return stop(`Spam score ${m.spamScore}/100`);

  let score = 30;
  const add = (n: number, why: string) => { score += n; reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`); };
  if (s.https) add(5, "HTTPS"); else add(-5, "no HTTPS");
  if (s.words >= 600) add(10, `${s.words} words of content`); else if (s.words < 200) add(-10, `thin page (${s.words} words)`);
  if (s.acceptsSubmissions) add(15, `takes submissions (${s.submissionHints.join(", ")})`);
  if (s.emails.length || s.contactUrl) add(5, s.emails.length ? "publishes a contact email" : "has a contact page");
  const topical = kind === "guest_post" || kind === "resource_page" || kind === "editorial";
  if (topical) {
    if (s.nicheHits >= 15) add(10, "on-topic for contractors"); else if (s.nicheHits < 3) add(-10, "off-topic for contractors");
  }
  if (s.spamHints.length === 1) add(-15, `spam topic on the site (${s.spamHints[0]})`);
  if (s.pbnHints.length === 1) add(-15, `link-selling language (${s.pbnHints[0]})`);
  if (s.outboundLinks > 150) add(-10, `${s.outboundLinks} outbound links on one page`);
  if (linkType === "nofollow" || linkType === "sponsored") add(-5, `its outbound links are mostly ${linkType}`);
  if (m) {
    if (m.rank != null) {
      if (m.rank >= 400) add(25, `domain rank ${m.rank}`);
      else if (m.rank >= 250) add(15, `domain rank ${m.rank}`);
      else if (m.rank >= 150) add(5, `domain rank ${m.rank}`);
      else add(-10, `low domain rank ${m.rank}`);
    }
    if (m.referringDomains != null && m.referringDomains < 20) add(-10, `only ${m.referringDomains} referring domains`);
    if (m.spamScore != null && m.spamScore >= 20) add(-10, `spam score ${m.spamScore}/100`);
  } else reasons.push("authority not measured yet (tier capped at B)");
  score = Math.max(0, Math.min(100, score));
  let tier: BacklinkTier = score >= 70 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "X";
  if (!m && tier === "A") tier = "B";
  return { kind, tier, score, reasons, linkType };
}

export const vetDeps = { fetch: siteFetch as (url: string) => Promise<PageResponse> };

/** Fetch the found page and the home page (two requests at most) → merged signals. Throws when neither loads. */
export async function readSite(discoveredUrl: string, domain: string): Promise<BacklinkSignals> {
  const home = `https://${domain}/`;
  const first = await vetDeps.fetch(discoveredUrl).then(analyzePage).catch(() => null);
  const sameAsHome = (u: string) => normalizeDomain(u) === domain && new URL(u).pathname.replace(/\/$/, "") === "";
  const second = sameAsHome(discoveredUrl) ? null : await vetDeps.fetch(home).then(analyzePage).catch(() => null);
  if (!first && !second) throw new Error("The site could not be loaded");
  return first ? mergeSignals(first, second) : second!;
}
