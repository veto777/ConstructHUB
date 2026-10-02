import type { FeaturePage } from "./types";
import { planNamesWhere } from "../plan-copy";

/**
 * Guides — the ad playbooks, the state licensing guides and the setup walkthroughs.
 *
 * Every claim below is backed by the code in `sources`:
 *   - Google Ads guide: 12 sections (GUIDE_SECTIONS), the overview open, the section text served only after any
 *     Master Class purchase (403 otherwise): client/src/pages/google-ads-guide.tsx, google-ads-guide-section.tsx,
 *     server/routes.ts (/api/google-ads-guide/:slug)
 *   - LSA guide: 8 sections, no purchase check, on the public router: client/src/pages/lsa-guide.tsx, client/src/App.tsx
 *   - Ad Fraud page, open, with the Click Guard steps: client/src/pages/google-ad-fraud.tsx
 *   - state guides live in the Master Class (State Guide tab, unlocked by module 1 / the bundle; the license lists
 *     and the comparison table are on the free overview): client/src/pages/master-class.tsx, server/data/state-guides.json,
 *     server/state-guides-schema.ts
 *   - the setup walkthroughs (Social Media → Guides tab; /guides redirects there), each with an "Open …" link:
 *     client/src/pages/guides.tsx, client/src/pages/social-media.tsx
 *   - the site-connection guide (Cloudflare: domain, DNS, nameservers per registrar, the limited key that is never
 *     saved, permissions, disconnect; Search Console: connection, client add-user, sync, up to 16 months, sitemaps):
 *     client/src/pages/site-connection-guide.tsx
 *   - Cloudflare + Search Console are an Agency-plan module: shared/plans.ts (modules.cloudflareSearchConsole)
 *   - the dashboard tile has no plan gate: shared/dashboard.ts
 */

const CONNECTIONS_PLAN = planNamesWhere((p) => p.modules.cloudflareSearchConsole);

