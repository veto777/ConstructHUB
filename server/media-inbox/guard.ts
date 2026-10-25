import { MEDIA_INBOX_PARAMETERS } from "@shared/media-inbox";

/**
 * The media inbox's rules in code, not in the prompt (shared/media-inbox.ts):
 *   - a machine sender (no-reply, bounce, newsletter, out-of-office, our own mailboxes) is logged, never answered;
 *   - a reply never commits money: amounts, "we'll pay / sign / purchase", card or invoice talk → the reply is replaced
 *     by a holding reply and the email waits for the owner;
 *   - a reply never fixes a meeting time (the owner's calendar) and never claims a signed contract.
 */

export type InboundHeaders = {
  fromEmail: string;
  subject: string;
  autoSubmitted?: string | null;
  precedence?: string | null;
  listUnsubscribe?: string | null;
  listId?: string | null;
  autoReply?: string | null;
};

const MACHINE_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|news(letter)?|digest|updates?|automated|system)([+._-].*)?@/i;
const MACHINE_DOMAINS = /@(accounts\.google\.com|google\.com|googlemail\.com|bounce\.|.*\.bounce\.|mailchimp|mcsv\.net|sendgrid\.net|amazonses\.com)/i;
const AUTO_SUBJECT = /^(auto(matic)?[ -]?reply|out of (the )?office|undeliverable|delivery status notification|mail delivery (failed|subsystem)|returned mail|away from)/i;
/**
 * Help-desk and website acknowledgements ("Thanks for your message", "We received your request"): never answered
 * (2026-10-17: four answers to MHFL Sentinel's auto-acknowledgements in 45 minutes). They start "Automatic message" so
 * readAutoReplies still reads them for a next step. A person's reply to our reply has "Re:" in front and is not one.
 */
