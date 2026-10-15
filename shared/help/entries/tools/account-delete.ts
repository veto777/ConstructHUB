import type { HelpDraft } from "../../types";

/** Written from client/src/pages/account-delete.tsx and client/src/components/account-deletion.tsx as they run. */
const entry: HelpDraft = {
  key: "account-delete", group: "Tools", route: "/account/delete", title: "Delete account",
  whatItIs: "The page for deleting your ConstructHUB account from the iPhone apps.",
  whatItDoes: "Inside the ConstructHUB or CRM iPhone app it shows the self-serve deletion card, which confirms the request and deletes the account. On the website it does not delete anything: it tells you to go to Settings → My account → Delete account and send the request to support@constructhub.us from your account’s email address.",
  howToUse: [
    "In the iPhone app, open Settings → My account → Delete account and confirm.",
    "On the website, open Settings → My account and send the deletion request from your account’s email address.",
    "Deleting the account removes everything held for it, including connected social accounts and their tokens.",
  ],
  howItWorks: "The page checks whether it is running inside a native app and shows the deletion card only there; the website shows the instructions.",
};
export default entry;
