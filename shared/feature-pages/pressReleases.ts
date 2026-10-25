import type { FeaturePage } from "./types";
import { PRESS_CREDIT_MONTHS, PRESS_PROGRAM_CREDITS, PRESS_PROGRAM_PAID, PRESS_TIER_LABEL } from "../press";

/**
 * Press Releases (the Press Wire). Every claim below is backed by the code in `sources`:
 *   - the three packages, their names and outlet lists, the 12-month program, credits lasting 12 months: shared/press.ts
 *   - the order (one release or the program, Stripe Checkout), the writer, photos (up to 4), edit, approve, cancel
 *     (credit returned), prefill and story ideas: server/press/routes.ts, server/press/ideas.ts
 *   - the AI draft written to the wire's content guidelines, and the guideline check that blocks a send: server/press/writer.ts,
 *     server/press/guidelines.ts
 *   - sending to the wire, reading its answers (changes requested, live, report) and emailing the customer: server/press/worker.ts,
 *     server/press/mailbox.ts
 *   - Autopilot (one draft a month, never sent on its own) and "Send it for me" (2 business days later, with a Hold link):
 *     server/press/autopilot.ts, server/press/send.ts
 *   - sharing a live release to connected social accounts and Google Business Profiles: server/press/share.ts
 *   - any plan: /api/press is behind the platform paywall (server/platform-access.ts), with no plan test of its own
 * The distributor is never named (owner, 2026-10-15). Prices come from shared/press.ts through the "press" pricing kind.
 */

const STANDARD = PRESS_TIER_LABEL.budget;
const PLUS = PRESS_TIER_LABEL.national;
const PREMIUM = PRESS_TIER_LABEL.premium;

