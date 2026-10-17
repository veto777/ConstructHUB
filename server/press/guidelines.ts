/**
 * The wire's content guidelines (https://www.accessnewswire.com/content-guidelines, read 2026-10-15), in two forms:
 *   WRITING_RULES   what the AI writer is told (server/press/writer.ts)
 *   checkRelease    deterministic checks on the text before it may be sent — the parts a program can verify
 *                   (hype, direct address, exclamation marks, caps, spam words, contact email, source named early,
 *                   restricted topics). The wire's editors have the final say; these catch what gets a release
 *                   kicked back, so a customer is not charged a credit for an avoidable rejection.
 *
 * A failed check is `blocking` when the wire says it refuses such content; the rest are warnings the customer can
 * accept. Nothing here invents a rule the wire did not publish.
 */
import type { PressGuidelineIssue, PressReleaseInput, PressReleaseText } from "@shared/press";

export const WRITING_RULES = `You write press releases for distribution on a national newswire. The wire's editorial team reviews every release and refuses any that break its guidelines. Follow every rule below exactly.

FORMAT (AP style)
- Headline: the news in one plain sentence, under 100 characters, title case, no exclamation marks, no questions, no all-caps words. The company's name appears in the headline or the first sentence.
- Subheadline: one sentence that adds the second most important fact.
- Dateline: "CITY, STATE / Month Day, Year /" (the state spelled out in AP style, e.g. "COLUMBUS, OH / October 15, 2026 /"). The body starts right after it on the same line.
- Body: 350 to 550 words, 5 to 8 short paragraphs. First paragraph answers who, what, where, when and why. Third person throughout.
- Quotes: one or two, attributed in full ("said Jane Doe, owner of Doe Roofing"). Quotes are the ONLY place first person ("we", "I", "our") and direct address ("you") may appear. Quotes may not be invented facts: they express the spokesperson's view of the news given.
- Boilerplate: a final "About <Company>" paragraph of 60 to 100 words: what the company does, where it works, how long it has been in business, and its website.
- Media contact: name, company, email, phone, website — one per line. An email address is required.

TONE
- Objective and factual, like a news report. No hype: no "amazing", "incredible", "best", "#1", "revolutionary", "world-class", "unmatched", "guaranteed", "free", "clearance", "make money", "earn money". No superlatives unless a cited third party awarded them.
- No exclamation marks anywhere. No words in ALL CAPS for emphasis. No marketing calls to action ("call today", "visit now", "sign up").
- No direct address outside quotes: never "you", "your", "we", "our", "us", "I" in the narrative.
- Proper spelling, grammar, punctuation, one space between sentences, consistent capitalization.

CONTENT
- Only facts the customer supplied. Never add numbers, dates, awards, partners, customers, prices or claims that were not given. If a fact is missing, leave it out; never guess.
- Every statement must be accurate and verifiable. No negative statements about another company, especially by name. No inflammatory or opinion content. No personal attacks.
- Do not imply partnership with, endorsement by or official association with Google, a government body or any organisation unless the customer stated it as fact.
- Links: only the customer's website and links they gave. No affiliate links. Nothing over-optimised for search (no keyword stuffing).
- Restricted topics that need extra verification or are refused: stock tickers and investment advice, cryptocurrency, litigation, prescription drugs, gambling, adult content, weight-loss or health claims without cited research, "miracle" products, payday loans, political opinion, celebrity endorsements, partnerships/acquisitions/funding (the wire requires a signed authorization form for these). Write such news plainly and factually; never add claims.
- Never mention that the release was written with AI, by a newswire service, or by ConstructHUB.

OUTPUT
Return JSON only: {"headline": string, "subheadline": string, "dateline": string, "body": string, "boilerplate": string, "mediaContact": string}. Paragraphs in body are separated by a blank line. The dateline is NOT repeated inside body.`;

