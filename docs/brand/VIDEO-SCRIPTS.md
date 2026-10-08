# ConstructHUB — flagship video scripts

_Written 2026-10-08. Every sentence traces to `docs/brand/FACT-BASE.md` (tags like [D2], [1c], [3b]
point at its sections). House rules: plain contractor language, no hype, no price spoken aloud, no
"best / #1 / only / all-in-one / guaranteed", the CRM is never "included", the SEO data provider is
never named, Google is never a "partner", and only the demo workspace is ever on screen for the CRM._

| # | Key | Status |
| --- | --- | --- |
| 1 | `brand-what-is-constructhub` | **Step script ready; one full take made 2026-10-08 (78 s) and inspected, NOT uploaded** — it showed one flaw (the ring missed "Verified portal" because the list was still loading) and ran 3 s long; both are fixed in the script, which now needs one more take. `docs/tutorials/scripts/brand-what-is-constructhub.json` |
| 2 | `brand-tour-crm` | **Step script ready, every step played in dry runs, NOT yet recorded** — recording stopped when the merge of `video-fixtures` conflicted (see the hand-off note in the session report). `docs/tutorials/scripts/brand-tour-crm.json` |
| 3 | `brand-tour-business-tools` | Script only — waits until the Business tools upgrades are finished (owner) |
| 4 | `brand-why-constructhub` | Script only — safe to record without a lawyer (no names, no prices spoken); not recorded in this pass |
| 5a | `brand-vs-jobber` | Script + fact table — **NEEDS OWNER SIGN-OFF BEFORE RECORDING OR PUBLISHING** |
| 5b | `brand-vs-housecall-pro` | Script + fact table — **NEEDS OWNER SIGN-OFF BEFORE RECORDING OR PUBLISHING** |
| 5c | `brand-vs-leap` | Script + fact table — **NEEDS OWNER SIGN-OFF BEFORE RECORDING OR PUBLISHING** |
| 5d | `brand-vs-ahrefs-semrush` | Script + fact table — **NEEDS OWNER SIGN-OFF**, and waits for the SEO upgrades |

---

## Owner approval sheet — one screen per competitor

Tick a claim to approve it; strike it to drop it. Nothing below is recorded until this is signed.
Every price is the competitor's own page on **2026-10-08** and must be re-read on the day of
publishing. (D) = read from the page text directly; (S) = read through a summarising fetch, so a
person must look at the page before it is used.

### Jobber

| Claim we would make | Evidence | Source / date |
| --- | --- | --- |
| "Both do quotes your client approves online, a schedule, invoices and online payments." | Jobber: "Customers can approve or request changes to quotes online"; ours: fact base 1c | getjobber.com/features (S) · 2026-10-08 |
| "Jobber is the more mature product, with more integrations, a website builder and online booking." | "100+ app integrations", "Launch a professional website in minutes" | getjobber.com/pricing, /features (S) · 2026-10-08 |
| "Jobber's entry plan costs about the same as ours — less than ours on some billing options." | Core $49 no commitment / $39 one-year / $29 paid annually; CRM Basic $39 / $348 a year | getjobber.com/pricing (S); `shared/crm-plans.ts:102` · 2026-10-08 |
| "ConstructHUB has a permit office directory and county property records. Jobber's pricing and feature pages don't list either." | [D1], [3b] | same pages · 2026-10-08 |
| "JobCam files job photos to the job inside the CRM." (add: top plan or add-on; 5 GB) | [D7] | `shared/crm-plans.ts:34` |
| **Not claimed:** cheaper than Jobber; more features than Jobber; anything about Jobber's quality or support. | | |

### Housecall Pro

| Claim we would make | Evidence | Source / date |
| --- | --- | --- |
| "Both do estimates, a schedule, invoices and online payments, with a customer portal." | Housecall Pro features page; ours 1c | housecallpro.com/features (S) · 2026-10-08 |
| "Housecall Pro goes further on dispatch: routes, route optimisation and GPS tracking. We don't have those." | Essentials: routes, employee GPS tracking; Max: route optimisation | housecallpro.com/pricing (S) · 2026-10-08 |
| On-screen table, not spoken: "List price, month to month, as of October 2026 — 1 user: $79 vs $39 · 5 users: $189 vs $94 · 8 users: $329 vs $164. Plans do not include the same features." | "$79 /mo", "$189 /mo", "$329 /mo", "1 user included", "5 users included" (D); ours `shared/crm-plans.ts:102,128,151` | housecallpro.com/pricing (D) · 2026-10-08 |
| Spoken: "At list price, seat for seat, ConstructHUB CRM is about half." | the three pairs above; `shared/crm-plans.ts:9-15` | same |
| "ConstructHUB also has a permit office directory and county property records — a separate product." | [D1], [D5] | [3b] |
| **Not claimed:** "half the price for the same thing"; anything about their promotions; that we replace their dispatch. **Risk to weigh:** Housecall Pro was running first-month offers on 2026-10-08, and its annual price ($59) narrows the gap. | | |

