import type { FeaturePage } from "./types";
import { HUB_PRESETS } from "../hub-presets";

/**
 * Gabe, the Hub assistant — the AI helper in the corner of the app and the public pages.
 *
 * Every claim below is backed by the code in `sources`:
 *   - signed out: preset chips only, no text box; signed in: chips + free-text chat; where the widget shows;
 *     the transcript lives in React state only (gone on reload or sign-out): client/src/components/hub/hub-widget.tsx
 *   - the preset questions and the welcome set for a brand-new account: shared/hub-presets.ts
 *   - free-text chat needs a signed-in account with a verified email (401/403 otherwise), 500 characters a message:
 *     server/hub/routes.ts, server/hub/access.ts (isBuilder)
 *   - 40 questions a day per account, 20 questions per chat, and the quick questions keep working after the limit:
 *     server/hub/limits.ts (HUB_LIMITS.userDaily), server/hub/turns.ts (MAX_USER_TURNS), server/hub/replies.ts (R_LIMIT)
 *   - no tools, no account data, no prices for sales-rep work, ConstructHUB topics only, English only, links only to
 *     ConstructHUB pages, answers from the knowledge pack + price book, the page the visitor is on:
 *     server/hub/prompt.ts (hardRulesText, systemPrompt, buildMessages), server/hub/knowledge.ts, server/hub/replies.ts
 *   - emails, phones, addresses and ID-like numbers are redacted before the model sees a message: server/hub/prefilter.ts (redact, forModel)
 *   - the only stored data: daily outcome counts (no text, no people) and cached preset answers: server/hub/store.ts, server/hub/index.ts
 *   - no plan check anywhere in the Hub: server/hub/routes.ts
 */

const QUICK_QUESTIONS = Object.keys(HUB_PRESETS).length;

