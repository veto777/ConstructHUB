# UI map — lane 6: government data pages and the public/marketing site

Every element of every page in audit lane 6, what it does, and how it was verified.
Lane dir (logs, fragments, BUGS.md, REPORT.md): /tmp/claude-1000/-home-veto-ConstructHUB/b63db1cc-791d-4d76-a373-8b7b67c0c5d0/scratchpad/audit/lane6
Audited 2026-10-04 against the dev DB (constructhub_dev_a6) and a signed-out dev server.

## Lane 6 / Map-07 — Public chrome audit (site-nav, public-page-chrome, cart, page coverage, signed-in/out frames)

Repo: /home/veto/ConstructHUB-audit6 (branch audit/6). Read-only audit; no repo files modified.
Date: 2026-10-04. Dev server at http://127.0.0.1:8306 serves the Vite dev shell (no prerendered
HTML — `curl /` returns only the client bootstrap, 5,745 bytes, no nav markup), so rendered-HTML
checks were done by code/trace verification instead; every href was checked against
`client/src/App.tsx` route tables and landing/pricing anchor ids.

---

## The marketing ribbon (site-nav.tsx)

`SiteNavBar` (`client/src/components/site-nav.tsx:321`) is the ribbon. Used by the landing page
directly (`client/src/pages/landing.tsx:269`) and by `PublicPageHeader` for every other public page.
Catalogues: `FEATURE_CATALOGUE` (30 template pages at /features/<slug> + 1 external = **31 entries**)
and `DFY_CATALOGUE` (5 template pages + 1 external = **6 entries**). Both feature flags are ON
(`client/src/lib/features.ts:13,26` → `SHOW_COMPETITOR_INTEL=true`, `SHOW_GOOGLE_REVIEWS=true`), so
no catalogue entry is filtered out of the nav.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| CHLogo home link (`link-public-home`) | wouter Link → `/` | Clicking the logo returns to the home page | site-nav.tsx:326 | none (client route `/` → LandingPage, App.tsx:288) | Route exists in App.tsx PublicRouter | OK |
| Features ▾ trigger (`nav-dropdown-features`) | Radix NavigationMenu trigger | Opens the 3-column panel listing every feature page | site-nav.tsx:151 | none | Rendered by SiteDropdowns, panel `nav-panel-features` :155 | OK |
| Features dropdown items — **31 generated** from FEATURE_CATALOGUE (group row; all verified individually) | wouter Links | Each jumps to that feature's intro page; grouped under 6 headings | site-nav.tsx:86-111 (FeatureItem), list at :157-164 | none | All 31 paths checked against App.tsx: `/features/:slug` route (App.tsx:311 PublicRouter / :209 DashboardRouter) → `FeaturePageRoute` (pages/features.tsx:195) → `featurePageBySlug`; external `/call-assistant` route App.tsx:309. Per group: **Grow 8** (/features/gbp, reviews, profile-guard, ranking-grid, gbp-content, social, site-scan, media), **Protect 7** (click-guard, ip-tracker, vpn-shield, cloudflare, search-console, domains, mail-alerts), **Win jobs 5** (permits, property, competitors, ads-manager, lsa-leads), **Run the business 6** (crm, crm-schedule, crm-leads, texting, agency + external AI Call Assistant → /call-assistant, shown with a "New" badge, site-nav.tsx:103), **Learn 3** (master-class, guides, reinstatement), **The platform 2** (gabe, customer-api). Example row: `nav-item-gbp` → `/features/gbp`. Flagged entries competitors/reviews are visible because both flags are true. | OK |
| "See every feature →" (`nav-features-all`) | wouter Link → `/features` | Goes to the full feature catalogue page | site-nav.tsx:169 | none | Route App.tsx:310 | OK |
| Done-For-You ▾ trigger (`nav-dropdown-dfy`) | Radix trigger | Opens the services panel | site-nav.tsx:177 | none | Panel `nav-panel-dfy` :181 | OK |
| Done-For-You dropdown items — **6 generated** from DFY_CATALOGUE (group row) | wouter Links | Each jumps to that service's page | site-nav.tsx:114-135 (ServiceItem), list at :184 | none | All 6 checked: 5 slugs under `/done-for-you/:slug` (App.tsx:313 → `DfyPageRoute` pages/done-for-you.tsx:211 → `dfyPageBySlug`): business-formation, gmb-website-setup, seo-ads-management, seo-contracts, complete-business-build; external GBP Reinstatement → `/reinstatement` (App.tsx:298). Example row: `nav-item-dfy-business-formation` → `/done-for-you/business-formation` | OK |
| "See all services →" (`nav-dfy-all`) | wouter Link → `/done-for-you` | Goes to the services catalogue page | site-nav.tsx:189 | none | Route App.tsx:312 | OK |
| Plans (`link-nav-plans`) | anchor `#plans` on `/`, or `/#plans` off-home | Smooth-scrolls to the pricing/plans section of the home page | site-nav.tsx:64-84 (SectionLink), :332 | none | `id="plans"` exists on landing.tsx:471 | OK |
| Results (`link-nav-stats`) | anchor `#stats` / `/#stats` | Jumps to the results/stats section of the home page | site-nav.tsx:332 | none | `id="stats"` exists on landing.tsx:338 | OK |
| Coverage (`link-nav-coverage`) | anchor `#coverage` / `/#coverage` | Jumps to the coverage section of the home page | site-nav.tsx:332 | none | `id="coverage"` exists on landing.tsx:519 | OK |
| Cart button + count badge (`button-cart-trigger`, `badge-cart-count`) | Sheet trigger | Opens the cart drawer; badge shows item count | site-nav.tsx:337 (cart on by default); detail in cart table below | GET /api/auth/me (session) — server/auth.ts:668 | Code trace; count source = localStorage cart (see cart table) | OK |
| ThemeToggle (desktop, `hidden sm:block`) | toggle | Switches light/dark theme | site-nav.tsx:338 → components/theme-toggle.tsx | none (client preference) | Component exists | OK |
| Sign In (`link-nav-signin`) | wouter Link → `/auth` or `/auth?next=<current>` | Goes to the sign-in page, coming back to where the visitor was | site-nav.tsx:345, href built :322 | GET /api/auth/me — server/auth.ts:668 | Route `/auth` App.tsx:289; `next` handled by auth.tsx | OK |
| Get Started (`link-nav-getstarted`) | wouter Link → `/auth?mode=signup` | Goes to the sign-up mode of the auth page | site-nav.tsx:348 | GET /api/auth/me — server/auth.ts:668 | Route exists; signup mode rendered (auth.tsx:440,658) | OK |
| Dashboard (`link-nav-dashboard`, signed-in only) | wouter Link → `/` | Signed-in users go to their dashboard home | site-nav.tsx:340 | none (client `/` → HomePage when signed in, App.tsx:166) | Route exists in DashboardRouter | OK |
| Mobile hamburger (`button-landing-menu`, `lg:hidden`) | Sheet trigger | Opens the slide-over menu on phones/tablets | site-nav.tsx:244-251 | none | Component SiteMobileMenu :237 | OK |
| Mobile Features accordion (`mobile-nav-features`, groups `mobile-nav-group-<key>`, items `mobile-nav-item-<slug>`) — 31 items + "See every feature →" (`mobile-nav-features-all`) | Accordion + Links | Same 31 feature links as the desktop dropdown, as fold-out groups | site-nav.tsx:259-283 | none | Same 31 paths as desktop row, verified against App.tsx | OK |
| Mobile Done-For-You accordion (`mobile-nav-dfy`, items `mobile-nav-item-dfy-<slug>`) — 6 items + "See all services →" (`mobile-nav-dfy-all`) | Accordion + Links | Same 6 service links as the desktop dropdown | site-nav.tsx:284-296 | none | Same 6 paths, verified against App.tsx | OK |
| Mobile section links (`link-mobile-nav-plans`, `-stats`, `-coverage`) + Pricing (`link-mobile-nav-pricing` → `/pricing`) | anchors / Link | Home sections + a direct Pricing link (mobile-only extra) | site-nav.tsx:298-301 | none | Anchors exist on landing.tsx; `/pricing` route App.tsx:294 | OK |
| Mobile Sign In (`link-mobile-signin`, signed-out only) | Link → signInHref | Sign-in from the slide-over | site-nav.tsx:305 | GET /api/auth/me — server/auth.ts:668 | Route exists | OK |
| Mobile theme toggle | ThemeToggle | Light/dark switch inside the slide-over | site-nav.tsx:307-310 | none | Component exists | OK |
| NavDirectory (`nav-directory`, `display:none`) | hidden `<ul>` | SEO copy of every dropdown link (37 entries + 2 group links), never shown to humans | site-nav.tsx:213-234 | none | Same catalogue arrays as the panels; entries `nav-directory-item-*` mirror the 31+6 paths verified above | OK |

Ribbon notes:
- Signed-out mobile slide-over has **no "Get Started" button** (desktop-only) and, signed-in, **no
  "Dashboard" button** — the only signed-in nav back is the logo. Asymmetry, not a dead link.
- `FeatureItem` renders a "New" badge only for `status === "external"` (the AI Call Assistant) — intended.

## CartSheet detail (client/src/components/cart-sheet.tsx)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Cart trigger + badge (`button-cart-trigger`, `badge-cart-count`) | Sheet trigger + badge | Opens the cart; badge = checkout items + sales-quote items | cart-sheet.tsx:84-95 | none | Count = `getItemCount() + salesItems.length`; source is `useCart` localStorage (`STORAGE_KEY`/`SALES_STORAGE_KEY`, contexts/cart-context.tsx:56-100) — badge reflects the visitor's own cart, no server state | OK |
| Sheet header (`text-cart-title`) + "N items" badge | header | Titles the drawer | cart-sheet.tsx:99-105 | none | — | OK |
| Empty state (`text-cart-empty`) + "Master Class" (`link-browse-courses` → `/master-class`) + "Services" (`link-browse-services` → `/pricing#services`) | buttons | When the cart is empty, offers two browse targets | cart-sheet.tsx:108-127 | none | `/master-class` route App.tsx:297; `id="services"` exists on pricing.tsx:656 | OK |
| "Talk to a sales rep" section (`section-cart-sales`, `card-cart-sales-*`) | list + form button | Items priced ≥ $1,000 can't self-checkout; each becomes a sales request | cart-sheet.tsx:131-158; threshold SALES_THRESHOLD_CENTS from shared/plans.ts | TalkToSalesButton → POST /api/seo-inquiry → server/routes.ts:3306 (zod-validated, rate limit 5/hr, `seoInquiryLimit` routes.ts:71; email via sendWithFallback) | Code trace; threshold enforced again server-side (stripe.ts:548 `isSalesOnly`) | OK |
| Dismiss sales item (`button-dismiss-sales-*`) | button | Removes one sales-quote item | cart-sheet.tsx:145-154 | none | — | OK |
| Cart line items (`card-cart-item-*`, name/price/type badge) | list | Shows each checkout item; **no quantity stepper** (every item is qty 1, server enforces the same) | cart-sheet.tsx:159-194 | none | Type label maps course_module/course_bundle/dfy_bundle/dfy_service (cart-context.tsx:6) | OK |
| Remove item (`button-remove-cart-item-*`) | button | Removes one item | cart-sheet.tsx:182-191 | none | — | OK |
| Subtotal (`text-cart-subtotal`/`text-cart-total`) | text | Sum of line prices (display only — the server re-resolves every price and never trusts the client) | cart-sheet.tsx:200-205 | POST /api/stripe/create-cart-checkout resolves prices server-side from masterClassModules / COURSE_BUNDLE / DFY_CATALOG (server/stripe.ts:524-544) | Code trace | OK |
| Checkout error line (`text-cart-error`) | alert | Shows the failed checkout's message until the sheet closes or cart changes | cart-sheet.tsx:207-211 | — | — | OK |
| "Proceed to checkout" (`button-cart-checkout`) | button → redirect | Sends the cart to Stripe Checkout; redirects to Stripe; on 401 sends the visitor to sign in | cart-sheet.tsx:213-231, mutation :43-60, guard :62-70 | POST /api/stripe/create-cart-checkout → server/stripe.ts:512 → Stripe `checkout.sessions.create` (mode payment; success `/pricing?cart_success=true`, cancel `/pricing?cart_canceled=true`, stripe.ts:595-596); webhook fulfils via server/billing/fulfilment.ts. Duplicate-id and bundle-overlap checks stripe.ts:558-566; SEO-contract items rejected stripe.ts:551-553 | Endpoint exists and matches client path exactly. Stripe OFF on dev: `stripe` client proxy throws `PaymentsNotConfiguredError` (server/billing/client.ts:23) → honest 503 via sendStripeError (stripe.ts:43-46) → client toast "Checkout failed" = expected on dev. Unit coverage: server/stripe-billing.test.ts:912-942, growth-payments.test.ts:38-67, cart-checkout-overlap.test.ts:46 | OK (dev 503 expected) |
| "Clear cart" (`button-clear-cart`) | button | Empties checkout items and dismisses sales items | cart-sheet.tsx:235-244 | none | — | OK |
| `?cart_success=true` / `?cart_canceled=true` handling | URL params | After Stripe redirects back, toasts the outcome and clears the cart on success | cart-sheet.tsx:25-39 | none | Params match the server's success_url/cancel_url | OK |

Cart placement check: `PublicPageHeader` defaults `cart=false`; only `/pricing` (pricing.tsx:268) and
`/master-class` (master-class.tsx:314) pass `cart`, and they are the only public pages with Add to
Cart (no `addItem` anywhere in feature-landing/dfy-landing) — the doc comment's invariant holds.

---

## Public page header/footer (public-page-chrome.tsx)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| PublicPageHeader (`header-public-page`) | sticky header | Puts the whole ribbon on a public page — **renders only for signed-out visitors** (`useSignedOut`, public-page-chrome.tsx:19-22,37) | public-page-chrome.tsx:36-45 | GET /api/auth/me — server/auth.ts:668 | Signed-in path returns null; the app frame is supplied by App.tsx instead (see frames section) | OK |
| Footer: Home | Link → `/` | Back to the home page | public-page-chrome.tsx:76 | none | Route App.tsx:288 | OK |
| Footer: Features (`link-public-footer-features`) | Link → `/features` | Feature catalogue | public-page-chrome.tsx:78 | none | Route App.tsx:310 | OK |
| Footer: Done-For-You (`link-public-footer-dfy`) | Link → `/done-for-you` | Services catalogue | public-page-chrome.tsx:80 | none | Route App.tsx:312 | OK |
| Footer: AI Call Assistant (`link-public-footer-call-assistant`) | Link → `/call-assistant` | Call-assistant marketing page | public-page-chrome.tsx:82 | none | Route App.tsx:309 | OK |
| support@constructhub.us | mailto | Opens the visitor's mail client | public-page-chrome.tsx:84 | none (mailto, fine as-is) | — | OK |
| Terms | `<a href="/terms">` | Terms of use | public-page-chrome.tsx:86 | none | Route App.tsx:326 → PrivacyPolicyPage/TermsOfUsePage (pages/privacy-policy, terms-of-use) | OK |
| Privacy | `<a href="/privacy">` | Privacy policy | public-page-chrome.tsx:88 | none | Route App.tsx:325 | OK |
| FooterGuides (`footer-guides`) — 4 generated links | Links | Free reports not in either dropdown, on every public footer | public-page-chrome.tsx:51-69 | none | All 4 verified against App.tsx PublicRouter: /google-ads-guide (:303), /lsa-guide (:306), /google-ad-fraud (:305), /google-business (:299). Example: `link-footer-guide-google-ads-guide` → /google-ads-guide | OK |
| Copyright notice | text | "© <year> ConstructHUB. All rights reserved." | public-page-chrome.tsx:91 → lib/marketing.ts:11-13 | none | — | OK |

---

## Which pages carry the chrome

How chrome reaches each signed-out page: `PublicRouter` (App.tsx:285-333) renders pages bare; each
page either embeds `PublicPageHeader`/`PublicPageFooter` itself, or is wrapped by `withRibbon`
(App.tsx:259-270) which adds the header only. The landing page uses `SiteNavBar` + its own footer.

| Public page(s) | Nav | Footer | Chrome source | Status |
|---|---|---|---|---|
| `/` and `/landing` | yes | yes (own footer, landing.tsx:566-587, incl. FooterGuides + copyright) | SiteNavBar direct (landing.tsx:269) | OK |
| `/pricing` | yes (+cart) | yes | pricing.tsx:268, 683 | OK |
| `/master-class` | yes (+cart) | yes | master-class.tsx:314, 2724 | OK |
| `/reinstatement` | yes | yes | reinstatement.tsx:202, 416 | OK |
| `/crm-app` | yes | yes | crm-gateway.tsx:77, 207 | OK |
| `/features`, `/features/:slug` (all 31) | yes | yes | feature-landing.tsx:111, 130 | OK |
| `/done-for-you`, `/done-for-you/:slug` (all 6) | yes | yes | done-for-you.tsx:92, 204; dfy-landing.tsx:80, 113 | OK |
| `/call-assistant` | yes | yes | call-assistant-landing.tsx:226, 566 | OK |
| `/developers` | yes | yes | developers.tsx:120, 246 | OK |
| `/privacy`, `/terms` | yes | yes | legal-page.tsx:105, 151 | OK |
| 404 (unknown URL) | yes | yes | not-found.tsx:21, 55 | OK |
| `/crm-terms`, `/crm-privacy` | yes (Ribboned) | partial — page's own mini-footer (mailto + Home link, crm-legal.tsx:30-33) | App.tsx withRibbon | OK |
| `/auth` | yes | **none** | auth.tsx:281 | UNCLEAR — dead bottom |
| `/google-business` | yes | **none** | google-business.tsx:125 | UNCLEAR — dead bottom |
| `/google-ad-fraud` | yes | **none** | google-ad-fraud.tsx:305 | UNCLEAR — dead bottom |
| `/lsa-guide` | yes | **none** | lsa-guide.tsx:207 | UNCLEAR — dead bottom |
| `/google-ads-guide`, `/google-ads-guide/:section` | yes (Ribboned) | **none** | App.tsx:303-304 | UNCLEAR — dead bottom |
| `/free-site-scan` | yes (signed-out only) | **none** | site-scan.tsx:1361 | UNCLEAR — dead bottom |
| `/invite/:code` | yes | **none** | invite.tsx:50, 62 | UNCLEAR — dead bottom |
| `/databases`, `/property`, `/photos` | yes (Ribboned) | **none** | App.tsx:291-293 | UNCLEAR — dead bottom |
| `/google-ads`, `/ads-manager`, `/ip-tracker`, `/vpn-shield` | yes (Ribboned) | **none** | App.tsx:300-301, 307, 314 | UNCLEAR — dead bottom |

Notes:
- Every one of these pages HAS the nav, so none is a true dead end — but 13 route families end the
  page with no footer, so a visitor who scrolls to the bottom finds no links. The footer doc comment
  ("no marketing page is left without links to it") is only half-enforced. Judgement call for the
  owner whether tool/guide pages intentionally go footer-less.
- Token pages for a contractor's customer (`/review/<token>`, `/contract/sign/<token>`, `/e/`,
  `/i/`, `/co/`, `/lead-form/`, `/portal/`) intentionally have no marketing chrome (App.tsx:257,
  663-676) — by design, not audited here.
- `/site-scan` (signed-out) renders `FreeSiteScanPage` (App.tsx:296) → see finding F2.

---

## Signed-in vs signed-out frames

