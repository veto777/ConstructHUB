/**
 * Vetting: read a candidate with our own crawler (the SSRF-safe fetcher Site Scan uses), record what is on it,
 * and grade it. Pure parts (analyzePage, gradeSource) are separate from the fetch so they are tested on saved
 * HTML. A grade rests only on what was read: unmeasured authority is said, never assumed.
 */
import * as cheerio from "cheerio";
import type { BacklinkKind, BacklinkMetrics, BacklinkSignals, BacklinkTier, LinkType } from "@shared/backlinks";
import { safeFetch as siteFetch, type PageResponse } from "../sitescan/http";
import { normalizeDomain } from "./discover";

/** Contractor / home-service vocabulary: how on-topic a page is. Specific trade words only — "home", "window",
 *  "install" and "repair" alone also describe software, cars and electronics (Raspberry Pi's "Windows 10" doorbell). */
const NICHE_WORDS = /\b(roof(s|ing|er|ers)?|plumb(ing|er|ers)|hvac|furnaces?|air condition(ing|ers?)|electricians?|remodel(s|ing|ers?)?|renovat(e|es|ed|ion|ions|ing)|contractors?|construction|home ?builders?|home improvements?|homeowners?|landscap(e|es|ing|ers?)|kitchens?|bathrooms?|flooring|siding|gutters?|replacement windows|window (installation|replacement)|concrete|decks?|decking|fenc(e|es|ing)|drywall|insulation|masonry|carpentry|handyman|house painting|painting contractors?|solar (panels?|install\w*)|foundation repair|basements?|cabinets?|countertops?|garage doors?|tile|tiling)\b/gi;
const NICHE_ONE = new RegExp(NICHE_WORDS.source, "i");

/** A page that IS the site's invitation (in its title, heading or address) — or a link to one. */
const SUBMISSION_PAGE = /write[- ]?for[- ]?us|guest[- ]?post(ing)?[- ]?guidelines|contribut(e|or|ors)([- ]guidelines)?\b|become[- ]a[- ]contributor|submission[- ]guidelines|submit[- ](a[- ])?(guest[- ]?post|article|story|press[- ]release|your[- ](business|listing|site|press release))|add[- ](your[- ])?(business|listing|company)|list[- ]your[- ]business|claim[- ](your[- ])?listing|send[- ]us[- ]a[- ](news[- ])?tip|press[- ]release[- ]submission/i;

/** Pages ABOUT guest posting (lists of sites, sellers, agencies' case studies) and job boards are not publishers. */
const LIST_PAGE: { why: string; re: RegExp }[] = [
  { why: "a list of guest-post sites", re: /(guest[- ]?post(ing)?|backlinks?|blog commenting)[- ](sites?|websites?|list|lists)\b|free[- ]guest[- ]posting|sites?[- ](that[- ])?accept(ing)?[- ]guest[- ]posts?|top[- ]\d+[- ].*guest[- ]?post|high[- ](da|dr|pa)\b/i },
  { why: "a guest-post / link-building seller", re: /(guest[- ]?post(ing)?|link[- ]building|backlinks?|outreach)[- ](services?|packages?|agency|case[- ]stud(y|ies)|pricing|marketplace)|buy[- ](guest[- ]?posts?|backlinks?)/i },
  { why: "a job board", re: /job[- ]?search|\/jobs?\/|\bjobs? (board|listings?)\b/i },
];
const PROFILE_PATH = /^\/(@[^/]+|(profiles?|users?|members?|people|u|authors?|community\/profile)\/)/i;

/** Sites written for another country's audience: no use to a US contractor's local SEO. Generic-use ccTLDs are kept. */
const GENERIC_CCTLD = new Set(["us", "co", "io", "ai", "me", "tv", "cc", "ly", "fm", "to", "ws"]);
export function foreignTld(domain: string): string | null {
  const tld = domain.split(".").pop() ?? "";
  return tld.length === 2 && !GENERIC_CCTLD.has(tld) ? tld : null;
}

/** Is the SITE about home improvement / construction? Its home page title names a trade, or trade words are dense on it. */
export function siteOnTopic(s: BacklinkSignals): boolean {
  const title = s.homeTitle ?? s.title ?? "";
  const hits = s.homeNicheHits ?? s.nicheHits, words = s.homeWords ?? s.words;
  return NICHE_ONE.test(title) || (hits >= 8 && (hits * 1000) / Math.max(words, 1) >= 4);
}

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
  let submissionLink: string | null = null;
  let path = "/";
  try { path = new URL(page.url).pathname; } catch { /* keep "/" */ }
  const heading = `${$("title").first().text()} ${$("h1").first().text()}`;
  const profilePage = PROFILE_PATH.test(path);
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
    if (!submissionLink && host && (host === domain || host.endsWith(`.${domain}`)) && SUBMISSION_PAGE.test(label) && !PROFILE_PATH.test(abs.pathname)) submissionLink = abs.href;
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
    // A user profile on a platform never speaks for the site, even when it says "guest posting".
    submissionUrl: profilePage ? null : SUBMISSION_PAGE.test(`${heading} ${decodeURIComponent(path)}`) ? page.url : submissionLink,
    profilePage,
    listPage: LIST_PAGE.find((l) => l.re.test(`${heading} ${decodeURIComponent(path)}`))?.why ?? null,
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
    // `a` is the page the search found, `b` the home page.
    submissionUrl: a.submissionUrl ?? b.submissionUrl ?? null,
    profilePage: a.profilePage,
    listPage: a.listPage ?? null,
    homeTitle: b.title,
    homeNicheHits: b.nicheHits,
    homeWords: b.words,
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
  // Authority alone never makes a source "quality": whether it takes submissions is unknown until a person checks.
  reasons.push(`domain rank ${m.rank}; capped at C until someone confirms the site takes submissions`);
  return { kind, tier: "C", score: 30, reasons, linkType };
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
  // 2026-10-13 hard rules (owner: "fix everything"): a source is real only when the SITE invites it, the site is about
  // the trades (for content links), and it is a publisher — not a list, a seller, a job board or a foreign-market site.
  const tld = foreignTld(normalizeDomain(s.fetchedUrl) ?? "");
  if (tld) return stop(`A site for an audience outside the US (.${tld})`);
  if (s.listPage) return stop(`The page found is ${s.listPage}, not a publisher`);
  if (!s.submissionUrl) return stop(s.profilePage
    ? "Found on a user profile — the site itself does not invite submissions"
    : "No page on the site invites submissions (a phrase inside an article does not count)");
  const topical = kind === "guest_post" || kind === "resource_page" || kind === "editorial";
  if (topical && !siteOnTopic(s)) return stop(`The site is not about home improvement or construction (home page: "${(s.homeTitle ?? s.title ?? "").slice(0, 80)}")`);

  let score = 30;
  const add = (n: number, why: string) => { score += n; reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`); };
  if (s.https) add(5, "HTTPS"); else add(-5, "no HTTPS");
  if (s.words >= 600) add(10, `${s.words} words of content`); else if (s.words < 200) add(-10, `thin page (${s.words} words)`);
  add(15, `invites submissions on its own page (${s.submissionUrl})`);
  if (s.emails.length || s.contactUrl) add(5, s.emails.length ? "publishes a contact email" : "has a contact page");
  if (topical) add(10, "the site is about home improvement / construction");
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
