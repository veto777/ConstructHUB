import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { planNamesWhere } from "../plan-copy";

/**
 * Google Reviews — every claim is backed by the code in `sources`:
 *   - review requests by email (name + email required, personal note, job photos, email theme, BCC, company
 *     name/logo, send now or schedule): server/routes.ts POST /api/reviews/create, processScheduledReviews;
 *     client/src/pages/google-reviews.tsx (Send Review Request dialog)
 *   - saved review profiles / templates (Google review link + default job description), capped by the plan's
 *     reviewTemplates: server/routes.ts POST /api/review-templates (requirePlan … reviewTemplates)
 *   - follow-up reminders (interval, how many, time windows, timezone): server/review-reminders.ts, processReminders
 *   - unsubscribe honoured (409 on a suppressed address): server/routes.ts isReviewSuppressed, server/review-suppression.ts
 *   - the client's page: private 1–10 rating, "Help Us Improve" private feedback, the public review step
 *     (and its showReview flag) only at or above the owner's threshold, AI draft built only from the
 *     client's own words (never the private score), copy-and-paste into Google:
 *     server/routes.ts /api/review/:token/feedback + /generate-review, server/review-draft.ts, client/src/pages/review-feedback.tsx
 *   - what is tracked per request (email opened, link clicked, rating, Google link opened, reminders sent):
 *     shared/schema.ts reviewRequests, /api/review/:token/pixel.png + /click + /google-link-opened
 *   - Google Profile Reviews tab (synced reviews, rating + answered filters, private notes, reply):
 *     google-reviews.tsx, server/gbp/service.ts syncLocation, server/gbp/routes.ts (reply)
 *   - AI replies (off / draft / auto, tone, sign-off, length, per-star rules, 1–2 star stay drafts unless allowed,
 *     up to 50 a day, auto-publish only where autoPublishAiReplies): server/gbp/review-automation.ts,
 *     client/src/components/ai-review-replies.tsx, server/routes.ts registerPlanGates (/ai-replies)
 *   - new-review alerts (in app + email by default, first import silent): server/notification-kinds.ts gbp.new_review,
 *     review-automation.ts notifyNewReviews
 *   - Report: prepares evidence + opens Google's form, "a negative rating alone is not a policy violation":
 *     client/src/components/profile-guard.tsx GoogleReport
 *   - no gating, no incentives: client/src/lib/features.ts (SHOW_GOOGLE_REVIEWS note)
 *   - feedback routing: the owner's 1–10 escalation threshold (default 8); a score below it shows the private form
 *     first and alerts the owner at once (bell + email, Telegram when the LSA bot is linked) with name, score, job
 *     and the client's words, then the Google step; at or above it straight to the Google step; the Google link is
 *     shown on every step whatever the score: shared/review-flow.ts, server/review-escalation.ts,
 *     server/routes.ts /api/review/:token/feedback + /api/review-escalation-settings, google-reviews.tsx
 *     FeedbackRoutingCard ("Caught privately" tile, "Private feedback · n/10" badge)
 *   - other review sites on a profile (Yelp, BBB, Houzz, Angi, HomeAdvisor, Facebook, Nextdoor, Thumbtack, other;
 *     pasted links, up to 8, copied onto the request when sent, offered on the step after Google to every client,
 *     opens recorded): shared/review-links.ts, server/routes.ts /api/review-templates + /api/review/:token +
 *     /other-link-opened, google-reviews.tsx (profile dialog "Other review sites"), review-feedback.tsx (bonus_reviews step)
 */

const TEMPLATES: FeatureAllowance = { limit: "reviewTemplates", unit: "saved review profiles", period: "count" };
const AUTO_PUBLISH_PLANS = planNamesWhere((plan) => plan.limits.autoPublishAiReplies);

