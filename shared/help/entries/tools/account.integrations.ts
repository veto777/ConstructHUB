import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/integrations.tsx as it runs. */
const entry: HelpDraft = {
  key: "account.integrations", parent: "account", group: "Tools", route: "/settings", title: "Account settings → Integrations",
  whatItIs: "Every outside service connected to this account, with its status and the page where it is managed.",
  whatItDoes: "One row per service — Google Business Profile, Cloudflare, Google Search Console, Google Ads & Local Services Ads, Gmail (mail alerts), domain registrar, HOVER & lead capture (CRM), Stripe payments (CRM) and social media accounts — marked Connected, Not connected or Reconnect needed, with an Open link to the page that manages it.",
  howToUse: [
    "Settings → Integrations.",
    "Find the service and read its status.",
    "Choose Open to connect it, reconnect it or change it on its own page.",
  ],
  howItWorks: "The page asks the server for the status of each connection and shows it; it never holds the credentials itself. If the server cannot report status yet, the page says so and still lists the pages.",
};
export default entry;
