/**
 * Sending the SEO report by email: "Send now" and the weekly / monthly schedule
 * (server/seo/jobs.ts runs it). These emails go to addresses the customer
 * typed, so every one carries a link that stops them for that address, an
 * address that used it is never mailed again by that account, and nothing is
 * sent once the account no longer has the SEO tools.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { emailLayout, sendTransactionalEmail, APP_BASE_URL } from "../account/email";
import { getEntitlements } from "../entitlements";
import { seoIncluded } from "./plan";
import { buildSiteReport, renderReportPdf, reportHighlights, reportIsEmpty, nextSendAt, sendPeriod, type SiteReport } from "./site-report";

const secret = () => process.env.SEO_REPORT_SECRET || process.env.SESSION_SECRET || "";
const norm = (email: string) => email.trim().toLowerCase();
/** The token in an unsubscribe link: only we can make one for an (account, address) pair. Empty when no secret is set. */
export function unsubscribeToken(userId: number, email: string, key = secret()): string {
  return key ? createHmac("sha256", key).update(`seo-report:${userId}:${norm(email)}`).digest("hex").slice(0, 40) : "";
}
export function validUnsubscribe(userId: number, email: string, token: string, key = secret()): boolean {
  const want = unsubscribeToken(userId, email, key);
  if (!want || typeof token !== "string" || token.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(token));
}
export function unsubscribeUrl(userId: number, email: string): string | null {
  const t = unsubscribeToken(userId, email);
  return t ? `${APP_BASE_URL()}/api/seo/report-unsubscribe?u=${userId}&e=${encodeURIComponent(norm(email))}&t=${t}` : null;
}
export async function optOut(userId: number, email: string): Promise<void> {
  await pool.query("INSERT INTO seo_report_optouts(user_id, email) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, norm(email)]);
}
export async function optedOut(userId: number): Promise<string[]> {
  const { rows } = await pool.query("SELECT email FROM seo_report_optouts WHERE user_id=$1 ORDER BY email", [userId]);
  return rows.map((r: any) => r.email);
}

export function reportEmail(r: SiteReport, opts: { brandName?: string | null; senderName?: string | null; unsubscribe?: string | null } = {}): { subject: string; html: string; text: string } {
  const k = r.rankings;
  const intro = k
    ? `${k.top10} of ${k.checked} checked keywords are in Google's top 10${k.previousTop10 !== null && k.previousTop10 !== k.top10 ? ` (${k.top10 > k.previousTop10 ? "up" : "down"} from ${k.previousTop10})` : ""}. ${k.improvedCount} moved up and ${k.declinedCount} moved down. The full report is attached.`
    : "The full report is attached.";
  const who = opts.brandName || opts.senderName;
  const { html, text } = emailLayout({
    title: `SEO report for ${r.domain}`, intro, rows: reportHighlights(r),
    footer: `${who ? `${who} asked ConstructHUB to send you this report. ` : "A ConstructHUB customer asked us to send you this report. "}Positions are Google's organic results; visits are estimates.` +
      (opts.unsubscribe ? ` Don't want these? Stop them here: ${opts.unsubscribe}` : ""),
    preheader: intro,
  });
  return { subject: `SEO report — ${r.domain}`, html, text };
}

/**
 * Email the report to each address once for this period. `period` is the
 * dedupe window ("send now" passes a fresh one). An empty report (nothing saved
 * for the site yet) is not sent; an address that opted out is skipped.
 */
export async function sendSiteReport(userId: number, siteId: number, recipients: string[], period: string, opts: { workSince?: Date | null; strict?: boolean } = {}): Promise<{ sent: number; skipped: number; failed: number; empty: boolean; optedOut: string[] }> {
  const report = await buildSiteReport(userId, siteId, opts);
  if (!report || reportIsEmpty(report)) return { sent: 0, skipped: recipients.length, failed: 0, empty: true, optedOut: [] };
  const out = new Set(await optedOut(userId));
  const [{ rows: [brand] }, { rows: [me] }] = await Promise.all([
    pool.query("SELECT name, logo FROM sitescan_branding WHERE user_id=$1", [userId]).catch(() => ({ rows: [] as any[] })),
    pool.query("SELECT company_name FROM users WHERE id=$1", [userId]).catch(() => ({ rows: [] as any[] })),
  ]);
  const pdf = await renderReportPdf(report, brand ?? null);
  let sent = 0, skipped = 0, failed = 0;
  const refused: string[] = [];
  for (const raw of recipients) {
    const to = norm(raw);
    if (out.has(to)) { refused.push(to); skipped++; continue; }
    const mail = reportEmail(report, { brandName: brand?.name ?? null, senderName: me?.company_name ?? null, unsubscribe: unsubscribeUrl(userId, to) });
    try {
      const went = await sendTransactionalEmail(userId, "seo.report", `seo-report:${siteId}:${period}:${to}`, { to, ...mail, attachments: [{ filename: `seo-report-${report.domain}.pdf`, content: pdf, contentType: "application/pdf" }] });
      went ? sent++ : skipped++;
    } catch (e: any) { failed++; console.error(`[seo] report for site ${siteId} to ${to.replace(/^(.).*@/, "$1***@")} failed: ${e?.message ?? e}`); }
  }
  return { sent, skipped, failed, empty: false, optedOut: refused };
}

/** How long a due schedule is held while its emails go out; if the process dies, it is due again after this. */
const LEASE = "1 hour";

/**
 * Scheduled reports that are due. A due schedule is leased (pushed an hour on),
 * the emails go out, and only then does it move to its real next date — so a
 * crash or a failed send is retried, and the per-recipient, per-period dedupe
 * key keeps a retry from mailing anyone twice. An account without the SEO
 * tools is not mailed; its schedule waits a day and is looked at again.
 */
export async function sendDueReports(): Promise<number> {
  const { rows: due } = await pool.query(
    `UPDATE seo_report_schedules SET next_send_at = now() + interval '${LEASE}'
      WHERE site_id IN (SELECT site_id FROM seo_report_schedules WHERE frequency <> 'off' AND next_send_at <= now() AND cardinality(recipients) > 0 ORDER BY next_send_at LIMIT 10 FOR UPDATE SKIP LOCKED)
     RETURNING site_id, user_id, frequency, recipients, last_sent_at`);
  let sent = 0;
  for (const s of due) {
    try {
      if (!seoIncluded(await getEntitlements(s.user_id))) { await pool.query("UPDATE seo_report_schedules SET next_send_at = now() + interval '1 day' WHERE site_id=$1", [s.site_id]); continue; }
      // The work done since the last report went out (the first one: a week or a month back), so none falls between two
      // reports and none is told twice; a plan that cannot be read stops the send and it is tried again.
      const since = s.last_sent_at ? new Date(s.last_sent_at) : new Date(Date.now() - (s.frequency === "weekly" ? 7 : 31) * 864e5);
      const r = await sendSiteReport(s.user_id, s.site_id, s.recipients, sendPeriod(s.frequency), { workSince: since, strict: true });
      sent += r.sent;
      // Every address was dealt with (sent, already sent this period, or opted out): move on. A failure keeps the lease, so it is tried again.
      if (r.failed === 0) await pool.query("UPDATE seo_report_schedules SET next_send_at=$2, last_sent_at=CASE WHEN $3 THEN now() ELSE last_sent_at END WHERE site_id=$1", [s.site_id, nextSendAt(s.frequency), r.sent > 0]);
    } catch (e: any) { console.error(`[seo] scheduled report for site ${s.site_id} failed (it will be retried): ${e?.message ?? e}`); }
  }
  return sent;
}
