import { randomUUID } from "node:crypto";
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
export async function sendSiteReport(userId: number, siteId: number, recipients: string[], period: string, opts: { workSince?: Date | null; workUntil?: Date | null; strict?: boolean } = {}): Promise<{ sent: number; skipped: number; failed: number; empty: boolean; optedOut: string[]; uncertain: string[] }> {
  const report = await buildSiteReport(userId, siteId, opts);
  if (!report || reportIsEmpty(report)) return { sent: 0, skipped: recipients.length, failed: 0, empty: true, optedOut: [], uncertain: [] };
  const out = new Set(await optedOut(userId));
  const [{ rows: [brand] }, { rows: [me] }] = await Promise.all([
    pool.query("SELECT name, logo FROM sitescan_branding WHERE user_id=$1", [userId]).catch(() => ({ rows: [] as any[] })),
    pool.query("SELECT company_name FROM users WHERE id=$1", [userId]).catch(() => ({ rows: [] as any[] })),
  ]);
  const pdf = await renderReportPdf(report, brand ?? null);
  let sent = 0, skipped = 0, failed = 0;
  const refused: string[] = [], unsure: string[] = [];
  for (const raw of recipients) {
    const to = norm(raw);
    // Read again just before this recipient (a long pass can outlast an unsubscribe made while it runs).
    if (out.has(to) || (await pool.query("SELECT 1 FROM seo_report_optouts WHERE user_id=$1 AND email=$2", [userId, to])).rows.length) { refused.push(to); skipped++; continue; }
    const mail = reportEmail(report, { brandName: brand?.name ?? null, senderName: me?.company_name ?? null, unsubscribe: unsubscribeUrl(userId, to) });
    // This recipient's delivery for the period: claimed before sending; "sent" only once the email went. Already sent =
    // done; a send under way elsewhere (pending, young) = not done yet, tried again later; a pending one older than half
    // an hour = a send that died, taken over.
    const token = randomUUID(), key = `seo-report:${siteId}:${period}:${to}`;
    const { rows: [claim] } = await pool.query(
      `INSERT INTO seo_report_deliveries(site_id, period, recipient, state, token) VALUES($1,$2,$3,'pending',$4)
       ON CONFLICT (site_id, period, recipient) DO UPDATE SET token=excluded.token, updated_at=now()
         WHERE seo_report_deliveries.state='pending' AND seo_report_deliveries.updated_at < now() - interval '30 minutes'
       RETURNING state`, [siteId, period, to, token]);
    if (!claim) {
      const { rows: [had] } = await pool.query("SELECT state FROM seo_report_deliveries WHERE site_id=$1 AND period=$2 AND recipient=$3", [siteId, period, to]);
      if (had?.state === "sent") { skipped++; continue; }
      if (had?.state === "uncertain") { unsure.push(to); skipped++; continue; }
      failed++; continue;   // being sent right now by another pass: not done, so the occurrence stays open
    }
    try {
      const attach = [{ filename: `seo-report-${report.domain}.pdf`, content: pdf, contentType: "application/pdf" }];
      const went = await sendTransactionalEmail(userId, "seo.report", key, { to, ...mail, attachments: attach }, { strict: true });
      if (!went) {
        // The email log holds a claim for this key that our delivery row does not show as sent. Young: another send is
        // under way — tried again later. Older than half an hour: a send that died after claiming, and it may have
        // died AFTER the email went — so it is not sent again automatically. The delivery is marked
        // "not known" and the Reports page says so; the occurrence can finish.
        const { rows: [old] } = await pool.query("SELECT 1 FROM email_log WHERE dedupe_key=$1 AND sent_at < now() - interval '30 minutes'", [key]);
        if (!old) throw new Error("another send of this email is under way");
        const { rowCount } = await pool.query("UPDATE seo_report_deliveries SET state='uncertain', updated_at=now() WHERE site_id=$1 AND period=$2 AND recipient=$3 AND token=$4 AND state='pending'", [siteId, period, to, token]);
        if (!rowCount) throw new Error("this delivery was taken over by another pass");
        unsure.push(to); skipped++;
        console.warn(`[seo] report for site ${siteId} to ${to.replace(/^(.).*@/, "$1***@")}: an earlier send died after claiming it — not sent again, delivery not known`);
        continue;
      }
      // The email went. If another pass took this delivery over meanwhile, the row is not ours to mark; it finds the
      // email log's claim and does not send again. Said in the log.
      const { rowCount } = await pool.query("UPDATE seo_report_deliveries SET state='sent', updated_at=now() WHERE site_id=$1 AND period=$2 AND recipient=$3 AND token=$4", [siteId, period, to, token]);
      if (!rowCount) console.warn(`[seo] report for site ${siteId}: sent, but its delivery row had been taken over by another pass`);
      sent++;
    } catch (e: any) {
      // A send that may have been accepted before it failed: its email-log claim is kept and the delivery is "not
      // known" — not sent again automatically, and the Reports page says so.
      if (e?.ambiguous) {
        const { rowCount } = await pool.query("UPDATE seo_report_deliveries SET state='uncertain', updated_at=now() WHERE site_id=$1 AND period=$2 AND recipient=$3 AND token=$4 AND state='pending'", [siteId, period, to, token]).catch(() => ({ rowCount: 0 }));
        if (rowCount) { unsure.push(to); skipped++; console.warn(`[seo] report for site ${siteId} to ${to.replace(/^(.).*@/, "$1***@")}: the send broke off and may have gone — not sent again, delivery not known`); continue; }
      }
      failed++;
      await pool.query("DELETE FROM seo_report_deliveries WHERE site_id=$1 AND period=$2 AND recipient=$3 AND token=$4 AND state='pending'", [siteId, period, to, token]).catch(() => {});
      console.error(`[seo] report for site ${siteId} to ${to.replace(/^(.).*@/, "$1***@")} failed: ${e?.message ?? e}`);
    }
  }
  return { sent, skipped, failed, empty: false, optedOut: refused, uncertain: unsure };
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
  // This pass's lease: a pass whose lease ran out and was taken over can neither finish the occurrence nor move its date.
  const token = randomUUID();
  const { rows: due } = await pool.query(
    // The occurrence is fixed the first time it is due — its work from / to, and the period its emails count under —
    // and kept for every retry, so a retry tells the same work to the recipients it did not reach yet.
    `UPDATE seo_report_schedules SET next_send_at = now() + interval '${LEASE}', work_cutoff = coalesce(work_cutoff, now()), lease_token = $1,
            work_since = coalesce(work_since, last_sent_at, now() - CASE WHEN frequency = 'weekly' THEN interval '7 days' ELSE interval '31 days' END),
            work_period = coalesce(work_period, CASE WHEN frequency = 'weekly' THEN 'w' || floor(extract(epoch FROM now()) / (7 * 86400))::bigint::text ELSE to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') END)
      WHERE site_id IN (SELECT site_id FROM seo_report_schedules WHERE frequency <> 'off' AND next_send_at <= now() AND cardinality(recipients) > 0 ORDER BY next_send_at LIMIT 10 FOR UPDATE SKIP LOCKED)
     RETURNING site_id, user_id, frequency, recipients, work_since, work_cutoff, work_period`, [token]);
  let sent = 0;
  for (const s of due) {
    try {
      if (!seoIncluded(await getEntitlements(s.user_id))) { await pool.query("UPDATE seo_report_schedules SET next_send_at = now() + interval '1 day' WHERE site_id=$1 AND lease_token=$2", [s.site_id, token]); continue; }
      // The work done in this occurrence (from where the last one ended), so none falls between two reports and none is
      // told twice; a plan that cannot be read stops the send and it is tried again.
      const r = await sendSiteReport(s.user_id, s.site_id, s.recipients, s.work_period, { workSince: new Date(s.work_since), workUntil: new Date(s.work_cutoff), strict: true });
      sent += r.sent;
      // Every address was dealt with (sent, already sent this period, or opted out): move on. A failure keeps the lease, so it is tried again.
      // Done — every recipient sent now, already sent for this occurrence, or opted out: the next report's work starts
      // at THIS occurrence's end. (An empty report sent nothing: its work is told next time.)
      if (r.failed === 0) await pool.query("UPDATE seo_report_schedules SET next_send_at=$2, last_sent_at=CASE WHEN $3 THEN work_cutoff ELSE last_sent_at END, work_cutoff=NULL, work_since=NULL, work_period=NULL, lease_token=NULL WHERE site_id=$1 AND lease_token=$4", [s.site_id, nextSendAt(s.frequency), !r.empty, token]);
    } catch (e: any) { console.error(`[seo] scheduled report for site ${s.site_id} failed (it will be retried): ${e?.message ?? e}`); }
  }
  return sent;
}
