import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-estimate-new.tsx, crm-estimate-detail.tsx and public-estimate.tsx as they run. */
const entry: HelpDraft = {
  key: "crm-create-estimate", group: "CRM", route: "/crm/estimates/new", title: "Create and send an estimate",
  whatItIs: "The three-step way to write a bid and get it in front of a client: pick the client, add the work from your price book, review and send.",
  whatItDoes: "Each price book item you add brings its price and its scope of work; you set the quantity and can change the price or the wording for this job. Sending emails the client a private link to the estimate and marks it Sent. “Save as draft” keeps it without sending.",
  howToUse: [
    "CRM → Estimates → New estimate, then search for the client or choose New client.",
    "Search your price book, choose Add on each item, and set the quantity.",
    "Choose Review, give the estimate a title, and check the total.",
    "Choose Send estimate. Preview on the estimate’s page shows what the client sees.",
  ],
  howItWorks: "The client opens the link, confirms their email with a one-time code, and approves by typing their full name. Preview opens the same page for you with approving and paying switched off, and it does not count as the client opening it.",
  needs: ["A CRM workspace.", "Price book items to pick from.", "An email address on the client, to send to."],
};
export default entry;
