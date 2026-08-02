/**
 * Plain-English help content for the ⓘ info tips scattered across the CRM.
 * Written for a busy contractor, not a software person: what it does, why
 * you'd bother, and one concrete example. Every mounted <InfoTip k="…" />
 * must have an entry here — server/crm/info-content.test.ts enforces it.
 */

export interface InfoEntry {
  title: string;
  /** 2–6 short paragraphs, no jargon. */
  body: string[];
}

export const INFO_CONTENT: Record<string, InfoEntry> = {
  /* ── Main pages ──────────────────────────────────────────────────────── */

  dashboard: {
    title: "Your dashboard",
    body: [
      "This is your home base — the first thing you see when you log in. It answers one question fast: what needs my attention today?",
      "The numbers up top are live: how many leads are sitting untouched, how much work is in the pipeline, and what's waiting on you. Click any number to jump straight to that list.",
      "If you're brand new, a setup checklist appears here and walks you through the essentials one at a time — add your company info, create your first client, send your first estimate. Once everything's done, it goes away.",
      "Example: you open the app Monday morning, see \"3 leads · $48,200 in pipeline\", tap the leads number, and call the three people who asked for bids over the weekend before your competitor does.",
    ],
  },

  clients: {
    title: "Clients",
    body: [
      "Every person you do business with lives here — homeowners, property managers, general contractors. Add someone once and their estimates, invoices, projects, notes and measurements all hang off this one record.",
      "Each client automatically gets their own private portal page where they can see their documents and pay you. You never have to set that up — it just exists the moment you create the client.",
      "Use the search box to find anyone by name, email, phone or address. Click a row to open the client's full page.",
      "Example: Mrs. Garcia calls about the roof bid you sent last month. Type \"Garcia\", click her name, and everything you've ever sent her is on one screen while you're still on the phone.",
    ],
  },

  "client-detail": {
    title: "The client's page",
    body: [
      "Everything about one client, stacked on a single page: their contact info up top, then estimates, invoices, projects, activity, notes and measurements below.",
      "This is the screen you work from during a sales call. You can create an estimate, record a payment, or check whether they opened your last bid — all without leaving the page.",
      "The \"View as client\" button shows you exactly what the client sees in their portal, so you never have to guess what's on their end.",
      "Example: a client says they never got your invoice. Open their page, see the invoice was sent Tuesday but never viewed, and resend it with one tap while they're on the line.",
    ],
  },

  "client-estimates": {
    title: "Estimates for this client",
    body: [
      "Every bid you've made for this client, newest first. Each one shows its status — draft, sent, viewed, approved or declined — so you always know where it stands.",
      "Once an estimate is sent, this page tells you when the client opens it and how long they spent reading. A client who re-opens your bid three times in an evening is thinking hard — that's your cue to call.",
      "Tap \"New estimate\" to build one from scratch, or \"Quick Bid\" to price a job straight from a measurement report.",
      "Example: you sent a $14,000 siding bid on Monday. Wednesday you see \"2 visits · 9 minutes total\". You call that afternoon and close the job before they even shop it around.",
    ],
  },

  "client-invoices": {
    title: "Invoices for this client",
    body: [
      "Every bill you've sent this client, with what's been paid and what's still due. When an estimate gets approved, you convert it to an invoice here instead of retyping anything.",
      "\"Send\" emails the client a secure payment link. They can pay online by card or bank transfer, and the money goes straight to your own bank account — or use \"Record payment\" if they hand you a check.",
      "Once a payment lands, you can hand the client a professional receipt with one click.",
      "Example: the Johnsons approve a $9,600 bathroom job. You convert the estimate to an invoice, text them the link, and the deposit hits your bank before you've left the driveway.",
    ],
  },

  "client-projects": {
    title: "Projects for this client",
    body: [
      "A project is the actual job — the thing your crew shows up to build. Estimates are promises; projects are the work.",
      "When a client approves an estimate, its project flips to Approved automatically. From there you track it through your pipeline until it's done and paid.",
      "Example: the Garcia roof gets approved on Friday. The project is already sitting in your Approved column Monday morning, ready to be scheduled — no extra data entry.",
    ],
  },

  "client-timeline": {
    title: "Activity timeline",
    body: [
      "A running diary of everything that's happened with this client, in order: estimates sent, emails opened, payments made, notes added, files uploaded.",
      "You don't write anything here — the system keeps the diary for you. It's the fastest way to answer \"what's the story with this customer?\" before you call them back.",
      "Example: a client insists nobody contacted them. The timeline shows the estimate was emailed on the 3rd, they opened it twice on the 4th, and a team member logged a call on the 6th.",
    ],
  },

  "client-notes": {
    title: "Notes",
    body: [
      "Private sticky notes about this client that only your team can see. Gate code, dog in the yard, prefers texts over calls, spouse makes the decisions — anything worth remembering.",
      "Clients never see these. They're not on the portal, not on any document, just here for your crew.",
      "Example: before driving out, your installer opens the client's page and reads \"Keypad code 4419, park on the street, don't knock before 9am.\"",
    ],
  },

  measurements: {
    title: "Measurements",
    body: [
      "Roof and wall measurements for this client's property — square footage, pitch, waste factor — pulled in from HOVER or entered by hand after a site visit.",
      "These numbers do real work: Quick Bid and per-square-foot price book items use them to price jobs automatically, so a good measurement report means a bid in minutes instead of an evening with a calculator.",
      "Example: the HOVER report says 2,210 sq ft of siding. Your siding line item is priced per square foot, so the system multiplies it out — plus waste — and the estimate practically writes itself.",
    ],
  },

  pipeline: {
    title: "Pipeline",
    body: [
      "Every job you're working on, laid out as cards in columns from first contact to done-and-paid. It's your whole business on one board.",
      "Drag a card to the next column as the job moves along, or use the menu on the card. The columns match the real life of a job: new lead, bid sent, approved, scheduled, in progress, complete.",
      "Nothing falls through the cracks here — a card that sits too long in \"bid sent\" is a job you're about to lose to a follow-up call from someone else.",
      "Example: you glance at the board, see four bids sitting in \"Sent\" for over a week, and spend twenty minutes calling those four homeowners. Two of them sign.",
    ],
  },

  estimates: {
    title: "Estimates",
    body: [
      "Every estimate your company has ever sent, in one searchable list. Filter by status, search by client or title, and sort by date or dollar amount.",
      "The status tells the story: Draft means you're still working on it, Sent means the client has the link, Viewed means they opened it, Approved means you won, Declined means you didn't, Expired means they let it lapse.",
      "Click any row to open the client it belongs to and see the full picture.",
      "Example: at the end of the month you filter to \"Approved\" and sort by largest — instant bragging rights and a quick check on which salesperson is closing.",
    ],
  },

  invoices: {
    title: "Invoices",
    body: [
      "Every bill your company has sent, with running totals of what's paid, what's due, and what's overdue. This page is your accounts receivable at a glance.",
      "Filter by status to build your collections call list: \"sent\" and past due means it's time for a friendly nudge. The client pays online through their own secure link, or you record checks and cash by hand.",
      "Example: it's the 1st of the month. You filter invoices to unpaid, see $23,400 outstanding across six clients, and work down the list — three pay the same day from the reminder link.",
    ],
  },

  "estimate-new": {
    title: "New estimate — the fast flow",
    body: [
      "A three-step bid builder designed to be finished standing in a driveway on your phone: pick the client, add the work, review and send.",
      "You don't need a desk or a laptop. Line items come from your price book so you're picking from a list, not typing prices, and the totals — including tax and waste — add themselves up.",
      "When you hit send, the client gets an email with a private link to a clean page where they can read the bid, ask questions, and approve it with one tap.",
      "Example: you measure Mrs. Lee's fence at 4pm. By 4:20 the bid is in her inbox, priced from your book, with your logo on it. She approves it from her couch that night.",
    ],
  },

  "quick-bid": {
    title: "Quick Bid",
    body: [
      "The fastest way to price a job: it takes the client's latest measurement report and your per-square-foot prices, and builds the bid for you.",
      "Here's how it thinks. The report says the house has 2,210 square feet of siding. Your price book says siding is $4.50 per square foot. Quick Bid multiplies the square footage by your price, adds the waste factor, and lays out the finished lines for you to check.",
      "Nothing is final until you say so — you review every line, fix quantities or prices if you want, then send it like any other estimate.",
      "It needs two things to work: a measurement report on the client (from HOVER or entered by hand) and price book items priced per square foot. If the button is greyed out, one of those is missing.",
    ],
  },

  pricebook: {
    title: "Price book",
    body: [
      "Your company's master price list — every product and service you sell, priced once, so estimates are picking from a menu instead of re-typing numbers.",
      "Each item (a \"SKU\") has a name, a unit and a price. Units can be each, hour, square foot, linear foot and so on. Items priced per square foot are the magic ones — they hook into measurement reports so bids price themselves.",
      "Waste factors are built in honestly: if siding needs 12% extra for cuts and mistakes, you set 12% on the item and every estimate includes it automatically.",
      "Example: lumber prices jump. You change \"Architectural shingle install\" from $385 to $410 per square once, and every new estimate from the whole team uses the new number.",
    ],
  },

  payments: {
    title: "Payments",
    body: [
      "Where you connect your own Stripe account so clients can pay you online by card or bank transfer. The money goes straight to your bank — ConstructHub never touches it.",
      "Connecting takes a few minutes: Stripe asks for your business and bank details once, and after that every invoice and every client portal has a Pay button on it.",
      "You also control the rules here: whether to offer cards, bank transfer (ACH) or both, and whether card processing fees get passed to the client. Bank transfer is much cheaper on big jobs — 0.8% capped at $5 versus about 3% for cards.",
      "Example: a $12,000 invoice paid by bank transfer costs you $5 in fees. The same invoice on a card costs about $350. You set \"ACH only above $5,000\" and keep the difference.",
    ],
  },

  receipts: {
    title: "Receipts",
    body: [
      "A clean, professional proof of payment you can hand any client who pays — showing every payment they made, the total paid, and any remaining balance, stamped PAID IN FULL when it's settled.",
      "You don't fill anything in. Once a payment is recorded — online or by hand — the receipt builds itself from the invoice. One click shows it, and you can print or save it as a PDF for the client.",
      "Example: a property manager needs paperwork for their books. You open the invoice, tap Receipt, print to PDF, and email it over in under a minute.",
    ],
  },

  financing: {
    title: "Financing links",
    body: [
      "A \"Finance this project\" button on your estimates, invoices and client portal that sends the client to your lender or financing partner — GreenSky, Synchrony, whoever you work with.",
      "Big jobs close easier when the client sees a monthly payment option right next to the price. Add your lender's application link here once and it appears everywhere your clients look.",
      "You can add up to ten links and mark one as primary — that's the one clients see. Clicks are tracked, so you know how many clients actually consider financing.",
      "Example: a homeowner balks at an $18,000 roof. They tap \"Finance this project\", apply with your lender while the motivation is hot, and approve the job the same week at $299 a month.",
    ],
  },

  schedule: {
    title: "Schedule",
    body: [
      "Every visit, install date and appointment across all your projects, on one calendar. Day by day you can see who's supposed to be where.",
      "This is the crew's morning huddle screen: what's on today, what's tomorrow, what's this week. Items come from your projects, so a job that's approved and dated shows up without extra typing.",
      "It also syncs out — from Settings you can subscribe to this schedule from Google Calendar, Apple Calendar or Outlook, so it lives in the calendar app you already check.",
      "Example: Monday 7am you open the schedule, see the Martinez install Tuesday and the gutter job Thursday, and text the crew their week in one message.",
    ],
  },

  inbox: {
    title: "Inbox",
    body: [
      "A live feed of what your clients are doing, as it happens: opened an estimate, approved a bid, paid an invoice, sent a message through their portal.",
      "This is not email — it's the system's way of tapping you on the shoulder. The items that matter most (a client re-reading your bid at 10pm) surface here so you can strike while they're thinking about you.",
      "Example: your phone buzzes — \"Dana W. viewed Estimate #1042 for the third time.\" You call her before you've finished your coffee and the job is yours.",
    ],
  },

  team: {
    title: "Team & Company",
    body: [
      "Your people and your company details in one place: who's on the team, what each person is allowed to do, and the company info that prints on your documents.",
      "Invite someone with their email and a role, and they get a link to join. The role decides what they can see and touch — a field installer doesn't need your bank settings, and now they'll never see them.",
      "Example: you hire a new salesperson. Invite them as Office — they can build estimates and manage clients all day, but they can't change your prices or see payroll-level settings.",
    ],
  },

  "team-invite": {
    title: "Inviting someone",
    body: [
      "Type their email, pick a role, hit invite. They get an email with a link — one tap and they're in, no password gymnastics.",
      "The role you pick here is the only decision that matters: it controls what they can see and change. Read the role descriptions on each team member below if you're unsure — when in doubt, give less access. You can always bump it up later.",
      "Invitations that haven't been accepted yet show up as pending; you can resend the email or cancel the invite anytime.",
      "Example: your new crew lead starts Monday. You invite him Sunday night as Field — he opens the link on his phone at the job site and can see his schedule before his first coffee.",
    ],
  },

  "team-members": {
    title: "Team members",
    body: [
      "Everyone with access to your workspace, with their role next to their name. Owners and admins can change a role, send a password reset, or remove someone — the little ⓘ next to each role explains exactly what that role can do.",
      "Removing someone cuts their access immediately; nothing they created (estimates, notes) is deleted.",
      "Example: a salesperson quits Friday. You remove them here and their login dies on the spot — your client list and prices stay yours.",
    ],
  },

  "role-owner": {
    title: "Role: Owner",
    body: [
      "The owner can do everything — every page, every setting, every dollar. There is no permission an owner doesn't have.",
      "Only owners get the dangerous buttons: permanently deleting estimates and invoices, and anything else that can't be undone. That's deliberate — the person whose name is on the business should be the only one who can shred its records.",
      "Every company has at least one owner, and it's usually the person who signed up. Give this role to a partner you trust like yourself, and nobody else.",
      "Example: a wrong duplicate invoice needs to be destroyed, not just voided. The server refuses unless it's an owner clicking the button.",
    ],
  },

  "role-admin": {
    title: "Role: Admin",
    body: [
      "Your right hand. An admin can run the whole company day to day — clients, estimates, invoices, prices, team, settings — everything except the handful of owner-only powers like permanent deletion.",
      "Admins can also be scoped to one division, so a branch manager sees their branch without wandering through the other one's numbers.",
      "Give this to an office manager or a branch lead you trust to run things while you're on a roof.",
      "Example: your office manager in the Florida division is an admin scoped to Florida — she runs her whole branch, and the Washington books simply aren't hers to see.",
    ],
  },

  "role-pm": {
    title: "Role: Project manager",
    body: [
      "The person who runs jobs once they're sold. A PM manages projects, schedules work, and keeps jobs moving — full access to the doing side of the business.",
      "They work with clients and documents as the job demands, but the money-and-settings back office stays with owners and admins.",
      "Example: your PM opens the schedule, sees the roof install got approved, assigns the crew days, and logs daily progress — all without ever needing your Stripe settings.",
    ],
  },

  "role-office": {
    title: "Role: Office",
    body: [
      "The front desk and sales desk. Office staff manage clients and build and send estimates and invoices — the paperwork of winning and billing work.",
      "They can see money on the documents they handle (they have to — they send the bills), but they can't touch company settings, prices behind the price floor, or integrations.",
      "Example: your office coordinator turns yesterday's three site visits into three polished estimates before lunch, and never needs access to anything else.",
    ],
  },

  "role-field": {
    title: "Role: Field",
    body: [
      "The crew. Field members see what they need to do the work: their schedule, the projects they're on, and the client's notes like gate codes and dogs.",
      "They don't see prices, costs, invoices or settings — a phone left on a tailgate shouldn't be a data breach. This is the right default for anyone whose office is a truck.",
      "Example: your installer opens the app at the job, reads \"keypad 4419, don't knock before 9\", checks today's address, and gets to work.",
    ],
  },

  divisions: {
    title: "Divisions",
    body: [
      "Separate operating arms of one company — like a Washington headquarters and a Florida division — each with its own name, address and license number.",
      "Why it matters: a project's division decides what prints on its estimates and invoices, so your Florida customers see your Florida license, and your books stay sorted by branch.",
      "Admins can also be scoped to a single division, which keeps branch managers in their own lane.",
      "Example: you open a second crew in Sarasota. Add it as a division, put the Florida license number on it, and every estimate from that branch is letter-perfect automatically.",
    ],
  },

  reports: {
    title: "Measurement reports",
    body: [
      "Every roof and siding measurement report in one place — imported from HOVER or added by hand after a site visit.",
      "Reports match themselves to the right client by address; if there's no client yet, one is created from the report. From here a report becomes a priced bid in a couple of taps with Quick Bid.",
      "Example: the HOVER job you ordered this morning lands here at lunch — address matched to Mr. Chen, 2,874 sq ft of roof, ready to price before you've finished eating.",
    ],
  },

  migrate: {
    title: "Bring your data with you",
    body: [
      "A moving truck for your business data. If your clients, estimates and invoices live in Jobber, QuickBooks, Leap or a spreadsheet, this pulls them in so you're not starting from a blank page.",
      "You export a file from your old tool, upload it here, and the importer matches columns and shows you what it found before anything is saved. Nothing overwrites what you already have.",
      "Example: you export 340 clients from QuickBooks as a spreadsheet on Sunday night, upload it here, and Monday morning your whole client book is in ConstructHub with its history.",
    ],
  },

  admin: {
    title: "Platform admin",
    body: [
      "The ConstructHub staff console — a read-only control tower over every account and company on the platform. It's how the team spots trouble, checks usage, and supports customers.",
      "This page exists for ConstructHub employees only; regular company accounts never see it. Nothing here edits your data — it's monitoring, not a back door.",
      "Example: a contractor emails support saying their invite link broke. Staff look the account up here, confirm what happened, and fix it in minutes.",
    ],
  },

  "beta-invites": {
    title: "Beta invites",
    body: [
      "While ConstructHub is in beta, new companies join by invitation. This is where the team sends one: type an email, and that person gets a link to create their company.",
      "Every invite is tracked — sent, accepted, or still waiting — so the team knows who's come aboard.",
      "Example: a roofer at a trade show asks to try it. Staff type his email here, he gets the invite before he leaves the booth, and his company is set up that evening.",
    ],
  },

  integrations: {
    title: "Integrations",
    body: [
      "The switchboard where ConstructHub talks to your other tools: HOVER for measurements, calendars for scheduling, plus API keys and webhooks for anything custom.",
      "Each card is one connection, with a plain status — connected or not — and the buttons to hook it up or fix it. You only need to set each one up once.",
      "Example: you connect HOVER here once, and from then on every measurement report you order appears on the right client's page by itself.",
    ],
  },

  "api-keys": {
    title: "API keys",
    body: [
      "A password for software, not people. An API key lets another program — a reporting tool, an accountant's script, your own website — read or write your ConstructHub data automatically.",
      "If you don't have a developer or a tool that asked for one of these, you don't need this card at all. If a tool does ask, create a key, paste it in there, and you're done.",
      "Treat a key like your bank password: it shows in full only once, right when it's created. If one leaks, revoke it here and make a fresh one.",
      "Example: your bookkeeper's reporting tool asks for a ConstructHub API key. You create one named \"Bookkeeping\", paste it into their tool, and your numbers flow to her every night.",
    ],
  },

  webhooks: {
    title: "Webhooks",
    body: [
      "A doorbell for your data. A webhook is a web address you give us; every time something happens — an estimate approved, an invoice paid — we ring that address with the details, instantly.",
      "This is how tech-savvy teams wire ConstructHub into their own systems: when the doorbell rings, their software reacts — updating a spreadsheet, pinging a dispatcher, whatever they build.",
      "Like API keys, this is a developer feature. No developer, no need to touch it — everything works without it.",
      "Example: your IT guy sets a webhook on \"invoice paid\" that posts to the company chat. The whole office sees \"Chen paid $9,600\" ten seconds after it happens.",
    ],
  },

  hover: {
    title: "HOVER measurements",
    body: [
      "HOVER turns a few phone photos of a house into an exact 3D model with roof and siding measurements. Connect it here once, and every HOVER job you order flows straight into ConstructHub.",
      "When a report completes, it lands on the right client's page automatically — matched by address — with the square footage, the PDF and the 3D model attached. No downloading, no uploading, no re-typing.",
      "Those measurements are what power Quick Bid: per-square-foot prices times measured square footage equals a bid in minutes.",
      "Example: you photograph the Garcia house at 10am. By lunch the report is on their client page, and Quick Bid has a $14,200 siding estimate ready for your review.",
    ],
  },

  "hover-sync": {
    title: "HOVER sync",
    body: [
      "The automatic pipeline that pulls finished HOVER reports into your workspace. Normally you never think about it — a report completes at HOVER and appears on the matched client's page moments later.",
      "The Sync button is your manual kick: if a report is done at HOVER but hasn't shown up yet, one tap goes and fetches everything outstanding instead of waiting.",
      "Example: you're standing in the client's kitchen and the report just completed. Tap Sync now, refresh, and the measurements are on their page before the coffee's poured.",
    ],
  },

  "lead-capture": {
    title: "Lead capture",
    body: [
      "A ready-made \"Request an estimate\" form you can put on your own website or link from anywhere. A stranger fills it out, and they land in your client list and pipeline as a brand-new lead — no email lost, no voicemail forgotten.",
      "Copy the embed code into your website (any web person can do this in five minutes), or just share the link in your Google profile and social pages.",
      "Example: a homeowner finds you on Google at 11pm, taps the link, types her name and address, and Tuesday morning she's sitting at the top of your pipeline waiting for your call.",
    ],
  },

  /* ── Settings page + cards ───────────────────────────────────────────── */

  settings: {
    title: "Settings",
    body: [
      "The control room for your whole company: what prints on your documents, which emails you get, how you take payment, and where your leads come from.",
      "Every card is one topic, and every card has its own ⓘ if you want the long version. Nothing here affects your clients until you hit save.",
      "Set this up once when you start — after that you'll only come back when something in the business changes.",
    ],
  },

  "settings-company": {
    title: "Company profile",
    body: [
      "Your company's public face: name, address, phone, email, license number and logo. Whatever you put here prints at the top of every estimate and invoice and shows on your clients' portal.",
      "Fill this in completely before you send your first bid — an estimate with your logo and license number on it looks like a company, not a text message.",
      "Example: a homeowner compares your bid — letterhead, license, logo — against a competitor's one-line email. Yours looks like the safe choice before she's read a number.",
    ],
  },

  "settings-defaults": {
    title: "Estimate & invoice defaults",
    body: [
      "The fine print and starting values every new document begins with: your estimate footer, invoice terms, default tax rate and how long a bid stays valid before it expires.",
      "Set them once here and they pre-fill on every new estimate or invoice. You can still edit any of it per document — these are starting points, not handcuffs.",
      "The expiry setting is worth a thought: a bid that expires in 14 days gives the client a reason to decide, and gives you an honest reason to follow up.",
      "Example: every estimate you send automatically ends with \"Price valid for 14 days. Fully licensed and insured. 10-year workmanship warranty.\" — because you typed it here once.",
    ],
  },

  "settings-notifications": {
    title: "Notifications",
    body: [
      "Which emails the system sends to YOU. A client opened your estimate, a bid was approved, a payment arrived — turn each one on or off to taste.",
      "This only controls your copies. Emails to your clients — the estimate or invoice itself — always send, no matter what you switch off here.",
      "Example: you want to know the second money arrives but you're tired of \"client viewed\" pings during dinner. Payment emails on, view emails off. Done.",
    ],
  },

  "settings-sms": {
    title: "SMS",
    body: [
      "Text messages instead of (or alongside) email for the moments that matter: send a client a text nudge about their bid, and get a text yourself the instant a client re-opens their estimate.",
      "A bid reminder by text gets read in minutes, where an email can sit all weekend. The hot-lead alert means you call while they're literally reading your proposal.",
      "Example: Mrs. Patel hasn't responded in five days. One tap sends a polite text nudge; she opens the bid that evening, your phone buzzes, and you call while the job's on her mind.",
    ],
  },

  "settings-payments": {
    title: "Payments settings",
    body: [
      "The money rules: which ways clients may pay you (card, bank transfer or both), whether big invoices go bank-transfer-only to dodge card fees, and whether card processing fees are passed to the client as a clearly-labelled line.",
      "Bank transfer (ACH) costs 0.8% capped at $5; cards cost about 2.9% + 30¢. On a $10,000 job that's $5 versus $300 — the \"ACH only above\" threshold exists for exactly that reason.",
      "Example: you set \"bank transfer only above $5,000\" and pass the card fee through on smaller jobs. Your fees for the year drop by thousands, and clients see every charge labelled honestly.",
    ],
  },

  "settings-calendar": {
    title: "Calendar",
    body: [
      "Puts your ConstructHub schedule inside the calendar app you already use — Google, Apple or Outlook — so job dates show up next to dentist appointments.",
      "Two ways: subscribe (your calendar checks in and stays up to date by itself) or connect Google Calendar and push the schedule over with Sync now.",
      "Example: you subscribe from your phone once, and next week's installs appear in your normal calendar — the crew lead does the same on his phone, no extra app to remember.",
    ],
  },

  "settings-theme": {
    title: "Company theme",
    body: [
      "Your brand colour, applied across your workspace and your clients' portal. Pick one of the preset accents and the whole product — buttons, highlights, the portal your clients see — dresses in it.",
      "It's a small thing that reads as polish: when your client's portal matches your trucks and your estimate PDFs, you look like one company, not a pile of software.",
      "Example: your brand is a deep green. You pick it here, and every estimate email and portal page your clients touch carries that same green.",
    ],
  },

  "lead-sources": {
    title: "Lead sources",
    body: [
      "Where your clients come from — Google, yard sign, referral, the home show. You tag each client with their source on their page, and this card keeps the list tidy.",
      "Six months of tagging and you'll know something most contractors only guess at: which marketing actually produces jobs, and which is a bonfire.",
      "Example: at year end you count — 40% of your closed jobs came from referrals, 5% from the $6,000 magazine ad. Next year's budget writes itself.",
    ],
  },

  "price-lock": {
    title: "Price floor lock",
    body: [
      "A floor under your prices. With the lock on, your team can price jobs at or above the price book numbers — but never below. Only you can still edit SKUs, price charts and discounts.",
      "This is the cure for the salesperson who discounts to be liked. The floor is your margin, enforced by the software instead of by an argument.",
      "Example: your price book says siding is $4.50 a square foot. With the lock on, a rep quoting $3.90 to win a job simply can't — the system won't let the price through.",
    ],
  },

  backups: {
    title: "Backups",
    body: [
      "Your safety net: scheduled exports of your own data — clients, estimates, invoices, projects and notes — so you always hold an independent copy of your business.",
      "Turn it on and the platform hands you a complete export on a schedule you choose. Keep the files somewhere safe that's yours, like your own cloud drive.",
      "ConstructHub keeps short-lived internal backups for disasters, but those are for us, not you — your own scheduled export is the copy you can actually count on.",
      "Example: you set a weekly export every Sunday night. Whatever ever happens — a mistake, a misunderstanding, a meteor — your client book and document history are sitting in your drive.",
    ],
  },

  /* ── Client portal ───────────────────────────────────────────────────── */

  portal: {
    title: "Your client portal",
    body: [
      "This is your private page — every document between you and your contractor, in one place: estimates to review, invoices to pay, signed contracts, and measurement reports.",
      "Only you can see this page; you got here through a secure link sent to your email. Bookmark it or just use any new link your contractor sends — it always brings you back here.",
      "Anything that needs you — a bid waiting for an answer, an invoice due — is flagged right at the top so you can't miss it.",
      "Example: your contractor emails you a bid. You tap the link, read it here, tap Approve, and later that week pay the deposit from the same page. No printing, no scanning, no checks in the mail.",
    ],
  },

  "portal-estimates": {
    title: "Your estimates",
    body: [
      "Every quote your contractor has sent you. Open one to read the full breakdown, and when you're ready, approve it right from that page — that's what officially kicks off the work.",
      "Each estimate has an expiry date, shown next to it. Prices are held until that date; after it, your contractor may need to re-quote.",
      "Have a question about a line item? Use the messages section of this portal instead of starting a new email thread — everything stays attached to the job.",
      "Example: you get a $12,400 kitchen bid, read it on your phone, tap Approve on Saturday, and the crew calls Monday to book the start date.",
    ],
  },

  "portal-invoices": {
    title: "Your invoices & receipts",
    body: [
      "Every bill from your contractor and every payment you've made. Anything unpaid shows a Pay button — pay securely online by card or bank transfer, right from this page.",
      "After each payment, a receipt appears here for your records. Download it anytime; it's the paperwork your accountant (or your warranty claim) will want.",
      "Example: the job finishes Friday. You open this page, pay the $4,800 balance by bank transfer in two minutes, and the PAID IN FULL receipt is in your files before the crew has left.",
    ],
  },

  "signed-contracts": {
    title: "Signed contracts",
    body: [
      "The legally binding paperwork, signed electronically and stored where neither side can lose it. When your contractor sends a contract, you review and sign it right in your browser — no printing or scanning.",
      "Once signed, both sides get the finished document and it lives here permanently, with the date and signature record attached.",
      "Example: six months after the job, a warranty question comes up. You open this section, pull up the signed agreement, and the exact terms are right there in black and white.",
    ],
  },

  "portal-reports": {
    title: "Your measurement reports",
    body: [
      "The technical measurements of your property — roof and wall dimensions, square footage, diagrams — usually produced from photos taken during the site visit.",
      "These are the numbers your quote was built from, shared with you so you can see exactly how the price was figured. No mystery math.",
      "Example: your siding quote says 2,210 square feet. Open the report here and you can see the measured walls and the 3D model that number came from.",
    ],
  },

  /* ── Cross-cutting features ──────────────────────────────────────────── */

  engagement: {
    title: "Client engagement",
    body: [
      "A read-receipt for your bids. Once you send an estimate, this shows every time the client opens it: how many visits, how long they spent, and when they last looked.",
      "This is the closest thing to reading a customer's mind. Three visits in one evening means they're seriously comparing — that's the moment to call, not next week. Zero visits in five days means your email got buried — time to resend or text.",
      "The client never knows you're watching; it's simply your copy of the page counting visits.",
      "Example: \"4 visits · 22 minutes · last 1h ago.\" You call, and the client says the magic words: \"Funny, we were just talking about your quote.\"",
    ],
  },

  "estimate-expiry": {
    title: "Estimate expiry",
    body: [
      "Every estimate carries an expiry date — after it, the price is no longer guaranteed. It's printed on the client's page so there's no ambiguity.",
      "Expiry is a selling tool, not a punishment: it protects you from material-price swings and gives the client a fair reason to decide now instead of \"someday\". You set the default number of days in Settings.",
      "If a good client needs more time, Extend adds seven days with one tap — you stay generous without your price book drifting.",
      "Example: lumber spikes 15% in a month. Your old bids expired after 14 days, so you're re-quoting at honest prices instead of eating the difference on a job you priced in the spring.",
    ],
  },

  "email-gating": {
    title: "Email-verified links",
    body: [
      "Every estimate and invoice link is private. When a client opens one for the first time, they confirm their email with a one-tap code — after that, their device remembers them.",
      "Why the extra step: these pages show prices, addresses and payment buttons. The email check keeps a forwarded link or a nosy neighbor from seeing your client's business — and it's what lets the system tell you exactly when your client opened the bid.",
      "If a client says the link \"doesn't work\", it almost always means they typed the wrong email — have them request a fresh code with the email you have on file.",
      "Example: a client forwards their estimate link to their brother-in-law for advice. Without the client's email code, all he sees is a sign-in prompt — the numbers stay private.",
    ],
  },

  "owner-delete": {
    title: "Owner-only delete",
    body: [
      "Permanently destroying an estimate or invoice is a power reserved for owners — and the system enforces it, not just the screen. Anyone else literally cannot do it.",
      "Why so strict: documents are your financial record. Voiding (which anyone with invoice rights can do) cancels a document but keeps the paper trail; deleting shreds it forever. Shredding should be the boss's call.",
      "Example: a well-meaning helper wants to \"clean up\" old declined estimates. They can't — the delete button doesn't exist for them. Your history survives spring cleaning.",
    ],
  },
};
