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
 *   - the client's page: private 1–10 rating, "Help Us Improve" private feedback, EVERY rating gets showReview:true,
 *     AI draft built only from the client's own words (never the private score), copy-and-paste into Google:
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
  headline: { lead: "Ask Every Client for a ", swipe: "Google Review" },
  lede:
    "Send a short feedback request after each job, offer every client the Google review option whatever their " +
    "rating, and answer the reviews on your profile with AI reply drafts you approve.",
  hero: { mascot: "standing", bubble: "Let's ask your clients how the job went." },
  steps: [
    {
      title: "Save your review link",
      body: "Add the Google review link for each listing as a review profile, with a default description of the work you do.",
    },
    {
      title: "Send the request",
      body: "Enter the client's name and email, add a personal note or job photos, and send it now or schedule it for later.",
    },
    {
      title: "The client rates the job",
      body: "They rate the job privately, and every client, whatever the rating, is offered the option to leave a Google review.",
    },
    {
      title: "Follow up and reply",
      body: "Clients who haven't answered get reminders on your schedule. Reviews from your linked profile sync in, ready for a reply.",
    },
  ],
  cards: [
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
      body: "No review gating. Low ratings also get a private form for feedback, and the Google option is still there.",
    },
    {
      icon: "sparkles",
      title: "AI help, in the client's words",
      body: "If the client wants help, AI edits what they typed into a draft. They check it, then paste it into Google themselves.",
    },
    {
      icon: "message",
      title: "Your profile's reviews",
      body: "Reviews from each linked listing, filtered by stars or by answered and unanswered, with private notes only you can see.",
    },
    {
      icon: "bot",
      title: "AI reply drafts",
      body: "Set a tone, a sign-off, a length and a rule for each star rating. Replies wait for your approval unless you choose auto-publish.",
    },
    {
      icon: "alert",
      title: "New review alerts",
      body: "A notice in the app and by email when a new review arrives on a linked listing.",
    },
    {
      icon: "shield-alert",
      title: "Report a review",
      body: "For a review that breaks Google's rules, gather the evidence and open Google's official form. Google makes the decision.",
    },
  ],
  spotlight: {
    kicker: "Every Request",
    heading: { title: "See Where Each ", em: "Request\u00a0Stands" },
    points: [
      "Each request shows whether the email was opened, the link clicked and the job rated.",
      "A client's rating and private feedback come to you, never to Google.",
      "Reminders stop once the client answers, and an unsubscribed client can't be sent another request.",
      "Deleted requests go to a trash you can restore from.",
    ],
    panel: {
      label: "Review requests",
      title: "What each request tracks",
      items: [
        "Sent or scheduled", "Email opened", "Link clicked", "Private rating", "Private feedback",
        "Google link opened", "Reminders sent", "Unsubscribed",
      ],
      note: "Tracking shows what the client did on the page. Google doesn't tell us whether a review was posted.",
    },
  },
  audience: [
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
      a: "Your Google review link and your clients' email addresses. To see and reply to the reviews on your profile, link the listing in Locations through a connected Google account.",
    },
    {
      q: "Which plans include it?",
      a: `Every plan includes review requests, review alerts and AI reply drafts. Publishing AI replies automatically is included with the ${AUTO_PUBLISH_PLANS} plans. ${allowanceLine(TEMPLATES)}.`,
    },
    {
      q: "Do you only send happy clients to Google?",
      a: "No. Every client, whatever their rating, is offered the Google review option, and no reward is tied to leaving a review. Google doesn't allow review gating or paid reviews, and neither do we.",
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
  related: ["gbp", "profileGuard", "crm"],
  app: { href: "/google-reviews", surface: "app" },
  headings: {
    steps: { title: "From Finished Job to Review in ", em: "Four\u00a0Steps" },
    cards: { title: "What You Get With ", em: "Google\u00a0Reviews" },
    faq: { title: "Before You ", em: "Send a Request" },
  },
  seo: {
    title: "Google Review Requests and AI Replies | ConstructHUB",
    description:
      "Email every client a review request with reminders, offer each one the Google review option, and reply to your Google reviews with AI drafts you approve.",
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
    "server/notification-kinds.ts",
    "server/routes.ts",
    "shared/schema.ts",
    "shared/plans.ts",
  ],
};

export default page;
