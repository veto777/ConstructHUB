import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/limits-usage.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.limits", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Limits & usage",
  whatItIs: "Everything your plan includes and how much of it you have used this month.",
  whatItDoes: "Cards by area (Google Business Profile, Websites & ads, Team, Permits & CRM, Call Assistant, API), each with a meter per limit: what is included next to what is used. Where an add-on raises a limit, its + and − sit under that limit; for the others, Change plan at the top of the page goes to Pricing. With no active plan the page offers Compare plans and Open billing.",
  howToUse: [
    "Open Settings → Limits & usage.",
    "Find the limit you are asking about and read used against included.",
    "Use + or − under a limit an add-on can raise, or Change plan at the top for the rest.",
  ],
  howItWorks: "The numbers are the same ones the server enforces, counted the same way, so a full meter here is exactly when a tool says the limit is reached. Monthly counts reset on the date shown; standing counts (locations, protected websites) are simply what you have.",
  needs: ["Not shown in the iPhone apps, which sell nothing."],
};
export default entry;
