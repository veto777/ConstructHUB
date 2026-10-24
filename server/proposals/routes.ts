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
 *
 *   recipient (the token in the emailed link is the key; no account):
 *     GET  /api/public/proposals/:token[?preview=1|<key>]   the page (an admin's preview, or a proof email's signed key,
 *          records no view)
 *     GET  /api/public/proposals/:token/document      the attached PDF, inline
 *     POST /api/public/proposals/:token/sign { itemIds, plan, name, title?, signatureDataUrl?, initials?, initialed[], consent }
 *     POST /api/public/proposals/:token/preview-sign   (preview links only) the same checks → the signed agreement PDF it
 *          would produce; nothing stored or sent
 *     POST /api/public/proposals/:token/decline { reason? }
 *     POST /api/public/proposals/:token/checkout { method: ach | card }   → Stripe Checkout url
 *     GET  /api/public/proposals/:token/signed.pdf
 *
 * Every total is recomputed here from the stored content (priceSelection); the browser only sends item ids.
 * Payment goes to the platform's own Stripe account: ACH (us_bank_account) with no fee, or card with the
 * proposal's card fee added as its own line. The platform webhook (server/stripe.ts) hands checkout events
 * whose metadata.type is "proposal" to applyProposalCheckout below.
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
import { sendWithFallback } from "../email";
import {
  ESIGN_CONSENT, MAX_PDF_BYTES, PROPOSAL_KINDS, initialTargets, cardFeeCents, emptyContent, formatBps, formatMoney, priceSelection, proposalContentSchema,
  selectionProblems, type ProposalContent, type ProposalDetail, type ProposalEvent, type ProposalRow, type ProposalStatus, type ProposalSummary,
  type ProposalTotals, type PublicProposal,
} from "@shared/proposals";
import { buildSignedProposalPdf } from "./pdf";
import { ImportError, proposalFromPdf } from "./import";

type GetUser = (req: any, res: any) => any;

const LOCKED: readonly ProposalStatus[] = ["signed", "processing", "paid"];
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
    title: content.title, templateId: r.template_id ? Number(r.template_id) : null, hasFile: r.file_id != null,
    contractTotalCents: totals?.contractTotalCents ?? null, dueTodayCents: totals?.dueTodayCents ?? null, paidCents: r.paid_cents ?? null,
    sentAt: iso(r.sent_at), viewedAt: iso(r.viewed_at), signedAt: iso(r.signed_at), paidAt: iso(r.paid_at),
    createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
  };
}

