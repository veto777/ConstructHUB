import type { HelpDraft } from "../../types";

/** Written from server/tracking-script.ts (the fingerprint), server/routes.ts POST /api/click-guard/track and client/src/pages/google-ads.tsx as they run. */
const entry: HelpDraft = {
  key: "click-guard.one-device-many-ips", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → One device, many IPs",
  whatItIs: "How Click Guard notices the same device coming back from different IP addresses.",
  whatItDoes: "The tracking code takes a browser fingerprint, a short code made from how that browser draws a small test image. It reports it with each visit along with the IP address, device type, browser, operating system and screen size. When the same fingerprint was seen from another address within the day, the visit is flagged “Same device fingerprint seen from different IPs” and the reason is kept on Blocked IPs.",
  howToUse: [
    "Open Google Ads → Click Guard → Traffic signals in the sidebar and look for the fingerprint reason on Blocked IPs.",
    "Scroll to the Clicks report and search for the start of the range to see the matching visits side by side.",
    "Read the tracking script card under Tools for what the code captures on each page load.",
    "Find the rule listed with the others under Google Ads script → step 2.",
  ],
  howItWorks: "The fingerprint is only taken where the tracking code runs in the visitor’s browser. It is a signal, not identity: the page itself says these signals can flag legitimate visitors, so review an address before you block it.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "The tracking code on the pages your ads point to."],
};
export default entry;
