import type { FeaturePage } from "./types";
import { ALACARTE } from "../alacarte";
import { planNamesWhere } from "../plan-copy";

/**
 * Social Media — every claim is backed by the code in `sources`:
 *   - ConstructHUB connects the customer's accounts itself: the customer signs in to each network from Social Media →
 *     Accounts (ConstructHUB Direct, server/social/native.ts, and ConstructHUB's Outstand account, server/social/outstand.ts);
 *     no separate posting subscription; the stored connection is encrypted, never shown again:
 *     client/src/components/social-connect.tsx, server/social/client.ts encryptKey, server/social/schedule.ts connection()
 *   - networks: X (Twitter), Facebook, Instagram, LinkedIn, Threads, Bluesky, TikTok, YouTube, Pinterest, with a
 *     per-network text tweak and character cap: shared/social.ts platforms / socialLimits
 *   - up to 20 destinations and 10 public media links per post, uploads under 100 MB, post now / schedule / draft:
 *     shared/social.ts postSchema, social-media.tsx upload()
 *   - a business comes from Locations; accounts and pages are mapped per business: social-media.tsx BusinessSelector,
 *     server/social/routes.ts (/mapping, /accounts/:id/targets)
 *   - calendar & approval queue with a status per destination; queued/accepted ≠ confirmed publication:
 *     server/social/routes.ts (/posts/:id/action, /calendar), client/src/pages/guides.tsx ("Manual posting")
 *   - auto mode: approval queue by default, fully automatic only when chosen; cadence, content mix (project, tips,
 *     reviews, offers, Google updates), blackout hours, daily AI budget; missing sources reported, not invented:
 *     shared/social.ts autoSchema / mixTypes, server/social/service.ts generateDue, server/social/gbp-sources.ts
 *   - bulk tools: {business} {city} {phone} placeholders, all-clients calendar, up to 100 posts per bulk action:
 *     guides.tsx ("Agency social workflows"), server/social/agency.ts
 *   - the "How it works" guides tab: social-media.tsx → GuidesContent (client/src/pages/guides.tsx)
 *   - notices: server/notification-kinds.ts social.post_published / social.post_failed
 *   - pricing: every /api/social route is behind requireModule("socialPublishing") (server/social/routes.ts), a
 *     module of the Pro plan and up (shared/plans.ts PLANS[*].modules.socialPublishing), or of the à la carte
 *     "Social media publishing" item (shared/alacarte.ts) — never "every plan". The plan names below are read
 *     from the price book, never typed.
 */

/** The plans whose modules include social publishing, cheapest first ("Pro, Agency and Unlimited"). */
const SOCIAL_PLANS = planNamesWhere((plan) => plan.modules.socialPublishing);
/** The plans without it ("Solo and Team"), which can add the à la carte item instead. */
const PLANS_WITHOUT = planNamesWhere((plan) => !plan.modules.socialPublishing);

