import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";

/**
 * ConstructHub CRM — the whole portal (clients, estimates, invoices, payments,
 * price book, pipeline, documents, client portal).
 *
 * Every claim below is backed by the code in `sources`:
 *   - workspace made on first open, named from the account's company: server/crm/tenancy.ts ensureOrgForUser
 *   - seats: shared/plans.ts limits.crmSeats + the Extra seat add-on; shared with the agency team on Agency
 *     (server/crm/tenancy.ts getOwnerSeatUsage)
 *   - roles and per-seat permissions, price-blind field crews: shared/schema.ts CRM_ROLES / CRM_ROLE_DEFAULTS
 *   - the three-step phone estimate builder: client/src/pages/crm-estimate-new.tsx
 *   - sales tax from the job's city rates: server/crm/tax.ts
 *   - good/better/best options, client-ticked discounts, typed-name approval, signed contract PDF to both sides:
 *     server/crm/portal.ts (select-options, respond), server/crm/discounts.ts, server/crm/contract-pdf.ts
 *   - send → Proposal Sent, approve → Approved: server/crm/portal.ts
 *   - payments through the contractor's own Stripe account (Connect Standard, no platform fee), ACH + card,
 *     deposits on approved estimates, manual cash/check/wire: server/crm/payments.ts, server/crm/ops.ts;
 *     receipts emailed after every payment: server/crm/receipts.ts; financing links: server/crm/financing.ts
 *   - price book items/materials/labor/packages, per-sqft Quick Bid from a measurement report, price floor:
 *     server/crm/pricebook.ts, server/crm/quickbid.ts, server/crm/price-floor.ts
 *   - projects: phases, daily logs, change orders the client answers online, budget/costs: server/crm/ops.ts routes
 *   - the client portal (created with the client, magic-link sign-in, documents, comments, photos):
 *     client/src/pages/public-portal.tsx, client/src/pages/client-portal.tsx, server/crm/attachments.ts
 *   - the messages inbox (replies reach the portal and the client's email): server/crm/inbox.ts
 *   - the client timeline: server/crm/notes-timeline.ts; divisions (letterhead, tax, scoping): server/crm/divisions.ts
 *   - CSV import of clients, estimates and invoices + the assisted path: server/crm/migrate.ts, migrate-lib.ts;
 *     client CSV export: GET /api/crm/customers/export.csv; scheduled email backups: server/crm/backups.ts
 *   - no accounting sync: nothing in server/ talks to an accounting system (QuickBooks appears only as a CSV shape)
 * Numbers that live in the price book are read from it (allowanceLine, PLANS, ADDONS), never typed.
 */

const SEATS: FeatureAllowance = { limit: "crmSeats", unit: "CRM seats", period: "count" };

