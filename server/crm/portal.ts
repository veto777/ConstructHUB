/**
 * Send an estimate, track that it was opened, and let the client approve or
 * decline from their own portal.
 *
 * The public document routes are EMAIL-GATED (Jobber-style): the 48-hex token
 * in the URL identifies the document but no longer authorises it. The browser
 * must also hold a client session (crm_client cookie) whose customerIds
 * include the document's customer — minted by verifying the email address the
 * document was sent to (POST /api/public/verify-access, same magic-link
 * machinery as the client portal). A forwarded bare link is therefore useless
 * to anyone without access to the recipient's inbox. The routes stay
 * deliberately narrow: read one document, or approve/decline/pay one
 * document. Costs and internal-only line items are never serialised to them.
 */
import type { Express } from "express";
import { z } from "zod";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "../db";
import {
  crmCustomers, crmProjects, crmEstimates, crmEstimateItems, crmEstimateOptions, crmOrgs, crmMembers,
  crmEstimateEvents, crmEngagementSessions,
  CRM_PROJECT_STAGE_META,
  crmNotificationEnabled,
  crmClientTokens,
} from "@shared/schema";
import { and, eq, desc, asc, sql, isNull } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { allow as rateAllow, resolveClientCustomerIds } from "./client-auth";
import { sendWithFallback } from "../email";
import { getBaseUrl } from "../auth";
import { portalBaseUrl, clientPortalBaseUrl } from "../site-context";
import { logEvent, presentEstimate } from "./entities";
import { emitCrmEvent } from "./integrations";
import { registerCrmSmsRoutes, maybeAlertReengagement, priorEstimateSessionCount } from "./sms";
import { companyBranding, resolveEstimateDivision, resolveInvoiceDivision, getDivision } from "./divisions";
import { crmInvoices, crmInvoiceItems, crmPayments, crmEstimateDiscounts } from "@shared/schema";
import { recomputeApprovalTotals } from "./discounts";
import { storeGeneratedPdf } from "./attachments";
import { buildContractPdf, contractAdminRecipients, contractFileName } from "./contract-pdf";
import type { CrmNotificationPref } from "@shared/schema";
import { resolveOrgTheme, themePayload } from "@shared/theme-colors";

type GetUser = (req: any, res: any) => any;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

/**
 * Reply-To for client-facing sends: the salesperson who created the bid, NOT
 * the generic org/admin inbox (the HCP behavior the owner hates — a client
 * hitting Reply must land with the person who sent the bid).
 */
async function senderReplyTo(createdByMemberId: string | null | undefined, fallback?: string | null): Promise<string | undefined> {
  if (createdByMemberId) {
    const [m] = await db.select({ email: crmMembers.email }).from(crmMembers)
      .where(eq(crmMembers.id, createdByMemberId)).limit(1);
    if (m?.email) return m.email;
  }
  return fallback || undefined;
}

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

/**
 * A refresh is not a new view. Within this window, repeated opens from the
 * same IP update lastViewedAt but do not inflate viewCount (or spam the
 * events audit trail). First-view tracking is unaffected.
 */
const VIEW_DEDUPE_MIN = 30;

// ── Engagement + expiry: pure helpers (unit-tested in engagement.test.ts) ───

/**
 * Sent estimates expire. Default: 7 days from the moment it is sent — long
 * enough to decide, short enough that pricing doesn't go stale. Stamped at
 * send time (not at create), so a draft sitting in the pipeline doesn't burn
 * its validity window before the client ever sees it.
 */
export const ESTIMATE_EXPIRY_DAYS = 7;
export function estimateExpiryOnSend(sentAt: Date, days: number = ESTIMATE_EXPIRY_DAYS): Date {
  return new Date(sentAt.getTime() + days * 86_400_000);
}

/**
 * A heartbeat says "I was still here N seconds after the last one". Gaps are
 * capped: the page pings every 15s while visible, so anything beyond 60s
 * means the tab was hidden/backgrounded/asleep — not reading time. Counting
 * the full gap would turn an open-in-background tab into fake engagement.
 */
export const ENGAGEMENT_PING_CAP_SECS = 60;
export function engagementIncrement(lastPingAt: Date | null | undefined, now: Date): number {
  if (!lastPingAt) return 0;
  const gapSecs = Math.floor((now.getTime() - lastPingAt.getTime()) / 1000);
  if (gapSecs <= 0) return 0; // duplicate/out-of-order ping — never subtract
  return Math.min(gapSecs, ENGAGEMENT_PING_CAP_SECS);
}

/** CRM-side reads redact client IPs to the /24 (v4) or /48 (v6) prefix. */
export function redactIpPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : null;
  }
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  return null;
}

// ── The email gate ──────────────────────────────────────────────────────────

/**
 * A public document serves only to a browser holding a client session whose
 * customerIds include the document's customer. Everyone else gets
 * 401 { requiresVerification: true } and the page renders the email-
 * verification challenge. Used by every public document route here and by the
 * public pay routes in payments.ts.
 */
export async function requireDocSession(req: any, res: any, customerId: string): Promise<boolean> {
  const ids = await resolveClientCustomerIds(req);
  if (ids.includes(customerId)) return true;
  res.status(401).json({
    message: "This document is private. Verify the email address it was sent to.",
    requiresVerification: true,
  });
  return false;
}

// ── Contractor preview ──────────────────────────────────────────────────────
// Org members preview the client page WITHOUT a client session. The bypass is
// an HMAC-signed 15-minute grant bound to ONE estimate id (SESSION_SECRET
// keyed, stateless) and is READ-ONLY: respond/pay/engagement still require the
// client session, and preview opens never touch view tracking.
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const previewSecret = () => process.env.SESSION_SECRET || "";

function mintPreviewGrant(estimateId: string): string {
  const exp = Date.now() + PREVIEW_TTL_MS;
  const sig = createHmac("sha256", previewSecret())
    .update(`estimate-preview:${estimateId}:${exp}`).digest("hex").slice(0, 32);
  return `${exp}.${sig}`;
}

