import type { HelpDraft } from "../../types";

/** Written from client/src/pages/domains.tsx and server/domains/routes.ts (POST /connections, /manual, /sync, /disconnect) as they run. */
const entry: HelpDraft = {
  key: "domains.connect", parent: "domains", group: "Google Business", route: "/domains", title: "Domains → Connect a registrar or add domains",
  whatItIs: "The two ways a domain gets onto your list: an imported registrar account, or a domain you type in.",
  whatItDoes: "Connecting saves a Porkbun API key and secret, or a Name.com username and API token, under a label you choose, and queues an import of every domain in that account; those domains can have their DNS changed from here. “Add domains” takes a comma-separated list of up to 100 bare domain names (example.com) and tracks them for expiry and website checks only — registration stays wherever it is. Each new domain is matched to a client location whose website uses it. Disconnect removes the saved key from ConstructHUB; the domains stay listed.",
  howToUse: [
    "Domains → “Connect a registrar or add domains” (it opens by itself while the list is empty).",
    "Pick Porkbun or Name.com, type a label for the account, paste its key and secret (or username and token) and choose Connect. You are asked to confirm it’s you first.",
    "Or type domain names in “Add domains”, separated by commas, and choose Add domains.",
    "Later, “Sync all connections” re-imports every connected account; Disconnect on a chip removes that key.",
  ],
  howItWorks: "Keys are stored encrypted on the server and never shown again. The import and the first check are jobs for the background worker: while an administrator has not turned it on, the page says so and they wait in the queue. The registrar guides at the bottom of the page list each registrar’s steps and the server’s outgoing IP address, for registrars that ask you to allow-list one.",
};
export default entry;