const page: FeaturePage = {
  key: "pressReleases",
  slug: "press-releases",
  group: "grow",
  status: "ready",
  title: "Press Releases",
  kicker: "Press wire",
  headline: { lead: "Your Company's News, ", swipe: "on the Wire" },
  lede:
    "Tell us what happened: a new crew, a new service area, an award, a milestone. The AI writes a press release to the " +
    "wire's content guidelines, you approve it, and we send it to the wire and email you the live link and the distribution report.",
  hero: { mascot: "standing", bubble: "Good work deserves the headlines." },
  steps: [
    {
      title: "Pick a package",
      body: `${STANDARD}, ${PLUS} or ${PREMIUM} distribution, as one release or the 12-Month Program. Checkout is a one-time payment, not a subscription.`,
    },
    {
      title: "Tell us the news",
      body: "Choose the kind of news, describe what happened in your own words, add a quote and up to four photos. Your company and contact details fill in from your account.",
    },
    {
      title: "Read the AI's draft",
      body: "The AI writes the headline, the release and the About section to the wire's guidelines. Edit anything, or ask for a rewrite with notes.",
    },
    {
      title: "Approve and go live",
      body: "Approve it and it goes to the wire's editors. You get an email when it is live, then the distribution report.",
    },
  ],
  cards: [
    {
      icon: "megaphone",
      title: "Three distribution packages",
      body: `${STANDARD} puts your news on the wire, online and regional. ${PLUS} reaches the nation's newsrooms and business press. ${PREMIUM} adds the biggest business and TV desks.`,
    },
    {
      icon: "sparkles",
      title: "Written for you, to the wire's rules",
      body: "The AI drafts the release from your details and checks it against the wire's content guidelines before you can send it, so it isn't sent back for avoidable problems.",
    },
    {
      icon: "check",
      title: "Nothing goes out without you",
      body: "You read and approve every release. Cancel before it is sent and the credit comes back.",
    },
    {
      icon: "search",
      title: "Story ideas from your account",
      body: "It looks through your own account for news worth telling, such as a new division, a project or review milestone, an anniversary or new team members, and drafts a starting point.",
    },
    {
      icon: "calendar",
      title: "Autopilot, one draft a month",
      body: "Turn it on and a draft is waiting for you each month on the day you choose. It never sends itself unless you also turn on Send it for me.",
    },
    {
      icon: "send",
      title: "Send it for me",
      body: "Mark a clean draft and it goes out two business days later, with a one-click Hold link in your email in case you change your mind.",
    },
    {
      icon: "mail",
      title: "Live link and report by email",
      body: "We read the wire's answers for you: changes requested, live and the distribution report, and email you each one.",
    },
    {
      icon: "share",
      title: "Shared when it goes live",
      body: "Pick once where a live release is shared: your connected social accounts and your Google Business Profile locations.",
    },
  ],
  spotlight: {
    kicker: "The Release",
    heading: { title: "From What Happened to ", em: "a Release Editors Accept" },
    points: [
      "Pick the kind of news first: a new service, an expansion, a milestone, an award, a hire, an event, a partnership, community work or expert tips.",
      "Your words become a headline, a dateline, the story, a quote from your spokesperson and an About section.",
      "Problems the wire's guidelines would reject are flagged before you approve, with what to change.",
      "If the editors ask for changes, fix the points they raised and send it again without using another credit.",
    ],
    panel: {
      label: "Every release",
      title: "What each release holds",
      items: ["Headline", "Subheadline", "Dateline", "The story", "Spokesperson quote", "About your company", "Media contact", "Photos", "Live link", "Distribution report"],
      note: "Every release shows its status, from draft to live, on one page.",
    },
  },
  audience: [
    {
      title: "Contractors with news to share",
      body: "A new crew, a second location, an award or a big anniversary is news. A release puts it where customers and search engines can find it.",
    },
    {
      title: "Owners who want a steady presence",
      body: `The 12-Month Program and Autopilot keep one release a month going out, with you approving each one. Pay for ${PRESS_PROGRAM_PAID}, get ${PRESS_PROGRAM_CREDITS}.`,
    },
    {
      title: "Companies without a PR person",
      body: "No writer to hire and no wire account to open. You tell us what happened; the writing, the submission and the follow-up are handled here.",
    },
  ],
  pricing: {
    kind: "press",
    note: `Credits from a package are for its own distribution level and last ${PRESS_CREDIT_MONTHS} months. One release a month gets the best results.`,
  },
  faqs: [
    {
      q: "Do I need a plan to buy press releases?",
      a: "Yes. Press Releases works with any ConstructHUB plan, including a trial. The releases themselves are paid once per package, not as a subscription.",
    },
    {
      q: "What counts as news?",
      a: "Something that happened at your company: a new service or website, an expansion, a milestone or anniversary, an award or certification, a new hire, an event, a partnership, community work, or expert tips on a topic in the news.",
    },
    {
      q: "Who writes the release?",
      a: "The AI writes the draft from what you tell us, and you edit and approve it. Nothing is sent until you approve it, or until a draft you marked Send it for me reaches its send time without being held or edited.",
    },
    {
      q: "What happens after I approve it?",
      a: "It goes to the wire's editorial desk, usually within the hour. Most releases are reviewed within one business day. We email you when it is live with the link, and again with the distribution report when the wire sends it.",
    },
    {
      q: `What is the difference between ${STANDARD}, ${PLUS} and ${PREMIUM}?`,
      a: `How far the release goes. ${STANDARD} is the wire plus online and regional outlets. ${PLUS} adds national newsrooms, wire services and business press. ${PREMIUM} is everything in ${PLUS} plus the biggest business sites and the TV network desks. Each package lists its outlets in the app.`,
    },
  ],
  inDepth: {
    heading: { title: "Press Releases for Contractors, ", em: "Explained" },
    paragraphs: [
      "A press release is a short news story about your company, written in the format newsrooms expect and sent out " +
        "through a wire service. Outlets on the wire can publish it as it is, and it gives you a link you can share and " +
        "point customers to. For a contractor, the news is usually something real and local: a new crew, a new service " +
        "area, an anniversary, an award, a community project or a new hire.",
      "Press Releases handles the parts that usually stop a small company from sending one. You choose the kind of news " +
        "and describe it in your own words. Your company name, website, city, contact details and About text fill in " +
        "from what your account already holds, such as your last release, your CRM company or your business profile. " +
        "The AI turns it into a release with a headline, dateline, story, quote and boilerplate, and checks it against " +
        "the wire's content guidelines so problems are fixed before the editors see them.",
      "Once you approve it, the release goes to the wire's editorial desk and the rest is followed up for you. Replies " +
        "from the wire are read automatically: if the editors ask for changes you see exactly what they asked, fix it and " +
        "resend without using another credit; when it is live you get the link by email, and the distribution report " +
        "follows when the wire sends it.",
      "If you would rather not think about it each month, turn on Autopilot. It drafts one release a month from the " +
        "story ideas it finds in your own account, and you approve it. With Send it for me also on, a clean draft goes " +
        "out two business days later unless you press Hold in the email. When a release goes live it can be shared to " +
        "your connected social accounts and your Google Business Profile locations, with the headline and the live link.",
    ],
    bulletsIntro: "What you can send as news:",
    bullets: [
      "A new service, product or website",
      "An expansion: a new area, office, crew or equipment",
      "A milestone, anniversary, award or certification",
      "A new hire or promotion, an event, or a partnership",
      "Community projects, sponsorships, and expert tips on a topic in the news",
    ],
  },
  related: ["social", "gbpContent", "seo"],
  app: { href: "/press-releases", surface: "app" },
  headings: {
    steps: { title: "From Your News to the Wire in ", em: "Four Steps" },
    cards: { title: "What Every Package ", em: "Gives You" },
    faq: { title: "Before You ", em: "Send a Release" },
  },
  seo: {
    title: "Press Releases for Contractors — Written and Sent to the Wire | ConstructHUB",
    description:
      "Tell us your company's news; the AI writes a press release to the wire's guidelines, you approve it, and we send it and email you the live link and report.",
  },
  sources: [
    "shared/press.ts",
    "server/press/routes.ts",
    "server/press/ideas.ts",
    "server/press/writer.ts",
    "server/press/guidelines.ts",
    "server/press/worker.ts",
    "server/press/autopilot.ts",
    "server/press/send.ts",
    "server/press/share.ts",
    "client/src/pages/press-releases.tsx",
  ],
};

export default page;