### Leap

| Claim we would make | Evidence | Source / date |
| --- | --- | --- |
| "Leap is two products: Leap CRM, and SalesPro for selling in the home. ConstructHUB has no equivalent of SalesPro." | "Leap CRM and Leap SalesPro"; SalesPro Premium "Starting at $750 /month", "Includes 6 Users" | leaptodigital.com/pricing (D) · 2026-10-08 |
| "Both CRMs do leads, estimates, digital signatures, a calendar, invoices and payments." | "Lead & Customer Management", "Digital Estimates & Proposals", "Digital Signatures", "Appointment Calendar", "Invoicing" | leaptodigital.com/leap-crm (S) · 2026-10-08 |
| "Leap connects to suppliers, measurement services and financing. We don't." | ABC Supply, EagleView, GreenSky, QuickBooks, SRS named | leaptodigital.com (S) · 2026-10-08 |
| On-screen, not spoken: "List price, as of October 2026 — single user: Leap CRM Essential $79/month, ConstructHUB CRM Basic $39/month. Team: Leap from $298/month plus $99 per added user; ConstructHUB CRM Essentials $94/month with 5 seats. Plans do not include the same features." | "Get Started for $79 /month", "Single-User Only"; "Starting at $298 /month", "Includes First User and $99 per/mo per add. user" (D) | leaptodigital.com/pricing (D) · 2026-10-08 |
| "ConstructHUB also has a permit office directory, county property records and Google listing tools. Leap's pages don't list those." | [D1]; "not mentioned" on /leap-crm (S) | 2026-10-08 |
| **Not claimed:** anything about close rates or results (Leap publishes its own; we have none); that we suit large in-home sales teams. | | |

### Ahrefs and Semrush

| Claim we would make | Evidence | Source / date |
| --- | --- | --- |
| "Ahrefs and Semrush are dedicated SEO suites with their own crawlers and far more data. If SEO is your job, use one of them." | Ahrefs: "5 M Pages crawled every minute", "28.7B" keywords (S); plan limits (D) | ahrefs.com/big-data (S), ahrefs.com/pricing (D), semrush.com/pricing (D) · 2026-10-08 |
| "ConstructHUB has the lookups a local contractor uses: where you rank, what people search, who links to a competitor, what is wrong with your site." | fact base 3a | `server/seo/*` |
| "They sit in the same product as your Google listing and the permit directory." | [D10], [D1] | — |
| On-screen, not spoken: "As of October 2026 — Ahrefs Lite $129/month; Semrush SEO $139/month; ConstructHUB Starter $29/month with $10 of SEO data. Both also have a free tier, and Ahrefs has a $29 Starter plan. These are different products with different limits." | "$ 129 / mo", "$ 29 / mo", "Ahrefs Free" (D); "$ 139", "Free. $0 /mo" (D); `shared/plans.ts:79,126` | 2026-10-08 |
| **Not claimed:** "an Ahrefs alternative"; "cheaper than Ahrefs" (their free tier and $29 plan make that false); "our index / crawler / database"; any word about where our data comes from or what it costs us. | | |

### CompanyCam (JobCam angle only — no separate video proposed)

One true sentence, if ever wanted: "CompanyCam is a dedicated photo app with unlimited storage and more
capture features; JobCam is a camera inside the CRM, filed to the same job as the estimate and the
invoice, with 5 GB." Source: companycam.com/pricing (D), /features (S), 2026-10-08. **Recommendation: do
not make a JobCam-vs-CompanyCam video** — on the facts it is their win.

---

## 1. `brand-what-is-constructhub` — "What is ConstructHUB?" (channel trailer · one more take needed)

Problem → two products → Business tools (permit directory, property records) → the CRM montage → how
to start. No competitor names, no prices. Platform scenes are real pages with the real directory
(Houston, TX and its verified portal are as the directory holds them); CRM scenes are the demo
workspace.

| # | On screen | Narration |
| --- | --- | --- |
| 1 | **[The problem]** The dashboard (`goto`) | Leads in one app. Estimates in another. Job photos on a phone. Permits, somewhere online. |
| 2 | Two products (`highlight`) | ConstructHUB is two products: Business tools, and a CRM. |
| 3 | **[Business tools]** Database Directory (`goto`) | Business tools start with a directory of county and city permit offices. |
| 4 | Search a city (`type`) | Type a city or a county. |
| 5 | Verified portal (`highlight`) | A checked link opens the office's own permit portal. No guessed addresses. |
| 6 | Property Records (`goto`) | County property records offices are listed the same way. |
| 7 | Every feature (`goto`) | The same product looks after your Google listing, your reviews and your website. |
| 8 | **[The CRM]** The CRM: pipeline (`goto`) | The second product is the CRM. Every job is a card, from lead to paid. |
| 9 | One job (`highlight`) | Open a job, and its estimate, schedule and invoices are together. |
| 10 | A signed estimate (`goto`) | Send an estimate from your price book. |
| 11 | Approved online (`highlight`) | Your client approves it online. |
| 12 | Schedule (`goto`) | Put the visit |
| 13 | On the calendar (`highlight`) | on the schedule. |
| 14 | JobCam (`goto`) | File job-site photos to the job |
| 15 | JobCam feed (`highlight`) | with JobCam. |
| 16 | Invoices (`goto`) | Then send the invoice, |
| 17 | Paid (`highlight`) | and record the payment. |
| 18 | **[How to start]** How to start (`goto`) | Buy one or both. Each has its own plans, at ConstructHUB dot U S. |

