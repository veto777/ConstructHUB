import type { FeatureAllowance, FeaturePage } from "./types";
import { allowanceLine } from "./pricing";
import { ADDONS, PLANS } from "../plans";
import { CLIENT_NUMBER_INCLUDED_PLANS, CRM_TEXTING_PLANS, CRM_TEXT_SEGMENTS_LINE, TEXTING_EITHER_LINE, joinNames } from "../plan-copy";

/**
 * Texting — team alert texts and client texts from the CRM (Settings → SMS, /crm/settings).
 *
 * Every claim below is backed by the code in `sources`:
 *   - the plan gate (every platform plan has team text alerts; client texting needs a number) and the monthly
 *     allowance in segments, reserved before each send, refunded when the carrier refuses, texts skipped until
 *     the 1st (UTC) when spent: server/crm/sms.ts (planIncludesTexting, orgSmsEntitled, reserveSmsSegments,
 *     sendSms), server/growth-quotas.ts (texts → teamTextSegments)
 *   - segments as the carrier bills them (GSM-7 vs UCS-2): server/crm/sms-segments.ts
 *   - two senders (shared number / own number on our carrier, provisioned on request; no customer-owned
 *     carrier accounts), client texts only from an own number: server/crm/sms.ts resolveSmsSender,
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
 *   - the client-texting number: Agency includes one and Unlimited two (limits.clientTexting "included",
 *     textingNumbersIncluded), the Client texting number add-on on the plans in
 *     ADDONS.texting_number.availableOn: shared/plans.ts
 * Plan names and numbers come from the price book (allowanceLine, plan-copy helpers), never typed.
 */

const SEGMENTS: FeatureAllowance = { limit: "teamTextSegments", unit: "text segments", period: "month" };
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
      body: "A number we set up for you on ConstructHUB's carrier.",
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
    note: `Every text your CRM sends counts, to your team or to a client. Texting also comes with the ${CRM_TEXTING_PLANS} CRM plans. A client-texting number is a separate add-on on some plans.`,
  },
  faqs: [
    {
      q: "What do I need to text my clients?",
      a: `A number of your own. Carriers no longer let one shared number text on behalf of many businesses, so the shared ConstructHUB number only texts your own team. ${CLIENT_NUMBER_INCLUDED_PLANS} each include a client-texting number we set up for you; on the ${NUMBER_ADDON} platform plans it is the ${ADDONS.texting_number.name} add-on. The number needs its carrier registration (10DLC).`,
    },
    {
      q: "Which plans include texting, and how many texts?",
      a: `Texts are sent from ConstructHub CRM, and texting is included with ${TEXTING_EITHER_LINE}. On the CRM plans, text segments a month: ${CRM_TEXT_SEGMENTS_LINE}. On the platform plans, ${allowanceLine(SEGMENTS)}. An account with both has the two allowances as one monthly pool. On other plans, emails and in-app alerts keep working.`,
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
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"):
  // the alert events and channels: shared/schema.ts CRM_NOTIFICATION_PREFS, server/crm/notify.ts; client texts: server/crm/portal.ts,
  // server/crm/sms.ts, server/crm/messages.ts; the two senders, client texts never from the shared number:
  // server/crm/sms.ts resolveSmsSender, orgCanTextClients; segment sizes
  // (160/153, 70/67, one character switches the whole text): server/crm/sms-segments.ts; reserve before send, refund on a
  // carrier refusal, a spent month skipped: server/crm/sms.ts sendSms / reserveSmsSegments; STOP words, START, HELP, opted-out
  // numbers never texted, other replies not shown: server/crm/sms.ts inbound webhook, isSmsOptedOut.
  inDepth: {
    heading: { title: "Business Texting for Contractors, ", em: "Explained" },
    paragraphs: [
      "Texting covers two different kinds of text. Team alerts go to you and your staff: an estimate opened, approved " +
        "or declined, a payment, a website lead and more, with in-app, email or text chosen event by event. Client texts " +
        "go to homeowners: the estimate link when you send it, a reminder about an estimate that's still waiting, or a " +
        "quick message.",
      "Which number a text comes from matters. Team alerts can use the shared ConstructHUB number with nothing to set " +
        "up. Texting clients needs a number of your own: a number set up for you on ConstructHUB's carrier. The CRM never " +
        "sends a client text from the shared number, which only texts your team.",
      "Texts are counted in segments, the unit carriers bill. A plain text fits 160 characters in one segment and 153 " +
        "in each segment after that. A single emoji, a curly quote or most accented capital letters switch the whole text " +
        "to a different encoding: 70 characters in one segment and 67 in each one after. Every text your CRM sends is counted " +
        "against your plan's monthly allowance before it goes out. A text the carrier refuses gives its segments back, " +
        "and once the month's allowance is spent, texts are skipped until the 1st instead of running up charges.",
      "Opt-outs are handled the way carriers require. A reply of STOP, UNSUBSCRIBE, CANCEL, END or QUIT opts that phone " +
        "out and gets a confirmation; START opts it back in, and HELP gets a help reply. A number on the opt-out list is " +
        "never texted. Other replies don't appear in the CRM, so client conversations stay in their portal and email.",
    ],
  },
  related: ["crm", "crmLeads", "callAssistant"],
  app: { href: "/crm/settings", surface: "portal", label: "Open text settings" },
  headings: {
    steps: { title: "Texting Set Up in ", em: "Four Steps" },
    cards: { title: "What Texting ", em: "Gives You" },
    faq: { title: "Before You ", em: "Turn It On" },
  },
  seo: {
    title: "Contractor Text Alerts & Client Texting | ConstructHUB",
    description:
      "Text alerts when a bid is signed or a payment lands, estimate links and reminders texted from your own number, and STOP opt-outs handled for you.",
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
