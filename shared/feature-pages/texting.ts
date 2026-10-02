import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { TEXTING_PLANS, joinNames, planNamesWhere } from "../plan-copy";

/**
 * Texting — team alert texts and client texts from the CRM (Settings → SMS, /crm/settings).
 *
 * Every claim below is backed by the code in `sources`:
 *   - the plan gate (plans with team text alerts or client texting: Pro, Growth, Agency) and the monthly
 *     allowance in segments, reserved before each send, refunded when the carrier refuses, texts skipped until
 *     the 1st (UTC) when spent: server/crm/sms.ts (planIncludesTexting, orgSmsEntitled, reserveSmsSegments,
 *     sendSms), server/growth-quotas.ts (texts → teamTextSegments)
 *   - segments as the carrier bills them (GSM-7 vs UCS-2): server/crm/sms-segments.ts
 *   - three senders (shared number / own number on our carrier, provisioned on request / own SignalWire
 *     account, token encrypted), client texts only from an own number: server/crm/sms.ts resolveSmsSender,
 *     orgCanTextClients, PUT /api/crm/sms/sender; client/src/pages/crm-settings.tsx (SMS card)
 *   - event alerts per channel (in-app / email / text): shared/schema.ts CRM_NOTIFICATION_PREFS,
 *     server/crm/notify.ts, server/crm/sms.ts textOrgOwners
 *   - estimate link by text on send, reminder texts, quick messages: server/crm/portal.ts, server/crm/sms.ts
 *     (remind), server/crm/messages.ts
 *   - the re-engagement alert falls back to email when the month's texts are spent: server/crm/sms.ts
 *   - STOP / START / HELP answered and honoured: server/crm/sms.ts (/api/crm/sms/inbound, isSmsOptedOut)
 *   - client replies are not shown in the CRM: the inbound route only handles STOP/START/HELP and
 *     AI Call Assistant escalation replies
 *   - usage on the dashboard: server/dashboard/account.ts ("Texts" row)
 *   - the client-texting number: Growth includes one (limits.clientTexting "included"), the Client texting
 *     number add-on on the plans in ADDONS.texting_number.availableOn: shared/plans.ts
 * Plan names and numbers come from the price book (allowanceLine, plan-copy helpers), never typed.
 */

const SEGMENTS: FeatureAllowance = { limit: "teamTextSegments", unit: "text segments", period: "month" };
const NUMBER_INCLUDED = planNamesWhere((plan) => plan.limits.clientTexting === "included");
const NUMBER_ADDON = joinNames(ADDONS.texting_number.availableOn.map((key) => PLANS[key].name));