**Full narration.** Leads in one app. Estimates in another. Job photos on a phone. Permits, somewhere online. ConstructHUB is two products: Business tools, and a CRM. Business tools start with a directory of county and city permit offices. Type a city or a county. A checked link opens the office's own permit portal. No guessed addresses. County property records offices are listed the same way. The same product looks after your Google listing, your reviews and your website. The second product is the CRM. Every job is a card, from lead to paid. Open a job, and its estimate, schedule and invoices are together. Send an estimate from your price book. Your client approves it online. Put the visit on the schedule. File job-site photos to the job with JobCam. Then send the invoice, and record the payment. Buy one or both. Each has its own plans, at ConstructHUB dot U S.

Fact base: "two products" [D5]; permit directory and checked links [D1][D2]; property records [1b];
Google listing, reviews, website [1b] — said, not shown, because those pages need a connected Google
account; CRM beats [1c]; "its own plans" [D5].

- **Title options (≤ 70):** "What is ConstructHUB? Business tools and a CRM for contractors" ·
  "ConstructHUB in one minute: permits, your Google listing and a CRM" · "What ConstructHUB does for
  contractors"
- **Thumbnail headline:** WHAT IS CONSTRUCTHUB? (kicker "Start here")
- **59-second vertical cut:** 0–6 s hook, text on screen "Five apps to run one job?" over the
  dashboard; 6–12 s "ConstructHUB is two products"; 12–28 s permit directory: type a city, the Verified
  portal badge, crop to the result card; 28–34 s property records; 34–52 s CRM in four cuts (pipeline
  card, "Approved by…" banner, calendar, paid invoice), one caption each; 52–59 s "Buy one or both —
  constructhub.us". Crop each shot to the content column (the sidebar is dropped in 9:16).
- **Pinned comment:** "ConstructHUB is two products you can buy separately: Business tools (permit
  office directory, property records, Google listing and review tools) and the CRM (estimates,
  schedule, invoices, job photos). Plans and what each includes: https://constructhub.us/pricing —
  the permit directory is free to browse: https://constructhub.us/databases"

## 2. `brand-tour-crm` — "ConstructHUB CRM in 2 minutes" (script ready · not yet recorded)

One fictional job, the Hadleys' floor in Austin, Texas (demo client "Caleb & Nora Hadley", project
P-1997, estimate E-1998): lead → estimate → signature → schedule → job photos → invoice → paid. The
invoice is created and the check recorded on camera; the rest is the seeded job.

| # | On screen | Narration |
| --- | --- | --- |
| 1 | **[A lead comes in]** Pipeline (`goto`) | Here is one job in the ConstructHUB CRM, from the first call to the final payment. |
| 2 | Leads (`highlight`) | Every job starts as a lead on the pipeline. |
| 3 | The Hadley job (`highlight`) | This one is the Hadleys' new floor, in Austin. It has moved along to Scheduled. |
| 4 | Clients (`goto`) | Every client has a page. |
| 5 | Caleb & Nora Hadley (`click`) | Open the Hadleys, and the whole job is in one place. |
| 6 | Quick actions (`highlight`) | Quick actions start the next step: a visit, an estimate, a payment. |
| 7 | **[Estimate and signature]** The estimate (`highlight`) | The estimate went out by email. You can see when they opened it, and when they approved. |
| 8 | Estimate lines (`goto`) | Each line came from the price book, with its quantity and its price. |
| 9 | Signed (`highlight`) | Nora approved it online by typing her name. Now it is a signed contract. |
| 10 | **[Schedule and job photos]** Schedule (`goto`) | Next, the visit goes on the schedule. |
| 11 | The visit (`click`) | Open it for the time, the client, and who is going. |
| 12 | Close (`press`) | The crew sees it on their own calendar. |
| 13 | Back to the client (`goto`) | On site, the crew shoots photos with JobCam. |
| 14 | Caleb & Nora Hadley (`click`) | Back on the Hadleys' page, |
| 15 | JobCam (`highlight`) | each shot is filed to this client's job. |
| 16 | **[Invoice and payment]** Create invoice (`click`) | When the work is done, choose Create invoice on the approved estimate. |
| 17 | The invoice (`highlight`) | The invoice is made from the estimate, ready to send. |
| 18 | Record payment (`click`) | When the check arrives, choose Record payment. |
| 19 | Record it (`click`) | Check the amount, and record it. |
| 20 | Paid (`highlight`) | The invoice is marked paid, and the client gets a receipt by email. |
| 21 | Home (`goto`) | Lead, estimate, signature, schedule, photos, invoice, paid. One job, in one place. |
| 22 | Where to start (`highlight`) | The CRM is its own product, with its own plans. See them at ConstructHUB dot U S. |

