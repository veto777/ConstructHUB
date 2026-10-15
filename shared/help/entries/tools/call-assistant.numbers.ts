import type { HelpDraft } from "../../types";
import { CALL_ASSISTANT_NUMBER_RULES, CALL_ASSISTANT_SEPARATE_LINE } from "../../../plan-copy";

/** Written from client/src/pages/crm-call-assistant/numbers*.tsx and server/voice/numbers.ts as they run. */
const entry: HelpDraft = {
  key: "call-assistant.numbers", parent: "call-assistant", group: "Tools", route: "/call-assistant/numbers", title: "AI Call Assistant → Numbers",
  whatItIs: "The phone numbers your assistant answers, and the steps to send your existing line to one of them.",
  whatItDoes: "It lists each number with its label, location, the line forwarded to it, when it was bought and when it can be released, with Edit and Release on each. Getting a local number takes three steps: pick a state (and an area code or city if you like), choose one of the numbers the carrier offers, then name it and buy. Forward your existing line shows the exact steps for your phone carrier with the new number filled in, and a Copy digits button for your phone system.",
  howToUse: [
    "Choose Add a number (the wizard opens by itself while you have none), pick the state and, if you like, an area code or city, then Find numbers.",
    "Pick a number, give it a label such as Main office and the line you will forward to it, and buy it; the page says whether it is included in your tier or would be an extra number.",
    "Open Forward your existing line, pick your carrier and dial the star code shown from the phone you are forwarding, or copy the digits into your phone system.",
    "Use Edit to change a number’s label, location or forwarded line, or Release to return it to the carrier once its minimum holding period has passed; move any forwarding off it first.",
  ],
  howItWorks: `Numbers come from the phone carrier connected to the server; if it is not connected the page says so and nothing is charged. The carrier keeps a number for a minimum number of days, so Release stays off until the date shown on the card. ${CALL_ASSISTANT_NUMBER_RULES.ownNumbers} With "always" forwarding every call reaches the assistant first, so telemarketers and robocalls stop with it; with no-answer or after-hours forwarding, spam still rings you first. ${CALL_ASSISTANT_NUMBER_RULES.payment} ${CALL_ASSISTANT_NUMBER_RULES.cancel}`,
  needs: [CALL_ASSISTANT_SEPARATE_LINE, "A member who can manage settings; everyone else sees the numbers read-only."],
};
export default entry;
