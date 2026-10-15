import type { HelpDraft } from "../../types";
import { callAssistantSpamAllowanceLine } from "../../../plan-copy";

/** Written from client/src/pages/crm-call-assistant/overview.tsx, results.tsx and server/voice/billing.ts (GET /status) as they run. */
const entry: HelpDraft = {
  key: "call-assistant.overview", parent: "call-assistant", group: "Tools", route: "/call-assistant", title: "AI Call Assistant → Overview",
  whatItIs: "The home page of your Call Assistant: is it answering, what it did with this month’s calls, and the one thing to do next.",
  whatItDoes: "The tiles show the assistant’s status (draft, live or paused), how many numbers ring it, the minutes used this month against your tier, and the spam calls it stopped. The Results card counts what the assistant did with every call in the period you pick (estimate requests filed, calls sent to a person, questions answered, declined, hung up, messages taken and spam blocked), and each tile opens those calls. Under it: your tier, a minutes meter with the billing details, the numbers ringing the assistant, and the last five calls with their outcome and summary.",
  howToUse: [
    "Read the Next step line at the top: it names what is still missing (set up and publish the assistant, get a number, review your calls) and its button takes you there.",
    "Pick a period on the Results card (last 7 days, last 30 days, this month, all time, or a number of days you type) and click a tile to open exactly those calls.",
    "Open Minutes used → Billing details to see how minutes and spam calls are counted this month; the pill beside it says whether the voice engine is up and answering.",
    "Use Manage to go to Numbers and All calls to go to Calls; a call in the Recent list opens straight into its details.",
  ],
  howItWorks: `Every figure is read from your account's status and your call log; nothing is estimated. Every started minute of an answered call counts toward the tier, and ${callAssistantSpamAllowanceLine()}. A number the assistant blocked is rejected before it is answered and costs nothing. Calls an outside receptionist pushes into this log are counted in the tiles but never billed here. While no number has rung the assistant yet, the lists show a clearly marked sample of what they will look like; the sample disappears with your first real number or call and is never saved.`,
};
export default entry;
