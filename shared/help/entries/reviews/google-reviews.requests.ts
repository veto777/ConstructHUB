import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-reviews.tsx (the Review requests view) and shared/review-flow.ts as they run. */
const entry: HelpDraft = {
  key: "google-reviews.requests", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Review requests",
  whatItIs: "The first view of Google Reviews: email a client to ask for a review, then follow what each client did.",
  whatItDoes: "New review request takes the client's name and email (phone and address optional) and the profile whose review link to use. You can add other review sites, a personal message, photos, an email theme, a copy to a second address and a send time. The list shows every request with its status: Pending, Google link opened, Positive, Feedback, Scheduled or Unsubscribed, plus the private score and the client's own words when they left any. Five tiles count what was sent, Google links opened, positive feedback, feedback caught privately and requests still waiting.",
  howToUse: [
    "Choose New review request, pick the profile, and type the client's name and email.",
    "Tick Schedule for later to send it another day, or leave it unticked to send now.",
    "Open a request in the list to read the client's score, feedback and when the last reminder went.",
    "Choose Resend to send the same request again, or the trash icon to move it to the trash.",
    "Search the list by name, email, phone or address when it grows.",
  ],
  howItWorks: "The client gets a link to a short page that asks for a rating from 1 to 10 first. At or above your cutoff score they go to the Google review step; below it they get a private feedback form that alerts you at once. Reminders follow the schedule in Settings and stop when the client responds, unsubscribes or reaches the maximum, and a scheduled request goes out at the chosen local time. Nothing here offers a reward for a review; the “How review requests work” card under the list explains the rules that keep a listing safe.",
  needs: ["Any plan.", "A profile with a Google review link (the Profiles & links view), or a Google review link on your account."],
};
export default entry;
