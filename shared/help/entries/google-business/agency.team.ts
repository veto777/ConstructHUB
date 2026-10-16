import type { HelpDraft } from "../../types";

/** Written from client/src/pages/agency.tsx (Team tab) and server/agency/routes.ts + access.ts (/api/agency/team, requireWrite/requireAdmin/requireOwner) as they run. */
const entry: HelpDraft = {
  key: "agency.team", parent: "agency", group: "Google Business", route: "/agency", title: "Agency → Team",
  whatItIs: "The people in your agency workspace, what each one may do, and which clients each can see.",
  whatItDoes: "It counts your members, the plan seats in use and the clients you can hand out. A Roles card says what owner, admin, manager and viewer can do. The owner adds a member by email, picks a role, and ticks All clients or just the clients that person may work on. Each member card shows its role and client access with Change and Remove pills.",
  howToUse: [
    "Open the Team tab under Agency (owner or admin).",
    "Type the email of someone who already has a ConstructHUB login.",
    "Pick a role and tick All clients or the clients they may see.",
    "Choose Save member; saving an existing member's email again changes their role instead of adding a seat.",
    "Choose Remove on a card to take someone off the workspace.",
  ],
  howItWorks: "Owners manage members and settings, admins add clients and see this list, managers edit what they can access and queue work, and viewers only look. Someone who tries an action their role does not allow gets a plain refusal naming the role it needs. Every member, the owner included, takes one seat on the owner's plan; when the seats are full, saving a new member shows the plan's seat message. Members open the workspace from the switcher at the top, and nothing here sends an invitation email.",
  needs: ["Team seats on the workspace owner's plan (how many comes from the plan model). Client-by-client access needs the Agency workspace."],
};
export default entry;