const page: FeaturePage = {
  key: "reviews",
  slug: "reviews",
  group: "grow",
  status: "ready",
  title: "Google Reviews",
  kicker: "Reviews",
  headline: { lead: "A Gatekeeper for Your ", swipe: "Google Reviews" },
  lede:
    "Every client gets a feedback link after the job. You set the score that goes straight to Google, from 5 up to a " +
    "perfect 10, and anything below it comes to you privately first, while the client is still reachable.",
  hero: { mascot: "standing", bubble: "You pick the score that goes straight to Google." },
  steps: [
    {
      title: "Save your review link",
      body: "Add the Google review link for each listing as a review profile, with a default description of the work you do and, if you like, your review pages on other sites.",
    },
    {
      title: "Set your threshold",
      body: "Choose the score that goes straight to Google, anywhere from 5 to 10. It starts at 8. Set it to 10 if only perfection should go straight through.",
    },
    {
      title: "Send the request",
      body: "Enter the client's name and email, add a personal note or job photos, and send it now or schedule it. Reminders follow on their own.",
    },
    {
      title: "The client scores the job",
      body: "They score it privately from 1 to 10. At or above your threshold, straight to the Google step. Below it, the private form comes first and you're alerted at once. Every client is offered the Google link.",
    },
    {
      title: "Follow up and reply",
      body: "Clients who haven't answered get reminders on your schedule. Reviews from your linked profile sync in, ready for a reply.",
    },
  ],
  cards: [
    {
      icon: "filter",
      title: "The gatekeeper",
      body: "Set the score that goes straight to Google, from 5 up to 10. Anyone who scores below it is asked what you could have done better before anything else.",
    },
    {
      icon: "alert",
      title: "Alerted at once",
      body: "A bell in the app, an email, and a Telegram message when your alert bot is linked, with the client's name, score, job and their own words.",
    },
    {
      icon: "send",
      title: "Requests by email",
      body: "Your company name and logo, an optional personal note and job photos, a choice of email themes, and a copy to yourself by BCC.",
    },
    {
      icon: "bell",
      title: "Follow-up reminders",
      body: "Pick how often and how many times to remind clients who haven't answered, and the hours of the day reminders may go out.",
    },
    {
      icon: "star",
      title: "Google is offered to everyone",
      body: "The threshold decides who you hear from first, never who sees Google. The Google link is on the client's page at every step, whatever the score.",
    },
    {
      icon: "sparkles",
      title: "AI help, in the client's words",
      body: "If the client wants help, AI edits what they typed into a draft. They check it, then paste it into Google themselves.",
    },
    {
      icon: "message",
      title: "Your profile's reviews",
      body: "Reviews from each linked listing, filtered by stars or by answered and unanswered, with an alert in the app and by email when a new one lands.",
    },
    {
      icon: "bot",
      title: "AI reply drafts",
      body: "Set a tone, a sign-off, a length and a rule for each star rating. Replies wait for your approval unless you choose auto-publish.",
    },
    {
      icon: "link",
      title: "Your other review sites",
      body: "Paste your review page on Yelp, BBB, Angi, Houzz, HomeAdvisor and more. Pick a primary destination (usually Google) and which to include per request; clients are routed there, whatever their score.",
    },
  ],
  spotlight: {
    kicker: "The Gatekeeper",
    heading: { title: "Problems Come to You, ", em: "Not Google" },
    points: [
      "Pick any threshold from 5 to 10. At 10, only a perfect score goes straight to the Google step.",
      "Below the threshold, the client is asked what you could have done better before anything else.",
      "You're alerted the moment they answer, while there is still time to make it right.",
      "The Google Reviews page counts the requests caught privately and badges each one with its score.",
      "Routing only: every client is offered the Google link on every step of the page.",
    ],
    panel: {
      label: "Feedback routing",
      title: "What the alert carries",
      items: [
        "Client name", "Score out of 10", "Job description", "The client's own words", "Areas to improve",
        "Bell, email and Telegram", "Caught privately count", "Private feedback badge",
      ],
      note: "Routing only. Every client still sees the Google link, and Google doesn't tell us whether a review was posted.",
    },
  },
  audience: [
    {
      title: "Owners who want bad news first",
      body: "Set the gate high and every disappointing score reaches you before it reaches anyone else.",
    },
    {
      title: "Contractors who forget to ask",
      body: "Send the request when the job wraps up, and let reminders do the follow-up.",
    },
    {
      title: "Owners who reply to every review",
      body: "AI drafts in your tone, one queue to approve them from, and an alert when a new review lands.",
    },
    {
      title: "Several listings or brands",
      body: "One review profile per listing, so each request sends the client to the right Google page.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: TEMPLATES,
    note: `Every plan drafts AI replies for you to approve; publishing them automatically is included with the ${AUTO_PUBLISH_PLANS} plans.`,
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Your Google review link and your clients' email addresses. Links to your review pages on other sites are optional. To see and reply to the reviews on your profile, link the listing in Locations through a connected Google account.",
    },
    {
      q: "Which plans include it?",
      a: `Every plan includes review requests, the gatekeeper threshold, review alerts and AI reply drafts. Publishing AI replies automatically is included with the ${AUTO_PUBLISH_PLANS} plans. ${allowanceLine(TEMPLATES)}.`,
    },
    {
      q: "How does the threshold work, and can I change it?",
      a: "Pick it in Feedback routing on the Google Reviews page, from 5 to 10, and change it whenever you like. A score at or above it goes straight to the Google step; a score below it opens the private form first and alerts you. Every client is still offered the Google link, so this is not review gating, which Google doesn't allow.",
    },
    {
      q: "Will AI write reviews or replies on its own?",
      a: "It never writes a review for a client: it only edits the client's own words, and they post it themselves. Replies stay drafts unless you choose auto-publish, which still leaves 1 and 2 star reviews as drafts unless you allow them. AI replies are capped at 50 a day per account.",
    },
    {
      q: "Can it remove bad reviews?",
      a: "No. Only Google removes reviews. For a review that breaks Google's rules, Report gathers the evidence and opens Google's official form; a low rating on its own isn't a rule break.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the private 1–10 rating and the
  // showReview flag (false below the owner's threshold, where the client only gets the private form and the
  // owner alert) are server/routes.ts POST /api/review/:token/feedback; the threshold choices (5–10, default 8), the
  // routing and the owner alert are shared/review-flow.ts + server/review-escalation.ts; the AI review draft rules
  // (client's own words, criticism kept, no keywords, never the score) are server/review-draft.ts reviewDraftMessages;
  // reminders only to unanswered requests (status "sent"), up to 10, interval, windows and timezone are server/storage.ts
  // getPendingReminders + server/review-reminders.ts; suppression is server/review-suppression.ts; tracking is
  // shared/schema.ts reviewRequests; the AI reply rules, per-star rules, scope (new / existing reviews) and the
  // low-star hold are server/gbp/review-automation.ts (replyPrompt, shouldAutoPublish, replySettingsSchema, the existing-review preview).
  inDepth: {
    heading: { title: "How the Review Gatekeeper ", em: "Works" },
    paragraphs: [
      "Google Reviews is a review request tool for contractors with a gatekeeper built in. When a job wraps up, you " +
        "send the client an email with your company name and logo and a link to a short page, now or on a schedule. " +
        "There the client scores the job privately from 1 to 10 and can write what went well or what didn't. Asking " +
        "for Google reviews becomes one routine step at the end of every job. A profile can also hold your review " +
        "pages on other sites; clients are offered those on the last step, after Google.",
      "The gatekeeper is one setting: the score that goes straight to Google. You choose it in Feedback routing, " +
        "anywhere from 5 to 10, and it starts at 8. A client who scores at or above it goes straight to the Google " +
        "step. A client who scores below it is asked what you could have done better first, and you are alerted at " +
        "once in the app, by email and on Telegram when your alert bot is linked, with the client's name, score, job " +
        "and words. Set it to 10 and only a perfect score goes straight through. The Google Reviews page counts the " +
        "requests caught privately and badges each one with its score, so you can call while the client is still " +
        "reachable and fix the problem before it becomes a public review.",
      "The threshold decides who you hear from first, never who sees Google. Every client, whatever the score, is " +
        "offered the Google review link on every step of the page. Asking only happy clients, often called review " +
        "gating, is against Google's rules, and the page is built so it can't happen. If the client wants help with " +
        "the wording, AI edits what they typed into a first-person draft. It uses only their own words, keeps any " +
        "criticism, adds no keywords and never mentions the private score. The client checks the draft and posts it " +
        "on Google themselves.",
      "Reminders go only to clients who haven't answered yet. You set how many to send, up to 10, how far apart, and " +
        "the hours of the day they may go out in your time zone. A client who unsubscribes gets no more reminders and " +
        "can't be sent a new request. Each request records whether the email was opened, the link clicked, the job " +
        "scored and the Google link opened. Google doesn't report whether a review was posted, so the " +
        "request doesn't claim it.",
      "On the reply side, link the listing in Locations and its Google reviews sync in with the rest of the profile, " +
        "with an alert in the app and by email when a new one arrives. AI reply drafts follow the tone, sign-off, " +
        "length and per-star rules you set, and use only what the review says. Replies wait for your approval unless " +
        "you choose auto-publish on a plan that includes it. For a review that breaks Google's rules, Report " +
        "gathers the evidence and opens Google's official form.",
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
      "No review gating, by design: Google is offered to everyone, and a low rating also gets a private form for feedback.",
      "AI reply drafts written only from the client's own words, with per-star rules — one- and two-star replies stay drafts unless you allow them.",
      "Requests with your job photos and a personal note, sent now or scheduled, with follow-up reminders on your schedule.",
      "Your own review pages on other sites (Yelp, BBB, Houzz and more) pasted onto a profile and offered to every client after Google.",
    ],
    theyNotUs: "Review requests by text (ours go by email), monitoring of other review sites, and website widgets.",
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
      "A gatekeeper for your Google reviews: set the score that goes straight to Google, from 5 to 10. Lower scores reach you privately first.",
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
