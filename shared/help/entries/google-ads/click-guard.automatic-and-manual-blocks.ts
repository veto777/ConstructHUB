import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Blocked IPs, the Clicks report), server/routes.ts POST …/block and server/route-guards.ts normalizeBlockedIp as they run. */
const entry: HelpDraft = {
  key: "click-guard.automatic-and-manual-blocks", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Automatic and manual blocks",
  whatItIs: "The two ways an address gets onto Blocked IPs, and how to take one off.",
  whatItDoes: "A flagged IP address that passes 10 visits in an hour is blocked on its own and marked auto. You can block an address yourself from the box above the list (a single IPv4 or IPv6 address, a CIDR range or a wildcard like 203.0.113.*) or from the Block button on any row of the Clicks report; those are marked manual. The X on a row unblocks it.",
  howToUse: [
    "Open Google Ads → Click Guard → Traffic signals → Blocked IPs in the sidebar; the Source column reads auto or manual.",
    "Type an address, range or wildcard in “Enter IP to block…” and choose Block.",
    "Choose the Block button on a visit in the Clicks report to block that visitor’s address.",
    "Choose the X on a blocked row to unblock it.",
  ],
  howItWorks: "Blocked addresses stay on the list until you remove them. Very wide ranges are refused. The list feeds the exclusion list your Google Ads script downloads; the script only adds exclusions, so an address it already excluded in Google Ads stays excluded there until you remove it in the campaign’s settings.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
