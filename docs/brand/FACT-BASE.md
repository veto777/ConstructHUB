# ConstructHUB — fact base for brand videos

_Written 2026-10-08 from the code on `origin/main` (ef7a177), the live site (fetched 2026-10-08) and
competitors' own public pages (fetched 2026-10-08). Every claim a brand video makes must trace to a
line here. If it is not here, it is not said. Prices change: re-check section 3 before any video that
names a competitor is recorded, and again before it is published._

**How to read "Live".** "Live" means: the page is in the app's routes, has a help entry, and has a
public feature page marked `status: "ready"` on constructhub.us today. It does **not** mean this
document tested the feature end to end in production — where a feature depends on an outside account
(Google, Stripe, Cloudflare) or on something `HANDOFF.md` lists as open, that is said in the last
column, and a video should show it only after someone has run it for real.

---

## 1. What ConstructHUB is today

ConstructHUB is **two products, sold separately** (`shared/plans.ts:11-13`, `shared/crm-plans.ts:4-7`):

- **Business tools** (the platform, `constructhub.us`) — find permit offices and records, look after
  the Google listing, reviews, website and ads.
- **ConstructHUB CRM** — clients, pipeline, estimates, schedule, invoices, payments, job photos.

"Nothing is bundled: a platform plan grants NO CRM seats … and a CRM plan grants NO platform tools."
(`shared/crm-plans.ts:5-7`). The live pricing page says it the same way: "The CRM is a separate
product with its own plans, from $39/mo." Never say the CRM is "included".

### 1a. Price book (quote these, with the file)

**Business tools** — `shared/plans.ts:124-245`; annual = 10 × monthly (`ANNUAL_MONTHS`, line 564);
"A new account starts any plan with a 1-day free trial" (`TRIAL_DAYS = 1`, line 482; live /pricing).

| Plan | Monthly | Annual | What the price book says (first lines) |
| --- | --- | --- | --- |
| Starter (`:126`) | $29 | $290 | 1 Google Business Profile location · Profile Guard edit alerts · review alerts, AI reply drafts · 5 ranking-grid credits · 2 Site Scans · 100 permit searches / month · no SEO tools (Agency only for new sales since 2026-10-08; the old $10 / month SEO data allowance is historical, kept only by grandfathered accounts) |
| Pro (`:156`) | $79 | $790 | + Click Guard / IP Tracker / VPN Shield for 1 website · 2 Competitor Intel scans · 500 permit searches · team text alerts 500 segments |
| Growth (`:187`) | $199 | $1,990 | 3 locations · 3 protected websites · 5,000 permit searches · 1 client-texting number included |
| Agency (`:217`) | $349 | $3,490 | 10 client locations then per-location bands · agency workspace · Google Ads & LSA manager · Cloudflare + Search Console · Domains + Gmail alerts |

Add-ons (`shared/plans.ts:401-406`): extra location $19/mo, extra protected website $15/mo, client
texting number $29/mo, competitor scan pack $39/mo. **AI Call Assistant** tiers
(`shared/plans.ts:354-359`, sold on Pro / Growth / Agency only, line 383): Lite $149/mo (2,000 min,
1 number), Solo $249/mo ($99 for the first 3 months on monthly billing; 5,000 min), Crew $449/mo
(10,000 min, 5 numbers), Fleet $799/mo (25,000 min, 20 numbers); overage 10¢ / 10¢ / 5¢ / 5¢ a minute.
SEO data beyond the plan's allowance is prepaid credit in packs of $25 / $50 / $100
(`shared/seo-credits.ts:19`).

**CRM** — `shared/crm-plans.ts:100-169`; 7-day trial (`CRM_TRIAL_DAYS`, line 178; owner decision 2026-10-08, was 14).

| Plan | Monthly | Annual | Seats | Not in this plan |
| --- | --- | --- | --- | --- |
| CRM Basic (`:102`) | $39 | $348 | 1 | extra seats ($17/mo each, line 172), texting, change orders and job costing, JobCam |
| CRM Essentials (`:128`) | $94 | $888 | 5 | a texting number on our carrier, JobCam |
| CRM Max (`:151`) | $164 | $1,788 | 8 | — (JobCam, 1 client-texting number and 5 GB of JobCam storage are in it) |

Every CRM plan: unlimited clients and jobs, estimates, invoices and payments, online card and ACH
payments, client portal, schedule and dispatch calendar, price book (`:105-113`).
**JobCam**: in CRM Max; **$39/mo add-on on CRM Basic and CRM Essentials**
(`CRM_JOBCAM_ADDON_MONTHLY_CENTS = 3900`, line 34; `CRM_ADDONS.jobcam`, line 207). Yearly add-on =
12 × $39 = $468, "no annual discount assumed — owner to confirm" (line 36). JobCam storage: 5 GB
included; sizes 10 / 100 / 500 / 1,000 / 2,000 GB exist but **have no price** — "Larger sizes are
available on request" (`shared/jobcam-storage.ts:17-21`, live /features/jobcam).