| Visitor / host | Frame they get | Where decided | Status |
|---|---|---|---|
| Signed-out, main host | `PublicRouter` (App.tsx:285) + per-page chrome + `HubWidget surface="marketing"` (App.tsx:568); unknown URLs → honest 404, and `SIGNED_IN_ONLY` paths redirect to `/auth?next=…` (App.tsx:336-354) | App.tsx:560-571 | OK |
| Signed-in, main host (e.g. lands on /pricing) | The app shell: `AppSidebar` + top bar (sidebar trigger, RecentAuthModal, NotificationBell, settings, CartSheet, ThemeToggle — App.tsx:683-693), `PaymentNeededBanner`, dashboard footer with mailto/Terms/Privacy/copyright (App.tsx:701-709), `DashboardRouter` content. `PublicPageHeader`/`PublicPageFooter` return null by design, so /pricing, /features/*, /done-for-you/*, /call-assistant (CrmCallAssistantPage, App.tsx:206) render inside this frame — nav is NOT lost. | App.tsx:678-716 | OK |
| Signed-in on `/landing` | `LandingPage` with `SiteNavBar signedIn` (logo + Dashboard button → `/`) + `HubWidget signedIn` | App.tsx:654-661, landing.tsx:269 | OK |
| Signed-in on `/free-site-scan` or `/site-scan/report/*` | **Bare page** — these return before the auth gate (App.tsx:532-533), `PublicPageHeader` renders null when signed in; `/free-site-scan` has only a plain `<a href="/">` escape link, `SharedSiteScanPage` has none | App.tsx:532-533, site-scan.tsx:1309, 1281 | BUG (F2, low) |
| Portal host (portal.constructhub.*), signed-in | CRM frame: `CrmSidebar` + slim header + `CrmRibbon` + `HubWidget surface="portal"`; `/admin` gets a full-bleed Platform Admin shell (App.tsx:575-651) | App.tsx:575 | OK (no marketing chrome by design) |
| Portal host, signed-out | `PortalPublicRouter` — token pages + `/crm/join` + `/auth`; everything else the login screen | App.tsx:442-460 | OK |
| Client portal host (client.constructhub.*) | `ClientRouter` — homeowner portal + token document pages only, no marketing chrome, no platform session | App.tsx:468-484, 538-547 | OK (by design) |

`/api/auth/me` (the session probe both `useSignedOut` and the ribbon's signed-in state read):
GET /api/auth/me → server/auth.ts:668. `AppContent` gates the whole tree on the same query
(App.tsx:550), so the header's probe is cache-warm and there is no chrome flash while loading.

---

## Findings

- **F1 (UNCLEAR, 13 route families, nav-but-no-footer):** `/auth`, `/google-business`,
  `/google-ad-fraud`, `/lsa-guide`, `/google-ads-guide(/:section)`, `/free-site-scan`,
  `/invite/:code`, `/databases`, `/property`, `/photos`, `/google-ads`, `/ads-manager`,
  `/ip-tracker`, `/vpn-shield` all render the ribbon header but zero footer. Not dead ends (nav is
  present), but the bottom of each page offers no way forward. Evidence: each page file imports only
  `PublicPageHeader` (grep across client/src/pages); `withRibbon` (App.tsx:259-270) adds header only.
- **F2 (BUG, low severity — signed-in users losing the nav):** signed-in visitors on
  `/free-site-scan` and `/site-scan/report/*` get a chromeless page. `AppContent` returns those two
  before the signed-in/signed-out split (App.tsx:532-533), the page's own `PublicPageHeader` renders
  null when signed in (public-page-chrome.tsx:37), and `SharedSiteScanPage` contains no link at all
  (site-scan.tsx:1281-1307). Only `/free-site-scan` has a bare "ConstructHUB" home link
  (site-scan.tsx:1366-1368). Escape otherwise requires editing the URL.
- **F3 (observation, not a defect):** mobile slide-over lacks the desktop's "Get Started" (signed-out)
  and "Dashboard" (signed-in) buttons — the only persistent way home on a signed-in phone is the logo.
- **No broken links found.** All 31 feature paths (30 `/features/<slug>` + external `/call-assistant`),
  all 6 DFY paths (5 `/done-for-you/<slug>` + external `/reinstatement`), both "see all" links, all 3
  section anchors (`#plans` landing.tsx:471, `#stats` :338, `#coverage` :519), all 8 footer links, the
  cart empty-state links (`/master-class`, `/pricing#services` → pricing.tsx:656), and the auth links
  (`/auth`, `/auth?mode=signup`, `next` param) resolve to real routes in App.tsx. Flagged catalogue
  entries (competitors, reviews) are visible and their flags are true. Badge count source is the
  visitor's own localStorage cart, matching the sheet contents. Checkout endpoint
  `POST /api/stripe/create-cart-checkout` matches exactly (server/stripe.ts:512); Stripe-off dev
  behaviour verified by code: 503 `PaymentsNotConfiguredError` via server/billing/client.ts:23 →
  sendStripeError (stripe.ts:43-46), covered by server/stripe-not-configured.test.ts.
- **Unverifiable in this environment:** rendered HTML/DOM spot-checks (dev server serves the Vite
  shell only; prerender is a production step), and an end-to-end Stripe checkout round-trip (Stripe is
  OFF on dev, by design).
## Lane 6 map — pages 05: landing.tsx + call-assistant-landing.tsx

Audit date 2026-10-04, branch audit/6. Dev server http://127.0.0.1:8306 (signed-out Vite shell; body is the SPA mount, so numbers were verified by SQL against the same DB the API reads, plus `curl /api/databases/counts`).

Routing facts (client/src/App.tsx):
- Signed-out: `/` → LandingPage (App.tsx:288), `/landing` → LandingPage (App.tsx:327), `/call-assistant` → CallAssistantLandingPage (App.tsx:309) — all in PublicRouter.
- Signed-in: `/` → CRM home dashboard (DashboardRouter HomePage, App.tsx:166); `/landing` → LandingPage + HubWidget (App.tsx:654-661); `/call-assistant` → **CrmCallAssistantPage, the CRM Call Assistant app** (App.tsx:206) — the landing page component never renders for a signed-in user on the app host. On a CRM-only host, `/call-assistant` and `/crm/call-assistant` → CallAssistantMovedRedirect → marketingUrl(`/call-assistant…`) (App.tsx:155-160, 401-402). Dual use noted per lane brief.

Counts API ground truth (live `curl /api/databases/counts` + SQL recompute):
`{total:32853, county:3053, city:29800, withPortal:659, verifiedPortals:490, searchable:120}`
SQL: `SELECT jurisdiction_type, count(*), count(*) FILTER (WHERE is_active AND link_status IN ('live','verified','unconfirmed') AND coalesce(nullif(search_url,''),nullif(portal_url,'')) IS NOT NULL), count(*) FILTER (WHERE is_active AND link_status IN ('live','verified') AND link IS NOT NULL) FROM permit_databases GROUP BY jurisdiction_type` → city 29,800 (532/394), county 3,053 (127/96). `SELECT count(DISTINCT state_code) FROM counties` → 51. Note: 32,052 of 32,853 permit_databases rows are `is_active=false` with `link_status='none'`; only 801 rows are active. The total stat counts ALL rows (see Findings).

---

## / and /landing — Home

`client/src/pages/landing.tsx` (LandingPage). Nav ribbon = `<SiteNavBar signedIn={!!user} next="/">` (landing.tsx:269) from client/src/components/site-nav.tsx — **mapped in detail by another lane; presence noted here.** Signed-out it shows logo, Features ▾ / Done-For-You ▾ dropdowns (data-driven from shared/feature-pages + shared/dfy-pages), section links Plans · Results · Coverage, cart (CartSheet), theme toggle, Sign In + Get Started. Signed-in it swaps the auth buttons for a "Dashboard" button (site-nav.tsx:339-352). Ribbon section ids (site-nav.tsx:49-53): plans → `#plans`, stats → `#stats`, coverage → `#coverage` — all three ids exist on this page (landing.tsx:471, 338, 519), and SectionLink smooth-scrolls on `/` or `/landing`, else links `/#id` (site-nav.tsx:64-84).

### Hero (landing.tsx:276-335)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Kicker "Your Complete Business-Building Platform" | static copy | none (static copy in landing.tsx:282) | none | none | read | OK |
| H1 "ConstructHUB — Build Your Business From the Ground Up" | static copy | none (static copy in landing.tsx:283-288) | none | none | read | OK |
| Hero paragraph | static copy | none (landing.tsx:290-292) | none | none | read | OK |
| "Create Your Account" (link-hero-signup) | Link → /auth?mode=signup | goes to signup | landing.tsx:295 | none (route App.tsx:289 → AuthPage) | App.tsx route confirmed | OK |
| "Done-For-You Services" (link-hero-dfy) | Link → /done-for-you | goes to DFY catalogue | landing.tsx:298 | none (route App.tsx:312) | App.tsx route confirmed | OK |
| "Free 60-second website scan" link | Link → /free-site-scan | goes to free scan tool | landing.tsx:304 | none (App.tsx:532 → FreeSiteScanPage) | App.tsx special-case route confirmed | OK |
| "No card needed to sign up" checkmark | static claim | none (landing.tsx:308) | none | none | Verified by code: auth.tsx has no card/payment fields (grep) | OK (claim; trial-without-card not e2e-testable, Stripe off on dev) |
| "Setup in minutes" / "Cancel anytime" / "Turnkey business building available" checkmarks | static claims | none (landing.tsx:309-311) | none | none | read | OK (static marketing claims) |
| Gator image (img-hero-gator) | img | none | landing.tsx:320-331 | none | files exist: client/public/mascot/gator-standing-512.v1.webp + -1024 (ls) | OK |
| Welcome bubble "Welcome in — let's build your business." | static copy (aria-hidden) | none (landing.tsx:319) | none | none | read | OK |

### Stats band — #stats (landing.tsx:338-352)

Data: `usePermitDirectoryCounts()` (client/src/lib/marketing.ts:28) → GET /api/databases/counts (server/routes.ts:476) → `storage.getDatabaseCounts()` (server/storage.ts:274-312) → table `permit_databases` grouped by jurisdiction_type. Rendered with CountUp (landing.tsx:61-124), which shows the real number first and animates only client-side (reduced-motion/SSR/screen-reader safe).

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "32,853 Jurisdictions Listed" (CountUp) | stat | counts ALL rows in permit_databases, active or not | landing.tsx:235,346 | GET /api/databases/counts → storage.ts:274 getDatabaseCounts → permit_databases count(*) (no is_active filter) | Live API 32,853; SQL `SELECT count(*) FROM permit_databases` = 32,853. Directory shows the same rows (getDatabasesFiltered has no is_active filter), so number matches the product's own listing. Caveat: 32,052/32,853 rows are is_active=false, link_status='none' — see Findings | OK (caveat in Findings) |
| "490 Verified Portal Links" (or fallback "3,053 County Offices Listed") | stat | rows with a checked live portal link | landing.tsx:236-238,346 | same endpoint; filter is_active AND link_status IN ('live','verified') AND coalesce(search_url,portal_url) IS NOT NULL (storage.ts:282) | Live API 490; SQL filter recompute = 394 city + 96 county = 490 | OK |
| "51 States + DC Listed" | stat, hard-coded | none — constant 51 | landing.tsx:239 | none (static constant; cross-check `SELECT count(DISTINCT state_code) FROM counties` = 51; permit_databases↔counties join = 51 states) | SQL | OK |
| "12 Pro Tools Built In" | stat | length of GROWTH_TOOLS | landing.tsx:240 | none | client/src/lib/growth-tools.ts TOOLS has 12 entries; SHOW_COMPETITOR_INTEL=true (client/src/lib/features.ts) so none filtered | OK |

### Services — #services (landing.tsx:355-403)

10 cards (11th, Competitor Intelligence, gated by SHOW_COMPETITOR_INTEL=true so visible). Each card: icon, title, description, "How it works" link via `featureIntroPath(key)` (shared/feature-pages/index.ts:111). All keys verified present: permits, media, profileGuard, rankingGrid, gbp, reinstatement, competitors, masterClass, crm (shared/feature-pages/*.ts) → routes App.tsx:310-311. Card 10 "AI Call Assistant" links CALL_ASSISTANT_PATH=/call-assistant (route App.tsx:309 signed-out). One filler cell "See every tool" → /features (landing.tsx:393, route App.tsx:310).

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| card-service-0 "Nationwide Permit Search" + link-service-0 | card + link → feature page "permits" | feature intro page | landing.tsx:137-143 | none | key exists (permits.ts:24); route confirmed | OK |
| card-service-1 "SEO Photo Optimizer" + link | card + link → "media" | feature page | landing.tsx:144-149 | none | key exists (media.ts:30) | OK |
| card-service-2 "GMB Monitor" + link | card + link → "profileGuard" | feature page | landing.tsx:150-155 | none | key exists (profileGuard.ts:39) | OK |
| card-service-3 "GMB Ranking Grid" + link | card + link → "rankingGrid" | feature page | landing.tsx:156-161 | none | key exists (rankingGrid.ts:28) | OK |
| card-service-4 "GMB Locations Manager" + link | card + link → "gbp" | feature page | landing.tsx:162-167 | none | key exists (gbp.ts:28) | OK |
| card-service-5 "GBP Reinstatement" + link | card + link → "reinstatement" | feature page | landing.tsx:168-173 | none | key exists (reinstatement.ts:22); /reinstatement also a direct route (App.tsx:298) | OK |
| card-service-6 "Competitor Intelligence" + link | card + link → "competitors" | feature page | landing.tsx:174-179 | none | key exists (competitors.ts:31); flag true | OK |
| card-service-7 "Master Class" + link | card + link → "masterClass" | feature page | landing.tsx:180-185 | none | key exists (masterClass.ts:22) | OK |
| card-service-8 "Contractor CRM" + link | card + link → "crm" | feature page | landing.tsx:186-191 | none | key exists (crm.ts:38) | OK |
| card-service-9 "AI Call Assistant" + link | card + link → /call-assistant | marketing page | landing.tsx:192-197 | none | route confirmed; title suffix "(coming soon)" currently empty (see below) | OK |
| "Every plan includes the CRM. See every tool" filler (link-services-all-features) | link → /features | features catalogue | landing.tsx:393-396 | none | route App.tsx:310 confirmed | OK |

Note: `callAssistantPricing().comingSoon` is false (no Call Assistant add-on carries `preview` in shared/plans.ts), so the "(coming soon)" suffix renders nothing — consistent with "Launched" comment (plans.ts:348-353).

### AI Call Assistant section (landing.tsx:406 → components/call-assistant-marketing.tsx:224-316)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Panel "Pick who answers" — 6 persona cards (card-persona-<id>) | static + audio | shows Janice, Gabe, Sofia, Maya, Marcus, Ethan; "Hear <name>" plays /persona-samples/<id>.mp3 only after a HEAD probe confirms the file is audio | call-assistant-marketing.tsx:245-271, 110-163; personas from shared/voice-personas.ts | sample fetch HEAD /persona-samples/*.mp3 (static files) | files exist in client/public/persona-samples (6 mp3s); voice ids "verified in Kokoro-82M" per file header — engine claim not independently verifiable | OK |
| Greeting "What callers hear" (text-call-assistant-greeting) | static copy | janice.sampleLine with company blank | call-assistant-marketing.tsx:266-268 | none | read | OK |
| 6 highlight cards (card-call-assistant-highlight-0..5) | static copy | what the product does; spam card embeds "first 500 spam calls each month free" | call-assistant-marketing.tsx:34-65, 274-287 | enforcement server/voice/billing-usage.ts:208 (CALL_ASSISTANT_FREE_SPAM_CALLS) | code + constant | OK |
| ~~Launch price line (text-call-assistant-landing-price) | price | "Solo $99/mo for your first 3 months, then $249/mo — or $1,999/yr" | call-assistant-marketing.tsx:294-297 | shared/plans.ts CALL_ASSISTANT_TIERS solo: introMonthlyCents 9900 ×3, monthlyCents 24900, annualCents 199900 | shared/plans.ts | OK | — **historical (pre-2026-10-08): no launch price exists; the line now reads the separate-service copy from `callAssistantPricing()` (from $249/mo, four tiers 500/1,000/2,000/5,000 minutes)** |
| ~~Tiers line (text-call-assistant-landing-tiers) | price/stat | "Regular prices from $149/mo. Four tiers: Lite (1,000 min, 1 local number), Solo (2,000 min, 1 local number), Crew (5,000 min, 5 local numbers) and Fleet (12,000 min, 20 local numbers). Crew and Fleet pay less per extra minute. The first 500 spam calls each month are free on every tier. An add-on for the Pro, Growth and Agency plans." | call-assistant-marketing.tsx:300-305 | shared/plans.ts tiers + CALL_ASSISTANT_FREE_SPAM_CALLS=500 + availableOn ["pro","growth","agency"] | shared/plans.ts | OK (Lite $1,199/yr confirmed by the owner 2026-10-04) | — **historical (pre-2026-10-08): the tiers are 500 / 1,000 / 2,000 / 5,000 minutes at $249 / $349 / $449 / $999, 1 / 1 / 2 / 5 numbers, 50¢ overage on every tier, no plan required** |
| "See How It Works" (link-call-assistant-learn-more) | link → /call-assistant | the dedicated marketing page | call-assistant-marketing.tsx:308 | none | route confirmed | OK |

### Done-For-You — #done-for-you (landing.tsx:409-468)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| card-dfy-formation + "What's included" (link-dfy-formation) | card + link → dfy page "formation" | DFY service page | landing.tsx:424-430 | none | key exists (shared/dfy-pages/formation.ts:35); route App.tsx:313 | OK |
| card-dfy-gmb + link-dfy-gmb | card + link → "gmbWebsite" | DFY page | landing.tsx:431-437 | none | key exists (gmbWebsite.ts:30) | OK |
| card-dfy-seo + link-dfy-seo | card + link → "seoAds" | DFY page | landing.tsx:438-444 | none | key exists (seoAds.ts:28) | OK |
| "Talk to a sales rep" labels (text-dfy-sales ×3) | badge | SALES_REP_LABEL (services ≥ $1,000 sold via rep, SALES_THRESHOLD_CENTS) | landing.tsx:428,435,442 | refusal enforced at checkout: server/stripe.ts:548-549 sendTalkToSales on server-resolved price ≥ threshold | shared/plans.ts:415 + server code | OK |
| card-dfy-bundle "Complete Business Build … Paid upfront. 4-6 months" | card + CTA links | "Talk to a sales rep" → SALES_HREF /pricing#services; "What's in the build" → dfy "businessBuild" | landing.tsx:447-466 | none | SALES_HREF=/pricing#services (shared/plan-copy.ts:17); anchor id="services" exists on pricing page (pages/pricing.tsx:656); key businessBuild exists (businessBuild.ts:26) | OK |

### Plans — #plans (landing.tsx:471-516)

Every number from shared/plans.ts (verified against the price book, the same table checkout/entitlements use).

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "1-day trial" intro copy | stat | TRIAL_LABEL = 1-day trial | landing.tsx:481 | TRIAL_DAYS=1 (shared/plans.ts:411); trial applied in server/stripe.ts:296 | shared/plans.ts | OK |
| "yearly at 10 times the monthly price" | stat | ANNUAL_MONTHS=10 | landing.tsx:481 | shared/plans.ts:493 | shared/plans.ts | OK |
| Plan cards ×4 (card-plan-starter/pro/growth/agency) | prices | $29 / $79 / $199 / $349 per month + taglines | landing.tsx:486-502 | PLANS[key].monthlyCents 2900/7900/19900/34900 | shared/plans.ts:84-175 | OK |
| Agency note (text-agency-locations) "10 locations included, then per-location pricing" | stat | PLANS.agency.limits.locations=10 | landing.tsx:496-499 | limits.locations 10 + AGENCY_LOCATION_BANDS | shared/plans.ts | OK |
| Agency-modules line (text-agency-modules) "Only the Agency plan includes the Google Ads & LSA manager, Cloudflare + Google Search Console and Domains + Gmail alerts." | stat | AGENCY_ONLY_MODULES via planForModule | landing.tsx:504-506 | modules agency-only in PLANS | shared/plans.ts:167-173, 479-484 | OK |
| "See Plans & Pricing" (link-plans-pricing) | link → /pricing | pricing page | landing.tsx:508 | none | route App.tsx:294 confirmed | OK |
| "Talk to a sales rep" (link-plans-sales) | link → /pricing#services | services/inquiry section | landing.tsx:511 | none | anchor id="services" confirmed (pricing.tsx:656) | OK |

### Coverage — #coverage (landing.tsx:519-541)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Coverage summary (text-coverage-summary) | stat copy | "32,853 county and city jurisdictions listed across all 50 states and DC, 490 with a verified permit portal link" (counts interpolated) | landing.tsx:526-530 | same /api/databases/counts query | Live API + SQL: total 32,853; verifiedPortals 490; permit_databases JOIN counties = 51 distinct state_codes | OK (same caveat as stats total) |
| 20-state checklist (Washington … Indiana) | static list | illustrative subset of states | landing.tsx:214-220, 532-538 | none | static; caption below states "All 50 states + DC listed" | OK (static marketing presentation) |
| Caption "All 50 states + DC listed — portal links shown only once checked" | static copy | none | landing.tsx:539 | none | "checked" = link_status verified/live per storage.ts filter | OK |

### Final CTA (landing.tsx:544-563)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Create Your Account" (link-cta-signup) | link → /auth?mode=signup | signup | landing.tsx:555 | none | route confirmed | OK |
| "Talk to a sales rep" (link-cta-consulting) | link → /pricing#services | sales inquiry | landing.tsx:558 | none | anchor confirmed | OK |

### Footer (landing.tsx:566-587)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| link-footer-email mailto:support@constructhub.us | mailto | opens email client | landing.tsx:571 | none | read | OK |
| link-footer-features → /features | link | catalogue | landing.tsx:573 | none | route confirmed | OK |
| link-footer-dfy → /done-for-you | link | catalogue | landing.tsx:575 | none | route confirmed | OK |
| link-footer-call-assistant → /call-assistant | link | marketing page | landing.tsx:577 | none | route confirmed | OK |
| link-footer-terms → /terms, link-footer-privacy → /privacy | links | legal pages | landing.tsx:579,581 | none | routes App.tsx:326,325 confirmed | OK |
| Copyright line | dynamic copy | © current year ConstructHUB | landing.tsx:583 | none | copyrightNotice() (lib/marketing.ts:11) | OK |
| FooterGuides (footer-guides): Google Ads Guide / LSA Guide / Click Fraud: What We Observed / Google Business Profile Tools | links → /google-ads-guide, /lsa-guide, /google-ad-fraud, /google-business | guide pages | landing.tsx:585 → components/public-page-chrome.tsx:51-69 | none | all four routes confirmed (App.tsx:303, 306, 307, 299) | OK |

---

## /call-assistant — AI Call Assistant landing

`client/src/pages/call-assistant-landing.tsx` (CallAssistantLandingPage), signed-out only in practice: PublicRouter route App.tsx:309. Signed-in users on the app host get CrmCallAssistantPage at the same path (App.tsx:206) — **dual use; the CRM app itself is another lane's**. Chrome: PublicPageHeader/PublicPageFooter render nothing unless signed out (public-page-chrome.tsx:19-22, 36-45, 71-93). The component is nonetheless signed-in-aware: primaryCta switches to "Open your Call Assistant" → /call-assistant (call-assistant-landing.tsx:215-217), and TalkToSalesDialog prefills from the account (talk-to-sales.tsx:55-62). Meta description from ROUTE_META["/call-assistant"] (shared/route-meta.ts:28-32), set client-side by useMetaDescription.

### Hero (call-assistant-landing.tsx:230-270)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "New" kicker + ComingSoonTag (badge-call-assistant-coming-soon) | badge | shows "Coming soon" only while every tier add-on has `preview` — currently none does, so renders null | call-assistant-landing.tsx:234-237; call-assistant-marketing.tsx:207-217 | shared/plans.ts ADDONS — no `preview` flag on any call_assistant_* add-on | grep shared/plans.ts | OK |
| H1 (text-ca-title) "An AI Receptionist That Picks Up Every Call" | static copy | none | call-assistant-landing.tsx:238-240 | none | read | OK |
| Intro (text-ca-intro) "Pick Janice, Gabe or one of four other voices…" (6 personas, 24/7, CRM) | static copy | none | call-assistant-landing.tsx:241-245 | none | 6 personas in shared/voice-personas.ts:14 | OK |
| Primary CTA (link-ca-signup-hero or link-ca-open-dashboard-hero) | link | signed-out → /auth?mode=signup&next=%2Fcall-assistant; signed-in → /call-assistant | call-assistant-landing.tsx:215-217, 247 | none | route + query confirmed | OK |
| "Talk to a sales rep" (button-ca-sales-hero) | button | opens TalkToSalesDialog topic "AI Call Assistant" → POST /api/seo-inquiry | call-assistant-landing.tsx:218-222, 248, 567 | POST /api/seo-inquiry (server/routes.ts:3306, zod-validated, emails sales inbox) | handler exists; body {name,email,phone,services:[topic],message} matches schema (routes.ts:3310) | OK |
| ~~Hero price line (text-ca-hero-price) | price | "Regular prices from $149/mo (Lite). Solo: $99/mo for your first 3 months, then $249/mo — or $1,999/yr. Crew and Fleet for busier phones, at a lower rate per extra minute. Compare the four tiers" | call-assistant-landing.tsx:250-255 | shared/plans.ts CALL_ASSISTANT_TIERS: lite monthlyCents 14900; solo introMonthlyCents 9900/introMonths 3, monthly 24900, annual 199900; crew/fleet overageCentsPerMinute 5 vs 10 | shared/plans.ts:283-288 | OK | — **historical (pre-2026-10-08): no intro price; "a separate service, from $249/mo" with the four current tiers (`callAssistantPricing()`)** |
| "Compare the four tiers" | anchor → #pricing | scrolls to pricing section | call-assistant-landing.tsx:254 | none | section id="pricing" exists (call-assistant-landing.tsx:436) | OK |
| Greeting bubble + GabeAvatar | static/audio | gabe.sampleLine ("Thank you for calling [Your Company], this is Gabe…") | call-assistant-landing.tsx:263-264 | none | shared/voice-personas.ts:35; GabeAvatar at components/mascot.tsx:43 | OK |

### Spam section — #spam (call-assistant-landing.tsx:273-311)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Headline (text-ca-spam-headline) "You never answer a spam call again" + lead + forwarding note (text-ca-spam-forwarding) | static copy | CALL_ASSISTANT_SPAM (shared/plan-copy.ts:301-308); forwarding note honestly says no-answer forwarding rings you first | call-assistant-landing.tsx:282-286 | screen: server/voice/internal-calls.ts; strikes: server/voice/spam.ts SPAM_STRIKES_TO_BLOCK=2, strikeAt 0.95 | server files exist | OK |
| "500 free spam calls every month" callout (text-ca-spam-free) | stat | price.freeSpamCalls = "500" | call-assistant-landing.tsx:287-290 | CALL_ASSISTANT_FREE_SPAM_CALLS=500 (shared/plans.ts:308); enforced server/voice/billing-usage.ts:136,208 | shared/plans.ts + server code | OK |
| Step list item-ca-spam-1/2/3 (screened / "Two strikes, blocked before it's answered" / "Every one in your spam report") | static copy | what the spam filter does, incl. weekly spam report email | call-assistant-landing.tsx:292-308 | server/voice/spam.ts, server/voice/spam-report.ts | server files exist | OK |

### How it works — #how-it-works (call-assistant-landing.tsx:314-330)

4 numbered steps (step-ca-1..4): "Pick who answers" (names from personaNames), "Get a local number", "Forward your lines", "Tune it and go live". Static copy describing the Studio/Simulator flow; matches docs/call-assistant/SPEC.md per file header. No numbers to verify. OK.

### The voices — #voices (call-assistant-landing.tsx:333-349)

6 PersonaCards (card-persona-<id>) from VOICE_PERSONA_LIST: Janice, Gabe, Sofia, Maya (women's voices), Marcus, Ethan (men's) — matches copy "Women and Men Voices". "Hear <name>" sample buttons probe HEAD /persona-samples/<id>.mp3 and render only if audio (call-assistant-marketing.tsx:84-127); all 6 files exist in client/public/persona-samples. Kokoro-82M voice-id verification is an engine-lane claim (voice/personas.json mirror, shared/voice-personas.ts:5-11 header) — not independently verifiable from the UI. OK.

### Highlights (call-assistant-landing.tsx:352-364)

6 cards from CA_HIGHLIGHTS (call-assistant-marketing.tsx:34-65): local number, forwarding, Agent Studio, CRM, spam (embeds the 500-free-spam line), 24/7. Static copy consistent with the price book and server voice modules. OK.

### Agent Studio — #agent-studio (call-assistant-landing.tsx:367-394)

12 cards (card-ca-studio-0..11) listing Studio controls; per the file header every behaviour claim maps to docs/call-assistant/SPEC.md §3 and server/voice/* (prompt-compiler, escalations, spam, leads). Static copy; no numeric claims. OK (by code reference).

### Calls & CRM — #calls (call-assistant-landing.tsx:397-433)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| 4 AFTER_CALL lines (CRM client + pipeline project, "Call Assistant" lead source, escalations by text/email with reminders, spam calls ping nobody) | static copy | none | call-assistant-landing.tsx:84-89, 405-411 | server/voice/leads.ts (callAssistantLeadSourceId, findCustomerByPhone), server/voice/escalations.ts | server files exist | OK |
| Call-record panel (panel-ca-call-record): 9 CALL_FIELDS (Outcome … Recording) | static list | what voice_calls rows hold (field names only, no sample data) | call-assistant-landing.tsx:79-82, 413-431 | voice_calls table (shared/schema.ts:2696) | schema confirmed | OK |

### Pricing — #pricing (call-assistant-landing.tsx:436-516)

> **Historical (audited 2026-10-04; superseded 2026-10-08).** The rows below record the tiers as they were when this
> lane was audited. Since 2026-10-08 the AI Call Assistant is a SEPARATE SERVICE (no plan includes it, none is needed)
> with four tiers at 500 / 1,000 / 2,000 / 5,000 minutes for $249 / $349 / $449 / $999 a month (yearly 11 ×: $2,739 /
> $3,839 / $4,939 / $10,989), 1 / 1 / 2 / 5 numbers, 50¢ a minute overage on every tier, no intro price, and "talk to a
> sales rep" above 5,000 minutes; the section links to `/pricing#call-assistant`, not `#add-ons`. The figures still come
> from `callAssistantPricing()` / CALL_ASSISTANT_TIERS; every price below has been re-mapped by the test suite
> (`server/pricing-copy.test.ts`, `server/feature-pages.test.ts`) and this table has not been re-walked in a browser.

All figures via `callAssistantPricing()` (shared/plan-copy.ts:204-236) from CALL_ASSISTANT_TIERS (shared/plans.ts:283-288).

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Four Tiers. Pick Your Call Volume." + summary (text-call-assistant-price) | stat | tierCountWord="four"; "regular prices from $149/mo. Solo starts at $99/mo for your first 3 months, then $249/mo — or $1,999/yr" | call-assistant-landing.tsx:440-444 | 4 tiers; lite 14900; solo intro 9900×3 / 24900 / 199900 | shared/plans.ts | historical (superseded 2026-10-08; see the note above) |
| Tier cards (card-ca-tier-lite/solo/crew/fleet) | prices | Lite $149/mo or $1,199/yr · 1,000 min · 1 number · 10¢/min · "about 500 calls a month (estimate)". Solo $99 intro shown with terms "for your first 3 months, then $249/mo — or $1,999/yr" · 2,000 min · 1 number · 10¢ · ~1,000 calls. Crew $449 · $3,599/yr · 5,000 min · 5 numbers · 5¢ + "Lower overage" badge · ~2,500 calls. Fleet $799 · $6,399/yr · 12,000 min · 20 numbers · 5¢ + badge · ~6,000 calls | call-assistant-landing.tsx:445-480; text-ca-tier-price-*/terms-*/overage-* | CALL_ASSISTANT_TIERS: (lite 14900/119900/1000/1/10), (solo 24900/199900/2000/1/10, intro 9900×3), (crew 44900/359900/5000/5/5), (fleet 79900/639900/12000/20/5); estimates = minutes ÷ CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL (2) rounded to 50 (plan-copy.ts:144) and labelled "(estimate)" | shared/plans.ts | historical (superseded 2026-10-08; see the note above) |
| "On every tier" panel (card-ca-every-tier) | prices/stats | first 500 spam calls free; overage "$0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet"; extra local numbers $5/mo each; tier switches prorated | call-assistant-landing.tsx:481-495 | CALL_ASSISTANT_FREE_SPAM_CALLS=500; overageCentsPerMinute 10/10/5/5; ADDONS.call_number monthlyCents 500; exclusiveGroup switch prorated (server/billing/order.ts applyExclusiveSwitch, plans.ts:231-234) | shared/plans.ts | historical (superseded 2026-10-08; see the note above) |
| "An add-on for the Pro ($79/mo), Growth ($199/mo) and Agency ($349/mo) plans, not a plan of its own." (text-ca-plans) + link-ca-pricing → /pricing#add-ons | stat + link | availableOn = pro/growth/agency; plan prices from PLANS | call-assistant-landing.tsx:496-508 | ADDONS[t].availableOn=["pro","growth","agency"]; PLANS monthlyCents 7900/19900/34900 | shared/plans.ts | historical (superseded 2026-10-08: the section links to /pricing#call-assistant) |
| Primary + sales CTAs (link-ca-signup-pricing / button-ca-sales-pricing) | link/button | same recipes as hero | call-assistant-landing.tsx:511-514 | POST /api/seo-inquiry for the sales button | confirmed above | historical (superseded 2026-10-08; see the note above) |

### FAQ — #faq (call-assistant-landing.tsx:519-535)

13 `<details>` items (faq-ca-0..12), all answers assembled from shared/plan-copy.ts helpers or static product copy:
- AI disclosure, recording/consent (static; "Studio warns you before you turn it off" — code claim, not re-verified end-to-end: the recording-notice default lives in the voice profile, server/voice/profile*.ts).
- Forwarding, keeping numbers ("extra numbers are $5/mo each" = call_number), where numbers come from, Simulator, cancellation (number released — server/voice/number-release.ts), failed payment (assistant paused — ADDON_MODULE_RUN_STATUSES), yearly note (Solo $1,999/yr etc. from annualCents), "What counts as a minute" (started minutes; matches plan-copy.ts:336-338), spam minutes (500 free + blocked calls cost nothing; matches billing-usage.ts), "Which tier do I need" (estimates at 2 min/call), "What won't the assistant do" (static: no booking, no outbound, English only).
- A 14th "When can I buy it?" item appears only while `comingSoon` — currently omitted (no preview tiers). Verified.
All price-bearing answers trace to the price book. OK.

### In depth — #in-depth (call-assistant-landing.tsx:538-546)

4 long paragraphs (text-ca-in-depth). Per the file header (call-assistant-landing.tsx:91-104) every behavioural claim names its implementing file (server/voice/prompt-compiler.ts, shared/voice-profile.ts DEFAULT_INTAKE_QUESTIONS, server/voice/escalations.ts, server/voice/spam.ts, server/voice/leads.ts, voice/brain.py + server/voice/brain.ts). Spot-checked: spam.ts, escalations.ts, leads.ts, billing-usage.ts all exist. Intake-question order and "never reads the digits" not re-verified line-by-line. OK by code reference.

### Final CTA (call-assistant-landing.tsx:549-564)

"Let Every Call Be Answered" + price recap (from $149/mo Lite, Solo intro, Crew/Fleet lower overage, spam screened, add-on for Pro/Growth/Agency) + primary CTA (link-ca-signup-cta / link-ca-open-dashboard-cta) + sales button (button-ca-sales-cta) → TalkToSalesDialog. All figures from the price book as verified above. OK.

### Footer (call-assistant-landing.tsx:566)

PublicPageFooter (signed-out only): Home, Features, Done-For-You, AI Call Assistant, support@constructhub.us, Terms, Privacy + FooterGuides 4 links + copyright. All target routes confirmed in App.tsx. OK.

### Talk-to-sales dialog (call-assistant-landing.tsx:567 → components/talk-to-sales.tsx)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| dialog-talk-to-sales form (input-sales-name/email/phone/company/need, button-sales-done) | dialog → POST | sends {name, email, phone\|null, services:["AI Call Assistant"], message\|null} via apiRequest POST /api/seo-inquiry | talk-to-sales.tsx:41-52 | POST /api/seo-inquiry (server/routes.ts:3306; zod schema name/email required, services/message/phone optional; sendWithFallback emails sales inbox; rate limit 5/hr) | handler + schema match the body | OK |

### Cart/checkout path (prices on both pages flow here)

Cart button lives in SiteNavBar (site-nav.tsx:337, CartSheet). Checkout: `apiRequest("POST", "/api/stripe/create-cart-checkout", { items })` (client/src/components/cart-sheet.tsx:45) → server/stripe.ts:512, which resolves every price server-side from the catalog/DB and refuses ≥ $1,000 with the talk-to-sales 409 (stripe.ts:522-549). With Stripe off on dev the route answers 503 "Payments aren't configured yet" before touching the SDK — expected and covered by server/stripe-not-configured.test.ts. **Verified by code** (e2e purchase not possible on dev).

---

## Findings