**Full narration.** Here is one job in the ConstructHUB CRM, from the first call to the final payment. Every job starts as a lead on the pipeline. This one is the Hadleys' new floor, in Austin. It has moved along to Scheduled. Every client has a page. Open the Hadleys, and the whole job is in one place. Quick actions start the next step: a visit, an estimate, a payment. The estimate went out by email. You can see when they opened it, and when they approved. Each line came from the price book, with its quantity and its price. Nora approved it online by typing her name. Now it is a signed contract. Next, the visit goes on the schedule. Open it for the time, the client, and who is going. The crew sees it on their own calendar. On site, the crew shoots photos with JobCam. Back on the Hadleys' page, each shot is filed to this client's job. When the work is done, choose Create invoice on the approved estimate. The invoice is made from the estimate, ready to send. When the check arrives, choose Record payment. Check the amount, and record it. The invoice is marked paid, and the client gets a receipt by email. Lead, estimate, signature, schedule, photos, invoice, paid. One job, in one place. The CRM is its own product, with its own plans. See them at ConstructHUB dot U S.

Fact base: pipeline, estimates and typed-name approval, schedule, JobCam, invoices and recorded
payments [1c]; "its own product, with its own plans" [D5]. Not said, on purpose: card payments (Stripe
is not connected in the demo), tax, any price, HOVER, the phone apps.

- **Title options:** "ConstructHUB CRM in 2 minutes: one job from lead to paid" · "Lead to paid: a
  contractor CRM tour" · "How one job runs through ConstructHUB CRM"
- **Thumbnail headline:** LEAD TO PAID (kicker "CRM in 2 minutes")
- **59-second vertical cut:** seven beats of about seven seconds, a big one-word caption on each —
  LEAD (pipeline column) · ESTIMATE (the estimate lines) · SIGNED ("Approved by Nora Hadley") ·
  SCHEDULED (the visit dialog) · PHOTOS (JobCam on the client page) · INVOICE (Create invoice) · PAID
  (the paid badge) — then "ConstructHUB CRM — constructhub.us".
- **Pinned comment:** "Everything in this video is a demo workspace with made-up clients. The CRM is
  its own product with its own plans (JobCam is part of the top plan, or an add-on):
  https://constructhub.us/pricing#crm — step-by-step tutorials for each screen:
  https://constructhub.us/tutorials"

## 3. `brand-tour-business-tools` — "ConstructHUB Business tools in 2 minutes" (SCRIPT ONLY — do not record yet)

The owner has said Business tools videos wait until the current upgrades are finished.

**Screens that exist today and look right with real data** (operated in the recording environment
2026-10-08): the dashboard (`/`), Database Directory (`/databases`), Property Records (`/property`),
Search Permits (`/search`, form only until a search is run), the feature catalogue (`/features`).
**Screens that exist but are empty or say "not set up" without a connected account** — not filmable
yet: Google Profile, Locations, Google Reviews, Posts & Photos, Ranking Grid, Site Scan, Social Media,
Competitor Intel, SEO ("Rank tracking is being switched on"), Call Assistant (shows the add-on offer).
Recording them needs a real, owner-controlled demo Google Business Profile and website — never a
stubbed response.

| # | On screen | Narration |
| --- | --- | --- |
| 1 | Dashboard | These are ConstructHUB's Business tools: what you use to find work and look after how you show up online. |
| 2 | Database Directory, the totals | Start with permits. The directory lists county and city permit offices in all fifty states and D.C. |
| 3 | Search a city; the Verified portal badge | Search a city. A verified link opens the office's own permit portal. |
| 4 | A row with "Find permit portal" | Where there is no link on record, you get a web search. Never a guessed address. |
| 5 | Search Permits, one live search | Where a portal can be searched from here, type an address, a name or a permit number. |
| 6 | Results, portal by portal | Each portal shows whether it was searched, so an empty list never hides a failed search. |
| 7 | Property Records | Property Records lists county assessor and appraiser offices, with a link to each one's records site. |
| 8 | Google Profile with a real listing | Connect your Google Business Profile to see each location's details and its numbers. |
| 9 | Profile Guard | Profile Guard checks your listing on a schedule and tells you when something changes. |
| 10 | Google Reviews | Ask every client for a review after the job, and answer reviews with reply drafts you approve. |
| 11 | Site Scan report | Site Scan reads your website the way a search engine does, and lists what to fix. |
| 12 | Ranking Grid map | The ranking grid shows where your business comes up across your service area. |
| 13 | SEO → Site explorer | The SEO tools look up any website: its keywords, its links and who it competes with. |
| 14 | Call Assistant | The Call Assistant is an add-on: it answers your phone, takes the lead and texts the right person. |
| 15 | Plans page | Every plan shows its price, and what it does not include. Business tools and the CRM are sold separately. |

