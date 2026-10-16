import type { HelpDraft } from "../../types";

/** Written from client/src/pages/settings/api/api-keys-panel.tsx and server/account/api-key-routes.ts as they run. */
const entry: HelpDraft = {
  key: "account.api-keys", parent: "account", group: "Tools", route: "/settings", title: "Account settings → API keys",
  whatItIs: "Keys that let your own tools (a spreadsheet, a script, your own AI assistant) read your data. With write scope they can also create records the way you would by hand.",
  whatItDoes: "It shows this month’s API use against your plan’s allowance. Each key shows its name, its first and last characters, what it may do, its use this month, its own limit, and when it was added, last used and expires. Generate creates a key with a name, an optional monthly unit cap and an expiry; the full key is shown once. The menu on a key renames it, changes its cap or revokes it.",
  howToUse: [
    "Open Settings → API keys.",
    "Choose Generate, name the key, pick its scope, cap and expiry, and confirm it’s you.",
    "Copy the key now; it is never shown again.",
    "Put it in the Authorization header of your requests (the Developers page shows how).",
    "Revoke a key the moment a tool no longer needs it.",
  ],
  howItWorks: "A read costs 1 unit plus 1 per 100 rows; a write costs 5. Every key counts against the plan’s monthly units and has a limit on how fast it can call. The API never reaches the AI features: nothing it sends is rewritten. A revoked key answers 401 (refused) at once.",
  needs: ["A plan that includes API units; the panel says when yours does not.", "Not shown in the iPhone apps, which sell nothing."],
};
export default entry;
