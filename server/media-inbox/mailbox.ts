/**
 * media@constructhub.us over IMAP (read) and SMTP (send), with the account's Gmail app password:
 *   MEDIA_EMAIL, MEDIA_APP_PASSWORD   the mailbox (server .env only)
 * Reads by UID past the last one seen (Gmail's thread id groups a conversation); sends threaded replies signed
 * "Leah Peterson, Partnerships — Construct HUB Media Team" (shared/media-inbox.ts MEDIA_SIGNER).
 */
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import { MEDIA_SIGNATURE_TEAM, MEDIA_SIGNER } from "@shared/media-inbox";
import { signatureHtml, signatureText } from "../email-signature";
import { botTellProblem } from "./guard";

export const mailboxConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  user: env.MEDIA_EMAIL?.trim() ?? "",
  pass: (env.MEDIA_APP_PASSWORD ?? "").replace(/\s+/g, ""),
});
/** support@, read-only: where the 2026-10-13 press-wire and listings price requests went, so their answers land there. */
export const supportMailboxConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  user: env.SMTP_EMAIL?.trim() ?? "",
  pass: (env.SMTP_APP_PASSWORD ?? "").replace(/\s+/g, ""),
});
export const mailboxConfigured = (env: NodeJS.ProcessEnv = process.env) => {
  const c = mailboxConfig(env);
  return Boolean(c.user && c.pass);
};

export type Inbound = {
  uid: number;
  messageId: string;
  threadKey: string;
  fromEmail: string;
  fromName: string | null;
  to: string | null;
  cc: string | null;
  subject: string;
  body: string;
  references: string[];
  date: Date;
  autoSubmitted: string | null;
  precedence: string | null;
  listUnsubscribe: string | null;
  listId: string | null;
};

/** The new part of a reply: drops the quoted history ("On … wrote:", "> " lines, Outlook's "From: … Sent:" block). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^On .{6,200}wrote:\s*$/.test(l) || (/^On .{6,200}$/.test(l) && /wrote:\s*$/.test(lines[i + 1] ?? ""))) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    if (/^From:\s.+/.test(l) && lines.slice(i + 1, i + 5).some((x) => /^(Sent|Date):\s/.test(x))) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Plain text from an HTML email: block ends become line breaks, tags go, common entities are decoded. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * What a person wrote in an email. Some clients send an empty text part next to the real HTML one (Reputation,
 * 2026-10-22, was stored blank); a reply that is only an attachment (Industry Today's PDF, 2026-10-21) says so.
 */
export function inboundBody(p: { text?: string; html?: string | false; attachments?: { filename?: string; contentDisposition?: string }[] }): string {
  const text = p.text?.trim() ? p.text : typeof p.html === "string" ? htmlToPlain(p.html) : "";
  const files = (p.attachments ?? []).filter((a) => a.filename && a.contentDisposition !== "inline").map((a) => a.filename!);
  const body = stripQuoted(text);
  return [body, files.length ? `[Attached: ${files.join(", ")}]` : ""].filter(Boolean).join("\n\n").slice(0, 20_000);
}

const addrText = (a: AddressObject | AddressObject[] | undefined) => (a ? (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a.text) : null);
const headerText = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "text" in (v as any)) return String((v as any).text);
  return JSON.stringify(v);
};

/**
 * Every message past `lastUid` (a new UIDVALIDITY starts over). media@ marks what it stored as read; `readOnly` (support@,
 * which people work in Gmail) leaves the flags alone. `firstSince` is where a mailbox read for the first time starts.
 */
