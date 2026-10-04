import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";

/**
 * Leads & follow-ups — the CRM pipeline board (/crm/pipeline), follow-up cadences, the website lead
 * form and the estimate-engagement alerts.
 *
 * Every claim below is backed by the code in `sources`:
 *   - the stages and their groups (Prospect, Sales, Production, Billing, Closed):
 *     shared/schema.ts CRM_PROJECT_STATUSES / CRM_PROJECT_STAGE_META
 *   - "+ New lead" (new or existing client, optional estimated value), drag or stage menu, value shown
 *     only to people who may see prices, a project manager per card: client/src/pages/crm-pipeline.tsx
 *   - sending an estimate → Proposal Sent, approval → Approved: server/crm/portal.ts
 *   - follow-up cadence weekly / every two weeks, "followed up now", and Home's Needs attention card
 *     (follow-ups due, leads from the last two weeks, leads with no estimate yet), assigned-only for
 *     members without viewAllJobs: server/crm/follow-ups.ts, client/src/pages/crm-home.tsx
 *   - the website lead form (embed code or direct link, lands as a client tagged website-lead with the
 *     Website lead source, emails the owner, honeypot + per-IP limit, rotate the link):
 *     server/crm/lead-capture.ts, client/src/pages/crm-integrations.tsx
 *   - first open notifies the sender; a repeat open fires the once-a-day "good time to call" alert to the
 *     estimate's sender by email / in-app, and by text when texting is on: server/crm/portal.ts, server/crm/sms.ts
 *   - opens and time spent on the client timeline: server/crm/notes-timeline.ts
 *   - reminder resends the estimate by email, and by text from the org's own number: server/crm/sms.ts
 *   - no automatic drip: the only CRM timers are backups and HOVER (server/crm/backups.ts, hover.ts)
 *   - call leads filed into the CRM by the AI Call Assistant (an add-on not yet on sale): server/voice/leads.ts
 */

const SEATS: FeatureAllowance = { limit: "crmSeats", unit: "CRM seats", period: "count" };

