/**
 * Gabe's support line — the call's state machine (owner, 2026-10-08). Pure: every dependency (account lookup, code
 * delivery, the AI, ticket creation) is passed in, so the security rules are unit-tested (line.test.ts).
 *
 * The rules are CODE, never the prompt — the AI only phrases the issue intake and proposes fields:
 *  - No ticket without a verified one-time code. The AI cannot set "verified"; only checkCode() can.
 *  - A code goes ONLY to contact details already on the account (its email, or a phone on file) — never to anything
 *    the caller provides. Giving an email only finds the account; the code still goes to the email on file.
 *  - The same words whether or not an account matched ("If that matches an account…"): no account fishing.
 *  - Nothing from the account is ever spoken: no email, no phone, no name, no plan. Only the ticket number.
 *  - Limits: 3 identifier tries, 3 code tries per code, 2 codes per call; per-caller and per-account send budgets
 *    (enforced by the deps); 40 caller turns; then the call ends politely.
 */
export type Channel = "email" | "sms";
export type Account = { userId: number; crmOrgId: string | null; email: string; phones: string[]; ref: string };
export type Category = "payment" | "login" | "technical" | "data" | "other";
export type Intake = { category?: Category; title?: string; description?: string; steps?: string; device?: string; blocking?: boolean; /** Collected without the AI (it was down): severity is never "critical". */ fallback?: boolean };
export type CallState = {
  step: "ask_id" | "choose_channel" | "code_sent" | "intake" | "confirm" | "done";
  idTries: number; codeTries: number; codesSent: number; turns: number;
  userId: number | null; crmOrgId: string | null; ref: string | null; email: string | null; phones: string[];
  channel: Channel | null; codeHash: string | null; codeExpires: number | null; verified: boolean;
  intake: Intake; aiTurns: { role: "caller" | "gabe"; text: string }[]; ticketNumber: string | null;
};
export type Reply = { say: string; end: boolean };
export interface Deps {
  now(): number;
  /** Find by customer number, CRM number or account email. Never throws for "not found" (returns null). */
  findAccount(ref: { kind: "customer" | "crm" | "email"; value: string }): Promise<Account | null>;
  /**
   * Send a fresh code to the account's own email / first phone on file — or, with no account, do the SAME budget work
   * and send nothing (Kimi audit 2026-10-08 #1/#2: hit and miss must not differ in words or timing). `allowed: false`
   * only when the CALLER's budget is spent (identical for hits and misses); an account-side refusal is `allowed: true,
   * hash: null` (nothing sent, the same words). Delivery happens in the background.
   */
  sendCode(acct: { userId: number; email: string; phones: string[] } | null, ref: string, channel: Channel, callerNumber: string): Promise<{ allowed: boolean; hash: string | null }>;
  hashCode(code: string): string;
  /** The intake conversation: the AI returns what to say next and the fields it has so far. May throw. */
  intakeTurn(history: { role: "caller" | "gabe"; text: string }[]): Promise<{ say: string; intake: Intake; ready: boolean }>;
  /** Opens the ticket; null when the account's daily ticket cap is spent (Kimi #6). */
  openTicket(s: CallState, callerNumber: string): Promise<{ number: string } | null>;
}

export const LINES = {
  greet: "Hi, this is Gabe with ConstructHUB support. I can open a support ticket for payment problems, login trouble, or something in the app that isn't working. First I need to verify your account. What's your customer number? You'll find it under Settings, and CRM accounts start with the letters C R M. If you don't have it, you can tell me the email on your account instead.",
  askIdAgain: "Sorry, I didn't catch that. Please say your customer number one digit at a time, or the email address on your account.",
  idGiveUp: "I couldn't match that. Please email support at constructhub dot us and we'll help you there. Goodbye.",
  sentNeutral: (ch: Channel) => ch === "sms"
    ? "If that matches an account, I just texted a six-digit code to the phone on file, or emailed it if there's no phone on the account. It's good for ten minutes. Please read me the code when you have it."
    : "If that matches an account, I just emailed a six-digit code to the email address on file. It's good for ten minutes. Please read me the code when you have it.",
  chooseChannel: "I can email a six-digit code to the email on your account, or text it to the phone number on your account. Which would you like, email or text?",
  sendRefused: "I can't send another code right now. Please try again in an hour, or email support at constructhub dot us. Goodbye.",
  badCode: "That code doesn't match. Please read me the six digits again.",
  codeExpired: "That code has expired. Let me send a new one.",
  codeGiveUp: "That's too many tries, so I can't verify this call. Please email support at constructhub dot us. Goodbye.",
  verified: "Thanks, you're verified. Tell me what's going on, with as much detail as you can, and I'll write it up for the team.",
  notSerious: "Thanks for explaining. That isn't something I open a ticket for on this line, but our how-to videos at constructhub dot us slash tutorials cover it, and you can email support at constructhub dot us anytime. Goodbye.",
  confirm: (title: string) => `Here's what I have: ${title}. Should I open the ticket? Please say yes or no.`,
  confirmNo: "No problem. Tell me what I should change.",
  opened: (n: string) => `Done. Your ticket number is ${n.split("").join(" ")}. I've emailed you a confirmation, and the team will reply by email. Is there anything else? If not, you can hang up. Goodbye.`,
  aiDown: "Please tell me what's wrong: is it about a payment, logging in, or something in the app not working? And describe what happens.",
  ticketCap: "You've already opened several tickets today, so I can't open another one on this line. Please email support at constructhub dot us and the team will pick it up. Goodbye.",
  tooLong: "I need to wrap up this call. Please email support at constructhub dot us with anything else. Goodbye.",
};

