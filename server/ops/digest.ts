/**
 * After a tower run reported on any issue: a bell notification for the platform admins (internal only — no email
 * since 2026-10-05 unless ISSUE_DESK_EMAIL=true; it used to email them (server/admin.ts ADMIN_EMAILS) through the transactional outbox
 * (deliverTransactionalEmail — a send the provider refuses is retried by the
 * outbox drainer), plus a bell notification ("Claude inspected 3 issues — 1
 * fix ready") linking to /admin/issues. Deduped per run and admin, so a
 * retried "run complete" call sends nothing twice.
 */
import type { OpsIssue } from "@shared/ops-issues";
import { ISSUE_STATUS_LABELS } from "@shared/ops-issues";
import { ADMIN_EMAILS, isPlatformAdminEmail } from "../admin";
import type { Queryable } from "./schema";

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
  const line = (i: OpsIssue) => `#${i.id} [${ISSUE_STATUS_LABELS[i.status]}] ${i.title}${i.branch ? ` (branch ${i.branch})` : ""}`;
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

// ── A user's blocker report: the bell rings now, not at the next run ─────────

export const USER_REPORT_BELL_KIND = "ops.user_report";

/**
 * "I can't use the site" from /report-issue: one bell notification per report
 * and platform admin, at once (the run digest above only speaks after Claude
 * looked). Deduped on the report's number, so nothing — a retry, a later run —
 * rings twice for the same report. The body carries the scrubbed title only.
 * Never throws: the report is already stored when this runs.
 */
export async function notifyAdminsOfBlockerReport(issue: Pick<OpsIssue, "id" | "title">, q: Queryable): Promise<number> {
  let notified = 0;
  try {
    const marker = `Report #${issue.id}`;
    for (const admin of await platformAdminUsers(q)) {
      try {
        const { rowCount } = await q.query(
          `INSERT INTO user_notifications (user_id, kind, title, body, link, severity)
           SELECT $1, $2, $3, $4, '/admin/issues', 'warning'
            WHERE NOT EXISTS (SELECT 1 FROM user_notifications WHERE user_id = $1 AND kind = $2 AND body LIKE $5)`,
          [admin.id, USER_REPORT_BELL_KIND, "A user can’t use the site", `${issue.title}\n${marker}`, `%\n${marker}`]);
        if (rowCount) notified++;
      } catch (e) {
        console.warn(`[issues] blocker bell for admin ${admin.id} failed: ${(e as Error)?.message ?? e}`);
      }
    }
  } catch (e) {
    console.warn(`[issues] blocker bell failed: ${(e as Error)?.message ?? e}`);
  }
  return notified;
}
