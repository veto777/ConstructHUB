import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/integrations.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.integrations", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Integrations",
  whatItIs: "Every outside service connected to this account, with its status and the page where it is managed.",
  whatItDoes: "One row per service: Google Business Profile, Google Ads, Cloudflare, Google Search Console, social media accounts, domain registrars, Gmail alert forwarding and client texting. Each is marked Connected, Not connected or Reconnect needed, with a Manage, Connect or Reconnect link to the page that handles it.",
  howToUse: [
    "Open Settings → Integrations.",
    "Find the service and read its status.",
    "Choose Connect, Reconnect or Manage to handle it on its own page.",
  ],
  howItWorks: "The page checks the status of each connection and shows it; it never holds the sign-ins itself. If the status cannot be read yet, the page says so and still lists the pages.",
};
export default entry;