Fact base: 1b for every row; [D2] rows 3–4; [D4][D5] row 15. Lines 8–13 may only be recorded once
each has been run on a real account. Never say "Google partner".

- **Title options:** "ConstructHUB Business tools in 2 minutes" · "Permits, your Google listing and
  reviews: a tour for contractors" · "Find the permit office, fix your Google listing — a tour"
- **Thumbnail headline:** FIND WORK, GET FOUND
- **59-second vertical cut:** permits (search a city → Verified portal → "no guessed links") 0–25 s;
  Google listing and reviews 25–42 s; Site Scan 42–52 s; "sold separately from the CRM —
  constructhub.us" 52–59 s.
- **Pinned comment:** "The permit directory and property records are free to browse:
  https://constructhub.us/databases · Plans: https://constructhub.us/pricing · The CRM is a separate
  product."

## 4. `brand-why-constructhub` — "Why contractors choose ConstructHUB" (SCRIPT — safe to record; not recorded in this pass)

Category-level only. No competitor names, no prices spoken. The fact base does **not** support "instead
of three or four separate subscriptions" (ConstructHUB is itself two products plus an add-on, and the
large field-service products now sell marketing add-ons), so the script says "from one company".
Honest caveat on the title: we have no customer research on why contractors choose us — "Why
contractors choose…" is the owner's working title; "What makes ConstructHUB different" is the one the
evidence supports.

| # | On screen | Narration | Fact |
| --- | --- | --- | --- |
| 1 | Dashboard | Most contractor software does one thing. Photos here, estimates there, your Google listing somewhere else. | category level |
| 2 | Dashboard → CRM | ConstructHUB covers that ground from one company, in two products. | [D9][D5] |
| 3 | Database Directory | First difference: permits. A directory of county and city permit offices, in the same product as your marketing tools. | [D1] |
| 4 | Verified portal badge | Every link is checked. If we could not confirm one, it says so. | [D2] |
| 5 | "Find permit portal" row | If we do not have one, you get a web search. Not a guess. | [D2] |
| 6 | Directory, signed out | You can browse it before you sign up. | [D3] |
| 7 | Plans page, a "Not included" list | Second: straight pricing. Every plan shows its price, and what it does not include. | [D4] |
| 8 | Plans page, the CRM section | Buy the Business tools, the CRM, or both. You are never made to buy both. | [D5] |
| 9 | CRM client page: estimate, visit, invoice | Third: the job stays together. The estimate, the visit and the invoice are on one page. | [1c] |
| 10 | JobCam on the same page | Job photos are filed to that same job. JobCam is part of the top CRM plan, or an add-on. | [D7] |
| 11 | CRM Payments page | Card and bank payments go to your own Stripe account. ConstructHUB adds no fee on top of Stripe's. | [D8] — record only on a workspace where Stripe is connected; the demo shows "not configured" |
| 12 | Features page | See what each tool does, and which plan has it, at ConstructHUB dot U S. | [D4] |

About 80 seconds. Row 11 is the one line that needs a connected demo Stripe account before it can be
shown; drop it otherwise.

- **Title options:** "What makes ConstructHUB different for contractors" · "Why contractors choose
  ConstructHUB" · "Permits, straight pricing, one job in one place"
- **Thumbnail headline:** NO GUESSED LINKS
- **59-second vertical cut:** "Three things that are different" — 1 PERMITS (directory, verified
  badge, "not a guess") 0–22 s; 2 STRAIGHT PRICING ("Not included" list) 22–38 s; 3 ONE JOB, ONE PAGE
  (client page scroll, JobCam) 38–54 s; constructhub.us 54–59 s.
- **Pinned comment:** "What we mean by 'checked': every permit portal link is tested, unconfirmed ones
  are labeled, and where we have none you get a web search instead of a made-up address. Browse it
  free: https://constructhub.us/databases"

---

## 5. Named comparisons — **NEEDS OWNER SIGN-OFF BEFORE RECORDING OR PUBLISHING**

Rules for all four: the competitor's **name in plain text only** — no logo, no screenshot or footage of
their product, no imitation of their colours; only ConstructHUB screens are shown; every competitor
price is on-screen text with "as of October 2026" and the source in the description; the description
ends "<Name> is a trademark of its owner. ConstructHUB is not affiliated with <Name>. Prices and
features from their public pages on <date>; check their site for current details."; each video says
where the competitor is stronger. Re-read every figure on the day of publishing and every 90 days;
unlist a video that has gone stale.

### 5a. `brand-vs-jobber` — "ConstructHUB CRM and Jobber: an honest comparison" — NEEDS OWNER SIGN-OFF