**Done-for-you services** exist (`server/catalog.ts:23-31`, $5,500 – $60,000; anything ≥ $1,000 is
"Talk to a sales rep"). They are services, not software, and several are named after ranking results
("First Page SEO", "Top 3"). **No brand video mentions them** — a ranking promise cannot be
substantiated.

### 1b. Business tools — one line each

Evidence for every row: its help entry in `shared/help/registry.ts` and its feature page
`shared/feature-pages/<name>.ts` (all `status: "ready"`); plan lines from the live `/features` page.

| Tool | What it is, in one sentence | Live? | Plan / price fact | Do not claim |
| --- | --- | --- | --- | --- |
| Database Directory (`/databases`) | A directory of US county and city permit offices with a checked link to each office's official permit portal where one is on record. | **Live. Opens signed out.** | Browsing is free; no plan needed. | See the coverage numbers below — never "every permit office". |
| Permit Search (`/search`) | Searches the government permit portals it can query live, by address, permit number, name, company or licence, into one results list. | Live. | 100 / 500 / 5,000 / 5,000 searches a month by plan. | Only **273** jurisdictions are live-searchable today (API below). Never "search every permit in America". |
| Property Records (`/property`) | A directory of county assessor and appraiser offices (sourced from NETR Online) with a checked link to each office's records site. | **Live. Opens signed out.** | "Free with an account"; not counted against a plan. | It links to the county's site; it does not hold owners, values or sales itself. |
| Google Profile / Locations | Connect the Google account that manages your listings and see each location's details, photos and performance figures. | Live page. **Needs a connected Google account.** | Every plan from $29/mo. | Google approved API access 2026-09-23 (`HANDOFF.md:812-834`); the remaining console step is listed as open (`HANDOFF.md` "Open items"). **Not verified working here — do not film until someone runs it on a real listing.** |
| Profile Guard | Checks the Google Business Profile on a schedule against the values you approved and alerts you when something changes. | Live page; same Google dependency. | Every plan; checks every 15 min (30 on Agency). | Same caveat. |
| Google Reviews | Feedback request after a job, the Google review option offered to every client whatever their rating, AI reply drafts you approve. | Live (`SHOW_GOOGLE_REVIEWS` on since 2026-09-28). | Every plan; automatic publishing of AI replies from Pro. | Never "only 5-star reviews", never a reward for a review (Google policy; `HANDOFF.md:819-824`). |
| Posts & Photos | Draft, approve and schedule Google updates and photos. | Live page; Google dependency. | Every plan. | Nothing publishes until approved — say that, not "automatic posting". |
| GMB Ranking Grid | Runs one search phrase from a grid of points across the service area and maps where the business comes up. | Live. | 5 / 15 / 30 credits a month; Agency 2 per location. | No ranking promise. |
| Photo Optimizer / Media Library | Batch watermark, rename and describe job photos; keep them in folders. | Live. | Every plan. | The home page itself says geotags "don't promise a ranking benefit". |
| Site Scan | Reads a website the way a search engine does and scores technical health, speed, local signals, content and AI readiness, with steps to fix. | Live. A free 60-second scan is offered signed out (home page). | 2 / 5 / 15 scans a month; Agency 1 per location. | — |
| SEO (Site Explorer, rank tracking, keywords, backlinks) | Look up any domain's authority, backlinks, keywords and competitors; track rankings. | **Partly live.** Site Explorer shipped 2026-10-07; "Still to do: backlinks full depth → keyword research full depth → rank tracking → AI visibility → reports" (`HANDOFF.md:60-62`). | Agency plan only for new sales since 2026-10-08, with $40 of SEO data a month, then prepaid packs. The old Starter / Pro / Growth allowances ($10 / $20 / $40) are historical: only accounts grandfathered before that date keep them. | **Never name the data vendor.** Never say the SEO tools come with every plan. Do not film until the upgrades are finished (owner). |
| Social Media | Compose a post, adjust per network, publish now or on a schedule. | Live page; needs each network connected. | Every plan. | Not verified with real networks here. |
| Click Guard / IP Tracker / VPN Shield | Record ad clicks on a website, flag repeat and VPN traffic, and build an IP exclusion list. | Live. | Pro and up (1 / 3 / 10 websites). | No "stops click fraud" absolute. |
| Competitor Intel | Scans of competitors' public ad activity. | Live (flag on since 2026-09-28). | Pro and up (2 / 8 / 20 scans). | Say "public ad activity", never "spy" (`HANDOFF.md:823`). |
| AI Call Assistant | An AI receptionist on your own local number that answers, screens spam, takes the lead and texts the right person. | Live and purchasable since 2026-10-02 (`HANDOFF.md:347-352`). | Add-on, Pro and up, from $149/mo. | It is an add-on, not in any plan. |
| Cloudflare / Search Console | Connect a Cloudflare account or Search Console and apply previewed rules / read search data. | Live page. "No real connect has been run yet" (`HANDOFF.md:91-93`). | **Agency only.** | **Do not film** — never exercised with a real account; Google shows an unverified-app warning for this scope. |
| Agency workspace, Ads & LSA manager, Domains, Mail alerts, LSA Leads | Tools for agencies running many client profiles. | Live pages. Google Ads API token: Basic access pending (owner memory note). | Agency only. | Not for a contractor-facing trailer. |
| Master Class, Guides, Reinstatement | State-by-state guides to starting a construction business; a suspended-profile service. | Live. | Master Class bundle $2,499 (`server/catalog.ts:42`). | No outcome promises. |
| Gabe (assistant) | The assistant on every page. | Live. AI needs the platform's own model; an old open item says AI endpoints "error until a real key is set" (`HANDOFF.md` open items — may be stale). | — | **Not verified. Leave out.** |
| Report an issue | A form at the bottom of every page; each report gets a number and a status. | Live. | Every plan, signed out too. | — |

