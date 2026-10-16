/**
 * pressrelease@constructhub.us over IMAP (read, with attachments) and SMTP (send, with attachments), with the
 * mailbox's Gmail app password:
 *   PRESS_EMAIL, PRESS_APP_PASSWORD   the mailbox (server .env only; owner 2026-10-15: pressrelease@constructhub.us)
 *   PRESS_WIRE_EMAIL                  where a release is sent for distribution (the wire's submission address)
 *
 * Reads by UID past the last one seen, like server/media-inbox/mailbox.ts, and additionally keeps each attachment
 * (the wire's reports arrive as PDF/CSV) in R2 under press/inbox/. Every email the module sends carries the real
 * ConstructHUB signature (server/email-signature.ts), signed by the Press Team.
 */
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import { PRESS_MAILBOX } from "@shared/press";
import { signatureHtml, signatureText } from "../email-signature";
import { r2Configured, uploadToR2 } from "../r2";
import { stripQuoted } from "../media-inbox/mailbox";

export const PRESS_SIGNATURE_TEAM = "ConstructHUB Press Team";

export const mailboxConfig = (env: NodeJS.ProcessEnv = process.env) => ({
  user: env.PRESS_EMAIL?.trim() || "",
  pass: (env.PRESS_APP_PASSWORD ?? "").replace(/\s+/g, ""),
  wireTo: env.PRESS_WIRE_EMAIL?.trim() || "",
});
export const mailboxConfigured = (env: NodeJS.ProcessEnv = process.env) => { const c = mailboxConfig(env); return Boolean(c.user && c.pass); };
export const wireConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(mailboxConfig(env).wireTo);
/** The address customers see as the sender (the real mailbox when configured, else the documented one). */
export const pressFromAddress = (env: NodeJS.ProcessEnv = process.env) => mailboxConfig(env).user || PRESS_MAILBOX;

export type InboundAttachment = { name: string; url: string; contentType: string; size: number; /** text of a CSV / text attachment, for the reader */ text?: string };
export type Inbound = {
  uid: number; messageId: string; threadKey: string; fromEmail: string; fromName: string | null; to: string | null; subject: string; body: string;
  references: string[]; date: Date; attachments: InboundAttachment[]; autoSubmitted: string | null;
};

