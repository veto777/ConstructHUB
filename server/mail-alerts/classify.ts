import { simpleParser } from "mailparser";
import { z } from "zod";
import { load } from "cheerio";
export const SENDERS: Record<string, string[]> = {
  gbp: [
    "google-my-business-noreply@google.com",
    "mybusiness-noreply@google.com",
    "businessprofile-noreply@google.com",
  ],
  gsc: ["sc-noreply@google.com", "search-console-noreply@google.com"],
  ads: ["adwords-noreply@google.com", "ads-noreply@google.com"],
  cloudflare: ["noreply@notify.cloudflare.com", "noreply@cloudflare.com"],
  forwarding: ["forwarding-noreply@google.com"],
};
export const REGISTRAR_SENDERS = [
  "porkbun.com",
  "name.com",
  "namecheap.com",
  "godaddy.com",
  "dynadot.com",
  "gandi.net",
  "ionos.com",
  "hover.com",
  "squarespace.com",
  "networksolutions.com",
];
export const GMAIL_QUERY = `newer_than:30d {${Object.values(SENDERS)
  .flat()
  .map((s) => `from:${s}`)
  .join(
    " ",
  )} ${[...REGISTRAR_SENDERS, "blotato.com"].map((s) => `from:(@${s})`).join(" ")}}`;
const mailInput = z
  .object({
    from: z.string().max(500),
    to: z.string().max(1000),
    subject: z.string().max(1000).default(""),
    text: z.string().max(262144).optional(),
    html: z.string().max(262144).optional(),
    headers: z.record(z.unknown()).optional(),
  })
  .strict();
export type Mail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
};
const plain = (html: string) => {
  const $ = load(html);
  $("script,style,iframe").remove();
  return $.root().text();
};
export async function parseMail(raw: unknown): Promise<Mail> {
  if (typeof raw === "string" || Buffer.isBuffer(raw)) {
    if (Buffer.byteLength(raw) > 262144) throw new Error("Payload too large");
    const m = await simpleParser(raw, {
      skipHtmlToText: true,
      skipImageLinks: true,
    });
    return {
      from: m.from?.value[0]?.address || "",
      to: (Array.isArray(m.to) ? m.to : [m.to])
        .flatMap((a) => a?.value.map((v) => v.address) || [])
        .join(","),
      subject: (m.subject || "").slice(0, 1000),
      text: (m.text || plain(m.html || "")).slice(0, 64000),
      messageId: m.messageId,
    };
  }
  const m = mailInput.parse(raw);
  return {
    from: m.from,
    to: m.to,
    subject: m.subject,
    text: (m.text || plain(m.html || "")).slice(0, 64000),
    messageId:
      typeof m.headers?.["message-id"] === "string"
        ? m.headers["message-id"]
        : undefined,
  };
}
export function classifyMail(mail: Mail) {
  const sender = (mail.from.match(/<([^<>]+)>/)?.[1] || mail.from)
    .trim()
    .toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(sender)) return null;
  let category = Object.entries(SENDERS).find(([, list]) =>
    list.includes(sender),
  )?.[0];
  const host = sender.split("@")[1];
  if (
    !category &&
    REGISTRAR_SENDERS.some((d) => host === d || host.endsWith(`.${d}`))
  )
    category = "registrar";
  if (!category && (host === "blotato.com" || host.endsWith(".blotato.com")))
    category = "blotato";
  if (!category) return null;
  const text = `${mail.subject}\n${mail.text}`;
  if (category === "forwarding") {
    if (!/forwarding|confirmation/i.test(mail.subject)) return null;
    const code =
      text.match(/(?:confirmation\s*code|code)\s*[:：]?\s*(\d{6,12})/i)?.[1] ||
      null;
    const urls = text.match(/https:\/\/[^\s<>"')]+/g) || [];
    const link =
      urls.find((s) => {
        try {
          const u = new URL(s);
          return (
            ["mail.google.com", "mail-settings.google.com"].includes(
              u.hostname,
            ) &&
            u.pathname.startsWith("/mail/") &&
            !u.username &&
            !u.password
          );
        } catch {
          return false;
        }
      }) || null;
    return { sender, category, severity: "info" as const, code, link };
  }
  const topics: Record<string, RegExp> = {
    gbp: /verif|suspend|suspension|ownership|manager|edit|updated|access request/i,
    gsc: /index|coverage|manual action|security|owner|crawl/i,
    ads: /policy|disapprov|billing|payment|suspend|suspension/i,
    cloudflare: /invite|invitation|member|attack|ssl|certificate|security/i,
    registrar: /expir|renew|transfer|nameserver|dns|security/i,
    blotato: /fail|error|disconnect|quota|billing|payment|publish/i,
  };
  if (!topics[category].test(mail.subject)) return null;
  const critical =
    (category === "registrar" && /transfer/i.test(text)) ||
    /new owner|ownership request|manual action|security issue|suspend|suspension/i.test(
      text,
    );
  return {
    sender,
    category,
    severity: critical ? ("critical" as const) : ("warning" as const),
    code: null,
    link: null,
  };
}
