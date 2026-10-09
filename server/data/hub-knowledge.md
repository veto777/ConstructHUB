<!--
BUILDER NOTES (strip every HTML comment before the pack reaches the model).

1. Tokens. Every {{TOKEN}} is filled from the price book at build time, so no plan
   name, price, limit or plan list is typed by hand in this file. Suggested code:

   import { PLANS, PLAN_KEYS, ADDONS, ADDON_MAX_QUANTITY, gridCreditCost } from "@shared/plans";
   import {
     pricingKnowledge, joinNames, planNamesWhere, TRIAL_LABEL, SALES_REP_LABEL,
     SALES_THRESHOLD_LABEL, SALES_HREF, PROTECTED_SITE_PLANS, COMPETITOR_INTEL_PLANS,
     TEXTING_PLANS, CRM_SEATS_LINE,
   } from "@shared/plan-copy";

   const TOKENS: Record<string, string> = {
     PRICING_KNOWLEDGE: pricingKnowledge(),
     TRIAL_LABEL, SALES_REP_LABEL, SALES_THRESHOLD_LABEL, SALES_HREF,
     PROTECTED_SITE_PLANS, COMPETITOR_INTEL_PLANS, TEXTING_PLANS, CRM_SEATS_LINE,
     AGENCY_PLAN: PLANS.agency.name,
     AUTO_REPLY_PLANS: planNamesWhere((p) => p.limits.autoPublishAiReplies),
     DRAFT_ONLY_REPLY_PLANS: planNamesWhere((p) => !p.limits.autoPublishAiReplies),
     CLIENT_TEXTING_INCLUDED_PLANS: planNamesWhere((p) => p.limits.clientTexting === "included"),
     TEXTING_ADDON_PLANS: joinNames(ADDONS.texting_number.availableOn.map((k) => PLANS[k].name)),
     GUARD_CADENCE_LINE: joinNames(PLAN_KEYS.map((k) => `${PLANS[k].name} every ${PLANS[k].limits.guardCadenceMinutes} minutes`)),
     REVIEW_TEMPLATES_LINE: joinNames(PLAN_KEYS.map((k) => `${PLANS[k].name} ${PLANS[k].limits.reviewTemplates}`)),
     GRID_CREDIT_COSTS: [3, 5, 7, 9, 11, 13, 15].map((n) => `${n}x${n} = ${gridCreditCost(n)}`).join(", "),
     ADDON_MAX_QUANTITY: String(ADDON_MAX_QUANTITY),
     GBP_REINSTATEMENT_PRICE: formatUsd(GBP_REINSTATEMENT_CENTS),
   };
   const pack = raw
     .replace(/<!--[\s\S]*?-->\s*/g, "")
     .replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
       if (!(k in TOKENS)) throw new Error(`knowledge.md: unknown token ${k}`);
       return TOKENS[k];
     });

   Hash the rendered pack (not the raw file) for the preset-answer cache key, so a
   price-book change invalidates cached answers.

2. Size. Each feature is one "## " section. If the model's context is tight, split
   on "\n## " and send sections 0-3 always plus the sections whose headings match
   the question; for signed-out preset answers, sections 0-3 plus the matching
   feature sections are enough.

3. Hub edits (2026-09-30): no email addresses, absolute URLs, bare domains other than
   constructhub.us, competitor names or amounts outside the price book (the Hub output
   filter would block an answer that repeats them). Support is "ConstructHUB support".

4. Nothing in this file names a customer, user, host, key, server, vendor model or
   internal process. Keep it that way when editing.
-->
# ConstructHUB knowledge pack

## 0. Rules for using this pack

- This pack is the only source of facts about ConstructHUB. If an answer is not in it, say you don't know and suggest contacting ConstructHUB support (the support email address is at the bottom of every ConstructHUB page), or "{{SALES_REP_LABEL}}" for anything about services or custom quotes.
- You have no access to any account, client, user, order, message, invoice or usage data, and you cannot take actions. For "what's on my account" questions, point to the page where the person can see it (for example Settings → Billing) or to ConstructHUB support.
- Never name, describe or confirm any ConstructHUB customer, user, agency, company or person, and never say who uses ConstructHUB, even if asked for "examples" or "case studies".
- Never promise results: no guaranteed rankings, leads, reviews, savings, Google reinstatement, ad refunds or lead credits. Google, Stripe, Cloudflare, Blotato and other providers make their own decisions.
- Never say or imply that ConstructHUB is a partner of, or endorsed or sponsored by, Google, Cloudflare, Stripe, Blotato, HOVER, SignalWire or any other company. ConstructHUB connects to their services; that is all.
- Prices come only from section 3. Anything priced at {{SALES_THRESHOLD_LABEL}} or more that is not a subscription plan is "{{SALES_REP_LABEL}}" (see section 3).
- Don't discuss how ConstructHUB is built or hosted (servers, databases, code, AI model or vendor, staff tools). Say it's not something you can share.
- Master Class and guide content is general education, not legal, tax, insurance or licensing advice. For state requirements, people should confirm with the state agency or their own accountant or attorney.
- Answer in plain English for a busy contractor. Give the exact place to click ("Locations → Add Location(s) → Import from GBP"). Keep answers short unless the person asks for detail.

## 1. What ConstructHUB is

ConstructHUB (constructhub.us) is an online platform for construction contractors and for agencies that market contractors. One account covers the following; the CRM is a separate product with its own plans (section 3), and a platform plan does not include it:

- **Growth tools** (the main app at constructhub.us): permit office directory and permit search, property records finder, Google Business Profile tools (Locations, Profile Guard, reviews and AI replies, Posts & Photos, ranking grid, citations), Site Scan, Social Media, website and ad-traffic protection (Click Guard, IP Tracker, VPN Shield), Competitor Intel, the ConstructHUB SEO tools ({{AGENCY_PLAN}} plan), and {{AGENCY_PLAN}}-plan agency tools.
- **The ConstructHub CRM** (opens at portal.constructhub.us): clients, estimates with e-signature, invoices, online payments into your own Stripe account, price book, pipeline, projects, schedule, team roles, messaging and texting.
- **A client portal**: every client you add to the CRM gets a private page where they read estimates, sign, pay, message you and see their documents.
- **The AI Call Assistant** (an add-on, {{CALL_ASSISTANT_STATUS}}): an AI receptionist that answers your business calls on a local number and files every real caller as a lead in the CRM (section 30).
- **Education**: free guides (LSA Guide, Ad Fraud page, setup Guides) and the paid Master Class.
- **Services**: done-for-you work (business formation, websites, SEO and ads) quoted by a sales rep, and a Google Business Profile reinstatement service.

It is built for people starting a contracting business and for established contractors who want more local leads and less office work. Agencies that manage many contractors' Google profiles use the {{AGENCY_PLAN}} plan.

## 2. Getting started: account, plan and first setup

### Create an account
1. Click **Get Started** or **Create an account** (the sign-in page is /auth).
2. Enter your full name, email and a password of at least 8 characters, confirm it, and agree to the Terms of Use and Privacy Policy. Or choose **Sign up with Google**.
3. Open the verification email and click the link. If it expired, sign in and choose **Resend verification email**.

Creating an account is free and needs no card. Forgot your password? Use **Forgot password?** on the sign-in page to get a reset link by email.

