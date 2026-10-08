/**
 * The YouTube description, title and tags of a walkthrough video — built, not hand-written.
 *
 * YouTube allows 5,000 characters in a description (the API says 5,000 BYTES of UTF-8, and no "<" or
 * ">"), shows only the first ~150 above "Show more" and in search, and treats walls of unrelated or
 * repeated keywords as spam. So the aim here is the longest description that is still useful:
 * 4,300–4,900 characters of readable text in which every sentence is true of the product and of the
 * video — the producer's own summary, the real steps, the narration (a true transcript), the help
 * entry, and a small hand-written bank of facts per area of the product (AREAS below; every line in
 * it restates something a help entry in shared/help/registry.ts says).
 *
 * Deterministic: the same input gives the same text. The wording that is shared between videos
 * (opening line, benefit sentences, the "about" paragraph, the search terms) is picked by a hash of
 * the help key, so a hundred descriptions are not a hundred copies of one template.
 *
 * Pure: no files, no network. server/youtube/description-sources.ts gathers the input from a checkout.
 */
import { createHash } from "node:crypto";

/* ── Limits ───────────────────────────────────────────────────────────────── */

/** YouTube's hard limit (snippet.description): 5,000 — counted in bytes by the API, in characters by Studio. */
export const YT_DESCRIPTION_LIMIT = 5000;
/** What we aim for, in characters (UTF-16 code units, the way Studio's counter counts). */
export const DESCRIPTION_TARGET_MIN = 4300;
export const DESCRIPTION_TARGET_MAX = 4900;
/** The builder keeps adding true material until it is here (when there is any left), so most land in the upper half of the range. */
export const DESCRIPTION_GOAL = 4600;
/** Never more than this many UTF-8 bytes: a margin of 50 under the API's limit. */
export const DESCRIPTION_MAX_BYTES = 4950;
/** snippet.title allows 100; search results cut a title at about 70. */
export const TITLE_MAX = 70;
/** snippet.tags allows 500 characters in all (commas count, and a tag with a space counts two more for its quotes). */
export const YT_TAGS_LIMIT = 500;
export const TAGS_BUDGET = 450;
export const MAX_HASHTAGS = 5;

export const utf8Bytes = (s: string): number => Buffer.byteLength(s, "utf8");
/** The length of a tag list the way YouTube counts it. */
export const tagsCost = (tags: readonly string[]): number => tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);

/**
 * Words that may not appear in a description: a plan claim the CRM does not make ("included with" —
 * the CRM is a separate product with its own plans), superlatives and promises, the data vendors
 * behind the platform, and the CRM's own host name (it is about to change; constructhub.us is the
 * only address a description gives).
 */