const page: FeaturePage = {
  key: "texting",
  slug: "texting",
  group: "run",
  status: "ready",
  title: "Texting",
  kicker: "Text alerts",
  headline: { lead: "Get a Text the Moment a Bid Is ", swipe: "Signed" },
  lede:
    "Texting sends your team a text when a bid is signed, money lands or a client re-opens an estimate, and lets " +
    "you text clients their estimates, reminders and quick messages from a number of your own.",
  hero: { mascot: "standing", bubble: "Bid signed. Thought you'd want to know." },
  steps: [
    {
      title: "Pick your number",
      body: "Team alerts can go out from the shared ConstructHUB number with nothing to set up. To text clients, use a number of your own.",
    },
    {
      title: "Choose your alerts",
      body: "In Settings, turn on text for the events you care about: estimates opened, approved or declined, payments, website leads and more.",
    },
    {
      title: "Text your clients",
      body: "Send the estimate link by text along with the email, text a reminder about a waiting estimate, or send a quick message to any client.",
    },
    {
      title: "Keep an eye on the allowance",
      body: "Each text counts its segments against your plan's monthly allowance, and your dashboard shows how many you've used.",
    },
  ],
  cards: [
    {
      icon: "bell",
      title: "Alerts for your team",
      body: "A text when a bid is approved or declined, a payment lands, a website lead arrives or a client re-opens an estimate. Choose in-app, email or text, event by event.",
    },
    {
      icon: "send",
      title: "Estimates by text",
      body: "Text the estimate link along with the email, on every send or just this one. Clients without a mobile number get the email.",
    },
    {
      icon: "refresh",
      title: "Reminders and quick messages",
      body: "Remind a client about an estimate that's still waiting, by text and email together, or send any client a one-off message.",
    },
    {
      icon: "phone",
      title: "A number of your own",
      body: "A number we set up for you on ConstructHUB's carrier, or your own SignalWire account billed to you. Your account's token is stored encrypted.",
    },
    {
      icon: "shield-check",
      title: "Opt-outs handled for you",
      body: "Replies of STOP, START and HELP get the right answer automatically, and a number that opted out is never texted.",
    },
    {
      icon: "gauge",
      title: "Counted the way carriers count",
      body: "Texts are measured in segments, the unit carriers bill. A text the carrier refuses gives its segments back, and a spent month pauses texts instead of running up charges.",
    },
  ],
  audience: [
    {
      title: "Owners on the road",
      body: "Know the moment a bid is signed or a payment lands, without opening the app.",
    },
    {
      title: "Contractors whose clients live on their phones",
      body: "The estimate link and the reminder arrive where the client actually reads them.",
    },
    {
      title: "Teams with sales reps",
      body: "The good-time-to-call text goes to the rep who sent the estimate, not just the owner.",
    },
  ],
  pricing: {
    kind: "allowance",
    allowance: SEGMENTS,
    note: "Every text your CRM sends counts, to your team or to a client. A client-texting number is a separate add-on on some plans.",
  },
  faqs: [
    {
      q: "What do I need to text my clients?",
      a: `A number of your own. Carriers no longer let one shared number text on behalf of many businesses, so the shared ConstructHUB number only texts your own team. ${NUMBER_INCLUDED} includes a client-texting number we set up for you; on ${NUMBER_ADDON} it is the ${ADDONS.texting_number.name} add-on. You can also connect your own SignalWire account. Either way, the number needs its carrier registration (10DLC).`,
    },
    {
      q: "Which plans include texting, and how many texts?",
      a: `Texting is included with the ${TEXTING_PLANS} plans. ${allowanceLine(SEGMENTS)}. On other plans, emails and in-app alerts keep working.`,
    },
    {
      q: "What's a segment?",
      a: "The unit carriers bill. A short plain text is one segment. A long text uses more, and a single emoji or special character shortens every part, so the same text can use more segments.",
    },
    {
      q: "What happens when the month's texts run out?",
      a: "Texts pause until the 1st of the next month (UTC); nothing is charged above your allowance. The good-time-to-call alert switches to email so it still reaches you.",
    },
    {
      q: "Can clients text me back in the CRM?",
      a: "No. Replies of STOP, START and HELP are handled, but other replies don't show up in the CRM. Client conversations happen in their portal and by email.",
    },
  ],
  related: ["crm", "crmLeads", "callAssistant"],
  app: { href: "/crm/settings", surface: "portal", label: "Open text settings" },
  headings: {
    steps: { title: "Texting Set Up in ", em: "Four Steps" },
    cards: { title: "What Texting ", em: "Gives You" },
    faq: { title: "Before You ", em: "Turn It On" },
  },
  seo: {
    title: "Texting — Text Alerts & Client Texts | ConstructHUB",
    description:
      "Text alerts when a bid is signed or a payment lands, estimate links and reminders by text from your own number, and a monthly allowance counted in carrier segments.",
  },
  sources: [
    "server/crm/sms.ts",
    "server/crm/sms-segments.ts",
    "server/crm/messages.ts",
    "server/crm/notify.ts",
    "server/crm/portal.ts",
    "server/growth-quotas.ts",
    "server/dashboard/account.ts",
    "client/src/pages/crm-settings.tsx",
    "shared/schema.ts",
    "shared/plans.ts (clientTexting, texting_number)",
    "shared/plan-copy.ts",
  ],
};

export default page;
