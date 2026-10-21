/**
 * The client portal's "Leave a review" tab (owner, 2026-10-21): the homeowner rates their job through the SAME
 * review page the contractor's Google Reviews tool emails out (/review/<token>, client/src/pages/review-feedback.tsx),
 * so the feedback routing in shared/review-flow.ts applies unchanged. Nothing is emailed from here: the portal
 * reuses the client's open review request, or files one linked to their CRM record, and hands back its link.
 *
 * Offered only when the contractor has a review destination (a review template or their profile's Google link)
 * and the client is neither hidden from reviews (review pipeline) nor unsubscribed from review requests.
 */
import type { Express } from "express";
import { randomUUID } from "crypto";
import { db } from "../db";
import { crmCustomers, crmOrgs, reviewRequests, users, type ReviewTemplate } from "@shared/schema";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { storage } from "../storage";
import { requireClient } from "./client-auth";
import { hiddenFromReviews } from "./review-pipeline";
import { isReviewSuppressed } from "../review-suppression";
import { canonicalAppOrigin } from "../review-reminders";
import { normalizeOtherReviewLinks, normalizePrimaryReviewUrl, type OtherReviewLink } from "@shared/review-links";
import { logError } from "../ops/log";

export type PortalReviewProfile = { googleProfileUrl: string; otherReviewLinks: OtherReviewLink[]; primaryReviewUrl: string | null };

/** Where the review goes: the default template, else the newest template, else the account's own Google link. */
export function pickPortalReviewProfile(
  templates: Pick<ReviewTemplate, "googleProfileUrl" | "otherReviewLinks" | "primaryReviewUrl" | "isDefault">[],
  userGoogleProfileUrl: string | null | undefined,
): PortalReviewProfile | null {
  const usable = templates.filter((t) => (t.googleProfileUrl ?? "").trim());
  const template = usable.find((t) => t.isDefault) ?? usable[0];
  if (template) {
    return {
      googleProfileUrl: template.googleProfileUrl.trim(),
      otherReviewLinks: normalizeOtherReviewLinks(template.otherReviewLinks).links,
      primaryReviewUrl: template.primaryReviewUrl ?? null,
    };
  }
  const own = (userGoogleProfileUrl ?? "").trim();
  return own ? { googleProfileUrl: own, otherReviewLinks: [], primaryReviewUrl: null } : null;
}

type Target = {
  customer: typeof crmCustomers.$inferSelect;
  org: typeof crmOrgs.$inferSelect;
  owner: typeof users.$inferSelect;
  profile: PortalReviewProfile;
};

/** The first of the session's customers whose contractor can take a review from them, or null. */
async function reviewTarget(customerIds: string[]): Promise<Target | null> {
  if (!customerIds.length) return null;
  const customers = await db.select().from(crmCustomers).where(inArray(crmCustomers.id, customerIds));
  for (const customer of customers) {
    const email = (customer.email ?? "").trim();
    if (!email) continue;
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, customer.orgId)).limit(1);
    if (!org) continue;
    const [owner] = await db.select().from(users).where(eq(users.id, org.ownerUserId)).limit(1);
    if (!owner) continue;
    const profile = pickPortalReviewProfile(await storage.getReviewTemplatesByUser(owner.id), owner.googleProfileUrl);
    if (!profile) continue;
    if (await hiddenFromReviews(owner.id, org.id, customer.id, email)) continue;
    if (await isReviewSuppressed(owner.id, email)) continue;
    return { customer, org, owner, profile };
  }
  return null;
}

const addressOf = (c: typeof crmCustomers.$inferSelect) =>
  [c.addressLine1, c.addressLine2, c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter((p) => (p ?? "").trim()).join(", ") || null;

export function registerPortalReviewRoutes(app: Express): void {
  /** Whether the tab shows, and for whom. Creates nothing. */
  app.get("/api/client/review", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    try {
      const target = await reviewTarget(client.customerIds);
      res.json(target ? { available: true, orgName: target.org.name } : { available: false });
    } catch (err) {
      logError("portal review status", err);
      res.status(500).json({ message: "Could not load the review page." });
    }
  });

  /** The client tapped Start: their open review request's link (an emailed one is reused), filed if there is none. */
  app.post("/api/client/review/start", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    if (client.contractorPreview) {
      return res.status(403).json({ message: "Contractor preview is read-only — sign in as the client to leave a review.", contractorPreview: true });
    }
    try {
      const target = await reviewTarget(client.customerIds);
      if (!target) return res.status(404).json({ message: "Reviews aren't available for this project yet." });
      const { customer, org, owner, profile } = target;
      const email = customer.email!.trim();

      const [existing] = await db.select({ token: reviewRequests.token }).from(reviewRequests)
        .where(and(
          eq(reviewRequests.userId, owner.id),
          isNull(reviewRequests.deletedAt),
          eq(reviewRequests.unsubscribed, false),
          ne(reviewRequests.status, "scheduled"),
          or(
            and(eq(reviewRequests.crmOrgId, org.id), eq(reviewRequests.crmCustomerId, customer.id)),
            and(isNull(reviewRequests.crmCustomerId), sql`lower(trim(${reviewRequests.clientEmail})) = lower(${email})`),
          ),
        ))
        .orderBy(desc(reviewRequests.createdAt))
        .limit(1);

      let token = existing?.token;
      if (!token) {
        token = randomUUID();
        await storage.createReviewRequest({
          userId: owner.id,
          clientName: customer.displayName,
          clientEmail: email,
          clientPhone: customer.phone || null,
          clientAddress: addressOf(customer),
          companyName: org.name || owner.companyName || owner.displayName || "Our Company",
          googleProfileUrl: profile.googleProfileUrl,
          otherReviewLinks: profile.otherReviewLinks,
          primaryReviewUrl: normalizePrimaryReviewUrl(profile.primaryReviewUrl, profile.googleProfileUrl, profile.otherReviewLinks),
          crmOrgId: org.id,
          crmCustomerId: customer.id,
          token,
          status: "sent",
        });
      }
      res.json({ url: `${canonicalAppOrigin()}/review/${encodeURIComponent(token)}` });
    } catch (err) {
      logError("portal review start", err);
      res.status(500).json({ message: "Could not open the review page." });
    }
  });
}
