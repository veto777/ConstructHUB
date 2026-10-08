import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-client.tsx (EstimateOptionsDialog) and public-estimate.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-estimate-options", group: "CRM", route: "/crm/clients", title: "Offer good / better / best options",
  whatItIs: "Two or three versions of the same job on one estimate, so the client compares them instead of shopping around.",
  whatItDoes: "Options on an estimate, on the client’s page, opens the Good / better / best list. Each option has a name, a total and a description; one can be marked Recommended. An option with lines from your price book becomes a checkbox the client can pick; one without lines is a display tier only.",
  howToUse: [
    "CRM → Clients, open the client, and choose Options on the estimate.",
    "Type the option’s name, its total and a short description, then choose Add option.",
    "Add the next one. Tick Recommended on the one you want to stand out.",
    "Close the list and choose Preview to see the options the way the client does.",
  ],
  howItWorks: "The options show on the client’s estimate page. The Options button is on estimates that are not approved or declined yet.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans.", "An estimate that is not approved yet."],
};
export default entry;
