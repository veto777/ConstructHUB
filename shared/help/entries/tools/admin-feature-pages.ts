import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-feature-pages.tsx and server/feature-pages.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-feature-pages", group: "Tools", route: "/admin/feature-pages", title: "Feature pages (admin)",
  whatItIs: "A page for the people who run ConstructHUB: a map of every public feature page and service page, and whether each is written yet.",
  whatItDoes: "Three tiles count the feature pages written, the stubs and the service pages written. Then one list per group with every page: its status (Ready, Stub, Own page or Page), the public address and the page inside the app, and the older address it replaces.",
  howToUse: [
    "Read the tiles for how much is still a stub.",
    "Open a public address to read the page, or the app link to open its tool.",
    "Use Open public catalogue or Services catalogue for the customer-facing lists.",
  ],
  howItWorks: "The list comes from an admin-only request the server refuses to anyone but a platform admin; the links themselves are public pages.",
  needs: ["Platform admin access."],
};
export default entry;
