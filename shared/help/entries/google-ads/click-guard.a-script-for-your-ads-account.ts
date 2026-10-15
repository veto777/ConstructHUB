import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Google Ads script) and server/routes.ts GET …/google-ads-script and …/exclusion-list as they run. */
const entry: HelpDraft = {
  key: "click-guard.a-script-for-your-ads-account", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → A script for your Ads account",
  whatItIs: "The script Click Guard writes for you to paste into your own Google Ads account.",
  whatItDoes: "The Google Ads script page shows how many IP addresses are ready to sync, whether the exclusion list is reachable and the campaign limit of 500. Step 3 holds the script, written for the selected website: on each run it reads your list through a private link and adds new addresses as IP exclusions on your enabled campaigns. Copy Script puts it on the clipboard; the IP exclusion list URL below is the same link on its own; Manual fallback copies the blocked addresses one per line.",
  howToUse: [
    "Open Google Ads → Click Guard → Google Ads script in the sidebar.",
    "Choose “Google Ads IP Exclusion Script”, then Copy Script.",
    "Create a new script in Google Ads under Tools → Bulk actions → Scripts, paste, allow it and save.",
    "Schedule it hourly, run it once, and check its Logs tab to see which addresses were excluded.",
  ],
  howItWorks: "The script runs inside your own Google Ads account, so there is no Google sign-in to share. It skips addresses a campaign already excludes, stops at 500 per campaign, and only ever adds exclusions. The link carries a private key: keep it in your Google Ads script only, and copy the script again if the page says the link changed.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "A Google Ads account where you can create scripts."],
};
export default entry;
