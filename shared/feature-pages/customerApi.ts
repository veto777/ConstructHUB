import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { PLANS } from "../plans";

/**
 * Customer API — /api/v1 with chub_ keys, documented on /developers.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the resources (account, locations, reviews, insights, photos, gbp-posts, social-posts, site-scans, citations)
 *     and the writes (schedule a GBP post, reply to a review — publish or draft —, schedule a social post, start a
 *     Site Scan that uses the plan's scan allowance): server/public-api/resources/register.ts, gbp-write.ts,
 *     social-write.ts, sitescan-write.ts
 *   - keys: read/write scopes, optional per-key monthly unit cap and expiry, shown once, stored as a hash, up to 25
 *     active, revocable; creating one needs a recent identity check: server/account/api-keys.ts (MAX_ACTIVE_API_KEYS),
 *     server/account/api-key-routes.ts
 *   - units (read 1 + 1 per 100 rows, write 5, only successful responses), the monthly reset on the 1st (UTC),
 *     402 plan_required / 429 quota_exceeded: server/public-api/quota.ts, server/account/api-keys.ts
 *   - per-key rate (the plan's apiRatePerMinute) and a per-account cap across keys: server/public-api/rate-limit.ts
 *   - response headers, /me, the public OpenAPI document and the Developers page: server/public-api/index.ts,
 *     client/src/pages/developers.tsx
 *   - NO AI through the API (enforced by an import-graph test): server/public-api/index.ts, server/public-api/no-ai.test.ts,
 *     client/src/pages/settings/api/api-keys-panel.tsx (API_NO_AI_NOTICE)
 *   - chub_ keys only work under /api/v1 and never authenticate a CRM route or a session route; the CRM's chk_ keys are
 *     a separate system: server/public-api/auth.ts, server/public-api/guard.ts
 *   - the monthly allowance per plan: shared/plans.ts limits.apiUnitsPerMonth (0 = not included)
 */

const API: FeatureAllowance = { limit: "apiUnitsPerMonth", unit: "API units", period: "month" };
/** Requests per minute per key: the same on every plan that has the API, read from the price book. */
const RATE = PLANS.growth.limits.apiRatePerMinute;

