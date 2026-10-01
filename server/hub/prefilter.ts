/**
 * Hub input handling (guardrails §3.2–3.3): normalise, neutralise, redact and
 * the deterministic pre-filter. Pure functions only — no DB, no model, no
 * request object. The model is not a security control (it is abliterated);
 * this file and output-filter.ts are.
 *
 *   cleanText()   NFKC, strip zero-width / bidi / control characters, CRLF -> LF
 *   neutralise()  delete chat-template and delimiter markers, quote role lines
 *   variants()    plain / folded (homoglyph + leet) / despaced / compact copies for matching
 *   redact()      emails, phones, addresses, links and ID-like numbers before egress
 *   prefilter()   first match wins -> a fixed reply code, or "pass"
 *
 * Deviations from the spec's illustrative patterns, each to stop a benign
 * contractor question being refused, are marked "narrowed" below.
 */
import type { ReplyCode } from "./replies";

// ---------------------------------------------------------------------------
// §3.2 step 1: clean

const ZERO_WIDTH = /[\u200B-\u200F\u2060-\u2064\uFEFF]/g;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
// C0/C1 controls except \n (tabs become spaces first so words never merge).
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

export function cleanText(input: string): string {
  return String(input ?? "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(ZERO_WIDTH, "")
    .replace(BIDI, "")
    .replace(CONTROLS, "");
}

// ---------------------------------------------------------------------------
// §3.2 step 2: neutralise (both the matching copy and the copy sent to the model)

const MARKERS = /<\|[^|<>]{0,40}\|>|\[\/?INST\]|<<\/?SYS>>|<\/?think>|<\/?visitor>|<\/?system>/gi;
const ROLE_LINE = /^([ \t]*)(system:|assistant:|developer:|###\s*system|###\s*instruction|###\s*response)/gim;

export function neutralise(input: string): string {
  let text = input;
  // Repeat so a marker rebuilt from the pieces of another ("<|im_<|x|>start|>") goes too.
  for (let i = 0; i < 5; i++) {
    const next = text.replace(MARKERS, "");
    if (next === text) break;
    text = next;
  }
  return text.replace(ROLE_LINE, "$1(quoted) $2").replace(/```/g, "'''");
}

// ---------------------------------------------------------------------------
// §3.2 step 3: matching variants

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
  "ԁ": "d", "һ": "h", "ӏ": "l", "ԛ": "q", "ԝ": "w", "ɡ": "g",
  "А": "a", "В": "b", "Е": "e", "К": "k", "М": "m", "Н": "h", "О": "o", "Р": "p", "С": "c", "Т": "t",
  "Х": "x", "У": "y", "І": "i", "Ј": "j", "Ѕ": "s",
  // Greek
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u",
  "χ": "x", "Α": "a", "Β": "b", "Ε": "e", "Ζ": "z", "Η": "h", "Ι": "i", "Κ": "k", "Μ": "m", "Ν": "n",
  "Ο": "o", "Ρ": "p", "Τ": "t", "Υ": "y", "Χ": "x",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

export type Variants = { original: string; plain: string; folded: string; despaced: string; compact: string };

const squash = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

export function foldText(text: string): string {
  let out = "";
  for (const ch of text) out += HOMOGLYPHS[ch] ?? ch;
  out = out.toLowerCase();
  let folded = "";
  for (const ch of out) folded += LEET[ch] ?? ch;
  return folded;
}

/** Join runs of single characters ("i g n o r e", "i.g.n.o.r.e") into words. */
export function despace(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])(?:[\p{L}\p{N}][ .\-_*]){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu, (run) => run.replace(/[ .\-_*]/g, ""));
}

export function variants(cleanNeutralised: string): Variants {
  const original = cleanNeutralised;
  const plain = squash(original.toLowerCase());
  const foldedRaw = foldText(original);
  const folded = squash(foldedRaw);
  const despaced = squash(despace(foldedRaw));
  const compact = foldedRaw.replace(/[^a-z]/g, "");
  return { original, plain, folded, despaced, compact };
}

const any = (v: Variants, re: RegExp) => re.test(v.plain) || re.test(v.folded) || re.test(v.despaced);
const anyOf = (v: Variants, list: readonly RegExp[]) => list.some((re) => any(v, re));

// ---------------------------------------------------------------------------
// §1 / §3.2 step 4: redact before egress

const TLDS = "com|net|org|io|us|app|co|ai|dev|gov|edu|info|biz|xyz|me|ly|gg";
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_OBFUSCATED_RE = /[\w.+-]+\s*[([]\s*at\s*[)\]]\s*[\w-]+\s*[([]\s*dot\s*[)\]]\s*[a-z]{2,}/gi;
const URL_RE = new RegExp(
  String.raw`\b(?:https?:\/\/|www\.)\S+|(?<![\w@/:])\/\/[^\s/]+\S*|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:${TLDS})\b(?:\/\S*)?`, "gi");
const OWN_HOST_RE = /^(?:www\.|portal\.)?constructhub\.us$/i;
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const EIN_RE = /\b\d{2}-\d{7}\b/g;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const DIGIT_RUN_RE = /\b\d(?:[\s.()-]?\d){6,}\b/g;
const ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace)\b\.?/gi;

/** The copy that leaves ConstructHUB: contact details, links and ID-like numbers replaced by placeholders. */
export function redact(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(EMAIL_OBFUSCATED_RE, "[email]")
    .replace(URL_RE, (m) => (OWN_HOST_RE.test(m) ? m : "[link]"))
    .replace(SSN_RE, "[number]")
    .replace(EIN_RE, "[number]")
    .replace(CARD_RE, "[number]")
    .replace(PHONE_RE, "[phone]")
    .replace(DIGIT_RUN_RE, "[phone]")
    .replace(ADDRESS_RE, "[address]");
}

/** The cleaned, neutralised, redacted text that goes inside <visitor> tags. */
export function forModel(raw: string): string {
  return redact(neutralise(cleanText(raw))).trim();
}

// ---------------------------------------------------------------------------
// §3.3 pre-filter

export type PCode = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P9b" | "P10";
export type PrefilterResult =
  | { code: "pass" }
  | { code: PCode; reply: ReplyCode; link?: { label: string; path: string } };

// P9b self-harm runs first: a person in crisis gets the crisis line whatever else they typed.
const P9B = /\b(kill myself|suicid\w*|end my life|self[- ]?harm\w*|want to die|don'?t want to (live|be alive))\b/;

// P1 encoded / non-plain
function encoded(original: string): boolean {
  const s = original.replace(EMAIL_RE, "[email]").replace(URL_RE, "[link]");
  for (const m of s.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    const t = m[0];
    if (/[a-z]/.test(t) && /[A-Z]/.test(t) && /[0-9+/]/.test(t)) return true;
  }
  if (/(?:[0-9a-f]{2}){16,}/i.test(s)) return true;
  if ((s.match(/%[0-9a-f]{2}/gi) ?? []).length >= 5) return true;
  if ((s.match(/\\u[0-9a-f]{4}/gi) ?? []).length >= 3) return true;
  return /\brot-?13\b|\bdecode (this|it|that|the following)\b|\b(in|into|from|to|as) base-?64\b|\bbase-?64[- ]?(encoded|decode|decoded|string|text)\b/i.test(s);
}

// P2 non-English
const STOP_WORDS = new Set([
  // es
  "el", "la", "los", "las", "que", "por", "para", "con", "una", "cómo", "cuánto", "cuanto", "ignora", "instrucciones",
  "clientes", "correos", "usted", "tiene", "hola", "gracias", "está", "dime", "tus", "sus", "anteriores", "precio",
  // fr
  "le", "les", "des", "avec", "pour", "vous", "ignorez", "donnez", "vos", "est", "une", "dans", "sur", "merci", "bonjour",
  // pt
  "você", "voce", "não", "nao", "obrigado", "olá",
  // de
  "und", "nicht", "ich", "ist", "der", "die", "das", "mit", "für", "bitte",
]);
// Also ordinary English or place names (El Paso, LA, Des Moines): never enough alone.
const AMBIGUOUS = new Set(["el", "la", "los", "las", "le", "les", "des", "die", "das", "con", "est", "une", "pour", "sur", "der", "para", "por", "que", "sus"]);

function nonEnglish(v: Variants): boolean {
  const letters = v.original.match(/\p{L}/gu) ?? [];
  if (letters.length >= 4) {
    const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
    if (nonLatin / letters.length > 0.2) return true;
  }
  const words = v.plain.split(/[^\p{L}']+/u).filter(Boolean);
  if (words.length < 5) return false;
  const hits = new Set(words.filter((w) => STOP_WORDS.has(w)));
  const strong = [...hits].filter((w) => !AMBIGUOUS.has(w));
  return hits.size >= 2 && strong.length >= 1;
}

// P3 override / jailbreak
const P3: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\s+((all|any|previous|prior|above|earlier|your|the|of|my|these|those)\s+){0,4}(instructions|rules|prompt|guidelines|guardrails|restrictions)\b/,
  /\byou are now\b/, /\bfrom now on\b/, /\b(you|hub) (will |must |should |can )?act as\b/, /\bact as if\b/,
  /\bpretend/, /\brole-?play/, /\blet'?s play\b/, /\bhypothetical(ly)?\b/, /\bimagine you\b/,
  /\bdo anything now\b/, /\bdeveloper mode\b/, /\bjailbreak/, /\bno (rules|restrictions|limits|filter)\b/,
  /\bunfiltered\b/, /\buncensored\b/, /\bdo what it says\b/, /\bfor this conversation,? (say|answer|assume)\b/,
  /\bnew rule\b/, /\bauthori[sz]ation code\b/,
  // Identity claims — narrowed: "I'm a business owner" is how contractors talk, so only a
  // claim to be ConstructHUB's (or Hub's) own owner/admin/staff/developer counts.
  /\bi('m| am) (the |a |an |one of the |one of your )?(constructhub'?s? |hub'?s? |your |site |platform |system )(\w+ )?(admin|administrator|owner|developer|dev|ceo|founder|staff|employee|engineer|creator|programmer)\b/,
  /\bi('m| am) (the |a |an )?(developer|programmer|creator|founder|ceo|owner|administrator|admin) (of|at|for|behind) (constructhub|hub|this (site|app|bot|platform)|you|the (site|platform|bot))\b/,
];
const P3_COMPACT = /ignore(all|any|previous|prior|your|the)*(instructions|rules|prompt)|systemprompt|doanythingnow|developermode|jailbreak|norules/;
const P3_CASED = /\bDAN\b/;

// P4 prompt extraction
const P4: RegExp[] = [
  /\b(system|initial|hidden|original) (prompt|message|instructions)\b/,
  /\b(your|hub'?s) (instructions|rules|prompt|guidelines|knowledge (base|pack))\b/,
  /\bthe (system|hidden|initial|original) (prompt|instructions)\b/,
  /\brepeat (everything|the text|all) (above|before)\b/, /\bverbatim\b/, /\bwhat were you told\b/, /\bprint your\b/,
];

// P5 other people's data. Group A always targets someone else; group B is a data noun
// that a how-to question can legitimately contain ("how do I import my client list?").
const P5_A: RegExp[] = [
  /\byour (customers|clients|users|subscribers|members|contractors|signups|sign-ups)\b/,
  /\bother (users|customers|accounts|contractors|companies)\b/,
  /\bwho (uses|signed up|subscribes|is using|bought|else uses)\b/,
  /\b(user|account) (id|#|number) ?#?\d+/,
  /\blook ?up (a |the )?(user|customer|account|company|contractor)s?\b/,
  /\bdoes .{1,60} (use (constructhub|hub|you|this|your)|have an account)\b/,
  /\btoday'?s sign-?ups\b/, /\bsign-?ups (today|this week|this month)\b/,
  // narrowed: "how many users can I add on Pro?" is a plan question, not a data request.
  /\bhow many (\w+ )?(users|customers|subscribers|contractors|accounts|signups|people)\b(?!.*\b(can (i|we)|could (i|we)|do (i|we) get|does (the )?(\w+ )?(plan|starter|pro|growth|agency)|included|include|per (plan|month|location|seat)|allowed|on (the )?(starter|pro|growth|agency)))/,
];
const P5_A_CASED: RegExp[] = [
  // narrowed: the name must not be ConstructHUB's own support/sales.
  /\b(phone|email|address|number|contact( info)?|cell) (of|for) (?!ConstructHUB|Hub\b|Support|Sales)[A-Z]/,
  /\b[A-Z][a-z]+'s (phone|email|address|number|account|plan|invoice|reviews)\b/,
  // narrowed: "is <Capitalised Name> a customer" (not "is the CRM included for a new user").
  /\b[Ii]s ([A-Z][\w&'.-]*(?: [A-Z&][\w&'.-]*)*) an? (\w+ )?(customer|user|member|client|subscriber)\b/,
];
const P5_B: RegExp[] = [
  /\blist (of )?(all )?(the )?(customers|users|clients|accounts|emails|members)\b/,
  /\b(customer|user|client|subscriber|email|contact|lead) (list|database|data|emails|names|info|records)\b/,
];
const HOWTO = /\b(how (do|can|to|does|would|should)|where (do|can|is|are)|can i|could i|set ?up|import|export|add|invite)\b/;

// P6 own-account data or actions
const P6_NOUN = "(clients?|customers?|invoices?|estimates?|jobs?|leads?|reviews?|rankings?|plan|subscription|bill|billing|payments?|card|account|data|locations?|team|usage|password|2fa|two-factor)";
const P6 = new RegExp(String.raw`\b(show|list|what('s| is| are)|how many|tell me|check|look at|pull up|cancel|refund|change|upgrade|downgrade|delete|reset)( me)? (my|our) (\w+ ){0,3}?${P6_NOUN}\b`);
const P6_ME = /\b(upgrade|downgrade|cancel|refund|delete) me\b/;
const OWN_LINKS: { test: RegExp; label: string; path: string }[] = [
  { test: /\b(plan|subscription|bill|billing|card|usage|refund|cancel|upgrade|downgrade)\b/, label: "Settings → Billing & Plans", path: "/settings?tab=billing" },
  { test: /\b(password|2fa|two-factor)\b/, label: "Settings → Security & activity", path: "/settings?tab=security" },
  { test: /\b(clients?|customers?)\b/, label: "CRM → Clients", path: "/crm/clients" },
  { test: /\bestimates?\b/, label: "CRM → Estimates", path: "/crm/estimates" },
  { test: /\binvoices?\b/, label: "CRM → Invoices", path: "/crm/invoices" },
  { test: /\bpayments?\b/, label: "CRM → Payments", path: "/crm/payments" },
  { test: /\b(team|seats?)\b/, label: "CRM → Team & Company", path: "/crm/team" },
  { test: /\b(jobs?|leads?)\b/, label: "CRM → Pipeline", path: "/crm/pipeline" },
  { test: /\brankings?\b/, label: "GMB Ranking Grid", path: "/ranking-grid" },
  { test: /\blocations?\b/, label: "Locations", path: "/locations" },
  { test: /\breviews?\b/, label: "Google Reviews", path: "/google-reviews" },
];

// P7 internal / infra / secrets, and the model's identity
const P7_WHOAMI: RegExp[] = [
  /\bwhat (model|llm|ai|engine)\b.{0,24}\b(are you|is this|powers|runs|do you use|are you using|is behind)\b/,
  /\bwhich (model|llm)\b/, /\bare you (a |an )?(gpt|chatgpt|llama|claude|qwen|gemini|mistral|deepseek)/,
  /\btruthcoder?\b/, /\bopenai\b/, /\bollama\b/, /\bwho (hosts|made|built|trained|created|programmed) you\b/,
];
const PERMIT_CONTEXT = /\b(permits?|portals?|county|counties|city|cities|property|appraisers?|assessors?|directory|jurisdictions?|states?)\b/;
const P7_DB = /\b(your|constructhub'?s|the site'?s|hub'?s) (database|db)\b/;
const P7_INTERNAL: RegExp[] = [
  /\b(your|constructhub'?s|the site'?s|hub'?s) (servers?|source code|codebase|repo|github|secrets?|env|tokens?|credentials|admin (panel|password|login)|infrastructure|hosting|host|tunnel|backend|stack|employees|staff|revenue|mrr|arr|profit|investors|valuation)\b/,
  /\.env\b/, /\bai_integrations/, /\bsecret key\b/, /\bssh\b/, /\blocalhost\b/, /\b127\.0\.0\.1\b/,
  /\b\d{1,3}(\.\d{1,3}){3}\b/, /\bselect \* from\b/, /\bunion select\b/, /\bdrop table\b/, /\binsert into\b/, /;--/,
  /\bvb\d+\b/, /\bstripe (key|secret|webhook)/,
  /\b(your|hub'?s|constructhub'?s|the site'?s|the server'?s|openai|stripe|truthcode\w*|ai|admin|master|root|internal) api[_ ]?keys?\b/,
];
// narrowed: a bare "API key" is a setup step for Blotato, Cloudflare and the CRM.
const API_KEY = /\bapi[_ ]?keys?\b/;
const API_KEY_FEATURE = /\b(blotato|cloudflare|crm|integrations?|webhooks?|social)\b/;

// P8 sales-only pricing
const P8_ITEM = /\b(seo programs?|first page seo|seo growth|seo domination|website (build|setup)|business formation|llc (filing|formation)|done[- ]for[- ]you|dfy|complete business build|master ?class|custom (work|quote|job)|enterprise|more than 500 locations|over 500 locations)\b/;
const P8_PRICE = /\b(price|prices|pricing|cost|costs|how much|quote|rate|rates|fee|fees|range|ballpark)\b|\$/;

// P9 hard off-topic
const P9_CODE: RegExp[] = [
  /'''/,
  /\b(write|generate|fix|debug|give me|show me)( me)? (a |some |the )?(python|javascript|js|typescript|java|c\+\+|c#|php|sql|bash|regex|html|css|code|script|function|program|scraper)(?![\w#+])/,
];
const P9_CODE_EXEMPT = /\b(click guard|ip tracker|vpn shield|tracking (script|code)|embed|install|snippet)\b/;
const P9_CONTENT: RegExp[] = [
  /\bwrite( me)? (an? )?([\w-]+ ){0,3}(essay|poem|story|song|joke|blog post|article|email|letter|cover letter)s?\b/,
  /\btell me a (\w+ )?(story|joke|poem)\b/,
];
const P9_CONTENT_EXEMPT = /\b(crm|estimates?|invoices?|review requests?|templates?|posts?|captions?|replies|reply|social)\b/;
const P9_TOPICS: RegExp[] = [
  // medical
  // narrowed: "diagnostics" is a Site Scan word, so only a medical diagnosis counts.
  /\b(injur\w*|fractur\w*|swollen|bleeding|sprain\w*|doctor|hospital|diagnosis|diagnosed|symptom\w*|medication|dosage|prescription|disease|infection|covid|pregnan\w*)\b/,
  // legal disputes
  /\b(lawsuit|sue|attorney|lawyer)\b/,
  // politics
  /\b(election|democrat\w*|republican\w*|trump|biden|congress|senate|abortion|vote for)\b/,
  // finance
  // narrowed: "stock photos" and "in stock" are everyday words for a contractor.
  /\b(stocks|stock (market|price|prices|tips)|crypto\w*|bitcoin|forex)\b|\binvest(ing|ment)? advice\b/,
  // adult
  /\b(porn\w*|sex|sexual|nude\w*|naked|nsfw|onlyfans|escort)\b/,
  // violence
  /\b(murder\w*|kill (him|her|them|someone|somebody|people)|shoot (him|her|them|someone|up)|stab(bed|bing|s)?|assault\w*|bomb\w*|explosive\w*|terroris\w*)\b/,
  // weapons ("nail gun" is a tool, so no bare "gun")
  /\b(firearm\w*|handgun\w*|rifles?|shotguns?|ammo|ammunition|ar-?15|glock)\b/,
  // drugs
  /\b(cocaine|heroin|meth|methamphetamine|fentanyl|mdma|lsd|marijuana|cannabis|opioid\w*)\b/,
];

// P10 vocabulary gate
const DOMAIN_VOCAB = [
  "constructhub", "hub", "plan", "price", "pricing", "cost", "trial", "subscription", "billing", "starter", "pro",
  "growth", "agency", "feature", "permit", "county", "counties", "city", "cities", "property", "appraiser", "assessor", "google",
  "gbp", "gmb", "business profile", "review", "ranking", "grid", "photo", "seo", "location", "ads", "lsa",
  "click guard", "ip tracker", "vpn shield", "competitor", "crm", "estimate", "invoice", "payment", "pipeline",
  "schedule", "portal", "team", "seat", "text", "sms", "cloudflare", "search console", "domain", "gmail", "alert",
  "site scan", "social", "post", "master class", "guide", "llc", "license", "bond", "insurance", "contractor",
  "construction", "business", "sign up", "signup", "log in", "login", "account", "password", "settings", "set up",
  "setup", "sales", "quote", "add-on", "addon", "integration", "import", "export", "dashboard", "website",
  // a few more plainly-domain words
  "company", "client", "customer", "lead", "job", "crew", "marketing", "listing", "maps", "verify", "email",
  "notification", "security", "cancel", "refund", "upgrade", "downgrade", "card", "profile", "citation",
  "blotato", "hover", "stripe", "signalwire", "telegram", "api key", "webhook", "2fa", "two-factor",
];
const VOCAB_RE = new RegExp(String.raw`\b(${DOMAIN_VOCAB.map((w) => w.replace(/[-]/g, "\\-").replace(/ /g, "[ -]?")).join("|")})(s|es)?\b`);

const fail = (code: PCode, reply: ReplyCode, link?: { label: string; path: string }): PrefilterResult => ({ code, reply, link });

/** First match wins. `raw` is the visitor's message exactly as received. */
export function prefilter(raw: string): PrefilterResult {
  const v = variants(neutralise(cleanText(raw)));
  const howTo = any(v, HOWTO);

  if (any(v, P9B)) return fail("P9b", "R_CRISIS");
  if (encoded(v.original)) return fail("P1", "R_PLAIN");
  if (nonEnglish(v)) return fail("P2", "R_LANG");
  if (anyOf(v, P3) || P3_COMPACT.test(v.compact) || P3_CASED.test(v.original)) return fail("P3", "R_INJECTION");
  if (anyOf(v, P4)) return fail("P4", "R_INJECTION");

  if (anyOf(v, P5_A) || P5_A_CASED.some((re) => re.test(v.original))) return fail("P5", "R_DATA");
  if (anyOf(v, P5_B) && !howTo) return fail("P5", "R_DATA");

  const ownMe = any(v, P6_ME);
  if ((any(v, P6) && !howTo) || ownMe) {
    const subject = (v.plain.match(P6) ?? v.plain.match(P6_ME) ?? [v.plain])[0];
    const hit = OWN_LINKS.find((l) => l.test.test(subject)) ?? { label: "Settings", path: "/settings" };
    return fail("P6", "R_OWN_DATA", { label: hit.label, path: hit.path });
  }

  if (anyOf(v, P7_WHOAMI)) return fail("P7", "R_WHOAMI");
  if (anyOf(v, P7_INTERNAL)) return fail("P7", "R_INTERNAL");
  if (any(v, P7_DB) && !any(v, PERMIT_CONTEXT)) return fail("P7", "R_INTERNAL");
  if (any(v, API_KEY) && !any(v, API_KEY_FEATURE)) return fail("P7", "R_INTERNAL");

  if (any(v, P8_ITEM) && any(v, P8_PRICE)) return fail("P8", "R_SALES");

  if (anyOf(v, P9_CODE) && !any(v, P9_CODE_EXEMPT)) return fail("P9", "R_OFFTOPIC");
  if (anyOf(v, P9_CONTENT) && !(howTo && any(v, P9_CONTENT_EXEMPT))) return fail("P9", "R_OFFTOPIC");
  if (anyOf(v, P9_TOPICS)) return fail("P9", "R_OFFTOPIC");

  const words = v.plain.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length > 6 && !any(v, VOCAB_RE)) return fail("P10", "R_OFFTOPIC");

  return { code: "pass" };
}
