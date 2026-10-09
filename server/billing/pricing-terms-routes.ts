/**
 * The founding member offer's routes (./pricing-terms.ts):
 *
 *   GET  /api/pricing/founding-offer   public: { open } and nothing else — no
 *                                      count, no deadline. The pricing page and
 *                                      the checkout review show their one line
 *                                      only when this says open; the prerendered
 *                                      snapshot never carries it.
 *   GET  /api/admin/founding-offer     platform admins: the switch, who set it,
 *                                      how many founding members.
 *   POST /api/admin/founding-offer     { open: boolean } — close or reopen,
 *                                      recorded with updated_by.
 */
import type { Express, Request, Response } from "express";
import { requirePlatformAdmin } from "../crm/admin";
import { originOk } from "../hub/access";
import { foundingOfferOpen, foundingOfferStatus, setFoundingOffer } from "./pricing-terms";

type GetUser = (req: any, res: any) => any;

const failed = (res: Response, what: string) => (err: unknown) => {
  console.error(`[pricing-terms] ${what} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ message: `Could not ${what}. Please try again.` });
};

export function registerPricingTermsRoutes(app: Express, getUser: GetUser): void {
  app.get("/api/pricing/founding-offer", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ open: await foundingOfferOpen() });
    } catch (err) { failed(res, "read the founding member offer")(err); }
  });

  app.get("/api/admin/founding-offer", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser);
    if (!admin) return;
    res.setHeader("Cache-Control", "private, no-store");
    try {
      res.json(await foundingOfferStatus());
    } catch (err) { failed(res, "load the founding member offer")(err); }
  });

  app.post("/api/admin/founding-offer", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getUser);
    if (!admin) return;
    if (!originOk(req)) return void res.status(403).json({ message: "Forbidden" });
    const open = req.body?.open;
    if (typeof open !== "boolean") return void res.status(400).json({ message: "Send { open: true } to reopen the offer or { open: false } to close it." });
    try {
      await setFoundingOffer(open, admin.id);
      console.log(`[pricing-terms] founding member offer ${open ? "opened" : "closed"} by ${admin.email} (user ${admin.id}).`);
      const status = await foundingOfferStatus();
      res.json({
        ...status,
        message: open
          ? "The founding member offer is open: new subscriptions keep their plan price."
          : "The founding member offer is closed: new subscriptions are no longer marked as founding members. Existing founding members keep their price.",
      });
    } catch (err) { failed(res, "change the founding member offer")(err); }
  });
}