async function loadById(id: number) {
  const { rows } = await pool.query(
    `SELECT p.*, f.name AS file_name, f.bytes AS file_bytes FROM proposals p LEFT JOIN proposal_files f ON f.id = p.file_id WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}
async function loadByToken(token: string) {
  if (!token || token.length > 64) return null;
  const { rows } = await pool.query(
    `SELECT p.*, f.name AS file_name, f.bytes AS file_bytes FROM proposals p LEFT JOIN proposal_files f ON f.id = p.file_id WHERE p.public_token = $1 AND p.kind = 'offer'`, [token]);
  return rows[0] ?? null;
}

function toDetail(r: any): ProposalDetail {
  const sig = r.signature as any;
  return {
    ...toRow(r), publicToken: r.public_token, content: parseContent(r.content), expiresAt: iso(r.expires_at),
    file: r.file_id ? { name: r.file_name, bytes: Number(r.file_bytes) } : null,
    selection: r.selection ?? null, totals: r.totals ?? null,
    signature: sig ? { name: sig.name, title: sig.title ?? "", signedAt: sig.signedAt, ip: sig.ip ?? null } : null,
    payment: { method: r.payment_method ?? null, cardFeeCents: r.card_fee_cents ?? 0, status: r.payment_status ?? null, subscriptionId: r.stripe_subscription_id ?? null },
    events: Array.isArray(r.events) ? r.events : [],
  };
}

const isExpired = (r: any) => !!r.expires_at && new Date(r.expires_at).getTime() < Date.now();

function signedPdfInput(r: any) {
  return {
    id: Number(r.id), content: parseContent(r.content), recipientName: r.recipient_name, recipientEmail: r.recipient_email,
    recipientCompany: r.recipient_company, totals: r.totals as ProposalTotals, signature: r.signature,
    payment: { method: r.payment_method ?? null, status: r.payment_status ?? null, paidAt: iso(r.paid_at) },
  };
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
      from: fromFor(content), to: r.recipient_email, replyTo: content.brand.contactEmail || undefined,
      subject: `Signed: ${content.title || "your proposal"}`,
      html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p><p>Thank you — your signed copy of <b>${esc(content.title || "the proposal")}</b> is attached.</p>${summary}
        <p>Due today: <b>${formatMoney(t.dueTodayCents, { cents: true })}</b> by bank transfer (ACH)${t.recurringCents ? `, then ${formatMoney(t.recurringCents, { cents: true })} each month` : ""}.</p>
        ${r.payment_status === "paid" || r.payment_status === "processing" ? "" : button(link, "Complete payment", content.brand.accent)}`),
      text: `Your signed copy of ${content.title} is attached. ${link}`,
      attachments,
    }).catch((e: any) => console.error("[proposals] signed email to recipient failed:", e?.message));
  }
  const admins = await adminRecipients(r);
  await sendWithFallback({
    from: fromFor(content), to: admins.join(", "),
    subject: `Proposal signed — ${r.recipient_name || r.recipient_email || `#${r.id}`} (${formatMoney(t.contractTotalCents)})`,
    html: emailShell(content, `<p><b>${esc(r.recipient_name || "The recipient")}</b>${r.recipient_company ? ` (${esc(r.recipient_company)})` : ""} signed <b>${esc(content.title || r.name)}</b>.</p>${summary}
      <p>Contract total ${formatMoney(t.contractTotalCents, { cents: true })} · due today ${formatMoney(t.dueTodayCents, { cents: true })}${t.recurringCents ? ` · then ${formatMoney(t.recurringCents, { cents: true })}/month` : ""}.</p>
      ${button(`${base}/admin/proposals/${r.id}`, "Open in ConstructHUB", content.brand.accent)}`),
    text: `${r.recipient_name || "The recipient"} signed ${content.title}.`,
    attachments,
  }).catch((e: any) => console.error("[proposals] signed email to admins failed:", e?.message));
}

async function notifyPaid(r: any, state: "paid" | "processing" | "failed") {
  const content = parseContent(r.content);
  const admins = await adminRecipients(r);
  const amount = formatMoney(r.paid_cents ?? 0, { cents: true });
  const label = state === "paid" ? `Payment received — ${amount}` : state === "processing" ? `ACH payment started — ${amount} (clearing)` : "Payment failed";
  await sendWithFallback({
    from: fromFor(content), to: admins.join(", "),
    subject: `${label}: ${r.recipient_name || r.recipient_email || `proposal #${r.id}`}`,
    html: emailShell(content, `<p>${esc(label)} for <b>${esc(content.title || r.name)}</b> from ${esc(r.recipient_name || r.recipient_email || "the recipient")}.</p>
      <p>Method: ${r.payment_method === "card" ? `card (incl. ${formatMoney(r.card_fee_cents ?? 0, { cents: true })} card fee)` : "bank transfer (ACH)"}.</p>`),
    text: `${label} — ${content.title}`,
  }).catch((e: any) => console.error("[proposals] payment email failed:", e?.message));
  if (state === "paid" && r.recipient_email) {
    await sendWithFallback({
      from: fromFor(content), to: r.recipient_email, replyTo: content.brand.contactEmail || undefined,
      subject: `Payment received — ${content.title || "thank you"}`,
      html: emailShell(content, `<p>Hi ${esc(r.recipient_name || "there")},</p><p>We received your payment of <b>${amount}</b>. We'll be in touch to schedule kickoff.</p>`),
      text: `We received your payment of ${amount}.`,
    }).catch((e: any) => console.error("[proposals] receipt email failed:", e?.message));
  }
}

