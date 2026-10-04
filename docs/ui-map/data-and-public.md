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
