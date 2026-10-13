/**
 * Outreach: a pitch per qualified source that publishes an email address, drafted automatically and sent only
 * after an admin approves it — and only when sending is switched on with a SEPARATE outreach mailbox, so cold
 * email can never hurt the deliverability of constructhub.us's own mail (sign-ups, receipts, alerts).
 *
 *   BACKLINKS_OUTREACH_SEND=on            sending allowed (default off: drafts and approvals only)
 *   BACKLINKS_SMTP_USER / _PASS / _HOST   the outreach mailbox (host defaults to Gmail)
 *   BACKLINKS_SENDER_NAME                 who signs the pitch (default "ConstructHUB Partnerships")
 *   BACKLINKS_SENDER_ADDRESS              the postal address CAN-SPAM requires in every commercial email
 *   BACKLINKS_OUTREACH_DAILY              most emails per day (default 30)
 *
 * Directories and citations get no email: they take a form submission (a later phase).
 */
import nodemailer from "nodemailer";
import type { BacklinkKind, BacklinkSignals } from "@shared/backlinks";
import { pool } from "../db";
import { isSuppressed } from "./store";

export const PITCHED_KINDS: readonly BacklinkKind[] = ["guest_post", "resource_page", "editorial", "press_release"];

export type OutreachConfig = { send: boolean; user: string; pass: string; host: string; name: string; address: string; daily: number };
export function outreachConfig(env: NodeJS.ProcessEnv = process.env): OutreachConfig {
  const daily = Number(env.BACKLINKS_OUTREACH_DAILY);
  return {
    send: env.BACKLINKS_OUTREACH_SEND === "on",
    user: env.BACKLINKS_SMTP_USER?.trim() ?? "", pass: env.BACKLINKS_SMTP_PASS?.trim() ?? "", host: env.BACKLINKS_SMTP_HOST?.trim() || "smtp.gmail.com",
    name: env.BACKLINKS_SENDER_NAME?.trim() || "ConstructHUB Partnerships",
    address: env.BACKLINKS_SENDER_ADDRESS?.trim() ?? "",
    daily: Number.isFinite(daily) && daily > 0 ? Math.min(500, Math.floor(daily)) : 30,
  };
}
/** Why sending cannot run, or null when it can. */
export function sendBlocker(c: OutreachConfig): string | null {
  if (!c.send) return "Sending is off (BACKLINKS_OUTREACH_SEND is not on)";
  if (!c.user || !c.pass) return "No outreach mailbox (BACKLINKS_SMTP_USER / BACKLINKS_SMTP_PASS)";
  if (/@constructhub\.us$/i.test(c.user)) return "Outreach must not send from constructhub.us — use a separate outreach domain";
  if (!c.address) return "No postal address for the CAN-SPAM footer (BACKLINKS_SENDER_ADDRESS)";
  return null;
}

/** The address to pitch: an editor/contact mailbox over a personal-looking one, never a no-reply. */
export function pickEmail(emails: string[]): string | null {
  const usable = emails.filter((e) => !/^(no-?reply|donotreply|mailer-daemon|postmaster|abuse|privacy|legal|billing|careers|jobs)@/i.test(e));
  const prefer = /^(editor|editorial|contribut|guest|submissions?|pitch|news|press|media|partnerships?|advertis|marketing|hello|contact|info)/i;
  return usable.find((e) => prefer.test(e)) ?? usable[0] ?? null;
}

/**
 * The site's name for a greeting: the part of the page title that matches the domain ("Write for Us | HomeFix Blog"
 * on homefixblog.com → "HomeFix Blog"), else the domain itself — never a page heading like "Write for Us".
 */
export function siteName(domain: string, s: BacklinkSignals | null): string {
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const label = flat(domain.split(".").slice(-2)[0] ?? domain);
  const parts = (s?.title ?? "").split(/\s[|\-–—:·]\s|\s?\|\s?/).map((x) => x.trim()).filter(Boolean);
  const hit = parts.find((p) => { const f = flat(p); return f.length >= 3 && (label.includes(f) || f.includes(label)); });
  return (hit ?? domain).slice(0, 80);
}

/**
 * The pitch, from a fixed template per kind (no AI: nothing in it can be made up). It says who we are, asks
 * for the site's terms, and states that paid placements are marked as sponsored — the honest version, which
 * is also what keeps a customer's link safe.
 */
