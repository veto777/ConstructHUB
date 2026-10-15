import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Team tab) and server/agency/routes.ts + access.ts (/api/agency/team, requireWrite/requireAdmin/requireOwner) as they run. */
const entry: HelpDraft = {
  key: "agency.team", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Team",
  whatItIs: "The people who work in your agency workspace, what each one may do, and which clients each can see.",
  whatItDoes: "Counts your members, the plan seats in use and the clients you can hand out. A Roles card says what owner, admin, manager and viewer can do. The owner adds or changes a member by email, picks a role, and ticks All clients or the specific clients that member may work on; each member card shows its role and client access with Change and Remove pills.",
  howToUse: [
    "Sidebar → Google Business → Agency → Team (owner or admin).",
    "Enter the email of someone who already has a ConstructHUB login, choose a role, and tick All clients or the clients they may see.",
    "Choose Save member. Saving an existing member's email again changes their role or access instead of adding a seat.",
    "To take someone off the workspace, choose Remove on their card.",
  ],
  howItWorks: "Owners manage members and settings; admins add clients (with all-client access) and see this list; managers edit the clients and locations they have access to and queue work; viewers only look. A role that tries something it may not do gets a plain refusal naming the role it needs. Every member counts as one platform seat on the owner's plan (the owner included); when the seats are full, saving a new member answers with the plan's seat message. Members sign in with their own account and open the workspace from the switcher at the top; a member given specific clients cannot see unassigned locations. Nothing here sends an invitation email.",
  needs: ["Team seats on the workspace owner's plan (how many comes from the plan model). Client-by-client access needs the Agency workspace."],
};
export default entry;
