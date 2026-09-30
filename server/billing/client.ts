import Stripe from "stripe";

// Lazily constructed: importing the billing modules (tenancy, tests) must not
// require STRIPE_SECRET_KEY. The client is only built when a Stripe API call
// actually runs.
let _stripe: Stripe | null = null;

/** No STRIPE_SECRET_KEY on this server: checkout can't start, and the caller
 *  hears that in plain words (503) instead of the SDK's "Neither apiKey nor
 *  config.authenticator provided". Nothing is charged either way. */
export class PaymentsNotConfiguredError extends Error {
  readonly status = 503;
  constructor() {
    super("Online payments aren't set up on this server yet. Nothing was charged — please try again later.");
    this.name = "PaymentsNotConfiguredError";
  }
}

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new PaymentsNotConfiguredError();
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-01-27.acacia" as any,
    });
  }
  return _stripe;
}

/** The app's Stripe client. Any property access without a key throws PaymentsNotConfiguredError. */
export const stripe = new Proxy({} as Stripe, {
  get(_t, prop) {
    const client = getStripe() as any;
    const v = client[prop];
    return typeof v === "function" ? v.bind(client) : v;
  },
});