function previewGrantValid(estimateId: string, grant: string): boolean {
  const secret = previewSecret();
  if (!secret) return false;
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(grant);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac("sha256", secret)
    .update(`estimate-preview:${estimateId}:${exp}`).digest("hex").slice(0, 32);
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the homeowner is allowed to see. Hidden items and all costs are dropped. */
function publicEstimateView(
  est: typeof crmEstimates.$inferSelect,
  items: (typeof crmEstimateItems.$inferSelect)[],
  org: typeof crmOrgs.$inferSelect,
  cust: typeof crmCustomers.$inferSelect,
  division: Awaited<ReturnType<typeof resolveEstimateDivision>> = null,
) {
  // The taxable base the displayed tax was computed on. Hidden items still
  // count (they affect the total); only the item ROWS are dropped below.
  // Exposed so the client page can preview optional discounts live with the
  // same math the server applies on approve (server/crm/discounts.ts).
  let taxable = 0, lineDiscount = 0;
  for (const i of items) {
    const line = Math.round((i.unitPriceCents * i.quantityMilli) / 1000);
    if (i.kind === "discount") { lineDiscount += Math.abs(line); continue; }
    if (i.taxable) taxable += line;
  }
  const taxableBaseCents = Math.max(0, taxable - lineDiscount);
  return {
    estimate: {
      id: est.id, number: est.number, title: est.title, status: est.status,
      introText: est.introText, termsText: est.termsText,
      subtotalCents: est.subtotalCents, discountCents: est.discountCents,
      taxRateBps: est.taxRateBps,
      taxCents: est.taxCents, totalCents: est.totalCents, depositCents: est.depositCents,
      taxableBaseCents,
      approvedTotalCents: est.approvedTotalCents, selectedDiscounts: est.selectedDiscounts,
      expiresAt: est.expiresAt, sentAt: est.sentAt, createdAt: est.createdAt,
      approvedAt: est.approvedAt, declinedAt: est.declinedAt,
      signatureName: est.signatureName,
    },
    items: items
      .filter((i) => !i.hiddenFromClient)
      .map((i) => ({
        id: i.id, kind: i.kind, name: i.name, description: i.description,
        quantityMilli: i.quantityMilli, unit: i.unit,
        unitPriceCents: i.unitPriceCents,
        lineTotalCents: Math.round((i.unitPriceCents * i.quantityMilli) / 1000),
      })),
    company: {
      // The DIVISION's letterhead when the work belongs to one — a Florida
      // estimate never goes out under the WA HQ address.
      ...companyBranding(org, division),
      warrantyText: org.warrantyText,
      // Org-wide T&C render on a separate linked page (?terms=1), HCP-style —
      // never inline on the estimate itself.
      termsAndConditions: org.termsAndConditions,
      // The org's theme accent (server-resolved hex + hsl pair) — the public
      // page sets CSS variables from these verbatim.
      ...themePayload(org.customFields),
    },
    customer: {
      displayName: cust.displayName, email: cust.email, phone: cust.phone,
      // The client's own address — the 'Prepared for' block on the document
      // letterhead. Never anyone else's: this route is session-gated to this
      // exact customer.
      addressLine1: cust.addressLine1, addressLine2: cust.addressLine2,
      city: cust.city, state: cust.state, postalCode: cust.postalCode,
    },
  };
}

export function registerCrmPortalRoutes(app: Express, getDevUser: GetUser): void {
  // ── Send an estimate ──────────────────────────────────────────────────────

  app.post("/api/crm/estimates/:id/send", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageEstimates")) return;

    const parsed = z.object({
      email: z.string().email().optional(),
      message: z.string().max(4000).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid send request", issues: parsed.error.issues });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found" });

    const to = parsed.data.email || cust.email;
    if (!to) return res.status(400).json({ message: "This client has no email address. Add one first." });

    const base = getBaseUrl(req);
    const from = ctx.member.displayName || ctx.org.name;
    // Sending starts the expiry clock (default 7 days). Computed once here so
    // the email and the row agree.
    const sentAt = new Date();
    const expiresAt = estimateExpiryOnSend(sentAt);

    // First-open pass: clicking from the inbox proves inbox possession, so the
    // email's own link signs the recipient straight in (single-use, redeemed by
    // page JS — see /api/client/auth/redeem). Valid as long as the estimate is.
    const pass = randomBytes(32).toString("hex");
    await db.insert(crmClientTokens).values({
      tokenHash: sha256(pass),
      customerIds: [cust.id],
      email: to.toLowerCase(),
      expiresAt,
    });
    const link = `${base}/e/${est.publicToken}?k=${pass}`;
    // The letterhead is the division's when the work belongs to one.
    const branding = companyBranding(ctx.org, await resolveEstimateDivision(est));

    // HCP-format email: contractor logo up top, "Approve Estimate #N" headline,
    // personal note, one big View-estimate button, then the customer-portal
    // link, contact block and a Terms & Conditions hyperlink.
    const logoAbs = branding.logoUrl
      ? (branding.logoUrl.startsWith("http") ? branding.logoUrl : `${base}${branding.logoUrl}`)
      : null;
    const portalUrl = clientPortalBaseUrl(req);
    const termsUrl = `${base}/e/${est.publicToken}?terms=1`;
    const addressLine = branding.addressLine1
      ? `${esc([branding.addressLine1, branding.addressLine2].filter(Boolean).join(", "))}${branding.city ? `<br>${esc(branding.city)}` : ""}${branding.state ? `, ${esc(branding.state)}` : ""}${branding.postalCode ? ` ${esc(branding.postalCode)}` : ""}`
      : "";
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;padding:28px 24px">
        ${logoAbs ? `<p style="text-align:center;margin:0 0 14px"><img src="${logoAbs}" alt="${esc(branding.name)}" style="max-height:64px;max-width:260px"></p>` : ""}
        <h1 style="text-align:center;font-size:26px;margin:6px 0 20px">
          Approve Estimate${est.number ? ` ${esc(est.number)}` : ""} from ${esc(branding.name)}
        </h1>
        <p style="font-size:16px">Hi ${esc(cust.displayName)},</p>
        <p style="font-size:16px">
          Please find estimate${est.number ? ` ${esc(est.number)}` : ""} from ${esc(branding.name)} below.
          Feel free to reach out with any questions or clarification.
        </p>
        ${parsed.data.message ? `<p style="font-size:16px;white-space:pre-wrap">${esc(parsed.data.message)}</p>` : ""}
        <p style="font-size:16px;margin:14px 0 0">Thank you,<br>-${esc(from)}${branding.phone ? `<br><a href="tel:${esc(branding.phone)}" style="color:#2563eb">${esc(branding.phone)}</a>` : ""}</p>
        <p style="text-align:center;margin:30px 0 18px">
          <a href="${link}" style="background:#2563eb;color:#fff;padding:14px 34px;border-radius:24px;
             text-decoration:none;font-weight:600;font-size:16px;display:inline-block">
            View estimate
          </a>
        </p>
        <p style="text-align:center;font-size:14px;margin:0 0 26px">
          <a href="${portalUrl}" style="color:#2563eb;text-decoration:none">View all estimates in your Customer Portal</a>
        </p>
        <p style="text-align:center;font-size:13px;color:#444;margin:0 0 4px">
          ${branding.phone ? `<a href="tel:${esc(branding.phone)}" style="color:#2563eb">${esc(branding.phone)}</a>` : ""}${branding.phone && branding.email ? " | " : ""}${branding.email ? `<a href="mailto:${esc(branding.email)}" style="color:#2563eb">${esc(branding.email)}</a>` : ""}
        </p>
        ${branding.website ? `<p style="text-align:center;font-size:13px;margin:0 0 4px"><a href="${esc(branding.website)}" style="color:#2563eb">${esc(branding.website)}</a></p>` : ""}
        ${addressLine ? `<p style="text-align:center;font-size:13px;color:#444;margin:10px 0 4px">${addressLine}</p>` : ""}
        ${branding.licenseNumber ? `<p style="text-align:center;font-size:12px;color:#666;margin:0 0 4px">License ${esc(branding.licenseNumber)}${branding.licenseState ? ` (${esc(branding.licenseState)})` : ""}</p>` : ""}
        <p style="text-align:center;font-size:14px;margin:14px 0 0">
          <a href="${termsUrl}" style="color:#2563eb">Terms &amp; Conditions</a>
        </p>
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
        <p style="font-size:12px;color:#666">
          Only you can open the estimate link — it verifies ${esc(to)}. If it's forwarded to
          anyone else, they can't get in without access to your inbox.
          This estimate expires on ${expiresAt.toDateString()}.
        </p>
        <p style="font-size:12px;color:#999;word-break:break-all">If the button doesn't work, paste this into your browser: ${link}</p>
      </div>`;

    let emailed = false;
    let emailError: string | null = null;
    try {
      await sendWithFallback({
        to,
        subject: `Estimate from ${branding.name}${est.number ? ` — ${est.number}` : ""}`,
        html,
        replyTo: ctx.member.email || (await senderReplyTo(est.createdByMemberId, branding.email)),
      } as any);
      emailed = true;
    } catch (e: any) {
      emailError = String(e?.message || e).slice(0, 300);
      console.error("[crm] estimate send failed:", emailError);
    }

    // Mark it sent even if SMTP failed — the link is live and copyable, so the
    // work is not lost. `emailed:false` tells the UI to offer the link instead.
    const [row] = await db.update(crmEstimates).set({
      status: est.status === "draft" ? "sent" : est.status,
      sentAt, expiresAt, sentToEmail: to, updatedAt: new Date(),
    }).where(eq(crmEstimates.id, est.id)).returning();

    await logEvent(ctx.org.id, est.id, "sent", ctx.member.id, req, { to, emailed, emailError });

    if (est.projectId) {
      await db.update(crmProjects)
        .set({ status: "proposal_sent", stageChangedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, est.projectId)))
        .catch(() => {});
    }

    res.json({ estimate: presentEstimate(row, ctx), link, emailed, emailError });
  });

  // ── Public: the client's estimate page ────────────────────────────────────
  // Email-gated: the URL token identifies the estimate; a client session (or a
  // contractor preview grant) authorises it. Viewing records first/last open +
  // a count — never for previews.

  app.get("/api/public/estimates/:token", async (req: any, res) => {
    const t = String(req.params.token || "");
    if (t.length < 24) return res.status(404).json({ message: "Not found" });

    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
    if (!est) return res.status(404).json({ message: "This estimate link is no longer valid." });

    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (!org || !cust) return res.status(404).json({ message: "Not found" });
    const division = await resolveEstimateDivision(est);
    const branding = companyBranding(org, division);

    // THE GATE — ahead of everything, expiry included. A contractor preview
    // grant bypasses it (read-only, untracked); everyone else needs a client
    // session covering this estimate's customer.
    const preview = previewGrantValid(est.id, String(req.query?.preview || ""));
    if (!preview && !(await requireDocSession(req, res, est.customerId))) return;

    // Expired and never answered: 410 BEFORE any document content is loaded.
    // The body carries only what the contact page needs — org name + public
    // contact details — never line items or totals. Approved/declined
    // estimates stay viewable (they're settled, and approval unlocks payment).
    if (est.expiresAt && est.expiresAt.getTime() < Date.now() && !est.approvedAt && !est.declinedAt) {
      return res.status(410).json({
        message: "This estimate has expired.",
        expired: true,
        expiredAt: est.expiresAt,
        company: { name: branding.name, email: branding.email, phone: branding.phone },
      });
    }

    const items = await db.select().from(crmEstimateItems)
      .where(eq(crmEstimateItems.estimateId, est.id)).orderBy(asc(crmEstimateItems.sortOrder));
    // Good/better/best. showTotal defaults false: Leap leaked pricing by
    // displaying tier totals, which scared clients off before they read the scope.
    const options = await db.select().from(crmEstimateOptions)
      .where(eq(crmEstimateOptions.estimateId, est.id)).orderBy(asc(crmEstimateOptions.tier));

    // Open tracking — the "you can see it was opened" feature. Only counted
    // once the estimate has actually been sent, so internal preview clicks
    // don't create a false "client viewed it" — and a preview-grant open is
    // the contractor by definition, so it skips this entirely.
    let current = est;
    if (!preview && est.sentAt && !est.approvedAt && !est.declinedAt) {
      // Dedupe: count at most one view per IP per window. lastViewedAt still
      // moves on every open (a visit really happened); viewCount and the
      // events trail only move when this looks like a genuinely new view.
      const ip = clientIp(req);
      let countView = true;
      if (ip && est.firstViewedAt) {
        const recent = await db.select({ id: crmEstimateEvents.id }).from(crmEstimateEvents)
          .where(and(
            eq(crmEstimateEvents.estimateId, est.id),
            eq(crmEstimateEvents.type, "viewed"),
            eq(crmEstimateEvents.ip, ip),
            sql`${crmEstimateEvents.createdAt} >= now() - make_interval(mins => ${VIEW_DEDUPE_MIN})`,
          )).limit(1);
        countView = recent.length === 0;
      }
      const first = est.firstViewedAt ?? new Date();
      const [updated] = await db.update(crmEstimates).set({
        firstViewedAt: first,
        lastViewedAt: new Date(),
        viewCount: (est.viewCount ?? 0) + (countView ? 1 : 0),
        status: est.status === "sent" ? "viewed" : est.status,
      }).where(eq(crmEstimates.id, est.id)).returning();
      current = updated ?? est;
      if (countView) {
        if (!est.firstViewedAt) {
          await logEvent(est.orgId, est.id, "viewed", "client", req, { firstView: true });
          // Tell the sender the moment it's first opened.
          notifyOwner(est.orgId, est, cust, org, "opened").catch(() => {});
        } else {
          await logEvent(est.orgId, est.id, "viewed", "client", req, { firstView: false });
          // A deduped REPEAT open: the client came back to their bid — fire the
          // once-per-day "call them" alert (no-op when already alerted today).
          maybeAlertReengagement({ est, org, cust, req })
            .catch((e: any) => console.error("[crm] reengagement alert failed:", e?.message || e));
        }
      }
    }
    if (!preview) {
      await db.update(crmCustomers).set({ portalLastSeenAt: new Date() })
        .where(eq(crmCustomers.id, cust.id)).catch(() => {});
    }

    // Server-side paid flag — the client must never infer "paid" from the
    // ?paid=1 redirect parameter alone.
    const settledPayments = await db.select({ id: crmPayments.id }).from(crmPayments)
      .where(and(eq(crmPayments.estimateId, est.id), eq(crmPayments.status, "succeeded"))).limit(1);

    const view = publicEstimateView(current, items, org, cust, division);
    // Optional discount offers the client may tick (enabled ones only). The
    // client page previews with them; the approve route re-computes from the
    // server's own rows, so these are presentation, never input.
    const discountOffers = await db.select().from(crmEstimateDiscounts)
      .where(and(
        eq(crmEstimateDiscounts.orgId, est.orgId),
        eq(crmEstimateDiscounts.estimateId, est.id),
        eq(crmEstimateDiscounts.enabled, true),
      ))
      .orderBy(asc(crmEstimateDiscounts.sortOrder), asc(crmEstimateDiscounts.createdAt));
    res.json({
      ...view,
      preview: preview || undefined, // read-only: the page hides approve/pay
      estimate: { ...view.estimate, paid: settledPayments.length > 0 },
      discountOffers: discountOffers.map((o) => ({
        id: o.id, code: o.code, label: o.label,
        percentBps: o.percentBps, conditions: o.conditions,
      })),
      options: options.map((o) => ({
        id: o.id, name: o.name, tier: o.tier, description: o.description,
        recommended: o.recommended,
        totalCents: o.showTotal ? o.totalCents : undefined,
        selectedAt: o.selectedAt,
      })),
    });
  });

  /** Client approves or declines. Gated like the read: approving IS signing,
   *  so a forwarded link alone must never be enough — and a preview grant
   *  deliberately does NOT work here (read-only). */
  app.post("/api/public/estimates/:token/respond", async (req: any, res) => {
    const t = String(req.params.token || "");
    const parsed = z.object({
      decision: z.enum(["approve", "decline"]),
      signatureName: z.string().min(2).max(120).optional(),
      reason: z.string().max(2000).optional(),
      // Optional discount offer ids the client ticked. Ids only — percentages
      // and totals are re-derived from the server's own rows below.
      selectedDiscounts: z.array(z.string().max(64)).max(20).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid response", issues: parsed.error.issues });

    const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
    if (!est) return res.status(404).json({ message: "This estimate link is no longer valid." });
    if (!(await requireDocSession(req, res, est.customerId))) return;
    if (est.approvedAt || est.declinedAt) {
      return res.status(409).json({ message: "This estimate has already been responded to." });
    }
    if (est.expiresAt && est.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "This estimate has expired. Please contact us for an updated quote." });
    }
    if (parsed.data.decision === "approve" && !parsed.data.signatureName) {
      return res.status(400).json({ message: "Please type your name to approve." });
    }

    const approve = parsed.data.decision === "approve";

    // Optional client-selected discounts: the total is RE-COMPUTED here from
    // the line items and the server's own enabled offers — the client's
    // preview total is never trusted (integer cents; the math is documented
    // in server/crm/discounts.ts). Declines never touch the numbers.
    const approval = approve
      ? await recomputeApprovalTotals(est.orgId, est.id, est.taxRateBps ?? 0, parsed.data.selectedDiscounts ?? [])
      : null;

    const [row] = await db.update(crmEstimates).set({
      status: approve ? "approved" : "declined",
      approvedAt: approve ? new Date() : null,
      declinedAt: approve ? null : new Date(),
      declineReason: approve ? null : (parsed.data.reason ?? null),
      signatureName: approve ? parsed.data.signatureName ?? null : null,
      signatureIp: approve ? clientIp(req) : null,
      ...(approval
        ? { approvedTotalCents: approval.totals.totalCents, selectedDiscounts: approval.selections }
        : {}),
      updatedAt: new Date(),
    }).where(eq(crmEstimates.id, est.id)).returning();

    await logEvent(est.orgId, est.id, approve ? "approved" : "declined", "client", req, {
      signatureName: parsed.data.signatureName, reason: parsed.data.reason,
      ...(approval && approval.selections.length
        ? { selectedDiscounts: approval.selections.map((s) => s.code), approvedTotalCents: approval.totals.totalCents }
        : {}),
    });

    // Approving advances the project — Leap's "Job Awarded" gate. The contract
    // value is the APPROVED total (after any selected optional discounts).
    if (est.projectId) {
      await db.update(crmProjects).set({
        status: approve ? "approved" : "estimating",
        contractValueCents: approve ? (approval?.totals.totalCents ?? est.totalCents) : undefined,
        stageChangedAt: new Date(), updatedAt: new Date(),
      } as any).where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).catch(() => {});
    }

    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (org && cust) {
      notifyOwner(est.orgId, row, cust, org, approve ? "approved" : "declined", parsed.data.reason).catch(() => {});
      // The PM's "job awarded" heads-up — separate from the owner's copy,
      // gated by its own notificationPref (jobApproved, default ON).
      if (approve) notifyJobApproved(req, est, row, cust, org).catch(() => {});
      // Approval mints the signed contract: PDF built, stored (kind='contract'),
      // emailed to client AND admin, listed in the client portal. Fire-and-
      // forget — a generation/delivery failure must NEVER break the approval.
      if (approve) void deliverSignedContract(req, row, cust, org).catch((e: any) =>
        console.error("[crm] contract delivery failed:", String(e?.message || e).slice(0, 300)));
    }

    res.json({ ok: true, status: row.status });
  });

  // ── Email verification challenge ──────────────────────────────────────────
  // The gate's other half. ALWAYS 200 { sent: true } — matching or not,
  // mailing or not, must be indistinguishable (the same anti-enumeration rule
  // as the client portal's request-link). Rate buckets key on the IP, the
  // document token, and the REQUESTED address — all known to the requester
  // either way, so a 429 can't oracle the match. Only a match against the
  // customer's email (or the address the document was actually sent to)
  // mints a magic link, scoped to JUST that customer, landing back on the
  // document itself.
  // Per-IP is the loosest bucket (real households/offices NAT behind one
  // address) — the per-token and per-email buckets are the actual guards.
  const VA_IP_LIMIT = 60;
  const VA_TOKEN_LIMIT = 10;
  const VA_EMAIL_LIMIT = 5;

  app.post("/api/public/verify-access", async (req: any, res) => {
    const parsed = z.object({
      docType: z.enum(["estimate", "invoice"]),
      token: z.string().min(24).max(120),
      email: z.string().email().max(320),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid email address" });
    const { docType, token: t } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();

    if (!rateAllow(`va-ip:${clientIp(req)}`, VA_IP_LIMIT)
      || !rateAllow(`va-tok:${t}`, VA_TOKEN_LIMIT)
      || !rateAllow(`va-em:${email}`, VA_EMAIL_LIMIT)) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }

    let cust: typeof crmCustomers.$inferSelect | undefined;
    let org: typeof crmOrgs.$inferSelect | undefined;
    let sentTo: string | null = null;
    let docLabel = "a document";
    let nextPath = "";
    if (docType === "estimate") {
      const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
      if (est) {
        [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
        [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, est.orgId)).limit(1);
        sentTo = est.sentToEmail;
        docLabel = est.number ? `estimate ${est.number}` : "an estimate";
        nextPath = `/e/${t}`;
      }
    } else {
      const [inv] = await db.select().from(crmInvoices).where(eq(crmInvoices.publicToken, t)).limit(1);
      if (inv) {
        [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
        [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, inv.orgId)).limit(1);
        sentTo = inv.sentToEmail;
        docLabel = inv.number ? `invoice ${inv.number}` : "an invoice";
        nextPath = `/i/${t}`;
      }
    }

    // Case-insensitive match against the customer record OR the send-time
    // override address (the email that actually received the quote).
    const matches = Boolean(cust && org) && (
      (cust!.email ?? "").toLowerCase() === email || (sentTo ?? "").toLowerCase() === email
    );

    if (matches) {
      const raw = randomBytes(32).toString("hex");
      await db.insert(crmClientTokens).values({
        tokenHash: sha256(raw),
        customerIds: [cust!.id],
        email,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
      const link = `${getBaseUrl(req)}/api/client/auth/verify?token=${raw}&next=${encodeURIComponent(nextPath)}`;
      try {
        await sendWithFallback({
          to: email,
          subject: `${org!.name} shared a document with you — open it securely`,
          html: `
            <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px">
              <p style="font-size:16px">Hi ${esc(cust!.displayName)},</p>
              <p style="font-size:16px"><strong>${esc(org!.name)}</strong> shared ${esc(docLabel)} with you.
                 Use the secure link below to open it — it confirms this email address and takes you
                 straight to the document.</p>
              <p style="margin:28px 0">
                <a href="${link}" style="background:#4f46e5;color:#fff;padding:13px 24px;border-radius:6px;
                   text-decoration:none;font-weight:600;font-size:16px;display:inline-block">Open your document securely</a>
              </p>
              <p style="font-size:13px;color:#666">This link expires in 30 minutes and can only be used once.
                 If you weren't expecting it, you can ignore this email.</p>
            </div>`,
        } as any);
      } catch (e: any) {
        // The response must not change when mail fails — same { sent: true }
        // either way, so SMTP behaviour is never an enumeration oracle.
        console.error("[crm] verify-access email failed:", String(e?.message || e).slice(0, 300));
      }
    }

    res.json({ sent: true });
  });

  /** Contractor preview: mint a 15-minute read-only grant for the client
   *  page. The CRM opens THIS instead of the raw public URL, which is gated
   *  behind the client's email now. Preview opens never count as views or
   *  engagement, and the grant cannot approve, decline or pay. */
  app.post("/api/crm/estimates/:id/preview-link", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageEstimates")) return;
    if (!previewSecret()) return res.status(503).json({ message: "Preview is not configured on this server." });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    res.json({
      url: `${getBaseUrl(req)}/e/${est.publicToken}?preview=${mintPreviewGrant(est.id)}`,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    });
  });

  // ── Engagement tracking: how long the client actually spent ───────────────
  // Token-authorised like the document pages themselves. A session opens on
  // page load and heartbeats every 15s while the tab is visible; duration is
  // accumulated here (never client-reported) with each gap capped, so an
  // idle background tab cannot inflate "time spent".

  app.post("/api/public/engagement/start", async (req: any, res) => {
    const parsed = z.object({
      docType: z.enum(["estimate", "invoice"]),
      token: z.string().min(24).max(120),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid engagement start" });
    const { docType, token: t } = parsed.data;

    // Only track live documents — an unsent draft opened as an internal
    // preview is the contractor, not client behaviour. Mirrors the conditions
    // under which view tracking counts. The document gate applies too: a
    // browser that couldn't open the document (no client session covering its
    // customer) gets a silent no-op, not a tracking row.
    const ids = await resolveClientCustomerIds(req);
    let orgId: string, docId: string;
    let estRow: typeof crmEstimates.$inferSelect | null = null;
    if (docType === "estimate") {
      const [est] = await db.select().from(crmEstimates).where(eq(crmEstimates.publicToken, t)).limit(1);
      if (!est) return res.status(404).json({ message: "Not found" });
      if (!est.sentAt || est.approvedAt || est.declinedAt) return res.json({ sessionId: null });
      if (!ids.includes(est.customerId)) return res.json({ sessionId: null });
      orgId = est.orgId; docId = est.id; estRow = est;
    } else {
      const [inv] = await db.select().from(crmInvoices).where(eq(crmInvoices.publicToken, t)).limit(1);
      if (!inv) return res.status(404).json({ message: "Not found" });
      if (!inv.sentAt || inv.paidAt || inv.voidedAt) return res.json({ sessionId: null });
      if (!ids.includes(inv.customerId)) return res.json({ sessionId: null });
      orgId = inv.orgId; docId = inv.id;
    }

    // Timestamps are written from JS, not DB defaults: node-pg and the DB's
    // timezone setting disagree on `timestamp without tz` columns, and mixing
    // the two write paths skews the first ping's gap by hours.
    // A 2nd+ distinct session on an estimate is a REPEAT visit — counted
    // before the insert below so the client's very first session never alerts.
    const priorSessions = estRow ? await priorEstimateSessionCount(estRow.id) : 0;
    const now = new Date();
    const [row] = await db.insert(crmEngagementSessions).values({
      orgId, docType, docId,
      startedAt: now, lastPingAt: now,
      ip: clientIp(req) || null,
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300) || null,
    } as any).returning();

    // Repeat session on an already-viewed estimate → the once-per-day
    // "client is reviewing their bid — call them" alert (fire-and-forget;
    // a failed alert must never break engagement tracking).
    if (estRow && priorSessions >= 1 && estRow.firstViewedAt) {
      (async () => {
        const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, estRow!.orgId)).limit(1);
        const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, estRow!.customerId)).limit(1);
        if (org && cust) await maybeAlertReengagement({ est: estRow!, org, cust, req });
      })().catch((e: any) => console.error("[crm] reengagement alert failed:", e?.message || e));
    }
    res.json({ sessionId: row.id });
  });

  app.post("/api/public/engagement/ping", async (req: any, res) => {
    const parsed = z.object({ sessionId: z.string().min(8).max(64) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid ping" });

    const [sess] = await db.select().from(crmEngagementSessions)
      .where(eq(crmEngagementSessions.id, parsed.data.sessionId)).limit(1);
    if (!sess) return res.status(404).json({ message: "Not found" });

    const now = new Date();
    const inc = engagementIncrement(sess.lastPingAt, now);
    const [row] = await db.update(crmEngagementSessions).set({
      lastPingAt: now,
      durationSecs: (sess.durationSecs ?? 0) + inc,
    }).where(eq(crmEngagementSessions.id, sess.id)).returning();
    res.json({ ok: true, durationSecs: row?.durationSecs ?? sess.durationSecs });
  });

  /** Contractor-side read: per-estimate engagement summary. Org-scoped; IPs
   *  are redacted to their /24 before leaving the server. */
  app.get("/api/crm/estimates/:id/engagement", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    const [est] = await db.select({ id: crmEstimates.id }).from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    const sessions = await db.select().from(crmEngagementSessions)
      .where(and(
        eq(crmEngagementSessions.orgId, ctx.org.id),
        eq(crmEngagementSessions.docType, "estimate"),
        eq(crmEngagementSessions.docId, est.id),
      ))
      .orderBy(desc(crmEngagementSessions.startedAt)).limit(100);

    res.json({
      visits: sessions.length,
      totalSecs: sessions.reduce((s, x) => s + (x.durationSecs ?? 0), 0),
      lastVisitAt: sessions[0]?.startedAt ?? null,
      sessions: sessions.map((s) => ({
        startedAt: s.startedAt,
        durationSecs: s.durationSecs,
        ip: redactIpPrefix(s.ip),
        userAgent: s.userAgent,
      })),
    });
  });

  /** Push the expiry date out — e.g. the client asked for the weekend to
   *  decide. Only while the estimate is still unanswered. */
  app.post("/api/crm/estimates/:id/extend", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageEstimates")) return;

    const parsed = z.object({
      days: z.number().int().min(1).max(365).default(ESTIMATE_EXPIRY_DAYS),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid extend request", issues: parsed.error.issues });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.approvedAt) return res.status(409).json({ message: "This estimate has been approved — expiry no longer applies." });
    if (est.declinedAt) return res.status(409).json({ message: "This estimate has been declined." });

    const expiresAt = estimateExpiryOnSend(new Date(), parsed.data.days);
    const [row] = await db.update(crmEstimates).set({ expiresAt, updatedAt: new Date() })
      .where(eq(crmEstimates.id, est.id)).returning();
    await logEvent(ctx.org.id, est.id, "extended", ctx.member.id, req, { days: parsed.data.days, expiresAt });
    res.json({ estimate: presentEstimate(row, ctx) });
  });

  /** The client's own portal: everything of theirs, by their customer token. */
  app.get("/api/public/portal/:token", async (req: any, res) => {
    const t = String(req.params.token || "");
    if (t.length < 24) return res.status(404).json({ message: "Not found" });
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.portalToken, t)).limit(1);
    if (!cust) return res.status(404).json({ message: "This portal link is no longer valid." });
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, cust.orgId)).limit(1);
    if (!org) return res.status(404).json({ message: "Not found" });

    const estimates = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.customerId, cust.id), sql`${crmEstimates.sentAt} is not null`))
      .orderBy(desc(crmEstimates.createdAt));
    const invoices = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.customerId, cust.id), sql`${crmInvoices.sentAt} is not null`,
        isNull(crmInvoices.voidedAt)))
      .orderBy(desc(crmInvoices.createdAt));
    const projects = await db.select().from(crmProjects)
      .where(eq(crmProjects.customerId, cust.id)).orderBy(desc(crmProjects.createdAt));

    await db.update(crmCustomers).set({ portalLastSeenAt: new Date() })
      .where(eq(crmCustomers.id, cust.id)).catch(() => {});

    res.json({
      customer: { displayName: cust.displayName, email: cust.email, phone: cust.phone },
      company: {
        name: org.name, phone: org.phone, email: org.email,
        website: org.website, logoUrl: org.logoUrl,
      },
      estimates: estimates.map((e) => ({
        id: e.id, number: e.number, title: e.title, status: e.status,
        totalCents: e.totalCents, sentAt: e.sentAt, approvedAt: e.approvedAt,
        declinedAt: e.declinedAt, expiresAt: e.expiresAt,
        link: `/e/${e.publicToken}`,
      })),
      invoices: invoices.map((i) => ({
        id: i.id, number: i.number, title: i.title, status: i.status,
        totalCents: i.totalCents,
        dueCents: Math.max(0, i.totalCents - (i.retainageCents ?? 0) - (i.paidCents ?? 0)),
        dueAt: i.dueAt, paidAt: i.paidAt, sentAt: i.sentAt,
        link: `/i/${i.publicToken}`,
      })),
      projects: projects.map((p) => ({
        id: p.id, number: p.number, name: p.name, status: p.status,
        stageLabel: CRM_PROJECT_STAGE_META[p.status]?.label ?? p.status,
        startDate: p.startDate, targetEndDate: p.targetEndDate,
      })),
    });
  });

  // SMS: status/test-send for Settings + the estimate reminder route.
  registerCrmSmsRoutes(app, getDevUser);
}

/** Email the org owner (and the estimate's author) when the client acts. */
async function notifyOwner(
  orgId: string,
  est: typeof crmEstimates.$inferSelect,
  cust: typeof crmCustomers.$inferSelect,
  org: typeof crmOrgs.$inferSelect,
  event: "opened" | "approved" | "declined",
  reason?: string,
) {
  // The org can silence each notification type in Settings (default: on).
  const pref =
    event === "opened" ? "estimateViewed" : event === "approved" ? "estimateApproved" : "estimateDeclined";
  if (!crmNotificationEnabled(org.customFields, pref)) return;

  const recipients = new Set<string>();
  if (org.email) recipients.add(org.email);
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  for (const m of members) {
    if (m.id === est.createdByMemberId && m.email) recipients.add(m.email);
    if (m.role === "owner" && m.email) recipients.add(m.email);
  }
  if (!recipients.size) return;

  const subject =
    event === "approved" ? `✅ ${cust.displayName} approved estimate ${est.number ?? ""}`.trim()
    : event === "declined" ? `❌ ${cust.displayName} declined estimate ${est.number ?? ""}`.trim()
    : `👀 ${cust.displayName} opened estimate ${est.number ?? ""}`.trim();

  const body =
    event === "approved"
      ? `<p><strong>${esc(cust.displayName)}</strong> approved estimate ${esc(est.number ?? "")} for <strong>${money(est.approvedTotalCents ?? est.totalCents)}</strong>.</p>
         <p>Signed as: ${esc(est.signatureName)}</p>`
      : event === "declined"
      ? `<p><strong>${esc(cust.displayName)}</strong> declined estimate ${esc(est.number ?? "")}.</p>
         ${reason ? `<p>Reason: ${esc(reason)}</p>` : ""}`
      : `<p><strong>${esc(cust.displayName)}</strong> just opened estimate ${esc(est.number ?? "")} (${money(est.totalCents)}) for the first time.</p>`;

  await sendWithFallback({
    to: [...recipients].join(","),
    subject,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${body}</div>`,
  } as any).catch((e: any) => console.error("[crm] owner notify failed:", e?.message || e));
}

