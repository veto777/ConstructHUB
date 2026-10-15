import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/api/api-usage-panel.tsx and server/account/api-key-routes.ts as they run. */
const entry: HelpDraft = {
  key: "account.api-usage", parent: "account", group: "Tools", route: "/settings", title: "Account settings → API usage",
  whatItIs: "How many units and requests your API keys used, day by day and per key.",
  whatItDoes: "Three totals (units, requests, keys used), a bar chart of units per day stacked by key, and the same numbers in a table. A key revoked since still shows by its id. The period is a preset (7, 30 or 90 days) or a number of days you type. The panel refreshes itself every minute while it is open and has a Refresh button.",
  howToUse: [
    "Settings → API usage.",
    "Pick a period, or type your own number of days.",
    "Read the chart to see which key spent the units, then the table for the exact numbers per day.",
  ],
  howItWorks: "The server counts each request as it is served: 1 unit for a read plus 1 per 100 rows, 5 for a write. When a key hits its own cap or the plan’s monthly units the API answers “quota exceeded” until the month resets; nothing is dropped silently. Before any key has been used, a clearly marked sample shows what the panel will look like.",
  needs: ["Not shown in the iPhone apps, which sell nothing."],
};
export default entry;
