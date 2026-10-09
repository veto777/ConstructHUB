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

/** STRIPE_TIMEOUT_MS (default 20 s): how long one Stripe call may take. */
export const stripeTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.STRIPE_TIMEOUT_MS);
  return Number.isInteger(n) && n > 0 ? n : 20_000;
};

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new PaymentsNotConfiguredError();
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-01-27.acacia" as any,
      // Every call is bounded (the SDK's own default is 80 s): a route or a lock section waiting on
      // Stripe never hangs past this; the SDK's retries stay off by default (idempotency keys carry ours).
      timeout: stripeTimeoutMs(),
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