**Permit coverage — state it only like this** (live `GET https://constructhub.us/api/databases/counts`,
2026-10-08): 35,669 county and city jurisdictions listed (3,137 counties, 32,532 cities) across all 50
states and DC; **12,677** with a permit portal link on record; **10,146** of those links checked live;
**273** jurisdictions searchable from inside ConstructHUB. The home page says: "All 50 states + DC
listed — portal links shown only once checked." These numbers move; a video says "thousands of permit
offices" or reads the number off the screen, never a number typed into a script.

### 1c. The CRM — one line each

Evidence: help entries `crm-*` and `jobcam` in `shared/help/registry.ts:690-847`, live
`/features/crm` and `/features/jobcam`, and the recorded tutorials (operated in the demo workspace).

| Area | What it is | Live? | Plan fact | Do not claim |
| --- | --- | --- | --- | --- |
| Clients | One page per client: estimates, invoices, projects, payments, visits, notes, uploads, timeline. | Live; recorded. | Every CRM plan; unlimited clients. | — |
| Leads / Pipeline | Jobs as cards in columns from lead to paid; an approved estimate moves its job by itself. | Live; recorded (crm-home). | Every CRM plan. | — |
| Estimates + e-signature | Price from the price book, send by email; the client opens a private link, confirms their email with a one-time code and approves by typing their full name; a signed contract PDF goes to both. | Live; recorded. | Every CRM plan. | The signature is a typed name — say "approves online" / "signs by typing their name", not "legally binding" (attorney review of the terms is still open, `HANDOFF.md` open items). |
| Invoices / Payments | Turn an approved estimate into an invoice; record checks and cash; card and ACH through the contractor's **own Stripe account**. "ConstructHUB adds no fee" (live /features/crm). | Live. Online payment needs the contractor's Stripe account connected; an old open item says live capture waits on Stripe payout verification (`HANDOFF.md` open items — may be stale). | Every CRM plan. | In a recording, show a **recorded check**, not a card payment (Stripe is not configured in the demo). Stripe's own processing fees still apply — never "no fees". |
| Schedule | Month / week / agenda calendar for one person or everyone, overlap warning, feed to Apple / Outlook / Google Calendar. | Live; recorded. | Every CRM plan. | "Nothing lands on the schedule by itself." |
| Projects / job costing | Phases, daily logs, change orders the client approves online, budget vs. recorded costs. | Live. | **Essentials and Max only** (`jobCosting`, lines 122/146/166). | Not on Basic. |
| JobCam | The camera inside the CRM: photos and video filed to the project with time and place; grid or day-by-day timeline; tags; share links with optional password and expiry. | Live (phase A 2026-10-07); recorded. | Max, or +$39/mo on Basic / Essentials. 5 GB. | **Not unlimited storage.** The first paid add-on purchase "NOT yet exercised with real money" (`HANDOFF.md:73-74`). |
| Messages | One thread per client; portal notes and estimate questions land in one inbox; replies are emailed. | Live. | Every CRM plan. | — |
| Texting | Team alert texts and client texting. | Live (10DLC campaign approved 2026-08-26). | Team alerts: Essentials 500, Max 1,500 segments. Client texting: own number or add-on on Essentials; one number in Max. **None on Basic.** | — |
| Team / roles | Owner, Admin, Sales, Project manager, Office, Field, Subcontractor; field crews can be price-blind. | Live; recorded. | Seats 1 / 5 / 8, extra $17/mo. | — |
| Client portal | Every client gets a portal: estimates, invoices, signed contracts, notes and photos to the contractor. | Live. | Every CRM plan. | — |
| Integrations | HOVER, Stripe, Google Calendar, a lead-capture form, API keys, webhooks. | HOVER: sign-in expired and measurement-file access not enabled (`HANDOFF.md:9-13`). | — | **Never mention HOVER or "measurements from a report" in a brand video.** |