| Fact | Jobber | ConstructHUB | Source · date |
| --- | --- | --- | --- |
| Entry plan, 1 user | Core $49/mo no commitment · $39/mo one-year · $29/mo paid annually | CRM Basic $39/mo · $348/yr | getjobber.com/pricing (S) · `shared/crm-plans.ts:102` · 2026-10-08 |
| Quotes approved online | yes | yes (typed name; contract PDF) | getjobber.com/features (S) · fact base 1c |
| Schedule, invoices, online payments, client portal | yes | yes | same |
| Website builder, online booking | yes (Core) | no | getjobber.com/pricing (S) |
| Integrations | "100+ app integrations" | Stripe, Google Calendar, a lead form, API, webhooks | (S) · fact base 1c |
| Marketing add-on / AI receptionist | Marketing Suite "$99/mo"; Receptionist "$29/mo" | Business tools from $29/mo (separate product); Call Assistant add-on from $149/mo | (S) · `shared/plans.ts` |
| Job photos | "unlimited photos and videos" on Plus | JobCam: top plan or +$39/mo; 5 GB | (S) · `shared/crm-plans.ts:34` |
| Permit office directory, county property records | not on the pages fetched | yes | [D1] |
| Native phone apps in the stores | yes | **no** — browser today | fact base 1d |

**Narration (about 75 s).** If you are choosing software to run jobs, Jobber is probably on your list.
It should be. Here is an honest look at both. · Both do the core work: quotes your client approves
online, a schedule, invoices and online payments. · Jobber is the more mature product. It has more
integrations, a website builder and online booking, and apps in the app stores. ConstructHUB's CRM runs
in your phone's browser today. · On price, the entry plans are close. The numbers are on screen, with
today's date. · So why look at ConstructHUB? Two reasons. · One: permits. ConstructHUB has a directory
of county and city permit offices and county property records. Jobber's pricing and feature pages do
not list either. · Two: job photos sit inside the CRM, filed to the same job as the estimate and the
invoice. That is JobCam, part of the top CRM plan or an add-on. · If you want the most established
field-service app, look at Jobber. If permits and property records matter to how you find work, look
at ConstructHUB.

**Where Jobber is stronger (said in the video):** maturity, integrations, website and booking, native
apps, entry price on annual billing. **Safe claims:** the rows above marked "yes / no" for our side;
"Jobber's pricing and feature pages do not list" (not "Jobber does not have").

- **Title options:** "ConstructHUB CRM and Jobber: an honest comparison" · "Jobber or ConstructHUB?
  What each does for contractors" · "ConstructHUB vs Jobber: where each is stronger"
- **Thumbnail headline:** AN HONEST COMPARISON (text only; no Jobber logo or colours)
- **59-second vertical cut:** "Same: quotes, schedule, invoices" 0–12 s · "Jobber is stronger at:
  integrations, website, apps" 12–26 s · "Only here: permit directory + property records" 26–44 s ·
  "Photos inside the CRM (JobCam)" 44–54 s · "Prices as of Oct 2026 in the description" 54–59 s.
- **Pinned comment:** "Sources, read on <date>: getjobber.com/pricing and getjobber.com/features;
  ConstructHUB: constructhub.us/pricing. Jobber is a trademark of its owner; we are not affiliated.
  Spot something out of date? Tell us and we will fix or pull the video."

### 5b. `brand-vs-housecall-pro` — "ConstructHUB CRM and Housecall Pro: an honest comparison" — NEEDS OWNER SIGN-OFF

| Fact | Housecall Pro | ConstructHUB CRM | Source · date |
| --- | --- | --- | --- |
| 1 user, month to month | Basic "$79 /mo" | Basic $39/mo | housecallpro.com/pricing (D) · `shared/crm-plans.ts:102` · 2026-10-08 |
| 5 users | Essentials "$189 /mo" | Essentials $94/mo | (D) · `:128` |
| 8 users | Max "$329 /mo" | Max $164/mo | (D) · `:151` |
| Annual billing, per month | $59 / $149 / $299 "(Billed annually)" | $29 / $74 / $149 ($348 / $888 / $1,788 a year) | (D) · same lines |
| Extra user | "$35/mo per additional user" | $17/mo | (S) · `:172` |
| Trial | 14 days | 14 days | page title (D) · `:178` |
| Estimates, schedule, invoices, payments, customer portal | yes | yes | housecallpro.com/features (S) · 1c |
| Routes, route optimisation, employee GPS tracking | yes (Essentials / Max) | **no** | (S) |
| QuickBooks Online sync, financing | yes | **no** | (S) |
| Review management | yes (Basic) | in Business tools, a separate product | (S) · 1b |
| Photos | "photo reports & annotations" (Essentials) | JobCam: Max, or +$39/mo | (S) · `:34` |
| Permit office directory, county property records | not on the pages fetched | yes (Business tools) | [D1] |
| Native apps | yes | **no** | 1d |