// ── PM auto-email on approval ───────────────────────────────────────────────

/**
 * Who gets the "job awarded" email (pure — unit-tested in discounts.test.ts).
 * TO: the admin member(s) of the project's division; when the project has no
 * division (or it has no admins), the org owner(s). CC: the estimate's
 * creator — the estimator who wrote the quote — unless they're already a TO.
 */
export function jobApprovedRecipients(args: {
  members: { id: string; email: string | null; role: string; status: string; divisionId: string | null }[];
  divisionId: string | null;
  creatorMemberId: string | null;
}): { to: string[]; cc: string[] } {
  const active = args.members.filter((m) => m.status === "active" && m.email);
  let to: string[] = [];
  if (args.divisionId) {
    to = active
      .filter((m) => m.role === "admin" && m.divisionId === args.divisionId)
      .map((m) => m.email!);
  }
  if (!to.length) {
    to = active.filter((m) => m.role === "owner").map((m) => m.email!);
  }
  to = [...new Set(to)];
  const creator = active.find((m) => m.id === args.creatorMemberId);
  const cc = creator?.email && !to.includes(creator.email) ? [creator.email] : [];
  return { to, cc };
}

/**
 * Email the PM on file when the client signs: division admins of the
 * project's division (fallback: org owner), CC the estimator. Gated by the
 * org's jobApproved notificationPref (default ON). Content: customer,
 * estimate #, total, division, and a link to the project.
 */
