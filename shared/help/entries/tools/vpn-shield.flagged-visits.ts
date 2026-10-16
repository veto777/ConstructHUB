import type { HelpDraft } from "../../types";

/** Written from client/src/pages/vpn-shield.tsx (Flagged visits) and server/routes.ts GET …/blocked-visits and POST /api/vpn-shield/track as they run. */
const entry: HelpDraft = {
  key: "vpn-shield.flagged-visits", parent: "vpn-shield", group: "Tools", route: "/vpn-shield", title: "VPN Shield → Flagged visits",
  whatItIs: "Every visit the script flagged as a likely VPN or proxy, newest first.",
  whatItDoes: "Each row shows the address, the VPN company (“provider”) when one was matched, how it was caught and what was done (Logged only, Blocked, Redirected). It also shows the device fingerprint, city and country, time and browser. Opening a row adds the system, device, landing page, the page that sent them and the browser’s name tag (user agent).",
  howToUse: [
    "Open VPN Shield → Flagged visits and pick the site.",
    "Search by address, VPN company (provider), method, city or country.",
    "Pick an action (Blocked, Redirected, Logged only) and a date range, or type a From and To date.",
    "Choose a row to see its full record.",
  ],
  howItWorks: "ConstructHUB keeps every detection with the action the site’s mode took at that moment, so a visit logged before you turned blocking on still reads Logged only. The list refreshes every 15 seconds while open. A detection is a signal, not proof: whitelist your own addresses in Settings if you see yourself here.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield).", "The VPN Shield script on the site’s pages."],
};
export default entry;
