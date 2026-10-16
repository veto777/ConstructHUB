import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Blocked IPs, the Clicks report), server/routes.ts POST …/block and server/route-guards.ts normalizeBlockedIp as they run. */
const entry: HelpDraft = {
  key: "click-guard.automatic-and-manual-blocks", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Automatic and manual blocks",
  whatItIs: "The two ways an address gets onto Blocked IPs, and how to take one off.",
  whatItDoes: "A flagged IP address that passes 10 visits in an hour is blocked on its own and marked auto. Block an address yourself in the box above the list, or with the Block button on any row of the Clicks report; those are marked manual. The box takes one IPv4 or IPv6 address, a range (CIDR) or a wildcard like 203.0.113.*. The X on a row unblocks it.",
  howToUse: [
    "Open Google Ads → Click Guard → Traffic signals → Blocked IPs in the sidebar; the Source column reads auto or manual.",
    "Type an address, range or wildcard in “Enter IP to block…” and choose Block.",
    "Choose the Block button on a visit in the Clicks report to block that visitor’s address.",
    "Choose the X on a blocked row to unblock it.",
  ],
  howItWorks: "Blocked addresses stay on the list until you remove them. Very wide ranges are refused. This list is what your Google Ads script downloads. The script only adds blocks, so an address already blocked in Google Ads stays blocked until you remove it in the campaign’s settings.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
