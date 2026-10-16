import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (Domain settings) and server/click-guard-exclusions.ts buildExclusionList as they run. */
const entry: HelpDraft = {
  key: "click-guard.your-exclusion-rules", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Your exclusion rules",
  whatItIs: "The three settings that shape the IP exclusion list your Google Ads script downloads.",
  whatItDoes: "Manually exclude IPs go first on the list; then come blocked IPs, newest first. Whitelist IPs (your own addresses) are taken out before the list is served, including any address inside a whitelisted range. Exclusion list refresh rate is the length: the list serves at most that many addresses, from 50 up to Google’s 500 per campaign. Each box takes one address, CIDR range or wildcard per line; if a line is not valid, nothing is saved and that line is named.",
  howToUse: [
    "Open Google Ads → Click Guard → Domain settings in the sidebar and open “Advanced · Detection and exclusions”.",
    "Type the addresses you always want excluded under Manually exclude IPs, one per line, and choose Update.",
    "Add your office and crew addresses the same way under Whitelist IPs and choose Update.",
    "Set the length (50–500) under Exclusion list refresh rate and choose Update.",
    "Check “IPs ready to sync” under Google Ads script to see what the list serves now.",
  ],
  howItWorks: "Whitelisting removes an address from the list but does not take it off Blocked IPs, and the Google Ads script never removes an exclusion it already added. The other switches on the page are saved preferences that do not change automatic detection yet, as the page says.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