const page: FeaturePage = {
  key: "crm",
  slug: "crm",
  group: "run",
  status: "ready",
  title: "ConstructHub CRM",
  kicker: "Contractor CRM",
  headline: { lead: "From First Estimate to ", swipe: "Paid\u00a0Invoice" },
  lede:
    "ConstructHub CRM keeps your clients, estimates, jobs, invoices and payments in one place, gives every client " +
    "their own portal, and lets each person on your team see only what their role needs.",
  hero: { mascot: "standing", bubble: "Let's get your next bid out the door." },
  steps: [
    {
      title: "Open your CRM",
      body: "Your workspace is created the first time you open it, named after your company. Bring clients, estimates and invoices over from a CSV file.",
    },
    {
      title: "Build and send the estimate",
      body: "Price it from your price book on the full builder or the three-step phone builder, and send it by email. Sales tax fills in from the rates you set for the job's city.",
    },
    {
      title: "The client signs online",
      body: "They open a secure link, choose between the options you offered, tick any discounts you extended, and approve by typing their name. A signed contract PDF goes to both of you.",
    },
    {
      title: "Run the job and get paid",
      body: "The job moves through your pipeline to production. Invoice it, and take card or bank (ACH) payments through your own Stripe account, or record cash and checks.",
    },
  ],
  cards: [
    {
      icon: "users",
      title: "A portal for every client",
      body: "Each client gets a portal the moment you add them: their estimates, invoices and signed contracts, plus a place to send you notes and photos of the house.",
    },
    {
      icon: "file",
      title: "Estimates clients can choose from",
      body: "Good, better and best options, optional discounts the client can tick, attached files, and a typed-name signature that becomes a contract PDF.",
    },
    {
      icon: "tag",
      title: "A price book that prices for you",
      body: "Items, materials, labor rates and packages. Per-square-foot items can price a bid from a measurement report, and an optional price floor keeps reps from going below it.",
    },
    {
      icon: "wallet",
      title: "Payments into your own account",
      body: "Connect your own Stripe account and clients pay deposits and invoices by bank transfer or card. ConstructHUB adds no fee, and a receipt emails after every payment.",
    },
    {
      icon: "kanban",
      title: "A pipeline from lead to paid",
      body: "Stages for sales, production and billing. Sending an estimate and the client's approval move the job for you; drag a card to move it yourself.",
    },
    {
      icon: "hard-hat",
      title: "Jobs, change orders and costs",
      body: "Phases, daily logs, change orders the client approves online, and a project budget you can compare with the costs you record.",
    },
    {
      icon: "shield",
      title: "Roles that fit a crew",
      body: "Owner, admin, sales, project manager, office, field and subcontractor. Field crews can be kept price-blind, and any seat's permissions can be adjusted.",
    },
    {
      icon: "message",
      title: "One inbox for client messages",
      body: "Notes clients send from their portal land in one inbox, threaded per client. Your reply reaches their portal and their email.",
    },
    {
      icon: "download",
      title: "Your data comes and goes with you",
      body: "Import from a CSV file, export your client list, and get your clients, estimates and invoices emailed to you on a schedule.",
    },
  ],
  spotlight: {
    kicker: "The Client Record",
    heading: { title: "Everything About a Client ", em: "on One Page" },
    points: [
      "A timeline of every estimate sent, opened, approved or declined, with how long the client spent reading it.",
      "Payments, portal notes, uploaded photos and financing-link clicks land on the same timeline.",
      "Your team's notes sit beside it, and a log shows who on your team did what.",
      "Open the client's portal exactly as they see it before you send them the link.",
    ],
    panel: {
      label: "The client page",
      title: "What every client record holds",
      items: [
        "Contact details", "Projects", "Estimates", "Invoices and payments", "Activity timeline",
        "Team notes", "Portal notes and photos", "Measurement reports",
      ],
      note: "Team members without permission to see prices don't see them here either.",
    },
  },
  audience: [
    {
      title: "Owner-operators",
      body: "You write the bids and do the books. Estimates from your phone, payments into your own account, and a backup in your inbox.",
    },
    {
      title: "Contractors with sales and production teams",
      body: "Reps sell, project managers run the jobs, crews see their visits, and each seat only reaches what its role allows.",
    },
    {
      title: "Companies with more than one division",
      body: "Each division can have its own letterhead and tax rates, and team members can be kept to their own division's work.",
    },
  ],
  pricing: {
    kind: "plan",
    allowance: SEATS,
    note: "Every plan includes the CRM; your plan sets how many people can use it, and extra seats are an add-on.",
  },
  faqs: [
    {
      q: "What do I need to get started?",
      a: "A ConstructHUB account and plan. Your CRM workspace is created the first time you open it. To take payments online, connect your own Stripe account; to text clients, you need a plan with texting and a number of your own. Everything else works by email.",
    },
    {
      q: "Which plans include it, and how many people can use it?",
      a: `Every plan includes the CRM. ${allowanceLine(SEATS)}. Need one more person? Add the ${ADDONS.extra_seat.name} add-on. On the ${PLANS.agency.name} plan, the seats are shared with your agency team.`,
    },
    {
      q: "Can I bring my data from my old system?",
      a: "Yes. Export clients, estimates or invoices from your old system as a CSV or tab-delimited file, preview it, match the columns, and import. Clients are matched by email or phone so you don't get duplicates. If you'd rather hand it off, request an assisted import and a person on our team reaches out.",
    },
    {
      q: "Does ConstructHUB hold my money or take a cut?",
      a: "No. Payments go to your own Stripe account and ConstructHUB adds no platform fee. Stripe's own processing fees and account checks still apply.",
    },
    {
      q: "What doesn't it do?",
      a: "It isn't accounting or payroll software and doesn't sync with one; export your data or use the scheduled backups instead. Client text replies don't come back into the CRM: client conversations happen in the portal and by email.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"):
  // tax order (typed rate, city override, division default, org default): server/crm/tax.ts header; email-gated links and
  // no costs/internal items on public pages: server/crm/portal.ts header; seven-day expiry: server/crm/entities.ts
  // ESTIMATE_EXPIRY_DAYS; first open / repeat views / reading time / 30-minute refresh rule: server/crm/portal.ts
  // VIEW_DEDUPE_MIN, engagementIncrement; the contract PDF contents and who gets it: server/crm/contract-pdf.ts header;
  // Connect Standard, merchant of record, no application fee, ACH/card/both and card withheld above an amount:
  // server/crm/payments.ts header, paymentSettingsOf, client/src/pages/crm-settings.tsx; divisions: server/crm/divisions.ts;
  // no accounting sync, CSV export, backups: server/crm/entities.ts export.csv, server/crm/backups.ts.
  inDepth: {
    heading: { title: "How a Contractor CRM ", em: "Runs a Job" },
    paragraphs: [
      "ConstructHub CRM is a construction CRM built around the estimate. You build it from your price book, with good, " +
        "better and best options if you want them. Sales tax fills in from the rate you set for the job's city, then the " +
        "division's default, then the company's, unless you type a rate yourself. When you send it, the client gets an " +
        "email with a secure link. That link only opens for someone who can confirm the email address it was sent to, so " +
        "a forwarded link is no use to anyone else, and your costs and internal-only line items never reach the client's " +
        "page.",
      "A sent estimate expires seven days after sending by default. Until the client answers, the CRM records when they " +
        "first open it, each time they come back and how long they spend reading; a refresh within half an hour from the " +
        "same place isn't counted as a new view. When the client approves by typing their name, the CRM builds the signed " +
        "contract PDF with your letterhead, the options, the discounts they chose, the totals, your terms and the " +
        "signature, and emails it to the client and to you.",
      "Payments run through your own Stripe account using Stripe Connect Standard, so you are the merchant of record " +
        "and the money goes straight to you; ConstructHUB takes no application fee. You choose whether clients can pay by " +
        "bank transfer (ACH), by card or both, and you can switch card off above an amount you set, since bank transfers " +
        "cost far less on a large deposit. Cash, checks and wires can be recorded by hand.",
      "If you run more than one division, each one can carry its own letterhead and tax rates, and team members can be " +
        "kept to their own division's work. The CRM is not accounting or payroll software and doesn't sync with one. " +
        "Export your client list as a CSV file, or have your clients, estimates and invoices emailed to you on a " +
        "schedule.",
    ],
  },
  related: ["crmSchedule", "crmLeads", "texting"],
  app: { href: "/crm", surface: "portal", label: "Open your CRM" },
  headings: {
    steps: { title: "From First Call to Payment in ", em: "Four Steps" },
    cards: { title: "What the CRM ", em: "Gives You" },
    faq: { title: "Before You ", em: "Switch" },
  },
  seo: {
    title: "Contractor CRM — Estimates, Jobs & Payments | ConstructHUB",
    description:
      "A contractor CRM with estimates clients sign online, a client portal, a job pipeline, and invoices paid by ACH or card into your own Stripe account.",
  },
  sources: [
    "server/crm/tenancy.ts",
    "shared/schema.ts",
    "shared/plans.ts",
    "client/src/pages/crm-estimate-new.tsx",
    "client/src/pages/crm-client.tsx",
    "client/src/pages/crm-pipeline.tsx",
    "client/src/pages/crm-migrate.tsx",
    "client/src/pages/public-portal.tsx",
    "client/src/pages/client-portal.tsx",
    "server/crm/portal.ts",
    "server/crm/discounts.ts",
    "server/crm/contract-pdf.ts",
    "server/crm/tax.ts",
    "server/crm/payments.ts",
    "server/crm/ops.ts",
    "server/crm/receipts.ts",
    "server/crm/financing.ts",
    "server/crm/pricebook.ts",
    "server/crm/quickbid.ts",
    "server/crm/price-floor.ts",
    "server/crm/attachments.ts",
    "server/crm/inbox.ts",
    "server/crm/notes-timeline.ts",
    "server/crm/activity.ts",
    "server/crm/divisions.ts",
    "server/crm/migrate.ts",
    "server/crm/migrate-lib.ts",
    "server/crm/backups.ts",
    "server/crm/entities.ts",
    "client/src/pages/crm-settings.tsx",
  ],
};

export default page;