1. **Stats total counts inactive rows (OK-with-caveat / owner decision).** "Jurisdictions Listed" = 32,853 counts every `permit_databases` row with no `is_active` filter (server/storage.ts:274-295), while 32,052 of 32,853 rows are `is_active=false` + `link_status='none'` and only 801 rows are active. The number is at least consistent — the public /databases directory (`getDatabasesFiltered`, storage.ts:217-272) also lists all rows without an is_active filter, so the page advertises exactly what the product lists. But the coverage copy next to it says "32,853 county and city jurisdictions listed … 490 with a verified permit portal link", i.e. the headline metric is ~97.5% rows that have no portal link and are marked inactive internally. If "listed" is meant to mean "live/supported jurisdictions", the filter is wrong; if it means "directory entries", the label is doing a lot of work. **Not counted as a BUG** because a real source exists and the directory agrees; flagging for the owner to decide the honest label.
2. **Lite tier annual price — resolved.** The owner confirmed $1,199/yr on 2026-10-04 ("thats fine"); shared/plans.ts says so.
3. **"Pro Tools Built In" = 12 counts a different list than the page's own services grid.** The stat (GROWTH_TOOLS, growth-tools.ts — 12 dashboard tools incl. IP Tracker, VPN Shield, Click Guard, Master Class variants) is displayed one section above a 10-card services grid built from a different array (landing.tsx:137-198). Both are individually honest, but a visitor comparing "12 Pro Tools" against 10 visible cards has no way to reconcile them; and the AI Call Assistant is marketed as a built tool on the page while being deliberately excluded from GROWTH_TOOLS (it sits in UPCOMING_TOOLS, growth-tools.ts:127-141, and is an add-on, not an included tool). Consider a footnote or aligning the lists.
4. **"No card needed to sign up" / "Cancel anytime"** (landing.tsx:308-310) are static claims. Verified by code that the auth page collects no card (client/src/pages/auth.tsx has no payment fields) and checkout/trial are separate steps; not e2e-verified because Stripe is off on dev (503 expected). Also the 1-day trial is enforced at subscription creation (TRIAL_DAYS=1, server/stripe.ts:296).
5. **No dead links found on either page.** Every Link/href on both pages was confirmed against client/src/App.tsx routes (or file existence for /mascot/* and /persona-samples/*), and both pricing anchors (#services, #add-ons) exist in client/src/pages/pricing.tsx:656, 588. mailto:support@constructhub.us is a static address.
6. **No "coming soon" badge despite 'New' kicker** — intentional: ComingSoonTag renders only while all Call Assistant add-ons carry `preview` (none do; plans.ts:348-353 "the call assistant is live not coming soon"). The /call-assistant FAQ's "When can I buy it?" item is likewise correctly omitted. Noted so no one "fixes" it back.
7. **Dual use of /call-assistant confirmed:** signed-out → this landing page (App.tsx:309); signed-in on the app host → CrmCallAssistantPage (App.tsx:206, the CRM app — another lane's); CRM-host links redirect to the marketing URL (App.tsx:155-160). The landing component's signed-in CTA ("Open your Call Assistant" → /call-assistant) therefore lands on the CRM app for signed-in users, which is the intended behaviour.
8. **Unverifiable from the UI lane:** Kokoro-82M voice-id validity (claimed verified by the engine lane, shared/voice-personas.ts:5-11); the recording-notice Studio warning; per-state recording-consent advice ("check your state's rules" — appropriately hedged copy); spam-classifier accuracy; Agency per-location band prices (mentioned only as "then per-location pricing" on the landing card — details live on /pricing, another lane).

### Element counts
- Home page: 55 element rows across 9 container tables (hero 10, stats 4, services 11, call-assistant section 6, done-for-you 5, plans 7, coverage 3, final CTA 2, footer 7) → all OK (2 OK-with-caveat noted above), 0 BUG, 0 DEAD, 0 UNCLEAR.
- /call-assistant landing: 28 mapped items — 20 element rows across 6 tables (hero 8, spam 3, calls-CRM 2, pricing 5, talk-to-sales 1, cart/checkout 1) + 8 prose-mapped containers (how-it-works, voices, highlights, agent-studio, FAQ, in-depth, final CTA, footer) → all OK (incl. the Lite-placeholder price flagged in Findings 2), 0 BUG, 0 DEAD, 0 UNCLEAR.
- Total: 83 elements → 83 OK, 0 BUG, 0 UNCLEAR, 0 DEAD. One REPORT item (inactive-row total labelling; the Lite $1,199/yr placeholder was confirmed by the owner 2026-10-04) and one consistency note (12-vs-10 tool counts) are in Findings.
## /pricing — Plans & Pricing

**What the page is:** the public price book page: 4 plan cards (Starter/Pro/Growth/Agency) with a Monthly/Annual toggle, a generated plan-comparison table, an Agency per-location band table + quote calculator, an add-ons area (AI Call Assistant 4 tier cards + add-on price table), a done-for-you services grid (all "Talk to a sales rep"), and a change-plan confirm dialog. Renders signed-in (App.tsx:176, inside the dashboard frame) and signed-out (App.tsx:294, with `PublicPageHeader`/`PublicPageFooter` chrome and the cart in the header). Signed-in users additionally see a current-plan banner and in-place plan switching; signed-out users get "Choose X" → `/auth?next=/pricing` then Stripe Checkout.

**Price-source chain (verified):** every number on the page is a compile-time import of `shared/plans.ts` via `client/src/lib/pricing-display.ts` — no client-side hard-coded price, no page fetch of a prices API. The same `shared/plans.ts` is the server's only price source: `server/billing/order.ts:176 checkoutLineItems` → `server/billing/prices.ts:77/91/120/157` (Stripe Price lookup keys that embed the cents, e.g. `chub_v1_plan_pro_month_7900`, created idempotently on first use). The one price API surface is `GET /api/stripe/plans` (server/stripe.ts:219 `priceBook()`), curl-verified on dev to return exactly the shared/plans.ts content. `/api/plans` and `/api/catalog` do **not** exist — both return HTTP 200 but the body is the SPA `index.html` (Vite dev fallback), not JSON. Entitlements/plan-limit enforcement reads the same `PLANS[k].limits` (server/entitlements.ts:176).

**Recompute:** all displayed figures were recomputed with `npx tsx` against `shared/plans.ts` (prices, annual = 10× monthly, savings = 2 months, agency quotes at 10/25/60/500/501 locations, add-on 10× check, tier annual exceptions). All match. Dev server probes: `GET /pricing` 200 (Vite shell; page is client-rendered in dev, so element presence is code-verified), `GET /api/stripe/plans` 200 JSON = price book, `GET /api/stripe/subscription` signed-out = `{plan:"free",status:"inactive"}`, `POST /api/stripe/create-checkout` unauthenticated = 401 `{"message":"Login required"}` (route live; stops before any Stripe call). Stripe is OFF on dev → any authenticated checkout would 503 "Online payments aren't set up…" (server/billing/client.ts:11-17 `PaymentsNotConfiguredError`); checkout paths below are **Verified by code** + server tests (server/stripe-billing.test.ts, server/stripe-not-configured.test.ts).

### Hero & billing toggle

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Kicker "Pricing" | text | Section eyebrow above the title | client/src/pages/pricing.tsx:275 | — | code | OK |
| "Plans & pricing" / `text-pricing-title` | heading | Page title | pricing.tsx:276 | — | code | OK |
| "A new account starts any plan with a 1-day free trial. Cancel before it ends and you pay nothing. CRM included on every plan." / `text-trial` | claim | Trial promise | pricing.tsx:279 | `TRIAL_DAYS=1` (shared/plans.ts:411); granted at checkout only when `trialEligible` (server/billing/sync.ts) and no Stripe history (server/stripe.ts:265-276) → `trial_period_days: 1` | tsx recompute TRIAL_DAYS=1; code trace stripe.ts:296 | OK |
| "Pick the plan that fits your crew." / `text-pricing-bubble` | text (decorative) | Mascot speech bubble | pricing.tsx:315 | — | code | OK |
| Billing period radiogroup / `toggle-interval` | toggle container | Switches every price on the page between monthly and annual | pricing.tsx:283-307 | — (client state; initial value read once from `?interval=year`, pricing.tsx:106-107) | code | OK |
| "Monthly" / `button-interval-month` | radio button | Shows monthly prices | pricing.tsx:289-306 | — | code | OK |
| "Annual" + "2 months free" pill / `button-interval-year` | radio button + badge | Shows annual prices (10× monthly); badge claims 2 months free | pricing.tsx:289-306 (`monthsFree` = `annualMonthsFree()`, client/src/lib/pricing-display.ts:37) | Annual = `ANNUAL_MONTHS=10` × monthly (shared/plans.ts:493) → savings = exactly 2 months for all 4 plans | tsx recompute: savings 5800/15800/39800/69800 = 2× monthly for every plan; badge math ✓ | OK |

### Current-plan banner (signed-in with a live subscription only)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Banner / `banner-current-plan` + badge "Your plan: X · yearly" / `badge-current-plan` | badge | Shows the stored plan name + interval; legacy keys map to nearest new plan ("Your Platinum features match this plan" / `text-legacy-match`) | pricing.tsx:328-339 | `GET /api/stripe/subscription` → server/stripe.ts:223 → `subscriptions` row (`plan`, `status`, `billingInterval`) via `subscriptionSummary` (server/billing/sync.ts); legacy map `LEGACY_PLAN_MAP` (shared/plans.ts:422) | curl (signed-out → `plan:"free"`, banner hidden); code | OK |
| "Your last payment didn't go through…" alert | alert (role=alert) | Shown for past_due/unpaid/incomplete | pricing.tsx:340-342 | Same GET; `PAYMENT_PROBLEM_STATUSES` (pricing-display.ts:263) matches server `PAYMENT_NEEDED_STATUSES` (shared/plans.ts:447) | code | OK |
| "Manage billing" / `button-manage-subscription` | button | Opens the Stripe billing portal | pricing.tsx:343-348; mutation pricing.tsx:134-138 | `POST /api/stripe/create-portal` {} → server/stripe.ts:416 → `stripe.billingPortal.sessions.create`, `return_url /pricing`; requires `subscriptions.stripeCustomerId` (400 "No subscription found" otherwise) | Verified by code (Stripe off → 503 expected on dev) | OK |

### Plan cards (`#plans`)

All four cards render from one map over `PLAN_KEYS`; prices via `planPriceCents(PLANS[key], interval)` (client/src/lib/pricing-display.ts:27 → shared/plans.ts `monthlyCents`/`annualCents`). Ribbon labels: Pro "Recommended" (pricing.tsx:60 `PLAN_RIBBON`), Agency "For agencies" — marketing labels, no math.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Card header Starter "One Google profile, managed and protected." (`card-plan-starter`) | card header | Name, tagline, decorative index "01" | pricing.tsx:362-381 | — | code | OK |
| Ribbon "Recommended" (Pro) / "For agencies" (Agency) | badge | Visual emphasis; no discount attached | pricing.tsx:363-367, 60 | — | code | OK |
| Starter price `$29/mo` or `$290/yr` / `text-price-starter` | price | Big plan price | pricing.tsx:382-385 | `PLANS.starter` 2900/29000 (shared/plans.ts:86); checkout line item `chub_v1_plan_starter_{interval}_2900|29000` (server/billing/prices.ts:77) | tsx recompute ✓; `GET /api/stripe/plans` ✓ | OK |
| Pro price `$79/mo` or `$790/yr` / `text-price-pro` | price | Big plan price | pricing.tsx:382-385 | `PLANS.pro` 7900/79000 (shared/plans.ts:107); checkout spec `chub_v1_plan_pro_…_7900|79000` | tsx recompute ✓ | OK |
| Growth price `$199/mo` or `$1,990/yr` / `text-price-growth` | price | Big plan price | pricing.tsx:382-385 | `PLANS.growth` 19900/199000 (shared/plans.ts:130) | tsx recompute ✓ | OK |
| Agency price `$349/mo` or `$3,490/yr` / `text-price-agency` | price | Base price (10 locations included; extras via calculator) | pricing.tsx:382-385 | `PLANS.agency` 34900/349000 (shared/plans.ts:153); extra locations billed as a graduated tiered Stripe price `chub_v1_agencyloc_{interval}_…` (prices.ts:120-135, bands ×10 on yearly) | tsx recompute ✓; tier math mirrors `agencyMonthlyCents` (shared/plans.ts:188) | OK |
| Starter price note / `text-price-note-starter` | footnote | Yearly: "$24.17/mo billed yearly · save $58"; monthly: "or $290/yr (2 months free)" | pricing.tsx:386-395 | `annualSavingsCents` = monthly×12 − annual (pricing-display.ts:32) | tsx: 2900×12−29000 = 5800 = $58 = exactly 2 months ✓ | OK |
| Pro price note / `text-price-note-pro` | footnote | "$65.83/mo billed yearly · save $158" / "or $790/yr (2 months free)" | pricing.tsx:386-395 | same | tsx: 94800−79000 = 15800 = $158 ✓ | OK |
| Growth price note / `text-price-note-growth` | footnote | "$165.83/mo billed yearly · save $398" / "or $1,990/yr (2 months free)" | pricing.tsx:386-395 | same | tsx: 238800−199000 = 39800 = $398 ✓ | OK |
| Agency price note / `text-price-note-agency` | footnote | Save $698 / "or $3,490/yr" + "10 locations included, then $15 down to $7 per location" | pricing.tsx:386-395 (band range = max/min of `AGENCY_LOCATION_BANDS` cents 1500/1000/700) | bands (shared/plans.ts:178-183); server bills same bands via tiered price | tsx: 418800−349000 = 69800 = $698 ✓; "$15 down to $7" ✓ | OK |
| Feature bullets (8 Starter / 10 Pro / 9 Growth / 10 Agency) | claims list | Marketing bullets, e.g. Starter "100 permit searches / month", Pro "500", Growth "5,000", Agency "2 ranking-grid credits and 1 Site Scan per location / month" | pricing.tsx:398-405 (`plan.features`, shared/plans.ts:88-166) | Server enforces the same `PLANS[k].limits` via `getEntitlements` (server/entitlements.ts:176) | spot-checked every numeric bullet against `limits` (locations 1/1/3/10, guard 15/15/15/30 min, grid 5/15/30/per-loc 2, scans 2/5/15/per-loc 1, competitor 0/2/8/20, seats 1/3/10/10, texts 0/500/1500/1500) — all match | OK |
| "Choose Starter" / `button-subscribe-starter` (label varies: "Current plan", "Switch to monthly billing", "Switch to Pro") | button | Signed out → `/auth?next=/pricing`; signed in without sub → Stripe Checkout; signed in with sub → confirm dialog → change-plan in place | pricing.tsx:407-416, `choosePlan` pricing.tsx:199-203, body `{plan,interval}` via `planBody` pricing.tsx:87 | `POST /api/stripe/create-checkout` → server/stripe.ts:240 → `parsePlanOrder` (server/billing/order.ts:159; prices ignored from client) → `checkoutLineItems` (order.ts:176) → Stripe subscription checkout; 409 `has_subscription` if already subscribed → client falls back to `POST /api/stripe/change-plan` (stripe.ts:317 → `subscriptionChange` order.ts:224, proration `always_invoice`, `error_if_incomplete`); success redirect `/pricing?success=true` | curl 401 probe (route live); Verified by code + server/stripe-billing.test.ts | OK |
| "Choose Pro" / `button-subscribe-pro` | button | Same flow for Pro | pricing.tsx:407-416 | same | same | OK |
| "Choose Growth" / `button-subscribe-growth` | button | Same flow for Growth | pricing.tsx:407-416 | same | same | OK |
| "Choose Agency" / `button-subscribe-agency` (agency body adds `locations: currentAgencyLocations`) | button | Same flow for Agency with location count | pricing.tsx:407-416, 359 | same + `parseAgencyLocations` (order.ts:119: integer ≥1, clamped ≥10, >500 → 409 `talk_to_sales`) | same | OK |
| "Price more than 10 locations ↓" / `link-agency-calculator` | link (scroll) | Scrolls to the Agency calculator section (`#agency`) | pricing.tsx:417-421 (`jumpTo`) | — | code; `id="agency"` at pricing.tsx:473 | OK |
| Footnote "No free plan. A new account's first plan starts with the 1-day trial. Prices in USD." | footnote | Policy line | pricing.tsx:428-430 | matches `TRIAL_DAYS=1`, no free plan in price book | tsx recompute ✓ | OK |

### Comparison table (`#comparison`, `table-plan-comparison`)

Header row repeats the 4 plan prices via the same `planPriceCents` (pricing.tsx:442-449) — recomputed ✓ identical to the cards. Body is generated from `comparisonSections()` (pricing-display.ts:187) straight out of `PLANS[k].limits`/`modules` — the same table `server/entitlements.ts` enforces, so page claims can't drift from the gates.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Header prices Starter/Pro/Growth/Agency (4 cells) | prices | Repeat of card prices at current interval | pricing.tsx:442-449 | same as plan cards | tsx recompute ✓ | OK |
| Row "Google Business Profile locations" / `row-compare-locations` (cells `cell-compare-locations-*`) | compare row | 1 / 1 / 3 / "10 included, then per location" | pricing.tsx:457-465; pricing-display.ts:192-193 | `limits.locations` 1/1/3/10 | tsx ✓ | OK |
| Row "Profile Guard edit checks" / `row-compare-guard` | compare row | "Every 15 min" ×3, Agency "Every 30 min" | pricing-display.ts:194 | `limits.guardCadenceMinutes` 15/15/15/30 | tsx ✓ | OK |
| Row "AI review replies publish automatically" / `row-compare-autoPublish` | compare row | ✗ / ✓ / ✓ / ✓ | pricing-display.ts:195 | `limits.autoPublishAiReplies` false/true/true/true | tsx ✓ | OK |
| Row "Review reply templates" / `row-compare-templates` | compare row | 5 / 20 / 20 / 50 | pricing-display.ts:196 | `limits.reviewTemplates` | tsx ✓ | OK |
| Row "Ranking-grid credits" / `row-compare-grid` | compare row | "5 / mo" / "15 / mo" / "30 / mo" / "2 per location / mo" | pricing-display.ts:197-198 | `gridCredits` 5/15/30/0, `gridCreditsPerLocation` agency 2 | tsx ✓ | OK |
| Row "Click Guard + IP Tracker + VPN Shield" / `row-compare-protectedSites` | compare row | ✗ / "1 website" / "3 websites" / "10 websites" | pricing-display.ts:204 | `protectedSites` 0/1/3/10 | tsx ✓ | OK |
| Row "Site Scans" / `row-compare-siteScans` | compare row | "2 / mo" / "5 / mo" / "15 / mo" / "1 per location / mo" | pricing-display.ts:205-206 | `siteScans` 2/5/15/0, `siteScansPerLocation` agency 1 | tsx ✓ | OK |
| Row "Competitor Intel scans" / `row-compare-competitorScans` | compare row | ✗ / "2 / mo" / "8 / mo" / "20 / mo" | pricing-display.ts:207 | `competitorScans` 0/2/8/20 | tsx ✓ | OK |
| Row "Permit searches" / `row-compare-permitSearches` | compare row | "100 / mo" / "500 / mo" / "5,000 / mo" / "5,000 / mo" | pricing-display.ts:213 | `permitSearches` 100/500/5000/5000 | tsx ✓ | OK |
| Row "CRM seats" / `row-compare-crmSeats` | compare row | 1 / 3 / 10 / 10 | pricing-display.ts:214 | `crmSeats` | tsx ✓ | OK |
| Row "Team text alerts" / `row-compare-teamText` | compare row | ✗ / "500 / mo" / "1,500 / mo" / "1,500 / mo" | pricing-display.ts:215 | `teamTextSegments` 0/500/1500/1500 | tsx ✓ | OK |
| Row "Two-way client texting" / `row-compare-clientTexting` | compare row | ✗ / "Your SignalWire number or the add-on" / "1 number included" / "Your SignalWire number or the add-on" | pricing-display.ts:216-219 | `clientTexting` none/byo_or_addon/included/byo_or_addon | tsx ✓ | OK |
| Rows "Agency workspace", "Google Ads & LSA manager", "Cloudflare + Search Console", "Domains + Gmail alerts" (4 rows) | compare rows | ✗✗✗✓ on all four | pricing-display.ts:224 | `PLANS[k].modules` — only Agency true (shared/plans.ts:173) | tsx ✓ | OK |

### Agency pricing by location (`#agency`)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Lede "$349/mo includes 10 client locations. Each location above that is priced by the band it falls in…" | claim | Explains graduated bands | pricing.tsx:477-480 | `PLANS.agency.monthlyCents` 34900, `limits.locations` 10 | tsx ✓ | OK |
| Band table `table-agency-bands` row "1–10" | price row | "Included in $349" | pricing.tsx:493-502 (`agencyBandRows`, pricing-display.ts:73) | band `upTo:10, centsPerLocation:0` (shared/plans.ts:179) | tsx ✓ | OK |
| Band row "11–50" | price | "$15" per location / month | pricing.tsx:493-502 | band 1500 (shared/plans.ts:180) | tsx ✓ | OK |
| Band row "51–250" | price | "$10" | pricing.tsx:493-502 | band 1000 | tsx ✓ | OK |
| Band row "251–500" | price | "$7" | pricing.tsx:493-502 | band 700 | tsx ✓ | OK |
| Band row "501+" | price | "Talk to a sales rep" | pricing.tsx:493-502 (`centsPerLocation === null` → sales) | `AGENCY_SELF_SERVE_MAX_LOCATIONS=500` (shared/plans.ts:185); server 409 `talk_to_sales` (order.ts:124) | tsx ✓ (agencyMonthlyCents(501) = null) | OK |
| "How many client locations?" input / `input-agency-locations` | number input | Type a location count; normalized to whole ≥1 (`normalizeLocations`, pricing-display.ts:67) | pricing.tsx:513-525 | server re-validates (`parseAgencyLocations`, order.ts:119) | code | OK |
| Preset chips 10/25/50/100/250/500 / `button-agency-preset-{n}` (6 buttons) | buttons | Fill the input with a preset count | pricing.tsx:526-538 | — | code | OK |
| Quote total / `text-agency-total` | price | "N locations = $X/mo" (or "/yr") from `agencyQuote` (pricing-display.ts:85): base + graduated bands; annual = monthly × 10 | pricing.tsx:549-552 | Server bills base plan price + tiered `agency_locations` item, quantity = locations − 10, tiers = bands (×10 yearly) (prices.ts:47-55, order.ts:178-179) — same math | tsx: 25 loc = 34900 + 15×1500 = $574/mo ✓; 60 loc = $1,049/mo ✓; 500 loc = $4,699/mo ✓; annual = ×10 ✓ | OK |
| Breakdown list / `list-agency-breakdown` | itemized lines | One line per band: "Locations 11–25 · 15 × $15 …" | pricing.tsx:553-562 | mirrors Stripe graduated tiers | tsx ✓ | OK |
| "About $X per location per month" note | footnote | Blended per-location cost when >10 | pricing.tsx:563-568 | display-only | tsx ✓ (quote.monthlyCents / locations) | OK |
| "Billed yearly: 2 months free versus $574/mo." / "Or $5,740/yr billed yearly (2 months free)." | footnote | Yearly framing | pricing.tsx:563-568 | yearly = ×10 (ANNUAL_MONTHS) | tsx ✓ | OK |
| "Choose Agency" / `button-agency-start` (labels: "Your current location count", "Change to N locations", "Switch to Agency with N locations") | button | Same checkout/change-plan flow as plan cards, body `{plan:"agency", interval, locations: quote.locations}` | pricing.tsx:569-580, `choosePlan` pricing.tsx:199-203 | `POST /api/stripe/create-checkout` (stripe.ts:240) or `change-plan` (stripe.ts:317); server clamps locations ≥10, refuses >500 with 409 `talk_to_sales` | Verified by code + 401 probe | OK |
| Sales branch "501+ locations = Talk to a sales rep / Above 500 locations we price the workspace with you." / `text-agency-sales` + `button-agency-sales` | text + button (TalkToSalesButton) | Opens the sales inquiry dialog for >500 locations | pricing.tsx:540-547 | Client mirrors the server's 409 rule; dialog → `POST /api/seo-inquiry` (see dialog section) | tsx (501 → sales) ✓; code | OK |

### Add-ons (`#add-ons`)

> **Historical for the Call Assistant rows (audited 2026-10-04; superseded 2026-10-08).** The AI Call Assistant is no
> longer a platform add-on: it is a SEPARATE SERVICE on its own subscription (`#call-assistant` section of Pricing,
> `CallAssistantPlanCards`, `POST /api/call-assistant/billing/checkout`), four tiers at 500 / 1,000 / 2,000 / 5,000
> minutes for $249 / $349 / $449 / $999 a month (yearly 11 ×), 50¢ a minute overage, no intro price, and the platform
> add-on checkout refuses every Call Assistant key (`checkAddonsForPlan`). The intro line, the Lite/Solo/Crew/Fleet
> prices and the "add-on" wording in the rows below describe the page as it was; they have not been re-walked.

Add-on table rows filter out the 4 Call Assistant tier add-ons (`CALL_ASSISTANT_TIER_ADDONS`, pricing.tsx:621) because they have their own cards. Prices via `addonPriceCents` (pricing-display.ts:41); every add-on's annual = 10× monthly (recomputed ✓) — except the Call Assistant tiers, whose annual prices are their own numbers (by design, shared/plans.ts:345-347).

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section lede ("Add or remove them any time in Settings → Billing" when editable) | text | Explains add-ons ride a subscription | pricing.tsx:592-595 | add-ons bought via `POST /api/stripe/addons` (stripe.ts:350) or with a plan at checkout | code | OK |
| "How it works →" / `link-addon-call-assistant` | link | Goes to /call-assistant | pricing.tsx:603 | — | App.tsx:206 and :309 (`/call-assistant` exists, signed-in CRM page + public landing) | OK |
| Intro line / `text-addon-intro-call_assistant` | price copy | Monthly: "Regular prices from $149/mo (Lite). Solo launch price: $99/mo for your first 3 months, then $249/mo — or $1,999/yr". Yearly: full per-tier yearly list | pricing.tsx:605-608; shared/plan-copy.ts:245, 267 | `CALL_ASSISTANT_TIERS` (shared/plans.ts:283-288); Solo intro 9900¢ × 3 months, monthly billing only (server/billing/intro.ts coupon) | tsx ✓ ($149 Lite, $99 intro, $249, $1,999) | historical (superseded 2026-10-08: the old add-on prices and intro; the service is now 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, yearly 11 ×, 50¢ a minute over, no intro — see the note above) |
| Tier card Lite `$149/mo · $1,199/yr` / `text-call-assistant-tier-price-lite` (+ "1,000 call minutes", "1 local number", "Fits about 500 calls (estimate)", "10¢/min over") | price card | Lite tier facts | client/src/components/call-assistant-tiers.tsx:32-61; shared/plan-copy.ts:180-191 | `CALL_ASSISTANT_TIERS[0]`; yearly shown = `annualCents` 119900 | tsx ✓ minutes/numbers/overage; $1,199/yr confirmed by the owner 2026-10-04 | historical (superseded 2026-10-08: the old add-on prices and intro; the service is now 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, yearly 11 ×, 50¢ a minute over, no intro — see the note above) |
| Tier card Solo `$249/mo · $1,999/yr` + "Launch price: $99/mo for your first 3 months" / `text-call-assistant-tier-price-solo`, `text-call-assistant-tier-intro-solo` | price card + intro | Solo tier facts; intro only shown on monthly toggle | call-assistant-tiers.tsx:32-61, 46-49 | intro = Stripe coupon `monthlyCents − introMonthlyCents` for `introMonths` (shared/plans.ts:236-243, server/billing/intro.ts), once per customer | tsx ✓ ($99 × 3, then $249; no intro on annual) | historical (superseded 2026-10-08: the old add-on prices and intro; the service is now 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, yearly 11 ×, 50¢ a minute over, no intro — see the note above) |
| Tier card Crew `$449/mo · $3,599/yr` + "Lower overage" badge | price card + badge | Crew facts; 5¢/min is below the 10¢ max, badge math ✓ | call-assistant-tiers.tsx:32-61, 57-60 | `CALL_ASSISTANT_TIERS[2]` | tsx ✓ (5 < 10 → badge correct) | historical (superseded 2026-10-08: the old add-on prices and intro; the service is now 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, yearly 11 ×, 50¢ a minute over, no intro — see the note above) |
| Tier card Fleet `$799/mo · $6,399/yr` + "Lower overage" badge | price card + badge | Fleet facts | call-assistant-tiers.tsx:32-61 | `CALL_ASSISTANT_TIERS[3]` | tsx ✓ | historical (superseded 2026-10-08: the old add-on prices and intro; the service is now 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, yearly 11 ×, 50¢ a minute over, no intro — see the note above) |
| "Every tier: the first 500 spam calls each month are free… Above the included minutes, $0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet. Extra local numbers $5/mo each. Add-on for the Pro, Growth and Agency plans." / `text-call-assistant-tiers-every` | footnote box | Shared tier rules | call-assistant-tiers.tsx:65-71; plan-copy.ts:199-201, 227, 230 | `CALL_ASSISTANT_FREE_SPAM_CALLS=500`, overage rates 10/10/5/5, `ADDONS.call_number` 500¢, `availableOn` [pro, growth, agency] | tsx ✓ | historical (superseded 2026-10-08: the old add-on prices and intro; the service is now 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, yearly 11 ×, 50¢ a minute over, no intro — see the note above) |
| Add-on row "Extra location" $19/mo · $190/yr — Starter, Pro, Growth / `row-addon-extra_location`, `text-addon-price-extra_location` | price row | +1 GBP location | pricing.tsx:621-641 | `ADDONS.extra_location` 1900/19000 (shared/plans.ts:331); grants `locations+1` via entitlements; checkout `chub_v1_addon_extra_location_…` | tsx ✓; annual = 10× ✓ | OK |
| Row "Extra seat" $15/$150 — all plans / `row-addon-extra_seat` | price row | +1 CRM/team seat | pricing.tsx:621-641 | `ADDONS.extra_seat` 1500/15000 (shared/plans.ts:332) | tsx ✓ | OK |
| Row "Extra protected website" $15/$150 — Pro, Growth, Agency / `row-addon-protected_site` | price row | +1 protected site | pricing.tsx:621-641 | `ADDONS.protected_site` 1500/15000 | tsx ✓ | OK |
| Row "Client texting number" $29/mo · $290/yr + "$29 setup" — Pro, Agency / `row-addon-texting_number` | price row + one-time fee | Texting number with one-time setup | pricing.tsx:621-641, 636 | `ADDONS.texting_number` 2900/29000 + `setupCents` 2900 (shared/plans.ts:334); setup charged once per new unit via `addonSetupPriceSpec` (prices.ts:106, order.ts:184-185, 249-254) | tsx ✓; server setup fee charged once ✓ | OK |
| Row "Competitor scan pack" $39/$390 — Pro, Growth, Agency / `row-addon-competitor_pack` | price row | +10 competitor scans/mo | pricing.tsx:621-641 | `ADDONS.competitor_pack` 3900/39000, grants `competitorScans+10` | tsx ✓ | OK |
| Row "Extra Call Assistant number" $5/$50 — Pro, Growth, Agency / `row-addon-call_number` | price row | +1 local number (requires a tier) | pricing.tsx:621-641 | `ADDONS.call_number` 500/5000, `requires` any tier (shared/plans.ts:358-363); server enforces `requires` (order.ts:92-97) | tsx ✓ | OK |
| "Coming soon" badges (`badge-addon-preview-{k}`) | badge | Would mark preview add-ons | pricing.tsx:629 | no `ADDONS[k].preview` is set (shared/plans.ts:354-357 — tiers launched 2026-10-02) → badge never renders | code | OK (absent by design) |
| "Manage add-ons" / `button-manage-addons` (signed-in, current-plan only) | button | Goes to Settings → Billing | pricing.tsx:645-651 | — | `?tab=billing` resolves to the Billing section (client/src/pages/settings/sections.tsx:82, 99-103) | OK |

### Done-for-you services (`#services` / `#done-for-you`)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section head + lede "We quote these for your business…" | text | Intro | pricing.tsx:656-667 | — | code | OK |
| "Talk to a sales rep" / `button-services-sales` (TalkToSalesButton, topic "Done-for-you services") | button | Opens the sales inquiry dialog | pricing.tsx:669-671 | dialog → `POST /api/seo-inquiry` | code | OK |
| Service card "Business formation & contractor license" / `card-service-formation` | card + button | All 6 services have no `priceCents` (every DFY catalog price ≥ $5,500 ≥ the $1,000 threshold), so each renders a `button-sales-formation` Talk-to-sales button, never a price | pricing.tsx:727-777, `isSalesOnlyService` pricing-display.ts:399; `DFY_SERVICES` pricing-display.ts:329-397 | `server/catalog.ts:23 DFY_CATALOG` — dfy_formation $5,500; `SALES_THRESHOLD_CENTS` 100000 (shared/plans.ts:415); server refuses ≥ threshold at checkout with 409 `talk_to_sales` (catalog.ts:50-61, stripe.ts:548-549) | catalogIds map 1:1 to DFY_CATALOG keys (dfy_formation, dfy_gmb_website $15,000, dfy_seo_ads $7,500, dfy_seo_first_page/growth/domination $18,000/$36,000/$60,000, dfy_bundle $29,999); all ≥ threshold ✓ — no price is ever shown or checkable out for a DFY service | OK |
| Cards "Google Business Profile & website", "SEO & ad campaigns", "Monthly SEO packages", "Complete Business Build", "Custom work" (same shape) | cards + buttons | Same sales-only treatment; "Custom work" has empty `catalogIds` → sales button too | pricing.tsx:673-677, 727-777 | same; `SEO_CONTRACT_REQUIRED_IDS` additionally blocks direct checkout (400) even under threshold (catalog.ts:42-47, stripe.ts:551-553) | code | OK |
| Price text `text-service-price-{id}` + "Add to cart" `button-add-cart-{id}` | (unreachable branch) | Would show a price + add to cart for a service under $1,000 — **no service qualifies**, so this branch never renders on /pricing; the cart's `dfy_service` line item can never be populated from this page | pricing.tsx:754-772 | `POST /api/stripe/create-cart-checkout` resolves DFY prices server-side from `DFY_CATALOG` and re-refuses sales-only on the resolved amount (stripe.ts:537-549) | code | OK (intentionally unreachable; server still defends the path) |
| Disclaimer "Google decides search rankings, so nobody can guarantee them…" | footnote | SEO expectation setting | pricing.tsx:678-680 | — | code | OK |

### Change-plan confirm dialog (signed-in, switching the existing subscription)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog text "Your Pro subscription (billed monthly) changes to Growth at $199/mo, billed monthly. No second subscription is created…" / `dialog-change-plan` | dialog | Quotes the target plan + interval + agency location count using the same `planRequestPrice` helper (agency via `agencyQuote`) | pricing.tsx:686-703, 89-95 | mirrors `change-plan` billing | tsx recompute of quoted prices ✓ | OK |
| "Cancel" / AlertDialogCancel | button | Closes without action | pricing.tsx:705 | — | code | OK |
| "Switch plan" / `button-confirm-change-plan` | button | Applies the change in place | pricing.tsx:706-713 | `POST /api/stripe/change-plan` `{plan, interval, locations?}` → server/stripe.ts:317 → `requireRecentAuth` step-up (server/account-security) → `liveSubscription` (stripe.ts:129, 409 `no_subscription` otherwise) → `subscriptionChange` (order.ts:224) → `stripe.subscriptions.update` proration `always_invoice`, `payment_behavior: error_if_incomplete` → row rewrite in `subscriptions` → invalidates entitlements/dashboard queries; 409 `talk_to_sales` (Agency >500 / sales-set-up items) opens the sales dialog | Verified by code + server/stripe-billing.test.ts:412-612 | OK |

### Talk-to-sales dialog (every "Talk to a sales rep" on the page)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Dialog "Talk to a sales rep — About: <topic>" with name/email/phone/company/need fields / `dialog-talk-to-sales`, `form-talk-to-sales` | dialog + form | Collects the inquiry; topic = the service/agency-location count | client/src/components/talk-to-sales.tsx:32-143 | `POST /api/seo-inquiry` `{name, email, phone, services:[topic≤100], message}` → server/routes.ts:3306 → zod `seoInquiryInput` (routes.ts:3284) → `sendWithFallback` email to `SMTP_EMAIL` (sales inbox), reply-to the customer; **no DB write**; rate limit 5/hour (routes.ts:71) | code trace; topic caps match client (`TOPIC_MAX=100`, `NEED_MAX=4500`) | OK |
| "Send to sales" / `button-sales-submit` | button | Submits the form | talk-to-sales.tsx:131-137 | same | code | OK |
| Success panel + "Done" / `text-sales-success`, `button-sales-done` | confirmation | Confirms the request was emailed | talk-to-sales.tsx:80-91 | server returns `{success:true}` only after the email send | code | OK |

### Public footer (signed-out only; signed-in the page has no footer — app frame)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Links: Home `/`, Features `/features`, Done-For-You `/done-for-you`, AI Call Assistant `/call-assistant`, mailto:support@constructhub.us, Terms `/terms`, Privacy `/privacy` | links | Site navigation | client/src/components/public-page-chrome.tsx:74-89 | — | every route exists in App.tsx (lines 192, 208, 211, 309, 229, 230; `/` home) | OK |
| Footer guides: `/google-ads-guide`, `/lsa-guide`, `/google-ad-fraud`, `/google-business` / `footer-guides` | links | Free guides | public-page-chrome.tsx:51-69 | — | App.tsx:192, 201, 200, 299 | OK |

### CartSheet

Reachable from /pricing signed-out via the header cart (`PublicPageHeader cart` → `SiteNavBar` → `<CartSheet/>`, client/src/components/site-nav.tsx:337); signed-in via the app frame's nav. Note: on /pricing itself, nothing can be added to the cart (all DFY services are sales-only; "Add to cart" never renders), so a visitor arriving here has an empty cart unless they came from /master-class.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Cart trigger with count badge / `button-cart-trigger`, `badge-cart-count` | button + badge | Opens the drawer; badge = checkout items + sales requests | client/src/components/cart-sheet.tsx:84-96 | — (localStorage `constructhub_cart` / `constructhub_cart_sales`, client/src/contexts/cart-context.ts:38-40) | code | OK |
| Empty state "Your cart is empty" + "Master Class" `link-browse-courses` → `/master-class` and "Services" `link-browse-services` → `/pricing#services` | links | Browse destinations | cart-sheet.tsx:108-127 | — | both routes exist (App.tsx:190, 294; `#services` anchor id at pricing.tsx:656) | OK |
| Sales-request section "Talk to a sales rep — Anything $1,000 or more is priced with a sales rep…" / `section-cart-sales` + per-item `button-cart-sales-{id}` + dismiss `button-dismiss-sales-{id}` | section + buttons | Items the cart turned away (≥ $1,000) wait here as sales inquiries; each "Talk to sales" opens the inquiry dialog, dismiss drops it | cart-sheet.tsx:131-158; turn-away logic cart-context.ts:125-131 (`isSalesOnlyCartItem`, pricing-display.ts:407) | dialog → `POST /api/seo-inquiry`; threshold copy = `SALES_THRESHOLD_CENTS` ($1,000) | tsx ✓ | OK |
| Checkout item card `card-cart-item-{id}` with name, type badge ("Service bundle"/"Service"/"Course module"/"Course bundle"), client-side price `text-cart-item-price-{id}`, remove `button-remove-cart-item-{id}` | cart lines | Shows what's being bought; price is the client-stored display value — **the server never trusts it** | cart-sheet.tsx:159-194 | `POST /api/stripe/create-cart-checkout` re-resolves every price/name: `course_module` from `masterClassModules` table (id, price), `course_bundle` from `COURSE_BUNDLE` $2,499 (catalog.ts:35), `dfy_service`/`dfy_bundle` from `DFY_CATALOG` (server/stripe.ts:524-544) | code; security comment stripe.ts:522-523 | OK |
| Subtotal `text-cart-total` | price | Sum of client-side item prices (display only) | cart-sheet.tsx:197-205 | actual charge = server-resolved line items (stripe.ts:571-578, one charge per thing, mode=payment) | code | OK |
| "Proceed to checkout" / `button-cart-checkout` | button | Signed out (non-dev) → `/auth`; otherwise starts a one-time Stripe checkout for the whole cart | cart-sheet.tsx:213-231, 62-70 | `POST /api/stripe/create-cart-checkout` `{items}` → server/stripe.ts:512 → resolves catalog prices → 409 `talk_to_sales` if any resolved item ≥ $1,000 (checked server-side, stripe.ts:548-549) → 400 for `SEO_CONTRACT_REQUIRED_IDS` (stripe.ts:551-553) → 400 on duplicates / bundle+part overlap (stripe.ts:558-566) → `stripe.checkout.sessions.create` mode=payment; totals ≥ $5,000 also offer `us_bank_account` (stripe.ts:589-611); `success_url /pricing?cart_success=true`, `cancel_url /pricing?cart_canceled=true`; webhook `checkout.session.completed` / `async_payment_succeeded` (Stripe-verified signature, raw body) → `fulfilOneTimePurchase` grants items once, only when `payment_status=paid` (server/billing/fulfilment.ts) + `recordOneTimePurchase` billing ledger row | Verified by code + server/growth-payments.test.ts, server/stripe-billing.test.ts:905-945; 401 probe on create-checkout confirms auth gate | OK |
| Success/cancel return handling | toast | `?cart_success=true` clears the cart + toasts "Purchase successful!"; `?cart_canceled=true` keeps items | cart-sheet.tsx:25-39 | matches the checkout session URLs above | code | OK |
| Error text `text-cart-error` + "Clear cart" / `button-clear-cart` | text + button | Shows checkout refusal (e.g. "Login required" → toast + /auth); clears lines (sales requests stay until dismissed) | cart-sheet.tsx:207-211, 235-244 | server messages surfaced via `apiErrorMessage` | code | OK |

## Findings

**0 BUG · 1 UNCLEAR · 0 DEAD** (prices recomputed against shared/plans.ts; checkout paths traced end-to-end; Stripe-off 503s on dev are expected and all money paths are Verified by code).

1. **Resolved — AI Call Assistant "Lite" yearly price.** The owner confirmed $1,199/yr on 2026-10-04 ("thats fine"); `shared/plans.ts` says so.

Observations (not counted as bugs):
- The Monthly/Annual toggle does not write back to the URL after the initial `?interval=` read (`pricing.tsx:106-107`): refreshing /pricing resets the toggle to Monthly. No monetary impact.
- The "Add to cart" branch of the DFY service cards (`pricing.tsx:756-772`) is unreachable by design — every DFY catalog price is ≥ $5,500, above the $1,000 sales threshold — so a `dfy_service` cart line can never be created from /pricing; the server's DFY branch of `create-cart-checkout` (stripe.ts:537) is defensive only.
- Signed-in-only elements (current-plan banner, change-plan dialog, portal, Manage add-ons) and the actual Stripe session creation could not be exercised live (Stripe is OFF on dev → 503 "Online payments aren't set up on this server yet", server/billing/client.ts:11-17); they are verified by code trace and the server billing test suite (server/stripe-billing.test.ts, server/stripe-not-configured.test.ts).
- No `/api/plans` or `/api/catalog` JSON API exists; both URLs return the SPA shell. The only plan-price API is `GET /api/stripe/plans` (curl-verified identical to shared/plans.ts).
## Lane 6 — map-04: /done-for-you catalogue + every /done-for-you/<slug> service page

Branch: audit/6. Read-only audit; no repo files modified, no commits.

**Price sources established (the lane rule):**
- `server/catalog.ts:23-31` `DFY_CATALOG` (server price authority, cents): dfy_formation 550000 ($5,500), dfy_gmb_website 1500000 ($15,000), dfy_seo_ads 750000 ($7,500), dfy_seo_first_page 1800000 ($18,000), dfy_seo_growth 3600000 ($36,000), dfy_seo_domination 6000000 ($60,000), dfy_bundle 2999900 ($29,999).
- `shared/plans.ts:413-416`: `GBP_REINSTATEMENT_CENTS = 59_900` ($599), `SALES_THRESHOLD_CENTS = 100_000` ($1,000), `showsPrice = cents < threshold`. Every DFY_CATALOG item is ≥ $1,000 → all sales-rep-only, never priced on a page; GBP reinstatement at $599 is under the threshold → its price may show.
- `shared/feature-pages/pricing.ts:72-148` `featurePriceSummary`: `kind:"sales"` → headline "Talk to a sales rep", `price:null`; `kind:"service"` → headline "One-time service", `price:"$599"`, `per:" one-time"`. This is the ONLY pricing computation the catalogue cards and service pages use — content files hold no numbers (enforced by `server/marketing-seo.test.ts:185-221`).
- Every `pricing.kind` on the 5 template pages is `"sales"` (`shared/dfy-pages/*.ts`), matching the rule "any catalog id ≥ threshold ⇒ kind sales" (test `marketing-seo.test.ts:201-219`).

**Routes:** `client/src/App.tsx:211-212` (app frame, signed in) and `:312-313` (public router, signed out) both register `/done-for-you` → `DfyCataloguePage` and `/done-for-you/:slug` → `DfyPageRoute`. `/reinstatement` is registered in both routers (`App.tsx:191`, `:298`). Unknown slug → `NotFound` (`done-for-you.tsx:211-216`, verified rendered).

**Signed-in vs signed-out:** `PublicPageHeader`/`PublicPageFooter` self-suppress when signed in (`client/src/components/public-page-chrome.tsx:37,72` — `if (!useSignedOut()) return null`), so these pages wear public chrome signed out and render bare inside the dashboard frame signed in. Confirmed signed-out on the running dev server; signed-in path verified by code (same component, chrome suppresses itself).

## /done-for-you — Done-For-You Services

Page component `client/src/pages/done-for-you.tsx:77-208`; cards from `DFY_CATALOGUE` (`shared/dfy-pages/index.ts:72-78` = 5 template pages + 1 external, in that order). Rendered headlessly against http://127.0.0.1:8306 (dev, signed out): title "Done-For-You Services for Contractors | ConstructHUB" (= `ROUTE_META[DFY_PATH]`, `shared/route-meta.ts:40-44`), one h1, zero console errors.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Public page header ribbon | chrome | Signed-out marketing nav; renders nothing when signed in | client/src/components/public-page-chrome.tsx:36-37 | none | rendered (count=1 signed out); code for suppression | OK |
| Hero kicker + h1 "Hand the Work to Our Team" + lede | text | Intro; says a rep scopes work before you pay, exams are the one thing not done for you | client/src/pages/done-for-you.tsx:95-118 | none | rendered | OK |
| Button "Talk to a sales rep" (hero), `button-dfy-catalogue-sales-hero` | button → dialog | Opens the sales-inquiry dialog (topic "Done-for-you services"); form posts the request and a rep replies by email. Not a checkout, no account needed | client/src/pages/done-for-you.tsx:84-88,205 | POST /api/seo-inquiry → server/routes.ts:3306 (zod `seoInquiryInput` :3284-3292) → `sendWithFallback` email to SMTP_EMAIL, subject `salesInquirySubject` (server/catalog.ts:69-71); rate limit 5/IP + 5/user per hour (`rateLimit("seo-inquiry",5,5,3600_000)`, server/growth-limits.ts:29); no DB write | dialog open + topic rendered headlessly; submit path verified by code (body `{name,email,phone,services:["Done-for-you services"],message}` matches schema) | OK |
| Link "See the Tools Instead" `link-dfy-catalogue-features` | link → /features | Goes to the features catalogue (the software-tools side of the comparison) | client/src/pages/done-for-you.tsx:110 | none | rendered, href=/features; route exists App.tsx:208/310 | OK |
| Hero note "Sending a request is free and needs no account." | text | Sets expectation; true (dialog needs only name+email) | client/src/pages/done-for-you.tsx:114-117 | POST /api/seo-inquiry (no auth required on route) | rendered + code | OK |
| Mascot speech-bubble panel ("You run the jobs…") | decorative | Standing-gator illustration; no interaction | client/src/pages/done-for-you.tsx:119-130 | none | rendered | OK |
| Card "Business Formation & Filing" `card-dfy-catalogue-formation` | link → /done-for-you/business-formation | Whole card is one link to the service page; price line shows "Talk to a sales rep" (catalog $5,500 ≥ $1,000 ⇒ price never shown) | client/src/pages/done-for-you.tsx:30-55 (price via `featurePriceSummary`, shared/feature-pages/pricing.ts:141-147); entry shared/dfy-pages/index.ts:73-75 from formation.ts | catalog id dfy_formation → server/catalog.ts:24 ($5,500) → `isSalesOnly` true → any checkout refuses 409 `talk_to_sales` (server/stripe.ts:537-549) | rendered: href + "Talk to a sales rep"; price-source match confirmed; refusal covered by vitest "cart refuses dfy_formation" (stripe-billing.test.ts:911) | OK |
| Card "GMB & Website Setup" `card-dfy-catalogue-gmbWebsite` | link → /done-for-you/gmb-website-setup | Same card pattern; "Talk to a sales rep" (catalog $15,000) | done-for-you.tsx:30-55; gmbWebsite.ts | dfy_gmb_website → server/catalog.ts:25 ($15,000) → sales-only | rendered; vitest "cart refuses dfy_gmb_website" | OK |
| Card "SEO & Ad Campaigns" `card-dfy-catalogue-seoAds` | link → /done-for-you/seo-ads-management | Same card pattern; "Talk to a sales rep" (catalog $7,500; 6-month contract) | done-for-you.tsx:30-55; seoAds.ts | dfy_seo_ads → server/catalog.ts:26 ($7,500) + `SEO_CONTRACT_REQUIRED_IDS` (server/catalog.ts:42-47) → sales-only; contract route also refuses: POST /api/contracts/create → server/routes.ts:4724 `sendTalkToSales` | rendered; vitest "cart refuses dfy_seo_ads" | OK |
| Card "Monthly SEO packages" `card-dfy-catalogue-seoContracts` | link → /done-for-you/seo-contracts | Same card pattern; "Talk to a sales rep" (3 packages $18,000/$36,000/$60,000, all 6-month terms) | done-for-you.tsx:30-55; seoContracts.ts | dfy_seo_first_page/growth/domination → server/catalog.ts:27-29; SEO_PACKAGES server/routes.ts:4704-4708 ($3,000/$6,000/$10,000 per month × 6 = the same totals) → all sales-only (routes.ts:4724 refuses every one) | rendered; vitest "cart refuses" ×3 ids | OK |
| Card "Complete Business Build" `card-dfy-catalogue-businessBuild` | link → /done-for-you/complete-business-build | Same card pattern; "Talk to a sales rep" (catalog $29,999) | done-for-you.tsx:30-55; businessBuild.ts | dfy_bundle → server/catalog.ts:30 ($29,999) → sales-only | rendered; vitest "cart refuses dfy_bundle" | OK |
| Card "GBP Reinstatement" `card-dfy-catalogue-gbpReinstatement` | link → /reinstatement | The one card with a listed price: "One-time service / $599 one-time" — $599 = GBP_REINSTATEMENT_CENTS, under the $1,000 sales threshold so the price is allowed to show. Links to the hand-built request page (another lane maps it) | shared/dfy-pages/index.ts:34-45 (external entry, `pricing:{kind:"service",service:"gbpReinstatement"}`); card code done-for-you.tsx:30-55 | none (page link only). Price from shared/plans.ts:413 (59_900 → "$599 one-time" via pricing.ts:132-140 `priceOrSalesRep`) | rendered: href=/reinstatement, price text "One-time service $599 one-time"; /reinstatement renders (h1 "Is your Google Profile Suspended?") and states the same `formatUsd(GBP_REINSTATEMENT_CENTS)` at client/src/pages/reinstatement.tsx:183,228,239 | OK |
| Compare card "Features — Software you run" (+ "See every feature" `link-dfy-compare-features` → /features) | text + link | Explains features are self-serve plan tools; link goes to /features | done-for-you.tsx:58-66,164-181 | none | rendered | OK |
| Compare card "Done-For-You — Work our team does" (+ "Talk to a sales rep" `button-dfy-compare-sales`) | text + button | Explains services are scoped/quoted by a rep; button opens the same sales dialog | done-for-you.tsx:67-74,178 | POST /api/seo-inquiry (same as hero button) | rendered; dialog opens (verified on hero button, same `salesOpen` state) | OK |
| Navy close: button "Talk to a sales rep" `button-dfy-catalogue-sales-cta` + link "See Every Feature" `link-dfy-catalogue-features-cta` → /features | button + link | Last-chance CTA; same dialog / same /features route | done-for-you.tsx:187-202 | POST /api/seo-inquiry (button) | rendered | OK |
| Public page footer | chrome | Marketing footer; self-suppresses signed in | client/src/components/public-page-chrome.tsx:71-72 | none | rendered | OK |
| TalkToSalesDialog (topic "Done-for-you services") | dialog/form | Name+email required, phone/company/"what do you need" optional; prefills from the signed-in account; submits the inquiry | client/src/components/talk-to-sales.tsx:32-143 | POST /api/seo-inquiry → server/routes.ts:3306-3340 → email only (no table) | dialog + topic rendered headlessly; submit verified by code (client body fields exactly match `seoInquiryInput`; not submitted to avoid emailing) | OK |
| Page `<title>`/meta description | meta | "Done-For-You Services for Contractors | ConstructHUB" + description from ROUTE_META | done-for-you.tsx:79-81; shared/route-meta.ts:40-44 | server/seo-html.ts injects same meta into prerendered HTML (prod); dev server serves the SPA shell with default title (expected in dev) | rendered title exact; ROUTE_META cross-checked | OK |

## /done-for-you/<slug> — the shared DFY template

Renderer `client/src/components/feature-landing/dfy-landing.tsx` (all 5 template pages); sections `client/src/components/feature-landing/sections.tsx`. Every section renders from the page's content file; no prices exist in content. Rendered headlessly for all 5 slugs: zero console errors, `data-dfy-status="ready"` on every page, exactly one h1 each.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Public page header (`next=/done-for-you/<slug>`) | chrome | Public ribbon signed out; nothing signed in | dfy-landing.tsx:80; public-page-chrome.tsx:36-37 | none | rendered | OK |
| Back link "All services" `link-dfy-all` → /done-for-you | link | Returns to the catalogue | dfy-landing.tsx:88; sections.tsx:91-93 | none | rendered href=/done-for-you | OK |
| Hero: kicker, h1, lede, mascot bubble (`text-feature-title`, `text-feature-lede`, `text-feature-bubble`) | text | The service's pitch, from its content file | sections.tsx:94-133 | none | rendered per slug (h1s match each content file's headline) | OK |
| Hero price sentence `text-feature-hero-price` ("Quoted by a sales rep for your business.") + "See pricing" anchor → #pricing | text + anchor | States the service is rep-quoted, never priced; anchor scrolls to the pricing band on the same page | sections.tsx:60-65,109-112 (sales branch) | none (anchor is in-page) | rendered on all 5 pages; no price figure anywhere | OK |
| Hero CTA button "Talk to a sales rep" `cta-dfy-sales-hero` | button → dialog | Opens the sales dialog with topic = the service's title | dfy-landing.tsx:50-54,85 | POST /api/seo-inquiry (topic travels as `services:[page.title]`) | rendered; dialog opens on catalogue (same dialog component); submit verified by code | OK |
| Hero CTA link "See Every Service" `link-dfy-services-hero` → /done-for-you | link | Back to the catalogue | dfy-landing.tsx:55-59,86 | none | rendered | OK |
| StepsSection "How It Works" (`section-feature-how`, `step-feature-1..n`) | content | 4 numbered steps; the sales-rep scope step is step 2 on every page | sections.tsx:189-207 | none | rendered (4 steps per page) | OK |
| CardsSection "What You Get" (`section-feature-cards`, `card-feature-0..5`) | content | The scope/deliverables grid (6 cards per page) — also feeds the pricing block's "What's included" list | sections.tsx:211-236,336 | none | rendered (6 cards per page) | OK |
| SpotlightSection (`section-feature-spotlight`, `panel-feature-spotlight`) | content | Present only on gmb-website-setup ("After the Build" — plan tools that need the verified profile) and seo-contracts ("The Agreement" — what the SEO contract puts in writing). Absent on the other 3 (component returns null, sections.tsx:261-262) | sections.tsx:260-298 | none | rendered on exactly those 2 pages | OK |
| AudienceSection "Who It's For" (`section-feature-audience`) | content | 2–3 cards of who the service fits | sections.tsx:302-319 | none | rendered | OK |
| Pricing block `card-feature-pricing` (`text-feature-price-headline` = "Talk to a sales rep", **no price figure** — `text-feature-price` absent, `text-feature-price-note` = "<topic> is quoted by a sales rep for your business.", plus the content file's `note`, plus "What's included" = the 6 card titles) | price display | Tells the owner the price is set with a rep per business; the catalog's internal price ($5,500–$60,000 / $29,999) deliberately never reaches the browser | sections.tsx:323-393; price from shared/feature-pages/pricing.ts:141-147; per-page `pricing:{kind:"sales"}` in shared/dfy-pages/*.ts | catalog ids per page → server/catalog.ts DFY_CATALOG → all ≥ $1,000 → `isSalesOnly` ⇒ sales-only; checkout refusal POST /api/create-checkout-session → server/stripe.ts:537-549 (409 `talk_to_sales`); SEO packages also refused at POST /api/contracts/create → server/routes.ts:4724 | rendered on all 5: headline "Talk to a sales rep", priceFigure=null; vitest asserts no amount ≥ $1,000 can appear (marketing-seo.test.ts:201-219) and 8/8 "cart refuses" tests pass | OK |
| Pricing CTA button "Talk to a sales rep" `cta-dfy-sales-pricing` | button → dialog | Same sales dialog, from the pricing band | dfy-landing.tsx:99; sections.tsx:390 | POST /api/seo-inquiry | rendered | OK |
| Pricing compare link "See every service" `link-feature-pricing` → /done-for-you | link | DFY override of the template's default "/pricing#add-ons" compare | dfy-landing.tsx:100; sections.tsx:384-387 | none | rendered href=/done-for-you | OK |
| FaqSection "Questions" (`section-feature-faq`, `faq-feature-0..n`, `<details>`) | content | 5 FAQs (formation, seo-ads, business-build) or 4 (gmb-website-setup, seo-contracts); covers cost/quote, exams exclusion, 6-month terms where relevant | sections.tsx:397-415 | none | rendered, FAQ counts match content files | OK |
| InDepthSection "In Depth" (`section-feature-in-depth`) | content | Long-form explainer; formation's also carries the state-by-state bullets | sections.tsx:424-446 | none | rendered | OK |
| RelatedSection cards (`link-feature-related-<key>`) — 3 per page | link cards | "Works Well Together" cards; each rendered href verified against the registries (formation→businessBuild /done-for-you/complete-business-build, gmbWebsite /done-for-you/gmb-website-setup, masterClass /features/master-class; gmb-website→seoAds /done-for-you/seo-ads-management, gbp /features/gbp, siteScan /features/site-scan; seo-ads→seoContracts /done-for-you/seo-contracts, clickGuard /features/click-guard, lsaLeads /features/lsa-leads; seo-contracts→seoAds, rankingGrid /features/ranking-grid, siteScan; businessBuild→formation, gmbWebsite, seoAds) | dfy-landing.tsx:31-36,104; sections.tsx:453-476 | none | rendered hrefs == `dfyPagePath` / `featurePagePath`; all 6 feature targets confirmed in shared/feature-pages (gbp.ts:29, siteScan.ts:21, clickGuard.ts:34, lsaLeads.ts:26, rankingGrid.ts:29, masterClass.ts:23) | OK |
| FinalCta navy band `section-feature-cta` (headline "Get <title> Done for You", price sentence, button `cta-dfy-sales-cta` → dialog, link `link-dfy-services-cta` → /done-for-you, "Compare the tools you run yourself" `link-dfy-cta-features` → /features) | CTA row | Closing ask; same dialog, catalogue, and features links | dfy-landing.tsx:105-111; sections.tsx:482-517 | POST /api/seo-inquiry (button) | rendered on all 5 | OK |
| TalkToSalesDialog (topic = page.title, e.g. "Business Formation & Filing") | dialog/form | Same inquiry form; the topic is sent as the requested service | dfy-landing.tsx:114; talk-to-sales.tsx:41-52 | POST /api/seo-inquiry → server/routes.ts:3306 | verified by code (body shape + schema match) | OK |
| Page `<title>`/meta | meta | From each content file's `seo.title`/`seo.description` (all end "| ConstructHUB") | dfy-landing.tsx:41-42; shared/route-meta.ts:46 builds the same map for prerender | server/seo-html.ts (prod prerender) | rendered titles exact for all 5 | OK |

### business-formation
- Content `shared/dfy-pages/formation.ts`; slug `business-formation`; status ready; catalogIds `["dfy_formation"]` → $5,500 ≥ $1,000 ⇒ kind "sales" ✓. Sections rendered: how, cards, audience, pricing, faq (5), in-depth, related, cta (no spotlight — correct, content has none). Related: businessBuild, gmbWebsite, masterClass — all resolve. Headless: title "Contractor License & LLC Filing, Done for You | ConstructHUB" ✓.

### gmb-website-setup
- `gmbWebsite.ts`; catalogIds `["dfy_gmb_website"]` → $15,000 ⇒ sales ✓. Sections: how, cards, **spotlight**, audience, pricing, faq (4), in-depth, related, cta. Spotlight's plan-tools panel ("Google Business Profile sync, Profile Guard, … Site Scan") lists features whose pages exist; the panel note correctly says those tools are plan software priced on the Pricing page, not part of the service. Related: seoAds, gbp, siteScan ✓.

### seo-ads-management
- `seoAds.ts`; catalogIds `["dfy_seo_ads"]` → $7,500 ⇒ sales ✓ (also in SEO_CONTRACT_REQUIRED_IDS — signed contract before payment; the page's copy says 6-month agreement, matches `SEO_PACKAGES.dfy_seo_ads.termMonths: 6`, server/routes.ts:4708). Sections: how, cards, audience, pricing, faq (5), in-depth, related, cta. Related: seoContracts, clickGuard, lsaLeads ✓.

### seo-contracts
- `seoContracts.ts`; catalogIds `["dfy_seo_first_page","dfy_seo_growth","dfy_seo_domination"]` → $18,000/$36,000/$60,000 ⇒ sales ✓. Package names are deliberately not repeated in page copy (header comment: ranking-target names, page promises no ranking) — copy says "three packages, covering one to five keywords", which matches the catalog parenthetical ranges (1-2, 1-2, 3-5). `SEO_PACKAGES` (routes.ts:4705-4707) monthly×6 equals the DFY_CATALOG totals exactly. The old online contract flow (`/api/contracts/create` → 409 for all four; `/api/contracts/:token/checkout` → 409, routes.ts:4857) is dead-in-practice by design; the page's only CTA is the sales dialog. Sections: how, cards, **spotlight (the agreement scope)**, audience, pricing, faq (4), in-depth, related, cta. Related: seoAds, rankingGrid, siteScan ✓.

### complete-business-build
- `businessBuild.ts`; catalogIds `["dfy_bundle"]` → $29,999 ⇒ sales ✓. Copy's "planned for 4–6 months, paid upfront, excludes licensing exams" matches its cited sources (landing Done-For-You section, DFY_BUNDLE_PARTS in shared/cart-bundles.ts). "Monthly SEO packages are separate too" is accurate (dfy_seo_* ids are not bundle parts, per cart-bundles DFY_BUNDLE_PARTS). Sections: how, cards, audience, pricing, faq (5), in-depth, related, cta. Related: formation, gmbWebsite, seoAds ✓.

## Findings

**Price audit (the lane rule) — every page/card price vs its source:**

| Where | Shown | Source | Result |
|---|---|---|---|
| Catalogue card formation/gmbWebsite/seoAds/seoContracts/businessBuild | "Talk to a sales rep" (no figure) | DFY_CATALOG $5,500 / $15,000 / $7,500 / $18k–$60k / $29,999 — all ≥ $1,000 ⇒ must not show a price | OK — no catalog price reaches the browser |
| Catalogue card gbpReinstatement | "$599 one-time" | shared/plans.ts:413 GBP_REINSTATEMENT_CENTS = 59_900 (< $1,000, price allowed) | OK — matches, and /reinstatement states the same $599 (reinstatement.tsx:183,228,239) |
| All 5 service-page pricing blocks + hero price lines | "Talk to a sales rep" / "Quoted by a sales rep for your business." | `pricing.kind:"sales"` on every page ⇔ every catalog item sales-only | OK |
| Cross-check SEO_PACKAGES (routes.ts:4704-4708) vs DFY_CATALOG | (not shown anywhere) | $3,000/$6,000/$10,000/$1,250 per month × 6 months = $18,000/$36,000/$60,000/$7,500 | OK — totals identical |
| DFY_SERVICES scope lists (client/src/lib/pricing-display.ts:329-397) vs page scope cards | (not on these pages) | formation/website/seo-ads/seo-packages/business-build bullets match the 5 pages' cards | OK |

**Element counts: 37 total — 37 OK, 0 BUG, 0 UNCLEAR, 0 DEAD.** (18 catalogue rows + 19 shared-template rows; per-service notes are summaries, not additional elements.)

**BUG list:** none.

**UNCLEAR/DEAD list:** none. (The `/api/contracts/*` online contract+checkout flow for SEO packages is unreachable-by-design — every package is ≥ $1,000 so both routes 409 `talk_to_sales`; the DFY pages never link to it. Flagging as an observation, not a defect: routes.ts:4711-4749 and :4841-4904 still carry the full under-threshold implementation.)

**Verification performed:**
- `curl http://127.0.0.1:8306/done-for-you` + all 5 slugs + a bad slug + /reinstatement → all 200 (dev serves the SPA shell; per-route title/meta injection is a prod-prerender concern covered by tests, and `ROUTE_META` was cross-checked directly).
- Headless Chromium renders of the catalogue, all 5 service pages, /reinstatement, and an unknown slug: extracted every card href/price, every button/link testid, pricing-block headline/figure/note, FAQ counts, related-card hrefs, page titles, `data-dfy-status` — all as recorded above; zero console errors; unknown slug renders the 404 page.
- TalkToSalesDialog opened headlessly (visible, correct topic "Done-for-you services"); submit not pressed to avoid emailing — the POST /api/seo-inquiry body↔zod-schema match was verified by reading client/src/components/talk-to-sales.tsx:41-52 against server/routes.ts:3284-3340.
- vitest: `server/marketing-seo.test.ts` + `server/feature-pages.test.ts` → 46/46 passed (includes "covers every done-for-you catalog item exactly once", "no typed prices ≥ $1,000", catalogue-path checks). `server/stripe-billing.test.ts -t "cart refuses"` → 8/8 passed (one refusal per DFY_CATALOG id).

**Out of lane / handed off:** the /reinstatement page itself (linked from the GBP Reinstatement catalogue card), /features/* related targets, /pricing#services (SALES_HREF — referenced only in `featurePriceSummary`'s unused-on-DFY `link` field), and the admin index /admin/feature-pages.
## Lane 6 element map — /databases, /property, /search

Audit date 2026-10-04, branch audit/6, dev server http://127.0.0.1:8306 (signed out; `GET /api/auth/me` → `null`). No repo files modified.

Route trees (client/src/App.tsx):
- Signed-in (`DashboardRouter`, App.tsx:162-249): `/search` → SearchPage:167, `/databases` → DatabasesPage:168, `/property` → PropertyPage:169 — all inside the app frame (sidebar).
- Signed-out (`PublicRouter`, App.tsx:285-333): `/databases` → Ribboned.DatabasesPage:291, `/property` → Ribboned.PropertyPage:292. `/search` is NOT here: `/search` is in `SIGNED_IN_ONLY` (App.tsx:337), so a signed-out visitor is client-redirected to `/auth?next=/search` by `SignedOutFallback` (App.tsx:330,344-354).
- `withRibbon` (App.tsx:259-270) wraps the page in `PublicPageHeader`, i.e. `SiteNavBar` (client/src/components/public-page-chrome.tsx:36-45, site-nav.tsx): logo → `/`, Features ▾ dropdown, Done-For-You ▾ dropdown, Plans / Results / Coverage (`/#plans` etc.), Pricing (`/pricing`), Sign In (`/auth?next=<current>`), Get Started (`/auth?mode=signup`), mobile hamburger with the same entries. It renders only when signed out, so signed-in users see no change. Page content itself is identical for visitors, and every API these two pages call (`/api/counties`, `/api/databases`, `/api/databases/counts`, `/api/property-appraisers`) is public (no auth middleware) — verified by curling each unauthenticated (200).

Link policy implementation (shared/government-links.ts, read fully):
- `governmentLinksAvailable` (line 2-4): `isActive && linkStatus ∈ {live, verified, unconfirmed}`.
- `governmentLinksForDisplay` (6-8): otherwise forces `portalUrl/searchUrl` → null.
- `canScrapeGovernmentPortal` (11-26): needs an http(s) URL + platform; eTRAKiT only `permits.cob.org/etrakit/…`; Skagit County / Custom-GovPlatform only `skagitcounty.net` hosts; SmartGov / Tyler EnerGov / Tyler Technologies / Accela / Click2Gov / FTG Portal any URL.
- `governmentPermitForDisplay` (31-36): also nulls phone/email/address for permit databases ("not presented as verified").
- `governmentLinkNotice` (39-43): for `unconfirmed` only → `Official site · not auto-verified · Last checked YYYY-MM-DD` (UTC date of `lastVerifiedAt`).
- Both list APIs map rows through these helpers (routes.ts:447,465,468,489,868,877). Data originates in server/data/permit-portals.json and server/data/appraisers.json (verified/unconfirmed/dead/none/lastVerifiedAt fields) seeded into `permit_databases` / `property_appraisers`.

Key DB facts (psql `constructhub_dev_a6`, recomputed independently):
- `permit_databases`: 32,853 rows (county 3,053 / city 29,800); link_status: none 32,049, verified 490, unconfirmed 169, unchecked 143, dead 2; both dead rows (Duluth GA ×2) already have empty URLs and is_active=false.
- withPortal (is_active AND link_status IN live/verified/unconfirmed AND coalesce(nullif(search_url,''),nullif(portal_url,'')) NOT NULL) = 659; verified-only = 490; searchable (JS adapter rules, re-queried in SQL regex form) = 120.
- `property_appraisers`: 3,040 rows; link_status verified 1,778 / unconfirmed 939 / dead 172 / none 151; is_active true 2,717 / false 323; 0 verified-or-unconfirmed rows lack a URL; all dead/none rows have null URLs.
- `counties`: 3,139 rows, 51 distinct state codes. `search_results`: 2 rows; `search_queries`: 9 rows.

---

## /databases — Database Directory

What the page is: a public directory of ~32.9k US county/city permit offices. Top stats, jurisdiction-type tabs, search + state/county filters, a paged card list; each card shows the office's official portal link (or an honest Google fallback), an optional Scrape dialog that drives a headless browser against the portal, and pagination. Signed-out visitors get the marketing ribbon on top (see above); everything else is identical.

### Page header + stat grid (databases.tsx:183-203)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Database directory" title (text-page-title) | heading | Names the page. | databases.tsx:185-188 | client only | code read | OK |
| Description line | text | One-sentence explanation of the directory. | databases.tsx:187 | client only | code read | OK |
| "Jurisdictions" stat value (text-database-count) | stat number | Total count of county+city permit offices in the directory: **32,853**. | databases.tsx:192-199 | GET /api/databases/counts → routes.ts:476 → storage.ts:274 getDatabaseCounts → `SELECT count(*) FROM permit_databases GROUP BY jurisdiction_type`, summed (no time window, no org filter). Rendered only once `counts` loads (no `?? 0` flash). | psql `count(*)` = 32,853 matches API curl `/api/databases/counts` | OK |
| "… with a permit portal on record" hint (text-portal-count) | stat hint | Of the jurisdictions above, how many have a usable official portal link on record: **659** (490 verified + 169 unconfirmed; dead/unchecked/none excluded). | databases.tsx:196-198 | same endpoint → `count(*) FILTER (WHERE is_active AND link_status IN ('live','verified','unconfirmed') AND coalesce(nullif(search_url,''),nullif(portal_url,'')) IS NOT NULL)` | psql filter = 659 matches API | OK |
| "Counties" stat | stat number | County-type offices: **3,053**. | databases.tsx:200 | same endpoint, `jurisdiction_type='county'` count | psql GROUP BY = 3,053 matches | OK |
| "Cities" stat | stat number | City-type offices: **29,800**. | databases.tsx:201 | same endpoint, `jurisdiction_type='city'` count | psql GROUP BY = 29,800 matches | OK |

### Jurisdiction type tabs (databases.tsx:205-230)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "All (32,853)" tab (button-filter-all) | tab button | Shows every jurisdiction; number mirrors the Jurisdictions stat. | databases.tsx:207-229 | same counts endpoint (client-side state only; list refetched with `filtered=true`) | counts equal SQL | OK |
| "Counties (3,053)" tab (button-filter-county) | tab button | Narrows the list to county offices; sends `jurisdictionType=county`. | databases.tsx:207-229; param set at :128-138 | GET /api/databases?filtered=true&jurisdictionType=county → storage.ts:230-232 `eq(permit_databases.jurisdiction_type,'county')` | psql `WHERE jurisdiction_type='county'` count = 3,053 | OK |
| "Cities (29,800)" tab (button-filter-city) | tab button | Narrows the list to city offices; sends `jurisdictionType=city`. | databases.tsx:207-229 | same, `='city'` | psql = 29,800 | OK |

### Toolbar — search + filters (databases.tsx:232-279)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search by city, county, or state…" input (input-database-search) | search input | Filters the list as you type (400 ms debounce, resets to page 1); sent as `search=` param. | databases.tsx:65-82, 233 | GET /api/databases?filtered=true&search=… → storage.ts:246-254 `ilike(name OR jurisdiction, '%term%')` after escaping `% _ \` (routes.ts:442) | curl `search=king` total 107 = psql LIKE count 107 | OK |
| "Clear filters" (button-clear-filters) | button | Resets search, state, county, type, page. | databases.tsx:171-178, 235-239 | client only | code read | OK |
| State select (select-state-filter) | select | Filters by state; shows "All states (**51**)" then one item per distinct state code from the counties table. Picking a state resets the county pick. | databases.tsx:242-258; options from :102-106 | GET /api/counties → storage.ts:200 `SELECT * FROM counties` | psql `count(DISTINCT state_code)` = 51 matches the "All states (51)" label | OK |
| County select (select-county-filter) | select | Filters to one county; only visible when a state is chosen. List = counties of that state. | databases.tsx:259-276 | county rows from /api/counties filtered client-side; list query uses `countyId=` param → storage.ts:234-235 | code read + SQL shape check | OK |
| Active-filters count | badge | Small count of state+county filters set, shown on the toolbar. | databases.tsx:181, 234 | client only | code read | OK |

### Result list (databases.tsx:288-321 + DatabaseCard 393-534)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading skeletons | placeholder | 5 grey bars while the first fetch runs. | databases.tsx:282-287 | n/a | code read | OK |
| Empty state "No databases match your search" (button-clear-filters-empty) | empty state + button | Shown when the filtered list is empty; its Clear filters resets everything. | databases.tsx:288-298 | client only | code read | OK |
| "Showing 1–25 of 32,853 results" (text-result-count) | text | Position line computed from `total` returned by the server (page size 25; server caps limit at 100, client sends 25). | databases.tsx:301-304 | total from getDatabasesFiltered `count(*)` with the same WHERE (storage.ts:258-261) | curl default page total 32,853 = psql | OK |
| Card title (h3) | text | Office name; seeded template names ("City of X", "X Building Department") are replaced by the plain jurisdiction when the office has no verified portal. | databases.tsx:399-403, 414 | `permit_databases.name` / `jurisdiction` | code read | OK |
| "Active" / "No portal on record" pill (status-portal-{id}) | status pill | Green "Active" when the office has a usable official link (verified **or unconfirmed**); grey "No portal on record" otherwise (dead/unchecked/none). | databases.tsx:415-425 | derived from linkStatus via governmentLinksAvailable (shared/government-links.ts:2) after the API nulls dead/inactive URLs | SQL status distribution + API nulling checked | OK (note: "Active" includes unconfirmed rows; those carry the not-auto-verified notice below — see Findings F2) |
| Jurisdiction-type badge | badge | "county" or "city" chip. | databases.tsx:426-428 | `permit_databases.jurisdiction_type` | code read | OK |
| Jurisdiction subtitle | text | "Jurisdiction · CountyName County · platform". | databases.tsx:430-436 | `jurisdiction`, county via /api/counties map, `platform` | code read | OK |
| "Scrape" button (button-scrape-{id}) | button (opens dialog) | Opens the scrape dialog for portals with a supported automation platform. Only rendered when links available AND `canScrapeGovernmentPortal` (Skagit County/Custom-GovPlatform @ skagitcounty.net, eTRAKiT @ permits.cob.org, SmartGov/Tyler EnerGov/Tyler Technologies/Accela/Click2Gov/FTG Portal). | databases.tsx:438-448 | shared/government-links.ts:11-26; server re-checks the same rules before running (routes.ts:626-636) | rule parity read in code; searchable set = 120 verified by SQL + API | OK |
| "Official site · not auto-verified · Last checked YYYY-MM-DD" notice | text | Shown **only for unconfirmed** links: says the URL came from the source list and when it was last checked. | databases.tsx:451 | governmentLinkNotice (shared/government-links.ts:39-43) using `link_status` + `last_verified_at` | psql: 0 unconfirmed/verified rows missing last_verified_at | OK |
| "Portal" link (link-portal-url-{id}) | external link | Opens the office's official permit portal in a new tab. Only rendered when the link passed the verified/unconfirmed policy (dead/inactive/none are nulled by the API, never guessed). | databases.tsx:453-464 | `permit_databases.portal_url`, seeded from server/data/permit-portals.json with its linkStatus | API rows sampled; spot-curls 200 (aca-prod.accela.com/kingco, autauga.capturecama.com, property.muni.org) | OK |
| "Search" link (link-search-url-{id}) | external link | Opens the portal's record-search page directly (same policy as Portal). | databases.tsx:465-476 | `permit_databases.search_url` | same as above | OK |
| "Find permit portal" fallback (link-search-fallback-{id}) | external link | For offices with no usable official link: a clearly-labeled italic Google search for "<jurisdiction> building permit search portal". Honest fallback per policy, not a fabricated portal. | databases.tsx:479-491 | client only: `https://www.google.com/search?q=…` | code read; matches policy for none/unchecked/dead | OK |
| Phone (with icon) | text | Office phone — **never renders**: the API deliberately nulls phone for permit databases (governmentPermitForDisplay). | databases.tsx:492-497 | routes.ts:447 maps rows through governmentPermitForDisplay → phone/email/address null (shared/government-links.ts:31-36) | curl /api/databases row: `"phone": null` | OK (dead-by-design element — see Findings F4) |
| Email mailto link | link | Office email — same as phone, always null from this API. | databases.tsx:498-503 | same nulling | curl row: `"email": null` | OK (dead-by-design — F4) |
| Searchable-field chips (address / name / parcel…) | chips | Lists what the portal's search form supports (only when a portal is on record). | databases.tsx:506-514 | `permit_databases.searchable_fields` | code read | OK |
| "Last scraped <date>" | text | When a scraper last pulled this portal (browser-local timezone). | databases.tsx:516-520 | `permit_databases.last_scraped_at` | code read | OK |
| Notes line | text | Free-text notes; the old seeded template line "Contact … Building Department for permit information." is suppressed. | databases.tsx:59-60, 398, 522-524 | `permit_databases.notes` | psql: 0 rows still match the suppressed template | OK |

### Pagination (databases.tsx:313-319, 326-391)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "‹" prev (button-prev-page) | button | Goes to the previous page (disabled on page 1). | databases.tsx:353-362 | refetch with `page=` | code read | OK |
| Page number buttons (button-page-N) + "…" | buttons | Jump to a page; windowed (first, last, ±1 around current) when >7 pages. 1,315 pages at 25/page. | databases.tsx:363-378 | `offset=(page-1)*25`, `limit 25` (storage.ts:225-226,268-269) | arithmetic check vs total 32,853 | OK |
| "›" next (button-next-page) | button | Goes to the next page (disabled on last page). | databases.tsx:379-388 | refetch | code read | OK |
| Over-range guard | behavior | A stale `?page=` past the end auto-drops to the last page instead of showing an empty list. | databases.tsx:154-158 | client only | code read | OK |

### Scrape dialog (databases.tsx:586-703)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Scrape <name>" dialog title | text | Names the portal about to be searched. | databases.tsx:655-659 | client only | code read | OK |
| "Search type" select (select-scrape-type) | select | Chooses the field to search by; options depend on platform (Skagit County: address/name/permit number/parcel; Tyler EnerGov & eTRAKiT: address/permit/name; SmartGov & default: address only — hidden when there's just one option). | databases.tsx:544-569, 662-672 | server accepts any string, adapters interpret it (routes.ts:615,641) | code read | OK |
| "Search term" input (input-scrape-search) | input | The address/name/permit/parcel to look up; placeholder changes with the search type. | databases.tsx:641-650, 673-680 | POST /api/scrape body `{databaseId, searchTerm, searchType}` | body shape matches routes.ts:615 destructure | OK |
| Start-scrape icon button (button-start-scrape) | button | Sends the scrape request; spins while pending/running. Disabled when the term is empty. | databases.tsx:677-679 | POST /api/scrape → routes.ts:613-658: validates portal is live+supported, reserves 1 monthly "searches" quota (growth-quotas.ts:168, resets 1st of month UTC, per plan limit), inserts a `search_queries` row (user_id, search_type, search_value, county_id), starts a headless-Chromium scrape of the official portal (server/scraper.ts), returns `{jobId, queryId}`. | endpoint + middleware verified in code; POST curls 401 signed-out (auth required, expected) | OK (verified by code — needs a signed-in plan account to press) |
| Platform hint text | text | e.g. "SmartGov only supports address search." | databases.tsx:571-584, 681 | client only | code read | OK |
| Status panel (running/completed/error, message, "N permits found", "Page X of Y") | live status | Polls the job every 1.5 s until finished; shows progress and the permit count the scraper found. | databases.tsx:683-699; poll at :616-629 | GET /api/scrape/status/:jobId → routes.ts:660-666 → scraper.ts:146 getScrapeProgress; 404 unless the job belongs to the signed-in user (scrapeOwners map) | poll contract read in code; unauthenticated curl → 401 (expected) | OK (verified by code) |

---

## /property — Property Records

What the page is: a public directory of county property-appraiser offices (3,040 rows = every row in `property_appraisers`, including inactive/dead/no-portal ones). Client-side search + state/county filters, paginated cards at 25/page, each card linking to the official appraiser portal when it passes the link policy, otherwise an honest Google fallback. Signed-out visitors get the same marketing ribbon as /databases; content identical.

### Header + toolbar (property.tsx:163-206)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Property records" title (text-property-title) | heading | Names the page. | property.tsx:165-168 | client only | code read | OK |
| Description line | text | Explains these are county appraiser portals for ownership/values/tax records. | property.tsx:167 | client only | code read | OK |
| "Search by office, county, or state…" input (input-property-search) | search input | Client-side filter over name, county, state, state code, address, notes (resets to page 1 per keystroke). | property.tsx:95-114, 155-158, 171 | client only — no server query | code read | OK |
| "Clear filters" (button-clear-filters) | button | Resets search/state/county/page. | property.tsx:143-148, 173-177 | client only | code read | OK |
| State select (select-state-filter) | select | Filters by state; options = distinct state codes among appraisers' counties (**50** — DC has no appraiser row). Resets county on change. | property.tsx:180-190; states memo :69-78 | GET /api/property-appraisers (join counties client-side) | psql `count(DISTINCT c.state_code)` join = 50 | OK |
| County select (select-county-filter) | select | Filters to one county ("Name County" items); only visible with a state chosen. A `?countyId=` deep link auto-selects the county and its state (this is what the Search page's "Property lookup" opens). | property.tsx:58-67, 191-203 | county rows derived client-side from the appraisers payload | code read | OK |

### List (property.tsx:208-350)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Loading skeletons (property-loading) | placeholder | 3 grey bars while the single fetch runs. | property.tsx:208-213 | n/a | code read | OK |
| Empty state — "No offices match your filters" / "No offices on record yet" (+ button-clear-empty) | empty state | Two honest variants depending on whether any appraisers loaded; Clear filters only when filters are active. | property.tsx:214-224 | client only | code read | OK |
| Result count line (text-result-count) | text | "Showing 1–25 of **3,040** offices" when filtered >25, else "N office(s)". Count = filtered client-side rows. | property.tsx:227-231 | GET /api/property-appraisers → routes.ts:863-872 → storage.ts:515 `SELECT * FROM property_appraisers`, each row mapped through governmentLinksForDisplay and joined with its county | psql count = 3,040 = API array length (curl + python) | OK |
| Card (card-appraiser-{id}) | card container | One card per appraiser office, 25 per page. | property.tsx:233-320 | property_appraisers rows | code read | OK |
| Office name (h3) | text | Office name, e.g. "Autauga Revenue Commission". | property.tsx:241 | `property_appraisers.name` (seeded from server/data/appraisers.json) | code read | OK |
| "<County> County, <State>" line | text | Where the office is. | property.tsx:242-245 | joined counties.name/state | code read | OK |
| Address line | text | Street address when on record. | property.tsx:247-251 | `property_appraisers.address` | code read | OK |
| Phone (link-phone-{id}) | tel link | Click-to-call the appraiser's phone. | property.tsx:254-264 | `property_appraisers.phone` — NOT nulled by the API (only permit-database contacts are) | first API row shows phone "(334) 358-6750" | OK |
| "Official site · not auto-verified · Last checked …" notice | text | Shown only for unconfirmed links (939 offices). | property.tsx:267 | governmentLinkNotice (shared/government-links.ts:39) | psql: all 939 unconfirmed rows have last_verified_at | OK |
| Searchable-field chips | chips | e.g. Address / Owner / Parcel. | property.tsx:269-277 | `searchable_fields` | code read | OK |
| Notes line | text | Office notes ("Sourced from NETR Online…"). | property.tsx:279-281 | `notes` | code read | OK |
| State-code badge | badge | "AL" / "WA" etc. | property.tsx:285-287 | `counties.state_code` | code read | OK |
| "Search" button (button-search-appraiser-{id}) | external link button | Opens the office's property-record search page in a new tab; only when it differs from the main portal URL and passes the link policy. | property.tsx:288-298 | `property_appraisers.search_url` (nulled by API when dead/inactive/none) | API check: dead (172) and none (151) rows all return null URLs | OK |
| "Visit" button (button-visit-appraiser-{id}) | external link button | Opens the official appraiser portal in a new tab. | property.tsx:299-309 | `property_appraisers.portal_url` (same policy) | spot-curl autauga.capturecama.com → 200 (unconfirmed, shown with notice); property.muni.org → 200 (verified) | OK |
| "Find property records" fallback (link-appraiser-fallback-{id}) | external link | For offices with no usable portal (dead/inactive/none): italic Google search for "<county> <state> assessor property records". Clearly a web search, not a portal. | property.tsx:310-316 | client only | policy-conformant; counts verified above | OK |

### Pagination (property.tsx:322-348)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Prev" (button-prev-page) | button | Previous page, disabled on page 1; scrolls to top. | property.tsx:324-333 | client only (slices the loaded array) | code read | OK |
| "Page X of Y" (text-page-status) | text | Current page of 122 pages (3,040 / 25). | property.tsx:334-336 | client only | arithmetic verified | OK |
| "Next" (button-next-page) | button | Next page, disabled on the last page. | property.tsx:337-347 | client only | code read | OK |
| Over-range guard | behavior | A `?page=` past the end clamps to the last page. | property.tsx:116-120 | client only | code read | OK |

---

## /search — Search Permits

What the page is: the permit search tool (signed-in only — signed-out visitors are bounced to `/auth?next=/search`). A search form (area, type, value, extra filters) runs a live search against the government portals that have a supported automation adapter ("searchable" portals), shows per-portal progress, then merged results (live-scraped + matching saved catalog rows) with status filters, expandable details, and a property-records deep link.

### Search form card (search.tsx:536-767)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Search permits" title (text-page-title) | heading | Names the page. | search.tsx:538-541 | client only | code read | OK |
| "Search area" state select (select-scope-state, items select-state-all / select-state-{code}) | select | Narrows the search to one state (51 options + "All states"); resets the location pick. | search.tsx:547-567 | options from GET /api/counties | psql distinct state codes = 51 | OK |
| "Search area" location select (select-scope-location) | select | Narrows to one county or one city's portal. Contains an embedded "Search cities or counties…" box (input-location-search, client-side narrowing), an "All counties & cities" item, then per-county groups listing each searchable city portal under its county. | search.tsx:568-622; options memo :236-262 | county rows from /api/counties; city portals from GET /api/databases?searchable=true&stateCode=XX (note: the react-query cache key says "/api/databases/county-state" but the actual HTTP call is `/api/databases?searchable=true&stateCode=` — no such /county-state route exists; cosmetic cache label only) | curl `/api/databases?searchable=true&stateCode=WA` → 1 row (King County Building Department) = SQL | OK |
| Per-county "(N searchable portals)" counts in the dropdown | text | How many live-searchable portals each county has; only shown when a state is selected (the nationwide set isn't loaded under "All states", by design). | search.tsx:609-611 | client count over the state's searchable list | WA = 1 verified; nationwide total 120 cross-checked | OK |
| "Search by" select (select-search-type) | select | Address / Keyword / Name / Company name / License # / Permit # (URL alias map: permit_number→permit, company_name→company). | search.tsx:65-81, 626-644 | echoed into search_queries.search_type and the scraper adapter | code read | OK |
| "Search value" input (input-search-value) | input | What to look up; placeholder changes by type; Enter runs the search. | search.tsx:646-663 | sent as searchValue | code read | OK |
| "Filters" toggle (button-toggle-filters, with active-count badge) | button | Expands the date filters; badge shows how many of from/to are set. | search.tsx:666-680 | client only | code read | OK |
| "Date from" / "Date to" inputs (input-filter-date-from / -to) | date inputs | Client-side narrowing of results by issuedDate (MM/DD/YYYY or ISO parsed); each caps the other. | search.tsx:684-715 | client only | code read | OK |
| "End date is before start date…" alert (text-date-range-error) | inline alert | Warns when the range is inverted (guarantees zero matches). | search.tsx:716-720 | client only | code read | OK |
| "From: …" / "To: …" filter badges + "Clear all" (button-clear-filters) | badges + button | Shows the active date filters; each ✕ removes one; Clear all resets both. | search.tsx:722-741 | client only | code read | OK |
| Scope count line (text-scope-count) | text | "120 searchable portals nationwide" / "N searchable portals in <State>" / "…in <County>". Nationwide number comes from the counts API; state/county numbers from the searchable-portals list. No number is shown while loading ("Counting…"). | search.tsx:292-304, 745-752 | GET /api/databases/counts → `searchable` (storage.ts:297-309: candidates is_active + platform not null + link not null, then JS filter governmentLinksAvailable && canScrapeGovernmentPortal) | psql regex re-implementation = **120** = API; `/api/databases?searchable=true` length = 120; WA = 1 | OK |
| "Search" button (button-search) | button | Starts the search: POSTs the form, then polls for live progress. Disabled while pending or when the value is empty. | search.tsx:753-765, 306-326, 369-386 | POST /api/search → routes.ts:510-581: loads all permit_databases, narrows by scopeCountyId or scopeState, keeps live-searchable ones (same shared rules), also searches the saved catalog (storage.ts:378 searchLocalResults: search_results JOIN permit_databases ILIKE match, limit 1000) scoped to those portals; if nothing searchable AND no local hits → `{noSearchablePortals:true, message}` with no quota spent; otherwise reserves 1 monthly "searches" quota (resets 1st UTC, plan-dependent), inserts a search_queries row, starts the live scrape (server/scraper.ts startLiveSearch, headless Chromium against each portal), returns `{query, searchId, results, totalResults, searchablePortals}`. | endpoint + body shape read in code; POST curls 401 signed-out (expected) | OK (verified by code) |

### Live-status panel (search.tsx:769-854)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Status line + icon (text-search-status) | status text | "Searching databases…" / "Search complete" / "Search failed: none of the N portals could be searched" / "Search finished: N of M portals could not be searched". | search.tsx:773-793 | GET /api/search/live/:searchId → routes.ts:583-611 → scraper.ts:177 getLiveSearchJob (in-memory; 404 when gone/restarted, which the client turns into a "run it again" toast for restored links) | poll contract read in code; unauth curl → 401 | OK (verified by code) |
| "finished/total" counter + elapsed seconds | text | How many portals have finished vs were queued, and wall-clock time. | search.tsx:794-799 | job.databases statuses (pending/running/completed/error/skipped), elapsedMs server-computed | code read | OK (verified by code) |
| Progress bar | bar | finished/total as a percentage. | search.tsx:802-807 | same | code read | OK |
| Per-portal rows (status-db-{id}, data-status) | status rows | Each searched portal with an icon (completed/running/pending/error/skipped), its name, an error message when it failed (status-db-message-{id}), and the permits found on it when >0. | search.tsx:809-845 | job.databases entries written by the scraper adapters | code read | OK (verified by code) |
| "Starting search…" spinner | placeholder | While the POST is in flight before the first poll response. | search.tsx:849-854 | n/a | code read | OK |

### Results (search.tsx:856-1093)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Results" header (text-results-header) | heading | Section title. | search.tsx:859 | client only | code read | OK |
| Result count (text-result-count) | text | "N results" or "N of M" when the status/date filters narrow the list. Counts client-side over the merged results (live + saved catalog). | search.tsx:862-866 | merged list from GET /api/search/live/:searchId (recomputed from searchLocalResults filtered to the searched portals) | code read | OK |
| Status filter checkboxes (checkbox-status-all, checkbox-status-{slug} with counts) | checkboxes | Normalizes raw statuses (Expired/Complete/Final/Pending/Issued/Denied-Cancelled/Fees Owed…) and counts them; toggling narrows the list client-side. | search.tsx:51-63, 390-417, 869-893 | client only | code read | OK |
| Result card (card-result-{id}) | card container | One card per permit. | search.tsx:908-913 | search_results rows (live scrape inserts + saved catalog), joined with permit_databases for jurisdiction | code read | OK |
| Permit number (text-permit-number-{id}) | text | The permit/case number. | search.tsx:918-920 | search_results.permit_number | code read | OK |
| Permit-type badge | badge | e.g. "Building", "Mechanical". | search.tsx:921-923 | permit_type | code read | OK |
| Status pill (StatusBadge 1148-1161) | status pill | Raw status text with a tone: green issued/approved/complete/closed, amber pending/review/applied, red expired/denied/cancel/void, grey otherwise. | search.tsx:924 | status | code read | OK |
| Address / description | text | Where the work is; two-line clamped description. | search.tsx:926-934 | address, description | code read | OK |
| Issued date | text | Issue date as the portal reported it (string passthrough). | search.tsx:937-939 | issued_date | code read | OK |
| Jurisdiction / database name | text | Which office the permit came from. | search.tsx:940-944 | permit_databases.jurisdiction/name via join | code read | OK |
| Applicant / contractor / parcel / district lines | text | Who applied, the contractor, parcel number, council district — each only when present. | search.tsx:948-973 | applicant_name, contractor_name, parcel_number, district | code read | OK |
| "Expires …" / "Finalized …" lines | text | Expiration and final-inspection dates when present. | search.tsx:975-990 | expiration_date, finalized_date | code read | OK |
| Contacts block "Contacts (N)" | sub-list | People on the permit (type, name, company, phone, email) from the portal's detail page. | search.tsx:992-1030 | search_results.contacts jsonb | code read | OK |
| "View details / Hide details" (button-details-{id}) | button | Expands the card and fetches the full permit record from the portal (cached in the row afterwards). | search.tsx:493-519, 1032-1050, 1066-1086 | POST /api/permit-details/:resultId → routes.ts:675-710: reads search_results.raw_data; if no cached `permitDetails`, runs scrapePermitDetail against the portal's search URL with the headless browser, then writes rawData.permitDetails + detailsFetchedAt back into the row; returns {details, cached}. Shows a key/value grid, "No additional details available." when empty, or a spinner while fetching. | endpoint + body read in code; unauth curl → 401 | OK (verified by code) |
| "Property lookup" (button-property-lookup-{result.id}) | link | Opens `/property?countyId=<countyId>` in a new tab — deep-links the Property Records page with that county preselected. | search.tsx:1051-1063 | route exists in both trees (App.tsx:169, 292); property.tsx reads countyId (property.tsx:52) | code read | OK |
| "No results match your filters" empty state (+ button-clear-filters-empty) | empty state | Shown when active filters zero out the results; Clear filters resets them. | search.tsx:896-906 | client only | code read | OK |

### Search-outcome empty states (search.tsx:1095-1143)

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "No portal could be searched" (+ link-browse-directory-failed → /databases) | empty state | When every portal failed: says the search saw nothing, suggests retrying or opening portals from the Directory. Link route exists in both trees (App.tsx:168, 291). | search.tsx:1097-1107 | searchedDbs===0 && failedDbs>0 | code read | OK |
| "No results found" (+ incomplete-search description) | empty state | Complete search with zero matches; if some portals failed it says results may be incomplete and names the counts. | search.tsx:1108-1116 | client only | code read | OK |
| "Nothing to search here yet" (+ link-browse-directory → /databases) | empty state | Server answered `noSearchablePortals` (no live-searchable portal in the chosen area) — no quota was spent and nothing ran; message comes from the API. | search.tsx:313-317, 1122-1135 | POST /api/search noSearchablePortals branch (routes.ts:539-549) | code read | OK |
| "Ready to search" | empty state | Initial hint before any search. | search.tsx:1137-1143 | client only | code read | OK |

---

## Findings

No hard BUG (wrong number, guessed link, mismatched endpoint, fake fallback) found in this lane. Every count recomputed from Postgres matches the API/page exactly; every shown portal/appraiser link traces to `server/data/*.json` seeded rows carrying `linkStatus`, with `dead`→null, absent→`none`+honest Google fallback, and `unconfirmed` kept visible with status text + last-checked date. Items worth the owner's attention:

- **F1 (data quality, UNCLEAR)** — `permit_databases` contains junk jurisdiction rows visible as card titles, e.g. id 12005 with `name` = `jurisdiction` = **"88, KY"** (`SELECT id,name,jurisdiction FROM permit_databases WHERE name ~ '^[0-9]'` returns it as the first alphabetical row, so it's the literal first card on the unfiltered directory). Looks like a parse artifact of the all-cities seed, not a UI-layer bug. Also two duplicate dead rows "Duluth, GA" (ids 7646, 7677, both `is_active=false`, URLs already emptied). Owner decision whether to clean the seed.
- **F2 (label nuance, OK-by-policy, note)** — the green **"Active"** pill on database cards (databases.tsx:415-419) also covers `unconfirmed` links (169 rows); the pair is only fully honest because the "Official site · not auto-verified · Last checked …" notice renders on the same card (databases.tsx:451). Policy satisfied (status + date shown), but the word "Active" alone overstates an unconfirmed link if a user misses the notice.
- **F3 (cosmetic, OK)** — `lastVerifiedAt` dates render as UTC calendar dates (`toISOString().slice(0,10)`, shared/government-links.ts:42), so for US time zones "Last checked" can read one day later than the local check date. "Last scraped" (databases.tsx:518) uses browser-local `toLocaleString()` — inconsistent, cosmetic only.
- **F4 (dead-by-design elements, OK)** — the phone and email elements on database cards (databases.tsx:492-503) can never render: `/api/databases` maps every row through `governmentPermitForDisplay`, which nulls phone/email/address (shared/government-links.ts:31-36; comment says contacts are "not presented as verified"). Verified live: every API row returns `"phone": null, "email": null`. Harmless but permanently dead code paths; the appraiser page (different helper) does show phones.
- **F5 (cosmetic, OK)** — search.tsx's react-query cache key for the state portal list is `["/api/databases/county-state", scopeState]` (search.tsx:167) but no `/api/databases/county-state` route exists; the custom `queryFn` actually fetches `/api/databases?searchable=true&stateCode=…` (search.tsx:173), which works. Misleading label only.
- **F6 (verified by code only, UNCLEAR)** — POST /api/search, POST /api/scrape, POST /api/permit-details/:id and the live-status/scrape-status polls require a signed-in account with an active plan (quota: `growth_budgets`, monthly reset 1st of month UTC; 402 without a plan, 403 over limit). All return 401 on this signed-out dev server, so the live search/scrape round-trip could not be pressed end-to-end; endpoint existence, method, body shape, and response fields were all verified against server/routes.ts:510-710 and server/scraper.ts, and the live-searchable portal set (120) and per-state sets (WA=1) were verified against independent SQL. Stripe is OFF on dev; no checkout paths on these pages.

### Counts

| Page | Elements mapped | OK | BUG | UNCLEAR | DEAD |
|---|---|---|---|---|---|
| /databases | 41 | 41 | 0 | 0 | 0 |
| /property | 25 | 25 | 0 | 0 | 0 |
| /search | 37 | 37 | 0 | 0 | 0 |
| **Total** | **103** | **103** | **0** | **0** | **0** |

(F1/F6 are page-adjacent data/code notes, not element defects; F2–F5 are policy-conformant behaviors listed for the owner.)
## Lane 6 — small pages map (guides, master-class, reinstatement, auth, 404, privacy, terms)

Audit date 2026-10-04, branch audit/6, dev server http://127.0.0.1:8306 (Vite dev, SPA shell, no prerender), DB `constructhub_dev_a6` read-only. Server confirmed signed-out: `GET /api/auth/me` → `null`; Google OAuth IS configured (GET /api/auth/google → 302 to accounts.google.com with client_id).

Column key — Backend: "—" means no server involvement (static/anchor). Status: OK / BUG / UNCLEAR / DEAD.

---

## /guides — Guides (redirect into Social Media)

`client/src/pages/guides.tsx`. Route `client/src/App.tsx:186` (DashboardRouter, signed-in app) and `App.tsx:338` SIGNED_IN_ONLY. **The default export is `<Redirect to="/social-media?tab=guides">` (guides.tsx:137); it renders no page of its own.** The visible content is `GuidesContent`, mounted as the "guides" tab of the Social Media page (client/src/pages/social-media.tsx:71,1016 reads `?tab=`). Signed out, `/guides` bounces to `/auth?next=/guides` (SignedOutFallback, App.tsx:344-354) — by design, these are in-app walkthroughs.

### Header / nav (guides.tsx:109-121)

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Get started" button | anchor | Scrolls to the first guide (`#guide-0`) | guides.tsx:114 | — | code read | OK |
| "Connect your website" nav link | anchor | Jumps to the Cloudflare/Search-Console walkthrough (`#guide-connection`) | guides.tsx:117 | — | code read | OK |
| 9 guide nav links (Blotato, Manual posting, Auto mode, Agency social workflows, Profile Guard, AI review replies, Posts & Photos, Security, Site Scan) | anchors | Jumps to `#guide-0` … `#guide-8` | guides.tsx:118 | — | code read | OK |
| SiteConnectionGuide (guide-connection) | content | 3 cards: "Put a client site behind Cloudflare" (5 steps), "Connect Cloudflare to ConstructHUB" (7 paragraphs), "Connect Google Search Console" (5 steps + 2 notes) | site-connection-guide.tsx:2-186 | — | code read | OK |
| "Cloudflare setup instructions" link | external link | Opens Cloudflare docs full-setup page | site-connection-guide.tsx:41-48 | — | curl -L → 200 | OK |
| "Cloudflare role reference" link | external link | Opens Cloudflare members-roles docs | site-connection-guide.tsx:113-120 | — | curl -L → 200 | OK |
| "Search Console API quotas" link | external link | Opens Google webmaster-tools limits doc | site-connection-guide.tsx:174-181 | — | curl -L → 200 | OK |

### Guide sections (guides.tsx:122-129) — 9 sections, 45 numbered steps of plain text, each with one "Open …" button

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Steps of "Connect Blotato" (5) | text | Blotato account/API-key walkthrough; Blotato is a third-party paid subscription | guides.tsx:6-16 | — | code read | OK |
| "Open Social Media" button | app link | Goes to `/social-media` | guides.tsx:124 | — | route exists App.tsx:185 | OK |
| Steps of "Manual posting" (6) | text | Compose / schedule / queue walkthrough | guides.tsx:17-28 | — | code read | OK |
| "Open Social Media" button | app link | `/social-media` | guides.tsx:124 | — | route exists | OK |
| Steps of "Auto mode" (5) | text | Auto-posting cadence/budget walkthrough | guides.tsx:29-40 | — | code read | OK |
| "Open Social Media" button | app link | `/social-media` | guides.tsx:124 | — | route exists | OK |
| Steps of "Agency social workflows" (5) | text | Bulk actions, per-business cadence, all-clients calendar (up to 100 posts per bulk action) | guides.tsx:41-51 | — | code read | OK |
| "Open Social Media" button | app link | `/social-media` | guides.tsx:124 | — | route exists | OK |
| Steps of "Profile Guard" (4) | text | Watched-fields snapshot / Lockdown / Google-report flow | guides.tsx:52-61 | — | code read | OK |
| "Open Locations" button | app link | `/locations` | guides.tsx:124 | — | route exists App.tsx:179 | OK |
| Steps of "AI review replies" (4) | text | AI reply settings, backfill preview (≤50 reviews, 10-min preview expiry) | guides.tsx:62-71 | — | code read | OK |
| "Open Google Reviews" button | app link | `/google-reviews` | guides.tsx:124 | — | route exists App.tsx:223 (SHOW_GOOGLE_REVIEWS=true, features.ts:26) | OK |
| Steps of "Posts & Photos scheduling" (6) | text | GBP posts/photos, AI captions, cadence, queue | guides.tsx:72-83 | — | code read | OK |
| "Open Posts & Photos" button | app link | `/gbp-content` | guides.tsx:124 | — | route exists App.tsx:184 | OK |
| Steps of "Security" (5) | text | 2FA, remembered devices, notifications, activity review | guides.tsx:84-94 | — | code read | OK |
| "Open Security & activity" button | app link | `/settings?tab=security` | guides.tsx:124 | — | route exists App.tsx:236 | OK |
| Steps of "Site Scan" (5) | text | Scan setup, AI fix plan, share links (30-day expiry), monthly rescan; last step references the public `/free-site-scan` | guides.tsx:95-106 | — | code read | OK |
| "Open Site Scan" button | app link | `/site-scan` | guides.tsx:124 | — | route exists App.tsx:189 (+ `/free-site-scan` App.tsx:532) | OK |

Counts /guides: 34 elements — 34 OK, 0 BUG, 0 UNCLEAR, 0 DEAD.

---

## /master-class — Master Class (public marketing page, 5 tabs)

`client/src/pages/master-class.tsx` (2728 lines). Public route App.tsx:190/297. Signed out it wears `PublicPageHeader cart` + `PublicPageFooter` (master-class.tsx:314, 2724); signed in it renders bare inside the app frame (chrome renders null). State list is a hardcoded 50-entry `US_STATES` (master-class.tsx:60-78).

Data sources (all verified live):
- `GET /api/state-guides` → `SELECT * FROM state_guides ORDER BY state_name` (routes.ts:3208) — live: **50 rows, 32 `licensing_required=true`** (SQL recompute).
- `GET /api/state-guides/:code` → guide + `state_guide_steps` ordered by step_number (routes.ts:3213-3219) — steps exist for only FL (7) and WA (8) (SQL).
- `GET /api/master-class-modules` → `master_class_modules WHERE is_active ORDER BY sort_order` (routes.ts:3221) — live: 4 modules, ids 1 licensing $1,500 / 2 gmb $2,000 / 3 website $1,500 / 4 seo $1,500; matches `server/data/master-class-modules.json` (seeded only if table empty, seed-reference-data.ts:174).
- `GET /api/course-purchases` → user's `course_purchases`, `[]` signed out (routes.ts:3226-3232).

**Pricing reality (recomputed):** `SALES_THRESHOLD_CENTS = 100_000` ($1,000) in shared/plans.ts:415. Bundle `BUNDLE_PRICE_CENTS = 249_900` ($2,499, master-class.tsx:166) == server `COURSE_BUNDLE.priceCents` (server/catalog.ts:35-38). Modules total $6,500. Because **every price here is ≥ $1,000, `showsPrice()` is false for all of them**: in a production build the page never shows a price, never shows "Bundle saves %", and every buy path is replaced by "Talk to a sales rep". This matches Terms §7 and the server (`isSalesOnly` → 409 `talk_to_sales` at checkout, server/stripe.ts:447/480), so it is coherent — but it means the enroll/cart buttons below are unreachable in prod (marked DEAD). On this dev server `import.meta.env.DEV` is true, so `isTabUnlocked` returns true for all tabs (master-class.tsx:241-250); in prod the state-guide/website-seo/vetting tabs need module ids 1/3/4 or the bundle (`TAB_MODULE_MAP` master-class.tsx:45-49 — matches DB ids).

### Page header (master-class.tsx:317-320)

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `text-master-class-title` / `text-master-class-subtitle` | text | "Master Class" title + subtitle | master-class.tsx:317-318 | — | code read | OK |
| `badge-states-count` "50 states" | stat badge | Hardcoded 50 | master-class.tsx:319 | state_guides row count | SQL: `SELECT count(*)` = 50 | OK |
| `badge-licensing-count` "{n} require licensing" | stat badge | Computed from guides where licensingRequired | master-class.tsx:307,319 | state_guides.licensing_required | API recompute: 32 | OK |
| "Choose your state" button (overview only) | button | Switches to state-guide tab | master-class.tsx:320,383 | — | code read | OK |
| `button-overview-enroll` "How to enroll" (overview only) | button | Switches to pricing tab | master-class.tsx:320 | — | code read | OK |

### Tabs (master-class.tsx:322-342)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `tab-overview` | tab | Overview tab; `?tab=` synced via useUrlParam | master-class.tsx:324 | — | code read | OK |
| `tab-state-guide` (+ Lock icon when locked) | tab | State guide; locked unless module 1/bundle/dev | master-class.tsx:327-330 | course_purchases (moduleId=1 or isBundle) | code read + DB ids | OK |
| `tab-website-seo` (+ Lock) | tab | Website & SEO; module 3 | master-class.tsx:331-334 | course_purchases (moduleId=3) | code read + DB ids | OK |
| `tab-vetting` (+ Lock) | tab | Vetting contractors; module 4 | master-class.tsx:335-338 | course_purchases (moduleId=4) | code read + DB ids | OK |
| `tab-pricing` "Enroll" | tab | Pricing/enroll tab (never locked) | master-class.tsx:339-341 | — | code read | OK |

### Overview tab (master-class.tsx:344-668)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `badge-sale` "Bundle saves {pct}%" | stat badge | Rendered only when bundle price is shown (< $1,000) | master-class.tsx:347-351,233-238 | — | price math: 249900 ≥ 100000 → never rendered | DEAD (unreachable under current prices; would read 62% if it showed) |
| Stat "4 / In-Depth Modules" | stat | Hardcoded module count | master-class.tsx:357-360 | master_class_modules is_active | SQL count = 4 | OK (hardcoded; brittle if a module is added) |
| Stat "50 / State Guides" | stat | Hardcoded | master-class.tsx:361-364 | state_guides count = 50 | SQL | OK (hardcoded) |
| `stat-licensing-states` "{n}" (or "—" while loading) | stat | States requiring a license | master-class.tsx:365-368 | state_guides.licensing_required | API/SQL = 32 | OK |
| `text-overview-bundle-price` | stat | $2,499 — only if < threshold | master-class.tsx:371-372 | — | showsPrice(249900)=false → not rendered in prod | DEAD (price slot; server COURSE_BUNDLE matches 249900) |
| `link-overview-bundle-sales` "Talk to a sales rep" | link | What shows instead of the bundle price; goes to `/pricing#services` | master-class.tsx:373-374 | SALES_HREF = "/pricing#services" (plan-copy.ts:17) | route /pricing exists (App.tsx:176/294); anchor `id="services"` exists (pricing.tsx:656) | OK |
| `text-bundle-reference` | text | Strike-through total of the 4 modules ("$6,500 separately") or "All four modules" | master-class.tsx:376-378 | master_class_modules.price sum | SQL sum = 650000 | OK |
| `button-overview-preview` "Preview state guide" | button | Switches to state-guide tab | master-class.tsx:383 | — | code read | OK |
| Curriculum — 4 module blocks (licensing/gmb/website/seo) w/ descriptions + 4 highlight bullets each | content | Static marketing copy; per-module price span `text-curriculum-price-{category}` | master-class.tsx:399-449 | master_class_modules matched by category | DB categories match the 4 hardcoded blocks | OK |
| `text-curriculum-price-{licensing,gmb,website,seo}` | price text | `priceOrSalesRep(module.price)` → "Talk to a sales rep" for all 4 ($1,500–$2,000 ≥ $1,000) | master-class.tsx:429-435 | — | showsPrice false for all | OK (renders sales label, not a number) |
| `<details>` "About the course and licensing" | disclosure | 6 "Who This Course Is For" cards + 3 "What Makes This Different" cards | master-class.tsx:453-556 | — | code read | OK |
| "States Requiring Contractor License ({n})" + `badge-licensed-{code}` chips | chips | One clickable badge per licensing state → selects state, opens state-guide tab | master-class.tsx:505-527 | state_guides.licensing_required=true | SQL = 32 chips | OK |
| "No State Contractor License Required ({n})" + `badge-unlicensed-{code}` chips | chips | One per non-licensing state + disclaimer about local/trade licenses | master-class.tsx:528-553 | state_guides.licensing_required=false | SQL = 18 chips | OK |
| `<details>` "Compare all 50 states" | disclosure | Search box + 50-row comparison table (License / Workers Comp / Sales Tax / B&O / Bond / SOS) | master-class.tsx:557-668 | state_guides columns | code read | OK |
| `input-search-states` | input | Filters the table by state name/code client-side | master-class.tsx:566-572 | — | code read | OK |
| `row-state-{code}` (50 rows) | table row | Click → selects state + opens state-guide tab | master-class.tsx:588-661 | — | code read | OK |
| `link-sos-{code}` (50) | external/search link | Opens the state's SOS URL if present and not "dead"; otherwise a Google search for "{sosName} {stateName} business filings" | master-class.tsx:632-659 | state_guides.sos_url + sos_url_status | SQL sample WA/CA/TX/FL "verified" → curl 200; NY "unconfirmed" still links with a caution tooltip | OK |

### State-guide tab (master-class.tsx:671-1341)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `select-state` (50 options) | select | Picks the state; fetches the guide | master-class.tsx:673-682 | GET /api/state-guides/:code | API live | OK |
| `button-clear-state` | button | Clears selection | master-class.tsx:684 | — | code read | OK |
| Empty state ("Select Your State") | content | Placeholder before a choice | master-class.tsx:690-700 | — | code read | OK |
| `text-state-name` + overview paragraph | text | Full overview only when tab unlocked; otherwise a teaser + "Purchase the course to unlock" | master-class.tsx:713-720 | state_guides.overview | code read | OK |
| License/Bond/Tax-on-Labor/`Locked` badges | badges | Flags from the guide row | master-class.tsx:722-737 | state_guides.licensing_required, bond_required, sales_tax_on_labor | SQL present | OK |
| `link-agency-sos` | agency tile | Opens SOS site (or Google search when no checked URL); locked shows a Lock | master-class.tsx:741-744,127-160 | state_guides.sos_url, sos_url_status, links_checked_at | curl spot checks 200 | OK |
| `link-agency-licensing` | agency tile | Licensing board link; "No state license" tile when licensingRequired=false and no board URL | master-class.tsx:745-758 | licensing_board_url + status | code read | OK |
| `link-agency-workers-comp` | agency tile | Workers-comp agency link or search | master-class.tsx:759-762 | workers_comp_url + status | code read | OK |
| `link-agency-tax` | agency tile | Tax board link or search | master-class.tsx:763-766 | tax_board_url + status | code read | OK |
| 5 stat cards (Entity Types / State License / Workers Comp / Tax on Labor / GC Bond) | stats | From guide row; GC Bond falls back to "None" | master-class.tsx:773-804 | state_guides.entity_types, gc_bond_amount, … | code read | OK |
| Licensing Details / Insurance & Workers Comp / Payroll & Tax sections | text | Shown when the corresponding notes column is non-null | master-class.tsx:806-843 | licensing_notes, insurance_notes, payroll_notes | code read | OK |
| Step-by-step cards `card-step-{n}` + `link-step-{n}` | steps | Numbered process with category badge, Required/Optional, tips, external link per step | master-class.tsx:845-904 | state_guide_steps (only FL=7, WA=8 have any) | SQL | OK |
| "Detailed Steps Coming Soon" card | content | Honest placeholder for the 48 states without steps | master-class.tsx:906-916 | — | SQL: 48 states without steps | OK |
| "Building & Running Your Business" sections (subs 1099, sales close-rate benchmarks, review-cost math, hiring/PM salary $45–75k, branding, bottom-line) | content | Static course text; hardcoded industry figures (33%+/20%/<15% close rates, $50–150/lead, 10–15%/20–50% revenue loss per bad review, $500K example math, 8–10% commission, PM $45–75k) | master-class.tsx:918-1301 | — | content claims — owner-sourced, not verifiable against DB | UNCLEAR (marketing figures, plausibly owner-supplied; no DB backing possible) |
| James Hardie Elite claim ("used to require 36 full re-siding projects… now 10, partial jobs as small as 150 sq ft qualify") | text inside tip 4 of vetting tab (also referenced) | Factual claim about a third-party certification program | master-class.tsx:2042 | — | cannot verify from repo | UNCLEAR |
| Locked-state: "What's Included" list (8 bullets) + `text-paywall-title` "Enrolled Students Only" + `button-paywall-unlock` "How to enroll" | paywall | What a non-student sees instead of details; button jumps to pricing tab | master-class.tsx:1304-1337, 51-58 | course_purchases | code read | OK |

### Website & SEO tab (master-class.tsx:1343-1902)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Building a Strong Website That Ranks" header + `Locked` badge | content | Tab title; lock when not entitled | master-class.tsx:1344-1353 | — | code read | OK |
| Locked: "Browse lesson topics" `<details>` (6 topic tiles) | disclosure | Teaser list of the 6 lessons | master-class.tsx:1354-1370 | — | code read | OK |
| Locked: `PaywallOverlay` ("Enrolled Students Only" + `button-paywall-unlock`) | paywall | Jumps to pricing tab | master-class.tsx:1374-1375 | — | code read | OK |
| Unlocked: 10 lesson sections (Location/Slug pages, GSC incl. Disavow warning, Page Speed, Tracking & Analytics, Backlinks, Content Strategy, Schema, Mobile-First, Social, Email, Google Ads & LSA) | content | Static course text | master-class.tsx:1377-1822 | — | code read | OK |
| `link-pagespeed` | external link | Google PageSpeed Insights | master-class.tsx:1463-1471 | — | curl -L → 200 | OK |
| `link-tracemyip` | external link | TraceMyIP visitor tracker | master-class.tsx:1502-1510 | — | curl -L → 200 | OK |
| `form-seo-inquiry` — `input-seo-name`, `input-seo-email` (required), `input-seo-phone`, `input-seo-website`, 11 `badge-service-*` toggles, `textarea-seo-message`, `button-submit-seo-inquiry` | form | "Need Help With Any of These Services?" inquiry → POST `/api/seo-inquiry` JSON {name,email,phone,website,services[],message}; success → toast "Inquiry sent… within 1 business day" + field reset; client email regex pre-check | master-class.tsx:271-294, 1835-1897 | POST /api/seo-inquiry (routes.ts:3306) → zod `seoInquiryInput` (routes.ts:3284-3292, maxes 200/254/50/500/30×100/5000) → `sendWithFallback` email to `SMTP_EMAIL` (team inbox), subject `salesInquirySubject`, replyTo=inquirer; limit 5/user+5/IP/hour (`seoInquiryLimit` routes.ts:71); resp `{success:true}`; failure 500 "Failed to submit inquiry…" | server schema fields match body 1:1; endpoint exercised by growth-hardening.test.ts:130 (400 on bad email); sink mechanism read (email.ts:203-229) | OK |

### Vetting contractors tab (master-class.tsx:1904-2466)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "19 Essential Tips for Vetting a Contractor" header + lock | content | Title matches the 19 cards | master-class.tsx:1912-1916 | — | counted 19 cards `card-vetting-tip-1..19` | OK |
| Locked: "Browse lesson topics" (19 numbered tiles) | disclosure | Teaser | master-class.tsx:1922-1952 | — | code read | OK |
| Locked: PaywallOverlay | paywall | → pricing tab | master-class.tsx:1956-1957 | — | code read | OK |
| Unlocked: 19 tip cards | content | Static vetting advice (affiliation claims, experience, permitting loophole, manufacturer programs, vanishing estimates, illusion of size, price≠service, badmouthing, license≠legitimacy, web presence, cold calls, warranty, physical office, BBB, fabricated accomplishments, referrals/fake reviews, credibility fabrication, financing scams, too-good pricing) | master-class.tsx:1960-2466 | — | code read | OK |

### Pricing / Enroll tab (master-class.tsx:2467-2720)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `badge-pricing-savings` "Bundle saves {pct}%" | badge | Only when savings computable — requires bundle price shown | master-class.tsx:2469-2473 | — | never rendered at current prices | DEAD (by design) |
| Bundle card: `badge-bundle-best-value` | badge | Only when `bundleSavingsCents !== null` | master-class.tsx:2482-2486 | — | never rendered | DEAD (by design) |
| `text-bundle-was` (struck-through $6,500) | price | Only when bundle price shown | master-class.tsx:2494-2496 | — | never rendered | DEAD |
| `text-bundle-price` $2,499 | price | Only when < threshold | master-class.tsx:2498 | COURSE_BUNDLE 249900 matches | server value matches | OK (hidden in prod; value correct) |
| `text-bundle-savings` "Save $4,001 — the four modules total $6,500…" | text | Only when computable | master-class.tsx:2500-2504 | — | never rendered (math would be 650000−249900=400100) | DEAD (by design) |
| `button-enrolled-bundle` "Bundle purchased" (disabled) | button | Shown when `purchases.some(p=>p.isBundle)` | master-class.tsx:2505-2508 | course_purchases.is_bundle | code read | OK |
| `button-bundle-sales` TalkToSalesButton "Master Class — Complete Bundle" | button+dialog | Opens TalkToSalesDialog → POST /api/seo-inquiry with services:["Master Class — Complete Bundle"] | master-class.tsx:2509-2515 | talk-to-sales.tsx:41-52 → /api/seo-inquiry | code read | OK |
| `button-add-cart-bundle` "Add to cart" | button | Adds `course_bundle` $2,499 to cart | master-class.tsx:2518-2540 | — | only rendered when `bundlePriceShown` — never at $2,499 | DEAD (also cart/checkout would 409 talk_to_sales server-side) |
| `button-enroll-bundle` "Buy now — $2,499" | button | POST /api/stripe/create-course-checkout {bundle:true} → Stripe redirect | master-class.tsx:2541-2550 | server/stripe.ts:439-473: 401 "Login required" signed out; isSalesOnly(249900) → 409 talk_to_sales even signed in | rendered conditionally on bundlePriceShown → never | DEAD |
| 4 module cards `card-module-{category}` | cards | Icon, title, price/"Talk to a sales rep", description, features list, action buttons | master-class.tsx:2556-2647 | master_class_modules | DB = 4 cards | OK |
| `badge-purchased-{category}` | badge | When module purchased or bundle owned | master-class.tsx:2564-2568 | course_purchases | code read | OK |
| `text-module-sales-{category}` "Talk to a sales rep" | text | Renders for every module (all ≥ $1,000) | master-class.tsx:2577 | — | showsPrice false ×4 | OK (by design) |
| `button-enrolled-{category}` (disabled "Enrolled") | button | When purchased | master-class.tsx:2592-2599 | course_purchases | code read | OK |
| `button-module-sales-{category}` TalkToSalesButton | button+dialog | → /api/seo-inquiry | master-class.tsx:2600-2606 | talk-to-sales.tsx | code read | OK |
| `button-add-cart-{category}` / `button-enroll-{category}` "Buy now" | buttons | Cart add / POST /api/stripe/create-course-checkout {moduleId} | master-class.tsx:2608-2641 | stripe.ts:476-506 (404 unknown module; 409 talk_to_sales for sales-only price) | rendered only when priceShown — never at current prices | DEAD (server would refuse with 409 anyway) |
| "What's included" (6 tiles + summary line + `button-bundle-summary-sales`) | content | Bundle contents; summary shows struck $6,500 + bundle price or sales button | master-class.tsx:2651-2692 | — | code read | OK |
| FAQ (6 Q&A) | content | Answers; the "buy modules separately" answer adapts to price visibility | master-class.tsx:2694-2720 | — | code read | OK |

### Public chrome on this page

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `header-public-page` (SiteNavBar) w/ cart | header | Site ribbon + cart; renders only signed out | public-page-chrome.tsx:36-45 | GET /api/auth/me | /api/auth/me → null | OK |
| `footer-public-page`: Home, Features, Done-For-You, AI Call Assistant, support@constructhub.us, Terms, Privacy + 4 footer-guide links + copyright | footer | Site-wide footer | public-page-chrome.tsx:71-94 | — | all 7 routes + 4 guide routes exist in App.tsx (192,198,200,201,206,211,309,312) | OK |

Counts /master-class: 96 elements — 84 OK, 0 BUG, 2 UNCLEAR (hardcoded course/marketing figures; James Hardie claim), 10 DEAD (price-gated elements unreachable because every price ≥ the $1,000 sales threshold; server-side guards agree, so no live defect).

---

## /reinstatement — GBP reinstatement service page

`client/src/pages/reinstatement.tsx`. Public route App.tsx:191/298. **Two renderings: signed out** → full marketing page with `PublicPageHeader`/`PublicPageFooter`; **signed in** (`if (user)` reinstatement.tsx:181) → compact `AppPage` with StatGrid, the same form in a Section, and the content collapsed into one `<details>`. Price everywhere is `formatUsd(GBP_REINSTATEMENT_CENTS)` = **$599** (shared/plans.ts:413 `59_900`).

### Hero (reinstatement.tsx:204-272, signed-out)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `badge-service-label` "GBP REINSTATEMENT SERVICE" | kicker | Label | reinstatement.tsx:209-211 | — | code read | OK |
| `text-reinstatement-title` "Is your Google Business Profile Suspended?" | H1 | Hero headline | reinstatement.tsx:212-214 | — | code read | OK |
| Hero copy | text | Empathy + what we do; "do everything we can" — no outcome guarantee | reinstatement.tsx:215-217 | — | code read | OK |
| `reinstatement-facts` stats: "4 / Step process", "1–2 / Business days to review your case", "{price} / Per project" | stats | Hardcoded 4 and 1–2; price from shared/plans ($599) | reinstatement.tsx:218-231 | shared/plans.ts GBP_REINSTATEMENT_CENTS | formatUsd math | OK |
| `card-reinstatement-pricing` pricing card: $599/project + 5 includes + `button-get-reinstated` "Request a case review" | card+button | Scrolls to `#reinstatement-form` | reinstatement.tsx:234-268 | — | code read | OK |
| "We only take cases where we're confident we can help." | text | Under the CTA | reinstatement.tsx:264-266 | — | code read | OK |

### Sections (signed-out)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `text-consequences-title` "A suspension can break your business" + `card-consequence-{0,1,2}` (phone stops ringing / can't find you / reviews disappear) | content | Cost-of-suspension cards | reinstatement.tsx:274-298 | — | code read | OK |
| `text-process-title` "How we get you back on the map" + `process-step-{1..4}` | content | 4-step process (form → assessment → fix & comply → appeal) | reinstatement.tsx:300-318 | — | code read | OK |
| `text-suspension-reasons-title` + `suspension-reason-{0..4}` | content | 5 common suspension reasons | reinstatement.tsx:320-336 | — | code read | OK |
| Soft vs Hard suspension explainer | content | Two-type typology | reinstatement.tsx:338-350 | — | code read | OK |
| `text-trust-title` "Why trust ConstructHUB with your GBP" + `card-trust-{0..3}` | content | 4 trust points — deliberately no track-record numbers (comment reinstatement.tsx:46-48) | reinstatement.tsx:356-378 | — | code read | OK |
| Form-side reassurance list (Quick response / Honest assessment / No obligation) | content | 3 bullets | reinstatement.tsx:389-403 | — | code read | OK |

### Request form (both renderings; reinstatement.tsx:106-180)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `form-reinstatement` | form | POST `/api/reinstatement/request` with the whole state object | reinstatement.tsx:106,73-77 | POST /api/reinstatement/request (routes.ts:3342) → zod `reinstatementInput` (routes.ts:3293-3302: name≤200*, email, businessName≤300*, websiteUrl≤500 opt, businessAddress≤500*, businessType≤200*, multipleLocations≤20 opt, problemDescription≤5000*; * = required) → `sendWithFallback` email from SMTP_EMAIL to SMTP_EMAIL (the team inbox), subject "GBP Reinstatement Request — {businessName}", replyTo=inquirer; limit 5/user + 5/IP per hour (`reinstatementLimit` routes.ts:72, growth-limits.ts:29); success `{success:true}` → toast "Request submitted… within 1-2 business days" + full field reset; 400 zod message / 500 "Failed to submit request…" → destructive toast | field names match 1:1; **live AUDIT submission returned `{"success":true}`** and the email landed in the dev sink `tmp/email-outbox.jsonl` (to support@constructhub.us, subject "GBP Reinstatement Request — AUDIT-Lane6-Test-Business", all fields present in HTML) | OK |
| `input-reinstate-name` | input | Your name (required) | reinstatement.tsx:110 | users — none; email only | code read | OK |
| `input-reinstate-email` | input | Email (required, type=email + client regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) | reinstatement.tsx:114 | server z.email | code read | OK |
| `input-reinstate-business` | input | Business name (required) | reinstatement.tsx:120 | businessName | code read | OK |
| `input-reinstate-website` | input | Website URL (optional) | reinstatement.tsx:124 | websiteUrl optional | code read | OK |
| `input-reinstate-address` | input | Business address (required; "even if hidden") | reinstatement.tsx:130 | businessAddress | code read | OK |
| `select-business-type` | select | storefront / service-area / hybrid / other (required) | reinstatement.tsx:134-144 | businessType | code read | OK |
| `radio-multi-no` / `radio-multi-yes` | radios | Multiple locations? default "no" (optional) | reinstatement.tsx:148-157 | multipleLocations | code read | OK |
| `textarea-problem-description` | textarea | What happened (required) | reinstatement.tsx:161-168 | problemDescription | code read | OK |
| `button-submit-reinstatement` "Submit" | button | Disabled until all required fields non-empty; pending spinner | reinstatement.tsx:170-179 | — | code read | OK |

Signed-in variant extras: `button-get-reinstated` (anchor `#request`), `card-reinstatement-pricing` Stat ($599), "Initial review 1–2 days", and a single `<details>` "How reinstatement works" carrying `badge-service-label`, `text-process-title`, `text-suspension-reasons-title`, `text-consequences-title`, `text-trust-title` and the same lists (reinstatement.tsx:181-198). Same form, same endpoint.

**Endpoint trace note:** this endpoint writes **no table** — the "request" is the email to the team inbox (plus rate-limit budget rows). There is no CRM row, no notification record, no user-visible history. If SMTP fails the client correctly shows the failure toast (500 path).

Counts /reinstatement: 29 elements — 29 OK, 0 BUG, 0 UNCLEAR, 0 DEAD.

---

## /auth — Sign in / sign up / password reset / 2FA / Google

`client/src/pages/auth.tsx` (746 lines). Route in every router (App.tsx:237/289/428/455/607). Initial mode from URL: `?mode=2fa` → 2fa; `?mode=reset-password&token=` → reset; `?mode=forgot-password` → forgot; `?mode=signup` or `?beta=` → signup; else login (auth.tsx:51-55). Mode changes sync `?mode=` into the URL (auth.tsx:71-82). `?next=` is validated client-side with the same-origin rule as server `safeNextPath` (auth.tsx:40-41 vs server/auth.ts:34-41); a signed-in visitor without `?beta=` is redirected to `next ?? "/"` (auth.tsx:43-49). Error toasts from `?error=` (auth.tsx:84-96): invalid-token, token-expired, google-failed, google-unavailable, verification-failed.

Server: all auth endpoints in `server/auth.ts`. Rate limit on signup/login/forgot/reset/2fa: 30/user + 60/IP per 15 min, plus 10 attempts per email per 15 min (auth.ts:240-247). No passport-local strategy exists — password login is a manual bcrypt compare in `/api/auth/login`; passport is used only for Google OAuth and session serialization. **Dev bypass:** `server/test-auth.ts` auto-attaches user 1 when `DEV_AUTH_BYPASS_USER1=true` (non-production) or `CRM_DEMO_AUTOLOGIN=true` — **off on this dev server** (`/api/auth/me` → null), so these flows were verified signed-out.

### Sign-in mode (auth.tsx:357-438)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `text-form-title` "Welcome back" + lede | text | Mode header | auth.tsx:360-361 | — | code read | OK |
| `link-google-login` "Continue with Google" | OAuth link | `GET /api/auth/google` (+`?next=` when present) → passport Google → callback → redirect `next ?? /?auth=success`; failures → `/auth?error=google-failed` (or `google-unavailable` when not configured); 2FA-enabled accounts → `/auth?mode=2fa` | auth.tsx:364 | GET /api/auth/google (auth.ts:251-291) → GET /api/auth/google/callback (auth.ts:293-362); session.authNext stashed via safeNextPath | live: GET /api/auth/google → 302 to accounts.google.com (configured on dev); code read of callback | OK |
| `OrRule` | divider | Visual | auth.tsx:369 | — | — | OK |
| `input-login-email` / `input-login-password` (+ show/hide toggle) | inputs | Credentials, both required | auth.tsx:376-402 | — | code read | OK |
| `button-login` "Sign In" | button | POST `/api/auth/login` {email,password} → 401 "Invalid email or password" (toast); 403 "Please verify your email…" (message shown + resend button); `{requires2FA:true}` → switch to 2fa mode; success → invalidate `/api/auth/me`, navigate `next ?? "/"` | auth.tsx:405-408,132-153 | POST /api/auth/login (auth.ts:421-470) → users by email, bcrypt.compare, email_verified check, totp → pending2FAUserId + 10-min expiry; req.login + activity log + member login notify | endpoint present, shape matches (auth.ts:448 `requires2FA`); code read | OK |
| `button-resend-verification` "Resend verification email" (conditional) | button | POST `/api/auth/resend-verification` {email} | auth.tsx:411-417,223-234 | POST /api/auth/resend-verification (auth.ts:574-599) → new verification token (24h), email; generic message if no account | code read | OK |
| `link-forgot-password` | text button | Switches to forgot-password mode | auth.tsx:420-427 | — | code read | OK |
| `link-goto-signup` "Create an account" | text button | Switches to signup mode | auth.tsx:428-435 | — | code read | OK |

### Sign-up mode (auth.tsx:440-559)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `text-form-title` "Create your account" | text | Header | auth.tsx:443-445 | — | code read | OK |
| `banner-beta-invite` (when `?beta=`) | banner | "You're invited to the ConstructHub CRM beta — unlimited access during beta." | auth.tsx:447-451 | beta token consumed server-side | code read | OK |
| `link-google-signup` "Sign up with Google" | OAuth link | `GET /api/auth/google?beta=…` or `?next=…`; beta token rides the session through OAuth | auth.tsx:453 | auth.ts:265-267 (session.betaToken), 291-362 callback → `crm/beta consumeBetaInvite` on completion | code read | OK |
| `input-signup-name` | input | Full name (optional → displayName) | auth.tsx:477-486 | users.display_name | code read | OK |
| `input-signup-email` | input | Required, type=email | auth.tsx:492-501 | — | code read | OK |
| `input-signup-password` / `input-signup-confirm` (+toggle) | inputs | ≥8 chars, must match (client checks) | auth.tsx:505-536 | password ≥8 enforced server-side too (auth.ts:370) | code read | OK |
| `checkbox-agree-terms` + `link-signup-terms` (`/terms` or `/crm-terms` on portal) + `link-signup-privacy` (`/privacy` or `/crm-privacy`) | checkbox+links | Must be checked to submit; links open the legal pages in a new tab | auth.tsx:537-540,236-237 | — | routes exist App.tsx:227-230,323-326,447-448,473-474 | OK |
| `button-signup` "Create Account" | button | POST `/api/auth/signup` {email,password,displayName?,beta?,next?} → 409 if email exists; success → server creates unverified user + 24h verification token, sends verification email; client shows "Check your email" panel with `button-resend-signup` | auth.tsx:541-544,98-130 | POST /api/auth/signup (auth.ts:364-419) → insert users (email lowercased, bcrypt 12, email_verified=false, verification_token/expiry, account_id, betaAt via consumeBetaInvite); session.authNext stashed from `next`; resp `{message, userId}` | endpoint present; body fields match | OK |
| Post-signup "Check your email" panel + `button-resend-signup` | panel+button | Same resend endpoint | auth.tsx:460-470 | /api/auth/resend-verification | code read | OK |
| `link-goto-login` | text button | Back to sign-in | auth.tsx:548-557 | — | code read | OK |
| `text-signup-agreement` + inline Terms/Privacy links | text+links | "By signing up — including with Google — you agree…" | auth.tsx:658-665 | — | code read | OK |
| Signed-in + `?beta=` → `card-beta-signed-in` with `button-beta-signout` (POST /api/auth/logout + reload) and `button-beta-continue` (→ "/") | choice card | Explains a beta invite never opens an existing workspace | auth.tsx:240-274 | POST /api/auth/logout (auth.ts:924) | code read | OK |

### Email verification (not a page mode; link from the signup email)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Verification link in email `{baseUrl}/api/auth/verify-email?token=…` | email link | GET → invalid/expired redirect `/auth?error=invalid-token|token-expired`; success → welcome email, marks email verified, logs in, redirects `session.authNext ?? /?auth=verified`; totp-enabled accounts → `/auth?mode=2fa` instead | (email) server/email.ts:311 | GET /api/auth/verify-email (auth.ts:524-572) → users.verification_token/expiry (24h), single-use UPDATE … RETURNING | code read | OK |

### Forgot-password mode (auth.tsx:561-606)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Back to login" + "Reset your password" header | text | — | auth.tsx:563-573 | — | code read | OK |
| `input-forgot-email` | input | Email, required | auth.tsx:587-596 | — | code read | OK |
| `button-send-reset` "Send Reset Link" | button | POST `/api/auth/forgot-password` {email} → always generic success message (no account enumeration); client swaps to "Check your email" panel | auth.tsx:599-602,182-195 | POST /api/auth/forgot-password (auth.ts:601-626) → if user with passwordHash: randomBytes(32) hex `resetToken`, `resetExpiry = now + 1h` → users.reset_token/reset_expiry (columns confirmed in information_schema); `sendPasswordResetEmail` | **live curl with unknown email → 200 `{message:"If an account exists, a password reset email has been sent."}`** (no mail sent for unknown address) | OK |
| Reset email link `{baseUrl}/auth?mode=reset-password&token=…` | email link | Carries the token into the consume flow | server/email.ts:617-618 | sendPasswordResetEmail builds exactly `/auth?mode=reset-password&token=${token}` — matches the mode the page consumes (auth.tsx:53) | code read | OK |

### Reset-password mode (auth.tsx:608-655) — the `/auth?token=` consume flow

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Set new password" header | text | — | auth.tsx:610-613 | — | code read | OK |
| `input-reset-password` / `input-reset-confirm` (+toggle) | inputs | New password ≥8, must match | auth.tsx:616-648 | password ≥8 (auth.ts:632) | code read | OK |
| `button-reset-password` "Reset Password" | button | POST `/api/auth/reset-password` {token: tokenParam, password} → success toast "Password reset!" + back to login mode; 400 "Invalid or expired reset link" / "Reset link has expired…" → destructive toast | auth.tsx:649-652,197-221 | POST /api/auth/reset-password (auth.ts:628-666) → users by reset_token; expiry check (1h); tx: bcrypt hash, clear token, set email_verified=true, DELETE sessions of that user; revoke devices; security notification; resp `{message:"Password reset successfully. You can now log in."}` | **live curl with bogus token → 400 `{message:"Invalid or expired reset link"}`**; expiry enforced both in code and by the atomic `reset_expiry>now()` UPDATE | OK |

### 2FA mode (auth.tsx:311-356)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `button-2fa-back` / `text-form-title` "Two-factor sign-in" | button+text | Back to sign-in clears the code | auth.tsx:314-325 | — | code read | OK |
| `input-2fa-code` | input | 6-digit TOTP or 16-char recovery code | auth.tsx:330-339 | regex `^(?:[0-9]{6}\|[a-fA-F0-9]{16})$` (auth.ts:479) | code read | OK |
| "Remember this device for 30 days" checkbox | checkbox | Sets rememberDevice | auth.tsx:340-343 | req.body.rememberDevice === true → rememberDevice cookie (auth.ts:510) | code read | OK |
| `button-2fa-verify` | button | POST `/api/auth/2fa/login` {code, rememberDevice} → success → `/api/auth/me` invalidate + navigate `next ?? "/"`; 400 "No pending login. Please start over." → client returns to sign-in with an expiry toast | auth.tsx:344-347,160-180 | POST /api/auth/2fa/login (auth.ts:472-522) → session.pending2FAUserId + 10-min expiry; TOTP validate (window 1) or consume one recovery code; 10 tries/15 min; resp user object | code read | OK |
| `link-2fa-start-over` | text button | Back to sign-in | auth.tsx:349-354 | — | code read | OK |

### Chrome (auth.tsx:276-310, 658-688)

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `PublicPageHeader next={nextParam ?? "/"}` | header | Ribbon; sign-in link returns here after auth | auth.tsx:281 | — | code read | OK |
| Logo `link-auth-logo-home` → `/` (ConstructHUB) or CrmLogo on the CRM portal | link | Brand home | auth.tsx:290-293 | — | code read | OK |
| `text-auth-title` ConstructHUB / ConstructHub CRM | text | Brand | auth.tsx:294-298 | — | code read | OK |
| `text-auth-bubble-small` / `text-auth-bubble` gator lines | content | Per-mode mascot copy (BUBBLE map auth.tsx:695-701) | auth.tsx:306,683 | — | code read | OK |
| `link-auth-home` "Back to ConstructHUB home" (non-portal) | link | `/` | auth.tsx:667-673 | — | code read | OK |

Counts /auth: 38 elements — 38 OK, 0 BUG, 0 UNCLEAR, 0 DEAD. All five flows (register / login / reset request / reset consume / Google) hit existing endpoints with matching method+body; response shapes the page reads (`{message}`, `{requires2FA}`, user object) match the server.

---

## Catch-all route — 404 (NotFound)

`client/src/pages/not-found.tsx`. Registered as `<Route component={NotFound}>` at the end of DashboardRouter (App.tsx:245) and as the SignedOutFallback default (App.tsx:353 — unknown signed-out URLs that aren't in SIGNED_IN_ONLY render it). Signed out it fills the window with `PublicPageHeader next={location}` + `PublicPageFooter`; signed in it sits in the app frame (chrome renders null, not-found.tsx:16-20).

| Element | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Kicker "404 / Error" | text | — | not-found.tsx:26 | — | code read | OK |
| H1 "Page Not Found" + paragraph | text | Explains the miss | not-found.tsx:27-32 | — | code read | OK |
| `link-back-home` "Back to home" | link | `/` | not-found.tsx:34-36 | — | route exists | OK |
| `link-not-found-features` "See every feature" | link | `/features` | not-found.tsx:37-39 | — | route exists App.tsx:208/310 | OK |
| `text-not-found-bubble` "This page wandered off the job site." + StandingGator | content | Mascot panel | not-found.tsx:42-52 | — | code read | OK |
| Page testid `page-not-found`; `/api/auth/me` query decides signed-out chrome | query | — | not-found.tsx:17-20 | GET /api/auth/me (auth.ts:668) | live: null signed out | OK |
| Behavior check: unknown signed-out URL not in SIGNED_IN_ONLY renders 404 (no redirect to landing) | route | SignedOutFallback default | App.tsx:328-354 | — | code read | OK |

Counts 404: 7 elements — 7 OK.

---

## /privacy — Privacy Policy

`client/src/pages/privacy-policy.tsx`, frame `client/src/components/legal-page.tsx` ("Back to Home" → `/`, Kicker "Legal", auto-built TOC from `<section>` headings with anchor jump, mobile Contents `<details>`, `PublicPageHeader`/`PublicPageFooter`, copyright footer). Route App.tsx:229/325. **Effective Date: September 30, 2026** (privacy-policy.tsx:16).

Sections (each is one container; text is static): intro (`text-intro`); 1. Information We Collect (1.1 personal — incl. Stripe billing, Google OAuth data, signatures; 1.2 usage data; 1.3 cookies); 2. Tracking Tools (Click Guard 2.1, IP Tracker 2.2, VPN Shield 2.3, embeddable scripts 2.4); 3. Review Request Email Tracking (open/click tracking, unsubscribe); 4. Google Business Profile Data & APIs (business.manage scope, Places API distinction, 4.1 Limited Use, 4.2 Revoking Access — claims synced GBP data is deleted on disconnect); 5. Third-Party Services (Google OAuth, Stripe, Places, GBP API, OpenAI, Cloudflare R2, Gmail SMTP); 6. How We Use; 7. Data Sharing ("do not sell"); 8. Data Retention (24mo tracking, 7yr payments, 12mo email logs, GBP data deleted on disconnect); 9. Data Security (TLS, hashing); 10. Your Rights (30-day response); 11. CCPA; 12. GDPR; 13. Children's Privacy (under 13); 14. Changes; 15. Contact Us.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `link-contact-email` support@constructhub.us | mailto | Contact | privacy-policy.tsx:29 | — | mailto scheme | OK |
| `link-google-user-data-policy` | external link | Google API Services User Data Policy | privacy-policy.tsx:158 | — | curl -L → 200 | OK |
| `link-google-permissions` | external link | myaccount.google.com/permissions (revocation) | privacy-policy.tsx:170 | — | curl -L → 200 | OK |
| "Stripe's Privacy Policy" stripe.com/privacy | external link | — | privacy-policy.tsx:185 | — | curl -L → 200 | OK |
| "OpenAI's Privacy Policy" openai.com/privacy | external link | — | privacy-policy.tsx:195 | — | curl -L → **403** (bot-block; the page exists in a browser) | OK (note: 403 to curl = anti-bot, not dead) |
| `link-rights-email` / CCPA / children / `link-bottom-email` mailto links (4 more) | mailto | support@constructhub.us | privacy-policy.tsx:273,291,316,335 | — | mailto scheme | OK |
| Claim: billing via Stripe | factual | — | privacy-policy.tsx:43,77-84 | server/stripe.ts exists (whole billing module) | code read | OK |
| Claim: email via Gmail SMTP | factual | — | privacy-policy.tsx:201 | server/email.ts:146-156 nodemailer SMTP transport w/ SMTP_EMAIL/SMTP_APP_PASSWORD | code read | OK |
| Claim: Cloudflare R2 photo storage | factual | — | privacy-policy.tsx:198 | server/r2.ts uploadToR2 used for media (routes.ts:36,1843) | code read | OK |
| Claim: OpenAI for AI features | factual | — | privacy-policy.tsx:194 | server/ai-config.ts OpenAI-compatible client | code read | OK |
| Claim: review-request open/click tracking + unsubscribe | factual | — | privacy-policy.tsx:121-134 | /review/:token/unsubscribe route exists App.tsx:224 | code read | OK |
| Claim: GBP sync data deleted on disconnect | factual | — | privacy-policy.tsx:171,241 | not deeply traced (GBP lane) — consistent w/ routes.ts:1781 deleteFromR2 for photos | code read (partial) | UNCLEAR (delete-on-disconnect of reviews/metrics not fully traced in this lane) |
| Effective date "September 30, 2026" | date | Current (≤ today 2026-10-04) | privacy-policy.tsx:16 | — | — | OK |

Counts /privacy: 13 mapped elements — 12 OK, 1 UNCLEAR. (15 section containers are static text; all headings feed the TOC correctly.)

---

## /terms — Terms of Use

`client/src/pages/terms-of-use.tsx`, same LegalPage frame. Route App.tsx:230/326. **Last updated: September 30, 2026** (terms-of-use.tsx:11). All prices are rendered from `shared/plans.ts`/`shared/plan-copy.ts` at build time — nothing hardcoded — so terms and the pricing page cannot drift by editing one file. Recomputed values: Starter $29/mo ($290/yr), Pro $79 ($790), Growth $199 ($1,990), Agency $349 ($3,490); annual = 10× monthly (ANNUAL_MONTHS=10, and each plan's annualCents = 10× monthlyCents — verified all four); add-ons from ADDONS with setup fees; CRM seats line; Agency-only modules; SALES_THRESHOLD_LABEL = $1,000; TRIAL_LABEL = "1-day trial" (TRIAL_DAYS=1); SEO 6-month minimum + 50% early-termination penalty; liability cap = 12 months of payments; arbitration; 7-day pro-rated refund discretion; data-loss disclaimer referencing Settings → Backups.

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| `list-plans` (4 plan lines from PLANS) | dynamic list | planPriceLine(key) for each PLAN_KEY | terms-of-use.tsx:49-53, plan-copy.ts:59-63 | shared/plans.ts PLANS | values recomputed from PLANS; annual=10× verified | OK |
| Agency locations sentence (10 included + agencyBandsLine) | dynamic text | Per-location pricing bands | terms-of-use.tsx:54, plan-copy.ts:73 | AGENCY_LOCATION_BANDS (plans.ts:178-183: $15/$10/$7 per location over 10, up to 500) | matches PLANS.agency.limits.locations=10 | OK |
| CRM seats line | dynamic text | seats per plan | terms-of-use.tsx:55, plan-copy.ts:65 | PLANS.limits.crmSeats (1/3/10/10) | recomputed | OK |
| Trial sentence | dynamic text | "no free plan… starts with a 1-day trial" | terms-of-use.tsx:56 | TRIAL_DAYS=1 (plans.ts:411) | recomputed | OK |
| §4 Add-ons list (from ADDONS) | dynamic list | name — $/month (+setup fee) (availableOn) | terms-of-use.tsx:63-71 | ADDONS record (plans.ts:330) | recomputed | OK |
| §6 sales threshold sentence | dynamic text | ≥ $1,000 quoted by sales rep | terms-of-use.tsx:89 | SALES_THRESHOLD_CENTS=100_000 | recomputed; matches catalog isSalesOnly | OK |
| §7 Master Class sentence | dynamic text | ≥ $1,000 quoted; under shows checkout price | terms-of-use.tsx:95 | same threshold | consistent with /master-class behavior (all items ≥ $1,000 → all quoted) | OK |
| Google API Services User Data Policy link | external link | — | terms-of-use.tsx:158 | — | curl -L → 200 | OK |
| `link-contact-email` support@constructhub.us (also §10 refund line, §18, §21) | mailto | — | terms-of-use.tsx:116,210,227 | — | mailto scheme | OK |
| §14 "exclusive property of Construction Hub" | text | Legal entity name | terms-of-use.tsx:169 | — | — | OK |
| Last updated "September 30, 2026" | date | Current | terms-of-use.tsx:11 | — | — | OK |

Price-discrepancy check against shared/plans.ts: **none found** — terms are generated from the same source of truth. One note: §15 says backups "retained for no more than a few days" while §8 (privacy) says tracking data 24 months etc. — different topics, no conflict.

Counts /terms: 11 mapped elements — 11 OK, 0 BUG.

---

## Findings

### BUG
None.

### UNCLEAR
1. **/master-class static course figures** (master-class.tsx:1005-1149, 1238-1251): close-rate benchmarks (33%+/20%/<15%), $50–150/lead, bad-review revenue loss (10–15%/20–50%), $500K worked example, 8–10% sales commission, PM salary $45–75k/yr — owner-sourced marketing claims with no repo/DB backing possible. Also the James Hardie Elite requirements claim (master-class.tsx:2042: "used to require 36 … now 10 … 150 sq ft"). Flag for the owner to fact-check, not code defects.
2. **Privacy §4.2/§8 delete-on-disconnect claim** (privacy-policy.tsx:171,241): "we stop accessing your Google Business Profile data and delete the reviews, performance metrics and sync records" — partially traced only (photo deletes from R2 at routes.ts:1781); the reviews/metrics deletion path lives in the GBP lane and was not confirmed here.

### DEAD (unreachable code paths, current data/prices)
All on /master-class, all consequences of every course price being ≥ the $1,000 sales threshold (`showsPrice` false → the conditional branches never render in any build; the server independently refuses checkout with 409 `talk_to_sales`, so nothing user-facing is broken):
1. `badge-sale` "Bundle saves %" (master-class.tsx:347-351)
2. `text-overview-bundle-price` $2,499 (master-class.tsx:371-372)
3. `badge-pricing-savings` (master-class.tsx:2469-2473)
4. `badge-bundle-best-value` (master-class.tsx:2482-2486)
5. `text-bundle-was` struck $6,500 (master-class.tsx:2494-2496)
6. `text-bundle-savings` (master-class.tsx:2500-2504)
7. `button-add-cart-bundle` (master-class.tsx:2518-2540)
8. `button-enroll-bundle` "Buy now — $2,499" (master-class.tsx:2541-2550)
9. `button-add-cart-{category}` ×4 (master-class.tsx:2608-2631)
10. `button-enroll-{category}` "Buy now" ×4 (master-class.tsx:2632-2641)

If the owner ever wants online course checkout again, either drop module/bundle prices below $1,000 or lower SALES_THRESHOLD_CENTS — the UI will light up without code changes.

### Hardening notes (not bugs)
- `/guides` is in SIGNED_IN_ONLY (App.tsx:338): a signed-out visitor is asked to sign in before the redirect to the Social Media guides tab lands. Intended for in-app walkthroughs, but there is no public guides page.
- Master-class hardcoded "4 modules" / "50 states" (master-class.tsx:357-364) match the DB today; they will silently drift if a module/guide is added (the licensing-count stat next to them is computed).
- Effective behavior worth the owner knowing: **no Master Class item can currently be purchased online at any price** — modules ($1,500–$2,000) and bundle ($2,499) are all "Talk to a sales rep". Terms §7 codifies this, so it is consistent, but the enroll/cart UI is dead weight until then.
- Reinstatement request form writes no DB row — the request exists only as an email to the team inbox (plus rate-limit counters). No CRM follow-up record is created server-side.

### AUDIT- test rows created (safe, not deleted)
1. **POST /api/reinstatement/request** (2026-10-04) — business `AUDIT-Lane6-Test-Business`, email `audit-lane6@example.com`, address "123 Audit St, Testville TS 00000", type `service-area`, multipleLocations `no`. Response `{"success":true}`; email captured in the dev sink `tmp/email-outbox.jsonl` (to support@constructhub.us, subject "GBP Reinstatement Request — AUDIT-Lane6-Test-Business", all fields present). No DB rows (endpoint is email-only). Safe to ignore/delete the outbox line.
2. **POST /api/auth/forgot-password** with unknown email `no-such-audit-user@example.com` — no user touched, no mail sent (generic 200). Not a data row.
3. **POST /api/auth/reset-password** with token `bogus` — rejected 400; no user touched.

### Unverifiable from this lane
- Full Stripe purchase path for courses (dev has no Stripe; 401 "Login required" confirmed signed-out; per-env expectation "Stripe not configured" holds by code: sendStripeError).
- Google OAuth callback end-to-end (requires a Google account; the authorize redirect and callback code path were verified by code read + the live 302).
- Email deliverability (dev forces the sink, email.ts:203-229).
- GBP delete-on-disconnect completeness (see UNCLEAR #2).
## Lane 6 — /features catalogue + 30 feature pages (map-03-features)

Scope: `client/src/pages/features.tsx` (`/features`, `/features/:slug`, `LegacyLanding`), all 30 content
files in `shared/feature-pages/*.ts` + `types.ts` + `pricing.ts`, and the shared template
`client/src/components/feature-landing/**` (`feature-landing.tsx`, `sections.tsx`, `primitives.tsx`,
`icons.ts`). External page slotted into the catalogue: `/call-assistant` (hand-built landing, audited
here only as a catalogue entry).

Registry: `shared/feature-pages/index.ts` — `FEATURE_PAGES` (30 template pages, index.ts:66-79),
`EXTERNAL_FEATURE_PAGES` = callAssistant only (index.ts:84-94), `FEATURE_CATALOGUE` built at
index.ts:135-152 (template pages in dashboard-tile order with externals spliced in by tile position),
`FEATURE_GROUPS` = the dashboard's 5 groups + "platform" (index.ts:59-63), `READY_FEATURE_PAGES` =
all 30 (every page has `status: "ready"` — verified by script; all 30 are prerendered and in the
sitemap via `shared/seo.ts:47`).

Prices: every price/allowance on these pages is computed client-side from `shared/plans.ts` through
`shared/feature-pages/pricing.ts` (`featurePriceSummary`). The brief's "via server/catalog.ts" is not
how these pages work — `server/catalog.ts` is the courses/done-for-you catalog (used only by the
Master Class "sales" claim, verified: all four modules are ≥ $1,500 → `isSalesOnly` → sales-rep
quote, catalog.ts:50). The `server/feature-pages.test.ts` vitest (18 tests) locks the registry
invariants: catalogue order vs dashboard tiles, no `$` typed in copy, pricing kinds match the plan
gates, related keys resolve. Ran it: **18/18 pass**.

Feature flags: `SHOW_GOOGLE_REVIEWS = true`, `SHOW_COMPETITOR_INTEL = true`
(client/src/lib/features.ts:13,26) → the two flagged pages (reviews, competitors) and their
catalogue cards are visible; if flipped off, both the card and the page 404 together
(`featureVisible`, feature-landing.tsx:36; features.tsx:198).

Signed-out vs signed-in: both routers register `/features` and `/features/:slug`
(client/src/App.tsx:208-209 public, ~310-311 app frame). Signed out the pages wear
`PublicPageHeader`/`PublicPageFooter` (client/src/components/public-page-chrome.tsx); signed in those
components return null (public-page-chrome.tsx:37,72) so the same page renders inside the dashboard
frame with the sidebar. `/features/call-assistant` (an external key's slug) client-redirects to
`/call-assistant` (features.tsx:199-201); unknown/flagged-off slugs render NotFound
(features.tsx:202). Retired landings (`/permits-landing`, `/google-ads-landing`,
`/competitors-landing`, `/master-class-landing`) replace-redirect to their feature page via
`LegacyLanding` (features.tsx:210-213).

DB: this lane's pages contain **no live DB counts** (the writing guide forbids stats in content
files; verified — no "N databases"/"N counties" numbers anywhere in the 30 files). Spot-checked the
underlying data exists anyway: counties=3,139, permit_databases=32,853, property_appraisers=3,040.

Dev server at 127.0.0.1:8306 is the Vite SPA shell (curl returns index.html, title fallback
"ConstructHUB — Nationwide Contractor Services"); real HTML per page comes from the prerender
(`script/prerender.ts`), route meta from `shared/route-meta.ts:36-41` (`/features` + one entry per
feature page). Playwright lane `e2e/feature-pages.spec.ts` covers both viewports signed out/in.

## /features — Feature Catalogue

Page: `FeaturesCataloguePage`, client/src/pages/features.tsx:72-185. Data: FEATURE_GROUPS +
FEATURE_CATALOGUE. 31 catalogue entries (30 template + callAssistant), 6 group bands. All prices
below recomputed with `featurePriceSummary` and match `shared/plans.ts` by construction.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Public header (signed out only) | chrome | Site nav with Features/Done-For-You/Plans menus; hidden once signed in | client/src/components/public-page-chrome.tsx:37 | none (static chrome) | code read | OK |
| Hero kicker "Every Feature" | text | Small-caps section label | features.tsx:103 | none (static copy) | code read | OK |
| H1 "Pick the Tools Your Business Needs" (`text-features-title`) | text | Page headline | features.tsx:104 | none | code read | OK |
| Hero lede | text | Explains the page | features.tsx:107-110 | none | code read | OK |
| Primary CTA (`cta-features-primary`) | link | Signed out → "Create Your Account" → `/auth?mode=signup&next=/features`; signed in → "Compare Plans" → `/pricing` | features.tsx:85-87 | none (client routes; /auth and /pricing exist in App.tsx) | App.tsx route grep | OK |
| Sales button hero (`button-features-sales-hero`) | button | Opens the talk-to-sales dialog (topic "Which ConstructHUB features fit my business") | features.tsx:88-92,182 | POST /api/seo-inquiry → server/routes.ts:3306 (rate limit 5/hr/IP, routes.ts:71) | route grep | OK |
| Group jump chips (`link-features-group-<key>`) | anchor ×6 | Smooth-jump to #grow #protect #win #run #learn #platform | features.tsx:116-122 | none | code read | OK |
| Mascot panel (StandingGator + speech bubble) | illustration | Decorative, aria-hidden | features.tsx:124-135 | none | code read | OK |
| Group band (`section-features-<key>`) ×6 | section | Kicker numbered 01-06, group H2 (labels "Grow","Protect","Win jobs","Run the business","Learn","The platform"), group blurb | features.tsx:141-161; labels from shared/dashboard.ts:19-25 + index.ts:59-63 | none (static copy) | code read | OK |
| Catalogue card (`card-catalogue-<key>`) ×31 | link | One card per feature → the feature's page (`entry.path`). Icon (first "what you get" card's icon; callAssistant gets "phone"), title, lede, plan headline + price figure, "See how it works" | features.tsx:42-69; registry index.ts:135-152 | none (static copy + price book) | script recomputed all 31 prices | OK |
| — Card plan line (`text-catalogue-plan-<key>`) | text | e.g. "Included in every plan", "Included from the Pro plan", "Agency plan", "Add-on", "Free with an account", "Talk to a sales rep", "One-time service" | features.tsx:61-64 via pricing.ts:72-149 | shared/plans.ts PLANS/ADDONS (client-side compute) | recomputed; matches gates below | OK |
| — Card price figure (`text-catalogue-price-<key>`) | text | "from $29/mo" (plan), "from $79/mo" (allowance: clickGuard, ipTracker, vpnShield, competitors, texting, customerApi), "$349/mo" (module: cloudflare, searchConsole, domains, mailAlerts, adsManager, agency), "$249/mo" (callAssistant add-on), "$599 one-time" (reinstatement), none (account/sales kinds) | features.tsx:45,63 | shared/plans.ts monthlyCents | recomputed for all 31 | OK |
| — Card "Coming soon" pill (`badge-feature-coming-soon`) | badge | Shown when `price.comingSoon` (add-on `preview` flag) | features.tsx:57; sections.tsx:44-53 | shared/plans.ts ADDONS.preview — currently **no add-on has preview:true** (plans.ts:353: "the call assistant is live not coming soon") | grep preview in plans.ts | OK (none shown — correct) |
| Close band "Not Sure Where to Start?" | section | Navy closing band with mascot | features.tsx:164-179 | none | code read | OK |
| — "Compare Plans" link (`link-features-pricing`) | link | → /pricing | features.tsx:175 | none | route grep | OK |
| — Sales button cta (`button-features-sales-cta`) | button | Same talk-to-sales dialog | features.tsx:176,182 | POST /api/seo-inquiry | route grep | OK |
| Public footer (signed out only) | chrome | Marketing footer; hidden signed in | public-page-chrome.tsx:72 | none | code read | OK |
| TalkToSalesDialog | dialog | Form name/email/company/need → POST /api/seo-inquiry {service: topic, name, email, message}; server emails sales inbox | client/src/components/talk-to-sales.tsx:32-52 | POST /api/seo-inquiry → server/routes.ts:3306, seoInquiryInput (service ≤100, message ≤5,000) | code read both sides | OK |

Catalogue price/gate cross-check (recomputed): "Included in every plan" pages = gbp, reviews,
profileGuard, rankingGrid, gbpContent, social, siteScan, media, permits, crm, crmSchedule, crmLeads —
all `requirePlan`-gated features; "Included from the Pro plan" = clickGuard/ipTracker/vpnShield
(protectedSites: Starter 0, Pro 1 ✓), competitors (competitorScans: Starter 0, Pro 2 ✓), texting
(teamTextSegments: Starter 0, Pro 500 ✓), customerApi (apiUnitsPerMonth: Starter 0, Pro 10,000 ✓);
"Agency plan" = cloudflare/searchConsole/domains/mailAlerts (modules.cloudflareSearchConsole/
domainsMailAlerts true only on Agency ✓), adsManager (modules.adsManager Agency-only ✓), agency
(modules.agencyWorkspace Agency-only ✓); "Add-on" $249/mo = callAssistant (Solo, monthlyCents 24900,
availableOn Pro/Growth/Agency ✓); "Free with an account" = property, lsaLeads, guides, gabe (no plan
check in their server routes — verified: no requirePlan/requireModule in server/social/routes.ts…
lsa/routes.ts, /api/property-appraisers at routes.ts:863, server/hub/routes.ts) ✓; "Talk to a sales
rep" = masterClass (all modules ≥ $1,500 → isSalesOnly ✓); "One-time service" $599 = reinstatement
(GBP_REINSTATEMENT_CENTS 59_900 < SALES_THRESHOLD ✓, same constant used by /reinstatement page and the
Hub knowledge pack).

## /features/<slug> — the shared template (every feature page)

Page: `FeatureLanding`, client/src/components/feature-landing/feature-landing.tsx:41-134, rendering
sections from client/src/components/feature-landing/sections.tsx. Content = one `FeaturePage` data
object (shared/feature-pages/types.ts:151-164). Every price comes from
`featurePriceSummary(page.pricing)` (feature-landing.tsx:44) so the hero sentence, the pricing card
and the closing band can never disagree. Sections render only when their content exists
(steps/cards/spotlight/audience/faq/inDepth/related); pricing + hero + closing band always render.

| Element (visible label / testid) | Kind | What it does, in plain words for the owner | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filter, time window) | Verified how | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Public header / footer (signed out only) | chrome | Same chrome as the catalogue; null inside the app frame | feature-landing.tsx:111,130 | none | code read | OK |
| Page wrapper (`page-feature-<slug>`, `data-feature-status`) | container | Root; carries the registry status ("ready" on all 30) | feature-landing.tsx:112 | none (static registry) | script: all status "ready" | OK |
| Back link (`link-feature-all`) "← All features" | link | → /features | sections.tsx:72,91-93 | none | route grep | OK |
| Kicker (`page.kicker`) + ComingSoon pill (`badge-feature-coming-soon`) | text/badge | Small-caps feature name; pill only when the pricing spec is a preview add-on (none today) | sections.tsx:94-97 | shared/plans.ts ADDONS.preview | grep | OK (none) |
| H1 (`text-feature-title`) = lead + swiped phrase + tail | text | The page's headline from the content file | sections.tsx:98-100 | none (static copy in shared/feature-pages/<file>.ts) | code read | OK |
| Lede (`text-feature-lede`) | text | One/two sentences under the H1 | sections.tsx:101-103 | none (static copy) | code read | OK |
| Hero primary CTA (`cta-feature-primary-hero`, data-cta) | link | Three-way, also repeated in pricing section and closing band: (a) signed-in on wrong plan → "Upgrade to <Plan>" / "See add-ons" → /pricing (or /pricing#add-ons) with note "Not in your <Plan> plan." (`text-feature-plan-gap`); (b) signed in → "Open <feature>" via DashLink (app routes go through wouter; portal surfaces (CRM) open portalUrl(href) with a full load); (c) signed out → "Create Your Account" → `/auth?mode=signup&next=<app.href>` (portal features use next=/crm-app) | feature-landing.tsx:60-76,82-89,39; dash-link.tsx:23-28 | GET /api/entitlements → server/routes.ts:249 getEntitlements → subscriptions/plan + allowances + modules + addonModules (ACCESS_STATUSES active/trialing); gap logic mirrors requireModule/allowance/addon gates (pricing.ts:185-208) | routes.ts:249 read; shape matches FeatureEntitlementsInput | OK |
| Hero sales button (`button-feature-sales-hero`) | button | Opens TalkToSalesDialog (topic = page title); repeated as `-pricing` and `-cta` variants | feature-landing.tsx:77-81,128 | POST /api/seo-inquiry → server/routes.ts:3306 | route grep | OK |
| "Try it" line (`link-feature-try`) | link | Only when the content file sets `tryIt` and visitor is signed out: "Not ready to sign up? <label>" → href | feature-landing.tsx:82-89 | none (client route; hrefs verified in App.tsx) | grep | OK |
| Hero price sentence (`text-feature-hero-price`) | text | e.g. "Included in every plan — from $29/mo." / "Quoted by a sales rep for your business." + "See pricing" anchor → #pricing | sections.tsx:60-65,109-112 | shared/plans.ts via pricing.ts | same object as pricing card → agrees by construction | OK |
| Mascot bubble (`text-feature-bubble`) + StandingGator/GabeAvatar panel | illustration | Navy panel, mascot + one line from the content file; aria-hidden | sections.tsx:116-133 | none | code read | OK |
| "How It Works" (`section-feature-how`, `step-feature-N`) | section | 3-5 numbered steps; heading auto "Up and Running in <N> Steps" or content override; hidden when empty | sections.tsx:189-207 | none (static copy) | code read | OK |
| "What You Get" (`section-feature-cards`, `card-feature-N`) | section | Capability cards (icon + title + body) + filler cells; hidden when empty | sections.tsx:211-236,242-256 | none (static copy) | code read | OK |
| Spotlight (`section-feature-spotlight`, `panel-feature-spotlight`) | section | Optional deep-dive: checklist left, navy panel of FIELD NAMES right (never sample data) | sections.tsx:260-298 | none (static copy) | code read | OK |
| "Who It's For" (`section-feature-audience`, `card-feature-audience-N`) | section | 2-4 audience cards; hidden when empty | sections.tsx:302-319 | none | code read | OK |
| Pricing band (`section-feature-pricing`, `card-feature-pricing`) | section | Always rendered. Left: headline (`text-feature-price-headline`: "Included in every plan" / "Included from the Pro plan" / "<Plan> plan" / "Add-on" / "Free with an account" / "One-time service" / "Talk to a sales rep"), ComingSoon pill when applicable, big price (`text-feature-price`, with "from" when more than one plan includes it), per ("​/mo" or " one-time"), price note incl. 1-day trial mention (`text-feature-price-note`), content-file `note`. Right: "Plan by plan" rows (`list-feature-plan-rows`, values from PLANS.limits, "Not included" where 0/blank; per-location shown as "N per location a month" for Agency) or "What's included" fallback listing first 6 card titles when the spec has no rows; closing "Every plan and add-on, side by side: Compare plans" (`link-feature-pricing` → /pricing#comparison, or "See add-ons" → /pricing#add-ons, "See plans" → /pricing, "See services" → /pricing#services for sales/service kinds) | sections.tsx:323-393; pricing.ts:72-149 | shared/plans.ts PLANS/ADDONS/TRIAL_DAYS/SALES thresholds (client compute; same source the server checkout uses) | anchors #comparison/#add-ons/#services exist on /pricing (pricing.tsx:433,588,656); values recomputed | OK |
| Pricing CTA row | buttons | `cta-feature-primary-pricing` + `button-feature-sales-pricing` (same three-way behavior as hero) | feature-landing.tsx:124 | as hero CTA | code read | OK |
| FAQ (`section-feature-faq`, `faq-feature-N`) | section | Native <details> accordion, 3-5 Q&A per content file; hidden when empty | sections.tsx:397-415 | none (static copy) | code read | OK |
| "In Depth" (`section-feature-in-depth`) | section | Optional long-form band (2-5 paragraphs + bullets); hidden when absent | sections.tsx:424-446 | none (static copy) | code read | OK |
| Related (`section-feature-related`, `link-feature-related-<key>`) | section | Cards to the page's `related` registry keys (external keys like callAssistant resolve via FEATURE_CATALOGUE); hidden when empty after flag filtering | feature-landing.tsx:53-58,127; sections.tsx:453-476 | none (registry) | script: every related key resolves | OK |
| Closing band (`section-feature-cta`) | section | Navy band: mascot, "Put <title> to Work" H2, the same price sentence, CTA row (`cta-feature-primary-cta`, `button-feature-sales-cta`), "Still deciding? Compare every feature" (`link-feature-cta-all` → /features) | sections.tsx:482-517 | none | code read | OK |
| TalkToSalesDialog | dialog | topic = page.title; POST /api/seo-inquiry | feature-landing.tsx:131 | POST /api/seo-inquiry → server/routes.ts:3306 | route grep | OK |
| Document title + meta description | head | From `page.seo`; server writes the same into prerendered HTML (shared/route-meta.ts:38-40) | feature-landing.tsx:49-50; primitives.tsx:38-52 | none | route-meta read | OK |

Kicker numbering (01…08) follows whichever sections the page actually shows
(feature-landing.tsx:93-107); band tones alternate paper-2/paper from the first shown section. No
tabs/sticky header/pagination anywhere in the template.

## Per-page specifics

Slug → file → group → pricing kind (source of its displayed price) → status. "no typed prices":
the vitest rejects `$`+digit in content files; allowances/plan names are injected via
`allowanceLine`/`PLANS`/`ADDONS` helpers. All 30 pages `status: "ready"` (script-checked).

### gbp (Google Business Profile) — grow — kind "plan" + locations allowance — ready
App CTA "Open Locations" → /locations. Claims checked: sync "every six hours" ✓
(server/agency/jobs.ts:154-155 `now()-interval '6 hours'`); "about 90 days" first window + 7-day
overlap ✓ (server/gbp/service.ts:209-211, 89+1 days first, `-7` later); one-time back-fill
PERFORMANCE_HISTORY_DAYS=540 ≈ 18 months ✓ (service.ts:113,217); 11 Guard fields → wait, that's
profileGuard. GBP claims: several Google accounts, "Managed by <email>", citation checklist ✓
(routes/gbp routes); extra-location add-on on Starter/Pro/Growth ✓ (ADDONS.extra_location.availableOn);
Agency bulk actions ✓. No numeric DB claims.

### reviews (Google Reviews) — grow — kind "plan" + reviewTemplates allowance — ready, flag SHOW_GOOGLE_REVIEWS (on)
Claims: private 1–10 rating ✓ (server/routes.ts /api/review/:token/feedback); "no review gating,
every rating gets showReview:true" ✓; AI replies "capped at 50 a day per account" ✓
(server/gbp/review-automation.ts:129 `takeBudget(...,50,1,86400_000)`); reminders "up to 10" ✓
(server/review-reminders.ts:5 `max(10)`); 1–2 star stay drafts unless allowed ✓; auto-publish only on
Pro/Growth/Agency (autoPublishAiReplies) ✓ price book; reviewTemplates 5/20/20/50 via allowanceLine ✓;
"deleted requests go to a trash" — /api/review-requests trash (routes.ts) ✓; "Google doesn't tell us
whether a review was posted" — honest-negative, n/a.

### profile-guard (Profile Guard) — grow — kind "plan" + locations allowance — ready
Claims: 11 watched fields ✓ (server/gbp/guard.ts:10 GUARD_FIELDS, 11 entries); cadence line computed
from guardCadenceMinutes (15 min Starter/Pro/Growth, 30 Agency) ✓ price book + runGuardWorker;
"confirm it's you, once per 12 hours" ✓ (guard-routes.ts); GMB Edit Monitor on-demand only, no
alerts ✓ (client/src/pages/gmb-monitor.tsx, /api/gmb/listings/:id/check); Lockdown restores after
detection, can't block edits, Maps lag ✓ (guard.ts resolveLocked).

### ranking-grid (GMB Ranking Grid) — grow — kind "plan" + gridCredits allowance (Agency per-location) — ready
Claims: grid sizes 3×3–15×15, spacing 0.5–20 miles ✓ (client ranking-grid.tsx GRID_SIZES /
DISTANCE_OPTIONS; server validates); "one credit per 25 points, rounded up: 5×5 = 1 credit, 15×15 =
9 credits" ✓ (shared/plans.ts:544-547 gridCreditCost); failed grid refunds ✓ (refundReservation);
top 5 businesses kept per point ✓ (server/routes.ts runRankingGridScan); pins 1–3 / 4–10 / 11–20 /
not found ✓; trial runs 1 grid ✓; no Google connection needed ✓ (POST /api/photos/business-search).

### gbp-content (Posts & Photos) — grow — kind "plan" — ready
Claims: up to 100 photos at a time ✓ (server/gbp/content.ts:143 `items … .max(100)`); 15 MB each,
JPEG/PNG/WebP ✓ (content-upload.ts:37,55,89); 10 photos per post ✓ (content.ts:38 photoIds.max(10));
1,500 characters ✓ (content.ts:38 summary.max(1500)); post types + CTA buttons + coupon ✓;
business-hours scheduling, daily caps, uncertain→never auto-resend ✓ (content.ts runContentWorker);
Agency batches ✓.

### social (Social Media) — grow — kind "plan" — ready
Claims: 9 networks, up to 20 destinations per post ✓ (shared/social.ts postSchema); 10 public media
links, uploads <100 MB ✓; Blotato separately-billed, key encrypted ✓ (server/social/client.ts
encryptKey); auto mode approval-first, content from offers + Google updates last 30 days, missing
sources reported not invented ✓ (server/social/service.ts sourceFor/generateDue); bulk tools up to
100 posts ✓ (server/social/agency.ts); pricing note truthful: no plan check on social routes —
verified no requirePlan in server/social/routes.ts; sold "part of every plan" because posting needs a
business in Locations which needs a plan (POST /api/locations) — claim matches.

### site-scan (Site Scan) — grow — kind "plan" + siteScans allowance (Agency per-location) — ready
Claims: five scores starting at 100 ✓ (server/sitescan/audit.ts scoresFor); 8 builder fix paths ✓
(guidance.ts detectPlatform); PageSpeed mobile+desktop "up to 5 pages" ✓ (sitescan/routes.ts:30
`psiPages … .max(5)`); free scan checks "up to 11 pages" ✓ (client site-scan.tsx:1368 and free-scan
flow, routes.ts:750 verify link); share link expires after 30 days ✓ (routes.ts:488
`now()+interval '30 days'`); monthly rescans "up to 10 sites" ✓ (routes.ts:547 "Maximum 10 scheduled
sites"); AI crawlers GPTBot/ClaudeBot/PerplexityBot/Google-Extended, llms.txt ✓ (audit.ts);
rescan/bulk each use one scan ✓. tryIt: "Free 60-second website scan" → /free-site-scan (route
exists, App.tsx:532).

### media (Photo Optimizer) — grow — kind "plan" — ready
Claims: up to 10 photos per batch ✓ (server/routes.ts /api/photos/process); radius 5–50 miles ✓
(/api/photos/nearby-cities); resized to ≤4096 px, JPEG out ✓ (server/photo-processor.ts);
watermark/enhance/filename/EXIF (title, description, keywords, author, copyright, GPS) ✓;
"no monthly photo count; a processing rate limit keeps use fair" ✓ (server/growth-quotas.ts:40,149 —
photos meter is fair-use, uncounted); "Google strips EXIF" honest-negative ✓. Note: the file's own
header flags a *different* page's mismatch (media-library GPS claim) as out-of-scope for this page —
that flagged issue lives on /media-library, not here.

### click-guard (Click Guard) — protect — kind "allowance" (protectedSites) — ready
Claims: flags — bot UA, >5 visits/IP/hour, >15/IP/24h, same fingerprint other IP within a day,
missing UA ✓ (server/routes.ts:3414,3420 + fingerprint query); auto-block flagged + >10 visits in
the hour ✓ (routes.ts:3460); manual IPv4/IPv6/CIDR/wildcard, wide ranges refused ✓
(server/route-guards.ts normalizeBlockedIp); exclusion list 50–500, manual first, whitelist removed,
500 = Google's per-campaign cap ✓ (server/click-guard-exclusions.ts:8-9,19); generated Ads script
only adds, never removes ✓ (routes.ts GET …/google-ads-script); Agency manager preview ✓
(server/ads/worker.ts). Add-on note: Extra protected website on Pro/Growth/Agency ✓.

### ip-tracker (IP Tracker) — protect — kind "allowance" (protectedSites) — ready
Claims: "online = last 20 minutes" ✓; today/yesterday/7 days/this month + 14-day chart ✓
(client ip-tracker.tsx, storage.ts:773); visitor detail up to 50 recent visits ✓ (GET
…/visitors/:visitorIp); each list loads latest 1,000 visits, "+" lower-bound marker ✓
(server/storage.ts:451,666 limit 1000, VISIT_ROW_CAP); geo from Cloudflare headers only ✓
(server/route-guards.ts edgeGeo); remove-site deletes visits + blocks ✓.

### vpn-shield (VPN Shield) — protect — kind "allowance" (protectedSites) — ready
Claims: own script tag, separate from Click Guard ✓ (server/routes.ts GET /api/vpn-shield/script);
crawler pass-through (Googlebot/Bingbot/AdsBot-Google) ✓; detection = built-in provider prefixes +
data-center CIDRs + WebRTC IPv4 mismatch + extension markers ✓ (POST /api/vpn-shield/track);
block/log/redirect with full http(s) link ✓; whitelist up to 500 IPs ✓ (routes.ts:4687); default
Block ✓ (vpn-shield.tsx `useState(settings.vpnBlockMode || "block")`); "not a firewall" honest
negative ✓.

### cloudflare (Cloudflare) — protect — kind "module" (cloudflareSearchConsole) — ready
Claims: Global API key exchanged once for a scoped token (Zone Read, Analytics Read, Zone WAF Edit),
never stored ✓ (server/cloudflare/service.ts exchangeKey, client.ts ZONE_PERMISSIONS); analytics =
last day, latest 100 firewall events, top 20 paths, sampled ✓ (service.ts:158-160,213 — GraphQL
limits match copy exactly); ads door blocks >10 requests/10 s on the landing path ✓
(service.ts:293 requests_per_period 10); bad-UA pack blocks >120 requests/10 s ✓ (service.ts:264);
flagged-IPs pack 1–100 addresses ✓ (service.ts:223,241-242); preview→confirm within an hour with
recent sign-in→undo only its own rules ✓ (routes.ts /preview /confirm /undo, service.ts applyAction
ref prefix); Click Guard IPs listed per zone, never auto-published ✓ (hooks.ts); disconnect deletes
created token, applied rules stay ✓. "Agency plan, no other plan" ✓ (module Agency-only).

### search-console (Search Console) — protect — kind "module" (cloudflareSearchConsole) — ready
Claims: own Google grant, kept separate from GBP ✓ (server/gsc/routes.ts, service.ts saveGscGrant);
sync up to 16 months back ✓ (server/cloudflare/routes.ts:184-190 floor −16 months, 400 otherwise);
default window "about the last month, stops three days short of today" ✓ (service.ts syncProperty
31→3-days-ago, dataState final); clicks/impressions/CTR/position by date/query/page/device/country,
day/week/month ✓ (server/gsc/routes.ts GET …/analytics); URL inspection with per-property day/minute
caps, never requests indexing ✓ (service.ts inspectUrl); sitemap submit needs full access +
confirmation ✓ (POST /api/gsc/urls); location Insights card last 30 days ✓ (site-connections.tsx
LocationSearchSummary); client onboarding emails ✓ (/invites, worker.ts deliverInvite).

### domains (Domains) — protect — kind "module" (domainsMailAlerts) — ready
Claims: Porkbun + Name.com adapters, keys encrypted, recent sign-in ✓ (server/domains/routes.ts,
service.ts saveConnection); daily monitor: expiry warnings at 60/30/7 days, auto-renew off, DNS
snapshot diff (nameserver change named), HTTPS failure, SSL within 30 days, once-per-state dedup,
next check +1 day ✓ (service.ts:309 threshold [7,30,60], health.ts:331 30 days, domain_alert_dedup);
record edits A/AAAA/CNAME/TXT/MX/CAA + nameservers, preview→confirm→apply→DNS verify every 5 min→
rollback preview; 15-minute preview staleness ✓; Cloudflare-hosted records refused ✓ (types.ts
desired()); Cloudflare nameserver pair in one previewed change ✓ (cloudflare-link.ts); manual
domains from any registrar get monitor-only ✓. "Agency plan, no other plan" ✓.

### mail-alerts (Mail alerts) — protect — kind "module" (domainsMailAlerts) — ready
Claims: private forwarding address + Gmail confirmation code/link extraction ✓ (service.ts
forwardingAddress, classify.ts); known senders (GBP, Search Console, Google Ads, Cloudflare,
registrars) + subject topics; critical = transfer/new owner/ownership request/manual action/security
issue/suspension ✓ (classify.ts); matched to exactly one domain → its location, else exactly one
business name of 4+ letters, else manual ✓ (service.ts storeMatched); 30-day retention, alerts kept
while plan lacks module ✓ (MAIL_RETENTION_DAYS=30, service.ts:29,47,75); per-alert notification ✓;
optional read-only Gmail connection limited to known senders last 30 days ✓ (gmail.ts GMAIL_SCOPE,
classify.ts GMAIL_QUERY); "treat as a reported alert" ✓ (page copy).

### permits (Permit Database Search) — win — kind "plan" + permitSearches allowance — ready
App CTA → /search; tryIt "Browse the Database Directory" → /databases (public). legacyPath
/permits-landing → redirects here. Claims: six search types ✓ (client search.tsx); live search only
on portals with a verified/source-listed link AND an adapter (shared/government-links.ts
canScrapeGovernmentPortal) ✓; "queries up to four portals at a time" ✓ (server/scraper.ts:218
MAX_CONCURRENT=4); quota reserved only when something is searchable, noSearchablePortals reserves
nothing ✓ (routes.ts POST /api/search, growth-quotas.ts); address-only portals answered from saved
results ✓; per-portal status, never "zero results" for a failure ✓; history saved/deletable ✓
(/api/search-queries); directory = counties+cities with checked links, dead → web search ✓
(databases.tsx, verify-links.ts, build-permit-portals.ts); Property lookup link per result ✓. Copy
deliberately states no counts (correctly — none verifiable in a static file).

### property (Property Records) — win — kind "account" — ready
Claims: directory of county assessor/appraiser offices from NETR Online, nulls stay blank ✓
(server/data/appraisers.json ← scripts/scrape-netronline.ts, server/netr-office.ts
isAssessmentOffice — DB table property_appraisers has 3,040 rows); link tiers
verified/unconfirmed-with-date/dead→web search ✓ (verify-links.ts, government-link-policy.ts);
Visit + separate Search button, tap-to-call, filters in URL ✓ (client property.tsx); permit-result
deep link /property?countyId= ✓ (search.tsx); public without signing in ✓ (GET
/api/property-appraisers routes.ts:863, PublicRouter). tryIt "Browse the directory now" → /property.

### competitors (Competitor Intel) — win — kind "allowance" (competitorScans) — ready, flag SHOW_COMPETITOR_INTEL (on)
legacyPath /competitors-landing. Claims: radii 10/25/50/100 miles ✓ (client competitors.tsx:237-240);
Google Places text search up to 3 pages, kept inside radius, "may be incomplete" note ✓
(server/competitor-provider.ts:59 `page < 3`); per-listing name/address/phone/website/rating/review
count/category ✓ (runCompetitorScan); BS Meter 0–100 + every reason, "not proof", sample-only,
velocity not scored ✓ (server/competitor-analysis.ts analyzeBsScore capped at 100, analyzeReviews);
failed scan refunded ✓; scan-pack add-on +10 on Pro/Growth/Agency ✓ (ADDONS.competitor_pack.grants);
nothing about ads (SHOW_AD_ACTIVITY off, /api/ad-spy 410) ✓ consistent.

### ads-manager (Agency Ads & LSA) — win — kind "module" (adsManager) — ready
Claims: MCC connect via Google sign-in (adwords scope) ✓ (server/ads/routes.ts /connect /callback);
client list incl. LSA found/not-found + filters ✓ (GET /accounts); bulk access requests 1–1,000,
clients can decline, cancel pending ✓ (routes.ts:16,22 selection max 1000, /invitations, worker.ts);
health audit checks, budget/search-term/charged-lead cover last 30 days, "unavailable is never a
pass", >10% budget-lost share ✓ (server/ads/audit.ts LAST_30_DAYS); protections presence-only,
shared negatives, placements, ad schedule, Click Guard IP rotation inside Google's 500 ✓
(protections.ts buildPlan); previews expire, re-check before write, reversible ✓ (routes.ts
/plans/confirm, worker.ts fingerprint checks); "part of the Agency plan; no other plan includes it" ✓
(planNamesWhere modules.adsManager = Agency).

### lsa-leads (LSA Leads) — win — kind "account" — ready
Claims: Google sign-in discovery, LSA accounts first, pause per account ✓ (server/lsa/sync.ts);
rotating background sync every minute + Sync now ✓ (server/lsa/routes.ts:367-368 setInterval 60_000;
POST /api/lsa/sync); re-reads last 3 days ✓ (sync.ts:47 OVERLAP_MS); cost estimate = that day's
spend ÷ that day's charged leads ✓ (syncLeadCostsForAccount); Good=SATISFIED, Bad=DISSATISFIED + the
six Google reasons, never re-rated, no double queue ✓ (disputes.ts, shared/schema.ts
LSA_DISPUTE_REASONS); Telegram DM with Report-bad-lead button ✓ (telegram.ts notifyNewLead); no plan
check ✓ (lsa/routes.ts session-only). The 30–60 s dispute spacing is deliberately not advertised ✓.

### crm (ConstructHub CRM) — run — kind "plan" + crmSeats allowance — ready
App CTA "Open your CRM" → /crm, surface "portal" (full load via portalUrl). Claims: workspace
created on first open ✓ (server/crm/tenancy.ts ensureOrgForUser); seats 1/3/10/10 + Extra seat
add-on, Agency seats shared with agency team ✓ (price book + getOwnerSeatUsage); roles owner/admin/
sales/PM/office/field/subcontractor, price-blind crews ✓ (shared/schema.ts CRM_ROLES); good/better/
best, client-ticked discounts, typed-name approval, signed contract PDF to both sides ✓
(server/crm/portal.ts, contract-pdf.ts); sales tax from job's city → division → org → typed ✓
(tax.ts); estimate link email-gated, no costs on client pages ✓ (portal.ts); expires 7 days ✓
(entities.ts:84 ESTIMATE_EXPIRY_DAYS=7); open/read-time tracking, 30-minute dedupe ✓ (portal.ts:86
VIEW_DEDUPE_MIN=30, :593); own Stripe Connect Standard, no application fee, ACH+card, card cutoff,
cash/check, receipts ✓ (payments.ts, receipts.ts); price book + per-sqft Quick Bid + price floor ✓
(pricebook.ts, quickbid.ts, price-floor.ts); pipeline auto-moves on send/approve ✓ (portal.ts);
portal with magic-link sign-in, attachments ✓ (public-portal.tsx, crm/attachments.ts); messages
inbox → portal + email ✓ (inbox.ts); CSV import/export, scheduled backups ✓ (migrate.ts, backups.ts,
GET /api/crm/customers/export.csv); "no accounting sync" honest negative ✓.

### crm-schedule (Schedule) — run — kind "plan" (seats via note) — ready
App CTA "Open Schedule" → /crm/schedule (portal). Claims: month/week/agenda, click-to-book/edit,
crowded month cell opens week ✓ (client crm-schedule.tsx); everyone/my/one-teammate scopes, assigned-
only visibility ✓; crew conflict warning on POST, cancelled + all-day excluded ✓
(server/crm/schedule.ts POST /api/crm/appointments); booking needs manageJobs, role defaults ✓
(shared/schema.ts CRM_ROLE_DEFAULTS); iCal feed token-is-auth, only hash stored, regenerate kills
old copies ✓ (server/crm/calendar.ts, ical.ts); Google push one-way, own "ConstructHub CRM"
calendar, edits/deletes carried, per-member ✓ (calendar.ts CALENDAR_SCOPE); no client booking /
no client appointment reminders honest negative ✓.

### crm-leads (Leads & follow-ups) — run — kind "plan" — ready
App CTA "Open the pipeline" → /crm/pipeline (portal). Claims: stages grouped prospect/sales/
production/billing/closed ✓ (shared/schema.ts CRM_PROJECT_STAGE_META); "+ New lead", drag/stage
menu, value price-blind, PM per card ✓ (crm-pipeline.tsx); send → Proposal Sent, approve → Approved
✓ (portal.ts); follow-up cadence weekly/every-two-weeks, "followed up now" restarts count ✓
(server/crm/follow-ups.ts 7/14 days); Needs-attention card: due follow-ups, leads last two weeks,
leads with no estimate, assigned-only ✓ (crm-home.tsx, follow-ups.ts); website lead form embed/
link, honeypot + per-IP limit, rotate link kills old copies ✓ (server/crm/lead-capture.ts);
first-open notice to sender, repeat open → good-time-to-call at most once a day, 30-min dedupe,
by text where plan has texting ✓ (portal.ts:593, crm/sms.ts); no automatic drip ✓.
**BUG — see Findings: the FAQ's AI Call Assistant sentence is stale.**

### texting (Texting) — run — kind "allowance" (teamTextSegments) — ready
App CTA "Open text settings" → /crm/settings (portal). Claims: included with Pro/Growth/Agency ✓
(TEXTING_PLANS = plans with teamTextSegments ≠ 0 or clientTexting ≠ none; sms.ts:87-93 identical
list); segments as carriers bill: GSM-7 160/153, UCS-2 70/67, one special char switches the whole
text ✓ (server/crm/sms-segments.ts:21-22); reserve before send, refund on carrier refusal, texts
skip until the 1st (UTC) when spent ✓ (sms.ts reserveSmsSegments/sendSms); shared number =
team alerts only; client texts need own number — Growth includes one, Pro/Agency buy the add-on,
or BYO SignalWire (token encrypted) ✓ (resolveSmsSender, orgCanTextClients, ADDONS.texting_number
availableOn ["pro","agency"], limits.clientTexting); 10DLC registration ✓; STOP/START/HELP +
opt-out honoured, other replies not shown ✓ (sms.ts inbound, isSmsOptedOut); re-engagement alert
falls back to email when spent ✓; dashboard "Texts" usage row ✓ (server/dashboard/account.ts).

### agency (Agency workspace) — run — kind "module" (agencyWorkspace) + locations allowance — ready
Claims: gate = workspaceEntitled/agencyPlanRequired on every /api/agency route ✓
(server/agency/routes.ts, access.ts); client workspaces with email/folder/tags/notes ✓; roles
owner/admin/manager/viewer, client-by-client, viewers read-only, members need ConstructHUB logins ✓
(routes.ts PUT /team, access.ts); seats shared with CRM (10) ✓ (crm/tenancy.ts getOwnerSeatUsage);
bulk actions list incl. post/photo batch and Site Scans, page-or-all-matching, Jobs log, retries
with growing waits, rate limit waits an hour ✓ (agency/jobs.ts bulkInput); email onboarding:
Manager invite, ownership kept, no client sign-in, strict match Place ID else name+address,
reminders after 3 and 6 days (reminders<2 at 3-day interval), expiry after 30 days ✓
(onboarding.ts:118, agency/schema.ts:68 `DEFAULT now()+interval '30 days'`); auto-accept with
unmatched left unassigned ✓; CSV export ✓ (GET /export); workspace switcher ✓ (agency.tsx);
10 locations included, per-location bands up to 500 then sales quote ✓ (AGENCY_LOCATION_BANDS,
AGENCY_SELF_SERVE_MAX_LOCATIONS, agencyPriceCents).

### master-class (Master Class) — learn — kind "sales" — ready
App CTA → /master-class; tryIt "Read the free course overview" → /master-class. legacyPath
/master-class-landing. Claims: four modules named exactly as in server/data/master-class-modules.json
(Business Formation & Licensing, GMB Setup & Optimization, Website & Online Presence, SEO &
Directory Domination) ✓ (JSON read, 4 modules, prices 150000/200000/150000/150000 — all ≥
SALES_THRESHOLD_CENTS → sales-rep quote, isSalesOnly ✓); "guide for all 50 states" ✓
(state-guides.json = 50 entries, script-counted); "18 states with licensing_required false →
local/trade licensing notes" ✓ (script-counted 18); any purchase unlocks the Google Ads guide's 12
sections with server-enforced 403 ✓ (server/routes.ts:3236 /api/google-ads-guide/:slug); link-check
policy verified/unconfirmed/dead→web search ✓ (scripts/verify-state-guides.ts checkAgencyUrl);
purchase recorded on account (course_purchases.user_id) ✓; free overview = license lists + Quick
State Comparison ✓ (master-class.tsx).

### guides (Guides) — learn — kind "account" — ready
App CTA "Open Guides" → /guides; tryIt "Read the free LSA guide" → /lsa-guide (public route ✓).
Claims: Google Ads guide 12 sections ✓ (client google-ads-guide.tsx GUIDE_SECTIONS, 12 slugs);
LSA guide 8 sections ✓ (lsa-guide.tsx SECTIONS — 8 ids: verification, answering-calls, reviews,
services, messages, service-areas, photos, bio); Ad Fraud page open ✓ (google-ad-fraud.tsx); state
guides live in Master Class, license lists + comparison free ✓; walkthroughs with "Open …" links ✓
(guides.tsx); site-connection guide: 48-hour nameserver warning, limited key never saved, no DNS/
billing/member perms ✓ (site-connection-guide.tsx, cloudflare/client.ts ZONE_PERMISSIONS);
"connecting Cloudflare + Search Console in ConstructHUB is part of the Agency plan" ✓
(planNamesWhere modules.cloudflareSearchConsole = Agency).

### reinstatement (Reinstatement) — learn — kind "service" (gbpReinstatement, $599 one-time) — ready
App CTA "Open Reinstatement" → /reinstatement; tryIt "Send a free case review request" →
/reinstatement#reinstatement-form. Claims: price comes from GBP_REINSTATEMENT_CENTS (59_900 →
"$599 one-time", under the $1,000 sales threshold so a real price shows) ✓ — same constant used by
/reinstatement (client reinstatement.tsx:183,228) and Hub knowledge (server/hub/knowledge.ts:59), so
page, card and Hub agree; request form needs no account, free, rate-limited, emails team with
reply-to = requester ✓ (server/routes.ts /api/reinstatement/request, reinstatementLimit); soft vs
hard suspension descriptions ✓ (client reinstatement.tsx); "Google alone decides" ✓; Profile Guard
cross-link ✓.

### gabe (Gabe) — platform — kind "account" — ready
App CTA "Ask Gabe on your dashboard" → "/" (app surface); tryIt → /pricing. Claims: quick questions
work signed out, free text needs verified email ✓ (server/hub/routes.ts, access.ts isBuilder);
`<N> quick questions` card = live `Object.keys(HUB_PRESETS).length` = **16** ✓ (HUB_PRESETS has 16
entries, hub-presets.ts:19-36); 500 chars/message ✓ (hub/routes.ts:43 MAX_USER_CHARS=500); 20
questions per chat ✓ (hub/turns.ts:16 MAX_USER_TURNS=20); 40 questions/day/account ✓ (hub/limits.ts:22
userDaily 40/day); ~120 words, English only ✓ (hub/prompt.ts:50 STYLE "At most 120 words… English
only"); answers checked and failures replaced by fallback incl. presets ✓ (hub/output-filter.ts,
replies.ts R_FALLBACK); redaction of emails/phones/addresses/IDs before the model ✓ (hub/prefilter.ts
redact/forModel); no account data, no tools, sales-rep-priced work never priced ✓ (prompt.ts
hardRulesText; plan-copy.ts:398 knowledge-pack rule); no plan check ✓ (hub/routes.ts); no transcript
stored, only daily outcome counts ✓ (hub/store.ts). Welcome presets for new accounts ✓
(WELCOME_PRESETS).

### customer-api (Customer API) — platform — kind "allowance" (apiUnitsPerMonth) — ready
App CTA + tryIt "Read the API reference" → /developers. Claims: up to 25 active keys, shown once,
stored hashed, scopes + per-key monthly cap + expiry, revoke ✓ (server/account/api-keys.ts:92
MAX_ACTIVE_API_KEYS=25); read = 1 unit + 1 per 100 rows, write = 5, only successful calls ✓
(server/public-api/quota.ts ROWS_PER_UNIT=100); reset on the 1st UTC ✓; 402 plan_required /
429 quota_exceeded / 429 with Retry-After ✓ (quota.ts:90); rate per key = plan's apiRatePerMinute
(60 on Pro/Growth/Agency) + per-account cap across keys ✓ (server/public-api/rate-limit.ts); response
headers X-RateLimit-Limit/Remaining, X-Units-Remaining, GET /api/v1/me ✓ (public-api/index.ts);
OpenAPI doc at /api/v1/openapi.json feeding /developers ✓; no AI through the API (import-graph test)
✓ (no-ai.test.ts, api-keys-panel.tsx API_NO_AI_NOTICE); chub_ keys only under /api/v1, never CRM/
session routes; CRM's chk_ keys separate ✓ (public-api/auth.ts, guard.ts); allowance line "Pro
10,000, Growth 50,000, Agency 250,000" via allowanceLine ✓ price book; writes go through the app's
own code incl. Site Scan quota ✓ (gbp-write.ts, social-write.ts, sitescan-write.ts reserveQuota).

### call-assistant (external catalogue entry, not a template page)
Catalogue card only (index.ts:84-94): title "AI Call Assistant", lede from the dashboard tile,
path /call-assistant, icon "phone", pricing kind "addon" (call_assistant) → card shows "Add-on —
$249/mo", link → /call-assistant, no Coming Soon pill (no preview flag — correct per plans.ts:353).
Slugging quirk handled: /features/call-assistant redirects to /call-assistant (features.tsx:199-201).

## Findings

Counts (element rows across the three tables above): **≈96 mapped — 95 OK, 1 BUG, 0 UNCLEAR,
0 DEAD.** Every numeric claim in all 30 content files traces to code or the price book; the one
stale claim is a launch-status sentence, not a number.

1. **BUG — /features/crm-leads FAQ misstates the AI Call Assistant's sale status.**
   `shared/feature-pages/crmLeads.ts:122`: "The AI Call Assistant, **an add-on that isn't on sale
   yet**, files the leads from the calls it answers into the CRM." The Call Assistant launched:
   `shared/plans.ts:353` records the owner's 2026-10-02 decision ("the call assistant is live not
   coming soon") and **no add-on carries `preview: true`** (grep: only the type declaration and
   comments mention preview), so checkout sells every tier today and the catalogue correctly shows no
   "Coming soon" pill. The template's coming-soon machinery (pricing.ts:122 `comingSoon:
   addon.preview === true`; call-assistant-landing.tsx:185 gates its "When can I buy it?" FAQ behind
   `p.comingSoon`) already reflects live status — only this static sentence disagrees. Fix: reword to
   "an add-on" (drop "that isn't on sale yet"), e.g. "…The AI Call Assistant, a paid add-on, files the
   leads from the calls it answers into the CRM."

Not bugs but worth noting:

- **No DB-derived numbers exist on these pages by design** (WRITING-GUIDE.md: "No statistics…").
  The brief's canonical examples ("2,700+ databases", "X counties") do not appear anywhere in the 30
  content files; the Database Directory page (another lane) computes its counts live from
  /api/databases/counts. DB spot check anyway: counties 3,139 / permit_databases 32,853 /
  property_appraisers 3,040 rows exist behind the permits/property claims.
- **Trial wording**: every plan-kind/allowance-kind price note says "A new account's first plan starts
  with a 1-day trial" (TRIAL_DAYS=1, plans.ts:411) — consistent everywhere it appears, including the
  catalogue figures.
- **Environmental test failure unrelated to this lane**: `server/ads/ads.test.ts` fails to boot in
  this checkout ("Invalid URL" / "SASL: client password must be a string" — missing env/DB URL for
  that suite). `server/feature-pages.test.ts` (the suite that guards this lane's registry) passes
  18/18.
- **Unverifiable externally**: Blotato/Google/Cloudflare/Stripe/Telegram/SignalWire behaviors are
  verified only against this repo's code, not live third-party calls. The `tryIt` "Free 60-second
  website scan" label is marketing phrasing for /free-site-scan (actual free-scan cap: 11 pages,
  site-scan.tsx:1368) — the "60-second" figure is not enforced anywhere but is a duration estimate,
  flagged here for awareness rather than as a bug.
