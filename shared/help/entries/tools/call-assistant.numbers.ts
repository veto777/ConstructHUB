import type { HelpDraft } from "../../types";
import { CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SEPARATE_LINE } from "../../../plan-copy";

/** Written from client/src/pages/crm-call-assistant/numbers*.tsx and server/voice/numbers.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.numbers", parent: "call-assistant", group: "Tools", route: "/call-assistant/numbers", title: "Call Assistant → Numbers",
  whatItIs: "The phone numbers your assistant answers, and the steps to send your existing line to one of them.",
  whatItDoes: "It lists each number with its label, location, the line forwarded to it, when it was bought and when it can be released, with Edit and Release on each. Getting a local number takes three steps. Pick a state (and an area code or city if you like), choose one of the numbers offered, then name it and buy. Forward your existing line shows the exact steps for your phone carrier with the new number filled in, and a Copy digits button for your phone system.",
  howToUse: [
    "Choose Add a number (the wizard opens by itself while you have none), pick the state and, if you like, an area code or city, then Find numbers.",
    "Pick a number, label it (such as Main office), name the line you will forward to it, and buy it.",
    "Open Forward your existing line, pick your carrier and dial the star code shown from the phone you are forwarding, or copy the digits into your phone system.",
    "Use Edit to change a number’s label, location or forwarded line.",
    "Use Release to give a number back once the date on its card has passed, after moving any forwarding off it.",
  ],
  howItWorks: `Numbers come from the phone company connected to ConstructHUB; if it is not connected, the page says so and nothing is charged. ${CALL_ASSISTANT_NUMBER_RULES.ownNumbers} With "always" forwarding every call reaches the assistant first, so telemarketers and robocalls stop with it; with no-answer or after-hours forwarding, spam still rings you first. ${CALL_ASSISTANT_NUMBER_RULES.payment} ${CALL_ASSISTANT_NUMBER_RULES.cancel}`,
  needs: [CALL_ASSISTANT_SEPARATE_LINE, "A member who can manage settings; everyone else sees the numbers read-only."],
};
export default entry;
