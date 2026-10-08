import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-settings.tsx (the SMS card and the consent box) and server/crm/sms.ts as they run. */
const entry: HelpDraft = {
  key: "crm-sms-setup", group: "CRM", route: "/crm/settings", title: "Turn on texting",
  whatItIs: "The SMS card in Settings: which number your texts come from, and which texts the CRM sends.",
  whatItDoes: "You choose the number your texts come from, switch on texting estimates to clients, and switch on a text to yourself when a bid is signed or money lands. “Send a test text” checks that it works.",
  howToUse: [
    "CRM → Settings, and scroll to the SMS card.",
    "Under “Which number your texts come from”, choose the shared ConstructHUB number or a number of your own, and save.",
    "Switch on “Text estimates to clients” and “Text me when a bid is signed or money lands”.",
    "Tick the consent box under the notification switches, so alerts can reach your own phone.",
    "Type a mobile number under “Send a test text” and choose “Send test text”.",
  ],
  howItWorks: "The shared number texts your own team only. Texting clients needs a number of your own. A client without a mobile number still gets the email. Alerts go to the owner’s mobile from My profile, or the company phone.",
  needs: ["A ConstructHub CRM plan that includes texting — the CRM is a separate product with its own plans.", "A number of your own, to text clients.", "Your mobile number on your profile, for alerts to you."],
};
export default entry;