const AUTO_ACK_SUBJECT = /^(thanks?( you)? for (your (message|email|e-mail|inquiry|enquiry|request|submission|interest)|contacting|reaching out|getting in touch|writing)|we('ve| have)? (received|got) your|your (message|email|request|inquiry|enquiry|submission|ticket) (has been|was|is) (received|submitted|logged)|auto(matic)?[- ]?(response|acknowledge?ment)|auto:)/i;

/** Why an email gets no reply, or null when a person wrote it. */
export function machineReason(h: InboundHeaders): string | null {
  const from = h.fromEmail.trim().toLowerCase();
  if (!from) return "No sender address";
  if (/@constructhub\.us$/.test(from)) return "Sent from one of our own mailboxes";
  if (h.autoSubmitted && !/^no$/i.test(h.autoSubmitted.trim())) return `Automatic message (Auto-Submitted: ${h.autoSubmitted.trim()})`;
  if (AUTO_SUBJECT.test(h.subject.trim())) return "Automatic reply or bounce";
  if (AUTO_ACK_SUBJECT.test(h.subject.trim())) return `Automatic message (an acknowledgement: "${h.subject.trim().slice(0, 80)}")`;
  if (h.autoReply?.trim()) return `Automatic message (X-Autoreply: ${h.autoReply.trim().slice(0, 40)})`;
  if (h.precedence && /^auto[_-]?reply$/i.test(h.precedence.trim())) return "Automatic message (Precedence: auto_reply)";
  if (MACHINE_LOCAL.test(from)) return "Sent from a no-reply / system address";
  if (MACHINE_DOMAINS.test(from)) return "Sent by a mail system, not a person";
  if (h.precedence && /^(bulk|list|junk)$/i.test(h.precedence.trim())) return "Bulk or mailing-list email";
  if (h.listId || h.listUnsubscribe) return "Newsletter or mailing list (has an unsubscribe link)";
  return null;
}

/**
 * support@ mail that is never a partner's answer: our own, system senders, auto-replies. Mailing-list headers are not
 * used here: help desks (EIN Presswire's Help Scout) put them on their agents' real answers.
 */
export function supportSkip(h: Pick<InboundHeaders, "fromEmail" | "subject" | "autoSubmitted">): boolean {
  const from = h.fromEmail.trim().toLowerCase();
  return !from || /@constructhub\.us$/.test(from) || MACHINE_LOCAL.test(from) || MACHINE_DOMAINS.test(from) || AUTO_SUBJECT.test(h.subject.trim())
    || Boolean(h.autoSubmitted && !/^no$/i.test(h.autoSubmitted.trim()));
}

const MONEY_AMOUNT = /(\$|€|£|usd\b|eur\b|dollars?\b)\s?\d|\d[\d,.]*\s?(\$|€|£|usd\b|eur\b|dollars?\b)/i;
const MONEY_COMMIT = /\b(we|i|our team)(['’](d|ll))?\s+(will\s+|can\s+|would\s+)?(agree to|be happy to|are happy to|accept to)?\s*(pay|purchase|buy|prepay|sign|commit|subscribe|wire|transfer|cover)\b/i;
const PAYMENT_WORDS = /\b(credit card|debit card|card details|invoice (us|me)|send (us|me) (an|the) invoice|paypal|wire transfer|bank (details|transfer)|payment (link|details|method)|deposit|card[ -]on[ -]file|order form)\b/i;
const SIGNED = /\b(we('ve| have)? signed|signed (the|your) (contract|agreement|order|io)|i accept the terms|we accept (the|your) terms)\b/i;
const MEETING_TIME = /\b(\d{1,2}(:\d{2})?\s?(am|pm)\b|(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+\d)/i;

const SECRETS = /\b(password|passcode|api[ _-]?key|secret key|access token|login details|credentials)\b|\bsk-[a-z0-9]{16,}|\b(card|account|routing) number\b/i;
// OWNER LAW, 2026-10-15: the check lives in server/outbound-guard.ts, shared with support@, social@, outreach and press.
export { botTellProblem } from "../outbound-guard";
import { botTellProblem } from "../outbound-guard";


/** Why a drafted reply must not go out, or null when it is safe (the laws marked `code` in shared/media-inbox.ts). */
export function replyProblem(reply: string): string | null {
  if (!reply.trim()) return "Empty reply";
  if (reply.trim().split(/\s+/).length > MEDIA_INBOX_PARAMETERS.hardReplyWordLimit) return `The reply is longer than ${MEDIA_INBOX_PARAMETERS.hardReplyWordLimit} words`;
  if (SECRETS.test(reply)) return "The reply mentions passwords, keys, logins or account numbers";
  const tell = botTellProblem(reply);
  if (tell) return tell;
  if (CLAIMS_HUMAN.test(reply)) return "The reply claims a person wrote it";
  if (MONEY_AMOUNT.test(reply)) return "The reply mentions an amount of money";
  if (MONEY_COMMIT.test(reply)) return "The reply commits us to paying, buying or signing";
  if (PAYMENT_WORDS.test(reply)) return "The reply talks about payment details";
  if (SIGNED.test(reply)) return "The reply claims a signed agreement";
  if (MEETING_TIME.test(reply)) return "The reply fixes a meeting time (the owner books meetings)";
  return null;
}

/** The safe answer when the drafted reply is refused, the model fails, or a decision belongs to the owner. */
export function holdingReply(firstName: string | null): string {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  return `${hi}\n\nThank you for your email. We've passed it to the right person on our team and will get back to you shortly with a full answer.\n\nBest regards,`;
}

/** "Jane Doe" / "jane@x.com" → "Jane" (never a company name or an address). */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").replace(/["']/g, "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@") || first.length > 20 || !/^[\p{L}][\p{L}'-]*$/u.test(first)) return null;
  if (/^(team|support|info|sales|hello|contact|admin|the|editor|editorial|partnerships?|marketing)$/i.test(first)) return null;
  return first[0].toUpperCase() + first.slice(1);
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|proton(mail)?|gmx|zoho|yandex|mail)\./i;
/** The company's domain from the sender's address; null for free mail (gmail.com is nobody's company). */
export function companyDomain(email: string): string | null {
  const d = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!d) return null;
  const parts = d.split(".");
  const tail2 = parts.slice(-2).join(".");
  const domain = /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(tail2) && parts.length >= 3 ? parts.slice(-3).join(".") : tail2;
  return FREE_MAIL.test(domain) ? null : domain;
}

/** The reply's subject: "Re: " once. */
export const replySubject = (subject: string) => (/^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim() || "your email"}`);

const OPT_OUT = /^\W*(stop|unsubscribe)\W*$|\b(unsubscribe|remove (me|us)( from (your|this) (list|emails?))?|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact)|opt(ed)? out|take (me|us) off)\b|^\W*not interested\b/im;
/** Did they ask us to stop? (first lines only, so a quoted footer of ours never counts). */
export function isOptOut(body: string): boolean {
  return OPT_OUT.test(body.split("\n").slice(0, 8).join("\n"));
}

/** Our first email as a form message: no greeting, no "Best regards", no stop line (a form is not an email). */
export function formMessage(firstBody: string): string {
  return firstBody.trim().replace(/^(hi|hello|dear)[^\n]*\n+/i, "").split(/\n+best regards,?/i)[0]
    .split("\n").filter((l) => !/reply\s+["“]?stop|unsubscribe/i.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Owner, 2026-10-14: "dont tell anyone we are ai ever". So no email volunteers it (botTellProblem, ../outbound-guard), and none claims a
// person wrote it (CLAIMS_HUMAN below). Someone asking straight out is answered by a person: the model never replies.
const ASKS_IF_AI = /\b(are|r) (you|u|these( emails)?|this( email)?) (an? |being |written by (an? )?)?(ai|bot|robot|automated|chatgpt|llm|real person|human|person)\b|\bis this (an? )?(ai|bot|automated|real person|human)\b|\byou('re| are) (an? )?(ai|bot)\b|\b(written|sent|generated) by (an? )?(ai|bot)\b/i;
export const asksIfAi = (body: string) => ASKS_IF_AI.test(body.slice(0, 2000));
export const CLAIMS_HUMAN = /\b(i('| a)?m|we('| a)?re|this is) (a )?(real|actual) (person|people|human)|\bnot (a |an )?(bot|ai|robot|automated)\b|\b(written|typed) by (a )?(real )?(person|human)\b/i;

/** A person on the team will answer (true: the email waits for the owner). */
export function personWillReply(firstName: string | null): string {
  return `${firstName ? `Hi ${firstName},` : "Hi,"}\n\nThanks for your message. A member of our team will get back to you personally.\n\nBest regards,`;
}

// ── duplicate sends (owner, 2026-10-25: "make sure duplicates don't get emailed out") ─────────────────────────────────

/** No automatic email to an address we emailed from media@ this recently (follow-ups for several threads went seconds apart). */
export const RECENT_SEND_MINUTES = 30;
/** …nor the same email again within this many days (a second holding reply, the same follow-up). */
export const SAME_EMAIL_DAYS = 14;

/** An email's words for comparing: no greeting line, no case or spacing, the first 200 characters. */
export function emailFingerprint(body: string): string {
  return body.trim().replace(/^(hi|hello|dear)\b[^\n]*\n+/i, "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Why an automatic email to this address would be a duplicate, or null. `recent` = what media@ sent that address in the
 * last SAME_EMAIL_DAYS. "soon" waits for a later pass; "same" is never sent.
 */
export function duplicateProblem(body: string, recent: { at: Date; body: string }[], now: Date = new Date()): { kind: "soon" | "same"; why: string } | null {
  const fp = emailFingerprint(body);
  const same = recent.find((r) => fp && emailFingerprint(r.body) === fp && now.getTime() - r.at.getTime() < SAME_EMAIL_DAYS * 86_400_000);
  if (same) return { kind: "same", why: `The same email already went to this address on ${same.at.toISOString().slice(0, 10)}` };
  const soon = recent.find((r) => now.getTime() - r.at.getTime() < RECENT_SEND_MINUTES * 60_000);
  if (soon) return { kind: "soon", why: `We emailed this address less than ${RECENT_SEND_MINUTES} minutes ago` };
  return null;
}

/** Who an email is from, as one key per company: its company record, else its domain, else the address. */
export const companyKey = (m: { partnerId: number | null; fromEmail: string }) =>
  m.partnerId ? `p:${m.partnerId}` : companyDomain(m.fromEmail) ? `d:${companyDomain(m.fromEmail)}` : `e:${m.fromEmail.toLowerCase()}`;

/**
 * One answer per company per pass (2026-10-18: CFU and ABC15 each got three replies minutes apart, one per email):
 * the latest email from each company is answered; the earlier ones are folded into that answer. Input oldest first.
 */
export function latestPerCompany<T extends { partnerId: number | null; fromEmail: string }>(pending: T[]): { answer: T; folded: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const m of pending) {
    const k = companyKey(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.values()].map((g) => ({ answer: g[g.length - 1], folded: g.slice(0, -1) }));
}