/** Words the wire names as hype or spam triggers. Matched as whole words, case-insensitive. */
export const HYPE_WORDS = ["amazing", "incredible", "unbelievable", "revolutionary", "world-class", "unmatched", "guaranteed", "free", "clearance", "make money", "earn money", "best in the world", "#1", "number one", "once in a lifetime", "limited time", "act now", "call today", "call now", "visit now", "sign up today", "don't miss"];

/** Topics the wire restricts (extra review, documents, or refusal). Found by key words in the customer's input. */
const RESTRICTED: { rule: string; detail: string; re: RegExp; blocking: boolean }[] = [
  { rule: "Investment or stock content", detail: "Stock tips, tickers and investment advice are refused; a ticker needs the company's written authorization.", re: /\b(stock tips?|ticker|nasdaq|nyse|otc markets|invest(?:ment|or)s? advice|buy (?:the )?stock|shares? (?:will|could) (?:rise|soar))\b/i, blocking: true },
  { rule: "Cryptocurrency", detail: "Crypto and ICO releases get a longer review and may be refused; Yahoo no longer takes them.", re: /\b(crypto(?:currency)?|bitcoin|ethereum|ico|token sale|nft)\b/i, blocking: false },
  { rule: "Litigation", detail: "Pending or closed lawsuits are reviewed case by case and need documents (a docket number). Yahoo refuses litigation releases.", re: /\b(lawsuit|litigation|class action|sued|suing|court case|docket)\b/i, blocking: false },
  { rule: "Prescription drugs", detail: "Brand-name prescription or over-the-counter drugs may not be named.", re: /\b(prescription|pharmac(?:y|eutical)|opioid|ozempic|viagra)\b/i, blocking: false },
  { rule: "Gambling", detail: "Gambling releases are evaluated one by one.", re: /\b(casino|gambling|sports betting|lottery|poker)\b/i, blocking: false },
  { rule: "Adult content", detail: "Sexually explicit topics are refused.", re: /\b(adult entertainment|sexually explicit|xxx|escort)\b/i, blocking: true },
  { rule: "Health or weight-loss claims", detail: "Claims about curing, treating or weight loss need cited research or the release is refused.", re: /\b(cures?|weight[- ]loss|miracle|supplement|covid)\b/i, blocking: false },
  { rule: "Payday loans", detail: "Payday loan services are not published.", re: /\b(payday loans?)\b/i, blocking: true },
  { rule: "Partnership, deal, acquisition or funding", detail: "The wire requires its authorization form, signed by the other company, before such a release is distributed.", re: /\b(acqui(?:re|sition)|merger|venture capital|private equity|investment round|funding round|signed a deal|partnership with)\b/i, blocking: false },
  { rule: "Political content", detail: "Political releases are accepted only when civil and moderate, and opinion pieces must open as an open letter.", re: /\b(election|candidate for|democrat|republican|political party)\b/i, blocking: false },
  { rule: "Celebrity endorsement", detail: "A named celebrity needs proof they approve the mention.", re: /\b(celebrity|endorsed by)\b/i, blocking: false },
  { rule: "Statement about another company", detail: "Negative statements about another company, especially by name, are refused.", re: /\b(competitor(?:s)? (?:are|is) (?:worse|lying|scam)|rip-?off|scam(?:mers)?|fraudulent)\b/i, blocking: false },
  { rule: "Association with Google", detail: "A release may not suggest a partnership with, or endorsement by, Google.", re: /\b(partner(?:ed|ship)? with google|google[- ]certified|endorsed by google|google partner)\b/i, blocking: true },
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w: string) => new RegExp(`(?<![\\w#])${escapeRe(w)}(?![\\w])`, "i");