const page: FeaturePage = {
  key: "crmLeads",
  slug: "crm-leads",
  group: "run",
  status: "ready",
  title: "Leads & follow-ups",
  ctaTitle: "Leads & Follow-Ups",
  kicker: "Lead pipeline",
  headline: { lead: "Know Which Lead to ", swipe: "Call\u00a0Next" },
  lede:
    "Leads & follow-ups puts every job on one board from lead to paid, brings your website's enquiries straight " +
    "into the CRM, and reminds you who is due a call, including the client who just opened your estimate again.",
  hero: { mascot: "standing", bubble: "Let's see who's waiting on a call back." },
  steps: [
    {
      title: "Capture the lead",
      body: "Add it from the pipeline with New lead, or put the lead form on your website: every enquiry becomes a client in the CRM, and you get an email.",
    },
    {
      title: "Move it along the board",
      body: "Drag the card from Lead to Estimating. Sending the estimate moves it to Proposal Sent, and the client's approval moves it to Approved.",
    },
    {
      title: "Set a follow-up",
      body: "Give a client a weekly or every-two-weeks follow-up. Your CRM home lists who's due, new leads, and leads still waiting on an estimate.",
    },
    {
      title: "Call when they're looking",
      body: "When a client opens your estimate again, whoever sent it gets a good-time-to-call alert.",
    },
  ],
  cards: [
    {
      icon: "kanban",
      title: "A board from lead to paid",
      body: "Stages grouped into prospect, sales, production and billing. Drag a card or pick its stage; the job's value shows to the people allowed to see prices.",
    },
    {
      icon: "globe",
      title: "A lead form for your website",
      body: "Paste one embed code on your site or share the direct link. Enquiries land in your clients tagged as website leads, and spam bots are turned away quietly.",
    },
    {
      icon: "clock",
      title: "Follow-up reminders",
      body: "Weekly or every two weeks, per client. Mark the call done and the next one is counted from today.",
    },
    {
      icon: "inbox",
      title: "Needs attention, on your CRM home",
      body: "Follow-ups that are due, leads from the last two weeks, and leads nobody has sent an estimate for yet, in one card.",
    },
    {
      icon: "bell",
      title: "Know when they're reading",
      body: "The sender hears when a client first opens an estimate. A repeat open sends a call-now alert, at most once a day per estimate, by email and in the app, and by text where your plan includes texting.",
    },
    {
      icon: "users",
      title: "Every lead has an owner",
      body: "Give each job a project manager. Team members who can't see every job see only the ones they manage on the board and in their new-lead lists.",
    },
  ],
  audience: [
    {
      title: "Owners who sell their own jobs",
      body: "One board for every job, and a short list each morning of who to call.",
    },
    {
      title: "Sales reps",
      body: "Their own leads and follow-ups, and an alert when a client is reading their bid again.",
    },
    {
      title: "Contractors with a busy website",
      body: "Website enquiries go straight into the CRM instead of an inbox someone has to copy from.",
    },
  ],
  pricing: {
    kind: "plan",
    note: "Leads & follow-ups is part of ConstructHub CRM. Alert texts count against your plan's text allowance.",
  },
  faqs: [
    {
      q: "What do I need to use it?",
      a: "A ConstructHUB plan and your CRM workspace. To capture website enquiries, paste the embed code on your site or link to the form. Email alerts work on every plan; text alerts need a plan with texting.",
    },
    {
      q: "Which plans include it?",
      a: `Every plan, as part of ConstructHub CRM. How many people can work leads is your CRM seats: ${allowanceLine(SEATS)}.`,
    },
    {
      q: "Does it pull in leads from Google, ads or phone calls?",
      a: "Not by itself. Leads come from New lead and your website form. The AI Call Assistant add-on files the leads from the calls it answers into the CRM.",
    },
    {
      q: "Does it follow up for me?",
      a: "No. There are no automatic drip emails or texts. Follow-ups are reminders for you to call, and an estimate reminder goes out when you press send.",
    },
    {
      q: "What if someone gets hold of my form link?",
      a: "They could only send you enquiries, never read anything. Rotate the link in Integrations and every old copy and embed stops working.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"):
  // the stage groups: shared/schema.ts CRM_PROJECT_STAGE_META; the automatic moves: server/crm/portal.ts (send → Proposal
  // Sent, approve → Approved); the form fields (name + email or phone, optional address and message), source + tag, owner
  // email, honeypot and per-IP limit answered like a real lead, rotation: server/crm/lead-capture.ts header, leadSchema,
  // the public POST; cadence 7/14 days, followed-up-now, the Needs attention rollup, assigned-only: server/crm/follow-ups.ts
  // header; first-open notice, repeat open → maybeAlertReengagement once a day, 30-minute dedupe: server/crm/portal.ts
  // public estimate GET, VIEW_DEDUPE_MIN; text where texting is on: server/crm/sms.ts.
  inDepth: {
    heading: { title: "Contractor Lead Tracking, ", em: "Explained" },
    paragraphs: [
      "Leads & follow-ups is lead tracking for contractors inside ConstructHub CRM. Every job is a card on one pipeline " +
        "board, with stages grouped into prospect, sales, production, billing and closed. Move a card by dragging it or " +
        "by picking its stage, and two moves happen on their own: sending an estimate puts the job in Proposal Sent, and " +
        "the client's approval puts it in Approved.",
      "The website lead form is a contact form for your own site. Paste the embed code or link straight to the form. A " +
        "visitor leaves a name and an email or phone, plus an optional address and message, and the enquiry becomes a " +
        "client in your CRM with the Website lead source and a website-lead tag, while you get an email. Spam bots that " +
        "fill in a hidden field, and anyone sending too many enquiries from one connection, get the same polite answer as " +
        "a real visitor, but nothing lands in your CRM. Rotating the link stops every old copy.",
      "Follow-ups are reminders for you, not automatic messages. Give a client a weekly or every-two-weeks cadence; " +
        "marking the call done starts the count again from today. The Needs attention card on your CRM home collects the " +
        "follow-ups that are due, leads from the last two weeks and leads with no estimate yet. A team member who can't " +
        "see every job sees only the leads they manage.",
      "The estimate alert tells you when a client is reading. The first time a client opens a sent estimate, whoever " +
        "sent it hears about it. If the client comes back to an estimate they haven't answered yet, the sender gets a " +
        "good-time-to-call alert, at most once a day per estimate: in the app and by email, and by text where your plan " +
        "includes texting. A refresh within half an hour from the same place doesn't count as coming back.",
    ],
  },
  related: ["crm", "callAssistant", "texting"],
  app: { href: "/crm/pipeline", surface: "portal", label: "Open the pipeline" },
  headings: {
    steps: { title: "From Enquiry to Approved in ", em: "Four Steps" },
    cards: { title: "What Keeps Leads ", em: "Warm" },
  },
  seo: {
    title: "Contractor Lead Tracking & Follow-Ups | ConstructHUB",
    description:
      "Track every lead from enquiry to paid on one board, bring website enquiries into your CRM, get follow-up reminders, and know when a client re-opens a bid.",
  },
  sources: [
    "client/src/pages/crm-pipeline.tsx",
    "client/src/pages/crm-home.tsx",
    "client/src/pages/crm-integrations.tsx",
    "server/crm/follow-ups.ts",
    "server/crm/lead-capture.ts",
    "server/crm/portal.ts",
    "server/crm/sms.ts",
    "server/crm/notes-timeline.ts",
    "server/crm/owner-notify.ts",
    "server/crm/backups.ts",
    "server/voice/leads.ts",
    "shared/schema.ts",
  ],
};

export default page;