### 1d. Unfinished, pending or "coming" — no video may claim these

- **iPhone apps.** Native shells exist in the repo; **neither app is in the App Store** — the App
  Store Connect key, app records, signing and TestFlight are all still to do (`HANDOFF.md:299-309`).
  JobCam works "from the phone's browser" today; say that. Never show an App Store badge.
- **SEO tools** beyond Site Explorer (see table). **Cloudflare / Search Console** never run on a real
  account. **HOVER** broken. **JobCam larger storage** has no price. **JobCam add-on** never bought
  with real money. **CRM terms** not yet reviewed by an attorney.
- **The home page's own copy** still says "ranking #1 on Google Maps", "every tool, resource, and
  service you need", "built by contractors who scaled from solo operators to hundreds of employees"
  and "proven 4-step recovery process". None of that is substantiated in the repo. **Do not carry it
  into a video** (and the page itself should be toned down — owner decision).
- **Google.** The API approval came with a rider: "no public statements … suggesting
  partnership/sponsorship/endorsement by Google" (`HANDOFF.md:817-818`). Say "your Google Business
  Profile", never "Google partner", and no Google logos.

---

## 2. Differentiators that survive checking

Each has the evidence and the **only wording the evidence supports**.

| # | What is true | Evidence | Safe wording |
| --- | --- | --- | --- |
| D1 | A permit-office directory and a county property-records directory sit in the same product as the marketing tools. None of the six named competitors' pricing or feature pages fetched for section 3 mentions a permit-office directory or county records. | `/databases`, `/property`; section 3 | "ConstructHUB also has something most contractor software doesn't: a directory of permit offices and county property records." — "most", because a handful of products were checked, not all. |
| D2 | Portal links are checked, unconfirmed ones are labeled, and a missing one becomes a web search, never an invented address. | `CLAUDE.md` hard rule; `scripts/verify-links.ts`; live /features/permits "Checked links, never guessed"; `linkStatus` in `server/data/permit-portals.json` (10,082 verified · 2,482 unconfirmed · 508 none · 3 dead in the file) | "Every link is checked. If we couldn't confirm one, it says so. If we don't have one, you get a web search — not a guess." |
| D3 | The two directories open without an account. | live /features/permits ("Not ready to sign up? Browse the Database Directory"), /features/property ("The directory also opens without signing in") | "You can browse the permit directory before you sign up." |
| D4 | Prices are public, for every plan, with a "Not included" list on every card. | live /pricing; `notIncluded[]` in both price books | "Every plan shows its price and what it does not include." |
| D5 | Two products, bought separately. | `shared/crm-plans.ts:4-7` | "Buy the Business tools, the CRM, or both. You're never made to buy both." |
| D6 | The CRM starts at $39 a month with one seat. | `shared/crm-plans.ts:102` | "The CRM starts at $39 a month." (YouTube description / on-screen text only — never in narration, the test suite forbids a spoken price, and prices change.) |
| D7 | Job photos live in the same CRM as the estimate, the schedule and the invoice. | JobCam is a CRM feature filed to the project (`/crm/jobcam`) | "Job photos are filed to the same job as the estimate and the invoice." Add honestly: "JobCam is part of the top CRM plan, or an add-on." |
| D8 | Online payments go to the contractor's own Stripe account and ConstructHUB adds no fee of its own. | help entry `crm-payments`; live /features/crm | "Card and bank payments go straight to your own Stripe account. ConstructHUB adds no fee on top of Stripe's." |
| D9 | One company covers permit lookup, the Google listing, reviews, a website scan, a CRM and job photos. | sections 1b, 1c | "Permits, your Google listing, reviews, estimates, scheduling, invoices and job photos — from one company." |
| D10 | SEO lookups (site explorer, keywords, rank tracking, backlinks, site audit, content gap) sit in the same product as the Google listing and permit tools. Since 2026-10-08 they are included with the Agency plan only (accounts that already had them keep them); never say "every plan". | section 3a; `shared/plans.ts` SEO_PLAN_LIMITS | "The SEO a local contractor actually uses, next to your Google listing and your permits." Never "as powerful as", never "our index". **Not usable in a recorded video until the SEO upgrades are finished.** |

**What did NOT survive.**

- "Instead of three or four separate subscriptions" — **not supported.** Getting everything means a
  Business tools plan **plus** a CRM plan **plus**, below Max, the JobCam add-on: that is two or three
  ConstructHUB line items, not one. And Jobber, Housecall Pro and CompanyCam each now sell their own
  marketing add-on (section 3). Use "from one company" / "in two products", never a count of
  subscriptions replaced, and never "all-in-one".
