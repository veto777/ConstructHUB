/**
 * Proposals (shared/proposals.ts) — HTTP surface.
 *
 *   admin (platform admins only — requirePlatformAdmin, second factor included where configured):
 *     GET    /api/admin/proposals?kind=template|offer         rows + summary
 *     GET    /api/admin/proposals/:id                         the editor's detail
 *     POST   /api/admin/proposals { kind, fromId?, name? }    new blank, or a copy (a template → an offer)
 *     POST   /api/admin/proposals/import { kind, fileName, dataBase64, recipient*? } → { jobId }   built from the
 *            admin's own PDF in the background (server/proposals/import.ts: sections, pickable packages, the
 *            PDF's terms + the standard agreement); GET /api/admin/proposals/import/:jobId → { status, proposalId?, error? }
 *     PUT    /api/admin/proposals/:id { name?, recipient*, content?, expiresAt? }   refused once signed
 *     POST   /api/admin/proposals/:id/file { name, dataBase64 }   attach / replace the PDF
 *     DELETE /api/admin/proposals/:id/file
 *     GET    /api/admin/proposals/:id/file                    the attached PDF
 *     GET    /api/admin/proposals/:id/signed.pdf              the signed copy
 *     POST   /api/admin/proposals/:id/send { to?, cc?, subject?, message? }   emails the link (offers)
 *     POST   /api/admin/proposals/:id/proof { subject?, message? }   the same email, to the admin only, "[PROOF] " subject,
 *            with a preview link (no view recorded, can't sign or pay) — like the CRM's "Send me a proof"
 *     POST   /api/admin/proposals/:id/status { status: void | archived | draft }
 *     POST   /api/admin/proposals/:id/invoice { amountCents?, message? }   emails an invoice for what's left today (or
 *            part of it) with the PDF and a pay link; GET /api/admin/proposals/:id/invoice.pdf[?amountCents=] previews it
 *     POST   /api/admin/proposals/:id/reminders { paused }   pauses / resumes the daily invoice (runProposalReminders)
 *
 *   recipient (the token in the emailed link is the key; no account):
 *     GET  /api/public/proposals/:token[?preview=1|<key>]   the page (an admin's preview, or a proof email's signed key,
 *          records no view)
 *     GET  /api/public/proposals/:token/document      the attached PDF, inline
 *     POST /api/public/proposals/:token/sign { itemIds, plan, name, title?, signatureDataUrl?, initials?, initialed[], consent }
 *     POST /api/public/proposals/:token/preview-sign   (preview links only) the same checks → the signed agreement PDF it
 *          would produce; nothing stored or sent
 *     POST /api/public/proposals/:token/decline { reason? }
 *     POST /api/public/proposals/:token/checkout { method: ach | card, amountCents? }   → Stripe Checkout url for one
 *          payment toward what's due today: any amount from MIN_PAYMENT_CENTS up to what's left (default: all of it)
 *     GET  /api/public/proposals/:token/signed.pdf
 *     GET  /api/public/proposals/:token/invoice.pdf   a statement of what's still due today (not a numbered invoice)
 *
 * Every total is recomputed here from the stored content (priceSelection); the browser only sends item ids.
 * Payment goes to the platform's own Stripe account: ACH (us_bank_account) with no fee, or card with the
 * proposal's card fee added as its own line. What's due today can be paid in parts (owner, 2026-10-25: cards
 * cap around $10k; the client sets each amount, never more than what's left), each on any card or bank account:
 * one proposal_payments row per Checkout (mode payment, saving the method to the proposal's Stripe customer).
 * Once it's all paid, auto-pay is a subscription schedule (autoPaySchedule: each monthly service for its own
 * term) starting a month later on the method of the last payment. The platform webhook (server/stripe.ts) hands
 * checkout events whose metadata.type is "proposal" to applyProposalCheckout below. A proposal whose checkout
 * predates parts (metadata.part unset: one subscription-mode session) still settles through the old path.
 */
import type { Express } from "express";
import type Stripe from "stripe";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";
import { pool } from "../db";
import { requirePlatformAdmin } from "../crm/admin";
import { isPlatformAdminEmail } from "../admin";
import { stripe, stripeConfigured } from "../billing/client";
import { getBaseUrl } from "../auth";
import { APP_BASE_URL } from "../account/email";
import { sendWithFallback } from "../email";
import { notifyUser } from "../account-events";
import { normalizePhone, sendSms } from "../crm/sms";
import {
  ESIGN_CONSENT, MAX_PDF_BYTES, MIN_PAYMENT_CENTS, PROPOSAL_KINDS, REMINDER_EVERY_HOURS, invoiceNumber, autoPayLines, autoPayMonths, autoPaySchedule, initialTargets, cardFeeCents, emptyContent, formatBps,
  addMonths, formatMoney, paymentBalance, priceSelection, proposalContentSchema, selectionProblems, type PaymentBalance, type ProposalContent, type ProposalDetail,
  type ProposalEvent, type ProposalPayment, type ProposalPaymentStatus, type ProposalRow, type ProposalStatus, type ProposalSummary, type ProposalTotals, type PublicProposal,
} from "@shared/proposals";
import { buildInvoicePdf, buildSignedProposalPdf } from "./pdf";
import { workerInterval } from "../workers";
import { ImportError, proposalFromPdf } from "./import";

type GetUser = (req: any, res: any) => any;

const LOCKED: readonly ProposalStatus[] = ["signed", "partial", "processing", "paid"];
/** Nothing more to pay today: settled, or the last of it is an ACH payment still clearing. */
const PAID_UP: readonly ProposalStatus[] = ["paid", "processing"];
const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const newToken = () => randomBytes(24).toString("base64url");
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
/** The proof email's preview link: a key only this server can make for this token (the CRM's preview grant). */
const PREVIEW_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
export const previewKey = (token: string) => createHmac("sha256", PREVIEW_SECRET).update(`proposal-preview:${token}`).digest("base64url").slice(0, 32);
const isPreviewKey = (token: string, key: unknown) => {
  if (typeof key !== "string" || key.length !== 32) return false;
  const a = Buffer.from(key), b = Buffer.from(previewKey(token));
  return a.length === b.length && timingSafeEqual(a, b);
};
const clientIp = (req: any): string | null => String(req.headers["cf-connecting-ip"] || req.ip || "").slice(0, 64) || null;

function parseContent(raw: unknown): ProposalContent {
  const r = proposalContentSchema.safeParse(raw ?? {});
  return r.success ? r.data : emptyContent();
}

function event(name: string, detail?: string): string {
  const e: ProposalEvent = { at: new Date().toISOString(), event: name, ...(detail ? { detail: detail.slice(0, 500) } : {}) };
  return JSON.stringify([e]);
}

async function addEvent(id: number, name: string, detail?: string) {
  await pool.query(`UPDATE proposals SET events = events || $2::jsonb WHERE id = $1`, [id, event(name, detail)]);
}