const addrText = (a: AddressObject | AddressObject[] | undefined) => (a ? (Array.isArray(a) ? a.map((x) => x.text).join(", ") : a.text) : null);
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "attachment";
const extOf = (n: string, ct: string) => (n.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? ct.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin").toLowerCase();

/** Every message past `lastUid` (a new UIDVALIDITY starts over); attachments stored in R2 when it is configured. */
export async function fetchSince(lastUid: number, uidValidity: string | null): Promise<{ uidValidity: string; messages: Inbound[] }> {
  const c = mailboxConfig();
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.pass }, logger: false });
  await client.connect();
  const messages: Inbound[] = [];
  let validity = "";
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      validity = String((client.mailbox as any)?.uidValidity ?? "");
      const from = uidValidity && uidValidity !== validity ? 1 : lastUid + 1;
      for await (const m of client.fetch(`${from}:*`, { uid: true, source: true, threadId: true }, { uid: true })) {
        if (m.uid < from || !m.source) continue;
        const p = await simpleParser(m.source);
        const sender = p.from?.value?.[0];
        const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
        const attachments: InboundAttachment[] = [];
        for (const a of p.attachments ?? []) {
          if (!a.content?.length || a.content.length > 25 * 1024 * 1024) continue;
          const name = safeName(a.filename ?? `attachment.${extOf("", a.contentType)}`);
          const text = /^text\/(csv|plain)|json/i.test(a.contentType) && a.content.length < 512 * 1024 ? a.content.toString("utf8") : undefined;
          let url = "";
          if (r2Configured()) {
            try { const key = await uploadToR2(a.content, a.contentType || "application/octet-stream", "press/inbox", extOf(name, a.contentType)); url = `/api/admin/press/attachments/${key.slice("press/inbox/".length)}`; }
            catch (e: any) { console.error(`[press] attachment ${name} not stored: ${e?.message ?? e}`); }
          }
          attachments.push({ name, url, contentType: a.contentType, size: a.content.length, ...(text ? { text } : {}) });
        }
        messages.push({
          uid: m.uid,
          messageId: p.messageId ?? `<uid-${validity}-${m.uid}@press.constructhub.us>`,
          threadKey: m.threadId ? `gm:${m.threadId}` : (refs[0] ?? p.messageId ?? `uid:${m.uid}`),
          fromEmail: (sender?.address ?? "").toLowerCase(),
          fromName: sender?.name || null,
          to: addrText(p.to),
          subject: p.subject ?? "",
          body: stripQuoted(p.text ?? (p.html ? String(p.html).replace(/<[^>]+>/g, " ") : "")).slice(0, 20_000),
          references: [...refs, ...(p.inReplyTo && !refs.includes(p.inReplyTo) ? [p.inReplyTo] : [])],
          date: p.date ?? new Date(),
          attachments,
          autoSubmitted: (() => { const v = p.headers.get("auto-submitted"); return v == null ? null : typeof v === "string" ? v : String((v as any).text ?? v); })(),
        });
      }
      if (messages.length) {
        await client.messageFlagsAdd(messages.map((m) => m.uid).join(","), ["\\Seen"], { uid: true })
          .catch((e) => console.error(`[press] marking read in Gmail failed: ${e?.message ?? e}`));
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => undefined); }
  return { uidValidity: validity, messages };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Body + the Press Team's real signature, plain text and HTML. `html` may carry a pre-rendered body instead. */
export function composeMail(body: string, html?: string) {
  const sig = { team: PRESS_SIGNATURE_TEAM, email: pressFromAddress() };
  return {
    text: `${body.trim()}\n\n${signatureText(sig)}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;">${html ?? esc(body.trim()).replace(/\n/g, "<br>")}${signatureHtml(sig)}</div>`,
  };
}

export type OutgoingAttachment = { filename: string; content: Buffer; contentType?: string };

export const mailDeps = {
  transport: () => {
    const c = mailboxConfig();
    return nodemailer.createTransport({ service: "gmail", auth: { user: c.user, pass: c.pass } });
  },
};

/**
 * Send from pressrelease@ (threaded when `inReplyTo` is given), with the real signature. Returns the Message-ID.
 * Falls back to the support@ mailer (server/email.ts) when the press mailbox is not configured yet, so a customer
 * always hears from us; a submission to the wire never falls back (worker.ts holds it instead).
 */
export async function sendMail(m: { to: string; cc?: string | null; replyTo?: string; subject: string; body: string; html?: string; inReplyTo?: string; references?: string[]; attachments?: OutgoingAttachment[] }): Promise<string> {
  const { text, html } = composeMail(m.body, m.html);
  const threading = m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [...(m.references ?? []), m.inReplyTo].filter((v, i, a) => a.indexOf(v) === i).join(" ") } : {};
  const common = { to: m.to, ...(m.cc ? { cc: m.cc } : {}), ...(m.replyTo ? { replyTo: m.replyTo } : {}), subject: m.subject, text, html, ...threading, ...(m.attachments?.length ? { attachments: m.attachments } : {}) };
  if (mailboxConfigured()) {
    const info = await mailDeps.transport().sendMail({ from: `"${PRESS_SIGNATURE_TEAM}" <${mailboxConfig().user}>`, ...common });
    return String(info.messageId);
  }
  const { sendWithFallback } = await import("../email");
  const info: any = await sendWithFallback({ from: `"${PRESS_SIGNATURE_TEAM}" <${process.env.SMTP_EMAIL}>`, ...common });
  return String(info?.messageId ?? `<press-${Date.now()}@constructhub.us>`);
}
