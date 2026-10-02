import type { FeaturePage } from "./types";

/**
 * Posts & Photos — every claim is backed by the code in `sources`:
 *   - works on a location linked to Google Business Profile (the page only opens the editor for a linked one):
 *     client/src/pages/gbp-content.tsx
 *   - post types STANDARD / EVENT / OFFER, call-to-action buttons (Book, Order, Shop, Learn more, Sign up, Call),
 *     coupon code, 1,500-character text, up to 10 photos per post, event/offer times in the location's local time:
 *     server/gbp/content.ts itemInput, gbp-content.tsx
 *   - photo uploads: up to 100 at a time, 15 MB each, JPEG/PNG/WebP, Google photo categories (exterior, interior,
 *     at work, teams, cover…): gbp-content.tsx, server/gbp/content-upload.ts, content.ts categories
 *   - filename pattern ({business}, {city}, {n}), EXIF title and optional GPS make library copies; Google strips
 *     EXIF; captions can't be edited at Google after publishing; cover photos take no caption: gbp-content.tsx copy
 *   - AI caption and post drafts from instructions + examples; "Learn from past updates" style guidance saved only
 *     when you save it; AI text stays a draft until approved: content.ts (/draft, /learn, /style), gbp-content.tsx
 *   - schedule: first publish, items per day/week or custom times, business-hours-only with your timezone, weekdays
 *     and hours: content.ts scheduleInput / scheduleTimes
 *   - approval authorizes publishing; cadence spaces the approved set and does not create an ongoing series:
 *     gbp-content.tsx copy, client/src/pages/guides.tsx ("Posts & Photos scheduling and AI captions")
 *   - calendar / queue / history, Google status refresh, cancel, retry, "uncertain → check Google first":
 *     gbp-content.tsx, content.ts (/refresh, /jobs/:id)
 *   - daily caps (publishing, AI drafts) and the notices (gbp.post_published, gbp.post_failed):
 *     content.ts takeBudget calls, server/notification-kinds.ts
 *   - Agency bulk post/photo batches: client/src/components/agency-workspace.tsx ("Schedule post/photo batch")
 */

