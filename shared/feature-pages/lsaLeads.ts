import type { FeaturePage } from "./types";

/**
 * LSA Leads — Google Local Services Ads leads, ratings and Telegram alerts (/lsa-leads).
 *
 * Deliberately NOT advertised: the "schedule for later" dispute scatter and the 30–60 s spacing between
 * reports. Every report is still a lead and a reason the owner picks; the page only says that.
 *
 * Every claim below is backed by the code in `sources`:
 *   - Google sign-in, discovery of every account the sign-in reaches, LSA accounts listed first, pause per account,
 *     the "isn't configured yet" message: server/lsa/routes.ts, server/lsa/sync.ts, client/src/pages/lsa-leads.tsx
 *   - background sync (rotating, every minute) + Sync now: server/lsa/routes.ts startLsaTimers, POST /api/lsa/sync
 *   - lead fields (name, phone, email when the lead type has them, service, category, type, status, charged,
 *     credit state, Google lead ID), account totals: server/lsa/sync.ts, client/src/pages/lsa-leads.tsx
 *   - estimated cost per charged lead = that day's spend split across that day's charged leads:
 *     server/lsa/sync.ts syncLeadCostsForAccount
 *   - Telegram DM per new lead with a Report bad lead button + reasons: server/lsa/telegram.ts
 *   - Good / Bad + reason sent to Google (ProvideLeadFeedback), the six reasons, no re-rating, no double queue,
 *     owner picks every lead and reason: server/lsa/disputes.ts, shared/schema.ts LSA_DISPUTE_REASONS
 *   - no plan check: server/lsa/routes.ts (session only), shared/dashboard.ts (gate "none")
 *   - the free LSA setup guide: client/src/pages/lsa-guide.tsx (PublicRouter in client/src/App.tsx)
 */

const page: FeaturePage = {
  key: "lsaLeads",
  slug: "lsa-leads",
  group: "win",
  status: "ready",
  title: "LSA Leads",
  kicker: "Local Services Ads",
  headline: { lead: "Every Local Services Lead, ", swipe: "Tracked\u00a0and\u00a0Rated" },
  lede:
    "LSA Leads pulls the leads from your Google Local Services Ads accounts into one list, shows which ones you were " +
    "charged for, and lets you rate each lead or report a bad one to Google with a reason you choose.",
  hero: { mascot: "standing", bubble: "Let's sort the good leads from the bad ones." },
  steps: [
    {
      title: "Connect Google",
      body: "Sign in with the Google account that has access to your Local Services Ads. It finds every account that sign-in can reach.",
    },
    {
      title: "Leads come in",
      body: "Leads sync in the background, or press Sync now. Each account shows its total, charged and disputed leads and its spend.",
    },
    {
      title: "Get a Telegram message",
      body: "Link Telegram and each new lead arrives as a direct message with the contact details Google provides.",
    },
    {
      title: "Rate every lead",
      body: "Mark a lead as good, or report it as bad with a reason. Google reviews the report and decides on any credit.",
    },
  ],
  cards: [
    {
      icon: "inbox",
      title: "All your accounts",
      body: "Every Local Services account your Google sign-in can reach, with the accounts running LSA listed first. Pause syncing for any account.",
    },
    {
      icon: "phone",
      title: "Contact details",
      body: "Name, phone and email where Google includes them for that lead type, plus the service, category, status and Google lead ID.",
    },
    {
      icon: "receipt",
      title: "Charged or not",
      body: "See which leads you were charged for, an estimated cost for each one worked out from that day's spend, and each lead's credit state.",
    },
    {
      icon: "message",
      title: "Telegram alerts",
      body: "A direct message for each new lead, with a Report bad lead button and the reasons to pick from right in the chat.",
    },
    {
      icon: "alert",
      title: "Report bad leads",
      body: "You pick the reason: a service you don't offer, outside your area, a duplicate, a sales call, spam or not ready to book.",
    },
    {
      icon: "shield-check",
      title: "No double reports",
      body: "A lead Google already has your feedback on can't be rated again, and a lead that's already queued or disputed isn't sent twice.",
    },
  ],
  audience: [
    {
      title: "Contractors on Local Services Ads",
      body: "Keep track of every lead you pay for, and rate each one from a single list.",
    },
    {
      title: "Owners who work from their phone",
      body: "A Telegram message when a new lead comes in, with the bad-lead button right there.",
    },
    {
      title: "Agencies running LSA for clients",
      body: "Every account your Google sign-in can reach, with each account's leads and spend.",
    },
  ],
  pricing: { kind: "account" },
  faqs: [
    {
      q: "What does it need from me?",
      a: "A Google account with access to your Local Services Ads, connected with Google sign-in. Telegram is optional, for alerts. If the Google Ads connection isn't set up on ConstructHUB yet, the page tells you so.",
    },
    {
      q: "Which plan includes it?",
      a: "No plan is needed. LSA Leads works with any ConstructHUB account and isn't counted against a plan.",
    },
    {
      q: "Will reporting a bad lead get me a credit?",
      a: "Not necessarily. ConstructHUB sends your rating and reason to Google, Google decides whether to credit the lead, and the lead's credit state shows what it decided. Only report a lead that really matches the reason you pick.",
    },
    {
      q: "Does it dispute leads for me automatically?",
      a: "No. You pick every lead and every reason, and it never reports a lead on its own.",
    },
    {
      q: "What doesn't it do?",
      a: "It doesn't change your LSA budget, service areas or profile, and it doesn't call or message leads for you. For setup help, the free LSA guide covers verification, services, service areas and photos.",
    },
  ],
  related: ["adsManager", "guides", "crmLeads"],
  app: { href: "/lsa-leads", surface: "app" },
  headings: {
    steps: { title: "From Google Sign-In to Rated Leads in ", em: "Four\u00a0Steps" },
    cards: { title: "What LSA Leads ", em: "Gives You" },
  },
  seo: {
    title: "LSA Leads — Local Services Ads Lead Tracking | ConstructHUB",
    description:
      "Pull your Google Local Services Ads leads into one list, see which were charged, get Telegram alerts, and report bad leads to Google with a reason you choose.",
  },
  sources: [
    "client/src/pages/lsa-leads.tsx",
    "client/src/pages/lsa-guide.tsx",
    "server/lsa/routes.ts",
    "server/lsa/sync.ts",
    "server/lsa/disputes.ts",
    "server/lsa/telegram.ts",
    "server/lsa/client.ts",
    "shared/schema.ts",
    "shared/dashboard.ts",
  ],
};

export default page;