const page: FeaturePage = {
  key: "customerApi",
  slug: "customer-api",
  group: "platform",
  status: "ready",
  title: "Customer API",
  kicker: "For developers",
  headline: { lead: "Your ConstructHUB Data, in ", swipe: "Your Own Tools" },
  lede:
    "Read your locations, reviews, insights, posts and Site Scan reports, and schedule posts, reply to reviews or start a scan " +
    "from your own scripts, with an API key from your account.",
  hero: { mascot: "standing", bubble: "Got your own scripts? Here's where they plug in." },
  steps: [
    {
      title: "Create a key",
      body: "In Settings → API keys, name a key and give it read, write or both. You confirm it's you first, and the key is shown once.",
    },
    {
      title: "Read the reference",
      body: "The Developers page lists every endpoint from the live OpenAPI document, with the scope and units each one uses.",
    },
    {
      title: "Call the API",
      body: "Send the key as a bearer token to /api/v1. A key reads and writes only the account it belongs to.",
    },
    {
      title: "Watch your units",
      body: "Every response carries your remaining rate limit and units, and Settings shows each key's use this month.",
    },
  ],
  cards: [
    {
      icon: "database",
      title: "Read your data",
      body: "Your account, locations, reviews, insights, photos, Google posts, social posts, Site Scan reports and citations.",
    },
    {
      icon: "send",
      title: "Schedule Google posts",
      body: "Queue a Google Business Profile update with your text, media links and time; the regular publishing worker posts it.",
    },
    {
      icon: "star",
      title: "Reply to reviews",
      body: "Reply to a Google review, published or saved as a draft, through the same checks as the app.",
    },
    {
      icon: "share",
      title: "Schedule social posts",
      body: "Send a post to a business's connected and mapped social destinations, with the same text and media rules as the app.",
    },
    {
      icon: "gauge",
      title: "Start a Site Scan",
      body: "Start a scan and read the report back. It uses your plan's Site Scan allowance, just like the Site Scan page.",
    },
    {
      icon: "key",
      title: "Keys you control",
      body: "Read and write scopes, an optional monthly unit cap and expiry per key, up to 25 active keys, and revoke any key at once.",
    },
    {
      icon: "chart",
      title: "Usage you can see",
      body: "Settings → API keys shows each key's units this month and when it was last used, next to your plan's monthly total.",
    },
    {
      icon: "shield-check",
      title: "No AI through the API",
      body: "What you send is stored exactly as sent and no AI rewrites it. AI features and AI settings can't be reached through the API.",
    },
    {
      icon: "code",
      title: "An OpenAPI reference",
      body: "A public OpenAPI document at /api/v1/openapi.json, laid out endpoint by endpoint on the Developers page.",
    },
  ],
  spotlight: {
    kicker: "Limits",
    heading: { title: "Units You Can ", em: "Predict" },
    points: [
      "A read costs 1 unit plus 1 per 100 rows returned; a write costs 5 units. Only successful calls count.",
      `Up to ${RATE} requests a minute per key, with a cap per account across all its keys.`,
      "Units reset on the 1st of each month (UTC), and each key can have its own lower cap.",
      "Over the limit you get a clear error: 429 with Retry-After, 429 quota_exceeded, or 402 plan_required on a plan without the API.",
    ],
    panel: {
      label: "Every response",
      title: "What you can read back",
      items: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-Units-Remaining", "GET /api/v1/me", "OpenAPI document"],
      note: "/api/v1/me returns the key, plan and usage behind the token.",
    },
  },
  audience: [
    {
      title: "Owners with their own scripts",
      body: "Pull reviews and insights into a spreadsheet or report you already use.",
    },
    {
      title: "Agencies with their own systems",
      body: "Read every location's data and schedule posts from the tools your team already runs.",
    },
    {
      title: "Teams that write with their own AI",
      body: "Write posts and replies with your own tools, then send them here to publish on your schedule.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: API,
    note: "Each key can also have its own lower monthly cap.",
  },
  faqs: [
    {
      q: "Which plans include the API?",
      a: `${allowanceLine(API)}. Plans not listed don't include API access, and a key on them can't be created.`,
    },
    {
      q: "Can I use AI features through the API?",
      a: "No. The API never generates content and can't read or change AI settings. Posts, review replies and social posts you send are stored exactly as sent, so use your own scripts or your own AI to write them.",
    },
    {
      q: "Is this the same as the CRM API?",
      a: "No. The CRM has its own separate keys. Customer API keys work only for the endpoints on the Developers page, and never sign in to the app.",
    },
    {
      q: "How do I keep keys safe?",
      a: "A key is shown once when you create it and stored only as a hash. Give it only the scopes it needs, set an expiry or a unit cap, and revoke it the moment it may have leaked.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): reads come from the data ConstructHUB has
  // stored (google_profile_reviews, gbp_daily_metrics… in server/public-api/resources/*.ts), linked locations only;
  // JSON and the one error envelope: server/public-api/errors.ts apiError(); agency workspaces (?workspace=, assigned
  // clients only): server/public-api/resources/_shared.ts; writes through the app's own code: gbp-write.ts (content
  // worker, gbp/reply.ts checks), social-write.ts (createPosts, requestId idempotency), sitescan-write.ts (reserveQuota);
  // the reference from the live document: client/src/pages/developers.tsx; keys only under /api/v1 and not the CRM's
  // keys: server/public-api/guard.ts, auth.ts; no AI: server/public-api/no-ai.test.ts.
  inDepth: {
    heading: { title: "A REST API for Reviews, Posts and ", em: "Site Scans" },
    paragraphs: [
      "The Customer API is a REST API over the data your ConstructHUB account already holds: the Google Business " +
        "Profile locations you have linked, their reviews, insights, photos and posts, your social posts, your Site " +
        "Scan reports and your citations. It reads what ConstructHUB has stored and synced. It is not a direct line to " +
        "Google's own APIs, and a location that isn't linked to your account isn't in it.",
      "Every request sends an API key as a bearer token to /api/v1 and gets JSON back. When something goes wrong, the " +
        "error comes back in one shape, with a stable code your script can check and a message a person can read. A " +
        "key reads and writes only its own account's data. A key that belongs to a member of an agency workspace can " +
        "also read that workspace's data, limited to the clients the member is assigned to, just as in the app.",
      "Writes go through the same code the app uses, so they follow the same rules. A Google Business Profile post " +
        "you schedule joins the regular publishing queue. A review reply goes through the same checks as one typed in " +
        "the app, and can be published or saved as a draft. A social post goes to the business's mapped destinations " +
        "and carries a request ID, so sending the same request twice doesn't queue it twice. A Site Scan started " +
        "through the API uses the plan's Site Scan allowance, like one started on the Site Scan page.",
      "The reference on the Developers page is drawn from the live OpenAPI document at /api/v1/openapi.json, so the " +
        "page and the document your API client reads describe the same endpoints.",
      "API keys are kept apart from everything else. A key works only under /api/v1: it can't sign in to the app or " +
        "reach your settings, and it is not a key for the CRM's own API. AI features stay inside the app, and an " +
        "automated test walks the API's code to make sure no AI module can be reached from it.",
    ],
  },
  related: ["siteScan", "gbpContent", "social"],
  app: { href: "/developers", surface: "app", label: "Open the API reference" },
  tryIt: { label: "Read the API reference", href: "/developers" },
  headings: {
    steps: { title: "From Key to First Call in ", em: "Four\u00a0Steps" },
    cards: { title: "What the API ", em: "Can Do" },
    faq: { title: "Before You ", em: "Build" },
  },
  seo: {
    title: "Customer API — REST API for Your GBP Data | ConstructHUB",
    description:
      "A REST API for your Google Business Profile reviews, insights and posts, social posts and Site Scan reports. API keys with scopes, monthly units, no AI.",
  },
  sources: [
    "client/src/pages/developers.tsx",
    "client/src/pages/settings/api/api-keys-panel.tsx",
    "server/public-api/index.ts",
    "server/public-api/auth.ts",
    "server/public-api/guard.ts",
    "server/public-api/errors.ts",
    "server/public-api/resources/_shared.ts",
    "server/public-api/resources/reviews.ts",
    "server/public-api/resources/insights.ts",
    "server/public-api/quota.ts",
    "server/public-api/rate-limit.ts",
    "server/public-api/no-ai.test.ts",
    "server/public-api/resources/register.ts",
    "server/public-api/resources/gbp-write.ts",
    "server/public-api/resources/social-write.ts",
    "server/public-api/resources/sitescan-write.ts",
    "server/account/api-keys.ts",
    "server/account/api-key-routes.ts",
    "shared/plans.ts",
  ],
};

export default page;
