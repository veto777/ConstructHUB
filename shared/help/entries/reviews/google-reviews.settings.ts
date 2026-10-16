import type { HelpDraft } from "../../types";
import { PLANS, planForModule } from "../../../plans";

/** Written from client/src/pages/google-reviews.tsx (FeedbackRoutingCard, ReminderSettingsCard), shared/review-flow.ts and server/review-reminders.ts as they run. */
const entry: HelpDraft = {
  key: "google-reviews.settings", parent: "google-reviews", group: "Reviews", route: "/google-reviews", title: "Google Reviews → Settings",
  whatItIs: "Two settings for every request you send: which scores come to you privately, and how follow-up reminders go out.",
  whatItDoes: "Feedback routing sets the cutoff score (1 to 10): below it a client sees the private form instead of the Google review step, and you hear about it at once. At 10, only a perfect score goes straight to Google. Follow-up reminders turns reminder emails on or off and sets how many each client gets, the hours between them, and the sending times they rotate through, in the time zone shown on the card (Eastern time unless another was saved).",
  howToUse: [
    "Pick a score from the Feedback routing list, or choose Custom and type any whole number from 1 to 10, then Save feedback routing.",
    "Choose Manage under Follow-up reminders and switch automatic reminders on.",
    "Set the hours between reminders (1 to 720) and the maximum (0 to 10), from the lists or typed.",
    "Set each reminder's delivery window from the hour lists, then Save reminder settings.",
  ],
  howItWorks: "The cutoff is saved on your account, and a client who scores below it never sees the Google link; the alert brings the name, score, job and the client's words to the bell, your email, and Telegram when linked. Reminders are scheduled when a request is sent, use the first, second and third sending times in turn, and stop when the client responds, unsubscribes or reaches the maximum. Every reminder carries an unsubscribe link. Sending times that overlap or end before they start are refused.",
  needs: ["Feedback routing works on any plan; follow-up reminders need the " + PLANS[planForModule("reviewReminders")].name + " plan or above."],
};
export default entry;
