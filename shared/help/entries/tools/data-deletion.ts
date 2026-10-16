import type { HelpDraft } from "../../types";

/** Written from client/src/pages/data-deletion.tsx and server/social/deletion.ts as they run. */
const entry: HelpDraft = {
  key: "data-deletion", group: "Tools", route: "/data-deletion", title: "Data deletion",
  whatItIs: "The public page that explains how to delete what ConstructHUB holds from your connected social accounts. It is also where you check a deletion request a network asked us to carry out.",
  whatItDoes: "It lists four ways to delete: disconnect the account in Social Media → Connected accounts (instant), or delete your ConstructHUB account. You can also remove ConstructHUB in the network’s own settings, or email support@constructhub.us. With ?code=<confirmation code> in the address it looks the request up and shows Received or Completed with the date.",
  howToUse: [
    "Open the page from the footer, next to Terms and Privacy.",
    "Follow the way that fits: disconnect in ConstructHUB, delete the account, remove the app at the network, or email support.",
    "Open constructhub.us/data-deletion?code=YOURCODE to check a request a network gave you a code for.",
  ],
  howItWorks: "The status is read from the server; a code that is not found says so. Posts already published on a network stay there until you delete them on that network.",
  needs: ["Nothing: it works signed out."],
};
export default entry;
