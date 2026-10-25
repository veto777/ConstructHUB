import type { FeaturePage } from "./types";

/**
 * Yelp. Every claim below is backed by the code in `sources`:
 *   - connect a business found by name and city, up to 50 per account, rating, review count, details: server/yelp/service.ts
 *     (search, connect, countCap 50), server/yelp/client.ts
 *   - the latest reviews: Yelp's API returns up to 3 recent ones, each shortened (client.ts yelpReviews) — so the page
 *     says "latest reviews" and the FAQ says Yelp limits them
 *   - daily rating and review-count snapshots (the trend) and a notification when the review count goes up: service.ts
 *     fetchAndStore (notifyUser "yelp.new_review")
 *   - nearby competitors in the same category, marked when their rating is higher: service.ts competitors()
 *   - AI-drafted replies, posted by the owner on Yelp through a link, because Yelp's API has no reply endpoint:
 *     service.ts draftReply, client/src/pages/yelp.tsx
 *   - any plan: /api/yelp is behind the platform paywall (server/platform-access.ts) with no plan test of its own
 */

const page: FeaturePage = {
  key: "yelp",
  slug: "yelp",
  group: "grow",
  status: "ready",
  title: "Yelp",
  kicker: "Yelp reputation",
  headline: { lead: "Your Yelp Rating and Reviews, ", swipe: "Watched for You" },
  lede:
    "Connect your Yelp business and see its rating, latest reviews and 30-day trend next to the rest of your marketing. " +
    "Get told when a new review comes in, draft a reply with AI, and see how nearby competitors rate.",
  hero: { mascot: "standing", bubble: "Let's keep an eye on what Yelp says about you." },
  steps: [
    { title: "Find your business", body: "Search Yelp by your business name and city, then connect the right listing. Agencies can connect several." },
    { title: "See where you stand", body: "Your star rating, review count and the latest reviews, with a 30-day trend built from daily snapshots." },
    { title: "Hear about new reviews", body: "When your review count goes up you get a notification, so a new review never sits unanswered." },
    { title: "Reply in minutes", body: "Draft a reply with AI, edit it, then post it on Yelp through the link. Yelp only takes replies on its own site." },
  ],
  cards: [
    { icon: "star", title: "Rating and review count", body: "Your current Yelp stars and how many reviews you have, refreshed and kept for you." },
    { icon: "trending-up", title: "A 30-day trend", body: "Daily snapshots of your rating and review count show whether things are moving the right way." },
    { icon: "bell", title: "New review alerts", body: "A notification when your review count ticks up, so you can answer while the job is still fresh." },
    { icon: "sparkles", title: "AI reply drafts", body: "A reply drafted from the review itself, for you to edit and post on Yelp." },
    { icon: "target", title: "Nearby competitors", body: "Businesses in your Yelp category near you, with the ones rated higher than you marked." },
    { icon: "layers", title: "Several businesses", body: "Connect more than one Yelp listing, for more locations or for the clients you manage." },
  ],
  spotlight: {
    kicker: "Your Listing",
    heading: { title: "Everything Yelp Shows About You, ", em: "in One Place" },
    points: [
      "The rating and review count customers see on Yelp, kept up to date for you.",
      "Your latest reviews, each with a button to draft a reply.",
      "A trend line so a slow slide in stars is caught early.",
      "Nearby competitors in your category, ranked by rating.",
    ],
    panel: {
      label: "Your listing",
      title: "What the Yelp page shows",
      items: ["Star rating", "Review count", "Latest reviews", "30-day trend", "AI reply drafts", "Nearby competitors", "New review alerts"],
      note: "Replies are posted on Yelp by you; Yelp does not allow posting them from other apps.",
    },
  },
  audience: [
    { title: "Contractors whose customers use Yelp", body: "If homeowners in your area check Yelp before they call, you want to see every new review and answer it." },
    { title: "Owners who watch the competition", body: "See which nearby businesses in your category rate higher, and keep your own rating moving up." },
    { title: "Agencies and multi-location companies", body: "Connect several Yelp listings and keep every location's rating and reviews in view." },
  ],
  pricing: { kind: "plan", note: "Connect up to 50 Yelp businesses on one account." },
  faqs: [
    { q: "Which plans include Yelp?", a: "Every ConstructHUB plan, including a trial. There is no extra charge for it." },
    { q: "Can I reply to reviews from ConstructHUB?", a: "You draft the reply here, then post it on Yelp through the link. Yelp does not let other apps post replies, so the last click is always on Yelp." },
    { q: "Why do I only see a few reviews?", a: "Yelp shares only a few of the newest reviews with other apps, and shortens their text. Your full rating and review count are always shown, and a link opens your listing on Yelp to read the rest." },
    { q: "Do I need a Yelp login?", a: "No. You find your business by name and city and connect it. Yelp's public business data is all it needs." },
  ],
  inDepth: {
    heading: { title: "Yelp Review Monitoring for Contractors, ", em: "Explained" },
    paragraphs: [
      "Many homeowners look a contractor up on Yelp before they call, and the star rating and the newest reviews are the " +
        "first things they see. The Yelp page in ConstructHUB keeps that view in front of you, next to your Google profile, " +
        "reviews and the rest of your marketing, so you do not have to remember to check Yelp yourself.",
      "You connect your business by searching Yelp for your company name and city and picking your listing. From then on " +
        "the page shows your current rating, your review count and your latest reviews. A snapshot is kept every day, so " +
        "the 30-day trend shows whether your rating and review count are rising or slipping, and a notification tells you " +
        "when a new review has come in.",
      "Answering reviews, good and bad, shows future customers that you care about the work. Press the reply button on a " +
        "review and the AI drafts an answer from what the customer wrote. Edit it until it sounds like you, then open the " +
        "review on Yelp and post it there. Yelp does not allow any outside app to post replies, so ConstructHUB never posts " +
        "for you and never needs your Yelp password.",
      "The competitor view looks at businesses in your Yelp category near your listing and marks the ones rated higher " +
        "than you. It is a quick way to see where you stand locally and how many stars the businesses around you have.",
    ],
    bulletsIntro: "What you can do on the Yelp page:",
    bullets: [
      "Connect one or more Yelp business listings by name and city",
      "See the rating, review count and the latest reviews for each",
      "Follow a 30-day trend built from daily snapshots",
      "Get a notification when a new review arrives",
      "Draft replies with AI and post them on Yelp",
    ],
  },
  related: ["reviews", "gbp", "social"],
  app: { href: "/yelp", surface: "app" },
  headings: {
    steps: { title: "From Search to Reply in ", em: "Four Steps" },
    cards: { title: "What the Yelp Page ", em: "Gives You" },
    faq: { title: "Before You ", em: "Connect Yelp" },
  },
  seo: {
    title: "Yelp Review Monitoring for Contractors | ConstructHUB",
    description:
      "Watch your Yelp rating, latest reviews and 30-day trend, get alerts for new reviews, draft replies with AI and compare nearby competitors.",
  },
  sources: [
    "server/yelp/service.ts",
    "server/yelp/client.ts",
    "server/yelp/routes.ts",
    "client/src/pages/yelp.tsx",
    "server/platform-access.ts",
  ],
};

export default page;
