import type { HelpDraft } from "../../types";
import { callAssistantSpamAllowanceLine } from "../../../plan-copy";

/** Written from client/src/pages/crm-call-assistant/overview.tsx, results.tsx and server/voice/billing.ts (GET /status) as they run. */
const entry: HelpDraft = {
  key: "call-assistant.overview", parent: "call-assistant", group: "Tools", route: "/call-assistant", title: "AI Call Assistant → Overview",
  whatItIs: "The home page of your Call Assistant: is it answering, what it did with this month’s calls, and the one thing to do next.",
  whatItDoes: "The tiles show the assistant’s status (draft, live or paused), how many numbers ring it, the minutes used this month against your tier, and the spam calls it stopped. The Results card counts what the assistant did with every call in the period you pick, and each tile opens those calls. It counts estimate requests filed, calls sent to a person, questions answered, declines, hang-ups, messages taken and spam blocked. Under it: your tier, a minutes meter with the billing details, the numbers ringing the assistant, and the last five calls with their outcome and summary.",
  howToUse: [
    "Read the Next step line at the top and use its button to do what is still missing.",
    "Pick a period on the Results card and click a tile to open exactly those calls.",
    "Open Minutes used → Billing details to see how minutes and spam calls are counted this month; the pill beside it says whether the voice engine is up and answering.",
    "Use Manage to go to Numbers and All calls to go to Calls; a call in the Recent list opens straight into its details.",
  ],
  howItWorks: `Every figure is read from your account's status and your call log; nothing is estimated. Every started minute of an answered call counts toward the tier, and ${callAssistantSpamAllowanceLine()}. A blocked number is turned away before it is answered and costs nothing, and calls an outside answering service adds to this log are counted but never billed here. Until a number has rung the assistant, the lists show clearly marked sample data that goes away with your first real number or call.`,
};
export default entry;