async function notifyJobApproved(
  req: any,
  est: typeof crmEstimates.$inferSelect,
  row: typeof crmEstimates.$inferSelect,
  cust: typeof crmCustomers.$inferSelect,
  org: typeof crmOrgs.$inferSelect,
) {
  if (!crmNotificationEnabled(org.customFields, "jobApproved")) return;

  let divisionId: string | null = null;
  let divisionName: string | null = null;
  if (est.projectId) {
    const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    divisionId = p?.divisionId ?? null;
    const div = await getDivision(est.orgId, divisionId);
    divisionName = div?.name ?? null;
  }

  const members = await db.select().from(crmMembers)
    .where(eq(crmMembers.orgId, est.orgId));
  const { to, cc } = jobApprovedRecipients({
    members, divisionId, creatorMemberId: est.createdByMemberId,
  });
  const toList = to.length ? to : cc;
  const ccList = to.length ? cc : [];
  if (!toList.length) return;

  const total = row.approvedTotalCents ?? row.totalCents;
  // The approving request is the CLIENT's (public /e page — its Host may be
  // the client portal or the apex), but this link is for the contractor's CRM.
  const projectLink = est.projectId ? `${portalBaseUrl(req)}/crm/projects/${est.projectId}` : null;
  await sendWithFallback({
    to: toList.join(","),
    ...(ccList.length ? { cc: ccList.join(",") } : {}),
    subject: `Job approved — ${cust.displayName} signed estimate ${est.number ?? ""}`.trim(),
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
        <p style="font-size:16px"><strong>${esc(cust.displayName)}</strong> approved estimate
          <strong>${esc(est.number ?? "")}</strong> for
          <strong>${money(total)}</strong>${divisionName ? ` (${esc(divisionName)})` : ""}.</p>
        <p style="font-size:14px;color:#444">Signed as: ${esc(row.signatureName)}. The job is awarded —
          scheduling can begin.</p>
        ${projectLink ? `<p style="margin:20px 0">
          <a href="${projectLink}" style="background:#4f46e5;color:#fff;padding:11px 20px;border-radius:6px;
             text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Open the project</a>
        </p>` : ""}
      </div>`,
  } as any).catch((e: any) => console.error("[crm] job-approved notify failed:", e?.message || e));
}

// ── Signed-contract delivery ────────────────────────────────────────────────

/**
 * Approval mints the contract: build the PDF, store it as a kind='contract'
 * attachment (reachable through the same gated download routes as every other
 * file), and email it to the client AND the company admin. The CLIENT copy
 * always sends — they asked for it by signing; the admin copy honors the
 * org's 'contractSigned' notificationPref (default ON). NOTE: the pref key is
 * not yet in the shared CRM_NOTIFICATION_PREFS list because shared/schema.ts
 * belongs to a parallel workstream — crmNotificationEnabled treats an absent
 * key as ON either way, and the cast keeps tsc honest about that.
 *
 * Runs fire-and-forget from the approve route — nothing here may break the
 * approval; the caller logs and swallows every failure.
 */
async function deliverSignedContract(
  req: any,
  est: typeof crmEstimates.$inferSelect, // the APPROVED row
  cust: typeof crmCustomers.$inferSelect,
  org: typeof crmOrgs.$inferSelect,
) {
  const [items, options, division, members] = await Promise.all([
    db.select().from(crmEstimateItems)
      .where(eq(crmEstimateItems.estimateId, est.id)).orderBy(asc(crmEstimateItems.sortOrder)),
    db.select().from(crmEstimateOptions)
      .where(eq(crmEstimateOptions.estimateId, est.id)).orderBy(asc(crmEstimateOptions.tier)),
    resolveEstimateDivision(est),
    db.select().from(crmMembers)
      .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active"))),
  ]);
  const branding = companyBranding(org, division);

  const pdf = await buildContractPdf({
    branding,
    // The org's theme accent — the letterhead name prints in it (orange when
    // the org never picked one).
    accentHex: resolveOrgTheme(org.customFields).hex,
    orgName: org.name,
    customer: cust,
    estimate: est,
    items: items
      .filter((i) => !i.hiddenFromClient) // internal-only lines never leave the building
      .map((i) => ({
        name: i.name, description: i.description, quantityMilli: i.quantityMilli,
        unit: i.unit, unitPriceCents: i.unitPriceCents,
        lineTotalCents: Math.round((i.unitPriceCents * i.quantityMilli) / 1000),
      })),
    options: options.map((o) => ({
      name: o.name, description: o.description, recommended: o.recommended,
      totalCents: o.showTotal ? o.totalCents : null,
    })),
    terms: org.termsAndConditions,
  });
  const fileName = contractFileName(est.number);
  const att = await storeGeneratedPdf({
    orgId: org.id, kind: "contract", refId: est.id, fileName, buffer: pdf,
  });

  const total = est.approvedTotalCents ?? est.totalCents;
  const adminTo = contractAdminRecipients({
    prefEnabled: crmNotificationEnabled(org.customFields, "contractSigned" as CrmNotificationPref),
    members, orgEmail: org.email,
  });
  const clientTo = cust.email ? [cust.email] : [];

  // Record the attempt BEFORE sending — the events trail is the durable proof
  // of who the contract went to; SMTP delivery itself is best-effort.
  await logEvent(org.id, est.id, "contract_emailed", "system", req, {
    attachmentId: att.id, fileName, totalCents: total,
    clientTo, adminTo, adminSkipped: adminTo.length === 0,
  });

  const subject = `${branding.name} — your signed contract ${est.number ?? ""}`.trim();
  const html = (forAdmin: boolean) => `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
      <p style="font-size:16px">${forAdmin ? `<strong>${esc(cust.displayName)}</strong> signed` : "Thank you — you signed"}
        estimate <strong>${esc(est.number ?? "")}</strong> for <strong>${money(total)}</strong>.</p>
      <p style="font-size:14px;color:#444">The signed contract is attached as a PDF${forAdmin ? "" : " — keep it for your records"}.
        Signed as: ${esc(est.signatureName)}.</p>
      <p style="font-size:13px;color:#666">${esc(branding.name)}${branding.phone ? ` &middot; ${esc(branding.phone)}` : ""}${branding.website ? ` &middot; ${esc(branding.website)}` : ""}</p>
    </div>`;
  const mail = {
    subject,
    attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
  };

  if (clientTo.length) {
    await sendWithFallback({ ...mail, to: clientTo.join(","), html: html(false), replyTo: await senderReplyTo(est.createdByMemberId, branding.email) } as any)
      .catch((e: any) => console.error("[crm] contract email (client) failed:", String(e?.message || e).slice(0, 300)));
  }
  if (adminTo.length) {
    await sendWithFallback({ ...mail, to: adminTo.join(","), html: html(true) } as any)
      .catch((e: any) => console.error("[crm] contract email (admin) failed:", String(e?.message || e).slice(0, 300)));
  }
}

// ── Invoices: send, public view with open tracking, and pay ─────────────────
// Mirrors the estimate flow deliberately: same token pattern, same tracking,
// same "email failed but the link still works" behaviour.
export function registerCrmInvoicePortalRoutes(app: Express, getDevUser: GetUser): void {
  app.post("/api/crm/invoices/:id/send", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageInvoices")) return;

    const parsed = z.object({
      email: z.string().email().optional(),
      message: z.string().max(4000).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid send request" });

    const [inv] = await db.select().from(crmInvoices)
      .where(and(eq(crmInvoices.orgId, ctx.org.id), eq(crmInvoices.id, req.params.id))).limit(1);
    if (!inv) return res.status(404).json({ message: "Invoice not found" });
    if (inv.voidedAt) return res.status(409).json({ message: "This invoice has been voided." });
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found" });
    const to = parsed.data.email || cust.email;
    if (!to) return res.status(400).json({ message: "This client has no email address. Add one first." });

    const link = `${getBaseUrl(req)}/i/${inv.publicToken}`;
    const from = ctx.member.displayName || ctx.org.name;
    const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
    const branding = companyBranding(ctx.org, await resolveInvoiceDivision(inv));

    let emailed = false, emailError: string | null = null;
    try {
      await sendWithFallback({
        to,
        subject: `Invoice from ${branding.name}${inv.number ? ` — ${inv.number}` : ""}`,
        html: `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px">
            <p style="font-size:16px">Hi ${esc(cust.displayName)},</p>
            <p style="font-size:16px">${esc(from)} at <strong>${esc(branding.name)}</strong> has sent you
              invoice ${esc(inv.number ?? "")}.</p>
            ${parsed.data.message ? `<p style="font-size:16px;white-space:pre-wrap">${esc(parsed.data.message)}</p>` : ""}
            <p style="font-size:22px;margin:18px 0"><strong>${money(due)}</strong> due</p>
            ${inv.retainageCents ? `<p style="font-size:13px;color:#666">${money(inv.retainageCents)} retainage is withheld until closeout.</p>` : ""}
            <p style="margin:28px 0">
              <a href="${link}" style="background:#4f46e5;color:#fff;padding:13px 24px;border-radius:6px;
                 text-decoration:none;font-weight:600;font-size:16px;display:inline-block">View &amp; pay invoice</a>
            </p>
            <p style="font-size:13px;color:#666">Or paste this in your browser:<br>
              <span style="word-break:break-all">${link}</span></p>
            <p style="font-size:13px;color:#666">Only you can open this link — it verifies ${esc(to)}.
              If it's forwarded to anyone else, they can't get in without access to your inbox.</p>
            <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
            <p style="font-size:13px;color:#666">
              ${esc(branding.name)}${branding.phone ? ` &middot; ${esc(branding.phone)}` : ""}
              ${branding.addressLine1 ? `<br>${esc([branding.addressLine1, branding.addressLine2].filter(Boolean).join(", "))}${branding.city ? `, ${esc(branding.city)}` : ""}${branding.state ? `, ${esc(branding.state)}` : ""}${branding.postalCode ? ` ${esc(branding.postalCode)}` : ""}` : ""}
              ${branding.licenseNumber ? `<br>License ${esc(branding.licenseNumber)}${branding.licenseState ? ` (${esc(branding.licenseState)})` : ""}` : ""}
            </p>
          </div>`,
        replyTo: ctx.member.email || branding.email || undefined,
      } as any);
      emailed = true;
    } catch (e: any) {
      emailError = String(e?.message || e).slice(0, 300);
      console.error("[crm] invoice send failed:", emailError);
    }

    const [row] = await db.update(crmInvoices).set({
      status: inv.status === "draft" ? "sent" : inv.status,
      sentAt: new Date(), sentToEmail: to, updatedAt: new Date(),
    }).where(eq(crmInvoices.id, inv.id)).returning();
    await emitCrmEvent(ctx.org.id, "invoice.sent", { invoiceId: inv.id, to });
    res.json({ invoice: row, link, emailed, emailError });
  });

  /** Public invoice — email-gated like the estimate. Records opens. */
  app.get("/api/public/invoices/:token", async (req: any, res) => {
    const t = String(req.params.token || "");
    if (t.length < 24) return res.status(404).json({ message: "Not found" });
    const [inv] = await db.select().from(crmInvoices).where(eq(crmInvoices.publicToken, t)).limit(1);
    if (!inv) return res.status(404).json({ message: "This invoice link is no longer valid." });

    // THE GATE — ahead of everything, the voided state included.
    if (!(await requireDocSession(req, res, inv.customerId))) return;
    if (inv.voidedAt) return res.status(410).json({ message: "This invoice has been voided." });

    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, inv.orgId)).limit(1);
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, inv.customerId)).limit(1);
    if (!org || !cust) return res.status(404).json({ message: "Not found" });
    const division = await resolveInvoiceDivision(inv);
    const items = await db.select().from(crmInvoiceItems)
      .where(eq(crmInvoiceItems.invoiceId, inv.id)).orderBy(asc(crmInvoiceItems.sortOrder));

    if (inv.sentAt && !inv.paidAt) {
      const first = inv.firstViewedAt ?? new Date();
      await db.update(crmInvoices).set({
        firstViewedAt: first, viewCount: (inv.viewCount ?? 0) + 1,
      }).where(eq(crmInvoices.id, inv.id)).catch(() => {});
      if (!inv.firstViewedAt) {
        await emitCrmEvent(inv.orgId, "invoice.viewed", { invoiceId: inv.id });
      }
    }

    const due = Math.max(0, inv.totalCents - (inv.retainageCents ?? 0) - (inv.paidCents ?? 0));
    res.json({
      invoice: {
        number: inv.number, title: inv.title, status: inv.status,
        subtotalCents: inv.subtotalCents, discountCents: inv.discountCents,
        taxCents: inv.taxCents, totalCents: inv.totalCents,
        retainageCents: inv.retainageCents, paidCents: inv.paidCents,
        dueCents: due, dueAt: inv.dueAt, paidAt: inv.paidAt, notes: inv.notes,
        createdAt: inv.createdAt,
      },
      items: items.map((i) => ({
        id: i.id, name: i.name, description: i.description, unit: i.unit,
        quantityMilli: i.quantityMilli, unitPriceCents: i.unitPriceCents,
        lineTotalCents: Math.round((i.unitPriceCents * i.quantityMilli) / 1000),
      })),
      company: { ...companyBranding(org, division), ...themePayload(org.customFields) },
      customer: {
        displayName: cust.displayName, email: cust.email, phone: cust.phone,
        addressLine1: cust.addressLine1, addressLine2: cust.addressLine2,
        city: cust.city, state: cust.state, postalCode: cust.postalCode,
      },
    });
  });
}
