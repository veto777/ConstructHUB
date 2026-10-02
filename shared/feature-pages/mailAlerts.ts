import type { FeaturePage } from "./types";
import { PLANS, planForModule } from "../plans";
import { plansWhere } from "../plan-copy";

/**
 * Mail alerts — half of the Agency-only "Domains + Gmail alerts" module.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the private forwarding address and the Gmail setup steps (forwarding confirmation, sender filter, keep
 *     general forwarding off), "treat as a reported alert": server/mail-alerts/service.ts forwardingAddress,
 *     client/src/pages/mail-alerts.tsx
 *   - known senders (Google Business Profile, Search Console, Google Ads, Cloudflare, registrar domains) and the
 *     subject topics; critical = transfer / new owner / ownership request / manual action / security issue /
 *     suspension; forwarding confirmation code + link: server/mail-alerts/classify.ts
 *   - matching to a domain's location or a business name, 30-day retention, notification per new alert, kept for
 *     30 days when the plan lacks the module: server/mail-alerts/service.ts storeMatched, ingest, HELD_ALERT_NOTE
 *   - filters (category, severity, client), search, manual mapping, mark read: server/mail-alerts/routes.ts
 *   - optional read-only Gmail connection (only when enabled), last 30 days of known senders:
 *     server/mail-alerts/gmail.ts GMAIL_SCOPE, classify.ts GMAIL_QUERY
 *   - Agency-only gate: requireMailModule() in routes.ts (requireModule("domainsMailAlerts") in gmail.ts)
 */

const MODULE_PLAN = PLANS[planForModule("domainsMailAlerts")].name;
const ONLY_PLAN = plansWhere((plan) => plan.modules.domainsMailAlerts).length === 1;

