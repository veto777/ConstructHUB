import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-code-api.tsx and server/dev-api/routes.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-code-api", group: "Tools", route: "/admin/code-api", title: "Code API (admin)",
  whatItIs: "A page for the people who run ConstructHUB: issue a 24- or 48-hour token (a temporary pass) that gives an AI agent or a developer the ConstructHUB source code through /api/dev/v1.",
  whatItDoes: "It shows the API address, then Issue a token in two steps (confirm it’s you with Google, then an authenticator app) followed by the form: who the token is for, agent or person, read-only or read + change, expiry, and your authenticator code. The new token is shown once with a copy button and a ready-made brief for the agent. Live tokens lists the ones still valid with a revoke button; Expired and revoked keeps the last 14 days.",
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
