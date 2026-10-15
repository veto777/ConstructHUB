import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/me-account.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.profile", parent: "account", group: "Tools", route: "/settings", title: "Account settings → My account",
  whatItIs: "Who you are on ConstructHUB: your name and photo, your company name and logo, and the facts about the account itself.",
  whatItDoes: "Profile information holds your name, photo, company name and logo (the logo goes on review-request emails). Google Business Profiles lists the connected profiles. Account details shows your account ID, when you joined and how you sign in, with your customer number to read to Gabe on the support line. Trial access lets you enter an invite code. Refer a contractor shows your referral link, how many people signed up through it and the rewards you earned. Delete account starts the deletion request.",
  howToUse: [
    "Settings → My account.",
    "Edit your name, photo, company name or logo and save.",
    "Copy your account ID or customer number when you write or call support.",
    "Copy your referral link under Refer a contractor and share it.",
    "To delete the account, use Delete account at the bottom; on the website it points you to the support request.",
  ],
  howItWorks: "The profile is read from your account and written back when you save. A referral counts once the person you referred signs up with a new account; the reward (a free month, or a yearly discount if they pay a year up front) is added after the holding period shown on the card. Deleting the account is done in the iPhone apps or by a request from your account’s email address.",
};
export default entry;