- "Cheaper than X" as a blanket claim — not supported: Jobber's entry plan is $29–49/mo and Contractor
  Foreman's is $49/mo with a different feature mix. Only the specific, dated price pairs in section 3
  are provable.
- "Unlimited photos" — false (5 GB). CompanyCam and Jobber Plus advertise unlimited storage.
- "An alternative to Ahrefs / Semrush", "our keyword database", "our crawler" — false or misleading: the
  SEO data is licensed, and both are far larger suites.
- Customer counts, time saved, revenue gained, "#1", "best", "only", "guaranteed" — nothing in the repo
  substantiates any of them. Forbidden.
- "Works on iPhone app" — not in the App Store.

---

## 3. Competitors — their own pages, fetched 2026-10-08

**The owner named the five to compare against (2026-10-08): Ahrefs and Semrush for Business tools;
Jobber, Housecall Pro and Leap for the CRM.** CompanyCam is kept as a sixth for the JobCam angle. The
owner choosing the names is not sign-off on any claim — see section 4.

Method: every page was fetched on **2026-10-08**. Prices marked **(D)** were read from the page's own
text after downloading it directly; prices marked **(S)** came through a fetch-and-summarise tool
because the site refused a direct download — a person must re-read an (S) figure on the page before it
is used. "Not on the pages fetched" means only that: the product may still do it.

### 3a. What our own SEO tools are today (so the comparison is honest)

From `server/seo/*`, `client/src/pages/seo/*` and the `seo` help entry. Tabs on `/seo`
(`client/src/pages/seo/shell.tsx:89-95`): **Dashboard · Site explorer · Keywords explorer · Rank
tracker · Site audit · Backlinks · Competitors.**

| Tool | What it does today | Source |
| --- | --- | --- |
| Site explorer | Any domain: authority, backlink profile, organic and paid search footprint, six months of history, top keywords and pages, competitors, referring domains, anchors. A saved report reopens free for 7 days. | `server/seo/explorer.ts` |
| Reports | Tables behind the overview: keywords, paid keywords, pages, competitors, backlinks (all / new / lost / broken), referring domains, anchors, best by links. | `server/seo/reports.ts` |
| Keywords explorer | Matching terms, related terms, questions; one keyword's volume, difficulty, cost per click, intent, monthly trend and top results. | `server/seo/reports.ts` |
| Content gap / Link intersect | Keywords up to three competitors rank for and you do not; sites that link to the competitors and not to you. | `server/seo/gap.ts` |
| Rank tracker | Weekly checks of the keywords you choose, desktop and mobile, with history and a visibility estimate. Tracked keywords: 1,000 on Agency, the plan that includes the SEO tools for new sales since 2026-10-08; the old 50 / 200 / 1,000 on Starter / Pro / Growth are historical, kept only by grandfathered accounts (`shared/plans.ts` SEO_GRANDFATHERED_LIMITS). | `server/seo/rank-history.ts`, `shared/plans.ts` SEO_PLAN_LIMITS |
| Site audit | Health score and issue list with change since the last crawl, read from the crawls Site Scan runs; uses a Site Scan, not SEO data. | `server/seo/audit.ts` |
| SEO data credit | The Agency plan includes $40 of SEO data a month at the customer's price; beyond it, prepaid packs of $25 / $50 / $100 that do not expire. Historical / grandfathered only: $10 / $20 / $40 on Starter / Pro / Growth for accounts that had the tools before 2026-10-08. | `shared/plans.ts` SEO_PLAN_LIMITS and SEO_GRANDFATHERED_LIMITS, `shared/seo-credits.ts:19` |

**What must never be said about it.** ConstructHUB does **not** run its own web crawler or keep its own
index of the web: the search and backlink data is **licensed from a data provider** — the provider is
never named, and no cost or markup is ever mentioned, in any video, description or comment. Do not say
"our index", "our crawler", "our database of keywords". Say "SEO data" and "lookups". The only crawling
we do ourselves is Site Scan reading the customer's own site.
**Status:** Site Explorer went live 2026-10-07; `HANDOFF.md` lists backlinks depth, keyword depth, rank
tracking configuration, AI visibility and reports as still to do, and the building session did not
verify the pages in a browser. In the recording environment the page reads "Rank tracking is being
switched on" (no data source there). **Nothing about SEO is filmed until the owner says the upgrades
are finished** — `brand-vs-ahrefs-semrush` is a script only.

### 3b. The five named competitors, and CompanyCam

