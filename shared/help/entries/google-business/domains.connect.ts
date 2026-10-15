import type { HelpDraft } from "../../types";

/** Written from client/src/pages/domains.tsx and server/domains/routes.ts (POST /connections, /manual, /sync, /disconnect) as they run. */
const entry: HelpDraft = {
  key: "domains.connect", parent: "domains", group: "Google Business", route: "/domains", title: "Domains → Connect a registrar or add domains",
  whatItIs: "The two ways a domain gets onto your list: import it from the registrar (the company you bought it from), or type it in.",
  whatItDoes: "Connecting saves a Porkbun API key (a password for software) or a Name.com username and token under a label you choose, then imports every domain in that account. Those domains can have their DNS changed from here. “Add domains” takes up to 100 bare domain names, comma separated, and only watches them for expiry and website problems. Each new domain is matched to the client location whose website uses it.",
  howToUse: [
    "Open “Connect a registrar or add domains” on the Domains page; it opens by itself while the list is empty.",
    "Pick Porkbun or Name.com, type a label, paste the key and secret (or username and token), and choose Connect.",
    "Confirm it's you when asked.",
    "Or type domain names in “Add domains”, separated by commas, and choose Add domains.",
    "Choose “Sync all connections” later to import again, or Disconnect on a chip to remove that key.",
  ],
  howItWorks: "Keys are stored encrypted on the server and never shown again. The import and the first check run in the background; while an administrator has not turned that on, the page says so and they wait. Disconnect removes the saved key but keeps the domains listed. The registrar guides at the bottom list each registrar's steps and the server's outgoing IP address, for registrars that ask you to allow one.",
};
export default entry;