function toRow(r: any): ProposalRow {
  const content = parseContent(r.content);
  const totals = r.totals as ProposalTotals | null;
  return {
    id: Number(r.id), kind: r.kind, name: r.name, status: r.status,
    recipientName: r.recipient_name, recipientEmail: r.recipient_email, recipientCompany: r.recipient_company,
    recipientCc: String(r.recipient_cc || "").split(",").map((s) => s.trim()).filter(Boolean),
    isTest: r.is_test === true,
    viewCount: Number(r.view_count ?? 0), lastViewedAt: iso(r.last_viewed_at),
    title: content.title, templateId: r.template_id ? Number(r.template_id) : null, hasFile: r.file_id != null,
    contractTotalCents: totals?.contractTotalCents ?? null, dueTodayCents: totals?.dueTodayCents ?? null, paidCents: r.paid_cents ?? null,
    sentAt: iso(r.sent_at), viewedAt: iso(r.viewed_at), signedAt: iso(r.signed_at), paidAt: iso(r.paid_at),
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
}

const PAYMENTS_SQL = `(SELECT COALESCE(json_agg(pp ORDER BY pp.created_at), '[]'::json) FROM proposal_payments pp WHERE pp.proposal_id = p.id) AS payments_json`;

/** The row's payments (loadById/loadByToken), oldest first; abandoned checkouts left out. */
function toPayments(r: any): ProposalPayment[] {
  const list = Array.isArray(r.payments_json) ? r.payments_json : [];
  return list.filter((x: any) => x.status !== "expired" && x.status !== "open").map((x: any) => ({
    id: Number(x.id), method: x.method, amountCents: Number(x.amount_cents), feeCents: Number(x.fee_cents ?? 0), status: x.status as ProposalPaymentStatus,
    cardLast4: x.card_last4 ?? null, createdAt: iso(x.created_at)!, paidAt: iso(x.paid_at),
  }));
}
function balanceOf(r: any): PaymentBalance | null {
  const t = r.totals as ProposalTotals | null;
  return t ? paymentBalance(t.dueTodayCents, toPayments(r)) : null;
}

async function loadById(id: number) {
  const { rows } = await pool.query(
    `SELECT p.*, f.name AS file_name, f.bytes AS file_bytes, ${PAYMENTS_SQL} FROM proposals p LEFT JOIN proposal_files f ON f.id = p.file_id WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}
async function loadByToken(token: string) {
  if (!token || token.length > 64) return null;
  const { rows } = await pool.query(
    `SELECT p.*, f.name AS file_name, f.bytes AS file_bytes, ${PAYMENTS_SQL} FROM proposals p LEFT JOIN proposal_files f ON f.id = p.file_id WHERE p.public_token = $1 AND p.kind = 'offer'`, [token]);
  return rows[0] ?? null;
}

function toDetail(r: any): ProposalDetail {
  const sig = r.signature as any;
  return {
    ...toRow(r), publicToken: r.public_token, content: parseContent(r.content), expiresAt: iso(r.expires_at),
    file: r.file_id ? { name: r.file_name, bytes: Number(r.file_bytes) } : null,
    selection: r.selection ?? null, totals: r.totals ?? null,
    signature: sig ? { name: sig.name, title: sig.title ?? "", signedAt: sig.signedAt, ip: sig.ip ?? null } : null,
    countersignedAt: iso(r.countersigned_at),
    payment: { method: r.payment_method ?? null, cardFeeCents: r.card_fee_cents ?? 0, status: r.payment_status ?? null, subscriptionId: r.stripe_subscription_id ?? null, scheduleId: r.stripe_schedule_id ?? null },
    payments: toPayments(r), balance: balanceOf(r), autoPayStartsAt: iso(r.autopay_starts_at),
    invoices: { count: Number(r.invoice_count ?? 0), lastAt: iso(r.last_invoice_at), paused: r.reminders_paused === true },
    events: Array.isArray(r.events) ? r.events : [],
  };
}

/**
 * A text to the owner who made the offer (owner, 2026-10-24: "use the text alert too for me the owner"): opened, came
 * back, signed, paid. Their mobile on file — the account's, else their CRM membership's or CRM org's — over the
 * platform sender ("*": honours STOP, unmetered).
 */
async function textOwner(r: any, body: string): Promise<void> {
  if (!r.created_by) return;
  const { rows } = await pool.query(
    `SELECT phone AS p FROM users WHERE id = $1
     UNION ALL SELECT COALESCE(sms_consent_phone, phone) FROM crm_members WHERE user_id = $1 AND status = 'active'
     UNION ALL SELECT phone FROM crm_orgs WHERE owner_user_id = $1`, [r.created_by]).catch(() => ({ rows: [] as any[] }));
  const to = rows.map((x: any) => normalizePhone(x.p)).find(Boolean);
  if (!to) return;
  const res = await sendSms(to, `${r.is_test && !body.includes("[TEST]") ? "[TEST] " : ""}${body}`.slice(0, 480), undefined, "*").catch((e: any) => ({ ok: false, error: e?.message }));
  if (!res.ok) console.warn("[proposals] owner text not sent:", (res as any).error);
}

const VIEW_DEDUPE_MIN = 30;
const device = (ua: string) =>
  /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /macintosh/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : "a browser";

/**
 * The client opened the link — tracked like CRM estimates (server/crm/portal.ts): only once it has been sent (so the
 * admin's own clicks before sending don't count), one counted open per IP per 30 minutes, the creator told at once on
 * the first open (bell + email) and once a day when the client comes back ("a good time to call").
 * After signing, opens still count while something is due today — the invoice and reminder links land here (owner,
 * 2026-10-27: text me when the invoice is opened, like the bids).
 */
async function trackOpen(r: any, req: any): Promise<any> {
  const dueCents = r.signed_at ? balanceOf(r)?.remainingCents ?? 0 : 0;
  if (!r.sent_at || (r.signed_at && dueCents <= 0) || ["void", "declined", "archived"].includes(r.status)) return r;
  const ip = clientIp(req);
  const ua = String(req.headers["user-agent"] || "");
  const first = !r.viewed_at;
  const recent = !first && ip && r.last_view_ip === ip && r.last_viewed_at && Date.now() - new Date(r.last_viewed_at).getTime() < VIEW_DEDUPE_MIN * 60_000;
  const counted = first || !recent;
  const newPlace = !first && ip && r.first_view_ip && ip !== r.first_view_ip;
  const detail = `${device(ua)}${ip ? ` · ${ip}` : ""}${newPlace ? " · a different network than the first open (possibly forwarded)" : ""}`;
  const { rows } = await pool.query(
    `UPDATE proposals SET viewed_at = COALESCE(viewed_at, now()), last_viewed_at = now(), last_view_ip = $2,
       first_view_ip = COALESCE(first_view_ip, $2), view_count = view_count + $3,
       status = CASE WHEN status IN ('draft', 'sent') THEN 'viewed' ELSE status END,
       events = CASE WHEN $3 = 1 THEN events || $4::jsonb ELSE events END
     WHERE id = $1 RETURNING *`,
    [r.id, ip, counted ? 1 : 0, event(first ? "opened" : "opened_again", detail)]);
  const u = rows[0] ?? r;
  if (!counted || !r.created_by) return u;
  const who = `${r.is_test ? "[TEST] " : ""}${r.recipient_name || r.recipient_email || "Your client"}`;
  const title = parseContent(r.content).title || r.name;
  const link = `/admin/proposals/${r.id}`;
  const adminLink = `${process.env.APP_URL || "https://constructhub.us"}${link}`;
  if (first) {
    void textOwner(r, `👀 ${who} just opened your proposal "${title}" on ${device(ua)}. ${adminLink}`);
    notifyUser(Number(r.created_by), "proposal.opened", {
      title: `${who} opened your proposal`, body: `${title}
Opened just now on ${device(ua)}.`, link, actionUrl: link, actionLabel: "Open the proposal",
    }).catch((e: any) => console.error("[proposals] open alert failed:", e?.message));
  } else {
    // The once-a-day "they came back" alert: claimed in the database so two opens at once send one.
    const claim = await pool.query(`UPDATE proposals SET reopen_alerted_on = CURRENT_DATE WHERE id = $1 AND reopen_alerted_on IS DISTINCT FROM CURRENT_DATE RETURNING id`, [r.id]);
    if (claim.rowCount && r.signed_at) {
      const due = formatMoney(dueCents, { cents: true });
      void textOwner(r, `💳 ${who} opened the payment page for "${title}" on ${device(ua)} — ${due} still due today. Good time to call. ${adminLink}`);
      notifyUser(Number(r.created_by), "proposal.reopened", {
        title: `${who} opened the payment page`,
        body: `${title}
${due} still due today. Opened just now on ${device(ua)}. A good time to call.`,
        link, actionUrl: link, actionLabel: "Open the proposal",
      }).catch((e: any) => console.error("[proposals] payment-page alert failed:", e?.message));
    } else if (claim.rowCount) {
      void textOwner(r, `🔁 ${who} came back to "${title}" (opened ${u.view_count}×)${newPlace ? " from a different network — possibly forwarded" : ""}. Good time to call. ${adminLink}`);
      notifyUser(Number(r.created_by), "proposal.reopened", {
        title: `${who} came back to your proposal`,
        body: `${title}
Opened ${u.view_count} times so far, just now on ${device(ua)}${newPlace ? " from a different network than the first time (possibly forwarded)" : ""}. A good time to call.`,
        link, actionUrl: link, actionLabel: "Open the proposal",
      }).catch((e: any) => console.error("[proposals] reopen alert failed:", e?.message));
    }
  }
  return u;
}

const isExpired = (r: any) => !!r.expires_at && new Date(r.expires_at).getTime() < Date.now();

function signedPdfInput(r: any) {
  const content = parseContent(r.content);
  return {
    id: Number(r.id), content, recipientName: r.recipient_name, recipientEmail: r.recipient_email,
    recipientCompany: r.recipient_company, totals: r.totals as ProposalTotals, signature: r.signature,
    countersign: content.countersign.name.trim()
      ? { name: content.countersign.name.trim(), title: content.countersign.title.trim(), at: iso(r.countersigned_at) ?? r.signature?.signedAt ?? new Date().toISOString() }
      : null,
    test: r.is_test === true,
    payment: { method: r.payment_method ?? null, status: r.payment_status ?? null, paidAt: iso(r.paid_at) },
  };
}

/** The admin's name for the company signature: their display name, else their email's name part. */
function adminName(admin: any): string {
  const d = String(admin?.displayName || "").trim();
  if (d) return d.slice(0, 120);
  const local = String(admin?.email || "").split("@")[0].replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
  return local.replace(/\b\w/g, (ch) => ch.toUpperCase()).slice(0, 120);
}

/** Who hears about a signature or a payment: the admin who made the offer and the brand's contact address. */
async function adminRecipients(r: any): Promise<string[]> {
  const out = new Set<string>();
  if (r.created_by) {
    const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [r.created_by]);
    if (rows[0]?.email) out.add(String(rows[0].email).toLowerCase());
  }
  const c = parseContent(r.content).brand.contactEmail.trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) out.add(c);
  if (!out.size) out.add("support@constructhub.us");
  return [...out];
}

function emailShell(content: ProposalContent, inner: string): string {
  const b = content.brand;
  const contact = [b.contactName, b.contactEmail, b.phone, b.website].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="height:6px;background:${b.accent}"></td></tr>
<tr><td style="padding:28px 32px 8px">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.name)}" style="max-height:56px;max-width:220px">` : `<div style="font-weight:700;font-size:16px;letter-spacing:.04em">${esc(b.name.toUpperCase())}</div>`}</td></tr>
<tr><td style="padding:8px 32px 28px;font-size:15px;line-height:1.6">${inner}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">${contact}</td></tr>
</table></td></tr></table></body></html>`;
}
const button = (href: string, label: string, accent: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:8px">${esc(label)}</a></p>`;
const fromFor = (content: ProposalContent) => `"${content.brand.name.replace(/["<>]/g, "")}" <support@constructhub.us>`;
const paragraphs = (s: string) => s.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");

/** The client's "Review & sign" email — one builder for the real send and the proof, so the proof can't drift. */
function offerEmail(r: any, content: ProposalContent, link: string, message?: string) {
  const note = message?.trim() || content.intro.trim();
  return {
    html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p>${note ? paragraphs(note) : ""}
      <p>Your proposal <b>${esc(content.title || r.name)}</b> is ready. Open it to review the details, choose the services you want, sign and pay securely online.</p>
      ${button(link, "Review & sign", content.brand.accent)}
      <p style="font-size:13px;color:#6b7280">Bank transfer (ACH) has no fee.${content.payment.cardEnabled && content.payment.cardFeeBps ? ` Card payments add a ${formatBps(content.payment.cardFeeBps)} processing fee.` : ""}</p>`),
    text: `${note ? `${note}\n\n` : ""}Review and sign your proposal: ${link}`,
  };
}

async function notifySigned(r: any, base: string) {
  const content = parseContent(r.content);
  const t = r.totals as ProposalTotals;
  let pdf: Buffer | null = null;
  try { pdf = await buildSignedProposalPdf(signedPdfInput(r)); } catch (e) { console.error("[proposals] signed PDF failed:", (e as Error)?.message); }
  const attachments = pdf ? [{ filename: `${(content.title || "Proposal").replace(/[^\w\- ]+/g, "").slice(0, 60) || "Proposal"} - signed.pdf`, content: pdf, contentType: "application/pdf" }] : [];
  const link = `${base}/proposal/${r.public_token}`;
  const summary = `<ul style="padding-left:18px">${t.lines.map((l) => `<li>${esc(l.name)} — ${l.billing === "monthly" ? `${formatMoney(l.priceCents)}/mo` : formatMoney(l.priceCents)}</li>`).join("")}</ul>`;
  if (r.recipient_email) {
    await sendWithFallback({
      from: fromFor(content), to: r.recipient_email, cc: r.recipient_cc || undefined, replyTo: content.brand.contactEmail || undefined,
      subject: `${r.is_test ? "[TEST] " : ""}Signed: ${content.title || "your proposal"}`,
      html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p><p>Thank you — your signed copy of <b>${esc(content.title || "the proposal")}</b> is attached.</p>${summary}
        <p>Due today: <b>${formatMoney(t.dueTodayCents, { cents: true })}</b> by bank transfer (ACH) — in one payment or several, on any card or bank account.${autoPayText(content, t)}</p>
        ${r.payment_status === "paid" || r.payment_status === "processing" ? "" : button(link, "Complete payment", content.brand.accent)}`),
      text: `Your signed copy of ${content.title} is attached. ${link}`,
      attachments,
    }).catch((e: any) => console.error("[proposals] signed email to recipient failed:", e?.message));
  }
  void textOwner(r, `✅ ${r.recipient_name || r.recipient_email || "Your client"} signed "${content.title || r.name}" — ${formatMoney(t.contractTotalCents)} contract, ${formatMoney(t.dueTodayCents)} due today. ${base}/admin/proposals/${r.id}`);
  const admins = await adminRecipients(r);
  await sendWithFallback({
    from: fromFor(content), to: admins.join(", "),
    subject: `${r.is_test ? "[TEST] " : ""}Proposal signed — ${r.recipient_name || r.recipient_email || `#${r.id}`} (${formatMoney(t.contractTotalCents)})`,
    html: emailShell(content, `<p><b>${esc(r.recipient_name || "The recipient")}</b>${r.recipient_company ? ` (${esc(r.recipient_company)})` : ""} signed <b>${esc(content.title || r.name)}</b>.</p>${summary}
      <p>Contract total ${formatMoney(t.contractTotalCents, { cents: true })} · due today ${formatMoney(t.dueTodayCents, { cents: true })}.${autoPayText(content, t)}</p>
      ${button(`${base}/admin/proposals/${r.id}`, "Open in ConstructHUB", content.brand.accent)}`),
    text: `${r.recipient_name || "The recipient"} signed ${content.title}.`,
    attachments,
  }).catch((e: any) => console.error("[proposals] signed email to admins failed:", e?.message));
}

