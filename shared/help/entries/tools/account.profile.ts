import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/me-account.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.profile", parent: "account", group: "Tools", route: "/settings", title: "Account settings → My account",
  whatItIs: "Who you are on ConstructHUB: your name and photo, your company name and logo, and the facts about the account itself.",
  whatItDoes: "Profile information holds your name, photo, company name and logo (the logo goes on review-request emails), and Google Business Profiles lists the profiles you added for review requests (a name and its Google review link), with Add profile. Account details shows your account ID, when you joined, how you sign in, and the customer number to read to Gabe on the support line. Trial access takes an invite code, and Refer a contractor shows your referral link, sign-ups through it and rewards earned. Delete account starts the deletion request.",
  howToUse: [
    "Open Settings → My account.",
    "Edit your name, photo, company name or logo and save.",
    "Copy your account ID or customer number when you write or call support.",
    "Copy your referral link under Refer a contractor and share it.",
    "Use Delete account at the bottom to delete the account; on the website it points you to the support request.",
  ],
  howItWorks: "The profile is read from your account and written back when you save. A sign-up through your link is counted at once. The reward comes once they have paid for 3 months (a free month) or for a full year up front (30% off your own yearly plan), 14 days after that payment. Deleting the account is done in the iPhone apps or by a request from your account’s email address.",
};
export default entry;