export async function fetchSince(lastUid: number, uidValidity: string | null, o: { mailbox?: { user: string; pass: string }; readOnly?: boolean; firstSince?: Date } = {}): Promise<{ uidValidity: string; messages: Inbound[] }> {
  const c = o.mailbox ?? mailboxConfig();
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false });
  await client.connect();
  const messages: Inbound[] = [];
  let validity = "";
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: Boolean(o.readOnly) });
    try {
      validity = String((client.mailbox as any)?.uidValidity ?? "");
      let from = uidValidity && uidValidity !== validity ? 1 : lastUid + 1;
      if (from === 1 && o.firstSince) {
        const uids = (await client.search({ since: o.firstSince }, { uid: true })) || [];
        if (!uids.length) return { uidValidity: validity, messages };
        from = Math.min(...uids);
      }
      for await (const m of client.fetch(`${from}:*`, { uid: true, source: true, threadId: true }, { uid: true })) {
        if (m.uid < from || !m.source) continue;
        const p = await simpleParser(m.source);
        const sender = p.from?.value?.[0];
        const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
        messages.push({
          uid: m.uid,
          messageId: p.messageId ?? `<uid-${validity}-${m.uid}@media.constructhub.us>`,
          threadKey: m.threadId ? `gm:${m.threadId}` : (refs[0] ?? p.messageId ?? `uid:${m.uid}`),
          fromEmail: (sender?.address ?? "").toLowerCase(),
          fromName: sender?.name || null,
          to: addrText(p.to),
          cc: addrText(p.cc),
          subject: p.subject ?? "",
          body: inboundBody(p),
          references: [...refs, ...(p.inReplyTo && !refs.includes(p.inReplyTo) ? [p.inReplyTo] : [])],
          date: p.date ?? new Date(),
          autoSubmitted: headerText(p.headers.get("auto-submitted")),
          precedence: headerText(p.headers.get("precedence")),
          listUnsubscribe: headerText(p.headers.get("list-unsubscribe")),
          listId: headerText(p.headers.get("list-id")),
        });
      }
      // Read in Gmail once stored here (owner, 2026-10-14: an unread email looks ignored). Stored = it will be handled.
      if (messages.length && !o.readOnly) {
        const ok = await client.messageFlagsAdd(messages.map((m) => m.uid).join(","), ["\\Seen"], { uid: true })
          .catch((e) => { console.error(`[media-inbox] marking read in Gmail failed: ${e?.message ?? e}`); return false; });
        if (!ok) console.error(`[media-inbox] Gmail did not mark UIDs ${messages.map((m) => m.uid).join(",")} read`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return { uidValidity: validity, messages };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The email as sent: body + the media team's signature, plain text and HTML. */
export function composeMail(body: string, user: string) {
  const sig = { team: MEDIA_SIGNATURE_TEAM, email: user, ...MEDIA_SIGNER };
  return {
    text: `${body.trim()}\n\n${signatureText(sig)}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">${esc(body.trim()).replace(/\n/g, "<br>")}${signatureHtml(sig)}</div>`,
  };
}

export const mailDeps = {
  transport: () => {
    const c = mailboxConfig();
    return nodemailer.createTransport({ service: "gmail", auth: { user: c.user, pass: c.pass } });
  },
};

/** Send from media@ (threaded when `inReplyTo` is given). Returns the new Message-ID. */
export async function sendMail(m: { to: string; cc?: string | null; subject: string; body: string; inReplyTo?: string; references?: string[] }): Promise<string> {
  // OWNER LAW 2026-10-15: every email from media@ (replies, follow-ups, first contact, the admin form) — never one that
  // gives away a bot or a script. Refused here, at the one door all of them go through.
  const tell = botTellProblem(`${m.subject}\n${m.body}`);
  if (tell) throw new Error(`Refused to send to ${m.to}: ${tell}`);
  const c = mailboxConfig();
  const { text, html } = composeMail(m.body, c.user);
  const info = await mailDeps.transport().sendMail({
    from: `"${MEDIA_SIGNER.name} | Construct HUB" <${c.user}>`,
    to: m.to,
    ...(m.cc ? { cc: m.cc } : {}),
    subject: m.subject,
    text,
    html,
    ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [...(m.references ?? []), m.inReplyTo].filter((v, i, a) => a.indexOf(v) === i).join(" ") } : {}),
  });
  return String(info.messageId);
}