const page: FeaturePage = {
  key: "mailAlerts",
  slug: "mail-alerts",
  group: "protect",
  status: "ready",
  title: "Mail alerts",
  ctaTitle: "Mail Alerts",
  kicker: "Provider alerts",
  headline: { lead: "The Alerts That Matter, ", swipe: "Matched", tail: " to the Right Client" },
  lede:
    "Forward alert emails from Google Business Profile, Search Console, Google Ads, Cloudflare and your domain " +
    "registrars to a private address. Mail alerts keeps the ones it recognises, marks how serious each one is and " +
    "matches it to the client it's about.",
  hero: { mascot: "gabe", bubble: "I'll keep an eye on the provider emails." },
  steps: [
    {
      title: "Get your private address",
      body: "Mail alerts gives your account its own private forwarding address.",
    },
    {
      title: "Confirm forwarding in Gmail",
      body: "Add the address in Gmail's forwarding settings. Gmail's confirmation shows up in Mail alerts with its code and link.",
    },
    {
      title: "Filter the provider senders",
      body: "Create a Gmail filter that forwards the known provider senders to your address, and keep general forwarding off.",
    },
    {
      title: "Review matched alerts",
      body: "Each alert is marked critical, warning or info, matched to a client where it can be, and kept for 30 days.",
    },
  ],
  cards: [
    {
      icon: "inbox",
      title: "Known senders only",
      body: "Alert addresses from Google Business Profile, Search Console, Google Ads and Cloudflare, plus domain registrars. Other mail isn't kept.",
    },
    {
      icon: "filter",
      title: "Alert subjects only",
      body: "A message is kept only when its subject is about something like verification, suspension, indexing, policy, billing, security, expiry or a transfer.",
    },
    {
      icon: "shield-alert",
      title: "Critical first",
      body: "Ownership requests, new owners, manual actions, security issues, suspensions and domain transfers are marked critical.",
    },
    {
      icon: "users",
      title: "Matched to the client",
      body: "An alert that names one of your domains is matched to that domain's location, or to a business name it mentions. Map the rest by hand.",
    },
    {
      icon: "bell",
      title: "A notification for each",
      body: "Every new alert sends you a notification, marked critical when it is.",
    },
    {
      icon: "key",
      title: "Forwarding confirmation",
      body: "Gmail's forwarding confirmation code and link are pulled out of the message, so finishing setup takes a moment.",
    },
    {
      icon: "search",
      title: "Search and filter",
      body: "Filter by provider, severity and client, and search by subject or sender.",
    },
    {
      icon: "check",
      title: "Read and unread",
      body: "Mark alerts as read, so the list shows what still needs a look.",
    },
    {
      icon: "clock",
      title: "Kept for 30 days",
      body: "Alerts are deleted 30 days after they arrive.",
    },
  ],
  audience: [
    {
      title: "Agencies managing client accounts",
      body: "Provider emails pile up in one shared inbox. Mail alerts pulls out the ones that matter and says which client each is about.",
    },
    {
      title: "Owners with several locations",
      body: "A suspension or ownership request on any profile shows up with the location it belongs to.",
    },
  ],
  pricing: {
    kind: "module",
    module: "domainsMailAlerts",
    note: "Domains is included alongside it, at no extra cost.",
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "A Gmail account that receives your provider emails, a forwarding filter you set up there, and your domains and locations in ConstructHUB so alerts can be matched to them.",
    },
    {
      q: "Which plan includes it?",
      a: `Mail alerts comes with the ${MODULE_PLAN} plan, together with Domains.${ONLY_PLAN ? " No other plan includes it." : ""} Alerts forwarded while your plan doesn't include it are kept for 30 days and show up once it does.`,
    },
    {
      q: "Does it read my whole inbox?",
      a: "No. Forwarding sends only what your filter matches, and Mail alerts keeps only known senders with alert subjects. Where an optional read-only Gmail connection is offered, it looks only for those senders in the last 30 days.",
    },
    {
      q: "Can I trust that an alert is real?",
      a: "Treat it as a reported alert. A matching sender address doesn't prove an email is genuine, so open the provider's own dashboard for anything to do with security or billing.",
    },
    {
      q: "Does it act on the alerts for me?",
      a: "No. It stores, labels and matches them and sends you a notification. Fixing the issue happens in the provider's own dashboard.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the senders, the per-provider subject topics,
  // the critical words and the forwarding code/link are server/mail-alerts/classify.ts SENDERS/REGISTRAR_SENDERS/
  // classifyMail; "dropped without being stored" is storeMatched returning before the INSERT when classifyMail is null;
  // matching (exactly one domain → its location, else exactly one business name of 4+ letters), the notification,
  // 30-day expiry and holding alerts while the plan lacks the module are server/mail-alerts/service.ts storeMatched/
  // ingest/HELD_ALERT_NOTE; manual mapping, filters and read state are server/mail-alerts/routes.ts; the Gmail setup
  // steps and "treat as a reported alert" are client/src/pages/mail-alerts.tsx.
  inDepth: {
    heading: { title: "Business Profile and Ads Alert Emails, ", em: "Explained" },
    paragraphs: [
      "The emails that matter most to a local business land in the same inbox as everything else: a Google Business " +
        "Profile suspension, an ownership request, a Search Console manual action, a Google Ads policy notice, a domain " +
        "about to expire. Mail alerts pulls those out. You forward provider emails from Gmail to a private address that " +
        "belongs to your account, and each one is checked against a fixed list of provider senders and alert subjects. " +
        "A message that doesn't match is dropped without being stored.",
      "The known senders are the alert addresses Google Business Profile, Search Console, Google Ads and Cloudflare " +
        "send from, plus a list of domain registrars. A message is kept only when its subject fits that provider's " +
        "alert topics: verification, suspension, ownership or access requests for a Business Profile; indexing, crawl, " +
        "manual action or security for Search Console; policy, disapproval, billing or suspension for Google Ads; " +
        "expiry, renewal, transfer, nameservers or DNS for a registrar. Ownership requests, new owners, manual actions, " +
        "security issues, suspensions and registrar transfers are marked critical, other alerts are warnings, and " +
        "Gmail's own forwarding confirmation is info.",
      "Each alert is then matched to a client. When the email names exactly one of the domains you keep in Domains, it " +
        "goes to that domain's location; failing that, when it names exactly one of your business names, it goes to " +
        "that location. Anything it can't place waits for you to map it by hand. Every new alert sends you a " +
        "notification, marked critical when it is, and alerts are deleted 30 days after they arrive. If your plan " +
        "doesn't include Mail alerts yet, forwarded alerts are still kept for those 30 days and appear once it does.",
      "Setup happens in Gmail: add the forwarding address, confirm it with the code Mail alerts pulls out of Gmail's " +
        "confirmation email, then create a filter for the provider senders and keep general forwarding off, so only " +
        "those messages leave your inbox. A matching sender address doesn't prove an email is genuine, so treat each " +
        "one as a reported alert and check anything about security or billing in the provider's own dashboard. Mail " +
        "alerts stores, labels and matches; it doesn't reply, appeal or fix anything for you.",
    ],
  },
  related: ["domains", "profileGuard", "agency"],
  app: { href: "/mail-alerts", surface: "app" },
  headings: {
    cards: { title: "What Mail Alerts ", em: "Keeps for You" },
  },
  seo: {
    title: "GBP, Ads and Domain Alert Emails by Client | ConstructHUB",
    description:
      "Forward Google Business Profile, Search Console, Google Ads, Cloudflare and registrar alert emails to a private address, sorted by severity and client.",
  },
  sources: [
    "client/src/pages/mail-alerts.tsx",
    "server/mail-alerts/routes.ts",
    "server/mail-alerts/service.ts",
    "server/mail-alerts/classify.ts",
    "server/mail-alerts/gmail.ts",
    "server/mail-alerts/inbound.ts",
    "shared/plans.ts",
  ],
};

export default page;
