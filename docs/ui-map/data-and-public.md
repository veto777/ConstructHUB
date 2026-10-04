# UI map — lane 6: government data pages and the public/marketing site

Every element of every page in audit lane 6, what it does, and how it was verified.
Lane dir (logs, fragments, BUGS.md, REPORT.md): /tmp/claude-1000/-home-veto-ConstructHUB/b63db1cc-791d-4d76-a373-8b7b67c0c5d0/scratchpad/audit/lane6
Audited 2026-10-04 against the dev DB (constructhub_dev_a6) and a signed-out dev server.

# Lane 6 / Map-07 — Public chrome audit (site-nav, public-page-chrome, cart, page coverage, signed-in/out frames)

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
# Lane 6 map — pages 05: landing.tsx + call-assistant-landing.tsx

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
| Launch price line (text-call-assistant-landing-price) | price | "Solo $99/mo for your first 3 months, then $249/mo — or $1,999/yr" | call-assistant-marketing.tsx:294-297 | shared/plans.ts CALL_ASSISTANT_TIERS solo: introMonthlyCents 9900 ×3, monthlyCents 24900, annualCents 199900 | shared/plans.ts | OK |
| Tiers line (text-call-assistant-landing-tiers) | price/stat | "Regular prices from $149/mo. Four tiers: Lite (1,000 min, 1 local number), Solo (2,000 min, 1 local number), Crew (5,000 min, 5 local numbers) and Fleet (12,000 min, 20 local numbers). Crew and Fleet pay less per extra minute. The first 500 spam calls each month are free on every tier. An add-on for the Pro, Growth and Agency plans." | call-assistant-marketing.tsx:300-305 | shared/plans.ts tiers + CALL_ASSISTANT_FREE_SPAM_CALLS=500 + availableOn ["pro","growth","agency"] | shared/plans.ts | OK (Lite $1,199/yr is a documented owner-unconfirmed placeholder — see Findings; not shown in this line) |
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
| Hero price line (text-ca-hero-price) | price | "Regular prices from $149/mo (Lite). Solo: $99/mo for your first 3 months, then $249/mo — or $1,999/yr. Crew and Fleet for busier phones, at a lower rate per extra minute. Compare the four tiers" | call-assistant-landing.tsx:250-255 | shared/plans.ts CALL_ASSISTANT_TIERS: lite monthlyCents 14900; solo introMonthlyCents 9900/introMonths 3, monthly 24900, annual 199900; crew/fleet overageCentsPerMinute 5 vs 10 | shared/plans.ts:283-288 | OK |
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

All figures via `callAssistantPricing()` (shared/plan-copy.ts:204-236) from CALL_ASSISTANT_TIERS (shared/plans.ts:283-288).

