import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { planNamesWhere } from "../plan-copy";
import { ALACARTE } from "../alacarte";

/**
 * Google Reviews — every claim is backed by the code in `sources`:
 *   - review requests by email (name + email required, personal note, job photos, email theme, BCC, company
 *     name/logo, send now or schedule): server/routes.ts POST /api/reviews/create, processScheduledReviews;
 *     client/src/pages/google-reviews.tsx (Send Review Request dialog)
 *   - review profiles (Google review link + default job description): paste a link or pick one of the
 *     owner's linked Google listings, which fills the name and link (connect Google first when no account is
 *     linked): server/routes.ts /api/review-templates/gbp-locations, client/src/pages/google-reviews.tsx
 *     (Add Google Business Profile dialog)
 *   - other review sites on a profile (Yelp, BBB, Houzz, Angi, HomeAdvisor, GuildQuality, Facebook,
 *     Nextdoor, Thumbtack, other; pasted links, up to 8), a PRIMARY destination (usually Google), and a
 *     per-request choice of which sites to include: shared/review-links.ts, google-reviews.tsx
 *     (Other review sites, Primary destination, Where to send them)
 *   - follow-up reminders (interval, how many, time windows, timezone): server/review-reminders.ts, processReminders;
 *     the settings answer 402 and reminders arm only with hasModule("reviewReminders") (server/routes.ts 6186–6360),
 *     a module of the Team plan and up (shared/plans.ts) or the à la carte Google Reviews item — names read below
 *   - removed reviews: every sync keeps a review Google stopped returning, with its full text, logs the change and
 *     alerts; "Copy for Google" assembles what Google's support form asks for, "Report a missing review to Google"
 *     links to that form: client/src/pages/locations.tsx ReviewsTab, help locations.reviews
 *   - unsubscribe honoured (409 on a suppressed address): server/routes.ts isReviewSuppressed, server/review-suppression.ts
 *   - the client's page: a public page, no account; a private 1–10 rating; a Back button to fix a mis-tapped
 *     rating; the "Help Us Improve" private form; the public review step (and its showReview flag) only at or
 *     above the owner's threshold; AI draft built only from the client's own words (never the private score),
 *     checked and posted by the client themselves: server/routes.ts /api/review/:token/feedback +
 *     /generate-review, server/review-draft.ts, client/src/pages/review-feedback.tsx
 *   - feedback routing: the owner's threshold (choices 5–10, default 8); a score below it shows the private form
 *     and alerts the owner at once (bell + email, Telegram when the LSA bot is linked) with name, score, job and
 *     the client's words, then the thank-you screen — the public review link and step are shown only at or above
 *     the threshold: shared/review-flow.ts, server/review-escalation.ts,
 *     server/routes.ts /api/review/:token/feedback + /api/review-escalation-settings, google-reviews.tsx
 *     FeedbackRoutingCard ("Caught privately" tile, "Private feedback · n/10" badge)
 *   - what is tracked per request (email opened, link clicked, rating, review link opened, reminders sent):
 *     shared/schema.ts reviewRequests, /api/review/:token/pixel.png + /click + /google-link-opened
 *   - Google Profile Reviews tab (synced reviews, rating + answered filters, private notes, reply):
 *     google-reviews.tsx, server/gbp/service.ts syncLocation, server/gbp/routes.ts (reply)
 *   - AI replies (off / draft / auto, tone, sign-off, length, per-star rules, 1–2 star stay drafts unless allowed,
 *     up to 50 a day, auto-publish only where autoPublishAiReplies): server/gbp/review-automation.ts,
 *     client/src/components/ai-review-replies.tsx, server/routes.ts plan registration (/ai-replies)
 *   - new-review alerts (in app + email by default, first import silent): server/notification-kinds.ts gbp.new_review,
 *     review-automation.ts notifyNewReviews
 *   - Report: prepares evidence + opens Google's form, "a negative rating alone is not a policy violation":
 *     client/src/components/profile-guard.tsx GoogleReport
 *   - no reward tied to a review (and no incentives): client/src/lib/features.ts (SHOW_GOOGLE_REVIEWS note)
 */

const TEMPLATES: FeatureAllowance = { limit: "reviewTemplates", unit: "saved review profiles", period: "count" };
const AUTO_PUBLISH_PLANS = planNamesWhere((plan) => plan.limits.autoPublishAiReplies);
/** Follow-up reminders are a plan module (reviewReminders), not part of every plan. */
const REMINDER_PLANS = planNamesWhere((plan) => plan.modules.reviewReminders);

