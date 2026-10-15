import type { HelpDraft } from "../../types";

/** Written from client/src/pages/google-ads.tsx (ToolsView) and server/tracking-script.ts as they run. */
const entry: HelpDraft = {
  key: "click-guard.tools", parent: "click-guard", group: "Google Ads", route: "/google-ads", title: "Click Guard → Tools",
  whatItIs: "The Tools section of Click Guard: the tracking code for the selected website, ready to copy.",
  whatItDoes: "Tracking script shows one line of code, written for the website chosen at the top, and a Copy button. It goes in the <head> of every page your ads send people to; on each page load it records the visit with the visitor’s IP address, device type, browser, screen size and a device fingerprint, which is what the Dashboard, Traffic sources and Traffic signals count. The Conversion tracking card says what is not built: Click Guard records page visits only, never form submissions, calls or conversion values.",
  howToUse: [
    "Open Google Ads → Click Guard → Tools in the sidebar and pick the website at the top.",
    "Choose Copy on the Tracking script card.",
    "Paste the line into the <head> of every page your ads point to, and publish the site.",
    "Open the Dashboard: visits start counting from the next page load.",
  ],
  howItWorks: "Each website has its own tracking ID, so the code only counts visits to the site it was written for. An address flagged often enough goes onto Blocked IPs for this site; nothing is excluded in Google Ads until the separate Google Ads script runs there. To measure leads, use Google Ads conversion tracking.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "Access to your website’s code."],
};
export default entry;
