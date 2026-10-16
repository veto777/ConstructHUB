import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/me-notifications.tsx and client/src/components/account-security.tsx as they run. */
const entry: HelpDraft = {
  key: "account.notifications", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Notifications",
  whatItIs: "Which alerts reach you in the app and which are also emailed.",
  whatItDoes: "One row per kind of alert with two switches: In app and Email. Security alerts are always emailed and their email switch cannot be turned off. In the iPhone app a card at the top turns on phone notifications; they follow the in-app switches.",
  howToUse: [
    "Open Settings → Notifications.",
    "Flip In app or Email for each kind of alert.",
    "Allow phone notifications in the card at the top of the iPhone app.",
  ],
  howItWorks: "Each switch saves the moment you flip it; if a save fails, the error shows at the top of the list. Security emails stay on for every account.",
};
export default entry;