export function composePitch(kind: BacklinkKind, domain: string, signals: BacklinkSignals | null, senderName: string): { subject: string; body: string } {
  const name = siteName(domain, signals);
  const hello = `Hi ${name} team,`;
  const sign = `\n\nThanks,\n${senderName}\nConstructHUB — software for home-service contractors\nhttps://constructhub.us`;
  switch (kind) {
    case "guest_post":
      return {
        subject: `Contributor article for ${name}`,
        body: `${hello}\n\nWe work with licensed contractors across the US — roofers, plumbers, HVAC and remodeling companies — and write practical articles for homeowners from what they see on the job (costs, timelines, permits, what to ask before hiring).\n\nWe'd like to contribute an original article to ${name}. Could you share your guidelines, any topics you're looking for, and whether you charge for contributed posts? If a placement is paid, we're happy for the link to be marked rel="sponsored".`
          + sign,
      };
    case "resource_page":
      return {
        subject: `A homeowner resource for your links page`,
        body: `${hello}\n\nI came across your resources page on ${domain}. We publish free guides for homeowners — how to check a contractor's permits and license, and what a fair estimate looks like — written with working contractors.\n\nWould you consider one of them for your list? I can send the links, and I'm glad to hear what makes a resource a fit for you.`
          + sign,
      };
    case "editorial":
      return {
        subject: `Contractor sources for your home-improvement stories`,
        body: `${hello}\n\nWe work with licensed contractors across the US who can answer reporters' questions on roofing, plumbing, HVAC, remodeling, building permits and home-repair costs — on the record, with their name and company.\n\nIf you're working on a story where a contractor's view would help, reply with the question and your deadline and we'll put you in touch with one who knows the topic.`
          + sign,
      };
    case "press_release":
      return {
        subject: `Press release submissions on ${name}`,
        body: `${hello}\n\nWe help home-service contractors announce real company news (new locations, certifications, community projects). Could you tell us how to submit a release to ${name}, what it costs, and whether published releases include a link to the company's website?`
          + sign,
      };
    default:
      return { subject: `Listing on ${name}`, body: `${hello}\n\nHow can a home-service contractor be listed on ${name}?` + sign };
  }
}

/** Every commercial email: the sender's postal address and a working way to stop more email (CAN-SPAM). */
export function withFooter(body: string, address: string): string {
  return `${body}\n\n—\n${address}\nNot interested? Reply "stop" and we won't email you again.`;
}

export const sendDeps = {
  transport: (c: OutreachConfig) => nodemailer.createTransport({ host: c.host, port: 465, secure: true, auth: { user: c.user, pass: c.pass } }),
};

/** Send approved pitches, up to today's cap. Suppressed addresses are skipped and marked opted_out. */
export async function sendApproved(c: OutreachConfig = outreachConfig()): Promise<{ sent: number; skipped: number; blocked: string | null }> {
  const blocked = sendBlocker(c);
  if (blocked) return { sent: 0, skipped: 0, blocked };
  const today = Number((await pool.query(`SELECT count(*)::int n FROM backlink_outreach WHERE sent_at >= date_trunc('day', now())`)).rows[0]?.n ?? 0);
  const room = Math.max(0, c.daily - today);
  if (!room) return { sent: 0, skipped: 0, blocked: null };
  const rows = (await pool.query(`SELECT id, source_id, to_email, subject, body FROM backlink_outreach WHERE status = 'approved' ORDER BY approved_at LIMIT $1`, [room])).rows;
  const t = sendDeps.transport(c);
  let sent = 0, skipped = 0;
  for (const r of rows) {
    if (await isSuppressed(r.to_email)) {
      await pool.query(`UPDATE backlink_outreach SET status = 'opted_out' WHERE id = $1`, [r.id]);
      skipped++;
      continue;
    }
    await t.sendMail({ from: `"${c.name}" <${c.user}>`, to: r.to_email, subject: r.subject, text: withFooter(r.body, c.address) });
    await pool.query(`UPDATE backlink_outreach SET status = 'sent', sent_at = now() WHERE id = $1`, [r.id]);
    await pool.query(`UPDATE backlink_sources SET status = 'contacted', updated_at = now() WHERE id = $1 AND status = 'qualified'`, [r.source_id]);
    await pool.query(`INSERT INTO backlink_events (source_id, type, detail) VALUES ($1, 'outreach_sent', $2)`, [r.source_id, JSON.stringify({ to: r.to_email })]);
    sent++;
  }
  return { sent, skipped, blocked: null };
}
