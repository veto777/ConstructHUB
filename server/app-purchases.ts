import type { Express, RequestHandler } from "express";
import { fromNativeApp } from "./app-shell";

/** ConstructHUB sells nothing in its native companions (3.1.3(f)).
 * Audited against Stripe checkout/subscription/portal writes, service contracts,
 * paid-access redemption and carrier purchases. Cart checkout includes services
 * and bundles; addons includes quantities and Call Assistant tier changes.
 * Homeowners paying contractors for physical work (CRM payment links) remain available.
 * Keep this single inventory in sync whenever a new selling endpoint is added. */
export const APP_NO_PURCHASE_ROUTES = [
  "/api/stripe/create-checkout",
  "/api/stripe/change-plan",
  "/api/stripe/addons",
  "/api/stripe/create-portal",
  "/api/stripe/create-course-checkout",
  "/api/stripe/create-cart-checkout",
  "/api/contracts/:token/checkout",
  "/api/crm/voice/numbers",
  "/api/beta-codes/redeem",
] as const;

export const nativePurchaseGuard: RequestHandler = (req, res, next) => {
  if (!fromNativeApp(req)) return next();
  res.status(403).json({ code: "app_no_purchase", message: "This can't be done in the app." });
};

export function registerAppPurchaseGuard(app: Express) {
  // Install before parsers, authentication and billing handlers: every native
  // request to these endpoints gets the same refusal without a side effect.
  app.post([...APP_NO_PURCHASE_ROUTES], nativePurchaseGuard);
}
