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
| Starter (`:126`) | $29 | $290 | 1 Google Business Profile location · Profile Guard edit alerts · review alerts, AI reply drafts · 5 ranking-grid credits · 2 Site Scans · 100 permit searches / month · SEO data $10 / month |
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

**CRM** — `shared/crm-plans.ts:100-169`; 14-day trial (`CRM_TRIAL_DAYS`, line 178).

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
| SEO (Site Explorer, rank tracking, keywords, backlinks) | Look up any domain's authority, backlinks, keywords and competitors; track rankings. | **Partly live.** Site Explorer shipped 2026-10-07; "Still to do: backlinks full depth → keyword research full depth → rank tracking → AI visibility → reports" (`HANDOFF.md:60-62`). | Sold as data credit: $10 / $20 / $40 / $40 a month in the plan, then prepaid packs. | **Never name the data vendor.** Do not film until the upgrades are finished (owner). |
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
| D1 | A permit-office directory and a county property-records directory sit in the same product as the marketing tools. None of the nine job-software competitors' pricing or feature pages fetched for section 3 mentions a permit-office directory or county records (Contractor Foreman lists "permits" as a project record, which is a different thing). | `/databases`, `/property`; section 3 | "ConstructHUB also has something most contractor software doesn't: a directory of permit offices and county property records." — "most", because nine products were checked, not all. |
| D2 | Portal links are checked, unconfirmed ones are labeled, and a missing one becomes a web search, never an invented address. | `CLAUDE.md` hard rule; `scripts/verify-links.ts`; live /features/permits "Checked links, never guessed"; `linkStatus` in `server/data/permit-portals.json` (10,082 verified · 2,482 unconfirmed · 508 none · 3 dead in the file) | "Every link is checked. If we couldn't confirm one, it says so. If we don't have one, you get a web search — not a guess." |
| D3 | The two directories open without an account. | live /features/permits ("Not ready to sign up? Browse the Database Directory"), /features/property ("The directory also opens without signing in") | "You can browse the permit directory before you sign up." |
| D4 | Prices are public, for every plan, with a "Not included" list on every card. | live /pricing; `notIncluded[]` in both price books | "Every plan shows its price and what it does not include." |
| D5 | Two products, bought separately. | `shared/crm-plans.ts:4-7` | "Buy the Business tools, the CRM, or both. You're never made to buy both." |
| D6 | The CRM starts at $39 a month with one seat. | `shared/crm-plans.ts:102` | "The CRM starts at $39 a month." (YouTube description / on-screen text only — never in narration, the test suite forbids a spoken price, and prices change.) |
| D7 | Job photos live in the same CRM as the estimate, the schedule and the invoice. | JobCam is a CRM feature filed to the project (`/crm/jobcam`) | "Job photos are filed to the same job as the estimate and the invoice." Add honestly: "JobCam is part of the top CRM plan, or an add-on." |
| D8 | Online payments go to the contractor's own Stripe account and ConstructHUB adds no fee of its own. | help entry `crm-payments`; live /features/crm | "Card and bank payments go straight to your own Stripe account. ConstructHUB adds no fee on top of Stripe's." |
| D9 | One company covers permit lookup, the Google listing, reviews, a website scan, a CRM and job photos. | sections 1b, 1c | "Permits, your Google listing, reviews, estimates, scheduling, invoices and job photos — from one company." |

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
- Customer counts, time saved, revenue gained, "#1", "best", "only", "guaranteed" — nothing in the repo
  substantiates any of them. Forbidden.
- "Works on iPhone app" — not in the App Store.

---

## 3. Competitors — their own pages, fetched 2026-10-08

Method: each pricing page was fetched on **2026-10-08**. Where the raw HTML could be downloaded
directly, the prices below were read from the page text; where the site refused a direct download,
the page was read through a fetch-and-summarise tool, which is marked **(S)** — treat an (S) figure as
"reported by the page on that date, re-read by a person before use". "Not on the page" means only
that: the page fetched does not mention it — the product may still do it.