| Element | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Four Tiers. Pick Your Call Volume." + summary (text-call-assistant-price) | stat | tierCountWord="four"; "regular prices from $149/mo. Solo starts at $99/mo for your first 3 months, then $249/mo — or $1,999/yr" | call-assistant-landing.tsx:440-444 | 4 tiers; lite 14900; solo intro 9900×3 / 24900 / 199900 | shared/plans.ts | OK |
| Tier cards (card-ca-tier-lite/solo/crew/fleet) | prices | Lite $149/mo or $1,199/yr · 1,000 min · 1 number · 10¢/min · "about 500 calls a month (estimate)". Solo $99 intro shown with terms "for your first 3 months, then $249/mo — or $1,999/yr" · 2,000 min · 1 number · 10¢ · ~1,000 calls. Crew $449 · $3,599/yr · 5,000 min · 5 numbers · 5¢ + "Lower overage" badge · ~2,500 calls. Fleet $799 · $6,399/yr · 12,000 min · 20 numbers · 5¢ + badge · ~6,000 calls | call-assistant-landing.tsx:445-480; text-ca-tier-price-*/terms-*/overage-* | CALL_ASSISTANT_TIERS: (lite 14900/119900/1000/1/10), (solo 24900/199900/2000/1/10, intro 9900×3), (crew 44900/359900/5000/5/5), (fleet 79900/639900/12000/20/5); estimates = minutes ÷ CALL_ASSISTANT_ESTIMATE_MINUTES_PER_CALL (2) rounded to 50 (plan-copy.ts:144) and labelled "(estimate)" | shared/plans.ts | OK — except Lite's $1,199/yr is a documented owner-unconfirmed placeholder (plans.ts:281): REPORT, not a UI bug |
| "On every tier" panel (card-ca-every-tier) | prices/stats | first 500 spam calls free; overage "$0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet"; extra local numbers $5/mo each; tier switches prorated | call-assistant-landing.tsx:481-495 | CALL_ASSISTANT_FREE_SPAM_CALLS=500; overageCentsPerMinute 10/10/5/5; ADDONS.call_number monthlyCents 500; exclusiveGroup switch prorated (server/billing/order.ts applyExclusiveSwitch, plans.ts:231-234) | shared/plans.ts | OK |
| "An add-on for the Pro ($79/mo), Growth ($199/mo) and Agency ($349/mo) plans, not a plan of its own." (text-ca-plans) + link-ca-pricing → /pricing#add-ons | stat + link | availableOn = pro/growth/agency; plan prices from PLANS | call-assistant-landing.tsx:496-508 | ADDONS[t].availableOn=["pro","growth","agency"]; PLANS monthlyCents 7900/19900/34900 | shared/plans.ts | OK; anchor id="add-ons" exists (pages/pricing.tsx:588) |
| Primary + sales CTAs (link-ca-signup-pricing / button-ca-sales-pricing) | link/button | same recipes as hero | call-assistant-landing.tsx:511-514 | POST /api/seo-inquiry for the sales button | confirmed above | OK |

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
2. **Lite tier annual price is an owner-unconfirmed placeholder (REPORT, not fixed).** shared/plans.ts:281: "Lite's $1,199/yr is a PLACEHOLDER the owner has not set yet (confirm before the tiers leave preview)." The /call-assistant pricing card shows Lite "or $1,199/yr" (text-ca-tier-terms-lite) as if final. No UI code change needed; the price book needs the owner's number.
3. **"Pro Tools Built In" = 12 counts a different list than the page's own services grid.** The stat (GROWTH_TOOLS, growth-tools.ts — 12 dashboard tools incl. IP Tracker, VPN Shield, Click Guard, Master Class variants) is displayed one section above a 10-card services grid built from a different array (landing.tsx:137-198). Both are individually honest, but a visitor comparing "12 Pro Tools" against 10 visible cards has no way to reconcile them; and the AI Call Assistant is marketed as a built tool on the page while being deliberately excluded from GROWTH_TOOLS (it sits in UPCOMING_TOOLS, growth-tools.ts:127-141, and is an add-on, not an included tool). Consider a footnote or aligning the lists.
4. **"No card needed to sign up" / "Cancel anytime"** (landing.tsx:308-310) are static claims. Verified by code that the auth page collects no card (client/src/pages/auth.tsx has no payment fields) and checkout/trial are separate steps; not e2e-verified because Stripe is off on dev (503 expected). Also the 1-day trial is enforced at subscription creation (TRIAL_DAYS=1, server/stripe.ts:296).
5. **No dead links found on either page.** Every Link/href on both pages was confirmed against client/src/App.tsx routes (or file existence for /mascot/* and /persona-samples/*), and both pricing anchors (#services, #add-ons) exist in client/src/pages/pricing.tsx:656, 588. mailto:support@constructhub.us is a static address.
6. **No "coming soon" badge despite 'New' kicker** — intentional: ComingSoonTag renders only while all Call Assistant add-ons carry `preview` (none do; plans.ts:348-353 "the call assistant is live not coming soon"). The /call-assistant FAQ's "When can I buy it?" item is likewise correctly omitted. Noted so no one "fixes" it back.
7. **Dual use of /call-assistant confirmed:** signed-out → this landing page (App.tsx:309); signed-in on the app host → CrmCallAssistantPage (App.tsx:206, the CRM app — another lane's); CRM-host links redirect to the marketing URL (App.tsx:155-160). The landing component's signed-in CTA ("Open your Call Assistant" → /call-assistant) therefore lands on the CRM app for signed-in users, which is the intended behaviour.
8. **Unverifiable from the UI lane:** Kokoro-82M voice-id validity (claimed verified by the engine lane, shared/voice-personas.ts:5-11); the recording-notice Studio warning; per-state recording-consent advice ("check your state's rules" — appropriately hedged copy); spam-classifier accuracy; Agency per-location band prices (mentioned only as "then per-location pricing" on the landing card — details live on /pricing, another lane).

### Element counts
- Home page: 55 element rows across 9 container tables (hero 10, stats 4, services 11, call-assistant section 6, done-for-you 5, plans 7, coverage 3, final CTA 2, footer 7) → all OK (2 OK-with-caveat noted above), 0 BUG, 0 DEAD, 0 UNCLEAR.
- /call-assistant landing: 28 mapped items — 20 element rows across 6 tables (hero 8, spam 3, calls-CRM 2, pricing 5, talk-to-sales 1, cart/checkout 1) + 8 prose-mapped containers (how-it-works, voices, highlights, agent-studio, FAQ, in-depth, final CTA, footer) → all OK (incl. the Lite-placeholder price flagged in Findings 2), 0 BUG, 0 DEAD, 0 UNCLEAR.
- Total: 83 elements → 83 OK, 0 BUG, 0 UNCLEAR, 0 DEAD. Two REPORT items (inactive-row total labelling; Lite $1,199/yr placeholder) and one consistency note (12-vs-10 tool counts) are in Findings.
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

Add-on table rows filter out the 4 Call Assistant tier add-ons (`CALL_ASSISTANT_TIER_ADDONS`, pricing.tsx:621) because they have their own cards. Prices via `addonPriceCents` (pricing-display.ts:41); every add-on's annual = 10× monthly (recomputed ✓) — except the Call Assistant tiers, whose annual prices are their own numbers (by design, shared/plans.ts:345-347).

| Element (visible label / testid) | Kind | What it does | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Section lede ("Add or remove them any time in Settings → Billing" when editable) | text | Explains add-ons ride a subscription | pricing.tsx:592-595 | add-ons bought via `POST /api/stripe/addons` (stripe.ts:350) or with a plan at checkout | code | OK |
| "How it works →" / `link-addon-call-assistant` | link | Goes to /call-assistant | pricing.tsx:603 | — | App.tsx:206 and :309 (`/call-assistant` exists, signed-in CRM page + public landing) | OK |
| Intro line / `text-addon-intro-call_assistant` | price copy | Monthly: "Regular prices from $149/mo (Lite). Solo launch price: $99/mo for your first 3 months, then $249/mo — or $1,999/yr". Yearly: full per-tier yearly list | pricing.tsx:605-608; shared/plan-copy.ts:245, 267 | `CALL_ASSISTANT_TIERS` (shared/plans.ts:283-288); Solo intro 9900¢ × 3 months, monthly billing only (server/billing/intro.ts coupon) | tsx ✓ ($149 Lite, $99 intro, $249, $1,999) | OK |
| Tier card Lite `$149/mo · $1,199/yr` / `text-call-assistant-tier-price-lite` (+ "1,000 call minutes", "1 local number", "Fits about 500 calls (estimate)", "10¢/min over") | price card | Lite tier facts | client/src/components/call-assistant-tiers.tsx:32-61; shared/plan-copy.ts:180-191 | `CALL_ASSISTANT_TIERS[0]`; yearly shown = `annualCents` 119900 | tsx ✓ minutes/numbers/overage; **$1,199/yr is a documented owner placeholder — see Findings** | UNCLEAR |
| Tier card Solo `$249/mo · $1,999/yr` + "Launch price: $99/mo for your first 3 months" / `text-call-assistant-tier-price-solo`, `text-call-assistant-tier-intro-solo` | price card + intro | Solo tier facts; intro only shown on monthly toggle | call-assistant-tiers.tsx:32-61, 46-49 | intro = Stripe coupon `monthlyCents − introMonthlyCents` for `introMonths` (shared/plans.ts:236-243, server/billing/intro.ts), once per customer | tsx ✓ ($99 × 3, then $249; no intro on annual) | OK |
| Tier card Crew `$449/mo · $3,599/yr` + "Lower overage" badge | price card + badge | Crew facts; 5¢/min is below the 10¢ max, badge math ✓ | call-assistant-tiers.tsx:32-61, 57-60 | `CALL_ASSISTANT_TIERS[2]` | tsx ✓ (5 < 10 → badge correct) | OK |
| Tier card Fleet `$799/mo · $6,399/yr` + "Lower overage" badge | price card + badge | Fleet facts | call-assistant-tiers.tsx:32-61 | `CALL_ASSISTANT_TIERS[3]` | tsx ✓ | OK |
| "Every tier: the first 500 spam calls each month are free… Above the included minutes, $0.10 a minute on Lite and Solo, $0.05 on Crew and Fleet. Extra local numbers $5/mo each. Add-on for the Pro, Growth and Agency plans." / `text-call-assistant-tiers-every` | footnote box | Shared tier rules | call-assistant-tiers.tsx:65-71; plan-copy.ts:199-201, 227, 230 | `CALL_ASSISTANT_FREE_SPAM_CALLS=500`, overage rates 10/10/5/5, `ADDONS.call_number` 500¢, `availableOn` [pro, growth, agency] | tsx ✓ | OK |
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

1. **UNCLEAR — AI Call Assistant "Lite" yearly price is an unconfirmed owner placeholder, shown to customers.** `shared/plans.ts:280-281` documents Lite's `$1,199/yr` (`annualCents: 119900`) as "a PLACEHOLDER the owner has not set yet (confirm before the tiers leave preview)". It renders live on /pricing whenever the Annual toggle is on (`client/src/components/call-assistant-tiers.tsx:44`, testid `text-call-assistant-tier-price-lite`) and in the yearly intro line (`shared/plan-copy.ts:267 callAssistantYearlyNote`, via `pricing.tsx:607`). If a customer subscribes to Lite on annual billing before the owner confirms, Stripe bills the placeholder (checkout uses this exact `annualCents` — server/billing/prices.ts:91). Owner decision needed; not a code bug.

Observations (not counted as bugs):
- The Monthly/Annual toggle does not write back to the URL after the initial `?interval=` read (`pricing.tsx:106-107`): refreshing /pricing resets the toggle to Monthly. No monetary impact.
- The "Add to cart" branch of the DFY service cards (`pricing.tsx:756-772`) is unreachable by design — every DFY catalog price is ≥ $5,500, above the $1,000 sales threshold — so a `dfy_service` cart line can never be created from /pricing; the server's DFY branch of `create-cart-checkout` (stripe.ts:537) is defensive only.
- Signed-in-only elements (current-plan banner, change-plan dialog, portal, Manage add-ons) and the actual Stripe session creation could not be exercised live (Stripe is OFF on dev → 503 "Online payments aren't set up on this server yet", server/billing/client.ts:11-17); they are verified by code trace and the server billing test suite (server/stripe-billing.test.ts, server/stripe-not-configured.test.ts).
- No `/api/plans` or `/api/catalog` JSON API exists; both URLs return the SPA shell. The only plan-price API is `GET /api/stripe/plans` (curl-verified identical to shared/plans.ts).
# Lane 6 — map-04: /done-for-you catalogue + every /done-for-you/<slug> service page

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
# Lane 6 element map — /databases, /property, /search

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
