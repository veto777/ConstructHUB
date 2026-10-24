import type { HelpDraft } from "../../types";

/** Written from client/src/pages/admin-proposals.tsx, client/src/pages/public-proposal.tsx and server/proposals/routes.ts as they run. For the people who run ConstructHUB. */
const entry: HelpDraft = {
  key: "admin-proposals", group: "Tools", route: "/admin/proposals", title: "Proposals (admin)",
  whatItIs: "A page for the people who run ConstructHUB: build a proposal once as a template, then send each client a custom offer they can review, choose services from, sign on screen and pay online.",
  whatItDoes: "Tiles count templates, offers sent and opened, signed offers with their contract value, and paid offers with the amount collected. Offers, Templates and Archived list every proposal with its client, total and status. Opening one shows the editor: branding, cover text, an attached PDF, written sections, package groups with prices (pick-one tiers or add-ons, one-time or monthly with a minimum term), payment settings and terms, plus what the client chose and an activity log.",
  howToUse: [
    "Click New template, add your branding, sections, the PDF and your packages with prices, and save.",
    "Click New offer, pick the template and the client, then change any wording, package or price for that client.",
    "Use Preview to see the client's page, then Send to email the link. You get an email when they sign and when they pay.",
  ],
  howItWorks: "The client's link opens a page where they choose services and see live totals, type their name, sign and tick the e-sign consent; the signed copy (PDF) is emailed to them and to you. Payment runs through Stripe: bank transfer (ACH) with no fee, or card with the card fee (3% unless changed) added as its own line. A monthly plan charges the one-time items and the first month, then bills monthly. Signed proposals are locked; duplicate one to make a new version. The server refuses anyone who is not a platform admin.",
  needs: ["Platform admin access.", "Stripe connected for online payment."],
};
export default entry;