const page: FeaturePage = {
  key: "gabe",
  slug: "gabe",
  group: "platform",
  status: "ready",
  title: "Gabe",
  kicker: "AI helper",
  headline: { lead: "Ask Gabe How ", swipe: "ConstructHUB", tail: " Works" },
  lede:
    "Gabe is the AI helper in the corner of the page. He explains what each feature does, how to set it up and what the plans include, " +
    "from ConstructHUB's own knowledge pack and price book. He can't see your account.",
  hero: { mascot: "gabe", bubble: "Ask me about any feature. I'll point you to the right page." },
  steps: [
    {
      title: "Tap a quick question",
      body: "On the public pages, Gabe answers quick questions about pricing, plans, the trial and the main features. No account needed.",
    },
    {
      title: "Sign in to ask your own",
      body: "With a verified email, type your own question about how ConstructHUB works or how to set something up.",
    },
    {
      title: "Get a short answer with a link",
      body: "He answers in a few short lines and links the ConstructHUB page where you do the step.",
    },
    {
      title: "Start fresh any time",
      body: "The chat lives only in your browser tab. Reload the page or sign out and it's gone.",
    },
  ],
  cards: [
    {
      icon: "message",
      title: `${QUICK_QUESTIONS} quick questions`,
      body: "Pricing, which plan fits, the trial, getting started, the CRM, the Agency plan, permits, Google tools, reviews, Click Guard, Site Scan, the Master Class and the AI Call Assistant.",
    },
    {
      icon: "book",
      title: "Answers from the knowledge pack",
      body: "He answers from ConstructHUB's own written knowledge pack. When it doesn't cover something, he says he's not sure and points you to a sales rep.",
    },
    {
      icon: "tag",
      title: "Prices from the price book",
      body: "Plans, prices and limits are filled in from the same price book the pricing page uses. He never offers a discount or works out a total.",
    },
    {
      icon: "map-pin",
      title: "Knows which page you're on",
      body: "Signed in, Gabe knows which feature you have open, so \"how do I set this up?\" gets an answer about that page.",
    },
    {
      icon: "link",
      title: "Links to the right page",
      body: "His links only go to ConstructHUB pages, so a step comes with the place to do it.",
    },
    {
      icon: "sparkles",
      title: "A welcome for new accounts",
      body: "A brand-new account gets a short welcome with the first questions to ask: getting started, your Google profile, the CRM and pricing.",
    },
  ],
  spotlight: {
    kicker: "Privacy",
    heading: { title: "He Can't See ", em: "Your Account" },
    points: [
      "Gabe has no tools and no access to accounts, customers, leads, invoices or reviews. Ask about your own data and he points you to the page where you can check it.",
      "Your name and account are never part of his instructions: a question carries the fixed rules, the knowledge pack, the page you're on and your own words.",
      "Emails, phone numbers, addresses and ID-like numbers in your message are blanked out before it goes to the AI.",
      "No transcript is kept on the server. ConstructHUB counts outcomes per day, with no text and no names.",
    ],
    panel: {
      label: "What Gabe sees",
      title: "What goes into an answer",
      items: [
        "Fixed rules", "Knowledge pack", "Price book", "The page you're on", "Your question, contact details blanked out",
        "The last few turns of this chat",
      ],
      note: "Never your account, your customers or your data.",
    },
  },
  audience: [
    {
      title: "Visitors comparing plans",
      body: "Get the plans, prices and trial explained before you sign up.",
    },
    {
      title: "New accounts getting set up",
      body: "Ask how to connect Google, set up the CRM or run a first scan, and get a link to the page.",
    },
    {
      title: "Teams learning a feature",
      body: "Ask about the page you have open while you work, without leaving it.",
    },
  ],
  pricing: {
    kind: "account",
    note: "Quick questions work without an account; typing your own questions needs a signed-in account with a verified email.",
  },
  faqs: [
    {
      q: "Can Gabe see my account or my customers?",
      a: "No. He has no access to any account, customer, lead, invoice or review data, and the server keeps no copy of your chat. Ask about your own data and he points you to the page where you can check it yourself.",
    },
    {
      q: "What do I need to chat with him?",
      a: "Quick questions work for anyone on ConstructHUB's public pages. To type your own questions, sign in with a verified email. It isn't counted against any plan.",
    },
    {
      q: "Are there limits?",
      a: "A question can be up to 500 characters, a chat runs for up to 20 questions before you start a new one, and each account can ask up to 40 questions a day. The quick questions keep working after that.",
    },
    {
      q: "What won't he do?",
      a: "He won't look anything up, change a setting, or send, book or create anything. He won't price work that a sales rep quotes, and he only talks about ConstructHUB. He answers in English only.",
    },
    {
      q: "Can his answers be wrong?",
      a: "He's an AI helper, so check anything important on the page itself. His prices come from the price book, and when the knowledge pack doesn't cover a question he says he's not sure instead of guessing.",
    },
  ],
  related: ["crm", "gbp", "customerApi"],
  app: { href: "/", surface: "app", label: "Ask Gabe on your dashboard" },
  tryIt: { label: "Ask Gabe a quick question on the pricing page", href: "/pricing" },
  headings: {
    steps: { title: "From Quick Question to Your Own Chat in ", em: "Four\u00a0Steps" },
    cards: { title: "What Gabe ", em: "Can Do" },
    faq: { title: "Before You ", em: "Ask" },
  },
  seo: {
    title: "Gabe, the AI Helper in ConstructHUB | ConstructHUB",
    description:
      "Gabe answers questions about ConstructHUB's features, setup and plans from its own knowledge pack and price book. He can't see your account or your customers.",
  },
  sources: [
    "client/src/components/hub/hub-widget.tsx",
    "shared/hub-presets.ts",
    "server/hub/routes.ts",
    "server/hub/access.ts",
    "server/hub/limits.ts",
    "server/hub/turns.ts",
    "server/hub/replies.ts",
    "server/hub/prompt.ts",
    "server/hub/knowledge.ts",
    "server/hub/prefilter.ts",
    "server/hub/store.ts",
    "server/hub/index.ts",
  ],
};

export default page;
