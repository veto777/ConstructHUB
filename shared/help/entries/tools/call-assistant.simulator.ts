import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-call-assistant/simulator.tsx and server/voice/simulator.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.simulator", parent: "call-assistant", group: "Tools", route: "/call-assistant/simulator", title: "AI Call Assistant → Simulator",
  whatItIs: "A typed test call with your assistant, so you can hear how it handles callers before a real one does.",
  whatItDoes: "Starts a call against your published version or your unpublished draft, takes what you type as the caller, and shows each reply with the decision behind it: whether the call continues, the alert it would send, the spam score, and the details it has collected so far. Hang up ends the call and shows the summary it would write.",
  howToUse: [
    "Choose what to run against: Draft is your unpublished edits; Published is available once you have published at least once.",
    "Type a caller number if you want: a number that belongs to a client in your CRM lets the assistant greet them by name, as it would on a real call.",
    "Choose Start call and type what a caller would say. Each reply carries its action, and an Alert or Spam badge when the assistant would page someone or flag the call.",
    "Watch the right-hand panel for the slots collected and the events, then Hang up to see the outcome, or New call to start over.",
  ],
  howItWorks: "The same brain that answers real calls answers here, through the app. Nothing reaches your CRM, no lead is filed and nobody is paged: the Simulator is a sandbox. When the voice engine is down the page says so; it never makes up a reply. A session the server no longer knows, or one that already ended, cannot take more turns, so start a new call.",
};
export default entry;
