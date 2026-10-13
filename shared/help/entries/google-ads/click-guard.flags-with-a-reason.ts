import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Traffic signals, the Clicks report) and server/routes.ts POST /api/click-guard/track as they run. */
const entry: HelpDraft = {
  key: "click-guard.flags-with-a-reason", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Flags with a reason",
  whatItIs: "The reasons Click Guard gives when it flags a visit, and where to read them.",
  whatItDoes: "Each visit is checked as it arrives and flagged when the user agent belongs to a bot, a crawler, a headless browser or a scripting tool, or is missing; when one IP makes more than 5 visits in an hour or more than 15 in a day; or when the same device fingerprint was seen from another IP within the day. Blocked IPs keeps the reason for each blocked address; the Clicks report marks every visit Flagged or Clean, with a Block button on each row.",
  howToUse: [
    "Sidebar → Google Ads → Click Guard → Traffic signals. It opens on Blocked IPs.",
    "Read the Reason column: High frequency, Bot user agent detected, Missing or very short user agent, Same device fingerprint seen from different IPs.",
    "Scroll to the Clicks report and search by IP to see one address’s visits and their status.",
    "Choose the Block button on a row when you decide a flag is right.",
  ],
  howItWorks: "The rules are fixed and listed under Google Ads script → step 2. A flag is a pattern, not proof: several real customers behind one office or phone network can share an IP and trip the visit limits, so review the list before you block.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "The tracking code on the pages your ads point to."],
};
export default entry;