/** The narrative without quoted speech: direct address and first person are allowed inside quotes only. */
export function outsideQuotes(text: string): string {
  return text.replace(/[“"][^”"]{3,}[”"]/g, " ");
}

/** Check a release's text (and the customer's input) against the published guidelines. */
export function checkRelease(text: PressReleaseText, input: Pick<PressReleaseInput, "companyName" | "contactEmail" | "details" | "quoteNotes" | "about">): PressGuidelineIssue[] {
  const issues: PressGuidelineIssue[] = [];
  const all = [text.headline, text.subheadline, text.body, text.boilerplate].join("\n");
  const narrative = outsideQuotes([text.headline, text.subheadline, text.body].join("\n"));
  const company = input.companyName.trim();

  if (!text.headline.trim()) issues.push({ rule: "Headline", detail: "The release needs a headline that states the news.", blocking: true });
  else if (text.headline.length > 110) issues.push({ rule: "Headline length", detail: `The headline is ${text.headline.length} characters; keep it under 100.`, blocking: false });
  if (!/\/\s*[A-Z][a-z]+ \d{1,2}, \d{4}\s*\//.test(text.dateline)) issues.push({ rule: "Dateline", detail: 'The dateline must read "CITY, STATE / Month Day, Year /".', blocking: false });

  const words = text.body.trim().split(/\s+/).filter(Boolean).length;
  if (words < 250) issues.push({ rule: "Length", detail: `The body is ${words} words; a release reads as news at 350 to 550 words.`, blocking: false });
  if (words > 800) issues.push({ rule: "Length", detail: `The body is ${words} words; keep it under 600.`, blocking: false });

  const top = `${text.headline}\n${text.subheadline}\n${text.body.split(/\n\s*\n/)[0] ?? ""}`;
  if (company && !top.toLowerCase().includes(company.toLowerCase().split(/\s+[|\-–:]\s+/)[0])) {
    issues.push({ rule: "Clear source attribution", detail: `The company's name must appear in the headline, summary or first paragraph.`, blocking: true });
  }

  if (/!/.test(all)) issues.push({ rule: "Exclamation marks", detail: "The wire flags exclamation marks as hype. Remove them.", blocking: true });
  const caps = (all.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !/^(LLC|INC|USA|HVAC|OSHA|EPA|LEED|NABCEP|CSLB|ADA|GAF|CPA|FAQ|CEO|CFO|COO|HOA|ROI|API|GPS|UV|LED|PVC|EIFS|TPO|EPDM|SIP|BBB)$/.test(w));
  if (caps.length) issues.push({ rule: "All-caps emphasis", detail: `Uppercase words read as shouting: ${Array.from(new Set(caps)).slice(0, 5).join(", ")}.`, blocking: true });
  const hype = HYPE_WORDS.filter((w) => wordRe(w).test(all));
  if (hype.length) issues.push({ rule: "Hype or spam words", detail: `The wire refuses releases with: ${hype.join(", ")}.`, blocking: true });
  const direct = narrative.match(/(?<![\w'’])(you|your|yours|we|we're|we’re|our|ours|us|i|i'm|i’m|my)(?![\w'’])/gi) ?? [];
  if (direct.length) issues.push({ rule: "Direct address outside quotes", detail: `"${Array.from(new Set(direct.map((w) => w.toLowerCase()))).slice(0, 4).join('", "')}" may only appear inside a spokesperson's quote.`, blocking: true });
  if (!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text.mediaContact) && !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(input.contactEmail)) {
    issues.push({ rule: "Valid media contact", detail: "The media contact must include an email address.", blocking: true });
  }
  if (/\b(AI|artificial intelligence|ChatGPT|newswire service|ConstructHUB)\b/.test(all) && !/\bAI\b/.test(`${input.details} ${input.about}`)) {
    issues.push({ rule: "Authorship", detail: "The release must not mention AI, the wire service or ConstructHUB.", blocking: true });
  }
  if (/\b(quote|statement) (?:to come|tbd|placeholder)\b/i.test(all) || /\[[^\]]{2,40}\]/.test(all)) {
    issues.push({ rule: "Placeholders", detail: "Square-bracket placeholders or unfinished quotes must be filled in.", blocking: true });
  }

  const subject = `${input.details}\n${input.quoteNotes}\n${input.about}\n${all}`;
  for (const r of RESTRICTED) if (r.re.test(subject)) issues.push({ rule: r.rule, detail: r.detail, blocking: r.blocking });
  return issues;
}

export const hasBlockingIssue = (issues: PressGuidelineIssue[]): boolean => issues.some((i) => i.blocking);