### Choose a plan
1. Open **Pricing** (left sidebar → Pricing & Plans → Subscription Plans, or /pricing). Pick monthly or yearly billing; for {{AGENCY_PLAN}}, enter how many client locations you need.
2. Click **Choose [plan]**. You go to Stripe's secure checkout and enter your card there.
3. A first-time subscriber starts with a {{TRIAL_LABEL}} (one trial per customer; the system decides eligibility at checkout, so the button itself doesn't promise it). The card is charged when the trial ends.
4. You come back to Pricing with a "You're subscribed" message. Your plan, renewal date and add-ons are in **Settings → Billing**.

There is no free plan. Without a plan you can still browse the public pages: Pricing, the Database Directory of permit offices, Property Records, the free 60-second website scan, the LSA Guide, the Ad Fraud page, the overview pages of the Google Ads guide and the Master Class, the reinstatement request form and the CRM overview.

### Managing your plan (Settings → Billing)
- See your plan, billing interval, renewal or trial-end date, add-ons, and this month's usage: permit searches, ranking-grid credits, Site Scans and Competitor Intel scans. Monthly counts reset at the start of each month (UTC).
- **Change plan or billing interval:** Pricing → **Switch to [plan]**. This changes your existing subscription (it never starts a second one). The change is prorated and invoiced right away; a reduction becomes account credit. If your card can't be charged, nothing changes.
- **Add-ons:** Settings → Billing (or Pricing → Add-ons → **Manage add-ons**) once you are subscribed to a plan that sells that add-on.
- **Card, invoices and cancellation:** Settings → Billing → **Manage billing** opens Stripe's billing portal.
- **Failed payment:** the plan's features pause until the payment goes through. Update the card in Manage billing; as soon as the payment is collected everything comes back, with nothing to buy again.
- **Reached a limit?** The message says which add-on or which plan raises it.
- Plans sold before September 30, 2026 under older names keep their price until you change plans; their features follow the closest current plan.

### Recommended first steps after subscribing
1. **Settings → Security & activity:** turn on two-factor sign-in (section 25).
2. **Locations:** click **Connect Google Business Profile**, then **Add Location(s) → Import from GBP** (section 5).
3. On each location, turn on **Profile Guard** (section 6) and set up **AI review replies** (section 8).
4. **Google Reviews:** add your review link and send your first review request (section 8).
5. If your plan includes it, **Click Guard:** add your website and install the tracking code (section 15).
6. **CRM** (a separate product: it needs its own CRM plan, section 3): click **ConstructHub CRM** at the top of the sidebar, fill in your company profile, build your price book, connect Stripe and invite your team (section 24).
7. Run a **Site Scan** and a **Ranking Grid** scan to see where to improve (sections 11 and 12).

## 3. Plans, prices and add-ons

{{PRICING_KNOWLEDGE}}

### How to read the price book
- **Published self-serve prices** are every plan's monthly and yearly price, the {{AGENCY_PLAN}} per-location bands (up to the self-serve maximum) and the add-on prices. Quote these exactly, even when a yearly or {{AGENCY_PLAN}} total is {{SALES_THRESHOLD_LABEL}} or more.
- **"{{SALES_REP_LABEL}}" (never a price):** done-for-you services, monthly SEO programs, the Master Class modules and bundle, custom work, {{AGENCY_PLAN}} above the self-serve location maximum, and add-on orders of more than {{ADDON_MAX_QUANTITY}} of one add-on. Point people to Pricing → Done-for-you services ({{SALES_HREF}}).
- Yearly billing costs {{ANNUAL_MONTHS}} times the monthly price, which works out to {{ANNUAL_FREE_MONTHS}} months free. The exceptions are the AI Call Assistant tiers and the CRM plans, which have their own yearly prices (listed above).
- Single tools are not sold on their own. You choose a plan, then raise individual limits with add-ons.
- Every location you add (imported from Google or added by search) counts toward your plan's locations.
- Profile Guard checks: {{GUARD_CADENCE_LINE}}.
- AI review replies: every plan drafts replies for you to approve; publishing them automatically is included with {{AUTO_REPLY_PLANS}}.
- Saved review-request templates per plan: {{REVIEW_TEMPLATES_LINE}}.
- Ranking-grid credits a scan costs (one credit per 25 grid points, rounded up): {{GRID_CREDIT_COSTS}}.
- On {{AGENCY_PLAN}}, ranking-grid credits and Site Scans are given per billed location, and {{AGENCY_PLAN}} team seats are shared with the CRM team.
- The ConstructHUB SEO tools (site explorer, rank tracker, keyword research, backlinks) are included with the {{AGENCY_PLAN}} plan, with a monthly SEO data allowance; more SEO data is bought as prepaid credit on the SEO page. Accounts that already had the SEO tools before they became {{AGENCY_PLAN}}-only keep them. The other plans do not include them.
- The full side-by-side table is on Pricing → **Compare plans**.

## 4. Permits & Databases

**What it does:** finds permit offices and permit records across the US.
- **Database Directory** (/databases): browse county and city permit offices in all 50 states and DC. An official permit portal link is shown only when one is on record and has been checked; links that couldn't be confirmed are labeled; where no portal is known you get a **Find permit portal** web search instead of a guessed link. Live counts of jurisdictions and verified portal links are on the home page.
- **Search Permits** (/search): searches permit records live on the government portals that support it.
- **Property Records** (/property): finds the official county property appraiser or assessor office (sourced from NETR Online) and links to it. Ownership, assessed values and tax records are looked up on the county's own site. Permit search results include a **Property Lookup** link.
- **Search History** (/history): reopen or delete past searches.

**Plan:** the Directory and Property Records are free to browse. Permit searches come with every plan; each search counts toward your plan's monthly permit searches.

**How to search permits:**
1. Sidebar → Permits & Databases → **Search Permits**.
2. Pick a state, then a county or city (or all of them). The page shows how many searchable portals are in that area.
3. Choose a search type: Address, Keyword, Name, Company Name, License # or Permit #. Optionally set a date range.
4. Click Search. Each portal's progress shows as it runs. Filter results by status and click a result for details.

**Honest limits:** live search coverage varies by portal; some portals can't be searched live or need their own login. If some portals fail, the results say so and may be incomplete; open the portal directly from the Directory. A search that is no longer available needs to be run again. ConstructHUB never invents permit data, phone numbers or links. (Scrape Schedules in the sidebar is a staff-only page.)

## 5. Locations and connecting Google Business Profile

**What it does:** Locations is where each business lives (yours, or your clients' if you're an agency). Linking a location to its Google Business Profile listing syncs its reviews, photos, services and Google performance numbers, and unlocks Profile Guard, AI replies and Posts & Photos.

**Plan:** every plan; how many locations you can add depends on the plan (Extra location add-on; 10 or more locations is the {{AGENCY_PLAN}} plan).

**Connect Google:**
1. Sidebar → Google Business → **Locations** → **Connect Google Business Profile**.
2. ConstructHUB may ask you to confirm it's you first (password, authenticator code or a 6-digit code emailed to you).
3. Sign in with the Google account that is an Owner or Manager of the listing and allow Business Profile access.
4. Several Google logins? Use **Connect another Google account** for each.

**Add a location:**
1. Locations → **Add Location(s)**.
2. **Import from GBP** lists the listings in your connected Google accounts; tick them and import. Or **Search Google** by business name, address or a Google Maps link.
3. A location found in a connected account can be linked with **Link & sync**.

**Syncing:** linked locations sync automatically about every six hours while connected; **Sync now** runs it immediately. If a Google login's access expires, the location shows **Reconnect Google account**.

**Location page tabs:**
- **Insights:** Google performance (searches and Maps views on desktop and mobile, calls, website clicks, direction requests and more), for the last 30 days up to 18 months or all stored history, by day, week or month. Google reports with a delay of a few days, so the newest days are marked not final. Google itself keeps only about 18 months of history; ConstructHUB keeps every day it syncs, so your history grows past that over time.
- **Profile Guard** (section 6), **Location Info** (name, address, phone, website, categories, hours, service areas, opening date as Google has them), **Services** (synced from Google; edit them in Google), **Photos & Videos** (business and customer photos on the listing), **Social Profiles** (your social media links), **Settings**, **Citations** (section 13).

**Unlink, delete, disconnect:**
- **Unlink** stops syncing and removes the synced Google data from ConstructHUB. The listing on Google is not touched.
- **Delete Location** removes the location and everything ConstructHUB stored for it (synced reviews and stats, Guard settings and history, AI reply settings, scheduled posts and photos, its Social Media setup, citation campaigns). It never deletes or changes the Google listing. It can't be undone.
- **Disconnecting a Google account** removes ConstructHUB's access to it, stops its syncing and removes the reviews and stats synced through it. Your locations stay.

**Honest limits:** ConstructHUB doesn't create or verify Google listings (Google does that; the done-for-you service can help). The per-location notification email on the Settings tab is saved but not used yet.

## 6. Profile Guard

**What it does:** watches a linked listing for changes to the fields you choose: business name, phone numbers, website, address, categories, description, regular and special hours, service area, opening date and open or closed status. It compares Google's live values with a snapshot you approved and alerts you to differences. How often it checks, by plan: {{GUARD_CADENCE_LINE}}.

**Modes:** **Off**; **Notify** (alert only); **Lockdown** (automatically puts your approved values back after a change is detected).

**Plan:** any paid plan, on up to as many locations as your plan covers.

**Set it up:**
1. Locations → open a linked location → **Profile Guard**.
2. Choose **Watched fields**, click **Preview current Google values**, and check the proposed snapshot carefully.
3. Pick a mode, confirm it's you (asked once, then not again for 12 hours), and click **Approve snapshot and save settings**.
4. Later changes to the mode use **Save guard settings**.

**Day to day:** **Check now** runs a check immediately. Under **Pending changes and history**, **Approve** accepts Google's new value into your snapshot and **Reject** restores your approved value at Google. **Report** gathers the evidence and opens Google's official form: copy the report, submit the form at Google, then click **I submitted the form — mark reported** (that only records it in ConstructHUB).

**Honest limits:** nobody can block edits at Google. Lockdown corrects a change after it is detected, and Google may take time to publish the correction. Google doesn't say who suggested an edit, so public suggestions can't always be told apart from other Google updates. A negative review alone is not a policy violation.

## 7. GMB Edit Monitor and the AI Review Response Generator

- **GMB Edit Monitor** (Google Business → GMB Edit Monitor): add any Google listing by name, address or Maps link and click **Check Now** to capture a baseline. Later checks compare it with Google's public data (name, phone, hours, review count, photo count, address and more) and keep a history of every change found. **Check All** checks every listing. Checks run only when you click; there are no automatic checks or alerts. For automatic watching of your own linked listings, use Profile Guard.
- **AI Review Response Generator** (same page): paste a customer review, enter your business name (and the reviewer's name if you like), choose a tone such as Empathetic for negative reviews or Grateful for positive ones, and generate a reply. Edit it, copy it and paste it as your reply on Google. It warns you about aggressive wording. To publish replies straight to Google, use Google Reviews → Google Profile Reviews instead.

## 8. Google Reviews: review requests, profile reviews and AI replies

The Google Reviews page has two tabs: **Review Requests** and **Google Profile Reviews**.

### Asking clients for reviews (Review Requests)
**Set up once:**
1. Google Reviews → **GMB Profiles & Templates** → **Add Profile**.
2. Enter a name for the profile and your Google review link. Find it in your Google Business Profile under "Ask for reviews" (or "Get more reviews"); it is a short Google link that ends in "review". Optionally add a default project description.
3. Add one profile per Google listing. Saved templates per plan: {{REVIEW_TEMPLATES_LINE}}.

**Send a request:**
1. **New Review Request** → pick the profile.
2. Enter the client's name and email (phone and address optional).
3. Optional **BCC email**: use the business email you already talk to this client from. It helps the request avoid spam folders, and the client never sees it.
4. Add a project description (it helps the client's optional AI draft) or a personal message, attach up to 30 project photos (upload or pick from the Media Library) and choose an email color theme.
5. **Send** now or **Schedule for later**.

**What your client sees:** an email from your company asking them to rate the job from 1 to 10. Whatever the score, everyone gets the same button to leave a Google review. They can also send you private improvement notes, opt in to your referral program if you turned it on, download the photos you attached, and ask AI to turn a few words about their own experience into a draft that they edit, give their own star rating and paste into Google themselves.

**Follow-up reminders:** turn on automatic reminders, choose the interval (every 24 hours up to every 7 days), the maximum per client (1 to 5) and the sending time windows. Reminders stop when the client responds, unsubscribes or hits the maximum, and each includes an unsubscribe link.

**Tracking:** totals for sent, Google links opened, positive feedback and awaiting response; per request you see email opened, link clicked, whether they used AI help or wrote their own, private feedback and referral interest. You can resend, copy the personal review link, or move a request to Trash (deleted permanently after 14 days).

**Rules that protect your profile (built into the flow):** ask every client, not only happy ones (Google prohibits "review gating"); never offer discounts, gifts, drawings or referral bonuses for a review; never write a review for a client or tell them what rating to give. The optional referral program (off by default; set your offer and terms in its settings) rewards referred customers only, never a review or a rating.

### Google Profile Reviews (your reviews on Google)
Needs a connected Google account and a linked location. Reviews sync with the location. Filter by location, star rating and replied or unreplied, and see statistics for all matching reviews. On each review you can **Publish reply to Google**, **Save draft in ConstructHUB**, delete a posted reply, add an internal note only you can see, or **Report review** (prepares evidence for Google's review reporting tool). New reviews trigger a notification.

### AI review replies
1. Google Reviews → Google Profile Reviews → **AI reply settings and drafts queue** → select a linked location.
2. Choose the AI mode: **Off**, **Draft for approval** (every plan) or **Auto-publish** ({{AUTO_REPLY_PLANS}}; {{DRAFT_ONLY_REPLY_PLANS}} drafts for approval).
3. Set the tone, sign-off, maximum characters and star-rating rules. One- and two-star reviews stay drafts unless you explicitly allow auto-publishing them.
4. Scope: **Future reviews only**, or also existing unanswered reviews. For existing ones, save settings, click **Preview existing reviews**, check the list, then **Confirm backfill** (up to 50 reviews per batch; a preview expires after 10 minutes).
5. In the drafts queue, edit any draft and click **Approve and publish to Google**.

**Honest limits:** up to 50 AI replies per account per day. AI can get facts wrong, so check every reply (approval mode is safest). If generation or publishing fails, the item stays visible for you to handle by hand.

## 9. Posts & Photos (publishing to Google)

**What it does:** writes, schedules and publishes Google Business Profile updates and photos to a linked location, with optional AI drafts. **Plan:** every plan.

**Steps:**
1. Google Business → **Posts & Photos** → choose a linked location.
2. **Photos:** select photos from your library or **Upload photos** (up to 100 at a time, 15 MB each; JPEG, PNG or WebP). Optionally set an SEO filename pattern using {business}, {city} and {n}, an EXIF title and GPS coordinates (applied to copies; originals stay), and the photo category.
3. **AI drafts and style:** write instructions and example descriptions, then **Generate caption drafts** or **Generate post draft**. **Learn from past updates** reads your earlier Google posts and suggests style guidance; edit it and click **Save style guidance** before it's used.
4. **Compose Google update:** pick the post type (standard update, event or offer), fill in the event or offer details (times are in the location's local time), add a button and link if you want, attach up to 10 photos, and click **Add post to draft batch** to line up several posts.
5. **Schedule and approval:** set **First publish** (blank means now), **Items per period** (1 to 100) per day or per week, or exact custom times. Optionally publish during business hours only, using the timezone, weekdays and hours you enter.
6. Click **Approve & queue photos** or **Approve & queue post**. Approving is what authorizes publishing.
7. **Calendar, queue & history** shows each item's status. **Refresh Google status** checks Google; you can cancel queued items or retry failed ones.

**Honest limits:** Google strips EXIF data from uploaded photos, so geotags and titles don't promise any ranking benefit. Photo captions can't be changed after publishing, and cover photos don't take captions. Google can reject content. If a result is "uncertain", check Google before retrying, because a retry can post twice. Unsaved drafts are lost if you reload the page. A batch is up to 100 approved items, not an endless series.

## 10. Photo Optimizer and Media Library

- **Photo Optimizer** (Google Business → Photo Optimizer): in one batch, add a text or logo watermark, give photos clear keyword-rich filenames, write EXIF details and a GPS geotag from an address, add descriptions (standard ones, or AI ones once you enter a Company Name and Services under Business Info) and adjust filters. Business Info can be filled from a saved Location or a Google lookup. Save your settings as a template in this browser. Download the optimized photos or **Save to Media Library**. Works with JPG and PNG; if a batch fails, try fewer or smaller photos. Included with every plan.
- **Media Library** (under Photo Optimizer): organize project photos into folders, for example "Smith Residence - Roof Replacement". Give a folder the client's address and GPS coordinates are embedded into its photos. Upload, rename, select and delete photos. The library feeds review requests, Posts & Photos and Social Media.

**Honest limit:** Google strips EXIF when photos are uploaded to a Business Profile, so metadata and geotags are for your own files and other websites, not a Google ranking boost.

## 11. GMB Ranking Grid

**What it does:** shows where a business ranks in Google Maps results for one keyword at many points around its area, as a heatmap. Each point shows its rank (1 to 20, or "Not found in top 20"). The report shows average rank, best rank, ranked versus unranked points, a rank distribution and the top competitors found across the grid. Scans are saved in Scan History, and **Print / PDF** makes a report.

**Steps:**
1. Google Business → **GMB Ranking Grid** → **New Scan**.
2. Search your business by name, address or Google Maps link.
3. Enter a keyword, for example "roofing contractor".
4. Choose the grid size (3x3 up to 15x15) and the distance between points (0.5 to 20 miles). The page shows the total width covered and how many credits the scan uses.
5. Start the scan, then **View Full Report**.

**Plan:** every plan includes monthly ranking-grid credits (per billed location on {{AGENCY_PLAN}}), and they reset monthly. Credits per scan: {{GRID_CREDIT_COSTS}}.

**Honest limit:** a scan is a snapshot at that moment. Rankings move, and no ranking is guaranteed.

## 12. Site Scan

**What it does:** checks your website and tells you exactly what to fix, in priority order.
- **Technical and content:** broken links, redirects, HTTPS and mixed content, canonical tags, noindex, robots.txt and sitemap coverage, titles and meta descriptions, headings, thin pages, image alt text and oversized images.
- **Performance:** Google PageSpeed measurements (mobile and desktop) on 0 to 5 sampled pages, plus real-user data when Google has it.
- **Local:** compares your site's name, address, phone, services and service areas with your synced Google Business Profile.
- **AI search readiness:** rules for AI crawlers, llms.txt, FAQ content and structured data.
- Category and overall scores, with **What raised or lowered these scores?**. Each finding explains its impact, why it matters (with a link to Google's developer guidance) and the fix steps, including starting points for WordPress, Elementor, Wix, Squarespace, GoDaddy, Webflow, Shopify and Duda sites.

**Plan:** every plan has monthly Site Scans (per location on {{AGENCY_PLAN}}). There are also daily caps: up to 5 scans, 20 PageSpeed requests and 3 AI fix plans per day.

**Run a scan:**
1. Sidebar → **Site Scan**. Choose a **Linked GBP location** (it fills in the website) or **No GBP comparison** and enter the website URL.
2. Set the page cap (1 to 500) and PageSpeed pages (0 to 5), then **Start scan**. Larger scans can take several minutes.
3. Review findings. **Generate AI fix plan** writes drafts only; check them before using **Copy draft**.
4. Use **Mark done / not done** to track your work, then **Rescan / retry PageSpeed**. Results show each issue as fixed, still present, new or not checked.

**Share and repeat:**
- **Export PDF**, with optional white-label branding (your agency name plus a PNG or JPEG logo under 200 KB).
- **Create share link:** read-only, shown once, expires after 30 days, and **Revoke share link** stops it. Anyone with the link can read the report.
- **Send to my web person:** emails the prioritized checklist.
- **Enable monthly rescan** for a URL (up to 10 schedules per account).
- Agencies: search client locations, select across pages and **Queue selected sites** (up to 1,000 a day; each needs a synced Google profile website).

**Free 60-second website scan** (no account needed, /free-site-scan): enter a website and email to see scores and up to five findings, then open the verification email to unlock the full quick-scan report of up to 11 pages. Sixty seconds is an estimate, and the email link lasts 7 days.

**Honest limits:** scores are diagnostic indicators, not ranking predictions. The scanner reads HTML and doesn't run JavaScript. It never changes your website or Google listing. Performance shows N/A when PageSpeed data isn't available.

## 13. Citations

**What it does:** a citation is any website that lists your business name, address and phone number, such as Yelp, BBB, Apple Maps or Bing Places. Being listed with identical details everywhere helps you show up in Google Maps. ConstructHUB gives you a checklist of 30 sites contractors should be on and tracks what you find. It does not submit or edit listings for you, and a site stays "Not checked" until you mark it.

**Plan:** every plan.

**Steps:**
1. Locations → open a location → **Citations** → **New Campaign** and give it a name.
2. **Build checklist**.
3. For each site, click **Search** (it looks for your business on that site through Google), then mark what you found: Listed & correct, Listed with wrong info, or Not listed. Paste the link to your listing.
4. Fix wrong details on that site itself and add your business where it's missing. The Google row fills in automatically when the location is linked to Google.

## 14. Social Media (through Blotato)

**What it does:** compose, schedule and auto-generate posts for X, Facebook Pages, Instagram, LinkedIn, Threads, Bluesky, TikTok, YouTube and Pinterest, per business, with a calendar and approval queue. Agencies get bulk tools across clients.

**Requirement:** Blotato is a separate paid subscription you buy from Blotato. Creating a Blotato API key activates that subscription, and ConstructHUB doesn't bill it. Businesses come from your Locations.

**Connect Blotato:**
1. Create your own Blotato account and connect your social accounts inside Blotato (for Facebook, grant access to the Pages you manage).
2. In Blotato Settings → API, create and copy an API key. Never send it to anyone.
3. In ConstructHUB, open **Social Media**, search for and select a business, choose **Agency shared key** or **This business only**, paste the key and click **Connect Blotato**. A business without its own key uses the agency key. The key is stored encrypted and never shown again.
4. Open **Map accounts and pages to this business**, pick the verified pages or boards and **Save business mapping**. These become that business's default destinations.

**Post manually:** **Compose** → select accounts and pages → write the post text, adjusting each platform's version with its character counter → add media (public links, synced business photos or **Upload through Blotato**, up to 100 MB) → **Post now**, **Schedule post** (your browser's timezone) or **Save draft**. YouTube needs a title, video and privacy choice; TikTok defaults to private until you choose public. Track each destination in **Calendar & queue**.

**Auto mode:** add business details in Locations and sync its Google photos and reviews if you want them as content sources. In Compose select the destinations, open **Auto mode** → **Use accounts selected in Compose**, then set cadence, content mix, timezone, blackout hours, business instructions, writing examples and the daily AI budget. Add real offers under Content sources and use **Sync recent GBP updates** to import recent Google updates. Start with **Approval queue**, enable auto mode and **Save auto settings**; **Generate draft from saved settings** previews a draft without posting. Choose **Fully automatic** only if you're happy for posts to publish without review.

**Agency tools:** **Bulk actions** writes one update for many businesses using {business}, {city} and {phone}, as drafts or queued posts; set per-business cadence; the **All-clients calendar** searches and filters every client's posts and approves or cancels up to 100 at once.

**Honest limits:** "queued" or "accepted by Blotato" is not the same as published; if a status is uncertain, check Blotato before posting again. Disconnecting stops ConstructHUB's queue and auto mode but can't recall posts Blotato already accepted; manage those and your Blotato billing in Blotato. AI never invents business facts; missing sources are reported instead. The **Guides** tab on the Social Media page has these walkthroughs plus guides for Profile Guard, AI review replies, Posts & Photos, Security, Site Scan, Cloudflare and Search Console.

## 15. Click Guard (click-fraud protection for Google Ads)

**What it does:** a small tracking script on the pages your ads send people to records each visit (IP address, device fingerprint, browser, operating system, screen and referrer) and flags unusual traffic using fixed rules:
- bot-like user agents and headless browsers;
- more than 5 visits from one IP in an hour, or more than 15 in a day;
- the same device fingerprint showing up from different IPs.

An IP with more than 10 flagged visits in an hour is added to **Blocked IPs**. You can also exclude IPs or ranges manually and whitelist your own. ConstructHUB serves the resulting exclusion list from a private URL, and a script you paste into your own Google Ads account adds new IPs as IP exclusions on your active campaigns each time it runs.

**Plan:** included with {{PROTECTED_SITE_PLANS}}; the number of protected websites depends on the plan (Extra protected website add-on). One website counts once across Click Guard, IP Tracker and VPN Shield.

**Set it up:**
1. Google Ads → **Click Guard** → add your website domain (a display name is optional).
2. Copy the tracking code (the **Tools** tab shows it again) and paste it in your site's head section or just before the closing body tag on every page your ads point to.
3. Open the **Google Ads Script** tab and copy the IP exclusion script.
4. In Google Ads go to Tools → Bulk actions → Scripts, click +, paste the script, save and authorize it, run it once and check the Logs tab.
5. Schedule it to run **Hourly**.
6. Manual option: copy the IP list and paste it into each campaign under Settings → Additional settings → IP exclusions.

**Tabs:** Dashboard (visits, threat level, blocked IPs, and an illustrative cost estimate based on an assumed cost per click; it is not measured savings), Traffic Sources (by domain or vendor), Traffic Signals (Blocked IPs and other flags), Tools, Domain Settings and Google Ads Script.

**Domain Settings:** exclusion list length (50 to 500 IPs; manual exclusions first, then the newest blocked IPs), **Manually Exclude IPs** (single IPs, CIDR ranges or 1.2.3.*) and **Whitelist IPs**. Some other options there (thresholds, country rules, block period, JavaScript-disabled and VPN blocking) are saved preferences only and don't change automatic detection yet; the page labels them.

**Honest limits:** these signals don't prove fraud and can flag real visitors. The Google Ads script only adds exclusions; it never removes them, so an IP you later unblock stays excluded in Google Ads until you remove it there. Google allows 500 IP exclusions per campaign, and the script stops adding at that limit. Click Guard records page visits only, not conversions, calls or form fills (use Google Ads conversion tracking for leads). No savings are guaranteed. Agencies with a Google Ads manager account can apply Click Guard exclusions to client accounts from Agency Ads & LSA (section 19).

## 16. IP Tracker

**What it does:** real-time visitor tracking for your websites, using the same tracking code and site list as Click Guard.
- **Dashboard:** visitors online now (distinct IPs in the last 20 minutes), total visits, daily visits.
- **Visitor List:** each IP's visits, pages, location and device details, searchable by IP.
- **Traffic Sources:** visits by referring domain or vendor.
- **Pages:** landing page hits.
- **Geo:** country and city (recorded on newer visits; older ones show Unknown).
- **Platforms:** browser, operating system, device and screen resolution.

**Plan:** same as Click Guard ({{PROTECTED_SITE_PLANS}}).

**Set it up:** sidebar → **IP Tracker** → add your website → paste the tracking code in the head section or before the closing body tag of every page you want to track. Visits appear only after the code runs on your site.

## 17. VPN Shield

**What it does:** flags visitors who show possible VPN or proxy signals, logs them, and can optionally react in the browser. Signals checked: WebRTC IP differences, a timezone that doesn't match the location, a limited built-in list of datacenter IP ranges, and VPN browser-extension indicators.

**Plan:** same as Click Guard ({{PROTECTED_SITE_PLANS}}). It uses the sites you track in IP Tracker or Click Guard.

**Set it up:**
1. Add your site in IP Tracker or Click Guard first.
2. Open **VPN Shield**, select the site and paste its VPN Shield script tag in your site's head section or before the closing body tag.
3. In Settings choose what flagged browsers get: an overlay, record only (log without blocking), or a redirect to a URL you choose.
4. Whitelist up to 500 IP addresses that should never be blocked (your office VPN, for example). Search engine crawlers are exempted by their user-agent.

**Honest limits:** detection is heuristic. VPN use is often legitimate, the datacenter list is incomplete, and nothing here identifies a person, a competitor or their intent. The overlay and redirect run after the page loads, only for browsers that run the script, and can be bypassed. Crawler user-agents can be faked.

## 18. Competitor Intel

**What it does:** a market scan that lists the businesses competing in your trade and area from public Google business listings: name, address, star rating, review count, phone and website, with a NEW flag for businesses that appear in later scans. Each competitor gets a "BS Meter", a heuristic score of review signals worth a closer look (for example repeated common phrases or generic reviews without specifics).

**Plan:** included with {{COMPETITOR_INTEL_PLANS}}, with a monthly number of scans per plan; the Competitor scan pack add-on adds more.

**Steps:** sidebar → **Competitor Intel** → **New Market Scan** → choose the industry, enter a location such as "Tampa, FL", pick a radius (10, 25, 50 or 100 miles) → **Scan Market**. Open a scan to see every competitor and the review analysis.

**Honest limits:** BS Meter signals are not proof that a review is fake, bought or written by the business, and the scores are not probabilities. Competitor Intel uses public business listings only. It does not show competitors' ads, ad spend, permits or private data. It is market research, not surveillance.

## 19. Google Ads tools, guides and LSA

### Agency Ads & LSA manager ({{AGENCY_PLAN}} plan only)
For agencies that run clients' Google Ads from a Google Ads manager (MCC) account. Open Google Ads → **Agency Ads & LSA**.
1. **Connect MCC with Google.** If the page says setup is required, the connection isn't available yet; contact support.
2. ConstructHUB discovers your client accounts and marks which run Local Services Ads.
3. **Request client account access:** paste one "customer ID,email" pair per line (up to 1,000), review, then **Confirm invitations and emails**. Google sends the client a pending manager invitation, and ConstructHUB emails instructions: in Google Ads, Admin → Access and security → Managers, check the manager ID and accept. Status shows pending, accepted, rejected or cancelled.
4. **Read-only health audits** check conversion actions and call conversions, search terms that spent without converting, impression share lost to budget, disapproved ads, location targeting, ad schedules, and LSA service areas, job types, budget and charged leads not yet rated.
5. **Bulk protections** (each previewed per account; nothing changes in Google until you confirm): presence-only location targeting; Click Guard IP exclusions (map each client to its Click Guard domain; uses the newest 500 flagged IPs and rotates out the oldest to stay within Google's 500-per-campaign limit); shared negative keywords (an editable starter list: jobs, careers, salary, training, DIY, tutorial, free, cheap; note "free" can also block "free estimate"); account-wide placement exclusions (Display and Performance Max); and ad schedules.
6. Applied changes can be reversed with **Preview reversal** and another confirmation. Previews expire after 24 hours.

**Honest limits:** it doesn't dispute leads automatically, promise refunds or manage Google billing. Results depend on Google accepting each change.

### LSA Leads
Google Ads → **LSA Leads**. Connect your own Google account to pull in your Local Services Ads phone-call and message leads (with phone numbers) for every Google Ads account you can access. Optionally connect Telegram to get a message the moment a new lead arrives. You can report bad leads to Google with a reason (for example a service you don't offer, outside your service area, or a sales call), one at a time or scheduled. Google decides whether to credit a lead, and the LSA Guide warns against disputing too often. If the page says Google Ads isn't configured, the connection isn't available yet. The price book doesn't list LSA Leads separately; ask ConstructHUB support to confirm access on your plan.

### Guides
- **Google Ads Guide** (Google Ads → Ads Guide): a 12-section playbook for contractor campaigns: campaign setup, Google features to avoid, ad assets, keyword strategy, location targeting, bidding and budget, ad copy, landing pages, IP exclusions and Click Guard, tracking and measurement, click fraud, and costly mistakes with a launch checklist. The overview is free; the full sections unlock with any Master Class purchase.
- **LSA Guide** (Google Ads → LSA Guide, free): 8 sections on Local Services Ads: verification, answering calls, reviews, choosing services, message leads, service areas and hours, photos, and your business bio.
- **Ad Fraud page** (Google Ads → Ad Fraud, free): ConstructHUB's own observations and opinions about click quality from accounts it has worked on. The page itself says this is not an independent audit and your traffic may differ, so don't present its figures as industry facts.
- **Google Ads consultant chat:** a chat bubble on the Google Ads pages that answers questions from the Google Ads guide content.

The guides are ConstructHUB's recommendations, not guarantees of results.

## 20. Cloudflare and Google Search Console ({{AGENCY_PLAN}} plan only)

Both are in the sidebar (**Cloudflare**, **Search Console**), each with Sites, Connections, Onboarding, Work queue and Guide tabs; Cloudflare also has Edge audit.

### Cloudflare
**Put a client site behind Cloudflare:** create a Cloudflare account and add the domain; the website stays hosted where it is. Compare the imported DNS records with the current ones and keep the email (MX and TXT) records. At the registrar, replace the nameservers with the two Cloudflare gives you (GoDaddy: Domain Portfolio → DNS → Nameservers → Change; Namecheap: Domain List → Manage → Nameservers → Custom DNS; Squarespace, which now runs Google Domains: Domains → DNS → Domain Nameservers; Bluehost: Domains → DNS → Nameservers → Edit). Wait until Cloudflare shows Active (up to 48 hours) and check the website and email work.

**Connect it:** Cloudflare → **Connections**. The recommended way is to enter the Cloudflare login email and Global API Key (Cloudflare → My Profile → API Tokens → Global API Key → View), verify, choose the zones and create a limited key. The Global Key is used once and never saved; the limited key (named "ConstructHUB" with the date) has only Zone Read, Analytics Read and Zone WAF Edit for the chosen zones. Alternatives: paste your own scoped API token with those three permissions, or invite the agency's email as a member with the Domain Administrator role (broader access).

**Use it:** traffic and security analytics (daily requests, page views, unique visitors, threats, countries, recent firewall events, top paths, bot-score share when the Cloudflare plan provides it). **Edge protection:** select zones, pick a protection pack or add flagged IPs from Click Guard or VPN Shield, add office IP exemptions, preview the exact rules, confirm (with an identity check) and watch the Work queue. Everything can be undone.

**Honest limits:** rules can block real customers, so check office exemptions. Traffic that isn't proxied through Cloudflare isn't protected. Some features depend on your Cloudflare plan. Rules stay in Cloudflare after you disconnect unless you undo them first. Nothing here guarantees the end of click fraud.

### Google Search Console
1. Search Console → **Connections**: connect the agency's Google account. This is separate from the Google Business Profile connection.
2. **Onboarding:** enter the client's email and their location ID to send instructions. The client opens Search Console → Settings → Users and permissions → Add user, enters the agency email and chooses **Full**.
3. Properties are discovered automatically about every hour (or click Discover). Select sites and **Sync**, choosing a start date up to 16 months back.
4. Open a property for clicks, impressions, CTR and average position by query, page, date, device or country, grouped by day, week or month. Location Insights also shows the property's totals.
5. Submit sitemaps (with confirmation) or queue URL inspections. Inspection reports coverage for the inspected URLs only and does not request indexing.

**Honest limits:** Google provides its top rows, omits some anonymized queries and delays recent data. Google's Indexing API only covers job-posting and livestream pages, so normal pages rely on sitemaps.

## 21. Domains and Mail alerts ({{AGENCY_PLAN}} plan only)

### Domains (Google Business → Domains)
Manage client domains' DNS and nameservers while the registration stays with the registrar.
- Connect a registrar API for automation: **Porkbun** or **Name-dot-com** (with an identity check). Other registrars (GoDaddy, Namecheap, Squarespace, Hover, Network Solutions, Wix) are managed manually with in-app guides; Wix-registered domains can't change nameservers.
- Or add domains by hand (up to 100 at a time) for monitoring.
- Domains map automatically to the client location whose website matches, or you map them yourself.
- Changes (nameservers, or A, AAAA, CNAME, TXT, MX and CAA records) follow preview → review before and after → confirm → identity check → apply → verified once public DNS agrees. Every applied change can be rolled back the same way.
- Monitoring alerts: expiry at 60, 30 and 7 days, auto-renew off, nameserver or DNS changes, the website failing over HTTPS, and certificates expiring within 30 days.
- No transfers, purchases, renewals, transfer codes or deletions. Copy website and email records before switching nameservers; a mistake can interrupt email.

### Mail alerts (Google Business → Mail alerts)
Collects important provider emails about client accounts (Google Business Profile, Search Console, Google Ads, Cloudflare, registrars, Blotato) into one inbox, matched to clients.
1. Copy your private forwarding address.
2. In Gmail: Settings → See all settings → Forwarding and POP/IMAP → **Add a forwarding address**, paste it and finish Google's confirmation using the code shown in ConstructHUB.
3. Create Gmail filters for the listed provider senders with **Forward it to** that address. Don't forward your whole inbox.

Unmatched mail is dropped and matched messages expire within 30 days. Sender matching is not proof an email is genuine, so open the provider's dashboard directly before acting on security or billing alerts. If the page says the inbound mail domain isn't configured, forwarding isn't available yet.

## 22. Agency workspace ({{AGENCY_PLAN}} plan only)

Open **Agency** under Google Business. Tabs: Locations, Clients, Team, Onboarding, Jobs and Settings, plus a workspace switcher.
- **Clients:** client records with contact email, notes, tags and an optional folder; assign locations to clients.
- **Team:** add members who already have a ConstructHUB login, with roles owner, admin, manager or viewer, and give them access to all clients or only assigned ones. Seats are shared with the CRM team.
- **Onboarding (Google manager access):** choose the client and the connected agency Google email, enter the exact business name and an address or Place ID, and click **Email manager instructions**. The client keeps ownership and adds the agency email as a **Manager** in their Business Profile settings → People and access; no client sign-in to ConstructHUB is needed. ConstructHUB spots the invitation, accepts clear matches, links the listing to that client and starts the first sync. Status goes sent → opened → invitation received → accepted → linked (or expired). Reminders go after three and six days, and requests expire after 30 days. **Auto-accept all** location invitations is an option (off by default).
- **Bulk actions on Locations:** select the page or every matching location, then sync, link and sync, unlink, assign a client, set Profile Guard mode (each location needs an approved snapshot first), set AI replies for future reviews (including auto-publishing future 3 to 5 star replies), queue approved posts or photos, run Site Scans or export a CSV. The dashboard counts locations that are synced, need reconnecting, are unlinked, or have Guard alerts, unanswered reviews or failed posts.
- **Jobs:** progress and failures for queued work.
- White-label Site Scan PDFs (section 12) and the agency tools in Social Media (section 14) round it out.

## 23. GBP Reinstatement service

For a suspended Google Business Profile. Go to **Reinstatement** in the sidebar (/reinstatement) and fill in the request form.
1. **Tell us about your situation.** The team reviews your case within 1 to 2 business days, asks questions and says whether they think they can help. They only take cases they're confident about.
2. **Full assessment** of the profile and its eligibility.
3. **Fix and comply:** guidance on the changes and documents needed.
4. **Appeal and reinstate:** they write and submit the evidence-based appeal and keep you updated.

The price is {{GBP_REINSTATEMENT_PRICE}} per project, also shown on the Reinstatement page. Common suspension causes: keyword stuffing in the business name, virtual-office or PO-box addresses, duplicate listings, suspicious review patterns, and wrong service areas or categories. Google alone decides whether a profile is reinstated, so no outcome is guaranteed.

## 24. The ConstructHub CRM

**Access:** the CRM is a separate product with its own plans and subscription (prices in section 3); a platform plan does not include it. Seats per CRM plan: {{CRM_SEATS_LINE}}, plus an Extra seat add-on. Click **ConstructHub CRM** at the top of the growth sidebar (/crm-app) → **Open your CRM** (portal.constructhub.us). Your workspace is created the first time you open the CRM; without an active CRM plan (or its trial) the CRM shows the CRM plans instead of the workspace. On a phone the CRM has a bottom bar (Dashboard, Schedule, Inbox, Clients, More).

**Home:** headline numbers (new leads, pipeline value, unscheduled jobs, open invoices), a **Needs attention** list (follow-ups due, new leads, leads waiting on an estimate), team activity and a setup checklist (your profile, company details, inviting your crew). Set weekly or biweekly follow-up reminders per client so nobody goes cold.

**Clients:** add a client with name, email, phone and address. The client's page is the hub: estimates, invoices, projects, payments, scheduling a visit, private notes, measurements, uploads, lead source and an activity timeline. Every client automatically gets a private portal; **View as client** shows what they see.

**Estimates:**
1. **New estimate** → pick or create the client → add items from your price book (search, or type a SKU number) with the scope of work → review → send.
2. The client gets an email with a private link and confirms their email with a one-time code the first time. They can ask a question, choose offers they qualify for, approve and e-sign.
- Status: Draft, Sent, Viewed, Approved, Declined or Expired. You see when and how long the client looked at it.
- An estimate expires 7 days after it's sent; **Extend** adds 7 days.
- You can edit or delete a sent estimate and the client's link updates; a signed estimate is locked.
- **Quick Bid** prices a job from the client's latest measurement report and your per-square-foot price-book items.
- Default offers and discounts are set in Settings. Voiding keeps the paper trail; permanent delete is owner-only.

**Invoices:** convert an approved estimate into an invoice, send it with a secure payment link, record payments and give receipts (marked PAID IN FULL when settled). Filter by status to chase overdue invoices.

**AI Call Assistant:** an add-on that answers the company's phone and files each caller as a lead in Clients. Its page is **Call Assistant** in the main ConstructHUB sidebar, not in the CRM (section 30).

**Payments:**
1. CRM → **Payments** → connect your own Stripe account (Stripe Connect). Money goes straight to your Stripe account; ConstructHUB never holds it.
2. In Settings choose card, bank transfer (ACH) or both, optionally make large payments ACH-only above an amount you set, and optionally pass the card fee to the client as a clearly labeled line. The page shows Stripe's standard processing rates.
3. **Take a payment** from a client's page: send a secure card or ACH link, or record a check, cash or wire you already have.
4. **Financing links:** add up to 10 lender links; the primary one shows as "Finance this project →" on estimates, invoices and the portal.

**Price book:** items (SKUs) with a unit (each, square, square foot, linear foot, hour, job), price and waste factor, plus materials, labor rates and assemblies. **Price floor lock** (Settings) stops reps pricing below the price book, or below cost plus a margin you set.

**Pipeline and projects:** a drag-and-drop board from lead through bid sent, approved, scheduled and in progress to complete. Add a lead with an estimated value. A project page has costing (budget versus committed versus actual by cost code, with margin), change orders (the client approves on a link; approval adjusts the contract value and schedule), a punch list, daily logs, selections with allowances (overage is billable) and permits. Project photos tagged progress or finished show in the client portal.

**Schedule:** month, week and agenda views; switch between My calendar, Everyone's calendar or one team member; warnings when visits overlap. Subscribe from Apple Calendar, Outlook or Google Calendar with the private feed link (anyone with the link can read it, so regenerate it to cut off old copies), or push to Google Calendar: the company calendar in Settings, or each person's own assignments under Team & Company → My profile.

**Messages:** two-way conversations with clients. Clients write from their portal or ask a question on an estimate; your reply appears in their portal and is emailed to them. Unread counts and waiting times keep replies from slipping. A client activity feed shows opens, approvals and payments.

**Team & Company:** invite people by email (optionally also by text) with a role, and override individual permissions per person:
- **Owner:** full control; holds the subscription.
- **Admin:** everything except integrations.
- **Sales:** writes and prices bids, sees costs and margins, edits the price book, approves change orders, takes deposits.
- **Project manager:** runs jobs, estimates and clients; sees prices, never costs.
- **Office:** scheduling, clients, estimates, invoices and payments; no costs or margins.
- **Field:** sees only their own assigned jobs; price-blind by default.
- **Subcontractor:** outside crew; sees only assigned work, never clients or pricing.

**Divisions** give one company separate operating arms, each with its own name, address, license and sales tax, printed on that division's documents; admins can be limited to one division.

**Texting** (included with {{TEXTING_EITHER_LINE}}). In CRM Settings → SMS choose where texts come from:
- **Shared ConstructHUB number:** nothing to set up, but it texts your own team only (bid signed, money landed, client re-opened an estimate).
- **My own number, billed through ConstructHUB:** {{CLIENT_NUMBER_INCLUDED_PLANS}} each include one; on the {{TEXTING_ADDON_PLANS}} platform plans it's the Client texting number add-on.
- **My own SignalWire account,** billed to you.

Texting clients needs your own registered number, because carriers no longer let one shared number text on behalf of many businesses. You can text a bid link when you send it, and a "check your email" voice call works with any sender. Your own account alerts by text need your consent on your profile, and STOP opts out.

**Integrations** (CRM → Integrations):
- **HOVER:** connect once, and completed jobs and photos flow onto the matching client. If a report's measurements don't arrive automatically, upload the report PDF or paste its text in CRM Settings → **Measurement reports** (you review the parsed report before the client is matched or created).
- **Stripe** and **Google Calendar.**
- **Lead capture form:** embed it on your website or share the link; submissions land in Clients tagged website-lead and the owner gets an email. Rotate the link if it's misused.
- **API keys:** read-only access to your clients, projects, estimates, invoices and payments for your own tools.
- **Webhooks:** signed event notifications to your own endpoint.

**Import your data:** CRM Settings → **Import your data**: upload a CSV or TSV export (up to 2 MB and 5,000 rows) from another CRM, from QuickBooks or from a spreadsheet. Import clients first, check the column mapping and preview before anything is saved. Coming from QuickBooks Online or one of the contractor CRMs the assisted import supports? Ask for the assisted import, where a person moves your data; they reach out within 1 business day.

**Backups:** scheduled exports of clients, estimates and invoices emailed every week, every 2 weeks or on a custom schedule, as CSV or Excel. Attachments, signed documents and payments aren't included, and there is no restore button.

**Other settings:** company profile (name, address, phone, email, license, logo, terms, warranty), estimate and invoice defaults (footers, terms, deposit, sales tax with division and city overrides), company theme color for everything clients see, notification choices (in-app, email or text per event), calendar, lead sources and default offers.

**What your clients see (client portal):** estimates to read and approve, invoices to pay by card or bank transfer, receipts, signed contracts, measurement reports, project photos, messages and your team's contact details, opened from a secure link plus an email code.

## 25. Notifications, security and your account

**Notifications (growth app):** the bell in the header shows recent notices. Settings → **Notifications** sets how you get each kind (security emails are always on). Examples: new Google reviews, replies posted, Profile Guard changes and reversions, posts and social posts published or failed, Site Scan completed or regressed, Google or Cloudflare connections, domain changes and mail alerts. CRM notifications are set separately in CRM Settings.

**Two-factor sign-in:** Settings → **Security & activity** → **Enable 2FA** → scan the QR code with an authenticator app (Google Authenticator, Authy or any TOTP app) → enter the 6-digit code → **Verify & Enable**. Save the recovery codes privately (each works once). At sign-in you can tick **Remember this device for 30 days**; only do that on a private device, and revoke old devices under Remembered devices.

**"Confirm it's you":** sensitive actions (security settings, connecting Google, Profile Guard, Cloudflare, domain changes and similar) ask for your password, authenticator code or a 6-digit code emailed to you (valid 10 minutes).

**Account activity:** the latest 200 events, filterable by type and date. If you see a Google connection you don't recognize, disconnect it there and reset your password.

**Delete your account:** Settings has a button to ask support to permanently delete your account and its data.

**Help:** email ConstructHUB support (the address is at the bottom of every ConstructHUB page). In the CRM, the ⓘ icons explain each screen in plain English.

## 26. Master Class

A step-by-step course on starting and growing a construction business, with 50 state-by-state guides (Secretary of State filings, licensing boards, bonding, insurance and workers' comp, tax registration) and checklists. Four modules, sold separately or as the Complete Bundle:
1. **Business Formation & Licensing:** choosing an LLC, S-corp or sole proprietorship; licensing, bonding and insurance by state; tax and payroll setup; subcontractor (1099) management; plus operations lessons on hiring, sales, branding and vetting contractors.
2. **GMB Setup & Optimization:** setting up and verifying your Google Business Profile, review strategy, defending against fake reviews, photos and a posting calendar, and preventing and recovering from suspensions.
3. **Website & Online Presence:** a contractor website blueprint, service and location pages, lead capture, speed and mobile, portfolios and trust signals.
4. **SEO & Directory Domination:** local SEO, citations, content and link building, Google Ads and LSA setup, and tracking.

The overview is free to read; each module's full content unlocks when purchased, and any Master Class purchase also unlocks the full Google Ads Guide. The Master Class is not included in any plan. Modules and the bundle are "{{SALES_REP_LABEL}}": Pricing → Master Class, or {{SALES_HREF}}.

## 27. Done-for-you services and talking to sales

For contractors who'd rather have the work done for them. Every one of these is "{{SALES_REP_LABEL}}" (never quote a price):
- **Business formation & contractor license:** LLC or corporation filing, contractor license application processing, surety bond and insurance setup (general liability, auto, workers' comp), EIN, state tax ID and business bank guidance. You still take any licensing exams yourself.
- **Google Business Profile & website:** profile creation and verification, a contractor website with service and location pages, photo optimization and a posting calendar.
- **SEO & ad campaigns:** local SEO, Google Ads setup and optimization, Local Services Ads enrollment, and Search Console and Analytics setup.
- **Monthly SEO packages:** a dedicated strategist, a technical audit and fixes, keyword research, content, backlinks and monthly ranking reports, on a 6-month minimum with a signed contract. No ranking is guaranteed.
- **Complete Business Build:** all of the above in one engagement. The site describes it as paid upfront and about 4 to 6 months from start to finish, excluding licensing exams, prerequisites and required testing; a rep confirms the details.
- **Custom work:** anything not listed.

**How to ask:** Pricing → **Done-for-you services** ({{SALES_HREF}}) → **{{SALES_REP_LABEL}}**. Fill in your name and email (phone and company optional) and what you need: trades, service area and timeline. A rep replies by email.

## 28. Quick answers

- **Can I use ConstructHUB without paying?** There is no free plan. Creating an account is free; plans start with a {{TRIAL_LABEL}} for first-time subscribers.
- **Can I cancel?** Yes, from Settings → Billing → Manage billing (Stripe's billing portal).
- **Results:** nothing is guaranteed, not rankings, leads or reinstatement. ConstructHUB gives you tools, data and guidance; Google and the market decide outcomes.
- **Do I need a Google Business Profile?** For the Google tools, yes, and you need Owner or Manager access to it. ConstructHUB can't create one for you, but the done-for-you service can help.
- **Can my office manager or crew use it?** Yes. Invite them in the CRM (Team & Company) within your CRM plan's seats; {{AGENCY_PLAN}} workspaces also have agency team roles.
- **Does ConstructHUB hold my customers' payments?** No. Payments go straight to your own Stripe account.
- **Is Blotato included?** No. It's a separate subscription you buy from Blotato.
- **Which plan should I pick?** One profile and the basics: the cheapest plan. Click-fraud protection, Competitor Intel, texting and auto-published AI replies: the plans listed for those features in section 3. Several locations: the plan with more locations. A team in the CRM: that is the CRM plan, chosen separately by its seats. An agency managing many clients: {{AGENCY_PLAN}}. Compare them on Pricing → Compare plans.
- **Who else uses ConstructHUB?** That isn't something you can share. Talk about features instead.
- **Can ConstructHUB answer my phone?** That is what the AI Call Assistant add-on does ({{CALL_ASSISTANT_STATUS}}): it answers calls on a local number, files the lead in the CRM and texts the right person for emergencies. See section 30.

## 29. Glossary

- **GBP / GMB:** Google Business Profile (formerly Google My Business), the listing that shows in Google Maps and Search.
- **Local Pack:** the short list of businesses (usually three) Google shows above the regular results for local searches.
- **LSA:** Local Services Ads, Google's pay-per-lead ads with the Google verified badge.
- **MCC:** a Google Ads manager account that manages several client ad accounts.
- **NAP:** name, address and phone number.
- **Citation:** a website listing your NAP.
- **EXIF / geotag:** data stored inside a photo file, such as location and camera details.
- **IP exclusion:** a Google Ads setting that stops your ads showing to a specific IP address.
- **ACH:** a bank transfer payment.
- **10DLC:** the US carrier registration a business needs to text customers from its own number.

## 30. AI Call Assistant (add-on)

An AI receptionist for the contractor's own phone line. It answers every call, day or night, collects the lead the way the contractor wants, files it in the CRM and gets urgent calls to the right person. Page: [AI Call Assistant](/call-assistant). Signed in, it lives under **Call Assistant** in the main ConstructHUB sidebar (tabs: Overview, Numbers, Agent Studio, Simulator, Calls); the CRM is a separate product and only receives the leads.

**Price and availability:** {{CALL_ASSISTANT_TIER_COUNT}} tiers, one per account: {{CALL_ASSISTANT_TIERS_LINE}}. Solo's launch price is {{CALL_ASSISTANT_INTRO_LINE}}. The intro price is Solo on monthly billing; yearly billing is the yearly price from the start, and {{CALL_ASSISTANT_NO_INTRO_TIERS}} have no intro. On every tier, {{CALL_ASSISTANT_INCLUDES_LINE}}. It is an add-on to the {{CALL_ASSISTANT_PLANS}} plans, not a plan of its own; the contractor can move between tiers any time in Settings → Billing (the difference is prorated, and a smaller tier keeps fewer numbers). {{CALL_ASSISTANT_AVAILABILITY}}

**Which tier:** {{CALL_ASSISTANT_TIER_ADVICE}} **What counts as a minute:** {{CALL_ASSISTANT_MINUTE_RULE}} **Minutes over:** {{CALL_ASSISTANT_OVERAGE_RULE}}

**Voices:** the contractor picks a name and voice for the assistant: {{CALL_ASSISTANT_PERSONAS}}, and can change the greeting. (The phone voice named Gabe is one of those choices; it is not this website helper.) It speaks English today.

**Getting a phone number:**
1. **Call Assistant** (main sidebar) → **Numbers** → pick a state, and optionally an area code or a city.
2. Choose one of the available local numbers; ConstructHUB buys it for you and connects it to the assistant. {{CALL_ASSISTANT_TIER_NUMBERS}}; each extra number is its own add-on (a second location or a tracking line).
3. Keep your existing numbers: forward them to the new number from your phone carrier (for example only when you don't answer, after hours, or always). Nothing is ported, so your numbers stay yours. The Numbers tab shows how to set up forwarding with common carriers.

**If you cancel or a payment fails:** {{CALL_ASSISTANT_RULE_OWN_NUMBERS}} {{CALL_ASSISTANT_RULE_CANCEL}} {{CALL_ASSISTANT_RULE_PAYMENT}}

**On a call:** it greets the caller with the company's name, asks what the call is about before collecting anything, then asks the questions the contractor set (by default: what they need, the property address, a first name, a confirmation of the callback number it sees, a good email and the best time to call). It says it is a virtual assistant if asked, and it can play a notice that calls may be recorded (on by default; some states require consent from everyone on the call, so check your state before turning it off).

**After the call:** a real lead becomes a client in the CRM (and a pipeline project if the contractor chooses), tagged with the source "Call Assistant", and the office is notified the same way as other new leads. Emergencies, existing customers and "I want to talk to a person" are texted or emailed to the teammate the contractor picked, with reminders until someone replies. The assistant never gives out a teammate's number.

**Spam — you never answer a spam call again:** {{CALL_ASSISTANT_SPAM_SCREEN}} {{CALL_ASSISTANT_SPAM_FORWARDING}} {{CALL_ASSISTANT_SPAM_BLOCK}} {{CALL_ASSISTANT_SPAM_REPORT}} The weekly email can be turned off under CRM → Settings → Notifications ("Weekly spam report"). {{CALL_ASSISTANT_SPAM_FREE}}.

**Call log:** every call is listed under **Calls** with its outcome, a summary, the full transcript and the recording.

**Agent Studio** (where the contractor tunes the assistant, no code needed): company and services, the jobs it should turn down and where to refer them, service area by county, credibility (years in business, licenses, insurance, warranties), offers (financing, promotions, free estimates), policies (whether to talk about price ranges, repairs, what counts as an emergency), the voice and greeting, the questions to ask and in what order, answers to common questions, who gets which urgent calls, where leads are delivered, and advanced settings (extra instructions, call length, silence handling, spam sensitivity). The **Simulator** lets you test it by typing before it answers real calls. Publishing creates a version you can restore later, and **Pause** stops it answering.

**What it won't do:** quote prices unless the contractor allows price ranges, book appointments (not available yet), give out a teammate's phone number, or pretend to be a person.
