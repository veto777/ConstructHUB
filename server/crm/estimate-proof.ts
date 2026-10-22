/**
 * "Send me a proof" — the exact email the client would get for an estimate
 * (same builder as the real send, estimate-email.ts), mailed ONLY to the
 * logged-in team member (or the org owner when the member has no email),
 * subject prefixed "[PROOF] ".
 *
 * Deliberately side-effect free apart from the one email and one history
 * row: no status / sent_at / expiry change, no job-stage move, no client
 * token, no SMS, no owner notice, no webhook. The link inside is a contractor
 * PREVIEW grant (the Preview button's kind), so opening it is never a client
 * view and it cannot approve, decline or pay.
 */
import type { Express } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { crmCustomers, crmEstimates, crmMembers, users } from "@shared/schema";
import { requireOrg, requirePermission } from "./tenancy";
import { sendWithFallback } from "../email";
import { getBaseUrl } from "../auth";
import { clientPortalBaseUrl } from "../site-context";
import { logEvent, estimateExpiryOnSend } from "./entities";
import { companyBranding, resolveEstimateDivision } from "./divisions";
import { buildEstimateEmail } from "./estimate-email";
import { mintPreviewGrant } from "./portal";
import { logError } from "../ops/log";

type GetUser = (req: any, res: any) => any;

/** A proof sits in an inbox for a while — a week, not the 15-minute Preview. */
export const PROOF_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PROOF_SUBJECT_PREFIX = "[PROOF] ";

/** Who gets the proof: the member's own address, else the org owner's. */
async function proofRecipient(ctx: any): Promise<string | null> {
  if (ctx.member?.email) return ctx.member.email;
  const owners = await db.select({ email: crmMembers.email, userId: crmMembers.userId }).from(crmMembers)
    .where(and(eq(crmMembers.orgId, ctx.org.id), eq(crmMembers.role, "owner"), eq(crmMembers.status, "active")));
  // The account owner's seat first, then any other owner seat.
  owners.sort((a, b) => Number(b.userId === ctx.org.ownerUserId) - Number(a.userId === ctx.org.ownerUserId));
  const owner = owners.find((o) => o.email)?.email;
  if (owner) return owner;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, ctx.org.ownerUserId)).limit(1);
  return u?.email ?? null;
}

export function registerEstimateProofRoutes(app: Express, getDevUser: GetUser): void {
  app.post("/api/crm/estimates/:id/send-proof", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    // Same permission as Send.
    if (!requirePermission(res, ctx, "manageEstimates")) return;

    const parsed = z.object({ message: z.string().max(4000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid proof request" });

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.approvedAt || est.status === "approved") {
      return res.status(409).json({ message: "This estimate is already approved." });
    }
    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found" });
    if (!process.env.SESSION_SECRET) return res.status(503).json({ message: "Preview is not configured on this server." });

    const to = await proofRecipient(ctx);
    if (!to) return res.status(400).json({ message: "Your account has no email address to send the proof to." });

    const base = getBaseUrl(req);
    // The expiry line the client would see if this went out now (send never shortens an extension).
    const fresh = estimateExpiryOnSend(new Date());
    const expiresAt = est.expiresAt && est.expiresAt.getTime() > fresh.getTime() ? est.expiresAt : fresh;
    const link = `${base}/e/${est.publicToken}?preview=${mintPreviewGrant("estimate", est.id, PROOF_PREVIEW_TTL_MS)}`;
    const branding = companyBranding(ctx.org, await resolveEstimateDivision(est));
    const { subject, html } = buildEstimateEmail({
      est, org: ctx.org, branding, customerName: cust.displayName,
      base, portalUrl: clientPortalBaseUrl(req), link,
      from: ctx.member.displayName || ctx.org.name,
      // The footer names the client's address, exactly as the client's copy would.
      verifiesEmail: est.sentToEmail || cust.email || to,
      expiresAt, message: parsed.data.message,
    });

    try {
      await sendWithFallback({ to, subject: PROOF_SUBJECT_PREFIX + subject, html } as any);
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      logError("[crm] estimate proof failed:", msg);
      return res.status(502).json({ message: "Could not send the proof — please try again." });
    }

    await logEvent(ctx.org.id, est.id, "proof_sent", ctx.member.id, req, { to });
    res.json({ ok: true, to });
  });
}
