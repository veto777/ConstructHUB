import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-reviews.tsx (the Review requests view) and shared/review-flow.ts as they run. */
const entry: HelpDraft = {
  key: "google-reviews.requests", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Review requests",
  whatItIs: "The first view of Google Reviews: send a client an email asking for a review, and follow what each client did.",
  whatItDoes: "New review request opens a form for the client’s name and email (phone and address optional), the profile whose review link to use, the other review sites to include, a project description or a personal message, photos, an email theme, a copy to a second address, and a send time. The list shows every request with its status: Pending, Google link opened, Positive, Feedback, Scheduled or Unsubscribed, plus the private score and the client’s own words when they left any. The five tiles count what was sent, how many opened the Google link, positive feedback, feedback caught privately and requests still waiting.",
  howToUse: [
    "Choose New review request, pick the profile, enter the client’s name and email, and add a description, a message or photos if you like.",
    "Tick Schedule for later to send it another day: pick a date and a time, or tap Tomorrow 9am, 3pm or 6pm. Leave it unticked to send now.",
    "Open a request in the list to read the client’s score, feedback, referral answer, when it was sent and when the last reminder went.",
    "Resend sends the same request again; the trash icon moves a request to the trash, where it can be restored or deleted for good.",
    "Search the list by name, email, phone or address when it grows.",
  ],
  howItWorks: "The client gets a link to a short public page: a rating from 1 to 10 first, then either the Google review step (at or above your feedback-routing score) or a private feedback form (below it) that alerts you at once. Reminders follow the schedule on the Settings view and stop when the client responds, unsubscribes or the maximum is reached. A scheduled request is sent at the chosen local time by a background job. Nothing here offers a reward for a review; the “How review requests work” card under the list explains the rules that keep a profile safe.",
  needs: ["Any plan.", "A profile with a Google review link (the Profiles & links view), or a Google review link on your account."],
};
export default entry;
