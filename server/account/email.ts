/**
 * Transactional email for the account: invoices, receipts, purchases, sign-up
 * and API-key notices. Every send goes through sendTransactionalEmail, which
 *   - writes email_log first (dedupe_key UNIQUE), so a redelivered Stripe
 *     event or a double click never sends the same document twice;
 *   - sends through server/email.ts sendWithFallback (EMAIL_FORCE_SINK and
 *     the non-production sink apply: nothing leaves a dev box);
 *   - releases the dedupe row when the send fails, so a retry can deliver.
 *
 * emailLayout() is the one branded template: title, intro, label/value rows
 * (amount, invoice number, period…), a button and a footer, with a plain-text
 * twin. Everything passed in is escaped; callers hand over data, not HTML.
 */
import { pool } from "../db";
import { sendWithFallback } from "../email";

export type EmailAttachment = { filename: string; content: Buffer | string; contentType?: string };

export type TransactionalEmail = {
  subject: string;
  html: string;
  /** Plain-text twin; derived from the HTML when omitted. */
  text?: string;
  /** Defaults to the account's email address. */
  to?: string;
  attachments?: EmailAttachment[];
};

export const APP_BASE_URL = () => (process.env.APP_URL || "https://constructhub.us").replace(/\/+$/, "");

export const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** The plain-text twin of an HTML body: tags out, entities back, whitespace folded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type EmailLayoutInput = {
  title: string;
  /** One or two sentences under the title. */
  intro?: string;
  /** Label / value pairs rendered as a table (invoice number, amount, period…). */
  rows?: readonly (readonly [string, string | number | null | undefined])[];
  cta?: { label: string; url: string };
  /** Small print under the card (why you got this, where to manage it). */
  footer?: string;
  /** Hidden preview text some clients show next to the subject. */
  preheader?: string;
};

/** The branded ConstructHUB transactional layout, as HTML and plain text. */
export function emailLayout(input: EmailLayoutInput): { html: string; text: string } {
  const base = APP_BASE_URL();
  const rows = (input.rows ?? []).filter(([, v]) => v !== null && v !== undefined && String(v) !== "");
  const rowsHtml = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:20px 0;">${rows.map(([label, value]) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #f0f0f0;color:#666;font-size:13px;vertical-align:top;width:40%;">${escapeHtml(label)}</td>` +
        `<td style="padding:9px 0;border-bottom:1px solid #f0f0f0;color:#1a1a2e;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(value)}</td></tr>`).join("")}</table>`
    : "";
  const ctaHtml = input.cta
    ? `<div style="text-align:center;margin:28px 0 8px;"><a href="${escapeHtml(input.cta.url)}" style="background:linear-gradient(135deg,#F97316,#FB923C);color:#ffffff;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:15px;">${escapeHtml(input.cta.label)}</a></div>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f1ec;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>` : ""}
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#ffffff;border-radius:12px;">
  <div style="text-align:center;margin-bottom:24px;">
    <img src="${base}/chub-logo-square-text.png" alt="ConstructHUB" style="width:56px;height:56px;border-radius:12px;" />
    <div style="color:#F97316;font-size:22px;font-weight:800;margin-top:10px;">ConstructHUB</div>
    <div style="color:#888;font-size:12px;margin-top:2px;">Contractor Services Platform</div>
  </div>
  <h1 style="font-size:20px;color:#1a1a2e;margin:0 0 12px;">${escapeHtml(input.title)}</h1>
  ${input.intro ? `<p style="color:#444;line-height:1.6;margin:0 0 8px;">${escapeHtml(input.intro)}</p>` : ""}
  ${rowsHtml}
  ${ctaHtml}
  ${input.footer ? `<p style="color:#888;font-size:12px;line-height:1.6;margin:24px 0 0;">${escapeHtml(input.footer)}</p>` : ""}
  <p style="color:#bbb;font-size:11px;margin:20px 0 0;text-align:center;">Sent by ConstructHUB · <a href="${base}/settings?tab=billing" style="color:#aaa;">Billing &amp; invoices</a></p>
</div>
</body></html>`;
  const text = [
    input.title,
    input.intro ?? "",
    rows.map(([label, value]) => `${label}: ${value}`).join("\n"),
    input.cta ? `${input.cta.label}: ${input.cta.url}` : "",
    input.footer ?? "",
    `Sent by ConstructHUB — ${base}/settings?tab=billing`,
  ].filter(Boolean).join("\n\n");
  return { html, text };
}

/**
 * Send one transactional email to an account, once per dedupe key.
 * Returns false when that key was already sent (nothing is sent again); true
 * after a successful send. Throws when the account has no email address or
 * the send itself fails (the dedupe row is released first so a retry works).
 */
export async function sendTransactionalEmail(userId: number, kind: string, dedupeKey: string, email: TransactionalEmail): Promise<boolean> {
  if (!Number.isInteger(userId) || !kind || !dedupeKey) throw new Error("sendTransactionalEmail: userId, kind and dedupeKey are required");
  const { rows: [claim] } = await pool.query(
    "INSERT INTO email_log(user_id, kind, dedupe_key, sent_at) VALUES ($1, $2, $3, now()) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id",
    [userId, kind, dedupeKey]);
  if (!claim) return false;
  try {
    let to = email.to?.trim();
    if (!to) {
      const { rows: [u] } = await pool.query("SELECT email FROM users WHERE id=$1", [userId]);
      to = u?.email;
    }
    if (!to) throw new Error(`sendTransactionalEmail: account ${userId} has no email address`);
    await sendWithFallback({
      from: `"ConstructHUB" <${process.env.SMTP_EMAIL || "billing@constructhub.us"}>`,
      to,
      subject: email.subject,
      html: email.html,
      text: email.text ?? htmlToText(email.html),
      ...(email.attachments?.length ? { attachments: email.attachments } : {}),
    });
    return true;
  } catch (e) {
    await pool.query("DELETE FROM email_log WHERE id=$1", [claim.id]).catch(() => {});
    throw e;
  }
}

/** Has this dedupe key been sent? (For UIs that show "receipt emailed".) */
export async function emailWasSent(dedupeKey: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM email_log WHERE dedupe_key=$1", [dedupeKey]);
  return rows.length > 0;
}