| Product | What it is (its own words / page) | Published starting price, and what that tier has | Covers, per its own pages | Does not appear on the pages fetched | Genuine strengths |
| --- | --- | --- | --- | --- | --- |
| **CompanyCam** — https://companycam.com/pricing | Job-site photo and video documentation: "Document every job. Never lose proof of work." | **Core $63/month, 1 user**, shown with "Billed Annually" and a "Monthly / Annual save 20%" switch; extra users "$29 each". Crew $129/month (3 users), Scale $199/month (3 users). Month-to-month amounts **not verified** (the page's script also carries $79 and $249, which would be 20% more — not confirmed on screen). Core: "Timestamped photos & videos", "Turn job photos into reports", "Collect payment on-site (US-based companies)", "Personalized price book & invoicing". | Photos / video, reports, checklists (Crew), proposals (Crew: "Create proposals using voice notes and photos"), agreements (Scale: "Send, sign, and store agreements"), invoicing and on-site payment. **Marketing Suite** add-on (figures "99" / "79" shown; unit not verified): "Google review management", "Two-way Google Business Profile sync". | Lead pipeline / CRM, scheduling calendar, permit directory, property records. | Purpose-built camera with years of field use; "Unlimited cloud storage" (features page, (S)); offline capture; LiDAR room measuring (Scale); integrations with other CRMs; native apps in the stores. **Stronger than JobCam on storage, capture features and maturity.** |
| **Jobber** — https://www.getjobber.com/pricing/ **(S)** (direct download refused, HTTP 403) | Field-service software: quoting, scheduling, invoicing, payments. | **Core: $49/mo with no commitment, $39/mo on a 1-year commitment, $29/mo paid annually; 1 user** (S). Core: online booking and scheduling, quotes, invoicing, online payments, a website. Connect $139 / $119 / $99; Grow from $199 / $169 / $149; Plus from $499 / $439 / $399 (S). | Quotes with online approval, scheduling, invoices, payments, client hub, review requests, "Connects to Google Business Profile", website builder, Marketing Suite "$99/mo" add-on, Receptionist "$29/mo" (features page, (S)). "Store and organize unlimited photos and videos" on Plus (S). | Permit directory, property records. | Very mature product, large integration list ("100+ app integrations"), native apps, three billing options, an entry price **below** ConstructHUB CRM Basic when paid annually. |
| **Housecall Pro** — https://www.housecallpro.com/pricing/ | Field-service software for home-service pros. Page title: "Housecall Pro Pricing & Plans \| From $59/mo — 14-Day Free Trial". | **Basic: $79/mo monthly, $59/mo "(Billed annually)", "1 user included".** Essentials $189 / $149, "5 users included". Max $329 / $299, 8 users; "$35/mo per additional user" (S). Promotional first-month prices were also showing ("$26 /mo for 1 month"). "All prices are in USD and are exclusive of sales tax". | Scheduling and dispatch, quotes, invoices and payments, online booking, review management, price book, job costing; photo reports (Essentials); customer portal; website and "CSR AI" call answering as add-ons (S). | Permit directory, county property records, Google Business Profile management. | Mature dispatch and routing (route optimisation on Max), GPS tracking, QuickBooks sync, financing, native apps, a large user community. |
| **Contractor Foreman** — https://contractorforeman.com/pricing/ | Construction management software. Its own claim on the page: "the most affordable project management software for contractors". | **Basic $49 per month, 1 user, billed annually ("then pay $588 annually at renewal"); 30 days free.** Standard $105/mo annual or $139 monthly (3 users); Plus $166 / $199 (8); Pro $221 / $279 (15); Unlimited $332 / $399. Basic is "Available for Annual" only. | Estimates, invoices, online payments, scheduling, client portal, time cards, daily logs, photos, **permits as a project record**, leads/CRM (S for the feature list). | Marketing tools, Google listing, reviews, a permit-office directory. | Very broad construction project management (daily logs, time cards, safety, submittals), unlimited-user tier, long money-back guarantee. Far deeper project management than ConstructHUB. |
| **Houzz Pro** — https://www.houzz.com/houzz-pro/pricing | Software for design and build firms. | **Design "$99/mo", "1 User"**: 3D floor plans, selections, mood boards, CRM, estimates and proposals, invoices, online payments. Pro "$199/mo" (1 user): takeoffs, bids, change orders, budget, contracts, schedule, daily logs. Teams "Starting at $399/mo", unlimited users. Extra users "$50/user/mo". Advertising "Starting at $499/mo". A free plan is mentioned. Annual prices not shown. | CRM, estimates, invoices, payments, schedule, client dashboard, email marketing and website (Teams), advertising on Houzz. | Permit directory, Google listing tools, reviews on Google. | 3D floor plans, takeoffs, a homeowner marketplace that brings leads. Aimed at designers and remodelers. |
| **JobNimbus** — https://www.jobnimbus.com/pricing **(S)** | CRM and project management, roofing-led. | **Pricing not public** — "Request pricing" under each plan. Plans: Essentials (up to 3 users), Pro (up to 10), Premium (up to 19), Enterprise. | Contacts, estimates, eSign, invoices, payments, financing, supplier and QuickBooks integrations; a Marketing Bundle add-on. | Permit directory. | Deep roofing workflow and supplier integrations. |
| **AccuLynx** — https://acculynx.com/pricing/ **(S)** | Roofing business software. | **Pricing not public** — a request form. | CRM, estimates, document automation, AccuPay, crew scheduling, field app (from the page's navigation). | Not verified. | Roofing-specific depth (not verified beyond the navigation). |
| **ServiceTitan** — https://www.servicetitan.com/pricing **(S)** | Software for larger trades businesses. | **Pricing not public** — "Request Pricing"; priced "per-technician". Plans: Starter, Essentials, The Works. | Dispatching, scheduling, call booking, invoicing, pricebook; estimates and payroll on higher plans. | Not verified. | Built for large multi-truck operations. Not a like-for-like comparison with ConstructHUB. |
| **Buildertrend** — https://buildertrend.com/pricing/ | — | **Not verified.** The site refused every fetch (HTTP 403) on 2026-10-08. | Not verified. | Not verified. | Not verified. Say nothing about it. |