const page: FeaturePage = {
  key: "reviews",
  slug: "reviews",
  group: "grow",
  status: "ready",
  title: "Google Reviews",
  kicker: "Reviews",
  headline: { lead: "Hear Every Customer, ", swipe: "Earn Every Review" },
  lede:
    "Send every customer a short feedback request after the job. Each one rates the work privately from " +
    "1 to 10: a rating below your threshold reaches you privately, and a happy customer is invited to " +
    "leave a public review.",
  hero: { mascot: "standing", bubble: "Every customer is heard. Happy customers are invited to review." },
  steps: [
    {
      title: "Set up a review profile",
      body: "Paste your Google review link or pick one of your linked Google listings and let the link fill in for you — connect Google first when no account is linked. Add your review pages on other sites and choose a primary destination.",
    },
    {
      title: "Set your threshold",
      body: "Pick the private score that invites the customer to review publicly, from 5 to 10. It starts at 8; set it to 10 if only a perfect score should skip the private form.",
    },
    {
      title: "Send the request",
      body: `Enter the customer's name and email, add a personal note or job photos, and send it now or schedule it. On the ${REMINDER_PLANS} plans, reminders follow up on their own with people who haven't answered.`,
    },
    {
      title: "The customer rates the job",
      body: "On a short public page — no account needed — they rate the work privately from 1 to 10. Below your threshold they get the private form and you are alerted at once; at or above it they are invited to review, with AI help from their own words.",
    },
    {
      title: "Reply from one place",
      body: "Reviews from your linked listing sync in, AI drafts replies you approve, an alert lands on each new review, and a Report tool covers reviews that break the rules.",
    },
  ],
  cards: [
    {
      icon: "link",
      title: "Profiles from your Google listings",
      body: "Add a review profile by pasting your Google review link or by picking one of your linked Google listings — the name and link fill in for you. No Google account linked yet? The dialog offers the connect step first.",
    },
    {
      icon: "globe",
      title: "Your other review sites",
      body: "Paste your review page on Yelp, BBB, Angi, Houzz, HomeAdvisor and more. Pick a primary destination (usually Google) and choose which sites to include on each request.",
    },
    {
      icon: "star",
      title: "Every customer is heard",
      body: "Every customer is asked for a private rating and their answer reaches you. The threshold only decides who is invited to review publicly: at or above it they get your review link, below it they are asked privately what could have been better.",
    },
    {
      icon: "filter",
      title: "Feedback routing",
      body: "You choose the threshold, from 5 to 10. A Back button lets a customer fix a mis-tapped rating before the private form goes to you, and the public review step is offered only at or above the threshold.",
    },
    {
      icon: "alert",
      title: "Alerted at once",
      body: "A bell in the app, an email, and a Telegram message when your alert bot is linked, with the customer's name, score, job and their own words.",
    },
    {
      icon: "send",
      title: "Requests by email",
      body: "Your company name and logo, an optional personal note and job photos, a choice of email themes, and a copy to yourself by BCC to help the message land.",
    },
    {
      icon: "bell",
      title: "Follow-up reminders",
      body: `Pick how often and how many times to remind customers who haven't answered, and the hours of the day reminders may go out. Reminders come with the ${REMINDER_PLANS} plans.`,
    },
    {
      icon: "sparkles",
      title: "AI help, in their words",
      body: "If the customer wants help, AI turns what they typed into a draft. They check it and post it themselves — it never posts for them and never mentions the private score.",
    },
    {
      icon: "message",
      title: "Reviews, replies and reports",
      body: "Reviews from each linked listing sync in, filtered by stars or answered and unanswered, with an alert when a new one lands. AI drafts replies you approve, and Report covers reviews that break Google's rules.",
    },
    {
      icon: "history",
      title: "Removed reviews kept",
      body: "When Google drops a review from your linked listing, the next sync keeps its full text, logs the change and alerts you. Copy for Google gathers what Google's support form asks for, and a link opens that form.",
    },
  ],
  spotlight: {
    kicker: "Feedback Routing",
    heading: { title: "Problems Come to You, ", em: "Not\u00a0Google" },
    points: [
      "Pick the private score that invites a public review, from 5 to 10. It starts at 8; at 10, only a perfect score is invited straight through.",
      "Below the threshold, the customer is asked what you could have done better before anything else — and a Back button lets them fix a mis-tapped rating.",
      "You're alerted the moment they answer, while there is still time to make it right.",
      "The Google Reviews page counts the requests heard privately and badges each one with its score.",
      "Every customer is heard: a rating below your threshold still reaches you, with the customer's own words.",
    ],
    panel: {
      label: "Feedback routing",
      title: "What the alert carries",
      items: [
        "Customer name", "Score out of 10", "Job description", "The customer's own words", "Areas to improve",
        "Bell, email and Telegram", "Caught privately count", "Private feedback badge",
      ],
      note: "Every customer is still heard, and Google doesn't tell us whether a review was posted.",
    },
  },
  audience: [
    {
      title: "Owners who want problems first",
      body: "Set the threshold high and every disappointing score reaches you at once, while the customer is still reachable.",
    },
    {
      title: "Contractors who forget to ask",
      body: "Send the request when the job wraps up, and let reminders do the follow-up on the plans that include them.",
    },
    {
      title: "Owners who reply to every review",
      body: "AI drafts in your tone, one queue to approve them from, and an alert when a new review lands.",
    },
    {
      title: "Several listings or brands",
      body: "One review profile per listing, so each request sends the customer to the right Google page.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: TEMPLATES,
    note: `Every plan drafts AI replies for you to approve. Follow-up reminders come with the ${REMINDER_PLANS} plans, and publishing AI replies automatically with the ${AUTO_PUBLISH_PLANS} plans.`,
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Your Google review link — or a connected Google account, so you can pick one of your listings when you set up a profile — plus your customers' email addresses. Links to your review pages on other sites are optional. To see and reply to the reviews on your profile, link the listing in Locations through a connected Google account.",
    },
    {
      q: "Which plans include it?",
      a: `Every plan includes review requests, feedback routing, review alerts, removed-review tracking and AI reply drafts. Follow-up reminders are included with the ${REMINDER_PLANS} plans, and publishing AI replies automatically with the ${AUTO_PUBLISH_PLANS} plans; the ${ALACARTE.reviews.name} item adds both on its own. ${allowanceLine(TEMPLATES)}.`,
    },
    {
      q: "How does the threshold work, and can I change it?",
      a: "Pick it in Feedback routing on the Google Reviews page, from 5 to 10, and change it whenever you like. A rating at or above it invites the customer to review publicly; a rating below it opens the private form and alerts you. Every customer is still heard — the rating and anything they write reach you either way.",
    },
    {
      q: "Will AI write reviews or replies on its own?",
      a: "It never writes a review for a customer: it only edits the customer's own words, and they post it themselves. Replies stay drafts unless you choose auto-publish, which still leaves 1 and 2 star reviews as drafts unless you allow them. AI replies are capped at 50 a day per account.",
    },
    {
      q: "Can it remove bad reviews?",
      a: "No. Only Google removes reviews. For a review that breaks Google's rules, Report gathers the evidence and opens Google's official form; a low rating on its own isn't a rule break.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the private 1–10 rating and the
  // showReview flag (false below the owner's threshold, where the customer only gets the private form and the
  // owner alert) are server/routes.ts POST /api/review/:token/feedback; the threshold choices (5–10, default 8), the
  // routing and the owner alert are shared/review-flow.ts + server/review-escalation.ts; the Back button is
  // client/src/pages/review-feedback.tsx (button-improvement-back); the linked-listing picker is server/routes.ts
  // /api/review-templates/gbp-locations + google-reviews.tsx; the primary destination and the per-request include
  // list are shared/review-links.ts; the AI review draft rules (customer's own words, criticism kept, no keywords,
  // never the score) are server/review-draft.ts reviewDraftMessages; reminders only to unanswered requests (status
  // "sent"), up to 10, interval, windows and timezone are server/storage.ts getPendingReminders +
  // server/review-reminders.ts; suppression is server/review-suppression.ts; tracking is shared/schema.ts
  // reviewRequests; the AI reply rules, per-star rules, scope (new / existing reviews) and the low-star hold are
  // server/gbp/review-automation.ts (replyPrompt, shouldAutoPublish, replySettingsSchema, the existing-review
  // preview); the Report tool is client/src/components/profile-guard.tsx GoogleReport.
  inDepth: {
    heading: { title: "How Feedback Routing ", em: "Earns You Reviews" },
    paragraphs: [
      "Google Reviews is a review request tool for contractors. When a job wraps up, you send the customer an " +
        "email with your company name and logo, an optional personal note and job photos, your choice of email " +
        "theme and a copy to yourself by BCC. Send it now or on a schedule; the email links to a short public " +
        "page, no account needed, where the customer rates the job privately from 1 to 10. On the plans that " +
        "include them, follow-up reminders go out on their own until the customer answers.",
      "A review profile holds your Google review link and a default description of the work. You can paste the " +
        "link, or pick one of your linked Google listings and have the name and link filled in for you; when no " +
        "Google account is linked, the dialog offers the connect step first. A profile can also carry your review " +
        "pages on other sites, like Yelp, BBB, Angi, Houzz and HomeAdvisor, and you choose a primary destination, " +
        "usually Google, plus which sites to include on each request.",
      "Feedback routing is one setting: the private score that invites the customer to review publicly. You pick " +
        "it from 5 to 10 and it starts at 8. A customer who rates at or above it is invited to leave a public " +
        "review on the primary destination, with the other included sites offered after. A customer who rates " +
        "below it is asked privately what you could have done better, and you are alerted at once in the app, by " +
        "email and on Telegram when your alert bot is linked, with their name, score, job and words. A Back " +
        "button lets a customer fix a mis-tapped rating before the private form goes to you. The Google Reviews " +
        "page counts the requests heard privately and badges each one with its score, so you can call while the " +
        "customer is still reachable.",
      "If an invited customer wants help with the wording, AI turns what they typed into a first-person draft. It " +
        "uses only their own words, keeps any criticism, adds no keywords and never mentions the private score. " +
        "The customer checks the draft and posts it themselves. A customer who unsubscribes gets no more " +
        "reminders and cannot be sent a new request.",
      "On the reply side, link the listing in Locations and its Google reviews sync in, with an alert in the app " +
        "and by email when a new one arrives. AI reply drafts follow the tone, sign-off, length and per-star rules " +
        "you set, and they wait for your approval unless you choose auto-publish on a plan that includes it. Each " +
        "request also records whether the email was opened, the link clicked, the job rated and the review link " +
        "opened; Google does not report whether a review was posted, so the request does not claim it. For a " +
        "review that breaks Google's rules, Report gathers the evidence and opens Google's official form; a low " +
        "rating on its own is not a rule break.",
    ],
  },
  // Prices read on 2026-10-10 from: get.nicejob.com/pricing, gatherup.com/pricing/, grade.us/home/plans/
  // (~/codex-audits/a-la-carte-competitors.md → reviews). Birdeye and Podium publish no price.
  compare: {
    alacarte: ["reviews"],
    checkedOn: "2026-10-10",
    competitors: [
      { name: "NiceJob", plan: "Starter", price: { kind: "monthly", cents: 7500 }, note: "Pro is more", source: "https://get.nicejob.com/pricing" },
      { name: "GatherUp", plan: "Small Business", price: { kind: "monthly", cents: 9900 }, per: "1 location", source: "https://gatherup.com/pricing/" },
      { name: "Grade.us", plan: "Small Business", price: { kind: "monthly", cents: 9900 }, source: "https://www.grade.us/home/plans/" },
      { name: "Birdeye / Podium", price: { kind: "quote" } },
    ],
    onlyUs: [
      "Every customer is heard: a low rating gets a private form and an instant alert, and only satisfied ratings are invited to the public review.",
      "AI reply drafts written only from the review's own words, with per-star rules — one- and two-star replies stay drafts unless you allow them.",
      "Requests with your job photos and a personal note, sent now or scheduled, with follow-up reminders on your schedule.",
      "Your own review pages on other sites (Yelp, BBB, Houzz and more) on a profile with a primary destination, and a per-request choice of what to include.",
    ],
    theyNotUs: "Review requests by text (ours go by email) and website widgets; outside Google, ours watches Yelp only, from the Yelp page.",
  },
  related: ["gbp", "profileGuard", "crm"],
  app: { href: "/google-reviews", surface: "app" },
  headings: {
    steps: { title: "From Finished Job to Review in ", em: "Five\u00a0Steps" },
    cards: { title: "What You Get With ", em: "Google\u00a0Reviews" },
    faq: { title: "Before You ", em: "Send a Request" },
  },
  seo: {
    title: "Google Review Requests for Contractors | ConstructHUB",
    description:
      "Hear every customer: send feedback requests after each job. Happy customers are invited to review you on Google; lower ratings reach you privately first.",
  },
  flag: "SHOW_GOOGLE_REVIEWS",
  sources: [
    "client/src/pages/google-reviews.tsx",
    "client/src/pages/review-feedback.tsx",
    "client/src/components/ai-review-replies.tsx",
    "client/src/components/profile-guard.tsx",
    "client/src/lib/features.ts",
    "server/gbp/review-automation.ts",
    "server/review-reminders.ts",
    "server/review-draft.ts",
    "server/review-suppression.ts",
    "server/review-escalation.ts",
    "shared/review-flow.ts",
    "shared/review-links.ts",
    "server/notification-kinds.ts",
    "server/routes.ts",
    "server/storage.ts",
    "shared/schema.ts",
    "shared/plans.ts",
  ],
};

export default page;