const page: FeaturePage = {
  key: "guides",
  slug: "guides",
  group: "learn",
  status: "ready",
  title: "Guides",
  kicker: "Playbooks & how-tos",
  headline: { lead: "Guides That Show You ", swipe: "Where to Click" },
  lede:
    "Playbooks for Google Ads and Local Services Ads, state-by-state licensing guides, and step-by-step walkthroughs " +
    "for connecting your sites and setting up ConstructHUB's tools.",
  hero: { mascot: "standing", bubble: "Stuck on a setting? There's a guide for that." },
  steps: [
    {
      title: "Open the guide you need",
      body: "The setup walkthroughs open from Guides; the Ads Guide, LSA Guide and Ad Fraud page sit with the Google Ads tools in the sidebar.",
    },
    {
      title: "Pick the job in front of you",
      body: "A site behind Cloudflare, Search Console, Profile Guard, review replies, posting or Site Scan: each walkthrough names the buttons in order.",
    },
    {
      title: "Do it alongside",
      body: "Each walkthrough links to the page it describes, so you can make the change while you read the step.",
    },
    {
      title: "Go deeper on ads",
      body: "Read the LSA guide free, then unlock the Google Ads guide's 12 sections with any Master Class purchase.",
    },
  ],
  cards: [
    {
      icon: "megaphone",
      title: "Google Ads guide",
      body: "12 sections for contractor campaigns: setup, settings to switch off, assets, keywords, location targeting, bidding, ad copy, landing pages, IP exclusions, tracking, click fraud and a launch checklist.",
    },
    {
      icon: "target",
      title: "LSA guide",
      body: "8 sections on Local Services Ads: verification, answering calls, reviews, choosing services, message leads, service areas and hours, photos and your bio. Free to read.",
    },
    {
      icon: "shield-alert",
      title: "Ad Fraud",
      body: "ConstructHUB's view on invalid clicks in contractor ads, and the steps to act on it with Click Guard and your own Google Ads account.",
    },
    {
      icon: "map",
      title: "State licensing guides",
      body: "Every state's formation, workers' comp and tax agencies, and its licensing board where there is one. The comparison table is free; the full guides are part of the Master Class.",
    },
    {
      icon: "cloud",
      title: "Site connection guide",
      body: "Put a site behind Cloudflare and connect it with a limited key, then connect Search Console and sync up to 16 months of history.",
    },
    {
      icon: "list",
      title: "Setup walkthroughs",
      body: "Profile Guard, AI review replies, Posts & Photos scheduling, social posting and auto mode, account security and Site Scan, button by button.",
    },
  ],
  spotlight: {
    kicker: "Site Connection Guide",
    heading: { title: "Connect a Client Site ", em: "Without Guesswork" },
    points: [
      "Nameserver steps for common registrars, and a reminder to keep email records before you switch.",
      "Your Cloudflare Global Key is used once to create a limited ConstructHUB key, and is never saved.",
      "The limited key asks for zone read, analytics read and firewall rule edits on the zones you pick, with no DNS edit, billing or member access.",
      "What disconnecting removes, and what you still revoke yourself in Cloudflare or your Google Account.",
    ],
    panel: {
      label: "The walkthrough",
      title: "Steps it covers",
      items: [
        "Add the domain", "Check DNS records", "Switch nameservers", "Create the limited key", "Agency member option",
        "Connect Search Console", "Client adds the agency user", "Sync properties", "Submit sitemaps", "Disconnect and revoke",
      ],
      note: `Connecting Cloudflare and Search Console in ConstructHUB is part of the ${CONNECTIONS_PLAN} plan.`,
    },
  },
  audience: [
    {
      title: "Contractors running their own ads",
      body: "Set up Google Ads campaigns with the playbook before you spend, and use the LSA guide for Local Services Ads.",
    },
    {
      title: "Agencies onboarding client sites",
      body: "Give clients the exact Cloudflare and Search Console steps, including what access to grant and what not to.",
    },
    {
      title: "New ConstructHUB accounts",
      body: "Follow the walkthroughs to set up Profile Guard, review replies, posting and Site Scan the first time.",
    },
  ],
  pricing: {
    kind: "account",
    note: "The Google Ads guide's sections and the full state guides come with a Master Class purchase.",
  },
  faqs: [
    {
      q: "Which guides are free?",
      a: "The LSA guide and the Ad Fraud page are open to anyone. The setup walkthroughs are free with a ConstructHUB account. The Google Ads guide's overview is free; its 12 sections unlock with any Master Class purchase.",
    },
    {
      q: "Where are the state guides?",
      a: "In the Master Class: a guide for each of the 50 states with its formation, licensing, workers' comp and tax agencies. The list of states that require a license and the comparison table are free; each state's full guide unlocks with the Business Formation & Licensing module or the bundle.",
    },
    {
      q: "What do I need for the Cloudflare and Search Console steps?",
      a: `Your own Cloudflare account and access to your domain registrar, or a Google account with access to the site's Search Console property. Connecting them inside ConstructHUB is part of the ${CONNECTIONS_PLAN} plan; the walkthrough itself is free to read.`,
    },
    {
      q: "What don't the guides do?",
      a: "They don't change anything for you: you make each change in ConstructHUB, Google Ads, Cloudflare or your registrar. They are our recommendations, not a promise of results, and not legal or tax advice. Provider screens change; when they differ, the walkthroughs point you to the provider's current help.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the Google Ads advice is
  // server/google-ads-guide-content.ts (Search Partners off, "Presence" location option, specific keywords, IP
  // exclusions); the section text served only after a purchase is server/routes.ts /api/google-ads-guide/:slug
  // (403 otherwise, titles public); the LSA advice is client/src/pages/lsa-guide.tsx SECTIONS (services, "Other",
  // counties, 24-hour ads, message leads); the walkthrough warnings are client/src/pages/guides.tsx (drafts, retry
  // duplicates, Lockdown, share links, opening a notice) and site-connection-guide.tsx (48 hours, email records).
  inDepth: {
    heading: { title: "Google Ads and LSA Guides for ", em: "Contractors" },
    paragraphs: [
      "Guides is where ConstructHUB keeps its how-to material for contractors who run their own marketing. The " +
        "playbooks are opinionated on purpose: they say what we would do in your account and why, so you can decide " +
        "for yourself. The setup walkthroughs are the opposite, plain instructions that use the same button names you " +
        "see on screen.",
      "The Google Ads guide for contractors is built around one idea: pay only for clicks from people who could " +
        "hire you. It recommends switching off Search Partners, choosing the location option that targets people in " +
        "or regularly in your service area instead of the broader default, using specific keywords rather than broad " +
        "match, and building an IP exclusion list from the visits Click Guard records on your site, reviewed before " +
        "you block anyone. The overview and the section " +
        "titles are public. The text of each section is sent only to accounts with a Master Class purchase, and that " +
        "check happens on our server, not just on the page.",
      "The Local Services Ads guide is free to read, with no account. Its advice is about the settings that decide " +
        "which leads you pay for: check only the services you actually do and leave the catch-all Other category " +
        "unchecked, choose service areas by county so there are no gaps, keep the ad showing around the clock even " +
        "if you return late calls in the morning, and think twice before turning on message leads.",
      "The setup walkthroughs also say what a button does not do, which is where most setup mistakes happen. A " +
        "generated review reply is a draft until it is published. Retrying a Google post whose result is uncertain " +
        "can publish it twice, so check Google first. Profile Guard's Lockdown restores changes but can't stop an " +
        "edit at Google. A Site Scan share link can be read by anyone who has it. Opening a security notice doesn't " +
        "disconnect anything. The site connection guide warns you to keep your email records before you switch " +
        "nameservers, and that the switch can take up to 48 hours.",
      "None of the guides change anything for you, and none of them promise rankings, leads or a lower cost per " +
        "click. Google and Cloudflare change their screens from time to time; when a screen doesn't match, the " +
        "walkthroughs point you to the provider's current help.",
    ],
  },
  related: ["masterClass", "clickGuard", "cloudflare"],
  app: { href: "/guides", surface: "app", label: "Open Guides" },
  tryIt: { label: "Read the free LSA guide", href: "/lsa-guide" },
  headings: {
    steps: { title: "Find the Right Guide in ", em: "Four\u00a0Steps" },
    cards: { title: "Every Guide, ", em: "in One Place" },
    faq: { title: "Before You ", em: "Start Reading" },
  },
  seo: {
    title: "Google Ads & LSA Guides for Contractors | ConstructHUB",
    description:
      "Google Ads and Local Services Ads playbooks for contractors, state licensing guides, and step-by-step setup guides for Cloudflare and Search Console.",
  },
  sources: [
    "client/src/pages/guides.tsx",
    "client/src/pages/social-media.tsx",
    "client/src/pages/google-ads-guide.tsx",
    "client/src/pages/google-ads-guide-section.tsx",
    "client/src/pages/lsa-guide.tsx",
    "client/src/pages/google-ad-fraud.tsx",
    "client/src/pages/site-connection-guide.tsx",
    "client/src/pages/master-class.tsx",
    "client/src/App.tsx",
    "server/routes.ts",
    "server/google-ads-guide-content.ts",
    "server/data/state-guides.json",
    "server/state-guides-schema.ts",
    "shared/dashboard.ts",
    "shared/plans.ts",
  ],
};

export default page;