/** " Then auto-pay: Months 2–6: $2,500.00/mo; …" (bank prices), or "" when nothing recurs. */
function autoPayText(content: ProposalContent, t: ProposalTotals): string {
  const lines = autoPayLines(autoPaySchedule(content, t));
  return lines.length ? ` Then auto-pay — ${lines.join("; ")}.` : "";
}

/** One payment toward what's due today: the owner's text, the admins' email, and (settled) the client's receipt with what's left. */
async function notifyPayment(r: any, part: any, state: "paid" | "processing" | "failed", bal: PaymentBalance) {
  const content = parseContent(r.content);
  const admins = await adminRecipients(r);
  const charged = formatMoney(Number(part.amount_cents) + Number(part.fee_cents ?? 0), { cents: true });
  const how = part.method === "card" ? `card${part.card_last4 ? ` ending ${part.card_last4}` : ""}${Number(part.fee_cents) ? ` (incl. ${formatMoney(Number(part.fee_cents), { cents: true })} card fee)` : ""}`
    : `bank transfer (ACH)${part.card_last4 ? ` ending ${part.card_last4}` : ""}`;
  const left = bal.remainingCents > 0 ? `${formatMoney(bal.remainingCents, { cents: true })} still due today` : bal.pendingCents > 0 ? "nothing left to pay (ACH clearing)" : "paid in full for today";
  const who = r.recipient_name || r.recipient_email || `proposal #${r.id}`;
  const label = state === "paid" ? `Payment received — ${charged}` : state === "processing" ? `ACH payment started — ${charged} (clearing)` : `Payment failed — ${charged}`;
  void textOwner(r, `${state === "paid" ? "💰" : state === "processing" ? "🏦" : "⚠️"} ${label} by ${how}: ${who}. ${left[0].toUpperCase()}${left.slice(1)}.`);
  await sendWithFallback({
    from: fromFor(content), to: admins.join(", "),
    subject: `${label}: ${who}`,
    html: emailShell(content, `<p>${esc(label)} for <b>${esc(content.title || r.name)}</b> from ${esc(r.recipient_name || r.recipient_email || "the recipient")}, by ${esc(how)}.</p>
      <p>Paid so far ${formatMoney(bal.paidCents, { cents: true })}${bal.pendingCents ? ` + ${formatMoney(bal.pendingCents, { cents: true })} clearing` : ""} of ${formatMoney(bal.dueTodayCents, { cents: true })} due today — ${esc(left)}.</p>`),
    text: `${label} — ${content.title}. ${left}.`,
  }).catch((e: any) => console.error("[proposals] payment email failed:", e?.message));
  if (state === "paid" && r.recipient_email) {
    const link = `${APP_BASE_URL()}/proposal/${r.public_token}`;
    await sendWithFallback({
      from: fromFor(content), to: r.recipient_email, cc: r.recipient_cc || undefined, replyTo: content.brand.contactEmail || undefined,
      subject: `Payment received — ${content.title || "thank you"}`,
      html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p><p>We received your payment of <b>${charged}</b> by ${esc(how)}.</p>
        ${bal.remainingCents > 0
          ? `<p>Paid so far: ${formatMoney(bal.paidCents + bal.pendingCents, { cents: true })} of ${formatMoney(bal.dueTodayCents, { cents: true })}. Still due: <b>${formatMoney(bal.remainingCents, { cents: true })}</b>. Please pay the rest as soon as possible — in one or more payments, on any card or bank account.</p>${button(`${link}#pay`, "Pay the rest", content.brand.accent)}`
          : `<p>That completes what was due today. We'll be in touch to schedule kickoff.</p>`}`),
      text: `We received your payment of ${charged}. ${bal.remainingCents > 0 ? `Still due: ${formatMoney(bal.remainingCents, { cents: true })} — ${link}` : "That completes what was due today."}`,
    }).catch((e: any) => console.error("[proposals] receipt email failed:", e?.message));
  }
}

async function notifyPaid(r: any, state: "paid" | "processing" | "failed") {
  const content = parseContent(r.content);
  const admins = await adminRecipients(r);
  const amount = formatMoney(r.paid_cents ?? 0, { cents: true });
  const label = state === "paid" ? `Payment received — ${amount}` : state === "processing" ? `ACH payment started — ${amount} (clearing)` : "Payment failed";
  void textOwner(r, `${state === "paid" ? "💰" : state === "processing" ? "🏦" : "⚠️"} ${label}: ${r.recipient_name || r.recipient_email || `proposal #${r.id}`}.`);
  await sendWithFallback({
    from: fromFor(content), to: admins.join(", "),
    subject: `${label}: ${r.recipient_name || r.recipient_email || `proposal #${r.id}`}`,
    html: emailShell(content, `<p>${esc(label)} for <b>${esc(content.title || r.name)}</b> from ${esc(r.recipient_name || r.recipient_email || "the recipient")}.</p>
      <p>Method: ${r.payment_method === "card" ? `card (incl. ${formatMoney(r.card_fee_cents ?? 0, { cents: true })} card fee)` : "bank transfer (ACH)"}.</p>`),
    text: `${label} — ${content.title}`,
  }).catch((e: any) => console.error("[proposals] payment email failed:", e?.message));
  if (state === "paid" && r.recipient_email) {
    await sendWithFallback({
      from: fromFor(content), to: r.recipient_email, cc: r.recipient_cc || undefined, replyTo: content.brand.contactEmail || undefined,
      subject: `Payment received — ${content.title || "thank you"}`,
      html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p><p>We received your payment of <b>${amount}</b>. We'll be in touch to schedule kickoff.</p>`),
      text: `We received your payment of ${amount}.`,
    }).catch((e: any) => console.error("[proposals] receipt email failed:", e?.message));
  }
}

/** The pay page an invoice links to: the amount filled in when it asks for less than what's left. */
function payLink(r: any, amountCents: number, bal: PaymentBalance): string {
  return `${APP_BASE_URL()}/proposal/${r.public_token}${amountCents < bal.remainingCents ? `?amount=${amountCents}` : ""}#pay`;
}

function invoicePdf(r: any, number: string, amountCents: number, bal: PaymentBalance, statement = false): Promise<Buffer> {
  return buildInvoicePdf({
    id: Number(r.id), number, statement, issuedAt: new Date(), content: parseContent(r.content),
    recipientName: r.recipient_name, recipientEmail: r.recipient_email, recipientCompany: r.recipient_company,
    totals: r.totals as ProposalTotals, payments: toPayments(r), balance: bal, amountDueCents: amountCents,
    payUrl: payLink(r, amountCents, bal), test: r.is_test === true,
  });
}

/**
 * Emails an invoice for what's still due today (or part of it): the PDF attached, the balance, and a pay link
 * (owner, 2026-10-25: "they will get emails that the deposit amount is still not paid and needs to be paid asap").
 * `number` is the invoice's sequence on this proposal, already counted by the caller. Throws when the send fails.
 */
async function sendInvoice(r: any, opts: { number: number; amountCents: number; reminder: boolean; message?: string }): Promise<void> {
  const content = parseContent(r.content);
  const bal = balanceOf(r)!;
  const no = invoiceNumber(Number(r.id), opts.number);
  const amount = formatMoney(opts.amountCents, { cents: true });
  const title = content.title || r.name;
  const link = payLink(r, opts.amountCents, bal);
  const paid = bal.paidCents + bal.pendingCents;
  const pdf = await invoicePdf(r, no, opts.amountCents, bal);
  const lead = opts.reminder
    ? `<p>This is a reminder that the payment due at signing for <b>${esc(title)}</b> is not fully paid. <b>${amount} is still due</b> and needs to be paid as soon as possible.</p>`
    : `<p>Here is invoice <b>${esc(no)}</b> for <b>${esc(title)}</b>. Amount due: <b>${amount}</b>. Please pay as soon as possible.</p>`;
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 4px">
      <tr><td style="padding:6px 0;color:#6b7280">Due at signing</td><td align="right">${formatMoney(bal.dueTodayCents, { cents: true })}</td></tr>
      ${paid > 0 ? `<tr><td style="padding:6px 0;color:#6b7280">Paid so far</td><td align="right">−${formatMoney(paid, { cents: true })}</td></tr>` : ""}
      <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;font-weight:700">Still due</td><td align="right" style="border-top:1px solid #e5e7eb;font-weight:700">${formatMoney(bal.remainingCents, { cents: true })}</td></tr>
    </table>`;
  const fee = content.payment.cardEnabled && content.payment.cardFeeBps ? ` Card payments add a ${formatBps(content.payment.cardFeeBps)} processing fee.` : "";
  await sendWithFallback({
    from: fromFor(content), to: r.recipient_email, cc: r.recipient_cc || undefined, replyTo: content.brand.contactEmail || undefined,
    subject: `${r.is_test ? "[TEST] " : ""}${opts.reminder ? `Payment reminder: ${amount} still due` : `Invoice ${no}: ${amount} due`} — ${title}`,
    html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p>${opts.message?.trim() ? paragraphs(opts.message) : ""}${lead}${table}
      ${button(link, `Pay ${amount} now`, content.brand.accent)}
      <p style="font-size:13px;color:#6b7280">You can pay in one or more payments, on any card or bank account. Bank transfer (ACH) has no fee.${fee} Invoice ${esc(no)} is attached.</p>`),
    text: `${opts.reminder ? `Reminder: ${amount} is still due` : `Invoice ${no}: ${amount} due`} for ${title}. Please pay as soon as possible: ${link}`,
    attachments: [{ filename: `Invoice ${no}.pdf`, content: pdf, contentType: "application/pdf" }],
  }, false, { failover: "definite" }); // numbered: never sent twice by the backup account
}

/** A send that certainly failed gives its number and slot back (so the next tick retries); an ambiguous one keeps them. */
async function releaseInvoiceClaim(id: number, n: number, prevAt: Date | string | null) {
  await pool.query(`UPDATE proposals SET invoice_count = invoice_count - 1, last_invoice_at = $3 WHERE id = $1 AND invoice_count = $2`, [id, n, prevAt ?? null]);
}

/** Pacific business hours (the brands are run from WA): automatic invoices only go out 9:00–17:59. */
function pacificBusinessHours(now: Date): boolean {
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(now));
  return h >= 9 && h < 18;
}

/**
 * The daily invoice: a client who has paid part of what's due today and not the rest gets an invoice for the rest
 * every REMINDER_EVERY_HOURS — the first a day after their last payment (the receipt already said what's left) —
 * until it's paid, the proposal is voided, or the admin pauses it. Never for test copies. The claim
 * (last_invoice_at) is taken in one UPDATE, so two server processes never send the same one.
 */
