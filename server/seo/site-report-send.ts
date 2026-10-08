/** Sending the SEO report by email: "Send now" and the weekly / monthly schedule (server/seo/jobs.ts runs it). */
import { pool } from "../db";
import { emailLayout, sendTransactionalEmail, APP_BASE_URL } from "../account/email";
import { buildSiteReport, renderReportPdf, reportHighlights, reportIsEmpty, nextSendAt, sendPeriod, type SiteReport } from "./site-report";

export function reportEmail(r: SiteReport, brandName?: string | null): { subject: string; html: string; text: string } {
  const k = r.rankings;
  const intro = k
    ? `${k.top10} of ${k.tracked} tracked keywords are in Google's top 10${k.previousTop10 !== null && k.previousTop10 !== k.top10 ? ` (${k.top10 > k.previousTop10 ? "up" : "down"} from ${k.previousTop10})` : ""}. ${k.improved.length} moved up and ${k.declined.length} moved down. The full report is attached.`
    : "The full report is attached.";
  const { html, text } = emailLayout({
    title: `SEO report for ${r.domain}`, intro, rows: reportHighlights(r),
    cta: { label: "Open the live numbers", url: `${APP_BASE_URL()}/seo/reports` },
    footer: `${brandName ? `Prepared by ${brandName}. ` : ""}You are receiving this because the owner of this report added your address. Positions are Google's organic results; visits are estimates.`,
    preheader: intro,
  });
  return { subject: `SEO report — ${r.domain}`, html, text };
}

/**
 * Email the report to each address once for this period. `period` is the
 * dedupe window ("send now" passes a fresh one). Returns how many went out;
 * an empty report (nothing saved for the site yet) is not sent.
 */
export async function sendSiteReport(userId: number, siteId: number, recipients: string[], period: string): Promise<{ sent: number; skipped: number; empty: boolean }> {
  const report = await buildSiteReport(userId, siteId);
  if (!report || reportIsEmpty(report)) return { sent: 0, skipped: recipients.length, empty: true };
  const { rows: [brand] } = await pool.query("SELECT name, logo FROM sitescan_branding WHERE user_id=$1", [userId]).catch(() => ({ rows: [] as any[] }));
  const pdf = await renderReportPdf(report, brand ?? null);
  const mail = reportEmail(report, brand?.name ?? null);
  let sent = 0, skipped = 0;
  for (const to of recipients) {
    try {
      const went = await sendTransactionalEmail(userId, "seo.report", `seo-report:${siteId}:${period}:${to}`, { to, ...mail, attachments: [{ filename: `seo-report-${report.domain}.pdf`, content: pdf, contentType: "application/pdf" }] });
      went ? sent++ : skipped++;
    } catch (e: any) { skipped++; console.error(`[seo] report for site ${siteId} to ${to.replace(/^(.).*@/, "$1***@")} failed: ${e?.message ?? e}`); }
  }
  return { sent, skipped, empty: false };
}

/** Scheduled reports that are due. The next date is claimed first, so a report goes out once even if a send is slow. */
export async function sendDueReports(): Promise<number> {
  const { rows: due } = await pool.query(
    `SELECT site_id, user_id, frequency, recipients FROM seo_report_schedules
      WHERE frequency <> 'off' AND next_send_at <= now() AND cardinality(recipients) > 0 ORDER BY next_send_at LIMIT 10`);
  let sent = 0;
  for (const s of due) {
    const { rowCount } = await pool.query("UPDATE seo_report_schedules SET next_send_at=$2, last_sent_at=now() WHERE site_id=$1 AND next_send_at <= now()", [s.site_id, nextSendAt(s.frequency)]);
    if (!rowCount) continue;
    try { sent += (await sendSiteReport(s.user_id, s.site_id, s.recipients, sendPeriod(s.frequency))).sent; }
    catch (e: any) { console.error(`[seo] scheduled report for site ${s.site_id} failed: ${e?.message ?? e}`); }
  }
  return sent;
}