**Narration (about 80 s).** Housecall Pro is one of the best-known tools for home-service crews. Here
is an honest look at it next to the ConstructHUB CRM. · Both run the job: estimates, a schedule,
invoices, online payments, and a portal for your customer. · Housecall Pro goes further on dispatch.
Routes, route optimisation and G P S tracking are on its plans. It syncs with QuickBooks. ConstructHUB
does not do those today. · The difference is price. At list price, seat for seat, ConstructHUB CRM is
about half. The plans are on screen, with today's date. They do not include the same features, so
read both lists. · And ConstructHUB has a second product: Business tools, with a permit office
directory and county property records. It is sold separately. · If you run trucks on routes all day,
look hard at Housecall Pro. If you want estimates, a schedule, invoices and job photos for less, look
at ConstructHUB.

**Where Housecall Pro is stronger:** dispatch and routing, GPS, QuickBooks, financing, apps, maturity.
**Safe claims:** the three list-price pairs **with** "plans do not include the same features" on
screen; "about half at list price, seat for seat". **Do not say** "half the price" without "at list
price" and the feature caveat; do not mention their promotions. The word "best-known" is about them,
not us; drop it if the owner prefers.

- **Title options:** "ConstructHUB CRM and Housecall Pro: an honest comparison" · "Housecall Pro or
  ConstructHUB? Price and features, side by side" · "ConstructHUB vs Housecall Pro for contractors"
- **Thumbnail headline:** SEAT FOR SEAT (text only)
- **59-second vertical cut:** "Same core: estimates, schedule, invoices" 0–10 s · "They win: routes,
  GPS, QuickBooks" 10–24 s · the price table as of October 2026, held for 12 s with the caveat line
  24–40 s · "Plus: permit directory (separate product)" 40–54 s · sources in the description 54–59 s.
- **Pinned comment:** "Prices are list prices from housecallpro.com/pricing and constructhub.us/pricing
  on <date>; plans do not include the same features, and either company may be running an offer.
  Housecall Pro is a trademark of its owner; we are not affiliated."

### 5c. `brand-vs-leap` — "ConstructHUB CRM and Leap: an honest comparison" — NEEDS OWNER SIGN-OFF

Leap = Leap to Digital (leaptodigital.com): **Leap CRM** and **Leap SalesPro**, for roofing,
remodeling, windows and doors, siding, kitchen and bath. Confirmed 2026-10-08.

| Fact | Leap | ConstructHUB | Source · date |
| --- | --- | --- | --- |
| Single user | CRM Essential "$79 /month", "Single-User Only" | CRM Basic $39/mo, 1 seat | leaptodigital.com/pricing (D) · `shared/crm-plans.ts:102` · 2026-10-08 |
| A team | CRM Team "Starting at $298 /month", "Includes First User and $99 per/mo per add. user" | CRM Essentials $94/mo with 5 seats; Max $164/mo with 8 | (D) · `:128,151` |
| In-home sales app | SalesPro Premium "Starting at $750 /month", "Includes 6 Users" | **none** | (D) |
| Trial | "14 Day Free Trial" | 14 days | (D) · `:178` |
| Leads, estimates, digital signatures, calendar, invoices, payments, customer portal | yes | yes | leaptodigital.com/leap-crm (S) · 1c |
| Subcontractor portal, workflow automations | yes | subcontractor role; no workflow automations | (S) · 1c |
| Supplier, measurement and financing integrations | ABC Supply, SRS, QXO, EagleView, GreenSky, QuickBooks | **no** (HOVER is not working today) | leaptodigital.com (S) · 1c |
| Job photos | integrates with CompanyCam | JobCam inside the CRM: Max, or +$39/mo | (S) · `:34` |
| Permit directory, property records, Google listing tools | not mentioned on the pages fetched | yes (Business tools, separate) | [D1] |
| Android and iOS apps | yes | **no** | (S) · 1d |

**Narration (about 75 s).** Leap is built for home-improvement companies that sell in the home:
roofing, siding, windows, remodeling. Here is an honest look at it next to ConstructHUB. · Leap is two
products. Leap CRM runs the job. SalesPro is for presenting and signing at the kitchen table.
ConstructHUB has nothing like SalesPro. · Leap also connects to suppliers, measurement services and
financing. ConstructHUB does not. · The CRMs cover the same core: leads, estimates, a signature, a
calendar, invoices and payments. · Where ConstructHUB differs is who it is priced for. The list prices
are on screen, with today's date. A small crew gets five seats on one plan. · And ConstructHUB has a
second product, Business tools: a permit office directory, county property records, and tools for your
Google listing. Leap's pages do not list those. · If you run a sales team in the home, look at Leap.
If you are a small crew that wants the job and the permits in one place, look at ConstructHUB.

**Where Leap is stronger:** SalesPro, supplier / measurement / financing integrations, automations,
native apps, depth for larger sales organisations. **Safe claims:** the dated price lines with the
feature caveat; "Leap's pages do not list" permits or Google tools. **Do not** quote or dispute Leap's
own results claims.