const page: FeaturePage = {
  key: "gbpContent",
  slug: "gbp-content",
  group: "grow",
  status: "ready",
  title: "Posts & Photos",
  kicker: "Google posts",
  headline: { lead: "Google Posts and Photos, ", swipe: "On Schedule" },
  lede:
    "Write or draft Google updates, events and offers, upload job photos, and schedule them to publish to your " +
    "Google Business Profile at the pace you set. Nothing publishes until you approve it.",
  hero: { mascot: "standing", bubble: "Got job photos? Let's post them." },
  steps: [
    {
      title: "Choose a linked location",
      body: "Pick a location that's linked to its Google listing in Locations.",
    },
    {
      title: "Add photos and words",
      body: "Upload job photos, write an update, or ask for AI caption and post drafts in your own style. Edit anything before it goes.",
    },
    {
      title: "Set the pace",
      body: "Choose when the first item goes out, how many per day or per week, or exact times, and keep it inside your business hours if you like.",
    },
    {
      title: "Approve and track",
      body: "Approving queues the items. The calendar shows each one's status at Google, and you get a notice when it publishes.",
    },
  ],
  cards: [
    {
      icon: "megaphone",
      title: "Updates, events and offers",
      body: "The post types Google supports, with a button like Book, Call or Learn more, and a coupon code on offers.",
    },
    {
      icon: "camera",
      title: "Photos by category",
      body: "Upload job photos to the listing as exterior, interior, at work, team or other Google photo categories.",
    },
    {
      icon: "sparkles",
      title: "AI drafts in your voice",
      body: "Caption and post drafts from your instructions and example wording, or style guidance learned from your past Google updates.",
    },
    {
      icon: "calendar",
      title: "Cadence and business hours",
      body: "Spread approved items per day or per week, set exact times, and publish only on the weekdays and hours you choose.",
    },
    {
      icon: "check",
      title: "Approval first",
      body: "AI text stays a draft until you approve it. Approving authorizes publishing at the scheduled times.",
    },
    {
      icon: "list",
      title: "Calendar, queue and history",
      body: "See every item by day, refresh its status from Google, cancel anything still queued, and retry a failure.",
    },
    {
      icon: "tag",
      title: "Filenames and photo details",
      body: "Rename photo copies with a pattern like business, city and number, and add a title and GPS tag.",
    },
    {
      icon: "layers",
      title: "Batches on Agency",
      body: "Agency accounts can schedule a post or photo batch across many client locations at once.",
    },
  ],
  audience: [
    {
      title: "Contractors with lots of job photos",
      body: "Upload a batch once and let the schedule spread them over the coming weeks.",
    },
    {
      title: "Owners who don't have time to write",
      body: "Start from an AI draft in your own style, fix what's wrong, approve, done.",
    },
    {
      title: "Agencies posting for clients",
      body: "Queue approved content per location and keep a history of what went out and when.",
    },
  ],
  pricing: {
    kind: "plan",
    note: "Publishing needs a location linked to Google through a connected account. Daily caps keep publishing and AI drafts at a steady pace.",
  },
  faqs: [
    {
      q: "What do I need?",
      a: "A location linked to its Google listing through a connected Google account that can manage the listing. You set that up in Locations.",
    },
    {
      q: "Which plans include it?",
      a: "Every plan. You can upload up to 100 photos at a time, 15 MB each, attach up to 10 photos to a post, and write up to 1,500 characters per update. Daily caps apply to publishing and to AI drafts.",
    },
    {
      q: "Will it keep posting on its own?",
      a: "No. The schedule spaces out the items you approved; it doesn't write new posts by itself. When the queue runs out, add and approve more.",
    },
    {
      q: "Do geotags or keyword filenames help me rank?",
      a: "We don't promise that. Google strips photo details when you upload, so filenames, titles and GPS tags are for your own files. Captions also can't be changed at Google after a photo is published.",
    },
    {
      q: "What if Google rejects a post?",
      a: "You get a notice, and the queue shows the error so you can fix it and retry. If Google's answer was unclear, check your profile before retrying, because a retry could publish the item twice.",
    },
  ],
  // The long-form explanation (WRITING-GUIDE.md → "The In Depth section"): the draft rules (business facts only, missing
  // facts left out, at most three hashtags, captions describe only what is visible) are server/gbp/content.ts
  // draftPrompt; "Learn from past updates" reading the listing's earlier posts and saving only on save is content.ts
  // /learn + PATCH /style; the pacing and business-hours shift (re-checked at publish) are content.ts scheduleTimes +
  // runContentWorker; the daily cap deferring to the next day, published / rejected / uncertain, no automatic re-send
  // and the stop on a changed Google link are runContentWorker; the notices are server/notification-kinds.ts.
  inDepth: {
    heading: { title: "Google Business Profile Posts, ", em: "Explained" },
    paragraphs: [
      "Google Business Profile posts are the updates, events and offers that appear on your listing, and listing " +
        "photos show people the work you do. Posts & Photos publishes both through the Google account you connected " +
        "in Locations, to the listing linked there, so you never hand anyone your Google password.",
      "AI drafts work from facts, not guesses. A post draft uses your listing's business name, description and " +
        "services, plus your instructions, example posts and saved style notes. If your instructions ask for something " +
        "those facts don't supply, such as a discount, a price, a rating, a phone number or a date, the draft leaves it " +
        "out, and it uses at most three hashtags, taken from your business, services or places. A photo caption " +
        "describes only what is visible in the photo. Learn from past updates reads the posts already on your listing " +
        "and suggests style notes, which are kept only when you save them.",
      "Approving a set of items queues it at the pace you chose: a first publish time and a number per day or per " +
        "week, or an exact time for each item. With business hours on, a time that falls outside your chosen weekdays " +
        "and opening hours moves to the next open slot in your time zone, and that's checked again right before " +
        "publishing. A daily publishing cap keeps the pace steady; an item over it waits until the next day. The " +
        "schedule spaces out what you approved. It doesn't write new posts on its own.",
      "Google's answer sets each item's status. An accepted item is marked published and you get a notice; a post " +
        "Google rejects is marked rejected so you can correct it. If a publish is interrupted, the item is marked " +
        "uncertain and is never re-sent automatically, because a second try could post it twice: check your profile, " +
        "then retry. If the location's Google link changes after you queued something, the item stops rather than " +
        "publishing to a different listing.",
    ],
  },
  related: ["gbp", "media", "social"],
  app: { href: "/gbp-content", surface: "app" },
  headings: {
    steps: { title: "From Photo to Published in ", em: "Four\u00a0Steps" },
    faq: { title: "Before You ", em: "Schedule" },
  },
  seo: {
    title: "Google Business Profile Post Scheduler | ConstructHUB",
    description:
      "Schedule Google Business Profile posts, offers, events and job photos at your pace, with AI drafts from your own facts. Nothing publishes unapproved.",
  },
  sources: [
    "client/src/pages/gbp-content.tsx",
    "client/src/pages/guides.tsx",
    "client/src/components/agency-workspace.tsx",
    "server/gbp/content.ts",
    "server/gbp/content-upload.ts",
    "server/notification-kinds.ts",
  ],
};

export default page;