| Product | What it is | Published starting price and what that tier has | Covers, per its own pages | Not on the pages fetched | Genuine strengths |
| --- | --- | --- | --- | --- | --- |
| **Ahrefs** — https://ahrefs.com/pricing **(D)**; https://ahrefs.com/big-data **(S)** | A dedicated SEO suite built on its own crawler and index. | **Lite "$ 129 / mo"**: "5 projects", "6 months of historical data", "750 tracked keywords", "100,000 crawl credits", "1,000 credits per user", "1 user included", "Add 2 more users at $40/mo each". Standard "$ 249 / mo" (20 projects, 2,000 tracked keywords, unlimited credits per user). Advanced "$ 449 / mo". Enterprise "$ 1,499 / mo — Annual commitment required". **Starter "$ 29 / mo"** ("See what people search and spy on competitors") and **"Ahrefs Free"** ("Get Ahrefs data on your site and fix what matters"). Annual saving reported as 17% (S). | Dashboard, Site Explorer, Keywords Explorer, Site Audit, Rank Tracker, Brand Radar / AI prompts, Web Analytics, Content Explorer and Batch Analysis (Standard), API and MCP access. | A permit directory, a CRM, Google Business Profile management, review requests. | **Its own index, at a scale we do not have and do not claim**: the page reports "5 M Pages crawled every minute", "493.9 B" pages, "28.7B" keywords across "217 Locations", "16 YR" of history (S). Years of historical data, far higher limits, a free tier for your own site, and a $29 entry plan. For anyone whose job is SEO, Ahrefs is the deeper tool. |
| **Semrush** — https://www.semrush.com/pricing/ **(D)** | A dedicated SEO and marketing suite with its own databases. | **"SEO" plan: "$ 139" monthly, or "$ 117 . 33 /mo billed annually"** — "For freelancers and small businesses looking to grow their online visibility with SEO"; "5 websites to monitor"; 500 keywords tracked daily (S). Starter "SEO + AI Search" $199 ($165.17 annual); Pro+ $299 ($248.17); Advanced $549 ($455.67). **"Free. $0 /mo For trying out the platform"**: "1 demo project", "10 reports per day". "Additional Users Starting at $ 45 /mo". **Local toolkit pricing: not verified** (https://www.semrush.com/local-business/pricing/ returned no prices to the fetch). | Keyword research, position tracking, site audit, AI search monitoring, content optimisation (Pro+), API (Advanced), reporting add-ons. | A permit directory, a CRM. Local / Google Business Profile tools exist as a separate toolkit — not verified here. | Daily rank tracking (ours is weekly), a very broad toolset beyond SEO, a free tier, deep historical data. Database sizes: not verified (its stats page gave no numbers to the fetch). |
| **Jobber** — https://www.getjobber.com/pricing/ **(S)**; https://www.getjobber.com/features/ **(S)** (direct download refused, HTTP 403) | Field-service software: quotes, scheduling, invoicing, payments. | **Core: $49/mo with no commitment, $39/mo on a 1-year commitment, $29/mo paid annually; 1 user.** Core: online booking and scheduling, quotes, invoicing, online payments, a website. Connect $139 / $119 / $99 (1 user). Grow from $199 / $169 / $149. Plus from $499 / $439 / $399. | Quotes with online approval ("Customers can approve or request changes to quotes online"), scheduling, invoices, payments, client hub, review requests ("Jobber automatically asks your customers for reviews"), "Connects to Google Business Profile", website builder, Marketing Suite "$99/mo", Receptionist "$29/mo". "Store and organize unlimited photos and videos" on Plus. | A permit directory, county property records. | Very mature; "100+ app integrations"; native apps; three billing options; **an entry price at or below ConstructHUB CRM Basic** ($29 paid annually vs our $348/yr = $29/mo; $49 vs our $39 month to month). Not a like-for-like tier: Jobber Core has a website and online booking that CRM Basic does not. |
| **Housecall Pro** — https://www.housecallpro.com/pricing/ **(D)**; https://www.housecallpro.com/features/ **(S)** | Field-service software for home-service pros. Page title: "Housecall Pro Pricing & Plans \| From $59/mo — 14-Day Free Trial". | **Basic: "$79 /mo" monthly, "$59 /mo (Billed annually)", "1 user included".** Essentials "$189 /mo" / "$149 /mo", "5 users included". Max "$329 /mo" / "$299 /mo", 8 users; "$35/mo per additional user" (S). A promotion was also showing ("$26 /mo for 1 month"; Max "$99 /mo for 3 months"). "All prices are in USD and are exclusive of sales tax". | Scheduling and dispatch, quotes, invoices and payments, online booking, review management, price book, job costing (S); photo reports (Essentials, S); customer portal; website and "CSR AI" call answering as add-ons (S). | A permit directory, county property records. | Mature dispatch with routes, route optimisation and GPS tracking, QuickBooks sync, financing, native apps, a large community. **Our CRM prices were set at half of these list prices** (`shared/crm-plans.ts:9-15`) with the same seat counts — and with a shorter feature list. |
| **Leap** — https://leaptodigital.com/pricing/ **(D)**; https://leaptodigital.com/ and /leap-crm/ **(S)**. Confirmed the right company: Leap to Digital, "Leap CRM" and "Leap SalesPro", for roofing, remodeling, windows and doors, siding, kitchen and bath. | A contractor CRM plus an in-home sales and estimating app. | **Leap CRM Essential: "Get Started for $79 /month", "Single-User Only", "Limit 1 User Per Account", "Start Your 14 Day Free Trial".** Team: "Starting at $298 /month", "Includes First User and $99 per/mo per add. user". **SalesPro Premium: "Starting at $750 /month", "Includes 6 Users".** Enterprise: contact sales. | "Lead & Customer Management", "Digital Estimates & Proposals", "Dynamic Contracts", "Digital Signatures", "Invoicing", Leap Pay payments, "Appointment Calendar", "Customer & Subcontractor Portal", "Workflow Automations", "Text Messaging", financing, reporting; "Available on desktop, Android, and iOS devices" (S). Integrations named: ABC Supply, Angi Leads, CompanyCam, EagleView, GreenSky, QuickBooks, QXO, SRS Distribution (S). | Permits, Google Business Profile, reviews, SEO or marketing tools. | A purpose-built in-home sales presentation and contract tool (SalesPro) that ConstructHUB has no equivalent of; supplier and measurement integrations; financing; native Android and iOS apps; a subcontractor portal. Its site says "the majority of the nation's top one hundred contractors already rely on Leap" — their claim, not checked. |
| **CompanyCam** (JobCam angle) — https://companycam.com/pricing **(D)**; /features **(S)** | Job-site photo and video documentation: "Document every job. Never lose proof of work." | **Core "63 /month", "1 User Included", "Additional Users: $ 29 each", shown with "Billed Annually"** and a "Monthly / Annual save 20%" switch. Crew "129 /month" (3 users); Scale "199 /month" (3 users). Month-to-month amounts **not verified**. Marketing Suite add-on: figures "99" / "79" shown, unit not verified. | Photos and video, reports, checklists, proposals (Crew), agreements (Scale), "Personalized price book & invoicing", "Collect payment on-site (US-based companies)"; Marketing Suite: "Google review management", "Two-way Google Business Profile sync". | A lead pipeline, a scheduling calendar, a permit directory. | "Unlimited cloud storage" (S) against JobCam's 5 GB; offline capture; LiDAR room measuring; integrations with other CRMs (Leap names it); apps in the stores. **Stronger than JobCam on storage, capture and maturity.** |

