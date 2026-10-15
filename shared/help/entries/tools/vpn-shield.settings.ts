import type { HelpDraft } from "../../types";

/** Written from client/src/pages/vpn-shield.tsx (Settings), server/routes.ts POST …/settings and server/vpn-mode.ts as they run. */
const entry: HelpDraft = {
  key: "vpn-shield.settings", parent: "vpn-shield", group: "Tools", route: "/vpn-shield", title: "VPN Shield → Settings",
  whatItIs: "What happens to a flagged visitor on this site, and which addresses are never flagged.",
  whatItDoes: "Three modes (Log only records and blocks nobody, Block shows an overlay instead of your page, Redirect sends the visitor to your link instead of your page), a redirect link, and a whitelist of up to 500 of your own IP addresses that are never blocked.",
  howToUse: [
    "Open VPN Shield → Settings and pick the site.",
    "Keep Log only until you have read some flagged visits, then choose Block or Redirect.",
    "Type a full http:// or https:// link for Redirect.",
    "Add your office and testing addresses to the whitelist, one per line, and save.",
  ],
  howItWorks: "Settings are saved per site, and a site that never saved a mode is in Log only. Each save is checked: the redirect must be a full web link, each whitelist entry one IPv4 or IPv6 address (no ranges), and at most 500. The crawler exemption applies regardless. Changes apply to the next visit the script checks.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
