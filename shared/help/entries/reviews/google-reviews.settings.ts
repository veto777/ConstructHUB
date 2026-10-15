import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-reviews.tsx (FeedbackRoutingCard, ReminderSettingsCard), shared/review-flow.ts and server/review-reminders.ts as they run. */
const entry: HelpDraft = {
  key: "google-reviews.settings", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Settings",
  whatItIs: "Two settings for every request you send: which scores come to you privately, and how follow-up reminders go out.",
  whatItDoes: "Feedback routing sets the score (1 to 10) below which a client sees the private form and you hear about it at once, instead of the Google review step; 10 means only a perfect score goes straight to Google. Follow-up reminders turns automatic reminder emails on or off, sets how many each client can get and the hours between them, and the delivery windows in your time zone the reminders rotate through.",
  howToUse: [
    "Pick a score from the Feedback routing list, or choose Custom and type any whole number from 1 to 10, then Save feedback routing.",
    "Choose Manage under Follow-up reminders and switch automatic reminders on.",
    "Set the hours between reminders (1 to 720) and the maximum (0 to 10), from the lists or typed.",
    "Set each reminder's delivery window from the hour lists, then Save reminder settings.",
  ],
  howItWorks: "The routing score is saved on your account and read by the client's review page: a score below it never sees the Google link, and the alert carries the name, score, job and the client's words to the bell, your email and Telegram when linked. Reminders are scheduled when a request is sent, use the first, second and third windows in turn, and stop when the client responds, unsubscribes or reaches the maximum. Every reminder carries an unsubscribe link. The server refuses windows that overlap or end before they start.",
  needs: ["Any plan; reminders need the review-reminders module your plan includes."],
};
export default entry;
