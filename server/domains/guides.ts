/** Docs checked 2026-09-29. Only implemented, API-capable registrars are recommended for connection. */
export const registrarGuides = [
  {
    id: "porkbun",
    name: "Porkbun",
    mode: "API supported",
    url: "https://porkbun.com/api/json/v3/documentation",
    steps: [
      "Open Account → API Access; create an API key and secret.",
      "Restrict the key to your domains and the server egress IP where available.",
      "In Domain Management, enable API access for each domain.",
      "Connect the key/secret here; queued discovery imports the domain inventory.",
    ],
  },
  {
    id: "namecom",
    name: "Name.com",
    mode: "API supported (CORE v1)",
    url: "https://docs.name.com/guides/authentication",
    steps: [
      "Sign in to Name.com and open API token management.",
      "Create a production API token. Use the account username as the API key field here.",
      "Use a separate client/sub-account where available; do not enter your account password.",
      "Connect here; queued discovery imports your domains.",
    ],
  },
  {
    id: "namecheap",
    name: "Namecheap",
    mode: "API capable; adapter not included",
    url: "https://www.namecheap.com/support/api/intro/",
    steps: [
      "Profile → Tools → Business & Dev Tools → Namecheap API Access → Manage.",
      "Enable API access. Production eligibility: 20 domains, $50 account balance, or $50 spent in the last two years; otherwise contact support.",
      "Whitelist the IPv4 address shown below (owner sets DOMAINS_EGRESS_IP).",
      "For manual nameserver changes: Domain List → Manage → Nameservers → Custom DNS → paste the Cloudflare pair → save.",
    ],
  },
  {
    id: "godaddy",
    name: "GoDaddy",
    mode: "API capable; adapter not included",
    url: "https://classic-developer.godaddy.com/getstarted",
    steps: [
      "Open the developer portal and create production credentials (new integrations use a personal access token).",
      "Current official rule: Management/DNS needs 1+ domains or an active Discount Domain Club Domain Pro plan. Availability needs 50+ domains. Access remains provider-controlled.",
      "Manual nameservers: Domain Portfolio → select domain → DNS → Nameservers → Change Nameservers → enter the Cloudflare pair → save.",
    ],
  },
  {
    id: "squarespace",
    name: "Squarespace Domains",
    mode: "Manual only in ConstructHUB",
    url: "https://support.squarespace.com/hc/en-us/articles/4404183898125-Review-change-or-reset-your-domain-s-nameservers",
    steps: [
      "Open Domains dashboard → select your domain → DNS.",
      "Open Domain Nameservers → Use custom nameservers.",
      "Enter the assigned Cloudflare nameservers and save. Copy all website/email DNS records to Cloudflare before changing delegation.",
    ],
  },
  {
    id: "hover",
    name: "Hover",
    mode: "Manual only in ConstructHUB",
    url: "https://support.hover.com/support/solutions/articles/201000064742",
    steps: [
      "Sign in to Hover → select domain → Overview.",
      "Find Nameservers → Edit.",
      "Replace the nameservers with the Cloudflare pair and save after copying website/email records.",
    ],
  },
  {
    id: "wix",
    name: "Wix",
    mode: "Manual DNS only; nameserver change unavailable",
    url: "https://www.wix.com/blog/use-wix-just-as-a-domain-registrar",
    steps: [
      "Wix does not allow changing nameservers for domains registered at Wix.",
      "Open Domains → domain actions → Manage DNS records to point permitted website records manually.",
      "A Cloudflare nameserver cutover is unavailable under this lane’s no-transfer rule. Keep the registration at Wix.",
    ],
  },
  {
    id: "networksolutions",
    name: "Network Solutions",
    mode: "Manual only in ConstructHUB; public API not verified",
    url: "https://www.networksolutions.com/help/article/manage-dns-adns-records",
    steps: [
      "Sign in to Account Manager → Domains → select domain.",
      "Scroll to Advanced Tools → Manage next to Nameservers (DNS).",
      "Enter Cloudflare’s assigned nameservers and save. If the account UI differs, use Network Solutions support; no transfer is needed.",
    ],
  },
];
