import type { HelpDraft } from "../../types";

/** Written from client/src/pages/mail-alerts.tsx, server/mail-alerts/routes.ts, inbound.ts, service.ts and classify.ts as they run. */
const entry: HelpDraft = {
  key: "mail-alerts.forwarding-setup", parent: "mail-alerts", group: "Google Business", route: "/mail-alerts", title: "Mail alerts → Connection and forwarding setup",
  whatItIs: "Your private forwarding address, and the Gmail steps that send the important account emails to it.",
  whatItDoes: "It shows the private address ConstructHUB made for your account and the senders it recognizes. Those are Google Business Profile, Search Console, Google Ads, Cloudflare, Gmail's forwarding confirmation, and the common domain sellers (Porkbun, Name.com, Namecheap, GoDaddy, Dynadot, Gandi, IONOS, Hover, Squarespace, Network Solutions). When Gmail's confirmation email arrives, its code and link show in the inbox so you can finish the setup. If the server has it switched on, a read-only Gmail connection can read that mail directly instead of forwarding.",
  howToUse: [
    "Copy your private forwarding address from the Connection section of Mail alerts.",
    "Open Gmail Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address, and paste it.",
    "Open the “Forwarding confirmation” alert back here and use its code or link to finish Google's check.",
    "Create a Gmail filter for the senders listed under “Known senders” with “Forward it to” your private address, not your whole inbox.",
  ],
  howItWorks: "Only mail from a recognized sender with a recognized alert subject is stored, for 30 days; everything else is ignored. It is matched to a client when the email names a domain on your Domains list that belongs to one client, or when exactly one of your business names appears in it; otherwise it waits in Unmapped for you. The forwarding address exists only when the server has incoming mail set up. If not, the page says what the administrator must set.",
};
export default entry;
