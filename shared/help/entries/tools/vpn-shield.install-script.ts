import type { HelpDraft } from "../../types";

/** Written from client/src/pages/vpn-shield.tsx (Install script) and server/routes.ts GET /api/vpn-shield/script/:trackingId and POST /api/vpn-shield/track as they run. */
const entry: HelpDraft = {
  key: "vpn-shield.install-script", parent: "vpn-shield", group: "Tools", route: "/vpn-shield", title: "VPN Shield → Install script",
  whatItIs: "The one script tag that lets VPN Shield check visitors to a site.",
  whatItDoes: "Shows the tag for the chosen site, copies it, and says when the first detection has arrived. Below it, how each detection method works and its limits.",
  howToUse: [
    "VPN Shield → Install script, and pick the site.",
    "Copy the tag and paste it in the head section, or before the closing body tag, of every page.",
    "Visit your site through a VPN or proxy; the first detection appears on the Overview within a minute.",
  ],
  howItWorks: "The script skips search-engine crawlers by their user agent, then sends the visitor’s WebRTC addresses and extension indicators to the server, which matches the address against built-in VPN-provider and datacenter ranges and your whitelist. In Block mode the script replaces the page with an overlay; in Redirect mode it sends the browser to your link. Both happen after the page loads, only in browsers that run the script, and can be bypassed.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
