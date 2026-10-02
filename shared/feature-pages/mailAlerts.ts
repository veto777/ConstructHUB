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
  related: ["domains", "profileGuard", "agency"],
  app: { href: "/mail-alerts", surface: "app" },
  headings: {
    cards: { title: "What Mail Alerts ", em: "Keeps for You" },
  },
  seo: {
    title: "Mail Alerts — Provider Alert Emails by Client | ConstructHUB",
    description:
      "Forward Google Business Profile, Search Console, Google Ads, Cloudflare and registrar alert emails to a private address, labelled by severity and matched to clients.",
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
