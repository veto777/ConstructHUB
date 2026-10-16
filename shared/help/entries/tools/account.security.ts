import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/me-security.tsx and client/src/components/account-security.tsx as they run. */
const entry: HelpDraft = {
  key: "account.security", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Password & security",
  whatItIs: "Everything that protects your sign-in: the password, two-factor codes, the devices you asked us to remember, and recent account activity.",
  whatItDoes: "Change password sets a new one; an account that signs in only with Google has no password here to change. Two-factor authentication turns on a six-digit code from an authenticator app, with a secret key to copy and the code to confirm; turning it off asks for a code too. Remembered devices lists each device with its expiry and a Revoke button. Account activity shows recent sign-ins and changes, filtered by type and date; the Audit log shows the same newest 200 events with more filters and a CSV export.",
  howToUse: [
    "Open Settings → Password & security.",
    "Type the current password and the new one to change it, then save.",
    "Scan the key in an authenticator app and type the code it shows to turn on two-factor.",
    "Revoke any remembered device you no longer use.",
    "If a Google-connection alert wasn’t you, its link opens “Wasn’t you?”: disconnect that Google account there, then use Reset password.",
  ],
  howItWorks: "Sensitive buttons ask you to confirm it’s you first (password, authenticator code or an emailed code). A revoked device is no longer remembered: its next sign-in asks for the two-factor code again. Security emails are always sent, whatever the notification settings say.",
};
export default entry;
