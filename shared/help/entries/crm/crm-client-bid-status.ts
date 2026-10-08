import type { HelpDraft } from "../../types";

/** Written from client/src/pages/crm-clients.tsx and server/crm/entities.ts (bid outcome per client) as they run. */
const entry: HelpDraft = {
  key: "crm-client-bid-status", group: "CRM", route: "/crm/clients", title: "Sort clients by bid status",
  whatItIs: "The All, Job Won, Undecided and Declined tabs above the client list, and the Bid column beside each client.",
  whatItDoes: "Each tab shows the clients in that group, with a count. The status comes from the client's estimates: Job Won when one is approved, Undecided when one is sent and not answered, Declined when one was declined.",
  howToUse: [
    "CRM → Clients.",
    "Click Job Won, Undecided or Declined to see only those clients.",
    "Type in the search box to search inside the tab you are on.",
    "Click All to see everyone again.",
  ],
  howItWorks: "An approved estimate counts first, then an open one, then a declined one. A client with no estimate in any of those states shows a dash in the Bid column and appears only under All. The tab you pick is kept in the page address, so going back returns to it.",
  needs: ["A ConstructHub CRM plan — the CRM is a separate product with its own plans."],
};
export default entry;
