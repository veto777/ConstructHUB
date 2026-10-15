import type { HelpDraft } from "../../types";

/** Written from client/src/pages/mail-alerts.tsx, server/mail-alerts/routes.ts, inbound.ts, service.ts and classify.ts as they run. */
const entry: HelpDraft = {
  key: "mail-alerts.forwarding-setup", parent: "mail-alerts", group: "Google Business", route: "/mail-alerts", title: "Mail alerts → Connection and forwarding setup",
  whatItIs: "Your private forwarding address and the Gmail steps that send provider emails to it.",
  whatItDoes: "Shows the private address ConstructHUB made for your account, the steps to forward mail to it from Gmail, and the senders it recognises: Google Business Profile, Search Console, Google Ads, Cloudflare, Gmail’s own forwarding confirmation, and the common registrars (Porkbun, Name.com, Namecheap, GoDaddy, Dynadot, Gandi, IONOS, Hover, Squarespace, Network Solutions). When Gmail’s confirmation email arrives, its code and link show in the inbox so you can finish the setup. An optional Gmail read-only connection can read provider mail directly instead of forwarding, when the server has it switched on.",
  howToUse: [
    "Mail alerts → Connection: copy your private forwarding address.",
    "In Gmail: Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address, and paste it.",
    "Back here, open the “Forwarding confirmation” alert and use its code or link to finish Google’s check.",
    "In Gmail, create a filter for the provider senders listed under “Known senders” with “Forward it to” your private address — not your whole inbox.",
  ],
  howItWorks: "Only mail from a recognised sender with a recognised alert subject is stored; anything else is ignored. A stored alert is kept 30 days. It is matched to a client when the email names a domain on your Domains list that is mapped to one client, or when exactly one of your business names appears in it; otherwise it waits in Unmapped for you. The forwarding address only exists when the server has an inbound mail domain configured — if it does not, the page says what the administrator must set.",
};
export default entry;
