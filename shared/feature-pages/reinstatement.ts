import type { FeaturePage } from "./types";
import { GBP_REINSTATEMENT_CENTS } from "../plans";
import { formatUsd } from "../plan-copy";

/**
 * Reinstatement — the GBP reinstatement service (people, not software).
 *
 * Every claim below is backed by the code in `sources`:
 *   - the four-step process, the suspension causes, soft vs hard suspensions, the trust points ("we tell you
 *     whether we think we can help", "Google alone decides"), the request form's fields (website optional,
 *     address "even if hidden"): client/src/pages/reinstatement.tsx (PROCESS_STEPS, SUSPENSION_REASONS, TRUST_POINTS)
 *   - the request needs no account and charges nothing: it validates the form and emails the team with
 *     reply-to set to the requester (rate limited): server/routes.ts (/api/reinstatement/request, reinstatementLimit)
 *   - the price per project, from the price book: shared/plans.ts GBP_REINSTATEMENT_CENTS
 *     (priced by the template through shared/feature-pages/pricing.ts, kind "service")
 *   - the public route (signed out too): client/src/App.tsx PublicRouter
 */

const PRICE = formatUsd(GBP_REINSTATEMENT_CENTS);

const page: FeaturePage = {
  key: "reinstatement",
  slug: "reinstatement",
  group: "learn",
  status: "ready",
  title: "Reinstatement",
  kicker: "Suspended profile help",
  headline: { lead: "Help With a ", swipe: "Suspended", tail: " Google Business Profile" },
  lede:
    "Our team reviews your suspension, tells you honestly whether we think we can help, gets the profile in line with " +
    "Google's guidelines, and writes and submits the appeal. Google alone decides whether a profile comes back.",
  hero: { mascot: "standing", bubble: "Profile gone quiet? Tell us what happened." },
  steps: [
    {
      title: "Tell us what happened",
      body: "Send the request form with your business details and the problem. It's free, has no obligation and needs no account.",
    },
    {
      title: "Full assessment",
      body: "If we think we can help, we ask for the details and look into what caused the suspension.",
    },
    {
      title: "Fix and comply",
      body: "We tell you every change and supporting document needed to make the profile compliant and eligible.",
    },
    {
      title: "Appeal and follow-up",
      body: "We write and submit an evidence-based appeal, and keep you updated until Google makes its decision.",
    },
  ],
  cards: [
    {
      icon: "search",
      title: "An honest case review",
      body: "We look at your situation first and tell you whether we think we can help before taking the case.",
    },
    {
      icon: "file",
      title: "Guideline-first",
      body: "Every case is checked against Google's published Business Profile guidelines before anything is submitted.",
    },
    {
      icon: "wrench",
      title: "Fix the cause, not just appeal",
      body: "The profile is brought in line with the guidelines first, so the appeal rests on a compliant profile.",
    },
    {
      icon: "clipboard",
      title: "Evidence and documents",
      body: "Guidance on the supporting documents Google may ask for, and how to present them.",
    },
    {
      icon: "send",
      title: "The appeal, written for you",
      body: "We draft and submit the evidence-based appeal and handle the back-and-forth.",
    },
    {
      icon: "message",
      title: "Updates until it's decided",
      body: "You hear from us until Google makes its decision, whichever way it goes.",
    },
  ],
  spotlight: {
    kicker: "Common Causes",
    heading: { title: "Why Profiles Get ", em: "Suspended" },
    points: [
      "Extra keywords or city names added to the business name.",
      "Address problems: virtual offices, PO boxes or co-working spaces.",
      "More than one listing for the same business at the same address.",
      "A surge of reviews that Google flags as possibly incentivized, or service areas and categories that don't match the business.",
    ],
    panel: {
      label: "The request form",
      title: "What we ask for",
      items: [
        "Your name", "Your email", "Business name", "Website (optional)", "Business address, even if hidden",
        "Business type", "Multiple locations?", "What happened",
      ],
      note: "No account and no payment needed to send it.",
    },
  },
  audience: [
    {
      title: "Owners whose profile was suspended",
      body: "Your listing shows as suspended or has dropped off Maps, and you want someone to work through the appeal with you.",
    },
    {
      title: "Service-area and storefront businesses",
      body: "The form covers storefronts, service-area businesses and hybrids, and asks whether you have more than one location.",
    },
  ],
  pricing: {
    kind: "service",
    service: "gbpReinstatement",
    note: "Sending the request form is free; the price is for a case we take on.",
  },
  faqs: [
    {
      q: "What do I need to start?",
      a: "Just the request form: your name and email, the business name and address (even if the address is hidden on Google), the business type, whether you have more than one location, and what happened. A website is optional. You don't need a ConstructHUB account.",
    },
    {
      q: "How much does it cost?",
      a: `${PRICE} per project, paid once. It isn't a subscription and it isn't part of any plan. Sending the form costs nothing, and we tell you whether we think we can help before taking the case.`,
    },
    {
      q: "Will my profile definitely come back?",
      a: "No. Google alone decides whether a profile is reinstated. We only take cases where we're confident we can help, and we say so upfront.",
    },
    {
      q: "What's the difference between a soft and a hard suspension?",
      a: "In a soft suspension the listing becomes unverified but may still be partly visible; it's the most common type. In a hard suspension the listing is removed from Google Search and Maps.",
    },
    {
      q: "What doesn't the service do?",
      a: "It isn't a tool you run inside ConstructHUB: our team works the case with you, starting from your request. It doesn't work around Google's rules; the fix is a profile that follows them.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): soft vs hard suspensions and "Google rarely
  // tells you" are reinstatement.tsx (the "Types of suspensions" box and the causes intro); the review-first, fix-first
  // order is PROCESS_STEPS + TRUST_POINTS; the form (storefront / service-area / hybrid, more than one location, the
  // address even if hidden, website optional) is the form's fields and SelectItems; the request goes to the team by
  // email with reply-to set to the requester, no account and no payment: server/routes.ts /api/reinstatement/request;
  // one price per project: shared/plans.ts GBP_REINSTATEMENT_CENTS (shown by the price block, never typed here).
  inDepth: {
    heading: { title: "Suspended Google Business Profile? ", em: "What Happens Next" },
    paragraphs: [
      "A Google Business Profile suspension can take your listing off Google Maps or leave it unverified, and Google " +
        "rarely says exactly which rule it thinks you broke. Reinstatement is a done-for-you service: people on our " +
        "team work the case with you. It isn't a tool you run inside ConstructHUB, and it doesn't need an account.",
      "There are two kinds of suspension. In a soft suspension the profile loses its verification but may still be " +
        "partly visible; it is the most common kind. In a hard suspension the listing is removed from Google Search " +
        "and Maps, and your dashboard shows it as not visible to customers. Knowing which one you have, and why it " +
        "happened, shapes the rest of the case.",
      "That is why the work starts with the cause rather than the appeal. An appeal asks Google to look at the " +
        "profile again, so the profile is first checked against Google's published Business Profile guidelines. We " +
        "tell you every change to make and every supporting document that may be needed, and the profile is brought " +
        "in line before anything is submitted. Then we write and submit an evidence-based appeal and keep you updated " +
        "until Google decides.",
      "The request form asks for what a case review needs: your business name, the business address even if it is " +
        "hidden on Google, whether you are a storefront, a service-area business or a hybrid, whether you have more " +
        "than one location, and what happened. A website is optional. The form goes to our team by email and we reply " +
        "to the address you give. Sending it is free and commits you to nothing; we tell you whether we think we can " +
        "help before taking the case, and a case we take on has one price per project, shown on this page.",
      "Google alone decides whether a profile is reinstated, so nobody can promise the outcome, and this service " +
        "doesn't work around Google's rules. The aim is a profile that follows them. Once a profile is back, Profile " +
        "Guard in ConstructHUB can watch its fields and tell you when one changes.",
    ],
  },
  related: ["gbp", "profileGuard", "reviews"],
  app: { href: "/reinstatement", surface: "app", label: "Open Reinstatement" },
  tryIt: { label: "Send a free case review request", href: "/reinstatement#reinstatement-form" },
  headings: {
    steps: { title: "From Request to Appeal in ", em: "Four\u00a0Steps" },
    cards: { title: "What the Service ", em: "Includes" },
    audience: { title: "Who It ", em: "Helps" },
  },
  seo: {
    title: "Suspended Google Business Profile Help | ConstructHUB",
    description:
      "Google Business Profile suspended? Our team finds the cause, brings the profile in line with Google's guidelines and writes the appeal. Free case review.",
  },
  sources: [
    "client/src/pages/reinstatement.tsx",
    "server/routes.ts",
    "client/src/App.tsx",
    "server/gbp/guard.ts",
    "shared/plans.ts (GBP_REINSTATEMENT_CENTS)",
    "shared/feature-pages/pricing.ts",
  ],
};

export default page;