- **Title options:** "ConstructHUB CRM and Leap: an honest comparison" · "Leap or ConstructHUB? Which
  fits a small crew" · "ConstructHUB vs Leap CRM for contractors"
- **Thumbnail headline:** WHICH FITS YOUR CREW? (text only)
- **59-second vertical cut:** "Leap = CRM + SalesPro (in-home selling)" 0–14 s · "They win:
  suppliers, measurements, financing, apps" 14–26 s · "Same core CRM" 26–34 s · price lines as of
  October 2026 with the caveat 34–46 s · "Plus: permits + Google listing tools" 46–56 s · sources 56–59 s.
- **Pinned comment:** "Sources, read on <date>: leaptodigital.com/pricing and
  leaptodigital.com/leap-crm; ConstructHUB: constructhub.us/pricing. Leap is a trademark of its owner;
  we are not affiliated."

### 5d. `brand-vs-ahrefs-semrush` — "Do you need Ahrefs or Semrush? SEO for a local contractor" — NEEDS OWNER SIGN-OFF · SCRIPT ONLY (waits for the SEO upgrades)

| Fact | Ahrefs | Semrush | ConstructHUB | Source · date |
| --- | --- | --- | --- | --- |
| What it is | dedicated SEO suite, own crawler and index | dedicated SEO and marketing suite | SEO lookups inside Business tools | ahrefs.com/big-data (S) · fact base 3a |
| Entry paid plan | Lite "$ 129 / mo" (Starter "$ 29 / mo" with a narrower toolset) | SEO "$ 139" monthly, "$ 117 . 33 /mo billed annually" | Starter $29/mo, with "SEO data: $10 / month included" | ahrefs.com/pricing (D) · semrush.com/pricing (D) · `shared/plans.ts:79,126` · 2026-10-08 |
| Free tier | "Ahrefs Free" for your own site | "Free. $0 /mo", "10 reports per day" | none (1-day trial) | (D) · `shared/plans.ts:482` |
| Tracked keywords on that plan | 750 | 500, checked daily (S) | 50, checked weekly (count still to be confirmed by the owner) | (D)/(S) · `shared/plans.ts:75-79` |
| History | 6 months on Lite, up to 5 years | historical data from Pro+ (S) | six months in Site explorer | (D) · `server/seo/explorer.ts` |
| Site explorer, keywords, rank tracker, site audit, backlinks, content gap | yes, deeper | yes, deeper | yes | (D) · 3a |
| How use is metered | credits per user, crawl credits | reports per day, projects | SEO data credit; prepaid packs $25 / $50 / $100 | (D) · `shared/seo-credits.ts:19` |
| Google Business Profile tools, review requests, permit directory, CRM | not on the pricing page (Semrush sells a separate Local toolkit — not verified) | — | yes (CRM is a separate product) | 1b, [D1] |

**Narration (about 80 s).** If you have looked into S E O, you have seen Ahrefs and Semrush. They are
the big dedicated suites, built on their own data, with far more of it than we offer. · If S E O is
your job, or you run an agency, use one of them. Both have a free tier to start with. · Most local
contractors need a handful of answers. Where do I rank for the jobs I want? What do people in my area
search for? Who links to the company above me? What is wrong with my website? · ConstructHUB's S E O
tools answer those: a site explorer, keyword research, a weekly rank tracker, backlinks and a site
audit. · They sit in the same product as your Google listing, your reviews and the permit directory.
· You are not paying for a suite built for agencies. An S E O data allowance comes with every plan,
and you can add more when you need it. The plans are on screen, with today's date. · Need the deepest
S E O data there is? Ahrefs or Semrush. Need the basics next to the rest of your marketing?
ConstructHUB.

**Where they are stronger (said plainly):** their own crawlers and indexes, much higher limits, daily
tracking (Semrush), years of history, free tiers, far more tools. **Safe claims:** the list of our
tools as they exist; "an allowance comes with every plan"; "in the same product as your Google listing
and the permit directory". **Never:** "alternative to", "as good as", "cheaper than", "our index",
"our crawler", or any hint of where our data comes from or what it costs. "Built for agencies" is our
characterisation — soften to "built for people who do S E O all day" if the owner prefers.

- **Title options:** "Do you need Ahrefs or Semrush? SEO for a local contractor" · "SEO tools for
  contractors: Ahrefs, Semrush and ConstructHUB" · "How much SEO software does a contractor need?"
- **Thumbnail headline:** HOW MUCH SEO? (text only)
- **59-second vertical cut:** "Ahrefs and Semrush: the big suites — and they have free tiers" 0–14 s
  · "Four questions a contractor asks" as four captions 14–34 s · our five tools, one cut each 34–50 s
  · "Next to your Google listing and permits" 50–56 s · sources 56–59 s.
- **Pinned comment:** "Plans and limits read on <date> from ahrefs.com/pricing, semrush.com/pricing and
  constructhub.us/pricing. Ahrefs and Semrush are trademarks of their owners; we are not affiliated.
  If SEO is your full-time job, they are the deeper tools."
