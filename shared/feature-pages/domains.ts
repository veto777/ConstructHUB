import type { FeaturePage } from "./types";
import { PLANS, planForModule } from "../plans";
import { plansWhere } from "../plan-copy";

/**
 * Domains — half of the Agency-only "Domains + Gmail alerts" module.
 *
 * Every claim below is backed by the code in `sources`:
 *   - registrar API connections (Porkbun, Name.com; key + secret stored encrypted; recent sign-in to connect):
 *     server/domains/routes.ts POST /connections, server/domains/service.ts saveConnection, server/domains/adapters/*
 *   - manual domains from any registrar: routes.ts POST /manual; auto-mapping to locations + manual mapping:
 *     service.ts autoMapDomains, routes.ts POST /mapping
 *   - daily monitor (DNS snapshot changed outside ConstructHUB, nameservers changed, expiry within 60/30/7 days,
 *     auto-renew off, HTTPS check failed, SSL certificate within 30 days) with notifications: service.ts monitor,
 *     server/domains/health.ts websiteHealth, server/domains/dns.ts dnsSnapshot
 *   - DNS edits (A, AAAA, CNAME, TXT, MX, CAA; create/update/delete) and nameserver changes, preview →
 *     confirm (email-interruption acknowledgement for MX/TXT/CNAME/nameservers, recent sign-in) → apply →
 *     DNS verification → rollback preview: server/domains/types.ts, service.ts preview/confirm/processJob/rollbackPreview
 *   - records hosted on Cloudflare are not edited: types.ts desired()
 *   - point nameservers at the Cloudflare zone's pair: routes.ts /cloudflare-preview, server/domains/cloudflare-link.ts
 *   - registrar guides: server/domains/guides.ts
 *   - saved keys removable without the plan; Agency-only gate otherwise: routes.ts requireModule("domainsMailAlerts")
 */

const MODULE_PLAN = PLANS[planForModule("domainsMailAlerts")].name;
const ONLY_PLAN = plansWhere((plan) => plan.modules.domainsMailAlerts).length === 1;

const page: FeaturePage = {
  key: "domains",
  slug: "domains",
  group: "protect",
  status: "ready",
  title: "Domains",
  kicker: "Domain monitoring",
  headline: { lead: "Know Before a Domain ", swipe: "Expires", tail: " or Its DNS Changes" },
  lede:
    "Domains keeps one list of your and your clients' domains, checks each one every day for expiry, auto-renew, " +
    "DNS changes, HTTPS and the SSL certificate, and changes DNS at supported registrars after a preview.",
  hero: { mascot: "standing", bubble: "Let's make sure nobody's domain lapses." },
  steps: [
    {
      title: "Add your domains",
      body: "Connect a Porkbun or Name.com API key to import them, or type in domains from any other registrar to monitor.",
    },
    {
      title: "Match them to clients",
      body: "Domains are matched to your locations by website, and you can map the rest by hand.",
    },
    {
      title: "Daily checks",
      body: "Each domain is checked once a day, and you get a notification when something needs attention.",
    },
    {
      title: "Change DNS with a preview",
      body: "On a connected registrar, preview a record or nameserver change, confirm it, and ConstructHUB checks that it took effect.",
    },
  ],
  cards: [
    {
      icon: "calendar",
      title: "Expiry and auto-renew",
      body: "From your registrar's data: alerts at 60, 30 and 7 days before a domain expires, and when auto-renew is off.",
    },
    {
      icon: "eye",
      title: "DNS change alerts",
      body: "A daily snapshot of the domain's DNS. When records or nameservers change outside ConstructHUB, you're told.",
    },
    {
      icon: "lock",
      title: "HTTPS and SSL checks",
      body: "Checks that the website answers over HTTPS, and warns when its SSL certificate expires within 30 days.",
    },
    {
      icon: "map-pin",
      title: "Sorted by client",
      body: "Each domain is linked to the location whose website it serves, and the list can be searched and filtered by registrar.",
    },
    {
      icon: "settings",
      title: "DNS record edits",
      body: "Create, update or delete A, AAAA, CNAME, TXT, MX and CAA records, or change nameservers, on connected registrars.",
    },
    {
      icon: "history",
      title: "Preview, verify, roll back",
      body: "Each change shows the before and after. Once applied, DNS is checked until it matches, and a rollback preview lets you put the old values back.",
    },
    {
      icon: "mail",
      title: "Email-safe changes",
      body: "Changes that can interrupt email, like MX, TXT and CNAME records or nameservers, need an extra acknowledgement.",
    },
    {
      icon: "cloud",
      title: "Point a domain at Cloudflare",
      body: "With Cloudflare connected, set a domain's nameservers to the pair Cloudflare assigned to its zone in one previewed change.",
    },
    {
      icon: "book",
      title: "Registrar guides",
      body: "Step-by-step guides for registrars without an API connection here, including how to change nameservers by hand.",
    },
  ],
  audience: [
    {
      title: "Agencies holding client domains",
      body: "One list of every client domain, matched to its location, with expiry dates in view.",
    },
    {
      title: "Companies with several websites",
      body: "A daily check instead of a surprise when a domain or certificate lapses.",
    },
    {
      title: "Teams moving sites to Cloudflare",
      body: "Change nameservers to the Cloudflare pair with a preview, and a check that the change took.",
    },
  ],
  pricing: {
    kind: "module",
    module: "domainsMailAlerts",
    note: "Mail alerts is included alongside it, at no extra cost.",
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "For imports, expiry dates and DNS edits: a Porkbun or Name.com API key, with API access turned on for your domains. Domains at other registrars can be added by name and get the DNS, HTTPS and SSL checks, but no expiry or auto-renew data.",
    },
    {
      q: "Which plan includes it?",
      a: `Domains comes with the ${MODULE_PLAN} plan, together with Mail alerts.${ONLY_PLAN ? " No other plan includes it." : ""}`,
    },
    {
      q: "Can it renew or transfer my domains?",
      a: "No. It reads expiry and auto-renew from your registrar and warns you; renewals, transfers and billing stay with your registrar.",
    },
    {
      q: "What if my DNS is hosted on Cloudflare?",
      a: "Then the records are managed in Cloudflare and Domains won't edit them. It still monitors the domain and can change its nameservers at a connected registrar.",
    },
    {
      q: "How is my registrar key stored?",
      a: "Encrypted. Connecting a key and confirming a change both ask you to have signed in recently, and you can remove a saved key at any time, even after leaving the plan.",
    },
  ],
  related: ["mailAlerts", "cloudflare", "agency"],
  app: { href: "/domains", surface: "app" },
  headings: {
    cards: { title: "What Domains ", em: "Watches For" },
  },
  seo: {
    title: "Domains — Expiry, DNS and SSL Monitoring | ConstructHUB",
    description:
      "Check your and your clients' domains daily for expiry, auto-renew, DNS changes, HTTPS and SSL, and change DNS at Porkbun or Name.com after a preview.",
  },
  sources: [
    "client/src/pages/domains.tsx",
    "server/domains/routes.ts",
    "server/domains/service.ts",
    "server/domains/types.ts",
    "server/domains/health.ts",
    "server/domains/dns.ts",
    "server/domains/guides.ts",
    "server/domains/cloudflare-link.ts",
    "server/domains/adapters/porkbun.ts",
    "server/domains/adapters/namecom.ts",
    "shared/plans.ts",
  ],
};

export default page;
