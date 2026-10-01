/**
 * Hub output filter (guardrails §6). Every model reply — chat answers and the
 * cached preset answers alike — passes through filterOutput() before it can
 * reach a browser. Model output is attacker-controlled: a reply that fails a
 * check is never repaired and sent, it is replaced by R_FALLBACK. The only
 * repairs are the strip / rewrite / truncate steps marked below.
 *
 * Pure: no DB, no request, no model.
 */
import { PLANS, PLAN_KEYS, SALES_THRESHOLD_CENTS, TRIAL_DAYS } from "@shared/plans";
import { hubLinkFor } from "@shared/hub-links";
import { DFY_CATALOG, COURSE_BUNDLE } from "../catalog";
import { cleanText } from "./prefilter";
import { hardRulesText, NOT_SURE_LINE, REDIRECT_LINE, CANARY } from "./prompt";
import { knowledgeBook, type KnowledgeBook } from "./knowledge";

export type OCode = "O1" | "O2" | "O4" | "O6" | "O7" | "O8" | "O9" | "O10" | "O11" | "O12" | "O13" | "O14" | "O15" | "O16";
export type ModelOutput = { content?: string | null; finishReason?: string | null; toolCalls?: unknown; functionCall?: unknown };
export type FilterOptions = { publicOnly: boolean; canary?: string; book?: KnowledgeBook };
export type FilterResult = { ok: true; text: string } | { ok: false; code: OCode };

class Blocked extends Error { constructor(readonly code: OCode) { super(code); } }
const block = (code: OCode): never => { throw new Blocked(code); };

const NEG = /\b(no|not|never|nothing|none|isn'?t|aren'?t|doesn'?t|don'?t|can'?t|cannot|won'?t|neither|nor)\b/i;
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const TLDS = "com|net|org|io|us|app|co|ai|dev|gov|edu|info|biz|xyz|me|ly|gg";

