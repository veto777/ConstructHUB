import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Traffic signals, the Clicks report) and server/routes.ts POST /api/click-guard/track as they run. */
const entry: HelpDraft = {
  key: "click-guard.flags-with-a-reason", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Flags with a reason",
  whatItIs: "The reasons Click Guard gives when it flags a visit, and where to read them.",
  whatItDoes: "Each visit is checked as it arrives. A visit is flagged when the browser’s name tag (user agent) is missing or belongs to a bot, crawler, hidden browser or scripting tool. It is also flagged when one IP address makes more than 5 visits in an hour or 15 in a day, or the same device was seen from another address that day. Blocked IPs keeps the reason for each blocked address; the Clicks report marks every visit Flagged or Clean, with a Block button on each row.",
  howToUse: [
    "Open Google Ads → Click Guard → Traffic signals in the sidebar; it opens on Blocked IPs.",
    "Read the Reason column: High frequency, Very high frequency, Bot user agent detected, Missing or very short user agent, Same device fingerprint seen from different IPs.",
    "Scroll to the Clicks report and search by IP address to see one address’s visits and their status.",
    "Choose the Block button on a row when you decide a flag is right.",
  ],
  howItWorks: "The rules are fixed and listed under Google Ads script → step 2. A flag is a pattern, not proof. Real customers on one office or phone network can share an address and hit the visit limits, so review the list before you block.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "The tracking code on the pages your ads point to."],
};
export default entry;
