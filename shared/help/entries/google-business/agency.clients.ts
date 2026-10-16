import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Clients tab) and server/agency/routes.ts (/api/agency/clients) as they run. */
const entry: HelpDraft = {
  key: "agency.clients", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Clients",
  whatItIs: "One record for each business your agency looks after. Locations, onboarding requests and team access all hang off it.",
  whatItDoes: "The top row counts your clients, the locations assigned to one, and the locations still unassigned. Each client card shows its contact email, folder, tags, notes, location count and open onboarding requests. Pills on the card open its locations, open Onboarding with this client chosen (to send the Google manager steps), or edit it. The search box matches name, email, folder and tags.",
  howToUse: [
    "Open Agency under Google Business in the sidebar, then the Clients tab.",
    "Type the name and contact email under New client. That is where the onboarding steps go when you send them from the Onboarding tab.",
    "Open More client details to add a folder, tags and notes if you want them.",
    "Choose Create client, or Edit on a card and then Save client to change one later.",
    "Assign locations on the Locations tab: tick them, Apply to selected locations, Assign client.",
  ],
  howItWorks: "Clients live on the workspace owner's account and count against that plan's client allowance. When it is used up, creating one shows the plan's own message. The owner or an all-client admin adds clients; any role but viewer can edit the clients it can see. Until the first client exists, the page shows sample data, clearly marked, not real and never saved.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model)."],
};
export default entry;
