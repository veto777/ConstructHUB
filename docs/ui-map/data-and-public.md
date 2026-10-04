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