export async function runProposalReminders(now = new Date()): Promise<number> {
  if (!pacificBusinessHours(now)) return 0;
  const { rows } = await pool.query(
    `SELECT p.id FROM proposals p
      WHERE p.kind = 'offer' AND NOT p.is_test AND NOT p.reminders_paused AND p.signed_at IS NOT NULL
        AND p.status IN ('partial', 'payment_failed') AND COALESCE(p.recipient_email, '') <> ''
        AND (p.last_invoice_at IS NULL OR p.last_invoice_at < $1::timestamptz - make_interval(hours => $2))
        AND EXISTS (SELECT 1 FROM proposal_payments pp WHERE pp.proposal_id = p.id AND pp.status IN ('paid', 'processing'))
        AND NOT EXISTS (SELECT 1 FROM proposal_payments pp WHERE pp.proposal_id = p.id AND (
              (pp.status IN ('paid', 'processing') AND COALESCE(pp.paid_at, pp.created_at) > $1::timestamptz - make_interval(hours => $2))
              OR (pp.status = 'open' AND pp.created_at > $1::timestamptz - interval '1 hour')))
      ORDER BY p.id LIMIT 20`, [now.toISOString(), REMINDER_EVERY_HOURS]);
  let sent = 0;
  for (const { id } of rows) {
    try {
      let r = await loadById(Number(id));
      if (!r) continue;
      r = await refreshFromStripe(r); // a payment the webhook hasn't delivered yet still counts
      const bal = balanceOf(r);
      if (!bal || bal.remainingCents <= 0 || bal.paidCents + bal.pendingCents <= 0 || !["partial", "payment_failed"].includes(r.status)) continue;
      const claim = await pool.query(
        `UPDATE proposals SET last_invoice_at = $2, invoice_count = invoice_count + 1 WHERE id = $1
           AND (last_invoice_at IS NULL OR last_invoice_at < $2::timestamptz - make_interval(hours => $3)) AND NOT reminders_paused RETURNING invoice_count`,
        [r.id, now.toISOString(), REMINDER_EVERY_HOURS]);
      if (!claim.rows[0]) continue;
      const n = Number(claim.rows[0].invoice_count);
      try {
        await sendInvoice(r, { number: n, amountCents: bal.remainingCents, reminder: true });
        await addEvent(Number(r.id), "reminder_sent", `${invoiceNumber(Number(r.id), n)} · ${formatMoney(bal.remainingCents, { cents: true })} still due · ${r.recipient_email}`);
        sent++;
      } catch (e: any) {
        console.error(`[proposals] reminder for #${r.id} failed:`, e?.message || e);
        if (!e?.ambiguous) await releaseInvoiceClaim(Number(r.id), n, r.last_invoice_at);
        await addEvent(Number(r.id), "invoice_failed", `${e?.ambiguous ? "may have been delivered — not retried" : "will retry"} · ${String(e?.message || e).slice(0, 160)}`);
      }
    } catch (e: any) { console.error(`[proposals] reminder check for #${id} failed:`, e?.message || e); }
  }
  return sent;
}

let remindersStarted = false;
/** Once per process: every 15 minutes, so a due invoice goes out within a quarter hour of 9:00 Pacific. */
export function startProposalReminders(): void {
  if (remindersStarted || process.env.NODE_ENV === "test" || process.env.VITEST) return;
  remindersStarted = true;
  workerInterval("Proposal payment reminders", () => runProposalReminders(), 15 * 60_000, { firstAfterMs: 2 * 60_000 });
}

/** checkout.session.* for a proposal (server/stripe.ts): paid → paid; completed but unpaid (ACH) → processing; failed → payment_failed. */
export async function applyProposalCheckout(session: Stripe.Checkout.Session, eventType: string): Promise<void> {
  if (session.metadata?.part === "1") return applyPaymentCheckout(session, eventType);
  const id = Number(session.metadata?.proposalId || 0);
  if (!id) return;
  const r = await loadById(id);
  if (!r) return;
  let state: "paid" | "processing" | "failed" | null = null;
  if (eventType === "checkout.session.async_payment_failed") state = "failed";
  else if (session.payment_status === "paid" || eventType === "checkout.session.async_payment_succeeded") state = "paid";
  else if (session.status === "complete") state = "processing";
  if (!state) return;
  const status: ProposalStatus = state === "paid" ? "paid" : state === "processing" ? "processing" : "payment_failed";
  if (r.status === status || (r.status === "paid" && state !== "failed")) return;
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  const custId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const { rows } = await pool.query(
    `UPDATE proposals SET status = $2, payment_status = $3, paid_cents = $4, stripe_session_id = $5,
       stripe_subscription_id = COALESCE($6, stripe_subscription_id), stripe_customer_id = COALESCE($7, stripe_customer_id),
       payment_method = COALESCE($8, payment_method), card_fee_cents = $9,
       paid_at = CASE WHEN $3 = 'paid' THEN now() ELSE paid_at END, updated_at = now(),
       events = events || $10::jsonb
     WHERE id = $1 RETURNING *`,
    [id, status, state === "failed" ? "failed" : state, session.amount_total ?? null, session.id, subId, custId,
      session.metadata?.method ?? null, Number(session.metadata?.cardFeeCents || 0),
      event(state === "paid" ? "paid" : state === "processing" ? "ach_started" : "payment_failed", session.amount_total != null ? formatMoney(session.amount_total, { cents: true }) : undefined)]);
  const updated = rows[0];
  // A fixed term: the subscription ends by itself after the agreed number of months (never before the package term).
  const months = r.totals ? autoPayMonths(parseContent(r.content), r.totals as ProposalTotals) : null;
  if (subId && months && state !== "failed" && stripeConfigured()) {
    const cancelAt = new Date();
    cancelAt.setMonth(cancelAt.getMonth() + months);
    await stripe.subscriptions.update(subId, { cancel_at: Math.floor(cancelAt.getTime() / 1000) })
      .catch((e: any) => console.error(`[proposals] could not set the end date on ${subId}:`, e?.message));
  }
  if (updated) await notifyPaid(updated, state);
}

/** Where a part may come from on the way to each state: a replayed or out-of-order event changes nothing. */
const PART_FROM: Record<"paid" | "processing" | "failed" | "expired", ProposalPaymentStatus[]> = {
  paid: ["open", "processing", "expired"], processing: ["open", "expired"], failed: ["open", "processing"], expired: ["open"],
};

/** checkout.session.* for one payment toward what's due today (metadata.part = "1"), then the proposal's totals. */
async function applyPaymentCheckout(session: Stripe.Checkout.Session, eventType: string): Promise<void> {
  let state: "paid" | "processing" | "failed" | "expired" | null = null;
  if (eventType === "checkout.session.expired") state = "expired";
  else if (eventType === "checkout.session.async_payment_failed") state = "failed";
  else if (session.payment_status === "paid" || eventType === "checkout.session.async_payment_succeeded") state = "paid";
  else if (session.status === "complete") state = "processing";
  if (!state) return;
  let pmId: string | null = null, last4: string | null = null;
  const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (piId && state !== "expired" && stripeConfigured()) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["payment_method"] });
      const pm = pi.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;
      pmId = pm?.id ?? (typeof pi.payment_method === "string" ? pi.payment_method : null);
      last4 = pm?.card?.last4 ?? pm?.us_bank_account?.last4 ?? null;
    } catch (e: any) { console.warn("[proposals] payment intent lookup failed:", e?.message); }
  }
  const { rows: parts } = await pool.query(
    `UPDATE proposal_payments SET status = $2, payment_intent_id = COALESCE($4, payment_intent_id), payment_method_id = COALESCE($5, payment_method_id),
       card_last4 = COALESCE($6, card_last4), paid_at = CASE WHEN $2 = 'paid' THEN now() ELSE paid_at END
     WHERE stripe_session_id = $1 AND status = ANY($3) RETURNING *`,
    [session.id, state, PART_FROM[state], piId, pmId, last4]);
  const part = parts[0];
  if (!part || state === "expired") return;
  const r = await loadById(Number(part.proposal_id));
  if (!r?.totals) return;
  const bal = balanceOf(r)!;
  const all = Array.isArray(r.payments_json) ? r.payments_json : [];
  const settled = all.filter((x: any) => x.status === "paid");
  const paidCharged = settled.reduce((s: number, x: any) => s + Number(x.amount_cents) + Number(x.fee_cents ?? 0), 0);
  const feesPaid = settled.reduce((s: number, x: any) => s + Number(x.fee_cents ?? 0), 0);
  const next: ProposalStatus = bal.remainingCents > 0
    ? (bal.paidCents + bal.pendingCents > 0 ? "partial" : "payment_failed")
    : bal.pendingCents > 0 ? "processing" : "paid";
  const custId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const charged = formatMoney(Number(part.amount_cents) + Number(part.fee_cents ?? 0), { cents: true });
  const { rows } = await pool.query(
    `UPDATE proposals SET status = $2, payment_status = $2, paid_cents = $3, card_fee_cents = $4, payment_method = $5,
       stripe_customer_id = COALESCE($6, stripe_customer_id), paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
       updated_at = now(), events = events || $7::jsonb
     WHERE id = $1 RETURNING *`,
    [r.id, next, paidCharged, feesPaid, part.method, custId,
      event(state === "paid" ? "payment_received" : state === "processing" ? "ach_started" : "payment_failed",
        `${charged} by ${part.method === "card" ? "card" : "ACH"}${last4 ? ` ••${last4}` : ""} · ${formatMoney(bal.remainingCents, { cents: true })} left`)]);
  const updated = rows[0];
  if (!updated) return;
  // Checkouts are made one at a time (see the route), so this needs two payments settling against one balance —
  // say so loudly rather than quietly; a refund is the owner's call.
  const over = bal.paidCents + bal.pendingCents - bal.dueTodayCents;
  if (over > 0) {
    await addEvent(Number(r.id), "overpaid", `${formatMoney(over, { cents: true })} more than was due today — refund it in Stripe`);
    void textOwner(updated, `⚠️ ${r.recipient_name || `Proposal #${r.id}`} paid ${formatMoney(over, { cents: true })} more than was due today. Refund the extra in Stripe.`);
  }
  if (next === "paid" && r.status !== "paid") await startAutoPay(updated, part).catch((e: any) => console.error(`[proposals] auto-pay for #${updated.id} failed:`, e?.message));
  await notifyPayment(updated, part, state, bal);
}

/**
 * Once what's due today is paid: auto-pay as a Stripe subscription schedule, first charge a month later, on the
 * method of the payment that finished it. Each phase is autoPaySchedule's (a service only for its own term); an
 * open-ended last phase is released into a plain subscription that bills until cancelled.
 */