**Also looked at, one line each (2026-10-08):** Contractor Foreman — Basic "$49 per month", 1 user,
annual only (D), deep project management. Houzz Pro — Design "$99/mo", "1 User" (D), for design-build
firms. JobNimbus, AccuLynx, ServiceTitan — pricing not public (S). Buildertrend — not verified (HTTP
403). BrightLocal from $41/mo, Local Falcon from $24.99/mo, NiceJob from $75/month (all S); Podium and
Birdeye — pricing not public (S). None of their pages fetched mentions a permit-office directory.

### 3b-2. Re-read on 2026-10-08, 04:08–04:12 UTC — directly, for the comparison films

The three CRM competitors' pricing pages were read again **without a summariser** and their text saved in
`docs/brand/sources/2026-10-08/` (with the hash of each page as received): Housecall Pro and Leap with
`curl`; Jobber, whose page refuses `curl`, in a headless browser. Every figure on a card in the
`brand-vs-…` films is in those files. What changed against the table above:

- **Housecall Pro and Leap: the same figures**, now all (D). Housecall Pro's page also showed
  introductory offers ("$26 /mo for 1 month"; Max "$99 /mo for 3 months") — the films use list prices
  and say "intro offers not shown".
- **Jobber is now (D), and its page prices by team size.** "Just me": Core $49/mo ($29 billed
  annually), Connect $139 ($99), Grow $199 ($149). "2-5 people": **Connect "Includes 5 users" $199/mo**
  ($149), Grow $299 ($229), Plus $499 ($399) — Core is not offered for a team. "6-10 people": Connect
  $299, Grow $399, Plus $599, each "Includes 10 users". The "1-year commitment" middle price in the
  table above was not on the page as rendered. Add-ons listed: Marketing Suite $99/mo, Receptionist
  $29/mo, **Sales Pipeline $49/mo**.
- **A new provable pair:** five people, list price billed monthly — Jobber Connect $199 against CRM
  Essentials $94 (five seats). For one user the prices stay close ($49 against $39; the same on annual
  billing). The film says both. This is not "cheaper than Jobber".
- **A new provable contrast:** Jobber lists its sales pipeline as a $49/mo add-on; a pipeline board is
  in every ConstructHUB CRM plan. The two are not the same feature set — say "different features".