const page: FeaturePage = {
  key: "social",
  slug: "social",
  group: "grow",
  status: "ready",
  title: "Social Media",
  kicker: "Social posting",
  headline: { lead: "Write Once, Post to ", swipe: "Every Account" },
  lede:
    "Compose a post, adjust it for each network, and publish now or on a schedule from one calendar per business. " +
    "Auto mode can draft posts from your offers and Google updates for you to approve.",
  hero: { mascot: "standing", bubble: "One post, all your accounts. Let's write it." },
  steps: [
    {
      title: "Connect your social accounts",
      body: "Sign in to each network from Social Media → Accounts. ConstructHUB connects your accounts directly; there's no separate posting service to buy.",
    },
    {
      title: "Map accounts to a business",
      body: "Pick a business from Locations and choose the pages and accounts it posts to.",
    },
    {
      title: "Compose and schedule",
      body: "Write the post, tweak it for each network, add photos or video, then post now, schedule it, or save a draft.",
    },
    {
      title: "Follow every destination",
      body: "The calendar shows each account's own status, with a link to the post once it's live.",
    },
  ],
  cards: [
    {
      icon: "send",
      title: "One post, many networks",
      body: "Facebook, Instagram, LinkedIn, X, Threads, Bluesky, TikTok, YouTube and Pinterest, up to 20 destinations per post.",
    },
    {
      icon: "settings",
      title: "Tuned for each network",
      body: "A text tweak and character counter per network, plus the settings some need, like a YouTube title and TikTok privacy.",
    },
    {
      icon: "calendar",
      title: "Calendar and approval queue",
      body: "Drafts wait for approval. Approve and queue them, or cancel anything not yet sent.",
    },
    {
      icon: "bot",
      title: "Auto mode, with approval",
      body: "Set how often to post, the mix of topics, quiet hours and a daily AI budget. Drafts wait for you unless you choose fully automatic.",
    },
    {
      icon: "database",
      title: "Written from real material",
      body: "Auto mode draws on the offers you save and recent updates from your linked Google profile. Missing material is reported, not made up.",
    },
    {
      icon: "image",
      title: "Photos and video",
      body: "Upload media, attach a synced business photo, or use any public link, up to 10 per post.",
    },
    {
      icon: "layers",
      title: "Many businesses at once",
      body: "Write one update with the business name, city and phone filled in for each business, and see every client on one calendar.",
    },
    {
      icon: "book",
      title: "Guides built in",
      body: "The How it works tab walks you through connecting, manual posting, auto mode and multi-business workflows.",
    },
  ],
  audience: [
    {
      title: "Contractors who post now and then",
      body: "Write the post once and send it everywhere, instead of logging in to each network.",
    },
    {
      title: "Owners who want a steady feed",
      body: "Let auto mode draft from your offers and Google updates, then approve the week's posts in one sitting.",
    },
    {
      title: "Agencies running client accounts",
      body: "A calendar per client and one across all of them, with bulk drafts and per-business schedules.",
    },
  ],
  pricing: {
    kind: "module",
    module: "socialPublishing",
    note: `Also sold on its own as the ${ALACARTE.social.name} item, for an account without one of these plans. ConstructHUB connects your social accounts directly and doesn't count your posts.`,
  },
  faqs: [
    {
      q: "What do I need?",
      a: "The social accounts you post to, which you connect by signing in to each network from Social Media → Accounts. There's no separate posting service to buy. You also need the business in Locations, so its posts and calendar stay together.",
    },
    {
      q: "Which plans include it?",
      a: `The ${SOCIAL_PLANS} plans. On ${PLANS_WITHOUT}, or with no plan, you can add the ${ALACARTE.social.name} item on its own from the pricing page. ConstructHUB doesn't count your posts.`,
    },
    {
      q: "Will it post without me?",
      a: "Only if you choose it. Auto mode starts with an approval queue, and fully automatic publishing is a separate choice you make. Turning auto mode off sends pending automatic posts back to drafts.",
    },
    {
      q: "How do I know a post went live?",
      a: "Each destination has its own status. A queued or accepted post isn't confirmed until the network publishes it; when it is, the calendar links to it. If a status is unclear, check the account on the network before posting again.",
    },
    {
      q: "Is there a walkthrough?",
      a: "Yes. The How it works tab on the Social Media page has step-by-step guides for connecting your social accounts, manual posting, auto mode and multi-business work.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the encrypted connection is
  // server/social/client.ts encryptKey + service.ts (native / Outstand connect); per-network tweaks, titles and limits, 10 media links and 20
  // destinations are shared/social.ts postSchema/socialLimits; per-destination status and queued ≠ published are
  // server/social/routes.ts + client/src/pages/guides.tsx ("Manual posting"); the content mix and its sources (photos
  // from the linked profile or Media Library, tips, synced reviews, offers and Google updates from the last 30 days)
  // are server/social/service.ts sourceFor; the draft rules are service.ts generatePostText; cadence, quiet hours,
  // time zone, daily AI budget, approval vs automatic, and queued automatic posts back to drafts are shared/social.ts
  // autoSchema/inBlackout + service.ts saveSettings and the publish loop.
  inDepth: {
    heading: { title: "Social Media Scheduling for Contractors, ", em: "Explained" },
    paragraphs: [
      "Social Media is a social media scheduler: you write a post once, adjust it for each network, and send it to " +
        "the pages and accounts you've mapped to a business. You connect each social account by " +
        "signing in to the network from ConstructHUB; the connection is stored encrypted and never shown again, and " +
        "ConstructHUB publishes each post to every destination you picked.",
      "Each network has its own rules, so each destination gets its own text tweak and character counter, plus the " +
        "settings some networks require, such as a YouTube title or TikTok privacy. Once a post is sent, every " +
        "destination keeps its own status. A post that is queued or accepted isn't confirmed until the network " +
        "publishes it; when it is, the calendar links to the live post. If a status stays unclear, check before " +
        "posting again so the same post doesn't go out twice.",
      "Auto mode drafts posts from material that already exists, in the mix you choose: project photos from your " +
        "linked Google profile or Media Library, general maintenance tips, your synced Google reviews, and the offers " +
        "and Google updates saved in the last 30 days. Each draft is a short post written only from that material and " +
        "your business facts, and the AI is told never to invent completed work, customer quotes, offers, credentials or " +
        "results. When a type has nothing to draw on, such as no recent offer, auto mode reports it instead of making " +
        "one up.",
      "You set how often auto mode posts, one to seven times per day or per week, your time zone, quiet hours when " +
        "automatic posts wait, and a daily AI budget. Drafts wait in the approval queue by default. Fully automatic " +
        "publishing is a separate setting, and switching back to approval returns queued automatic posts to drafts. " +
        "ConstructHUB doesn't bill per post or count your posts.",
    ],
  },
  // Prices read on 2026-10-10 from: socialpilot.co, mymarky.ai, vistasocial.com/pricing, buffer.com/pricing
  // (~/codex-audits/a-la-carte-competitors.md → social).
  compare: {
    alacarte: ["social"],
    checkedOn: "2026-10-10",
    competitors: [
      { name: "Marky", price: { kind: "monthly", cents: 3900 }, note: "contractor-specific: job photos to posts, posts to Google Business Profile", source: "https://www.mymarky.ai/" },
      { name: "SocialPilot", price: { kind: "monthly", cents: 3000 }, source: "https://www.socialpilot.co/" },
      { name: "Buffer", price: { kind: "monthly_from", cents: 500 }, per: "per channel", source: "https://buffer.com/pricing" },
    ],
    onlyUs: [
      "Auto mode writes only from real material — your offers, Google updates and reviews — and reports what's missing instead of inventing it.",
      "A daily AI budget and quiet hours, with drafts that wait for your approval unless you choose fully automatic.",
      "Bulk posting across every business you manage, with placeholders per business.",
    ],
    theyNotUs: "Ours does not post to your Google profile from here (that is AI Google posts); Marky does.",
  },
  related: ["gbpContent", "media", "gbp"],
  app: { href: "/social-media", surface: "app" },
  headings: {
    steps: { title: "Posting Everywhere in ", em: "Four\u00a0Steps" },
    faq: { title: "Before You ", em: "Connect" },
  },
  seo: {
    title: "Social Media Scheduler for Contractors | ConstructHUB",
    description:
      "Write a post once, tune it per network and publish now or on a schedule. Auto mode drafts posts from your offers, photos and Google updates to approve.",
  },
  sources: [
    "client/src/pages/social-media.tsx",
    "client/src/pages/guides.tsx",
    "client/src/components/social-connect.tsx",
    "shared/social.ts",
    "server/social/client.ts",
    "server/social/schedule.ts",
    "server/social/native.ts",
    "server/social/outstand.ts",
    "server/social/service.ts",
    "server/social/routes.ts",
    "server/social/agency.ts",
    "server/social/gbp-sources.ts",
    "server/notification-kinds.ts",
    "server/routes.ts",
  ],
};

export default page;
