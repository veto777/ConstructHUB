/**
 * After a tower run: a bell notification for the platform admins, linking to
 * /admin/issues — but ONLY for issues with news (issues.ts issuesWithNews):
 * the first verdict on an issue, a verdict that changed, a fix that became
 * ready, or a failure that came back after it was marked fixed. A run that
 * re-inspected what the admins already know sends nothing at all (owner,
 * 2026-10-07: the bell repeated "Claude inspected 1 issue — no fix ready" run
 * after run). /admin/issues stays the full list.
 *
 * Internal only — no email since 2026-10-05 unless ISSUE_DESK_EMAIL=true (then
 * through the transactional outbox, deliverTransactionalEmail). Deduped per
 * run and admin, so a retried "run complete" call sends nothing twice.
 */
import type { OpsIssue } from "@shared/ops-issues";
import { ISSUE_STATUS_LABELS } from "@shared/ops-issues";
import { ADMIN_EMAILS, isPlatformAdminEmail } from "../admin";
import type { Queryable } from "./schema";
import { issuesWithNews, markAnnounced, reportedIssues } from "./issues";

export const DIGEST_EMAIL_KIND = "ops.issue_desk_digest";
export const DIGEST_BELL_KIND = "ops.issue_desk";

type Deliver = (userId: number, kind: string, dedupeKey: string, msg: { subject: string; html: string; text: string }) => Promise<string>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Claude inspected 3 issues — 1 fix ready" */
export function digestTitle(issues: Pick<OpsIssue, "status">[]): string {
  const fixes = issues.filter((i) => i.status === "fix_ready").length;
  return `Claude inspected ${plural(issues.length, "issue")} — ${fixes ? `${fixes} fix${fixes === 1 ? "" : "es"} ready` : "no fix ready"}`;
}

export function digestMessage(issues: OpsIssue[], baseUrl: string): { subject: string; html: string; text: string; body: string } {
  const title = digestTitle(issues);
  const link = `${baseUrl}/admin/issues`;
  const cameBack = (i: OpsIssue) => (i.history ?? []).some((h) => h.event === "reopened");
  const line = (i: OpsIssue) => `#${i.id} [${ISSUE_STATUS_LABELS[i.status]}] ${i.title}${i.branch ? ` (branch ${i.branch})` : ""}${cameBack(i) ? " — back after it was marked fixed" : ""}`;
  const summary = (i: OpsIssue) => (i.report ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const text = [
    title, "",
    ...issues.flatMap((i) => [line(i), summary(i) ? `  ${summary(i)}` : "", ""]),
    "Nothing was deployed or pushed. A fix waits on its branch for you to review.",
    `Review: ${link}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:600px">
<h2 style="font-size:18px;margin:0 0 12px">${esc(title)}</h2>
<ul style="padding-left:18px">${issues.map((i) => `<li style="margin-bottom:10px"><strong>${esc(line(i))}</strong>${summary(i) ? `<br><span style="color:#4b5563">${esc(summary(i))}</span>` : ""}</li>`).join("")}</ul>
<p style="color:#4b5563">Nothing was deployed or pushed. A fix waits on its branch for you to review.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#e0782f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the issue desk</a></p>
</div>`;
  const body = issues.slice(0, 5).map(line).join("\n") + (issues.length > 5 ? `\n…and ${issues.length - 5} more` : "");
  return { subject: `ConstructHUB: ${title}`, html, text, body };
}

/** The platform admins who have an account here (the dev account too, on a dev box with the bypass on). */
export async function platformAdminUsers(q: Queryable): Promise<{ id: number; email: string }[]> {
  const candidates = [...ADMIN_EMAILS, "dev@constructhub.local"].map((e) => e.toLowerCase());
  const { rows } = await q.query(`SELECT id, email FROM users WHERE lower(email) = ANY($1::text[]) ORDER BY id`, [candidates]);
  return rows.filter((r: any) => isPlatformAdminEmail(r.email)).map((r: any) => ({ id: Number(r.id), email: String(r.email) }));
}

export async function sendRunDigest(
  runId: string, issues: OpsIssue[],
  opts: { q: Queryable; deliver?: Deliver; baseUrl?: string },
): Promise<{ title: string | null; emailed: number; notified: number; admins: number }> {
  if (!issues.length) return { title: null, emailed: 0, notified: 0, admins: 0 };
  const { accountBaseUrl, deliverTransactionalEmail } = await import("../account/billing-emails");
  const deliver: Deliver = opts.deliver ?? deliverTransactionalEmail;
  const msg = digestMessage(issues, opts.baseUrl ?? accountBaseUrl());
  const title = digestTitle(issues);
  const admins = await platformAdminUsers(opts.q);
  const severity = issues.some((i) => i.status === "fix_ready") ? "warning" : "info";
  let emailed = 0;
  let notified = 0;
  for (const admin of admins) {
    const dedupe = `issue-desk:${runId}:${admin.id}`;
    try {
      // The bell once per run and admin: the email's dedupe key doubles as the bell's.
      const { rowCount } = await opts.q.query(
        `INSERT INTO user_notifications (user_id, kind, title, body, link, severity)
         SELECT $1, $2, $3, $4, '/admin/issues', $5
          WHERE NOT EXISTS (SELECT 1 FROM user_notifications WHERE user_id = $1 AND kind = $2 AND body LIKE $6)`,
        [admin.id, DIGEST_BELL_KIND, title, `${msg.body}\nRun ${runId}`, severity, `%Run ${runId}`]);
      if (rowCount) notified++;
    } catch (e) {
      console.warn(`[issues] digest bell for admin ${admin.id} failed: ${(e as Error)?.message ?? e}`);
    }
    // Internal only (owner, 2026-10-05: "stop emailing me with these frivulous issues! Make this internal only"):
    // the bell and /admin/issues carry the digest; no email unless ISSUE_DESK_EMAIL=true turns it back on.
    if (process.env.ISSUE_DESK_EMAIL === "true") {
      try {
        const sent = await deliver(admin.id, DIGEST_EMAIL_KIND, dedupe, { subject: msg.subject, html: msg.html, text: msg.text });
        if (sent === "sent" || sent === "queued") emailed++;
      } catch (e) {
        console.warn(`[issues] digest email for admin ${admin.id} failed: ${(e as Error)?.message ?? e}`);
      }
    }
  }
  return { title, emailed, notified, admins: admins.length };
}

/**
 * "Run complete" (POST /api/ops-internal/runs/:runId/complete): notify about
 * the issues of this run that have news, then remember what was told. Nothing
 * new → no notification (title null). The issues are marked as announced only
 * once a bell was written (or there is no admin to tell), so a failed write
 * can be retried by calling again.
 */
export async function completeRun(
  runId: string, ids: number[],
  opts: { q: Queryable; deliver?: Deliver; baseUrl?: string },
): Promise<{ reported: number; changed: number; title: string | null; emailed: number; notified: number; admins: number }> {
  const reported = await reportedIssues(ids, opts.q);
  const news = await issuesWithNews(ids, opts.q);
  const sent = await sendRunDigest(runId, news, opts);
  if (news.length && (sent.notified > 0 || sent.admins === 0)) await markAnnounced(news.map((i) => i.id), opts.q);
  return { reported: reported.length, changed: news.length, ...sent };
}
