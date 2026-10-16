import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-code-api.tsx and server/dev-api/routes.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-code-api", group: "Tools", route: "/admin/code-api", title: "Code API (admin)",
  whatItIs: "A page for the people who run ConstructHUB. It issues a 24- or 48-hour token (a temporary pass) that lets an AI agent or a developer read the ConstructHUB source code.",
  whatItDoes: "It shows the address the token works on, then Issue a token. You confirm it’s you with Google and then an authenticator app, and fill in who it is for, agent or person, read-only or read + change, and when it expires. The new token is shown once with a copy button and a ready-made brief for the agent. Live tokens lists the ones still valid with a revoke button; Expired and revoked keeps the last 14 days.",
  howToUse: [
    "Confirm it’s you with Google and have your authenticator app ready.",
    "Fill in who the token is for, its access and expiry, type the authenticator code and issue it.",
    "Copy the token or the token + instructions now; it is not shown again.",
    "Revoke it from Live tokens when the work is done.",
  ],
  howItWorks: "Every token writes only to its own devapi/… branch on GitHub; nothing runs or deploys until the owner merges it. Issuing needs a Google re-verification from the last 15 minutes and the authenticator code.",
  needs: ["Platform admin access with Google linked and two-factor turned on."],
};
export default entry;