**Marketing side — what small contractors use for Google listing, reviews and local rank.**

| Product | What it is | Published starting price | Notes |
| --- | --- | --- | --- |
| **BrightLocal** — https://www.brightlocal.com/pricing/ **(S)** | Local SEO: rank tracking, geo-grid, citations, Google Business Profile audit, reviews. | Track **$41/mo** for 1 location ($369/yr); Manage $54; Grow $65 (adds review monitoring and collection). Price rises with locations. | Deep, specialised local-SEO tooling. |
| **Local Falcon** — https://www.localfalcon.com/pricing **(S)** | Geo-grid rank tracking on Google Maps. | Starter **"$24.99 billed monthly"**, 7,500 credits (one credit = one map pin). | A specialist at the thing our Ranking Grid does; far more scans for the money than 5 grid credits. |
| **NiceJob** — https://get.nicejob.com/pricing **(S)** | Review requests and reputation. | Starter **$75/month**; Pro $125/month; managed website $99/month + $199 setup. | — |
| **Podium** — https://www.podium.com/pricing **(S)** | Reviews, texting, payments. | **Pricing not public** — "talk to our sales team for details". | — |
| **Birdeye** — https://birdeye.com/pricing/ **(S)** | Reviews, listings, social. | **Pricing not public** — a form. | — |

**What the research means for us (the honest picture).**

1. The big field-service products already bundle more than they used to: Jobber, Housecall Pro and
   CompanyCam each sell a marketing add-on, and two sell an AI receptionist. "Nobody else combines
   CRM and marketing" would be **false**.
2. What none of the nine job-software pages shows is a **permit-office directory or county property
   records**. That, and the honesty of the links, is the differentiator that is ours.
3. On price, three pairs are provable from the pages on 2026-10-08, monthly billing, list price:
   CRM Basic $39 vs Housecall Pro Basic $79 (both 1 user); CRM Essentials $94 vs Essentials $189
   (both 5 users); CRM Max $164 vs Max $329 (both 8 users). The tiers were built to mirror Housecall
   Pro's seat counts (`shared/crm-plans.ts:9-15`) — **but the feature lists are not the same**, and
   Housecall Pro was running a first-month promotion. Jobber's entry plan is cheaper than ours on
   annual billing.
4. JobCam vs CompanyCam is a comparison we lose on depth (storage, capture features, apps) and can
   only make on "it is inside the CRM, for $39 more".

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
