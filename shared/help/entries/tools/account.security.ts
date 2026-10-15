import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/me-security.tsx and client/src/components/account-security.tsx as they run. */
const entry: HelpDraft = {
  key: "account.security", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Password & security",
  whatItIs: "Everything that protects your sign-in: the password, two-factor codes, the devices you asked us to remember, and recent account activity.",
  whatItDoes: "Change password sets a new one (an account that signs in with Google only can add a password here). Two-factor authentication turns on a six-digit code from an authenticator app, with a secret key to copy and the code to confirm; turning it off asks for a code too. Remembered devices lists each device with its expiry and a Revoke button. Account activity shows recent sign-ins and changes, filtered by type and date; the full history is in the Audit log.",
  howToUse: [
    "Open Settings → Password & security.",
    "Type the current password and the new one to change it, then save.",
    "Scan the key in an authenticator app and type the code it shows to turn on two-factor.",
    "Revoke any remembered device you no longer use.",
    "Use “Wasn’t you?” if activity looks wrong: it disconnects the Google account and resets the password.",
  ],
  howItWorks: "Sensitive buttons ask you to confirm it’s you first (password, authenticator code or an emailed code). A revoked device has to sign in from scratch, with a two-factor code if it is on. Security emails are always sent, whatever the notification settings say.",
};
export default entry;
