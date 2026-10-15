import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings.tsx and client/src/pages/settings/* as they run. */
const entry: HelpDraft = {
  key: "account", group: "Tools", route: "/settings", title: "Account settings",
  whatItIs: "Your account and workspace in one place: who you are, how you sign in, which alerts reach you, your plan and its limits, API keys, the audit log and every connected service.",
  whatItDoes: "A left menu in two groups opens one section at a time. Me: My account, Password & security, Notifications, Phone tab bar. Workspace: Billing, Limits & usage, API keys, API usage, Audit log, Integrations. The open section is kept in the address (?tab=), so a reload or a shared link lands on the same section. On a phone the menu is one button above the section.",
  howToUse: [
    "Open the account menu at the top right and choose Settings, or follow any link that says Settings.",
    "Pick a section in the left menu. On a phone, tap the section button first.",
    "Change what you need. Each section saves on its own and tells you when it did.",
    "Close (X) returns to the page you came from, or to Home when you opened Settings directly.",
  ],
  howItWorks: "Every section is its own panel that reads and writes only its part of the account. Sensitive changes — password, two-factor, API keys, deleting the account — ask you to confirm it’s you first. Older links keep working: ?tab=profile, ?tab=invoices or ?tab=api open the right section. In the iPhone apps Billing, Limits & usage, API keys and API usage are not shown, because nothing is sold inside the apps.",
  needs: ["A ConstructHUB account. Every section is available on every plan; a few show what the plan includes."],
};
export default entry;
