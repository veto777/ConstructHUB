import type { HelpDraft } from "../../types";

/** Written from client/src/pages/account-delete.tsx and client/src/components/account-deletion.tsx as they run. */
const entry: HelpDraft = {
  key: "account-delete", group: "Tools", route: "/account/delete", title: "Delete account",
  whatItIs: "The page for deleting your ConstructHUB account from the iPhone apps.",
  whatItDoes: "Inside the ConstructHUB or CRM iPhone app it shows the self-serve deletion card, which confirms the request and deletes the account. On the website it does not delete anything. It tells you to go to Settings → My account → Delete account, and to email the request to support@constructhub.us from your account’s email.",
  howToUse: [
    "Open Settings → My account → Delete account in the iPhone app and confirm.",
    "Open Settings → My account on the website and send the deletion request from your account’s email address.",
    "Expect connected Google, Ads and social accounts and their sign-ins to be removed at once; the rest is erased within 30 days, and payment records are kept without your name or email.",
  ],
  howItWorks: "The page checks whether it is running inside a native app and shows the deletion card only there; the website shows the instructions.",
};
export default entry;