async function startAutoPay(r: any, part: any): Promise<void> {
  if (r.stripe_schedule_id || r.stripe_subscription_id || !stripeConfigured()) return;
  const content = parseContent(r.content);
  const phases = autoPaySchedule(content, r.totals as ProposalTotals);
  if (!phases.length) return;
  // Claimed first: two payments settling at once must never make two schedules (two monthly charges).
  const claim = await pool.query(`UPDATE proposals SET stripe_schedule_id = 'creating' WHERE id = $1 AND stripe_schedule_id IS NULL AND stripe_subscription_id IS NULL RETURNING id`, [r.id]);
  if (!claim.rowCount) return;
  try { await createSchedule(r, part, content, phases); } catch (e: any) {
    await pool.query(`UPDATE proposals SET stripe_schedule_id = NULL WHERE id = $1 AND stripe_schedule_id = 'creating'`, [r.id]);
    await addEvent(Number(r.id), "autopay_missing", String(e?.message || e).slice(0, 200));
    void textOwner(r, `⚠️ ${r.recipient_name || `Proposal #${r.id}`} paid in full for today, but auto-pay could not start (${String(e?.message || "Stripe error").slice(0, 120)}). Set up the monthly billing in Stripe.`);
    throw e;
  }
}

async function createSchedule(r: any, part: any, content: ProposalContent, phases: ReturnType<typeof autoPaySchedule>): Promise<void> {
  const who = r.recipient_name || r.recipient_email || `proposal #${r.id}`;
  if (!part.payment_method_id && part.payment_intent_id) { // the lookup at settlement can have failed: once more
    const pi = await stripe.paymentIntents.retrieve(part.payment_intent_id).catch(() => null);
    part.payment_method_id = typeof pi?.payment_method === "string" ? pi.payment_method : pi?.payment_method?.id ?? null;
  }
  if (!part.payment_method_id || !r.stripe_customer_id) {
    await pool.query(`UPDATE proposals SET stripe_schedule_id = NULL WHERE id = $1 AND stripe_schedule_id = 'creating'`, [r.id]);
    await addEvent(Number(r.id), "autopay_missing", "no saved payment method — set up monthly billing in Stripe");
    void textOwner(r, `⚠️ ${who} paid in full for today, but auto-pay could not start (no saved payment method). Set up the monthly billing in Stripe.`);
    return;
  }
  const bps = part.method === "card" && content.payment.cardEnabled ? content.payment.cardFeeBps : 0;
  const products = new Map<string, string>();
  for (const l of phases.flatMap((p) => p.lines)) {
    if (!products.has(l.itemId)) products.set(l.itemId, (await stripe.products.create({ name: l.name.slice(0, 250), metadata: { proposalId: String(r.id) } })).id);
  }
  const feeProduct = bps > 0 ? (await stripe.products.create({ name: `Card processing fee (${formatBps(bps)})`, metadata: { proposalId: String(r.id) } })).id : null;
  // Month m of the contract bills m - 1 months from now (day clamped, one anchor for every phase); each phase ends
  // where the next begins (explicit end dates work on every API version). An open-ended phase runs one month,
  // then is released to bill on.
  const now = new Date();
  const start = addMonths(now, 1);
  const at = (month: number) => Math.floor(addMonths(now, month - 1).getTime() / 1000);
  const metadata = { type: "proposal", proposalId: String(r.id) };
  type PhaseItem = Stripe.SubscriptionScheduleCreateParams.Phase.Item;
  const price = (product: string, cents: number): PhaseItem => ({ quantity: 1, price_data: { currency: "usd", product, unit_amount: cents, recurring: { interval: "month" } } });
  const stripePhases: Stripe.SubscriptionScheduleCreateParams.Phase[] = phases.map((p) => ({
    items: [...p.lines.map((l) => price(products.get(l.itemId)!, l.priceCents)), ...(feeProduct ? [price(feeProduct, cardFeeCents(p.cents, bps))] : [])],
    end_date: at((p.toMonth ?? p.fromMonth) + 1),
    proration_behavior: "none",
    metadata,
  }));
  const schedule = await stripe.subscriptionSchedules.create({
    customer: r.stripe_customer_id,
    start_date: at(2),
    end_behavior: phases[phases.length - 1].toMonth === null ? "release" : "cancel",
    default_settings: { default_payment_method: part.payment_method_id, collection_method: "charge_automatically" },
    metadata,
    phases: stripePhases,
  });
  await pool.query(`UPDATE proposals SET stripe_schedule_id = $2, stripe_subscription_id = COALESCE($3, stripe_subscription_id), autopay_starts_at = $4,
      updated_at = now(), events = events || $5::jsonb WHERE id = $1`,
    [r.id, schedule.id, typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription?.id ?? null, start,
      event("autopay_scheduled", `from ${start.toISOString().slice(0, 10)} — ${autoPayLines(phases, bps).join("; ")}`)]);
}

/** Open payments: look each up in Stripe (a return from Checkout can beat the webhook). closeOpen expires the ones
 *  still open, so only one checkout is ever live and what's left can't be paid twice. */
async function syncPayments(r: any, closeOpen: boolean): Promise<boolean> {
  if (!stripeConfigured()) return true;
  let closed = true;
  const list = (Array.isArray(r.payments_json) ? r.payments_json : []).filter((x: any) => x.status === "open" || x.status === "processing").slice(-5);
  for (const x of list) {
    try {
      let s = await stripe.checkout.sessions.retrieve(x.stripe_session_id);
      if (s.status === "open" && closeOpen && x.status === "open") s = await stripe.checkout.sessions.expire(s.id);
      if (s.status === "complete") await applyPaymentCheckout(s, s.payment_status === "paid" ? "checkout.session.async_payment_succeeded" : "checkout.session.completed");
      else if (s.status === "expired") await applyPaymentCheckout(s, "checkout.session.expired");
      else if (closeOpen) closed = false;
    } catch (e: any) {
      console.warn(`[proposals] payment ${x.id} refresh failed:`, e?.message);
      if (closeOpen && x.status === "open") closed = false; // it may be mid-payment: never open a second one beside it
    }
  }
  return closed;
}

/** A return from Checkout can beat the webhook: read the session from Stripe so the page shows the truth. */
async function refreshFromStripe(r: any): Promise<any> {
  if ((Array.isArray(r.payments_json) ? r.payments_json : []).length) {
    if (!["signed", "partial", "processing", "payment_failed"].includes(r.status)) return r;
    await syncPayments(r, false);
    return (await loadById(Number(r.id))) ?? r;
  }
  if (!r.stripe_session_id || !stripeConfigured() || !["signed", "processing"].includes(r.status)) return r;
  try {
    const s = await stripe.checkout.sessions.retrieve(r.stripe_session_id);
    if (s.status === "complete") {
      await applyProposalCheckout(s, "checkout.session.completed");
      return (await loadById(Number(r.id))) ?? r;
    }
  } catch (e: any) { console.warn("[proposals] session refresh failed:", e?.message); }
  return r;
}

/**
 * The signing request, checked: the selection, the name, the drawn or typed signature, the e-sign consent, and an
 * initial on every clause that asks for one. Shared by the real signing and the preview's.
 */
function parseSignature(req: any, content: ProposalContent) {
  const body = z.object({
    itemIds: z.array(z.string().max(40)).max(200),
    plan: z.enum(["monthly", "full"]).optional(),
    name: z.string().trim().min(2).max(120),
    title: z.string().trim().max(120).optional(),
    signatureDataUrl: z.string().max(400_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).optional(),
    initials: z.string().trim().max(6).optional(),
    initialed: z.array(z.object({ id: z.string().max(40), at: z.string().max(40) })).max(40).default([]),
    consent: z.literal(true),
  }).safeParse(req.body);
  if (!body.success) {
    const field = body.error.issues[0]?.path[0];
    return { error: { message: field === "consent" ? "Tick the box to agree to sign electronically." : field === "name" ? "Type your full name." : "Check your selection and signature." } };
  }
  const problems = selectionProblems(content, body.data.itemIds);
  if (problems.length) return { error: { message: problems[0], problems } };
  const need = initialTargets(content);
  const done = new Map(body.data.initialed.map((x) => [x.id, x.at]));
  const missing = need.filter((c) => !done.has(c.id));
  if (need.length && (!body.data.initials || missing.length)) {
    return { error: { message: need.length === 1 ? "Initial the program terms before signing." : `Initial every clause before signing${missing[0] ? ` — “${missing[0].heading || "a clause"}” is not initialed yet` : ""}.` } };
  }
  const now = new Date().toISOString();
  const clampAt = (at: string | undefined) => { const t = at ? Date.parse(at) : NaN; return Number.isFinite(t) && t <= Date.now() + 60_000 && t > Date.now() - 7 * 86_400_000 ? new Date(t).toISOString() : now; };
  const totals = priceSelection(content, body.data.itemIds, body.data.plan);
  const signature = {
    name: body.data.name, title: body.data.title ?? "", imageDataUrl: body.data.signatureDataUrl ?? null,
    signedAt: now, ip: clientIp(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 300), consent: ESIGN_CONSENT,
    ...(need.length ? { initials: body.data.initials!.slice(0, 6), initialed: need.map((c) => ({ id: c.id, at: clampAt(done.get(c.id)) })) } : {}),
  };
  return { body: body.data, totals, signature };
}

export function registerProposalRoutes(app: Express, getDevUser: GetUser): void {
  startProposalReminders();
  // ---------- admin ----------
  app.get("/api/admin/proposals", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const kind = z.enum(PROPOSAL_KINDS).optional().safeParse(req.query.kind || undefined);
    const { rows } = await pool.query(
      `SELECT p.* FROM proposals p WHERE ($1::text IS NULL OR kind = $1) AND status <> 'archived' OR ($2 AND status = 'archived')
       ORDER BY updated_at DESC LIMIT 500`, [kind.success ? kind.data ?? null : null, req.query.archived === "1"]);
    const all = (await pool.query(`SELECT kind, status, totals, paid_cents, sent_at, viewed_at, signed_at FROM proposals WHERE status <> 'archived' AND NOT is_test`)).rows;
    const offers = all.filter((r) => r.kind === "offer");
    const summary: ProposalSummary = {
      templates: all.filter((r) => r.kind === "template").length, offers: offers.length,
      sent: offers.filter((r) => r.sent_at).length, opened: offers.filter((r) => r.viewed_at).length,
      signed: offers.filter((r) => r.signed_at).length, paid: offers.filter((r) => r.status === "paid").length,
      signedValueCents: offers.filter((r) => r.signed_at).reduce((s, r) => s + (r.totals?.contractTotalCents ?? 0), 0),
      paidCents: offers.reduce((s, r) => s + (["paid", "partial"].includes(r.status) ? r.paid_cents ?? 0 : 0), 0),
    };
    res.json({ rows: rows.filter((r) => !kind.success || !kind.data || r.kind === kind.data).map(toRow), summary });
  });

  app.get("/api/admin/proposals/:id", async (req, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    const out = toDetail(r);
    // The company signature starts as the admin's own name (saved with the next save).
    if (out.kind === "offer" && !out.content.countersign.name.trim() && !r.signed_at) out.content.countersign.name = adminName(admin);
    res.json(out);
  });

  app.post("/api/admin/proposals", async (req, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const body = z.object({ kind: z.enum(PROPOSAL_KINDS), fromId: z.number().int().positive().optional(), name: z.string().max(200).optional() }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Choose template or offer" });
    let content: ProposalContent = emptyContent();
    let fileId: number | null = null;
    let templateId: number | null = null;
    let name = body.data.name?.trim() || (body.data.kind === "template" ? "New template" : "New offer");
    if (body.data.fromId) {
      const src = await loadById(body.data.fromId);
      if (!src) return res.status(404).json({ message: "The proposal to copy was not found" });
      content = parseContent(src.content);
      fileId = src.file_id ? Number(src.file_id) : null;
      templateId = src.kind === "template" ? Number(src.id) : (src.template_id ? Number(src.template_id) : null);
      if (!body.data.name) name = body.data.kind === "offer" ? `${src.name} — offer` : `${src.name} (copy)`;
    }
    const { rows } = await pool.query(
      `INSERT INTO proposals (kind, name, public_token, template_id, content, file_id, created_by, events)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *`,
      [body.data.kind, name.slice(0, 200), newToken(), templateId, JSON.stringify(content), fileId, admin.id,
        event("created", body.data.fromId ? `copied from #${body.data.fromId}` : undefined)]);
    res.status(201).json(toDetail(await loadById(Number(rows[0].id))));
  });

  // Building from a PDF takes minutes (the AI lays out the whole document), longer than a proxied request may stay
  // open, so it runs in the background and the page polls the job.
  const importJobs = new Map<string, { status: "running" | "done" | "failed"; proposalId?: number; error?: string; adminId: number; at: number }>();
  app.post("/api/admin/proposals/import", async (req, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const body = z.object({
      kind: z.enum(PROPOSAL_KINDS), fileName: z.string().trim().min(1).max(200), dataBase64: z.string().min(10),
      recipientName: z.string().trim().max(200).optional(), recipientEmail: z.string().trim().max(200).email().or(z.literal("")).optional(),
      recipientCompany: z.string().trim().max(200).optional(),
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Attach a PDF" });
    const buf = Buffer.from(body.data.dataBase64.replace(/^data:[^,]*,/, ""), "base64");
    if (buf.length > MAX_PDF_BYTES) return res.status(413).json({ message: `The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.` });
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ message: "That file is not a PDF." });
    if ([...importJobs.values()].filter((j) => j.status === "running").length >= 3) return res.status(429).json({ message: "Three PDFs are already being read. Try again in a few minutes." });
    for (const [k, j] of importJobs) if (Date.now() - j.at > 3600_000) importJobs.delete(k);
    const jobId = randomBytes(12).toString("base64url");
    const job: { status: "running" | "done" | "failed"; proposalId?: number; error?: string; adminId: number; at: number } = { status: "running", adminId: admin.id, at: Date.now() };
    importJobs.set(jobId, job);
    res.status(202).json({ jobId });
    const d = body.data;
    void (async () => {
      try {
        const made = await proposalFromPdf(buf, "ConstructHUB");
        const fileName = d.fileName.toLowerCase().endsWith(".pdf") ? d.fileName : `${d.fileName}.pdf`;
        const f = await pool.query(`INSERT INTO proposal_files (name, bytes, data) VALUES ($1, $2, $3) RETURNING id`, [fileName, buf.length, buf]);
        const rName = d.recipientName || made.recipient.name || null;
        const rCompany = d.recipientCompany || made.recipient.company || null;
        const rEmail = (d.recipientEmail || (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(made.recipient.email) ? made.recipient.email : "")).toLowerCase() || null;
        const name = (d.kind === "offer" && rName ? `${rName}${rCompany ? ` — ${rCompany}` : ""}` : made.content.title || fileName.replace(/\.pdf$/i, "")).slice(0, 200);
        const offer = d.kind === "offer";
        const { rows } = await pool.query(
          `INSERT INTO proposals (kind, name, public_token, content, file_id, recipient_name, recipient_email, recipient_company, created_by, events)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb) RETURNING id`,
          [d.kind, name, newToken(), JSON.stringify(made.content), f.rows[0].id, offer ? rName : null, offer ? rEmail : null, offer ? rCompany : null, admin.id,
            event("created", `from ${fileName} (${made.pages} pages, ${made.content.groups.reduce((n, g) => n + g.items.length, 0)} options; laid out by ${made.provider})`)]);
        job.status = "done"; job.proposalId = Number(rows[0].id);
      } catch (e: any) {
        job.status = "failed";
        job.error = e instanceof ImportError ? e.message : "Something went wrong building the proposal. Please try again.";
        if (!(e instanceof ImportError)) console.error("[proposals] import failed:", e?.message ?? e);
      }
    })();
  });

  app.get("/api/admin/proposals/import/:jobId", async (req, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const job = importJobs.get(String(req.params.jobId));
    if (!job || job.adminId !== admin.id) return res.status(404).json({ message: "That upload isn't running any more. Please upload the PDF again." });
    res.json({ status: job.status, proposalId: job.proposalId ?? null, error: job.error ?? null });
  });

  app.put("/api/admin/proposals/:id", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    if (LOCKED.includes(r.status)) return res.status(409).json({ message: "This proposal is signed — it can't be changed. Duplicate it to make a new version." });
    const body = z.object({
      name: z.string().trim().min(1).max(200).optional(),
      recipientName: z.string().max(200).nullable().optional(),
      recipientEmail: z.string().trim().max(200).email().or(z.literal("")).nullable().optional(),
      recipientCompany: z.string().max(200).nullable().optional(),
      expiresAt: z.string().datetime({ offset: true }).or(z.literal("")).nullable().optional(),
      content: z.unknown().optional(),
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Invalid proposal" });
    let content: ProposalContent | undefined;
    if (body.data.content !== undefined) {
      const parsed = proposalContentSchema.safeParse(body.data.content);
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        return res.status(400).json({ message: `${i?.path.join(" › ") || "content"}: ${i?.message ?? "invalid"}` });
      }
      const ids = parsed.data.groups.flatMap((g) => [g.id, ...g.items.map((x) => x.id)]);
      if (new Set(ids).size !== ids.length) return res.status(400).json({ message: "Two packages or services share an id — remove the duplicate." });
      content = parsed.data;
    }
    const d = body.data;
    const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);
    const { rows } = await pool.query(
      `UPDATE proposals SET
         name = COALESCE($2, name),
         recipient_name = CASE WHEN $3::boolean THEN $4 ELSE recipient_name END,
         recipient_email = CASE WHEN $5::boolean THEN $6 ELSE recipient_email END,
         recipient_company = CASE WHEN $7::boolean THEN $8 ELSE recipient_company END,
         expires_at = CASE WHEN $9::boolean THEN $10::timestamptz ELSE expires_at END,
         content = COALESCE($11::jsonb, content),
         updated_at = now()
       WHERE id = $1 RETURNING id`,
      [r.id, d.name ?? null,
        d.recipientName !== undefined, blank(d.recipientName) ?? null,
        d.recipientEmail !== undefined, blank(d.recipientEmail)?.toLowerCase() ?? null,
        d.recipientCompany !== undefined, blank(d.recipientCompany) ?? null,
        d.expiresAt !== undefined, blank(d.expiresAt) ?? null,
        content ? JSON.stringify(content) : null]);
    res.json(toDetail(await loadById(Number(rows[0].id))));
  });

  app.post("/api/admin/proposals/:id/file", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    if (LOCKED.includes(r.status)) return res.status(409).json({ message: "This proposal is signed — its document can't be changed." });
    const body = z.object({ name: z.string().trim().min(1).max(200), dataBase64: z.string().min(10) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Attach a PDF" });
    const buf = Buffer.from(body.data.dataBase64.replace(/^data:[^,]*,/, ""), "base64");
    if (buf.length > MAX_PDF_BYTES) return res.status(413).json({ message: `The PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.` });
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ message: "That file is not a PDF." });
    const name = body.data.name.toLowerCase().endsWith(".pdf") ? body.data.name : `${body.data.name}.pdf`;
    const f = await pool.query(`INSERT INTO proposal_files (name, bytes, data) VALUES ($1, $2, $3) RETURNING id`, [name, buf.length, buf]);
    await pool.query(`UPDATE proposals SET file_id = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`, [r.id, f.rows[0].id, event("document_attached", name)]);
    await pool.query(`DELETE FROM proposal_files f WHERE f.id = $1 AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.file_id = f.id)`, [r.file_id ?? 0]);
    res.json(toDetail(await loadById(Number(r.id))));
  });

  app.delete("/api/admin/proposals/:id/file", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    if (LOCKED.includes(r.status)) return res.status(409).json({ message: "This proposal is signed — its document can't be changed." });
    await pool.query(`UPDATE proposals SET file_id = NULL, updated_at = now(), events = events || $2::jsonb WHERE id = $1`, [r.id, event("document_removed")]);
    await pool.query(`DELETE FROM proposal_files f WHERE f.id = $1 AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.file_id = f.id)`, [r.file_id ?? 0]);
    res.json(toDetail(await loadById(Number(r.id))));
  });

  const sendFile = async (res: any, fileId: number | null, download = false) => {
    if (!fileId) return res.status(404).json({ message: "No document is attached" });
    const { rows } = await pool.query(`SELECT name, content_type, data FROM proposal_files WHERE id = $1`, [fileId]);
    if (!rows[0]) return res.status(404).json({ message: "No document is attached" });
    res.setHeader("Content-Type", rows[0].content_type || "application/pdf");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${String(rows[0].name).replace(/[^\w.\- ]+/g, "")}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Robots-Tag", "noindex");
    res.end(rows[0].data);
  };

  app.get("/api/admin/proposals/:id/file", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    await sendFile(res, r.file_id ? Number(r.file_id) : null);
  });

  const sendSignedPdf = async (res: any, r: any) => {
    if (!r.signature || !r.totals) return res.status(404).json({ message: "This proposal hasn't been signed yet." });
    const pdf = await buildSignedProposalPdf(signedPdfInput(r));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="proposal-${r.id}-signed.pdf"`);
    res.setHeader("X-Robots-Tag", "noindex");
    res.end(pdf);
  };

  app.get("/api/admin/proposals/:id/signed.pdf", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    await sendSignedPdf(res, r);
  });

  app.post("/api/admin/proposals/:id/send", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    if (r.kind !== "offer") return res.status(400).json({ message: "Templates aren't sent — create an offer from this template first." });
    if (["void", "archived", "declined"].includes(r.status)) return res.status(409).json({ message: "This proposal is closed — duplicate it to send a new one." });
    const emailList = z.array(z.string().trim().email()).max(10);
    const body = z.object({
      to: z.string().trim().email().optional(), cc: emailList.optional(),
      subject: z.string().trim().max(200).optional(), message: z.string().max(5000).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ message: "Check the email addresses" });
    const to = (body.data.to || r.recipient_email || "").toLowerCase();
    if (!to) return res.status(400).json({ message: "Add the recipient's email first." });
    // The CC list is kept with the offer: the same people get the signed copy and the receipt.
    const cc = [...new Set((body.data.cc ?? r.recipient_cc?.split(",") ?? []).map((s: string) => s.trim().toLowerCase()).filter((s: string) => s && s !== to))].join(", ");
    const content = parseContent(r.content);
    if (!content.groups.some((g) => g.items.length)) return res.status(400).json({ message: "Add at least one priced service before sending." });
    if (content.countersign.name.trim().length < 2) return res.status(400).json({ message: `Add your name under “Signed for ${content.brand.name}” at the bottom of the page first.` });
    if (r.is_test) return res.status(400).json({ message: "This is a test copy — send the real offer instead." });
    const base = getBaseUrl(req);
    const link = `${base}/proposal/${r.public_token}`;
    const subject = body.data.subject || `${content.title || "Your proposal"} — ${content.brand.name}`;
    try {
      await sendWithFallback({
        from: fromFor(content), to, cc: cc || undefined,
        replyTo: content.brand.contactEmail || undefined, subject, ...offerEmail(r, content, link, body.data.message),
      });
    } catch (e: any) {
      return res.status(502).json({ message: `The email could not be sent: ${String(e?.message || e).slice(0, 160)}` });
    }
    await pool.query(
      `UPDATE proposals SET recipient_email = COALESCE(recipient_email, $2), recipient_cc = NULLIF($4, ''), sent_at = now(), countersigned_at = COALESCE(countersigned_at, now()),
         status = CASE WHEN status IN ('draft', 'sent') THEN 'sent' ELSE status END, updated_at = now(), events = events || $3::jsonb
       WHERE id = $1`, [r.id, to, event("sent", cc ? `${to} · cc ${cc}` : to), cc]);
    res.json({ ...toDetail(await loadById(Number(r.id))), link });
  });

  // A test run: a copy of the offer sent to the admin as if they were the client. Signing it is real (the signed
  // agreement goes to them as the client and as the owner); payment is turned off on test copies.
  app.post("/api/admin/proposals/:id/test", async (req, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    if (r.kind !== "offer") return res.status(400).json({ message: "Make an offer from this template to test it." });
    const content = parseContent(r.content);
    if (!content.groups.some((g) => g.items.length)) return res.status(400).json({ message: "Add at least one priced service first." });
    if (content.countersign.name.trim().length < 2) return res.status(400).json({ message: `Add your name under “Signed for ${content.brand.name}” at the bottom of the page first.` });
    const to = String(admin.email || "").toLowerCase();
    if (!to) return res.status(400).json({ message: "Your account has no email address." });
    const { rows } = await pool.query(
      `INSERT INTO proposals (kind, name, public_token, template_id, content, file_id, recipient_name, recipient_email, recipient_company,
         created_by, is_test, status, sent_at, countersigned_at, events)
       VALUES ('offer', $1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'sent', now(), now(), $10::jsonb) RETURNING *`,
      [`TEST — ${r.name}`.slice(0, 200), newToken(), r.template_id, JSON.stringify(content), r.file_id, r.recipient_name, to, r.recipient_company,
        admin.id, event("created", `test copy of #${r.id}, sent to ${to}`)]);
    const t = rows[0];
    const link = `${getBaseUrl(req)}/proposal/${t.public_token}`;
    try {
      await sendWithFallback({
        from: fromFor(content), to, replyTo: content.brand.contactEmail || undefined,
        subject: `[TEST] ${content.title || "Your proposal"} — ${content.brand.name}`, ...offerEmail(t, content, link),
      });
    } catch (e: any) {
      return res.status(502).json({ message: `The test email could not be sent: ${String(e?.message || e).slice(0, 160)}` });
    }
    await pool.query(`UPDATE proposals SET events = events || $2::jsonb WHERE id = $1`, [r.id, event("test_sent", `${to} · #${t.id}`)]);
    res.json({ ok: true, to, link, id: Number(t.id) });
  });

  app.post("/api/admin/proposals/:id/proof", async (req, res) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    if (r.kind !== "offer") return res.status(400).json({ message: "Make an offer from this template to send a proof." });
    const body = z.object({ subject: z.string().trim().max(200).optional(), message: z.string().max(5000).optional() }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ message: "Invalid proof" });
    const to = String(admin.email || "").toLowerCase();
    if (!to) return res.status(400).json({ message: "Your account has no email address." });
    const content = parseContent(r.content);
    const link = `${getBaseUrl(req)}/proposal/${r.public_token}?preview=${previewKey(r.public_token)}`;
    try {
      await sendWithFallback({
        from: fromFor(content), to, replyTo: content.brand.contactEmail || undefined,
        subject: `[PROOF] ${body.data.subject || `${content.title || "Your proposal"} — ${content.brand.name}`}`, ...offerEmail(r, content, link, body.data.message),
      });
    } catch (e: any) {
      return res.status(502).json({ message: `The proof could not be sent: ${String(e?.message || e).slice(0, 160)}` });
    }
    await addEvent(Number(r.id), "proof_sent", to);
    res.json({ ok: true, to });
  });

  app.post("/api/admin/proposals/:id/status", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    const body = z.object({ status: z.enum(["void", "archived", "draft"]) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Unknown status" });
    if (body.data.status === "void" && ["paid", "processing", "partial"].includes(r.status)) {
      return res.status(409).json({ message: "This proposal is paid — refund or cancel it in Stripe first." });
    }
    // Restoring an archived or voided proposal puts it back where it was: signed stays signed.
    const next = body.data.status === "draft"
      ? (r.signed_at ? (r.paid_at ? "paid" : Number(r.paid_cents) > 0 ? "partial" : "signed") : r.viewed_at ? "viewed" : r.sent_at ? "sent" : "draft")
      : body.data.status;
    await pool.query(`UPDATE proposals SET status = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`,
      [r.id, next, event(body.data.status === "draft" ? "restored" : body.data.status)]);
    res.json(toDetail(await loadById(Number(r.id))));
  });

  // An invoice for what's still due today, or part of it (owner, 2026-10-25: "allow payments in the form of invoices").
  const invoiceTarget = async (req: any, res: any) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return null;
    const id = idParam.safeParse(req.params.id);
    let r = id.success ? await loadById(id.data) : null;
    if (!r || r.kind !== "offer") { res.status(404).json({ message: "Proposal not found" }); return null; }
    if (!r.signed_at || !r.totals) { res.status(409).json({ message: "An invoice is for a signed proposal." }); return null; }
    if (["void", "archived", "declined"].includes(r.status)) { res.status(409).json({ message: "This proposal is closed." }); return null; }
    r = await refreshFromStripe(r);
    const bal = balanceOf(r)!;
    if (bal.remainingCents <= 0) { res.status(409).json({ message: bal.pendingCents ? "Nothing is left to pay — a bank transfer is clearing." : "Nothing is left to pay today." }); return null; }
    const raw = req.body?.amountCents ?? req.query?.amountCents;
    const amount = raw == null || raw === "" ? bal.remainingCents : Number(raw);
    const floor = Math.min(MIN_PAYMENT_CENTS, bal.remainingCents);
    if (!Number.isInteger(amount) || amount < floor || amount > bal.remainingCents) {
      res.status(400).json({ message: `Enter an amount from ${formatMoney(floor, { cents: true })} to ${formatMoney(bal.remainingCents, { cents: true })}.` });
      return null;
    }
    return { r, bal, amount };
  };

  app.get("/api/admin/proposals/:id/invoice.pdf", async (req, res) => {
    const t = await invoiceTarget(req, res);
    if (!t) return;
    const pdf = await invoicePdf(t.r, invoiceNumber(Number(t.r.id), Number(t.r.invoice_count ?? 0) + 1), t.amount, t.bal);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${t.r.id}.pdf"`);
    res.send(pdf);
  });

  app.post("/api/admin/proposals/:id/invoice", async (req, res) => {
    const t = await invoiceTarget(req, res);
    if (!t) return;
    if (!t.r.recipient_email) return res.status(400).json({ message: "Add the client's email first." });
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 4000) : undefined;
    // Not two in a row: a second click, or the daily invoice that just went out, holds this one for two minutes.
    const { rows } = await pool.query(
      `UPDATE proposals SET invoice_count = invoice_count + 1, last_invoice_at = now() WHERE id = $1
         AND (last_invoice_at IS NULL OR last_invoice_at < now() - interval '2 minutes') RETURNING invoice_count`, [t.r.id]);
    if (!rows[0]) return res.status(409).json({ message: "An invoice went out in the last two minutes. Check the activity, then send again if you still need to." });
    const n = Number(rows[0].invoice_count);
    try {
      await sendInvoice(t.r, { number: n, amountCents: t.amount, reminder: false, message });
    } catch (e: any) {
      if (!e?.ambiguous) await releaseInvoiceClaim(Number(t.r.id), n, t.r.last_invoice_at);
      await addEvent(Number(t.r.id), "invoice_failed", `${e?.ambiguous ? "may have been delivered" : "not sent"} · ${String(e?.message || e).slice(0, 160)}`);
      return res.status(502).json({ message: e?.ambiguous
        ? "The mail server stopped answering mid-send, so the invoice may have arrived. Check with the client before sending again."
        : `The invoice could not be sent: ${String(e?.message || e).slice(0, 160)}` });
    }
    await addEvent(Number(t.r.id), "invoice_sent", `${invoiceNumber(Number(t.r.id), n)} · ${formatMoney(t.amount, { cents: true })} · ${t.r.recipient_email}`);
    res.json(toDetail(await loadById(Number(t.r.id))));
  });

  app.post("/api/admin/proposals/:id/reminders", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const body = z.object({ paused: z.boolean() }).safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: "Bad request" });
    const { rowCount } = await pool.query(`UPDATE proposals SET reminders_paused = $2, events = events || $3::jsonb WHERE id = $1 AND kind = 'offer'`,
      [id.data, body.data.paused, event(body.data.paused ? "reminders_paused" : "reminders_resumed")]);
    if (!rowCount) return res.status(404).json({ message: "Proposal not found" });
    res.json(toDetail(await loadById(id.data)));
  });

  // ---------- recipient ----------
  app.get("/api/public/proposals/:token", async (req: any, res) => {
    let r = await loadByToken(String(req.params.token || ""));
    if (!r || r.status === "archived") return res.status(404).json({ message: "This proposal link is not valid." });
    const preview = (req.query.preview === "1" && isPlatformAdminEmail(req.user?.email)) || isPreviewKey(r.public_token, req.query.preview);
    // Test copies are tracked too, so a test shows the alerts the owner will get (marked [TEST]).
    // Stripe first, so a client back from paying isn't reported as opening the page with the old balance.
    r = await refreshFromStripe(r);
    if (!preview) {
      await trackOpen(r, req);
      r = await loadById(Number(r.id));
    }
    const sig = r.signature as any;
    const out: PublicProposal = {
      status: r.status, content: parseContent(r.content), recipientName: r.recipient_name, recipientCompany: r.recipient_company,
      hasFile: r.file_id != null, fileName: r.file_name ?? null, expiresAt: iso(r.expires_at), expired: isExpired(r) && !r.signed_at,
      selection: r.selection ?? null, totals: r.totals ?? null,
      signature: sig ? { name: sig.name, signedAt: sig.signedAt } : null,
      payment: { method: r.payment_method ?? null, cardFeeCents: r.card_fee_cents ?? 0, status: r.payment_status ?? null },
      payments: toPayments(r), balance: balanceOf(r), autoPayStartsAt: iso(r.autopay_starts_at),
      stripeReady: stripeConfigured(), preview, isTest: r.is_test === true,
      countersignedAt: iso(r.countersigned_at),
    };
    res.setHeader("X-Robots-Tag", "noindex");
    res.json(out);
  });

  app.get("/api/public/proposals/:token/document", async (req, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r || ["archived", "void"].includes(r.status)) return res.status(404).json({ message: "This proposal link is not valid." });
    await sendFile(res, r.file_id ? Number(r.file_id) : null, req.query.download === "1");
  });

  app.get("/api/public/proposals/:token/invoice.pdf", async (req, res) => {
    let r = await loadByToken(String(req.params.token || ""));
    if (!r || ["archived", "void", "declined"].includes(r.status) || !r.signed_at || !r.totals) return res.status(404).json({ message: "No invoice for this proposal." });
    r = await refreshFromStripe(r);
    const bal = balanceOf(r)!;
    if (bal.remainingCents <= 0) return res.status(404).json({ message: "Nothing is left to pay." });
    // A statement of today's balance, not a numbered invoice: its amount changes with every payment.
    const pdf = await invoicePdf(r, `S-${r.id}-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date()).replace(/-/g, "")}`, bal.remainingCents, bal, true);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="statement-${r.id}.pdf"`);
    res.setHeader("X-Robots-Tag", "noindex");
    res.send(pdf);
  });

  app.get("/api/public/proposals/:token/signed.pdf", async (req, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r || r.status === "archived") return res.status(404).json({ message: "This proposal link is not valid." });
    await sendSignedPdf(res, r);
  });

  app.post("/api/public/proposals/:token/sign", async (req: any, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r || ["archived", "void"].includes(r.status)) return res.status(404).json({ message: "This proposal is no longer available." });
    if (r.signed_at) return res.status(409).json({ message: "This proposal is already signed." });
    if (r.status === "declined") return res.status(409).json({ message: "This proposal was declined. Contact us for a new one." });
    if (isExpired(r)) return res.status(410).json({ message: "This proposal has expired. Contact us for an updated one." });
    const parsed = parseSignature(req, parseContent(r.content));
    if ("error" in parsed) return res.status(400).json(parsed.error);
    const { body, totals, signature } = parsed;
    const { rows } = await pool.query(
      `UPDATE proposals SET status = 'signed', signed_at = now(), selection = $2::jsonb, totals = $3::jsonb, signature = $4::jsonb,
         viewed_at = COALESCE(viewed_at, now()), updated_at = now(), events = events || $5::jsonb
       WHERE id = $1 AND signed_at IS NULL RETURNING *`,
      [r.id, JSON.stringify({ itemIds: body.itemIds, plan: totals.plan }), JSON.stringify(totals), JSON.stringify(signature),
        event("signed", `${body.name} · ${formatMoney(totals.contractTotalCents)} · ${signature.ip ?? ""}`)]);
    if (!rows[0]) return res.status(409).json({ message: "This proposal is already signed." });
    void notifySigned(rows[0], getBaseUrl(req));
    res.json({ ok: true, totals });
  });

  // The preview's "sign": everything the real signing checks, then the signed agreement it would produce — nothing is
  // stored, no one is emailed (an admin's preview, or a proof email's preview key).
  app.post("/api/public/proposals/:token/preview-sign", async (req: any, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r) return res.status(404).json({ message: "This proposal link is not valid." });
    const preview = (req.query.preview === "1" && isPlatformAdminEmail(req.user?.email)) || isPreviewKey(r.public_token, req.query.preview);
    if (!preview) return res.status(403).json({ message: "Preview signing is only for the proposal's preview link." });
    const parsed = parseSignature(req, parseContent(r.content));
    if ("error" in parsed) return res.status(400).json(parsed.error);
    const pdf = await buildSignedProposalPdf({ ...signedPdfInput({ ...r, totals: parsed.totals, signature: parsed.signature, payment_method: null, payment_status: null, paid_at: null }), preview: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="proposal-${r.id}-preview.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(pdf);
  });

  app.post("/api/public/proposals/:token/decline", async (req, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r || ["archived", "void"].includes(r.status)) return res.status(404).json({ message: "This proposal is no longer available." });
    if (r.signed_at) return res.status(409).json({ message: "This proposal is already signed." });
    const reason = z.string().max(1000).optional().safeParse(req.body?.reason);
    await pool.query(`UPDATE proposals SET status = 'declined', updated_at = now(), events = events || $2::jsonb WHERE id = $1`,
      [r.id, event("declined", reason.success ? reason.data : undefined)]);
    const content = parseContent(r.content);
    const admins = await adminRecipients(r);
    void sendWithFallback({
      from: fromFor(content), to: admins.join(", "), subject: `Proposal declined — ${r.recipient_name || r.recipient_email || `#${r.id}`}`,
      html: emailShell(content, `<p>${esc(r.recipient_name || "The recipient")} declined <b>${esc(content.title || r.name)}</b>.</p>${reason.success && reason.data ? `<p>Reason: ${esc(reason.data)}</p>` : ""}`),
      text: `${r.recipient_name || "The recipient"} declined ${content.title}.`,
    }).catch((e: any) => console.error("[proposals] decline email failed:", e?.message));
    res.json({ ok: true });
  });

  app.post("/api/public/proposals/:token/checkout", async (req, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r || ["archived", "void"].includes(r.status)) return res.status(404).json({ message: "This proposal is no longer available." });
    if (!r.signed_at || !r.totals) return res.status(409).json({ message: "Sign the proposal first." });
    if (PAID_UP.includes(r.status)) return res.status(409).json({ message: "This proposal is already paid." });
    if (r.is_test) return res.status(409).json({ message: "This is a test copy — payment is turned off. On the real link the client pays here." });
    if (!stripeConfigured()) return res.status(503).json({ message: "Online payment isn't available right now. Please contact us to arrange payment." });
    const method = z.enum(["ach", "card"]).safeParse(req.body?.method);
    if (!method.success) return res.status(400).json({ message: "Choose bank transfer (ACH) or card." });
    const content = parseContent(r.content);
    if (method.data === "ach" && !content.payment.achEnabled) return res.status(400).json({ message: "Bank transfer isn't offered on this proposal — please pay by card." });
    if (method.data === "card" && !content.payment.cardEnabled) return res.status(400).json({ message: "Card isn't offered on this proposal — please pay by bank transfer (ACH)." });

    // One payment toward what's due today (frozen at signing, never from the request): the client picks the amount
    // (owner, 2026-10-25), from MIN_PAYMENT_CENTS up to what's left; the card fee is on that amount.
    const t = r.totals as ProposalTotals;
    // Only one checkout is live at a time, and one that completed in another tab counts before the balance is read.
    if (r.stripe_session_id && !(Array.isArray(r.payments_json) ? r.payments_json : []).some((x: any) => x.stripe_session_id === r.stripe_session_id)) {
      try { // a checkout from before payments came in parts (one subscription session)
        const old = await stripe.checkout.sessions.retrieve(r.stripe_session_id);
        if (old.status === "complete") { await applyProposalCheckout(old, "checkout.session.completed"); return res.status(409).json({ message: "This proposal is already paid." }); }
        if (old.status === "open") await stripe.checkout.sessions.expire(old.id);
      } catch { /* an unknown or already-expired session: start fresh */ }
    }
    // One checkout at a time per proposal, across tabs and server workers: held until the new one is recorded.
    const lock = await pool.connect();
    try {
    const got = await lock.query(`SELECT pg_try_advisory_lock(hashtext('proposal-pay'), $1::int) AS ok`, [Number(r.id)]);
    if (!got.rows[0]?.ok) return res.status(409).json({ message: "A payment is already starting in another window. Give it a moment, then reload." });
    try {
    // Read under the lock: a checkout another window just made is seen (and closed) here.
    if (!(await syncPayments(await loadById(Number(r.id)), true))) return res.status(409).json({ message: "A payment is still in progress in another window. Finish it there, or wait a minute and reload." });
    const fresh = await loadById(Number(r.id));
    const bal = balanceOf(fresh)!;
    if (bal.remainingCents <= 0) return res.status(409).json({ message: bal.pendingCents ? "Nothing more is due today — your bank transfer is clearing." : "This proposal is already paid." });
    const asked = req.body?.amountCents == null ? bal.remainingCents : Number(req.body.amountCents);
    const floor = Math.min(MIN_PAYMENT_CENTS, bal.remainingCents);
    if (!Number.isInteger(asked) || asked < floor) return res.status(400).json({ message: `Enter an amount of at least ${formatMoney(floor, { cents: true })}.` });
    if (asked > bal.remainingCents) return res.status(400).json({ message: `That's more than what's left. You can pay up to ${formatMoney(bal.remainingCents, { cents: true })}.` });
    const bps = method.data === "card" ? content.payment.cardFeeBps : 0;
    const fee = cardFeeCents(asked, bps);
    const autoPay = autoPaySchedule(content, t).length > 0;
    const title = (content.title || r.name).slice(0, 200);
    const n = (Array.isArray(fresh.payments_json) ? fresh.payments_json : []).filter((x: any) => x.status === "paid" || x.status === "processing").length + 1;

    try {
      // Every payment goes on one Stripe customer per proposal, so the method used last can carry auto-pay.
      let customer = fresh.stripe_customer_id as string | null;
      if (!customer) {
        customer = (await stripe.customers.create({
          email: r.recipient_email || undefined, name: (r.recipient_name || r.recipient_company || "").slice(0, 200) || undefined,
          metadata: { type: "proposal", proposalId: String(r.id) },
        })).id;
        await pool.query(`UPDATE proposals SET stripe_customer_id = $2 WHERE id = $1`, [r.id, customer]);
      }
      const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
        quantity: 1,
        price_data: { currency: "usd", unit_amount: asked, product_data: {
          name: asked === bal.dueTodayCents ? title : `Payment ${n} — ${title}`.slice(0, 250),
          description: asked === bal.dueTodayCents ? undefined : `${formatMoney(asked, { cents: true })} of ${formatMoney(bal.remainingCents, { cents: true })} left to pay today`,
        } },
      }];
      if (fee > 0) items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: fee, product_data: { name: `Card processing fee (${formatBps(bps)})`, description: "Covers card processing. Pay by bank transfer (ACH) to avoid this fee." } } });
      const base = getBaseUrl(req);
      const metadata = { type: "proposal", part: "1", proposalId: String(r.id), method: method.data, amountCents: String(asked), cardFeeCents: String(fee) };
      const card = method.data === "card";
      // Only the payment that finishes today's balance saves the method for auto-pay: asking to keep a card for future
      // charges makes issuers' 3-D Secure (AMEX SafeKey) stricter, and a part payment's card is never the one billed.
      const saveForAutoPay = autoPay && (!card || asked === bal.remainingCents);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer,
        line_items: items,
        payment_method_types: card ? ["card"] : ["us_bank_account"],
        payment_method_options: card
          // A one-time code from the bank instead of its silent risk check, which turns down a large first charge
          // from a new merchant (owner, 2026-10-26: AMEX failed authentication in 2s with no code shown).
          ? { card: { request_three_d_secure: "challenge" } }
          : { us_bank_account: { financial_connections: { permissions: ["payment_method"] } } },
        // The full billing address and phone go to the issuer's authentication and the street/ZIP checks.
        ...(card ? {
          billing_address_collection: "required" as const,
          phone_number_collection: { enabled: true },
          customer_update: { address: "auto" as const, name: "auto" as const },
          custom_text: { submit: { message: "Your card issuer may ask you to confirm this payment with a code sent to your phone or email. Keep that handy." } },
        } : {}),
        success_url: `${base}/proposal/${r.public_token}?paid=1`,
        cancel_url: `${base}/proposal/${r.public_token}?paid=0`,
        metadata,
        payment_intent_data: {
          metadata, description: title, ...(saveForAutoPay ? { setup_future_usage: "off_session" as const } : {}),
          // "CONSTRUCTHUB* PROP 7" on the card statement (22 characters at most with the prefix).
          ...(card ? { statement_descriptor_suffix: `PROP ${r.id}`.slice(0, 8) } : {}),
        },
      });
      await pool.query(`INSERT INTO proposal_payments (proposal_id, stripe_session_id, method, amount_cents, fee_cents) VALUES ($1, $2, $3, $4, $5)`,
        [r.id, session.id, method.data, asked, fee]);
      await pool.query(`UPDATE proposals SET stripe_session_id = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`,
        [r.id, session.id, event("checkout_started", `${formatMoney(asked, { cents: true })} by ${method.data === "ach" ? "bank transfer (ACH)" : `card (+${formatMoney(fee, { cents: true })} fee)`} · ${formatMoney(bal.remainingCents, { cents: true })} left`)]);
      res.json({ url: session.url });
    } catch (e: any) {
      console.error("[proposals] checkout failed:", e?.message || e);
      res.status(502).json({ message: String(e?.message || "Could not start checkout").slice(0, 200) });
    }
    } finally { await lock.query(`SELECT pg_advisory_unlock(hashtext('proposal-pay'), $1::int)`, [Number(r.id)]).catch(() => {}); }
    } finally { lock.release(); }
  });
}