/** checkout.session.* for a proposal (server/stripe.ts): paid → paid; completed but unpaid (ACH) → processing; failed → payment_failed. */
export async function applyProposalCheckout(session: Stripe.Checkout.Session, eventType: string): Promise<void> {
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
  // A fixed term: the subscription ends by itself after the agreed number of months.
  const months = parseContent(r.content).payment.endAfterMonths;
  if (subId && months && state !== "failed" && stripeConfigured()) {
    const cancelAt = new Date();
    cancelAt.setMonth(cancelAt.getMonth() + months);
    await stripe.subscriptions.update(subId, { cancel_at: Math.floor(cancelAt.getTime() / 1000) })
      .catch((e: any) => console.error(`[proposals] could not set the end date on ${subId}:`, e?.message));
  }
  if (updated) await notifyPaid(updated, state);
}

/** A return from Checkout can beat the webhook: read the session from Stripe so the page shows the truth. */
async function refreshFromStripe(r: any): Promise<any> {
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
  // ---------- admin ----------
  app.get("/api/admin/proposals", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const kind = z.enum(PROPOSAL_KINDS).optional().safeParse(req.query.kind || undefined);
    const { rows } = await pool.query(
      `SELECT p.* FROM proposals p WHERE ($1::text IS NULL OR kind = $1) AND status <> 'archived' OR ($2 AND status = 'archived')
       ORDER BY updated_at DESC LIMIT 500`, [kind.success ? kind.data ?? null : null, req.query.archived === "1"]);
    const all = (await pool.query(`SELECT kind, status, totals, paid_cents, sent_at, viewed_at, signed_at FROM proposals WHERE status <> 'archived'`)).rows;
    const offers = all.filter((r) => r.kind === "offer");
    const summary: ProposalSummary = {
      templates: all.filter((r) => r.kind === "template").length, offers: offers.length,
      sent: offers.filter((r) => r.sent_at).length, opened: offers.filter((r) => r.viewed_at).length,
      signed: offers.filter((r) => r.signed_at).length, paid: offers.filter((r) => r.status === "paid").length,
      signedValueCents: offers.filter((r) => r.signed_at).reduce((s, r) => s + (r.totals?.contractTotalCents ?? 0), 0),
      paidCents: offers.reduce((s, r) => s + (r.status === "paid" ? r.paid_cents ?? 0 : 0), 0),
    };
    res.json({ rows: rows.filter((r) => !kind.success || !kind.data || r.kind === kind.data).map(toRow), summary });
  });

  app.get("/api/admin/proposals/:id", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    const r = id.success ? await loadById(id.data) : null;
    if (!r) return res.status(404).json({ message: "Proposal not found" });
    res.json(toDetail(r));
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
    const content = parseContent(r.content);
    if (!content.groups.some((g) => g.items.length)) return res.status(400).json({ message: "Add at least one priced service before sending." });
    const base = getBaseUrl(req);
    const link = `${base}/proposal/${r.public_token}`;
    const subject = body.data.subject || `${content.title || "Your proposal"} — ${content.brand.name}`;
    try {
      await sendWithFallback({
        from: fromFor(content), to, cc: body.data.cc?.length ? body.data.cc.join(", ") : undefined,
        replyTo: content.brand.contactEmail || undefined, subject, ...offerEmail(r, content, link, body.data.message),
      });
    } catch (e: any) {
      return res.status(502).json({ message: `The email could not be sent: ${String(e?.message || e).slice(0, 160)}` });
    }
    await pool.query(
      `UPDATE proposals SET recipient_email = COALESCE(recipient_email, $2), sent_at = now(),
         status = CASE WHEN status IN ('draft', 'sent') THEN 'sent' ELSE status END, updated_at = now(), events = events || $3::jsonb
       WHERE id = $1`, [r.id, to, event("sent", [to, ...(body.data.cc ?? [])].join(", "))]);
    res.json({ ...toDetail(await loadById(Number(r.id))), link });
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
    if (body.data.status === "void" && ["paid", "processing"].includes(r.status)) {
      return res.status(409).json({ message: "This proposal is paid — refund or cancel it in Stripe first." });
    }
    // Restoring an archived or voided proposal puts it back where it was: signed stays signed.
    const next = body.data.status === "draft"
      ? (r.signed_at ? (r.paid_at ? "paid" : "signed") : r.viewed_at ? "viewed" : r.sent_at ? "sent" : "draft")
      : body.data.status;
    await pool.query(`UPDATE proposals SET status = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`,
      [r.id, next, event(body.data.status === "draft" ? "restored" : body.data.status)]);
    res.json(toDetail(await loadById(Number(r.id))));
  });

  // ---------- recipient ----------
  app.get("/api/public/proposals/:token", async (req: any, res) => {
    let r = await loadByToken(String(req.params.token || ""));
    if (!r || r.status === "archived") return res.status(404).json({ message: "This proposal link is not valid." });
    const preview = (req.query.preview === "1" && isPlatformAdminEmail(req.user?.email)) || isPreviewKey(r.public_token, req.query.preview);
    if (!preview && !r.viewed_at && !["void"].includes(r.status)) {
      await pool.query(
        `UPDATE proposals SET viewed_at = now(), status = CASE WHEN status IN ('draft', 'sent') THEN 'viewed' ELSE status END,
           events = events || $2::jsonb WHERE id = $1`, [r.id, event("opened", clientIp(req) ?? undefined)]);
      r = await loadById(Number(r.id));
    }
    r = await refreshFromStripe(r);
    const sig = r.signature as any;
    const out: PublicProposal = {
      status: r.status, content: parseContent(r.content), recipientName: r.recipient_name, recipientCompany: r.recipient_company,
      hasFile: r.file_id != null, fileName: r.file_name ?? null, expiresAt: iso(r.expires_at), expired: isExpired(r) && !r.signed_at,
      selection: r.selection ?? null, totals: r.totals ?? null,
      signature: sig ? { name: sig.name, signedAt: sig.signedAt } : null,
      payment: { method: r.payment_method ?? null, cardFeeCents: r.card_fee_cents ?? 0, status: r.payment_status ?? null },
      stripeReady: stripeConfigured(), preview,
    };
    res.setHeader("X-Robots-Tag", "noindex");
    res.json(out);
  });

  app.get("/api/public/proposals/:token/document", async (req, res) => {
    const r = await loadByToken(String(req.params.token || ""));
    if (!r || ["archived", "void"].includes(r.status)) return res.status(404).json({ message: "This proposal link is not valid." });
    await sendFile(res, r.file_id ? Number(r.file_id) : null, req.query.download === "1");
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
    if (["paid", "processing"].includes(r.status)) return res.status(409).json({ message: "This proposal is already paid." });
    if (!stripeConfigured()) return res.status(503).json({ message: "Online payment isn't available right now. Please contact us to arrange payment." });
    const method = z.enum(["ach", "card"]).safeParse(req.body?.method);
    if (!method.success) return res.status(400).json({ message: "Choose bank transfer (ACH) or card." });
    const content = parseContent(r.content);
    if (method.data === "ach" && !content.payment.achEnabled) return res.status(400).json({ message: "Bank transfer isn't offered on this proposal — please pay by card." });
    if (method.data === "card" && !content.payment.cardEnabled) return res.status(400).json({ message: "Card isn't offered on this proposal — please pay by bank transfer (ACH)." });

    // Prices come from the totals frozen at signing, never from the request.
    const t = r.totals as ProposalTotals;
    const bps = method.data === "card" ? content.payment.cardFeeBps : 0;
    const monthlyPlan = t.plan === "monthly" && t.recurringCents > 0;
    const items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    for (const l of t.lines) {
      if (l.billing === "monthly" && monthlyPlan) {
        items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: l.priceCents, recurring: { interval: "month" }, product_data: { name: l.name.slice(0, 250) } } });
      } else if (l.billing === "monthly") {
        items.push({ quantity: l.termMonths, price_data: { currency: "usd", unit_amount: l.priceCents, product_data: { name: `${l.name} (per month × ${l.termMonths} months)`.slice(0, 250) } } });
      } else {
        items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: l.priceCents, product_data: { name: l.name.slice(0, 250) } } });
      }
    }
    const feeLabel = `Card processing fee (${formatBps(bps)})`;
    const feeNote = "Covers card processing. Pay by bank transfer (ACH) to avoid this fee.";
    let feeToday = 0;
    if (bps > 0) {
      const oneTimeBase = monthlyPlan ? t.oneTimeCents : t.dueTodayCents;
      const oneTimeFee = cardFeeCents(oneTimeBase, bps);
      if (oneTimeFee > 0) items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: oneTimeFee, product_data: { name: feeLabel, description: feeNote } } });
      const monthlyFee = monthlyPlan ? cardFeeCents(t.recurringCents, bps) : 0;
      if (monthlyFee > 0) items.push({ quantity: 1, price_data: { currency: "usd", unit_amount: monthlyFee, recurring: { interval: "month" }, product_data: { name: `${feeLabel} — monthly`, description: feeNote } } });
      feeToday = oneTimeFee + monthlyFee;
    }

    // One open checkout at a time: a new attempt closes the previous session.
    if (r.stripe_session_id) {
      try {
        const old = await stripe.checkout.sessions.retrieve(r.stripe_session_id);
        if (old.status === "complete") { await applyProposalCheckout(old, "checkout.session.completed"); return res.status(409).json({ message: "This proposal is already paid." }); }
        if (old.status === "open") await stripe.checkout.sessions.expire(old.id);
      } catch { /* an unknown or already-expired session: start fresh */ }
    }

    const base = getBaseUrl(req);
    const metadata = { type: "proposal", proposalId: String(r.id), method: method.data, cardFeeCents: String(feeToday) };
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: monthlyPlan ? "subscription" : "payment",
      line_items: items,
      payment_method_types: method.data === "ach" ? ["us_bank_account"] : ["card"],
      ...(method.data === "ach" ? { payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] } } } } : {}),
      customer_email: r.recipient_email || undefined,
      success_url: `${base}/proposal/${r.public_token}?paid=1`,
      cancel_url: `${base}/proposal/${r.public_token}?paid=0`,
      metadata,
      ...(monthlyPlan
        ? { subscription_data: { metadata, description: (content.title || r.name).slice(0, 250) } }
        : { customer_creation: "always" as const, payment_intent_data: { metadata, description: (content.title || r.name).slice(0, 250) } }),
    };
    try {
      const session = await stripe.checkout.sessions.create(params);
      await pool.query(`UPDATE proposals SET stripe_session_id = $2, payment_method = $3, card_fee_cents = $4, updated_at = now(), events = events || $5::jsonb WHERE id = $1`,
        [r.id, session.id, method.data, feeToday, event("checkout_started", method.data === "ach" ? "bank transfer (ACH)" : `card (+${formatMoney(feeToday, { cents: true })} fee)`)]);
      res.json({ url: session.url });
    } catch (e: any) {
      console.error("[proposals] checkout failed:", e?.message || e);
      res.status(502).json({ message: String(e?.message || "Could not start checkout").slice(0, 200) });
    }
  });
}