export const BANNED: readonly { name: string; re: RegExp }[] = [
  { name: "included with", re: /\bincluded\s+(?:with|in)\b/i },
  { name: "best", re: /\bbest\b/i },
  { name: "#1", re: /#\s?1\b|\bnumber\s+one\b/i },
  { name: "guarantee", re: /\bguarantee/i },
  { name: "a data vendor's name", re: /\b(?:netr\s?online|netronline|netr|dataforseo|openai|chatgpt|elevenlabs|regrid|attom|ahrefs|semrush|openseo|blotato)\b/i },
  { name: "portal.constructhub", re: /portal\.constructhub/i },
];
/** "Good / better / best" is the name of a kind of estimate (three package options), not a claim: it is read past. */
const TIERS = /\bgood\b[\s,/&-]+(?:and\s+)?better\b[\s,/&-]+(?:and\s+|or\s+)?best\b/gi;
export const bannedIn = (text: string): string[] => { const t = text.replace(TIERS, " "); return BANNED.filter((b) => b.re.test(t)).map((b) => b.name); };

/* ── Shapes ───────────────────────────────────────────────────────────────── */

export type DescriptionEntry = {
  title: string; whatItIs: string; whatItDoes: string; howToUse: readonly string[]; howItWorks: string;
  needs?: readonly string[]; group: string;
};
export type DescriptionStep = { caption: string; narration: string; chapter?: string };
export type Chapter = { at: string; title: string };
export type RelatedVideo = { helpKey: string; title: string; url?: string | null };
export type DescriptionInput = {
  helpKey: string;
  /** The producer's YouTube title ("How to … | ConstructHUB CRM"). */
  title: string;
  /** The producer's two or three sentences (the step script's youtube.description). */
  summary?: string | null;
  entry?: DescriptionEntry | null;
  /** The step script's steps, in order: the narration is the transcript. */
  steps: readonly DescriptionStep[];
  /** Chapter times as mux.ts measured them (youtube.json `chapters`). */
  chapters?: readonly Chapter[] | null;
  durationSec?: number | null;
  tags?: readonly string[] | null;
  playlist?: string | null;
  /** The video's track in docs/tutorials/youtube-order.json. */
  track?: string | null;
  /** Neighbouring videos, nearest first (see `relatedFor`). */
  related?: readonly RelatedVideo[];
  /**
   * "brand": an overview film (the "Start here" group) — a channel-trailer description, not a
   * tutorial's. Default: "brand" when the help entry's group is "Start here", else "tutorial".
   */
  variant?: "tutorial" | "brand";
  /** Brand films: where a competitor's figures were read (the step script's youtube.sources), and the companies named (youtube.names). */
  sources?: readonly { label: string; url: string; read: string }[] | null;
  names?: readonly string[] | null;
};
export type BuiltDescription = {
  helpKey: string; title: string; description: string; tags: string[];
  /** Characters (UTF-16 code units). */
  length: number; bytes: number; sha256: string;
  area: string; hashtags: string[];
  /** True when the description carries a chapter list YouTube will turn into chapter markers. */
  chapters: boolean;
  /**
   * The source material could not fill the description to DESCRIPTION_TARGET_MIN without padding.
   * NOT an error: the text is sent as it is, the scheduler's dry run flags it, and the fix is more
   * true material in the help entry or the script — never filler. Always false for a brand film
   * (it has no length target).
   */
  underTarget: boolean;
  variant: "tutorial" | "brand";
  /** Addresses outside constructhub.us that the description carries on purpose: the sources of a comparison. */
  sourceUrls: string[];
  /** What the builder left out or changed, for the person reading the dry run. */
  notes: string[];
};

/* ── The areas of the product ─────────────────────────────────────────────── */

type Area = {
  /** The benefit, with the area's main search phrase: follows "How to … in ConstructHUB CRM - ". */
  taglines: readonly string[];
  /** Search phrases, most specific first: the tags and the "Search terms" line draw on them. */
  keywords: readonly string[];
  /** After #contractors: the two tags that say what the video is about. */
  hashtags: readonly [string, string];
  /** True statements about this part of the product, each one restating a help entry. */
  why: readonly string[];
};

const CRM_TRADES = ["roofing contractor software", "siding contractor software", "remodeling contractor software", "flooring contractor software", "painting contractor software", "HVAC contractor software", "plumbing contractor software", "electrical contractor software", "general contractor software"];

export const AREAS: Record<string, Area> = {
  "getting-started": {
    taglines: [
      "a contractor CRM that opens on what needs your attention today",
      "one home screen for leads, pipeline value, unscheduled jobs and open invoices",
    ],
    keywords: ["contractor CRM dashboard", "construction CRM tutorial", "contractor CRM setup", "getting started with a contractor CRM", "CRM for contractors", "construction business software", "contractor management software", "job management software", "small contractor CRM", "home services CRM", "contractor business dashboard", "construction company CRM", "field service CRM", "contractor software tutorial", "how to use a CRM for construction", "remodeling CRM", "roofing CRM"],
    hashtags: ["#constructionCRM", "#contractorsoftware"],
    why: [
      "Home shows the headline numbers of the business - new leads, pipeline value, unscheduled jobs and open invoices - so the first look of the day says where the work is.",
      "Each number is a link: click it and you are on that list, without hunting through menus.",
      "A Needs attention list and the team's recent activity sit on the same screen, which keeps small things from being forgotten.",
      "The numbers are read live from your own workspace, so the screen is as current as the work in it.",
      "A new workspace gets a setup checklist - your profile, company details and inviting your crew - that goes away once it is done or dismissed.",
      "Clients, estimates, the schedule, invoices and job photos live in one system, so starting something new is a click from wherever you are.",
      "The CRM opens from the top of the ConstructHUB sidebar, and its own menu is on the left of every screen.",
    ],
  },
  "clients-and-leads": {
    taglines: [
      "a contractor CRM that keeps every client, lead and job on one page",
      "client management for contractors, from first call to paid job",
    ],
    keywords: ["contractor client management", "construction lead tracking", "contractor customer database", "sales pipeline for contractors", "lead management for contractors", "contractor CRM software", "customer list app for contractors", "client history and notes", "construction sales pipeline", "follow up with leads", "track bids and jobs", "CRM for remodelers", "CRM for roofers", "home improvement CRM", "contractor contact manager", "construction customer management", "job pipeline board", "contractor lead tracker"],
    hashtags: ["#constructionCRM", "#leadmanagement"],
    why: [
      "A client's page holds their estimates, invoices, projects, payments, visits and messages, so the whole history is in front of you when the phone rings.",
      "Search finds a client by name, email, phone or address, which is quicker than scrolling a spreadsheet for a job.",
      "Notes are private to your team and never appear in the client's portal.",
      "The activity timeline is kept for you from what happens - estimates sent, emails opened, payments made - so the record does not depend on anyone remembering to write it down.",
      "The pipeline shows every job as a card on a board, from lead through bid sent, approved, scheduled and in progress to complete.",
      "When a client approves an estimate, its project moves to Approved on the pipeline by itself.",
      "Every client automatically gets a private portal page, and you can open it the way they see it.",
      "Leads, bids and booked work sit in one system instead of a notebook, a spreadsheet and a text thread.",
    ],
  },
  estimates: {
    taglines: [
      "contractor estimate software that builds a bid from your price book and sends it for e-signature",
      "construction estimating with a price book, line items and a private link the client approves and signs",
    ],
    keywords: ["contractor estimate software", "construction estimating software", "how to write an estimate", "send an estimate for e-signature", "price book for contractors", "estimate line items", "job quote software", "contractor bid software", "price book template", "estimate approval online", "remodeling estimate", "roofing estimate software", "flooring estimate", "painting estimate", "scope of work on an estimate", "quoting software for contractors", "estimating app for small contractors", "e-sign a construction estimate"],
    hashtags: ["#estimating", "#constructionCRM"],
    why: [
      "A price book turns estimating into picking from a menu: each item brings its price and its scope of work, so bids stay consistent from one job to the next.",
      "The client gets an email with a private link where they can read the bid, ask a question, approve and e-sign - nothing to print.",
      "Each estimate carries a status - Draft, Sent, Viewed, Approved, Declined or Expired - so you can see where every bid stands.",
      "A client who re-opens a bid is a cue to call, and the estimate shows when it was opened.",
      "Change a price once in the price book and every new estimate uses it.",
      "Price book items have a unit - each, square, square foot, linear foot, hour or job - and a waste factor, so the numbers fit how the trade measures work.",
      "Quick Bid prices a job from a measurement report and your per-square-foot prices.",
      "A signed estimate is locked, so the scope and total stay as the client agreed to them.",
    ],
  },
  schedule: {
    taglines: [
      "contractor scheduling software with one crew calendar for every visit and install date",
      "a job scheduling calendar for contractors: book the visit, pick the crew, keep everyone on the same plan",
    ],
    keywords: ["contractor scheduling software", "crew calendar", "job scheduling app", "crew dispatch", "construction scheduling", "appointment scheduling for contractors", "field crew schedule", "install date calendar", "team calendar for contractors", "schedule a site visit", "schedule an install date", "service call scheduling", "contractor calendar app", "calendar feed for crews", "who is on which job", "weekly crew schedule", "remodeling job schedule", "roofing crew schedule"],
    hashtags: ["#scheduling", "#constructionCRM"],
    why: [
      "One calendar holds every visit, install date and appointment, so the office and the crew look at the same plan.",
      "Month, week and agenda views show as much or as little of the schedule as the moment needs.",
      "You can look at your own calendar, everyone's, or one team member's, and the schedule warns you when visits overlap.",
      "Choosing who is going on each visit keeps dispatch clear: everybody can see which jobs are theirs.",
      "A visit linked to a client or a project shows on that page too, so a job's history stays together.",
      "A private feed link lets you subscribe from Apple Calendar, Outlook or Google Calendar, so booked work shows in the calendar app you already use.",
      "Nothing lands on the schedule by itself: you add each visit, so the calendar only ever shows what someone really booked.",
      "The private feed link can be regenerated at any time, which cuts off old copies of it.",
    ],
  },
  "invoices-and-payments": {
    taglines: [
      "contractor invoicing software that turns an approved estimate into an invoice with a secure payment link",
      "construction invoicing and payments: send the invoice, take a card or bank payment, record checks and cash",
    ],
    keywords: ["contractor invoicing software", "construction invoice", "how to invoice a client", "online payments for contractors", "invoice from an estimate", "record a check payment", "payment link for contractors", "accept card payments as a contractor", "ACH payments for contractors", "paid in full receipt", "overdue invoices", "contractor billing software", "construction billing", "invoice app for contractors", "job payment tracking", "track unpaid invoices"],
    hashtags: ["#invoicing", "#constructionCRM"],
    why: [
      "An approved estimate converts into an invoice, so nobody retypes the job in order to bill it.",
      "The client gets a secure payment link, and once your own Stripe account is connected they can pay by card or bank transfer.",
      "Money from online payments goes straight to your own Stripe account; ConstructHUB never holds it.",
      "A check, cash or a wire is recorded by hand, so the balance is right however the client paid.",
      "A receipt builds itself from the invoice once a payment is recorded, and is marked PAID IN FULL when the invoice is settled.",
      "Filtering the invoice list by status shows what is paid, due and overdue, which makes it plain who to chase.",
      "Voiding an invoice keeps the paper trail instead of erasing it.",
      "In Settings you choose card, bank transfer (ACH) or both, and whether card fees are passed to the client.",
    ],
  },
  projects: {
    taglines: [
      "construction project management for contractors: costing, change orders, punch list and daily logs on one job page",
      "a project page that keeps job costing, change orders, selections and permits together",
    ],
    keywords: ["construction project management software", "job costing for contractors", "change order software", "punch list app", "construction daily log", "contractor project tracking", "client selections", "permit tracking on a job", "project management for remodelers", "job cost tracking", "construction change orders", "contract value and change orders", "residential construction project management", "roofing project management", "project pipeline", "construction job tracking", "daily job log", "contractor job folder"],
    hashtags: ["#projectmanagement", "#constructionCRM"],
    why: [
      "A project's page has costing, change orders, a punch list, daily logs, selections and permits, so one job's paperwork is in one place.",
      "A change order the client approves on its link adjusts the contract value, so the paperwork and the numbers agree.",
      "Every job is a card on the pipeline board, moving through lead, bid sent, approved, scheduled, in progress and complete.",
      "When a client approves an estimate, its project moves to Approved by itself.",
      "A punch list and daily logs give the crew and the office the same record of what was done and what is left.",
      "You move a job along by dragging its card to the next column, or from the menu on the card.",
      "Opening a card takes you straight to the project, so the board doubles as the way in to each job.",
    ],
  },
  jobcam: {
    taglines: [
      "a job site photo app for contractors that files every photo and video to its project with time and location",
      "construction photo documentation: job-site photos and video, tagged, searchable and shareable with the client",
    ],
    keywords: ["job site photo app", "construction photo documentation", "contractor photo app", "job photos by project", "before and after job photos", "progress photos for clients", "construction site camera app", "photo timeline of a job", "share job photos with a client", "roofing photo documentation", "geotagged job photos", "tag and search job photos", "job site video", "photo proof of work", "remodeling progress photos", "construction photo management", "crew photo uploads", "job photo sharing link"],
    hashtags: ["#jobsitephotos", "#constructionCRM"],
    why: [
      "Job-site photos and video are filed to their project with the time and location they were shot, instead of being lost in a phone's camera roll.",
      "The camera picks the nearest project, or you choose one, so a shot lands on the right job.",
      "The feed is searchable by project, address, tag and person, with filters for tags, starred shots, photos, videos and dates.",
      "Each capture is saved on the phone first and uploaded from a queue, so a lost connection on site does not lose a shot.",
      "A share link can be a fixed gallery of the shots you picked or a live timeline that keeps updating, and it can have a password.",
      "You decide which shots the client may see, and a link can be revoked when it is no longer needed.",
      "Tags stay set for the session, so a run of photos of the same thing is labelled once.",
      "A revoked or expired link shows the client an honest \"turned off\" or \"expired\" page.",
    ],
  },
  messages: {
    taglines: [
      "client messaging for contractors, with one thread per client and replies that reach their inbox",
      "a contractor inbox that keeps every client conversation in one thread",
    ],
    keywords: ["client messaging for contractors", "contractor client communication", "customer messages in a CRM", "contractor inbox", "client portal messages", "reply to client questions", "construction client communication", "customer communication software", "client activity tracking", "estimate questions from clients", "homeowner communication", "contractor customer service", "keep client conversations in one place", "CRM inbox", "job communication log", "remodeling client updates"],
    hashtags: ["#clientcommunication", "#constructionCRM"],
    why: [
      "Each client has one thread, so the whole conversation is in one place instead of spread over phones and inboxes.",
      "A client can write from their portal or ask a question on an estimate, and it arrives in the same thread.",
      "Your reply shows in the client's portal and is emailed to them when they have an email address on file.",
      "Unread threads are counted on the Messages tab, so a question does not sit unanswered.",
      "The Client activity tab shows opens, approvals and payments, which tells you what clients are doing between messages.",
      "The conversation with a client also appears on that client's page, next to their estimates and invoices.",
    ],
  },
  "team-and-settings": {
    taglines: [
      "team roles and permissions for a contracting company, so each person sees what their job needs",
      "contractor team management: invite the crew, set roles, and put your company details on every document",
    ],
    keywords: ["contractor team management", "user roles and permissions", "invite employees to a CRM", "crew and office access", "subcontractor access", "company settings for contractors", "field crew permissions", "sales rep permissions", "contractor company profile", "construction office software", "multi-division contractor", "team setup for a CRM", "license number on documents", "employee access control", "project manager role", "contractor back office software", "document defaults for estimates and invoices"],
    hashtags: ["#teammanagement", "#constructionCRM"],
    why: [
      "People are invited by email with a role - Owner, Admin, Sales, Project manager, Office, Field or Subcontractor.",
      "The role decides what a person can see and change, and the server enforces it.",
      "Individual permissions can be adjusted when one person needs a little more or less than their role gives.",
      "Removing someone cuts their access immediately, and what they created stays.",
      "Divisions give one company separate operating arms, each with its own name, address and license.",
      "The company details kept here are the ones that print on your documents.",
      "A pending invite can be resent or cancelled, and a member's role can be changed later.",
    ],
  },
  integrations: {
    taglines: [
      "contractor CRM integrations: a website lead form, calendar feeds, online payments, API keys and webhooks",
      "connect the CRM to the tools a contracting business already uses",
    ],
    keywords: ["contractor CRM integrations", "website lead capture form", "lead form for a contractor website", "CRM API key", "CRM webhooks", "calendar integration", "connect payments to a CRM", "measurement report integration", "construction software integrations", "embed a lead form", "website leads to CRM", "CRM reports", "developer API for a CRM", "connect business tools"],
    hashtags: ["#integrations", "#constructionCRM"],
    why: [
      "A lead-capture form goes on your own website by embed code or link, and what people send becomes clients tagged as website leads.",
      "Each integration is set up once, from its own card on the Integrations page.",
      "Read-only API keys and webhooks let your own systems read from the CRM and be told when something happens.",
      "An API key is shown in full only once, when it is created, so it cannot be read back out of the page later.",
      "A measurement report lands on the client whose address matches it.",
      "Online payments run through your own connected Stripe account.",
    ],
  },
  "client-portal": {
    taglines: [
      "a client portal for contractors, where a homeowner reads the bid, pays and writes to you",
      "the customer portal every client gets: estimates, invoices, payments and messages in one private page",
    ],
    keywords: ["client portal for contractors", "customer portal software", "homeowner portal", "construction client portal", "client login for estimates and invoices", "pay an invoice online", "client view of an estimate", "remodeling client portal", "customer self service portal", "client messages portal", "contractor customer experience", "online estimate approval", "portal link for a client", "what the client sees", "roofing customer portal"],
    hashtags: ["#clientportal", "#constructionCRM"],
    why: [
      "Every client automatically gets a private portal page - there is nothing to set up for each one.",
      "\"See what the client sees\" opens a client's portal the way they see it, so you can check it before you point them to it.",
      "A client can write to you from their portal, and your reply shows there and is emailed to them.",
      "With your own Stripe account connected, the portal gets a Pay button for card or bank transfer.",
      "Notes are private to your team and never appear in the portal.",
      "The first time a client opens an estimate link they confirm their email with a one-time code.",
    ],
  },
  /** A CRM video that is in no track yet. */
  crm: {
    taglines: [
      "a CRM for contractors: clients, estimates, the schedule, invoices and job photos in one place",
      "contractor CRM software for estimates, scheduling, invoices and job-site photos",
    ],
    keywords: ["contractor CRM", "construction CRM software", "CRM for contractors", "contractor management software", "job management software", "construction business software", "home services CRM", "CRM tutorial for contractors", "small contractor software", "remodeling CRM", "roofing CRM", "field service software", "contractor estimate and invoice software", "construction company software", "contractor business tools", "how to use a contractor CRM"],
    hashtags: ["#constructionCRM", "#contractorsoftware"],
    why: [
      "Clients, estimates, the schedule, invoices and job photos live in one system, so a job's history is in one place.",
      "A client's page holds their estimates, invoices, projects, payments, visits and messages.",
      "Estimates are built from a price book and sent as a private link the client can approve and e-sign.",
      "One calendar holds every visit, install date and appointment.",
      "The role each person is given decides what they can see and change.",
      "Every screen has an \"i\" button that opens its help, with the walkthrough video beside it.",
    ],
  },
  /** The platform's Permits & Databases group (Database Directory, Property Records). */
  permits: {
    taglines: [
      "a building permit office lookup that gives you the official permit portal of a county or city, or says plainly when none is on record",
      "look up the county or city permit office and its official permit portal before you bid the job",
    ],
    keywords: ["building permit lookup", "permit office lookup", "permit portal", "county building permits", "city building permits", "where to apply for a building permit", "find a permit office", "building department lookup", "contractor permit search", "online permit portal by city", "local permit office", "roofing permit", "remodeling permit", "HVAC permit", "electrical permit", "plumbing permit", "which office issues the permit", "county permit portal", "property records lookup"],
    hashtags: ["#buildingpermits", "#permits"],
    why: [
      "The directory lists county and city permit offices in all 50 states and DC, so a job in an unfamiliar town starts with the right office.",
      "A portal link is stored only after a liveness check, and dead links are marked.",
      "Where no portal is known you get a \"Find permit portal\" web search instead of a guessed link.",
      "Nothing in the directory is generated or guessed.",
      "Some towns do not issue their own permits, and the directory says so and points to the county that does.",
      "Property Records is the companion page: a finder for the official county property appraiser or assessor office.",
      "Knowing whether the city or the county issues the permit before you bid saves a call to the wrong office.",
    ],
  },
  /** Any other page of the platform. */
  platform: {
    taglines: [
      "one of the ConstructHUB tools for contractors",
      "part of the ConstructHUB toolset for contracting businesses",
    ],
    keywords: ["contractor business tools", "tools for contractors", "contractor marketing tools", "Google Business Profile tools for contractors", "local SEO for contractors", "contractor website tools", "construction business software", "contractor software tutorial", "permit lookup for contractors", "property records lookup", "home services marketing", "small contractor software", "ConstructHUB tutorial"],
    hashtags: ["#contractorsoftware", "#ConstructHUB"],
    why: [
      "ConstructHUB keeps a contractor's everyday tools in one place: permit and property record lookup, Google Business tools and SEO tools.",
      "Every page has an \"i\" button that opens its help, with the walkthrough video beside it.",
      "The Tutorials page lists every feature with its written steps and its video.",
    ],
  },
};

const WHO_FOR = [
  "Made for contractors: roofing, siding, remodeling, flooring, painting, HVAC, plumbing, electrical and general contractors.",
  "For roofing, siding, remodeling, flooring, painting, HVAC, plumbing and electrical contractors, and general contractors who run their own office.",
  "Whether you run a roofing, siding, remodeling, flooring, painting, HVAC, plumbing, electrical or general contracting business, the steps are the same.",
];
const ABOUT = [
  "ConstructHUB is a toolset for contractors: permit office and property record lookup, Google Business tools and SEO tools. ConstructHUB CRM is a separate product with its own plans, for estimates, invoices, scheduling and job photos.",
  "ConstructHUB gives contractors permit office and property record lookup, Google Business tools and SEO tools in one place. The CRM is a separate product with its own plans: estimates, invoices, scheduling and job photos.",
  "ConstructHUB is built for contracting businesses. The toolset covers permit and property record lookup, Google Business tools and SEO tools; ConstructHUB CRM, a separate product with its own plans, covers estimates, invoices, scheduling and job photos.",
];
const DEMO_NOTE = [
  "The client names, jobs and figures on screen are sample data in a demo workspace.",
  "Everything on screen - names, addresses, prices - is sample data from a demo workspace.",
  "The recording uses a demo workspace: the people, jobs and amounts in it are sample data.",
];
/** What every CRM help entry says about plans (shared/help/registry.ts CRM_NEED), for a video whose entry is not merged yet. */
export const CRM_PLAN_FACT = "A ConstructHub CRM plan - the CRM is a separate product with its own plans.";

/* ── Small helpers ────────────────────────────────────────────────────────── */

/** FNV-1a: the same key always picks the same wording. */
export function keyHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export const pick = <T>(list: readonly T[], helpKey: string, salt: string): T => list[keyHash(`${salt}:${helpKey}`) % list.length];
export const rotate = <T>(list: readonly T[], helpKey: string, salt: string): T[] => {
  const n = list.length ? keyHash(`${salt}:${helpKey}`) % list.length : 0;
  return [...list.slice(n), ...list.slice(0, n)];
};

/**
 * Plain text YouTube accepts: no angle brackets, typewriter quotes and dashes (so a character is a
 * byte, give or take an arrow), one space between words. `timestamps: false` also breaks anything
 * that looks like a time ("10:00"), because YouTube reads every m:ss in a description as a chapter.
 */
export function plain(text: string, opts: { timestamps?: boolean } = {}): string {
  let t = String(text ?? "")
    .replace(/[<>]/g, "")
    .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, "\"")
    .replace(/\s*[–—]\s*/g, " - ").replace(/…/g, "...").replace(/ /g, " ")
    .replace(/[ \t]+/g, " ").trim();
  if (!opts.timestamps) t = t.replace(/(\d):(\d\d)(?!\d)/g, "$1.$2");
  return t;
}
/** Sentences: a full stop, "!" or "?" followed by a space and a capital ("Washington, D.C." stays whole). */
export const sentences = (text: string): string[] => plain(text).split(/(?<=[.!?]["')]?)\s+(?=["'(]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
const words = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
const endStop = (s: string) => (/[.!?]["')]?$/.test(s) ? s : `${s}.`);
const noStop = (s: string) => s.replace(/[.:;,]+$/, "");

/** Source text with the sentences that break a rule taken out (and noted), never reworded. */
function clean(text: string | null | undefined, notes: string[], what: string): string {
  const kept = sentences(text ?? "").filter((s) => {
    const bad = bannedIn(s);
    if (bad.length) notes.push(`${what}: left out a sentence that says ${bad.map((b) => `"${b}"`).join(", ")}`);
    return !bad.length;
  });
  return kept.join(" ");
}

const seconds = (at: string): number | null => {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(at.trim());
  return m && +m[3] < 60 ? (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] : null;
};
/**
 * YouTube turns a list of timestamps into chapters only when the first is 0:00, there are at least
 * three, they rise, and every chapter is at least ten seconds long (the last one too, when the
 * video's length is known).
 */
export function validChapters(chapters: readonly Chapter[] | null | undefined, durationSec?: number | null): boolean {
  if (!chapters || chapters.length < 3) return false;
  const at = chapters.map((c) => seconds(c.at));
  if (at.some((s) => s === null) || at[0] !== 0) return false;
  if (chapters.some((c) => !plain(c.title))) return false;
  for (let i = 1; i < at.length; i++) if (at[i]! - at[i - 1]! < 10) return false;
  return !(durationSec && durationSec - at[at.length - 1]! < 10);
}
/** The chapter list a description carries: the lines that start with a time, as [seconds, title]. */
export function chaptersIn(description: string): { sec: number; title: string }[] {
  return description.split("\n").flatMap((l) => {
    const m = /^(\d{1,2}(?::\d{2}){1,2}) (.+)$/.exec(l);
    const sec = m ? seconds(m[1]) : null;
    return m && sec !== null ? [{ sec, title: m[2] }] : [];
  });
}

/** Which bank of facts and keywords a video draws on. */
export function areaFor(o: { helpKey: string; track?: string | null; group?: string | null }): string {
  const crmKey = /^(crm-|jobcam)/.test(o.helpKey);
  if (o.group ? o.group !== "CRM" : !crmKey) return o.group === "Permits & Databases" || /permit|database-directory|property-records/.test(o.helpKey) ? "permits" : "platform";
  if (o.track && o.track !== "getting-started" && AREAS[o.track]) return o.track;
  const k = o.helpKey;
  const guess: [RegExp, string][] = [
    [/jobcam|photo/, "jobcam"], [/portal/, "client-portal"], [/estimate|pricebook|price-book|quick-bid|bid(?!-status)/, "estimates"],
    [/schedule|calendar|appointment/, "schedule"], [/invoice|payment|receipt|financing/, "invoices-and-payments"],
    [/project|change-order|punch|daily-log|selection|costing|permit/, "projects"], [/message|inbox/, "messages"],
    [/team|role|division|settings|billing|notification|profile|document/, "team-and-settings"],
    [/integration|api|webhook|hover|lead-capture|migrate|report/, "integrations"], [/client|lead|pipeline|follow/, "clients-and-leads"],
  ];
  return guess.find(([re]) => re.test(k))?.[1] ?? (o.track && AREAS[o.track] ? o.track : "crm");
}

/** "How to add a client | ConstructHUB CRM" → ["How to add a client", "ConstructHUB CRM"]. */
function splitTitle(title: string): { task: string; brand: string } {
  const i = title.lastIndexOf(" | ");
  return i > 0 ? { task: title.slice(0, i).trim(), brand: title.slice(i + 3).trim() } : { task: title.trim(), brand: "" };
}
export const taskOf = (title: string): string => splitTitle(plain(title)).task;

/**
 * A producer's title is left alone unless it is over TITLE_MAX: then a bracketed aside goes first,
 * and after that the task is cut at a word, keeping "| ConstructHUB CRM".
 */
export function fitTitle(title: string): string {
  const t = plain(title).replace(/\s+/g, " ");
  if (t.length <= TITLE_MAX) return t;
  const { task, brand } = splitTitle(t);
  const tail = brand ? ` | ${brand}` : "";
  let short = task.replace(/\s*\([^)]*\)/g, "").trim();
  if ((short + tail).length > TITLE_MAX) {
    const room = TITLE_MAX - tail.length;
    short = short.slice(0, room + 1).replace(/\s+\S*$/, "").replace(/[\s,;:&-]+$/, "");
  }
  return short + tail;
}

/**
 * The tags: the producer's own first (they are about this video), then the area's phrases from the
 * most specific on, then the brand — no duplicates, up to TAGS_BUDGET characters as YouTube counts them.
 */
export function buildTags(input: Pick<DescriptionInput, "helpKey" | "tags">, area: string): string[] {
  const a = AREAS[area] ?? AREAS.crm, crm = area !== "permits" && area !== "platform";
  const pool = [...(input.tags ?? []), ...a.keywords, ...(crm ? ["ConstructHUB CRM", "contractor CRM", ...rotate(CRM_TRADES, input.helpKey, "tag-trades")] : []), "ConstructHUB", "contractor software"];
  const out: string[] = [], seen = new Set<string>();
  for (const raw of pool) {
    const tag = plain(raw).replace(/[,"#]/g, "").trim();
    if (tag.length < 2 || tag.length > 40 || seen.has(tag.toLowerCase()) || bannedIn(tag).length) continue;
    if (tagsCost([...out, tag]) > TAGS_BUDGET) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/**
 * The neighbours of a video for "Related tutorials": the rest of its own track, nearest first
 * (the next one before the previous one), then the tracks on either side.
 */
export function relatedFor(helpKey: string, tracks: readonly { name: string; keys: readonly string[] }[], titleOf: (key: string) => string | null | undefined, urlOf: (key: string) => string | null | undefined = () => null, max = 8): RelatedVideo[] {
  const ti = tracks.findIndex((t) => t.keys.includes(helpKey));
  const order: string[] = [];
  if (ti >= 0) {
    const keys = tracks[ti].keys, i = keys.indexOf(helpKey);
    for (let d = 1; d < keys.length; d++) { if (keys[i + d]) order.push(keys[i + d]); if (i - d >= 0) order.push(keys[i - d]); }
    for (let d = 1; d < tracks.length; d++) for (const t of [tracks[ti + d], tracks[ti - d]]) if (t) order.push(...t.keys);
  } else for (const t of tracks) order.push(...t.keys);
  const out: RelatedVideo[] = [];
  for (const k of order) {
    if (out.length >= max) break;
    const title = k === helpKey ? null : titleOf(k);
    if (title && !out.some((r) => r.helpKey === k)) out.push({ helpKey: k, title: taskOf(title), url: urlOf(k) ?? null });
  }
  return out;
}

/* ── The builder ──────────────────────────────────────────────────────────── */

type Knobs = { why: number; terms: number; related: number; quickRef: boolean; howItWorks: boolean; detail: boolean; labels: boolean; about: boolean; steps: number };

export function buildDescription(input: DescriptionInput): BuiltDescription {
  if ((input.variant ?? (input.entry?.group === BRAND_GROUP ? "brand" : "tutorial")) === "brand") return buildBrandDescription(input);
  const notes: string[] = [], key = input.helpKey, entry = input.entry ?? null;
  const area = areaFor({ helpKey: key, track: input.track, group: entry?.group }), A = AREAS[area];
  const crm = area !== "permits" && area !== "platform";
  const title = fitTitle(input.title);
  if (title !== plain(input.title)) notes.push(`title shortened to ${title.length} characters (was ${plain(input.title).length})`);
  const { task } = splitTitle(title);
  const product = crm ? "ConstructHUB CRM" : "ConstructHUB";
  const phrase = /constructhub/i.test(task) ? task : `${task} ${crm ? "in" : "on"} ${product}`;

  const steps = input.steps.map((s) => ({ caption: noStop(plain(s.caption)), narration: clean(s.narration, notes, "narration"), chapter: s.chapter ? plain(s.chapter) : undefined })).filter((s) => s.narration);
  const summary = clean(input.summary, notes, "summary") || (entry ? clean(entry.whatItIs, notes, "help entry") : "");
  const usedWhatItIs = !clean(input.summary, [], "") && !!entry;

  // Chapters, as the script names them: the first step always starts one.
  const groups: { title: string; steps: typeof steps }[] = [];
  steps.forEach((s, i) => { if (i === 0 || s.chapter) groups.push({ title: s.chapter ?? "", steps: [] }); groups[groups.length - 1].steps.push(s); });
  const named = groups.filter((g) => g.title).length >= 2;
  const chaptersOk = validChapters(input.chapters, input.durationSec);
  if (input.chapters?.length && !chaptersOk) notes.push("the chapter times are not a list YouTube accepts (first at 0:00, three or more, 10 s apart): written as Steps, without times");

  // Section 6: the area's facts that the help entry of this very video does not already say.
  const said = [entry?.whatItIs, entry?.whatItDoes, entry?.howItWorks, ...(entry?.howToUse ?? []), ...(entry?.needs ?? []), summary].flatMap((t) => sentences(t ?? "")).map((s) => new Set(words(s)));
  const fresh = (s: string) => { const w = new Set(words(s)); return !said.some((o) => { let both = 0; w.forEach((x) => { if (o.has(x)) both++; }); return both / Math.max(1, Math.min(w.size, o.size)) > 0.6; }); };
  const whyBank = rotate(A.why, key, "why").filter(fresh);

  const needs = entry?.needs?.length ? entry.needs.map((n) => clean(n, notes, "help entry")).filter(Boolean) : crm ? [CRM_PLAN_FACT] : [];
  const hashtags = ["#contractors", ...A.hashtags, ...(A.hashtags.includes("#ConstructHUB") ? [] : ["#ConstructHUB"])].slice(0, MAX_HASHTAGS);
  const related = (input.related ?? []).filter((r) => r.helpKey !== key && plain(r.title) && !bannedIn(r.title).length);
  const playlist = input.playlist ? plain(input.playlist) : "";

  const render = (k: Knobs): string => {
    const out: string[] = [];
    const section = (label: string, lines: string[]) => { if (lines.length) out.push("", label, ...lines); };

    // 1 ── the hook: what shows above "Show more" and in search.
    out.push(`${phrase} - ${pick(A.taglines, key, "tagline")}.`);
    if (summary) out.push(summary);
    out.push("", pick(WHO_FOR, key, "who"), "Try ConstructHUB: https://constructhub.us");

    // 2 ── in this video
    const bullets = named
      ? groups.slice(0, 6).map((g) => {
        const inside = g.steps.map((s) => s.caption).filter((c) => c && c.toLowerCase() !== g.title.toLowerCase()).slice(0, 4);
        return `• ${g.title || task}${k.detail && inside.length ? `: ${inside.join("; ")}` : ""}`;
      })
      : Array.from(new Set(Array.from({ length: Math.min(6, steps.length) }, (_, i) => steps[Math.floor((i * steps.length) / Math.min(6, steps.length))].caption))).filter(Boolean).map((c) => `• ${c}`);
    section("IN THIS VIDEO", bullets);

    // 3 ── chapters (only ever a list YouTube accepts), or the steps by name
    if (chaptersOk) section("CHAPTERS", input.chapters!.map((c) => `${c.at.trim()} ${plain(c.title)}`));
    else if (named) section("STEPS", groups.map((g, i) => `${i + 1}. ${g.title || task}`));

    // 4 ── step by step: the narration, numbered
    const walk: string[] = [];
    let n = 0;
    for (const g of groups) {
      if (n >= k.steps) break;
      if (named && g.title) walk.push(`▶ ${g.title}`);
      for (const s of g.steps) {
        if (n >= k.steps) break;
        n++;
        walk.push(`${n}. ${k.labels && s.caption ? `${s.caption} - ` : ""}${s.narration}`);
      }
    }
    if (n < steps.length) walk.push("The video shows the remaining steps.");
    if (crm && walk.length) walk.push(pick(DEMO_NOTE, key, "demo"));
    section("STEP BY STEP", walk);

    // 5 ── from the help entry
    section("WHAT YOU NEED", needs.map((x) => `• ${endStop(x)}`));
    if (entry) {
      const know = [usedWhatItIs ? "" : clean(entry.whatItIs, notes, "help entry"), clean(entry.whatItDoes, notes, "help entry"), k.howItWorks ? clean(entry.howItWorks, notes, "help entry") : ""].filter(Boolean);
      section("GOOD TO KNOW", know);
      if (k.quickRef) section("THE SHORT VERSION, FROM THE IN-APP HELP", entry.howToUse.map((h) => clean(h, notes, "help entry")).filter(Boolean).map((h, i) => `${i + 1}. ${endStop(h)}`));
    }

    // 6 ── why
    section(crm ? "WHY CONTRACTORS USE THIS" : "WHY CONTRACTORS USE IT", whyBank.length && k.why ? [whyBank.slice(0, k.why).join(" ")] : []);

    // 7 ── related
    const rel = related.slice(0, k.related).map((r) => `• ${plain(r.title)}${r.url ? ` - ${r.url}` : ""}`);
    section(crm ? "RELATED CONSTRUCTHUB CRM TUTORIALS" : "RELATED CONSTRUCTHUB TUTORIALS", [...rel, ...(playlist && rel.length ? [`Playlist: ${playlist}`] : [])]);
    if (!rel.length && playlist) section("PLAYLIST", [playlist]);

    // 8 ── about
    section("ABOUT CONSTRUCTHUB", [
      ...(k.about ? [pick(ABOUT, key, "about")] : []),
      "Website: https://constructhub.us",
      "All tutorials: https://constructhub.us/tutorials",
      `Help for this page: https://constructhub.us/tutorials#help-${key}`,
    ]);

    // 9 ── search terms (none that the text above already has word for word), then the hashtags
    const body = out.join("\n").toLowerCase();
    const terms = [...rotate(A.keywords, key, "terms"), ...(crm ? rotate(CRM_TRADES, key, "trades").slice(0, 3) : [])]
      .filter((t, i, all) => !body.includes(t.toLowerCase()) && all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i).slice(0, k.terms);
    if (terms.length) out.push("", `Search terms: ${terms.join(", ")}.`);
    out.push("", hashtags.join(" "));
    return out.join("\n");
  };

  const k: Knobs = { why: Math.min(3, whyBank.length), terms: 15, related: 5, quickRef: true, howItWorks: true, detail: true, labels: false, about: true, steps: steps.length };
  const over = (t: string) => t.length > DESCRIPTION_TARGET_MAX || utf8Bytes(t) > DESCRIPTION_MAX_BYTES;
  let text = render(k);

  // Too long: take away from the bottom up, the walkthrough last.
  const trims: (() => boolean)[] = [
    () => k.terms > 12 && (k.terms = 12, true),
    () => k.related > 4 && (k.related = 4, true),
    () => k.why > 2 && (k.why = 2, true),
    () => k.quickRef && (k.quickRef = false, true),
    () => k.why > 1 && (k.why = 1, true),
    () => k.detail && (k.detail = false, true),
    () => k.howItWorks && (k.howItWorks = false, true),
    () => k.about && (k.about = false, true),
    () => k.why > 0 && (k.why = 0, true),
  ];
  for (const trim of trims) { if (!over(text)) break; if (trim()) text = render(k); }
  while (over(text) && k.steps > 1) { k.steps--; text = render(k); }
  if (k.steps < steps.length) notes.push(`the walkthrough stops after step ${k.steps} of ${steps.length} to stay under ${YT_DESCRIPTION_LIMIT} characters`);
  if (over(text)) throw new Error(`${key}: the description cannot be brought under ${DESCRIPTION_TARGET_MAX} characters`);

  // Too short: more of sections 4–6 (never the same thing twice), as long as it still fits.
  const grows: (() => (() => void) | null)[] = [
    ...Array.from({ length: 8 }, () => () => (k.why < whyBank.length ? (k.why++, () => { k.why--; }) : null)),
    () => (!k.labels ? (k.labels = true, () => { k.labels = false; }) : null),
    () => (k.terms < 18 ? ((k.terms = 18), () => { k.terms = 15; }) : null),
    () => (k.related < 6 ? ((k.related = 6), () => { k.related = 5; }) : null),
    // Still short: the rest of the neighbouring tutorials (real titles, each a link once it is public).
    () => (k.related < 7 && related.length > 6 ? ((k.related = 7), () => { k.related = 6; }) : null),
    () => (k.related < 8 && related.length > 7 ? ((k.related = 8), () => { k.related = 7; }) : null),
  ];
  for (const grow of grows) {
    if (text.length >= DESCRIPTION_GOAL) break;
    const undo = grow();
    if (!undo) continue;
    const next = render(k);
    if (over(next)) undo(); else text = next;
  }

  const underTarget = text.length < DESCRIPTION_TARGET_MIN;
  if (underTarget) notes.push(`${text.length} characters: the script and the help entry do not hold enough to reach ${DESCRIPTION_TARGET_MIN} without padding${entry ? "" : " (no help entry for this key in the checkout)"}`);
  const bad = bannedIn(text);
  if (bad.length) throw new Error(`${key}: the description says ${bad.join(", ")}`);
  return {
    helpKey: key, title, description: text, tags: buildTags(input, area), length: text.length, bytes: utf8Bytes(text),
    sha256: createHash("sha256").update(text).digest("hex"), area, hashtags, chapters: chaptersOk, underTarget, variant: "tutorial", sourceUrls: [], notes: Array.from(new Set(notes)),
  };
}

/* ── The overview films ("Start here") ────────────────────────────────────── */

/** The help group of the films that say what ConstructHUB is (shared/help/types.ts HELP_GROUPS). */
export const BRAND_GROUP = "Start here";
/**
 * What the two products are, for a film's description. Each line restates docs/brand/FACT-BASE.md
 * section 1 (shared/plans.ts, shared/crm-plans.ts): two products, sold separately, nothing bundled.
 */
export const BRAND_PRODUCTS: readonly string[] = [
  "• Business tools - the permit office directory, permit search and county property records, and tools for your Google Business Profile, your reviews and your website.",
  "• ConstructHUB CRM - clients, the pipeline, estimates your client approves online, the schedule, invoices and payments, and JobCam for job-site photos.",
  "They are separate products, each with its own plans. Buy one or both.",
];
const BRAND_LINKS = (key: string): string[] => [
  "Website: https://constructhub.us",
  "Plans for each product: https://constructhub.us/pricing",
  "Permit office directory: https://constructhub.us/databases",
  "Step-by-step tutorials: https://constructhub.us/tutorials",
  `This film in the app: https://constructhub.us/tutorials#help-${key}`,
];
const BRAND_DEMO_NOTE = "The CRM scenes are filmed in a demo workspace: the clients, jobs and amounts in them are sample data.";
const BRAND_HASHTAGS = ["#contractors", "#ConstructHUB", "#contractorsoftware"];
const BRAND_TAGS = ["ConstructHUB", "contractor software", "contractor CRM", "software for contractors", "building permit lookup", "permit office lookup", "estimates and invoices", "job site photos"];

/**
 * A channel-trailer description: what ConstructHUB is, the two products, the links, the chapters,
 * what the film says (its narration, a paragraph per chapter), how to start. No "how to" framing, no
 * keyword bank, no "search terms" line and NO LENGTH TARGET — it is as long as its true material.
 */
function buildBrandDescription(input: DescriptionInput): BuiltDescription {
  const notes: string[] = [], key = input.helpKey, entry = input.entry ?? null;
  const title = fitTitle(input.title);
  if (title !== plain(input.title)) notes.push(`title shortened to ${title.length} characters (was ${plain(input.title).length})`);
  const steps = input.steps.map((s) => ({ narration: clean(s.narration, notes, "narration"), chapter: s.chapter ? plain(s.chapter) : undefined })).filter((s) => s.narration);
  const whatItIs = entry ? clean(entry.whatItIs, notes, "help entry") : "";
  const summary = clean(input.summary, notes, "summary");
  // The line above "Show more": what the film is, with the name in it.
  const opening = [summary || whatItIs, summary && whatItIs && summary !== whatItIs ? whatItIs : ""].filter(Boolean).join(" ") || `${title}.`;
  const groups: { title: string; lines: string[] }[] = [];
  steps.forEach((s, i) => { if (i === 0 || s.chapter) groups.push({ title: s.chapter ?? "", lines: [] }); groups[groups.length - 1].lines.push(s.narration); });
  const chaptersOk = validChapters(input.chapters, input.durationSec);
  if (input.chapters?.length && !chaptersOk) notes.push("the chapter times are not a list YouTube accepts (first at 0:00, three or more, 10 s apart): left out");
  const needs = (entry?.needs ?? []).map((n) => clean(n, notes, "help entry")).filter(Boolean);
  // A comparison: where each of the other company's figures was read and when, and whose names they are.
  const sources = (input.sources ?? []).filter((x) => /^https:\/\/[^\s<>]+$/.test(x.url));
  const names = (input.names ?? []).map((n) => plain(n)).filter(Boolean);
  const compare: string[] = [
    ...sources.map((x) => `• ${plain(x.label)} - read ${x.read}: ${x.url}`),
    ...(sources.length ? ["List prices change. Plans differ in what they include: compare the feature lists on both sites before you decide."] : []),
    ...(names.length ? [`${names.join(", ")} ${names.length === 1 ? "is a trademark of its owner" : "are trademarks of their owners"}. ConstructHUB is not affiliated with ${names.length === 1 ? "it" : "them"}.`] : []),
  ];

  const render = (withTranscript: boolean): string => {
    const out: string[] = [/constructhub/i.test(opening.slice(0, 180)) ? opening : `ConstructHUB - ${opening}`, "", "Try ConstructHUB: https://constructhub.us"];
    const section = (label: string, lines: string[]) => { if (lines.length) out.push("", label, ...lines); };
    section("THE TWO PRODUCTS", [...BRAND_PRODUCTS]);
    section("LINKS", BRAND_LINKS(key));
    section(sources.length ? "SOURCES" : "NAMES", compare);
    if (chaptersOk) section("CHAPTERS", input.chapters!.map((c) => `${c.at.trim()} ${plain(c.title)}`));
    if (withTranscript) section("WHAT THE FILM SAYS", groups.flatMap((g) => [...(g.title ? [`▶ ${g.title}`] : []), g.lines.join(" ")]));
    if (entry) {
      section("HOW TO START", entry.howToUse.map((h) => clean(h, notes, "help entry")).filter(Boolean).map((h, i) => `${i + 1}. ${endStop(h)}`));
      section("GOOD TO KNOW", [clean(entry.whatItDoes, notes, "help entry"), clean(entry.howItWorks, notes, "help entry"), ...needs.map((x) => `• ${endStop(x)}`), BRAND_DEMO_NOTE].filter(Boolean));
    } else section("GOOD TO KNOW", [BRAND_DEMO_NOTE]);
    out.push("", BRAND_HASHTAGS.join(" "));
    return out.join("\n");
  };
  const over = (t: string) => t.length > DESCRIPTION_TARGET_MAX || utf8Bytes(t) > DESCRIPTION_MAX_BYTES;
  let text = render(true);
  if (over(text)) { text = render(false); notes.push(`the narration is left out to stay under ${YT_DESCRIPTION_LIMIT} characters`); }
  if (over(text)) throw new Error(`${key}: the description cannot be brought under ${DESCRIPTION_TARGET_MAX} characters`);
  const bad = bannedIn(text);
  if (bad.length) throw new Error(`${key}: the description says ${bad.join(", ")}`);

  const tags: string[] = [], seen = new Set<string>();
  for (const raw of [...(input.tags ?? []), ...BRAND_TAGS]) {
    const tag = plain(raw).replace(/[,"#]/g, "").trim();
    if (tag.length < 2 || tag.length > 40 || seen.has(tag.toLowerCase()) || bannedIn(tag).length || tagsCost([...tags, tag]) > TAGS_BUDGET) continue;
    seen.add(tag.toLowerCase()); tags.push(tag);
  }
  return {
    helpKey: key, title, description: text, tags, length: text.length, bytes: utf8Bytes(text), sha256: createHash("sha256").update(text).digest("hex"),
    area: "brand", hashtags: [...BRAND_HASHTAGS], chapters: chaptersOk, underTarget: false, variant: "brand", sourceUrls: sources.map((x) => x.url), notes: Array.from(new Set(notes)),
  };
}

/* ── The rules every description keeps ────────────────────────────────────── */

/**
 * What is wrong with a built description — an empty list when nothing is. The committed test runs
 * it over this checkout's scripts; `youtube-schedule.ts --lint-all` runs it over every worktree on
 * the machine (a report, not a test: an unfinished script in someone else's folder is their news).
 * Length UNDER the target is not in this list: see `underTarget`.
 */
export function lintDescription(d: Pick<BuiltDescription, "helpKey" | "title" | "description" | "tags" | "length" | "bytes"> & { sourceUrls?: readonly string[] }): string[] {
  const bad: string[] = [], text = d.description;
  const need = (ok: boolean, what: string) => { if (!ok) bad.push(what); };
  need(d.length === text.length, "length is not the text's length");
  need(d.length <= DESCRIPTION_TARGET_MAX, `${d.length} characters (over ${DESCRIPTION_TARGET_MAX})`);
  need(d.bytes === utf8Bytes(text) && d.bytes <= DESCRIPTION_MAX_BYTES, `${d.bytes} bytes (over ${DESCRIPTION_MAX_BYTES})`);
  need(!/[<>]/.test(text + d.title + d.tags.join("")), "an angle bracket");
  for (const b of bannedIn(text)) bad.push(`says "${b}"`);
  for (const b of bannedIn(`${d.title} ${d.tags.join(" , ")}`)) bad.push(`title or tags say "${b}"`);
  // Chapters: either none, or a list YouTube accepts — and no other time anywhere, which YouTube would read as a chapter.
  const ch = chaptersIn(text);
  if (ch.length) {
    need(ch.length >= 3 && ch[0].sec === 0 && ch.every((c, i) => i === 0 || c.sec - ch[i - 1].sec >= 10), "a chapter list YouTube will not accept");
    need(text.includes("\nCHAPTERS\n0:00 "), "chapter times outside a CHAPTERS list");
  } else need(!text.includes("CHAPTERS"), "a CHAPTERS heading without chapters");
  need((text.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length === ch.length, "a time outside the chapter list (YouTube would read it as a chapter)");
  const tags = text.match(/(?:^|\s)#[A-Za-z]\w*/g) ?? [];
  need(tags.length >= 3 && tags.length <= MAX_HASHTAGS, `${tags.length} hashtags (3 to ${MAX_HASHTAGS})`);
  // The only addresses: the site, YouTube's own watch links, and — in a comparison — the sources it names.
  for (const url of text.match(/https?:\/\/[^\s)]+/g) ?? []) need(/^https:\/\/(constructhub\.us(\/|$)|www\.youtube\.com\/watch\?v=)/.test(url) || (d.sourceUrls ?? []).includes(url), `an outside address: ${url}`);
  need(/ConstructHUB/.test(text.slice(0, 200)), "the opening does not name ConstructHUB");
  need(text.includes("Try ConstructHUB: https://constructhub.us"), "no \"Try ConstructHUB\" line");
  need(d.title.length <= TITLE_MAX, `title of ${d.title.length} characters`);
  need(tagsCost(d.tags) <= TAGS_BUDGET, "tags over the budget");
  need(new Set(d.tags.map((t) => t.toLowerCase())).size === d.tags.length, "a tag twice");
  need(!/\n{3,}/.test(text), "blank lines in a row");
  return bad;
}

/** Jaccard similarity of two texts on their 5-word shingles: 1 is the same text, 0 nothing in common. */
export function similarity(a: string, b: string, n = 5): number {
  const shingles = (t: string) => { const w = t.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9#' ]+/g, " ").split(/\s+/).filter(Boolean); const s = new Set<string>(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" ")); return s; };
  const x = shingles(a), y = shingles(b);
  let both = 0;
  x.forEach((s) => { if (y.has(s)) both++; });
  const union = x.size + y.size - both;
  return union ? both / union : 0;
}
