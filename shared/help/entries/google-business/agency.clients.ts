import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Clients tab) and server/agency/routes.ts (/api/agency/clients) as they run. */
const entry: HelpDraft = {
  key: "agency.clients", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Clients",
  whatItIs: "One record per business your agency looks after, so every location, onboarding request and team member can be tied to a client.",
  whatItDoes: "The row at the top counts your clients, the locations assigned to a client and the locations still unassigned. Each client card shows its contact email, folder, tags and notes, how many locations it has and how many onboarding requests are still open, with pills to open its locations, email it the Google manager steps or edit it. The search box matches name, email, folder and tags.",
  howToUse: [
    "Sidebar → Google Business → Agency → Clients.",
    "Under New client, enter the name and the contact email (onboarding instructions are sent to it); open More client details for a folder, tags and notes. Folder offers the folders you already use and takes a new one.",
    "Choose Create client. To change a client later, choose Edit on its card, then Save client.",
    "Assign locations to the client on Locations (tick them → Apply to selected locations → Assign client), or send the client the Google manager steps under Onboarding.",
  ],
  howItWorks: "Clients are stored on the workspace owner's account and counted against that plan's client-workspace allowance; when it is used up, creating one answers with the plan's own message. Adding a client takes the owner or an admin with all-client access; editing takes any role but viewer, and only on clients that member can see. A member given specific clients sees only those clients and their locations. Until the first client exists the page shows a clearly marked sample so you can see what the list will look like; nothing in it is stored.",
  needs: ["The Agency workspace (the agency module; which plan carries it comes from the plan model)."],
};
export default entry;