export const freshState = (): CallState => ({ step: "ask_id", idTries: 0, codeTries: 0, codesSent: 0, turns: 0, userId: null, crmOrgId: null, ref: null, email: null, phones: [], channel: null, codeHash: null, codeExpires: null, verified: false, intake: {}, aiTurns: [], ticketNumber: null });

const WORD_DIGITS: Record<string, string> = { zero: "0", oh: "0", o: "0", one: "1", won: "1", two: "2", to: "2", too: "2", three: "3", four: "4", for: "4", five: "5", six: "6", seven: "7", eight: "8", ate: "8", nine: "9" };
/** Spoken text → its digits ("four five two, 9 9 one" → "452991"). */
export function spokenDigits(text: string): string {
  return text.toLowerCase().replace(/[-,.]/g, " ").split(/\s+/).map((w) => (/^\d+$/.test(w) ? w : WORD_DIGITS[w] ?? "")).join("");
}
/** What the caller gave: a CRM number, a customer number or an email. */
export function parseIdentifier(text: string): { kind: "customer" | "crm" | "email"; value: string } | null {
  const t = text.toLowerCase();
  const em = t.replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s*@\s*/g, "@").replace(/\s*\.\s*/g, ".").match(/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/);
  if (em && /@|\bat\b/.test(t)) return { kind: "email", value: em[0].replace(/\.$/, "") };
  const crm = /\b(c\s*r\s*m|crm|see are em|c r m)\b/.test(t);
  const digits = spokenDigits(t);
  if (crm && digits.length === 7) return { kind: "crm", value: `CRM${digits}` };
  if (!crm && digits.length === 8) return { kind: "customer", value: digits };
  return null;
}
export const saidYes = (t: string) => /\b(yes|yeah|yep|yup|sure|correct|please do|go ahead|open it|do it|right)\b/i.test(t);
export const saidNo = (t: string) => /\b(no|nope|nah|don't|do not|wait|change)\b/i.test(t);
const SERIOUS: Category[] = ["payment", "login", "data"];
/** Serious = payment, login, data — or anything technical that blocks work. Code decides, not the AI. */
export const isSerious = (i: Intake) => !!i.category && (SERIOUS.includes(i.category) || (i.category === "technical" && i.blocking === true));
const MAX_TURNS = 40, CODE_TTL = 10 * 60_000;

export async function turn(s: CallState, callerText: string, callerNumber: string, d: Deps): Promise<Reply> {
  const text = (callerText || "").slice(0, 2000);
  if (s.step === "done") return { say: LINES.tooLong, end: true };
  if (++s.turns > MAX_TURNS) { s.step = "done"; return { say: LINES.tooLong, end: true }; }

  const sendTo = async (ch: Channel): Promise<Reply> => {
    if (s.codesSent >= 2) { s.step = "done"; return { say: LINES.sendRefused, end: true }; }
    s.channel = ch; s.codesSent++;
    // "Text" with no phone on file falls back to the email on file (the words cover both). No account: the same call,
    // the same budgets, nothing sent.
    const acct = s.userId !== null && s.email ? { userId: s.userId, email: s.email, phones: s.phones } : null;
    const r = await d.sendCode(acct, s.ref ?? "", ch === "sms" && !s.phones.length ? "email" : ch, callerNumber);
    if (!r.allowed) { s.step = "done"; return { say: LINES.sendRefused, end: true }; }
    s.codeHash = r.hash; s.codeExpires = d.now() + CODE_TTL;
    s.codeTries = 0; s.step = "code_sent";
    return { say: LINES.sentNeutral(ch), end: false };
  };

  switch (s.step) {
    case "ask_id": {
      const id = parseIdentifier(text);
      if (!id) { if (++s.idTries >= 3) { s.step = "done"; return { say: LINES.idGiveUp, end: true }; } return { say: LINES.askIdAgain, end: false }; }
      const acct = await d.findAccount(id);
      s.ref = id.kind === "email" ? "email" : id.value;
      if (acct) { s.userId = acct.userId; s.crmOrgId = acct.crmOrgId; s.email = acct.email; s.phones = acct.phones; }
      // Always the same question, account or not, phone on file or not: nothing about the account leaks.
      s.step = "choose_channel"; return { say: LINES.chooseChannel, end: false };
    }
    case "choose_channel":
      return sendTo(/\b(text|sms|message|phone)\b/i.test(text) ? "sms" : "email");
    case "code_sent": {
      const code = spokenDigits(text).slice(0, 6);
      if (s.codeExpires !== null && d.now() > s.codeExpires) return sendTo(s.channel ?? "email");
      const ok = code.length === 6 && s.codeHash !== null && d.hashCode(code) === s.codeHash;
      if (!ok) { if (++s.codeTries >= 3) { s.step = "done"; return { say: LINES.codeGiveUp, end: true }; } return { say: LINES.badCode, end: false }; }
      s.verified = true; s.codeHash = null; s.step = "intake";
      return { say: LINES.verified, end: false };
    }
    case "intake": {
      if (!s.verified) { s.step = "done"; return { say: LINES.codeGiveUp, end: true }; }   // cannot happen; belt and braces
      s.aiTurns.push({ role: "caller", text });
      let r: { say: string; intake: Intake; ready: boolean };
      try { r = await d.intakeTurn(s.aiTurns.slice(-16)); }
      catch {
        // AI down: collect deterministically — the first answer is the description, keywords pick the category.
        s.intake.description = [s.intake.description, text].filter(Boolean).join(" ").slice(0, 2000);
        s.intake.category = /pay|charge|card|invoice|bill|refund/i.test(s.intake.description) ? "payment" : /log ?in|password|locked|sign in/i.test(s.intake.description) ? "login" : /lost|missing|deleted|gone/i.test(s.intake.description) ? "data" : "technical";
        s.intake.blocking = true; s.intake.title = s.intake.description.slice(0, 80); s.intake.fallback = true;
        if (s.aiTurns.length < 2) { s.aiTurns.push({ role: "gabe", text: LINES.aiDown }); return { say: LINES.aiDown, end: false }; }
        r = { say: "", intake: s.intake, ready: true };
      }
      s.intake = { ...s.intake, ...cleanIntake(r.intake) };
      if (!r.ready) { const say = scrubSay(r.say) || LINES.aiDown; s.aiTurns.push({ role: "gabe", text: say }); return { say, end: false }; }
      if (!isSerious(s.intake)) { s.step = "done"; return { say: LINES.notSerious, end: true }; }
      s.step = "confirm";
      return { say: LINES.confirm(s.intake.title || "your issue"), end: false };
    }
    case "confirm": {
      if (saidYes(text) && !saidNo(text)) {
        const t = await d.openTicket(s, callerNumber);
        s.step = "done";
        if (!t) return { say: LINES.ticketCap, end: true };
        s.ticketNumber = t.number;
        return { say: LINES.opened(t.number), end: true };
      }
      s.step = "intake"; s.aiTurns.push({ role: "caller", text }, { role: "gabe", text: LINES.confirmNo });
      return { say: LINES.confirmNo, end: false };
    }
  }
  return { say: LINES.tooLong, end: true };
}

const CATS: Category[] = ["payment", "login", "technical", "data", "other"];
/** Only known fields, bounded; never trusted for anything but the ticket's words. */
export function cleanIntake(i: Intake | undefined): Intake {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : undefined);
  const o: Intake = {};
  if (i?.category && CATS.includes(i.category)) o.category = i.category;
  for (const [k, n] of [["title", 120], ["description", 2000], ["steps", 1000], ["device", 200]] as const) { const v = s((i as any)?.[k], n); if (v) (o as any)[k] = v; }
  if (typeof i?.blocking === "boolean") o.blocking = i.blocking;
  if (i?.fallback === true) o.fallback = true;
  return o;
}
/** What Gabe may say from the AI: short, no emails, no long digit runs, no links but our own. */
export function scrubSay(t: string): string {
  return (t || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "").replace(/\d[\d\s-]{4,}\d/g, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 400);
}