// O4
const ACTIVE = /<script|<iframe|<object|<embed|<svg|<style|<img|\bon(click|error|load|mouse\w+|focus|blur|submit|change|key\w+)\s*=|javascript:|vbscript:|\bdata:[a-z]+\/|```|!\[/i;

// O6
const MD_LINK = /\[([^\]\n]{1,80})\]\(([^)\s]+)\)/g;
const OWN_URL = /^https?:\/\/(?:www\.)?constructhub\.us(\/\S*)?$/i;
const PLAIN_OWN_HOST = /^(?:www\.|portal\.)?constructhub\.us$/i;
const IP_LITERAL = /\d{1,3}(?:\.\d{1,3}){3}/;
const OTHER_SCHEME = /\b(mailto|tel|sms|ftp|file|intent|chrome|about):/i;
const BARE_URL = /\bhttps?:\/\/[^\s)<>\]]+|\bwww\.[^\s)<>\]]+/gi;
const PROTOCOL_RELATIVE = /(?<![\w:/])\/\/[^\s/]+/;
const BARE_DOMAIN = new RegExp(String.raw`\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:${TLDS})\b(\/[^\s)<>\]]*)?`, "gi");

// O7
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAIL_OBFUSCATED = /[\w.+-]+\s*[([]\s*at\s*[)\]]\s*[\w-]+\s*[([]\s*dot\s*[)\]]\s*[a-z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const DIGIT_RUN = /\d(?:[\s.()-]?\d){6,}/;
const ADDRESS = /\b\d{1,6} [A-Z][a-z]+ (St|Street|Ave|Rd|Blvd|Dr|Ln|Way|Ct)\b/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const EIN = /\b\d{2}-\d{7}\b/;
const CARD = /\b(?:\d[ -]?){12,18}\d\b/;

// O10
const PLAN_NAMES = PLAN_KEYS.map((k) => PLANS[k].name);
const PLAN_WORD_OK = new Set([
  ...PLAN_NAMES, "Every", "Each", "Any", "Which", "This", "That", "Your", "The", "No", "Paid", "Monthly", "Annual",
  "Yearly", "Pricing", "A", "An", "One", "Our", "My", "Their", "Current", "New", "Same", "Right", "Cheapest", "Higher",
  "Lower", "Bigger", "Larger", "Smaller", "Other", "Different", "Cloudflare", "Blotato", "Google", "Stripe",
  "ConstructHUB", "ConstructHub", "Change", "Choose", "Switch", "Pick", "Select", "Compare", "Upgrade", "Downgrade", "Cancel",
]);
// From server/pricing-copy.test.ts: the plans sold before 2026-09-30 and retired copy.
const LEGACY_PLAN = /\b(Standard|Professional|Business|Premium|Gold|Platinum)\s+(plan|plans|member|members|subscriber|subscribers|tier)\b/i;
const LEGACY_WORDS = [/\bPlatinum\b/, /\$995\b/, /\$499\/mo/, /Unlimited everything/i, /\$9,999/, /billed separately/i, /separate membership/i];
const COMMERCIAL: RegExp[] = [
  /\b\d+\s?%\s?(off|discount)/i, /\bcoupons?\b/i, /\bpromo(tion|tional)? codes?\b/i, /\bdiscount codes?\b/i,
  /\blifetime (deal|plan|access)\b/i, /\bmoney[- ]back\b/i, /\bprice[- ]match/i, /\bfree trial/i, /\bunlimited\b/i,
];
/** Owner-maintained: things ConstructHUB does not sell. Blocked unless negated in the same sentence. */
export const NOT_SOLD: RegExp[] = [
  /\bwhite[- ]label(ed|ing)? (reseller|resale|program|platform|app|version|product|dashboard|crm|software)\b/i,
  /\bresell(er|ing)? (program|plan|rights)\b/i, /\b(iphone|android|ios|mobile|native) app\b/i, /\bpublic api\b/i,
  /\bapi access\b/i, /\bzapier\b/i, /\baffiliate program\b/i, /\bpartner program\b/i, /\b(phone|live chat|24\/7) support\b/i,
];

// O11
const SALES_ONLY_NAMES: string[] = [
  ...Object.values(DFY_CATALOG).map((item) => item.name.split(" — ")[0]),
  ...COURSE_BUNDLE.name.split(" — "), "Master Class", "Complete Business Build", "SEO program",
];

// O12
const ACTION_DONE = /\bI(?:'ve| have| just)? (sent|emailed|texted|created|scheduled|booked|updated|changed|cancel+ed|refunded|upgraded|downgraded|deleted|reset|added|submitted|forwarded)\b/i;
const ACTION_WILL = /\bI(?:'ll| will) (send|email|text|create|schedule|book|update|change|cancel|refund|upgrade|downgrade|delete|reset|add|submit|forward)\b/i;
const ACCESS = /\b(i can see|i see (that )?your|your account (shows|has|is)|our (records|database|system|logs) shows?|i('ve| have) access|according to your (account|records)|i (checked|looked (up|at)) your)\b/i;
const HUMAN = /\bi('m| am) (a )?(human|real person|person|employee|staff|team member)\b/i;
/** A real ConstructHUB button label ("I submitted the form — mark reported"), not a claim. */
const UI_LABELS = /\bI submitted the form\s*[—–-]\s*mark reported\b/gi;

// O13
const LEAKS: RegExp[] = [
  /system prompt/i, /\bmy (instructions|rules|guidelines|prompt)\b/i, /\bi was (told|instructed|programmed)\b/i,
  /\bknowledge (pack|base) (says|states)\b/i, /\bhard rules\b/i, /\binternal reference\b/i, /\bas an ai language model\b/i,
  /\btruthcoder?\b/i, /\bopenai\b/i, /gpt/i, /qwen/i, /llama/i, /abliterat/i, /ollama/i, /\blocalhost\b/i,
  /127\.0\.0\.1/, /\bvb\d/i, /ai_integrations/i, /\bapi[_ ]?key\s*(is|=|:)\s*\S/i, /\b(sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/,
];

// O14
const CODE: RegExp[] = [/\bdef \w+\(/, /\bfunction\s*\(/, /\bconsole\./, /\bimport\s+[\w{*].*\bfrom\s+['"]/, /#include/, /\bSELECT\b.+\bFROM\b/];
const PROFANITY = /\b(fuck\w*|shit\w*|bitch\w*|asshole\w*|bastard\w*|cunt\w*|motherf\w*|slut\w*|whore\w*|retard\w*|f[a@]gg?ot\w*|n[i1]gg(er|a)\w*|dickhead\w*|piss off)\b/i;
/** Other companies Hub never names. Google, Stripe, Cloudflare, SignalWire, Gmail, Blotato, HOVER and NETR Online are named integrations or sources in the pack. */
export const COMPETITORS: RegExp[] = [
  /\bjobber\b/i, /\bhousecall ?pro\b/i, /\bservice ?titan\b/i, /\bbuildertrend\b/i, /\bjob ?nimbus\b/i, /\bco ?construct\b/i,
  /\bbright ?local\b/i, /\bwhitespark\b/i, /\blocal ?falcon\b/i, /\bclick ?cease\b/i, /\btrace ?my ?ip\b/i, /\bbirdeye\b/i,
  /\bPodium\b/, /\bAngi\b/, /\bhome ?advisor\b/i, /\bthumbtack\b/i, /\bsemrush\b/i, /\bahrefs\b/i, /\bMoz\b/,
  /\byext\b/i, /\bacculynx\b/i, /\bprocore\b/i, /\bcompany ?cam\b/i, /\broofr\b/i, /\bworkiz\b/i, /\bfield ?edge\b/i,
  /\bservicem8\b/i, /\bkickserv\b/i, /\bJoist\b/, /\bhouzz\b/i, /\bgorilla ?desk\b/i, /\bcontractor foreman\b/i,
  /\bbark\.com\b/i, /\bnetworx\b/i, /\bclickguard\b/i, /\bppc protect\b/i, /\bfraud ?blocker\b/i, /\bgohighlevel\b/i,
  /\bhighlevel\b/i, /\bhubspot\b/i, /\bsalesforce\b/i, /\bnicejob\b/i, /\bgrade\.us\b/i,
];

// The spec's ten words plus more English-only function words ("That's outside my job site…" has just one of the ten).
const FUNCTION_WORDS = /\b(the|and|to|you|your|is|a|of|in|for|i|my|it|or|on|with|can|how|what|that|this|be|are|at|about|if|we|do|an|as|by|from|not|our)\b/gi;
export const MAX_REPLY_CHARS = 1200;

const normWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
let rulesGrams: Set<string> | null = null;
/** 8-word windows of the HARD RULES, minus the reply lines the rules tell the model to say. */
function rulesNgrams(): Set<string> {
  if (rulesGrams) return rulesGrams;
  const text = hardRulesText().split(REDIRECT_LINE).join(" ").split(NOT_SURE_LINE).join(" ");
  const words = normWords(text);
  rulesGrams = new Set<string>();
  for (let i = 0; i + 8 <= words.length; i++) rulesGrams.add(words.slice(i, i + 8).join(" "));
  return rulesGrams;
}

function toCents(numeric: string): number {
  return Math.round(Number(numeric.replace(/,/g, "")) * 100);
}

/** Last sentence end (or line end) at or before `limit`; -1 if none. */
function lastSentenceEnd(text: string, limit: number): number {
  let best = -1;
  for (const m of text.slice(0, limit + 1).matchAll(/[.!?](?=\s|$)|\n/g)) best = m.index! + (m[0] === "\n" ? 0 : 1);
  return best;
}

function checkHref(href: string, publicOnly: boolean): { path: string; keepLink: boolean } {
  if (/[@\\]|%2f|%5c|\.\./i.test(href) || IP_LITERAL.test(href) || OTHER_SCHEME.test(href)) block("O6");
  let path = href;
  if (!href.startsWith("/") || href.startsWith("//")) {
    const own = href.match(OWN_URL);
    if (!own) return block("O6");
    path = own[1] || "/";
  }
  const link = hubLinkFor(path);
  if (!link) block("O6");
  return { path, keepLink: !publicOnly || link!.public };
}

function run(out: ModelOutput, opts: FilterOptions): string {
  const book = opts.book ?? knowledgeBook();
  const canary = opts.canary ?? CANARY;

  // O1 — finish reason, tool calls, empty
  if (!["stop", "length"].includes(String(out.finishReason ?? ""))) block("O1");
  const hasTools = Array.isArray(out.toolCalls) ? out.toolCalls.length > 0 : !!out.toolCalls;
  if (hasTools || out.functionCall) block("O1");
  let t = typeof out.content === "string" ? out.content : "";
  if (!t.trim()) block("O1");

  // O2 — reasoning blocks (strip; an unclosed one blocks)
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const closer = t.toLowerCase().lastIndexOf("</think>");
  if (closer !== -1) t = t.slice(closer + "</think>".length);
  if (/<think>/i.test(t)) block("O2");

  // O3 — normalise (strip)
  t = cleanText(t).replace(/\n{3,}/g, "\n\n").trim();
  if (!t) block("O1");

  // O4 — active content
  if (ACTIVE.test(t)) block("O4");
  if (/<\/?visitor>/i.test(t)) block("O13");

  // O5 — other tags, headings, quotes, tables, entities (strip)
  // A bare structural tag named in prose ("paste it in your <head> section") keeps its name as a
  // plain word; every other tag is removed. No angle bracket survives either way.
  t = t.replace(/<\/?(head|body|html|header|footer|title)>/gi, "$1")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^[ \t]*#+[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(" – "))
    .replace(/&#x?[0-9a-f]+;?/gi, "")
    .replace(/&(amp|nbsp);/gi, (m) => (m.toLowerCase() === "&amp;" ? "&" : " "))
    .replace(/&[a-z]{2,8};/gi, "");

  // O6 — links and domains (rewrite / block)
  // Links are parked as placeholders; the checks below read their text, never their (checked) path.
  const kept: string[] = [];
  const keptText: string[] = [];
  const park = (markdown: string, text: string) => { kept.push(markdown); keptText.push(text); return `\u0001${kept.length - 1}\u0002`; };
  t = t.replace(MD_LINK, (_, text: string, href: string) => {
    const { path, keepLink } = checkHref(href, opts.publicOnly);
    return park(keepLink ? `[${text}](${path})` : text, text);
  });
  if (OTHER_SCHEME.test(t) || PROTOCOL_RELATIVE.test(t)) block("O6");
  t = t.replace(BARE_URL, (raw) => {
    const url = raw.replace(/[.,;:!?]+$/, "");
    const trail = raw.slice(url.length);
    const { path, keepLink } = checkHref(url.startsWith("www.") ? `https://${url}` : url, opts.publicOnly);
    const link = hubLinkFor(path)!;
    return park(keepLink ? `[${link.label}](${path})` : link.label, link.label) + trail;
  });
  t = t.replace(BARE_DOMAIN, (raw, pathPart: string | undefined) => {
    const host = pathPart ? raw.slice(0, raw.length - pathPart.length) : raw;
    if (!PLAIN_OWN_HOST.test(host)) return block("O6");
    if (!pathPart || pathPart === "/") return raw;
    const { path, keepLink } = checkHref(`https://${host.replace(/^portal\./i, "")}${pathPart.replace(/[.,;:!?]+$/, "")}`, opts.publicOnly);
    const link = hubLinkFor(path)!;
    return park(keepLink ? `[${link.label}](${path})` : link.label, link.label);
  });
  const linkless = t.replace(/\u0001(\d+)\u0002/g, (_, i: string) => keptText[Number(i)]);
  const restore = (s: string) => s.replace(/\u0001(\d+)\u0002/g, (_, i: string) => kept[Number(i)]);

  // O7 — contact details and identifiers
  for (const re of [EMAIL, EMAIL_OBFUSCATED, SSN, EIN, CARD, PHONE, DIGIT_RUN, ADDRESS]) if (re.test(linkless)) block("O7");

  // O8 — money
  for (const m of linkless.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)(\s?[kKmM]\b)?/g)) {
    if (m[2]) block("O8");
    const cents = toCents(m[1]);
    if (!book.allowedCents.has(cents)) block("O8");
    if (cents === SALES_THRESHOLD_CENTS && !/^\s*(or more|and up|and above|\+)/i.test(linkless.slice(m.index! + m[0].length))) block("O8");
  }
  for (const m of linkless.matchAll(/\b(\d[\d,]*(?:\.\d{1,2})?)\s?(dollars|usd|bucks)\b|\busd\s?\$?(\d[\d,]*(?:\.\d{1,2})?)/gi)) {
    if (!book.allowedCents.has(toCents(m[1] ?? m[3]))) block("O8");
  }
  if (/[€£¥₹]\s?\d|\b\d[\d,.]*\s?(eur|euros?)\b/i.test(linkless)) block("O8");
  for (const m of linkless.matchAll(/\b(\d+)\s?(cents?\b|¢)/gi)) if (!book.allowedCents.has(Number(m[1]))) block("O8");
  if (/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b[\w\s-]{0,30}\b(dollars|bucks)\b/i.test(linkless)) block("O8");

  const sentences = sentencesOf(linkless);

  // O9 — plan-price binding
  for (const s of sentences) {
    const names = new Set(s.match(/\b(Starter|Pro|Growth|Agency)\b/g) ?? []);
    if (names.size !== 1 || /add-?on|addon|extra|each|per location|seat|website|number|scan|pack|setup|band/i.test(s)) continue;
    const plan = PLANS[PLAN_KEYS.find((k) => PLANS[k].name === [...names][0])!];
    for (const m of s.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(\/\s?mo(?:nth)?\b|per month|a month|monthly|\/\s?yr\b|\/\s?year|per year|a year|annual(?:ly)?|yearly)?/gi)) {
      if (!m[2]) continue;
      const yearly = /yr|year|annual/i.test(m[2]);
      if (toCents(m[1]) !== (yearly ? plan.annualCents : plan.monthlyCents)) block("O9");
    }
  }

  // O10 — commercial claims
  for (const re of COMMERCIAL) if (re.test(linkless)) block("O10");
  for (const m of linkless.matchAll(/\bfree (plan|tier|version|forever|month)/gi)) {
    const before = linkless.slice(0, m.index!).split(/\s+/).filter(Boolean).slice(-4).join(" ");
    if (!NEG.test(before) && !/there'?s no$/i.test(before)) block("O10");
  }
  for (const m of linkless.matchAll(/\b(\d+)[\s-](day|week|month)s?[\s-](free[\s-])?trial/gi)) {
    if (Number(m[1]) !== TRIAL_DAYS || m[2].toLowerCase() !== "day") block("O10");
  }
  for (const m of linkless.matchAll(/\b([A-Z][A-Za-z]*) ([Pp]lan|[Tt]ier|[Pp]ackage|[Mm]embership)\b/g)) {
    if (!PLAN_WORD_OK.has(m[1])) block("O10");
  }
  if (LEGACY_PLAN.test(linkless) || LEGACY_WORDS.some((re) => re.test(linkless))) block("O10");
  for (const s of sentences) {
    const rest = s.replace(/\bGoogle Guarantee(d)?\b/gi, "");
    if (/guarante/i.test(rest) && !NEG.test(rest)) block("O10");
    if (NOT_SOLD.some((re) => re.test(s)) && !NEG.test(s)) block("O10");
  }

  // O11 — a sales-only item next to a price
  for (const s of sentences) {
    if (!/\$\s?\d/.test(s)) continue;
    const lower = s.toLowerCase();
    if (SALES_ONLY_NAMES.some((name) => lower.includes(name.toLowerCase()))) block("O11");
  }

  // O12 — claims to act, to see accounts, or to be a person
  const claims = linkless.replace(UI_LABELS, " ");
  if (ACTION_DONE.test(claims) || ACTION_WILL.test(claims) || ACCESS.test(claims) || HUMAN.test(claims)) block("O12");

  // O13 — leakage
  if (canary && linkless.toLowerCase().includes(canary.toLowerCase())) block("O13");
  if (LEAKS.some((re) => re.test(linkless))) block("O13");
  const words = normWords(linkless);
  const grams = rulesNgrams();
  for (let i = 0; i + 8 <= words.length; i++) if (grams.has(words.slice(i, i + 8).join(" "))) block("O13");

  // O14 — off-script content
  if (CODE.some((re) => re.test(linkless))) block("O14");
  for (const m of linkless.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    if (/[a-z]/.test(m[0]) && /[A-Z]/.test(m[0]) && /[0-9+/]/.test(m[0])) block("O14");
  }
  if (/\b[0-9a-f]{24,}\b/i.test(linkless)) block("O14");
  if (PROFANITY.test(linkless) || COMPETITORS.some((re) => re.test(linkless))) block("O14");

  // O15 — language
  const letters = linkless.match(/\p{L}/gu) ?? [];
  if (letters.length && letters.filter((ch) => ch.charCodeAt(0) > 127).length / letters.length > 0.1) block("O15");
  if (linkless.length > 80 && (linkless.match(FUNCTION_WORDS)?.length ?? 0) < 2) block("O15");

  // O16 — length (truncate / block)
  t = restore(t);
  if (out.finishReason === "length") {
    const end = lastSentenceEnd(t, t.length);
    if (end <= 0) block("O16");
    t = t.slice(0, end).trim();
  }
  if (t.length > MAX_REPLY_CHARS) {
    const end = lastSentenceEnd(t, MAX_REPLY_CHARS);
    if (end <= 0) block("O16");
    t = t.slice(0, end).trim();
  }
  const lines = t.split("\n").filter((l) => l.trim());
  if (lines.length > 14 || lines.filter((l) => /^\s*([-*+•]|\d+[.)])\s/.test(l)).length > 8) block("O16");

  // O17 — markdown whitelist (strip): **bold**, "- " / "1. " lists, allowlisted links
  t = t.split("\n").map((line) => {
    let l = line.replace(/^(\s*)[*+•]\s+/, "$1- ").replace(/^(\s*)(\d+)\)\s+/, "$1$2. ");
    if (/^\s*([-*_]\s*){3,}$/.test(l)) return "";
    l = l.replace(/`([^`]*)`/g, "$1").replace(/~~([^~]+)~~/g, "$1").replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2");
    const bold = (l.match(/\*\*/g) ?? []).length;
    l = bold % 2 === 0
      ? l.replace(/\*\*/g, "\u0003").replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2").replace(/\u0003/g, "**")
      : l.replace(/\*\*/g, "");
    return l.replace(/[ \t]+$/g, "");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Style: no emoji (strip).
  t = t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
  if (!t) block("O1");
  return t;
}

/** Run every check in order. Block -> { ok: false, code }; the caller sends R_FALLBACK. */
export function filterOutput(out: ModelOutput, opts: FilterOptions): FilterResult {
  try {
    return { ok: true, text: run(out, opts) };
  } catch (err) {
    if (err instanceof Blocked) return { ok: false, code: err.code };
    // Fail closed: an unexpected error in a check is a block, never a pass.
    return { ok: false, code: "O1" };
  }
}
