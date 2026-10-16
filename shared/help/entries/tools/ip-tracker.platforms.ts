import type { HelpDraft } from "../../types";

/** Written from client/src/pages/ip-tracker.tsx (Platforms) and server/routes.ts GET …/platforms as they run. */
const entry: HelpDraft = {
  key: "ip-tracker.platforms", parent: "ip-tracker", group: "Tools", route: "/ip-tracker", title: "IP Tracker → Platforms",
  whatItIs: "The browsers, operating systems, devices and screen sizes your visitors use.",
  whatItDoes: "Four lists, each with a count and share: browsers, operating systems, devices (mobile, desktop, tablet) and screen resolutions.",
  howToUse: [
    "Open IP Tracker → Platforms and pick the site.",
    "Choose a date range preset, or type a From and To date.",
    "Use the device and screen lists to check your site on what most visitors use.",
  ],
  howItWorks: "The tracking code reads the browser’s own description of itself and its screen; a browser or system the code does not recognise shows as Other, and a visit that sent nothing shows as Unknown. The newest 1,000 visits in the range are loaded.",
  needs: ["A protected website on your plan (one website covers Click Guard, IP Tracker and VPN Shield)."],
};
export default entry;