- **"Permit" appears on none of the three pricing pages.** That is the wording the films use ("it
  isn't on their pricing page") — a statement about a page on a day, never about what a product can do.

### 3c. What the research means (the honest picture)

1. **SEO.** Ahrefs and Semrush are far larger, dedicated SEO suites with their own crawlers and data.
   We are not a replacement for either, and must not sound like one. The only honest angle: *a local
   contractor gets the SEO lookups they actually use — where do I rank, what do people search, who
   links to my competitor — inside the same product as their Google listing and permit tools, on a
   plan built for agencies — Agency, $349 a month, which includes the SEO tools and $40 of SEO data; the $29 plan with $10 of SEO data is historical (new sales since 2026-10-08 get SEO on Agency only; earlier accounts are grandfathered).* Both of them also have a **free tier**,
   and Ahrefs has a $29 plan; "cheaper than Ahrefs" as a blanket claim is **false**.
2. **CRM.** Jobber, Housecall Pro and Leap all do leads, estimates with online approval, scheduling,
   invoices and payments. Jobber and Housecall Pro also sell marketing add-ons and an AI receptionist.
   "Nobody else combines CRM and marketing" is **false**.
3. **What none of the six shows on the pages fetched** is a permit-office directory or county property
   records. That, and the honesty of the links, is the differentiator that is ours.
4. **Price pairs that are provable on 2026-10-08** (list price, monthly billing, same seat count):
   CRM Basic $39 vs Housecall Pro Basic $79 (1 user); CRM Essentials $94 vs $189 (5 users); CRM Max
   $164 vs $329 (8 users). CRM Basic $39 vs Leap CRM Essential $79 (1 user). Against Jobber Core there
   is **no price advantage** ($39 vs $49 month to month; $348 vs $348 a year). In every pair the
   feature lists differ, and a pair may only be shown with that said.
5. **JobCam vs CompanyCam** is a comparison we lose on depth; the only true line is "the camera is
   inside the CRM, filed to the same job as the estimate and the invoice".

---

## 4. Legal and safety note (plain words; this is not legal advice)

**The rule for comparative advertising in the US** (FTC Act s.5; Lanham Act s.43(a); the FTC's
long-standing statement on comparative advertising): you may compare yourself with a named competitor
if the comparison is **truthful, not misleading, substantiated before you publish, and current**. The
competitor can sue over a false or misleading comparison, and "it was true when we filmed it" is weak
if the price changed three months ago and the video is still up.

- **Substantiate first.** Keep a dated copy of the page behind every number (the fetches behind
  section 3 are a start; take a screenshot of each page on the day of publishing and keep it).
- **Compare like with like, and say what differs.** A price pair with different features is
  misleading unless the difference is stated.
- **Names are trademarks.** You may use a competitor's **name in plain text** to identify it. Do not
  use its logo, app icon, colours, screenshots or footage of its product, and do not imitate its
  branding. No "vs" thumbnail that puts their logo beside ours. Add "X is a trademark of its owner;
  ConstructHUB is not affiliated with X" to the description.
- **Prices carry a date and a source.** Any competitor price on screen: "as of October 2026, from
  [company]'s pricing page", with the URL in the description. Set a reminder to re-check every 90
  days and unlist the video if it has gone stale.
- **No disparagement.** State facts ("their page lists…"); never motives or quality judgements.
- **Google.** Do not imply partnership or endorsement (the API approval says so). No Google logos; say
  "your Google Business Profile".
- **Government data.** State permit coverage only as the site states it. Never "official",
  "government-approved" or "every permit".
- **Platform rules.** YouTube's spam, deceptive-practices and misleading-metadata policies cover titles,
  thumbnails and descriptions that promise what the video does not show. Meta's (Instagram) and
  TikTok's advertising policies both require that claims — and comparative claims in particular — be
  substantiated and not misleading, and both restrict using another brand's marks in ads. If a cut is
  **boosted as a paid ad**, the stricter ad policies apply, not just the community rules. (The platforms' policy pages were not re-read for this document — read the current text before boosting a cut.) Results
  claims ("get more leads", "rank higher") need proof we do not have.
- **Testimonials and numbers.** No customer counts, savings or results until there are real, consented
  ones on file.

**Safe to publish without a lawyer (recommended now):**

- Category-level comparisons: "instead of one app for photos, another for estimates and a third for
  your Google listing…".
- Feature checklists of **our own** product, each line from section 1.
- Our own prices, in on-screen text or the description, with "as of October 2026".
- Differentiators D1–D9 in the wording given.

**Needs the owner's explicit sign-off (and ideally a lawyer's read) before recording or publishing:**

- Any video, thumbnail, title or description that **names** a competitor.
- Any competitor **price** on screen or in narration.
- "Half the price of…" in any form.
- Anything from the "did not survive" list.
