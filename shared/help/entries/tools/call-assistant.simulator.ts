import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-call-assistant/simulator.tsx and server/voice/simulator.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.simulator", parent: "call-assistant", group: "Tools", route: "/call-assistant/simulator", title: "Call Assistant → Simulator",
  whatItIs: "A typed test call with your assistant, so you can see how it handles callers before a real one does.",
  whatItDoes: "It starts a pretend call against your published version or your draft, and you type as the caller. Each reply shows the decision behind it: whether the call goes on, the alert it would send, the spam score and the details collected so far. Hang up ends the call and shows how it ended: the outcome, or how many turns it ran and whether a lead or an alert would have gone out.",
  howToUse: [
    "Choose what to run against: Draft is your unpublished edits; Published is available once you have published at least once.",
    "Type a caller number if you want; a client’s number from your CRM gets greeted by name, as on a real call.",
    "Choose Start call and type what a caller would say; watch for an Alert or Spam badge on a reply.",
    "Watch the right-hand panel for the details collected and the events, then Hang up to see the outcome, or New call to start over.",
  ],
  howItWorks: "The Simulator follows the same rules as a real call, but runs inside the app on its own AI model, so a live call may word things a little differently. Nothing reaches your CRM, no lead is filed and nobody is paged: the Simulator is a safe test area. If the AI cannot answer, the assistant says a set line asking the caller to repeat, marked Fallback line; it never makes up a reply. A test call that expired or already ended cannot take more turns, so start a new call.",
};
export default entry;
