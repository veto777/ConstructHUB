# Lane 1-07 — Settings: Billing, Limits & usage, API keys/usage

Audit date 2026-10-04, worktree `/home/veto/ConstructHUB-audit1` (branch audit/1), dev server
http://127.0.0.1:8301 signed in as dev platform admin user 1 (dev@constructhub.local).
All platform settings pages render via the settings shell `/settings?tab=<id>`; on a portal-forced
dev host append `&portal=0`. Legacy deep links `/settings/billing[?billing=…]` and
`/settings/api[?api=usage]` redirect into the shell (verified: → `/settings?tab=invoices`,
`→ /settings?tab=api-usage`, `→ /settings?tab=billing`).

Server-side ground truth for every number on these pages:

- `GET /api/stripe/subscription` → server/stripe.ts:223 → `subscriptionRowFor` +
  `subscriptionSummary` (server/billing/sync.ts:170) → `subscriptions` row for the user
  (`SUBSCRIPTION_ORDER`, server/entitlements.ts:205: a row with an access status wins, then newest),
  plus `cancel_at_period_end` / `cancel_at` / `start_date` from the same row.
- `GET /api/entitlements` → server/routes.ts:249 → `getEntitlements` (server/entitlements.ts:267,
  users ⋈ subscriptions) + `locationCount` = `SELECT count(*) FROM business_locations WHERE user_id=$1`
  + `monthlyUsage` (server/growth-quotas.ts:198 → `growth_budgets` rows
  `quota:user:{id}:{searches|rankings|siteScans|competitorScans|texts}:{YYYY-MM UTC}`, `period='0'`)
  + `resetsAt` = first instant of next UTC month. User-scoped, never org-scoped.
- Billing ledgers: `GET /api/billing/invoices|payment-methods|purchases` →
  server/account/billing-routes.ts:409,422,431 → `billing_invoices` / `billing_purchases`
  (`WHERE user_id=$1 … ORDER BY COALESCE(created,'epoch') DESC, id DESC`, keyset cursor resolved
  inside the same user scope) and Stripe for cards. Payment methods are never stored locally.
- API keys: `GET|POST /api/account/api-keys`, `PATCH|DELETE …/:id`, `GET /api/account/api-usage` →
  server/account/api-key-routes.ts:230-335 → `account_api_keys` (secrets hashed; prefix/suffix only),
  `account_api_usage` (`day` buckets, per calendar month UTC for the quota, per day for the series).

Status legend: OK / BUG / UNCLEAR / DEAD. "Verified how": SQL = read-only psql against
constructhub_dev_a6; curl = dev-bypass API call; browser = Playwright on the live dev server;
"code only" = read end-to-end, not exercisable on dev (Stripe is off; expected per lane rules).

---

## Settings shell (routing, shared by all tabs)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| Left nav rows (My account…Integrations) `button-settings-tab-*` | nav buttons | Open the matching settings section; Workspace group holds Billing / Limits & usage / API keys / API usage / Audit log / Integrations | client/src/pages/settings/sections.tsx:27 (registry), client/src/pages/settings/nav.tsx | none — client only: `go(section)` swaps the section, `?tab=` in the URL | browser | OK |
| Section title + description | heading | Shows the selected section's label and one-line description | sections.tsx:27 (`label`/`description`) | none — client only | browser | OK |
| ⓘ info tip `info-tip-account-billing` etc. | icon button | Opens the help popover for the section (lib/info-content.ts `infoKey`) | sections.tsx:33 (`infoKey`) | none — client only | code only | OK |
| `?tab=` routing + aliases (`invoices` → billing section + inner view, `usage` → limits…) | URL state | Deep links and old tab names land on the right section/tab; unknown tabs fall back to My account | client/src/pages/settings/sections.tsx:76 (TAB_ALIASES), resolveSettingsTab:99 | none — client only | browser (invalid tab → account) | OK |
| `/settings/billing` → `/settings?tab=billing` (+`?billing=invoices|payment-methods|purchases|subscriptions`) | redirect | Old billing URLs keep working, landing on the right inner tab | client/src/App.tsx:133 (SettingsBillingRedirect) | none — client only | browser | OK |
| `/settings/api` → `/settings?tab=api-keys` (+`?api=usage`) | redirect | Old API URL keeps working | client/src/App.tsx:144 (SettingsApiRedirect) | none — client only | browser | OK |

## plan & billing (the "Subscriptions" tab body: PlanBillingSection)

Section id `billing` in the shell renders `BillingPanel` with `SubscriptionsPanel` (statement) +
`PlanBillingSection` below it (client/src/pages/settings/account-panels.tsx:22). Everything here
reads `GET /api/stripe/subscription` (useSubscription, client/src/pages/settings/use-billing.tsx:23)
and `GET /api/entitlements` (useEntitlements, use-billing.tsx:29).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Current plan" card `card-current-plan` | card | The plan box: name, status badge, legacy note, interval/price line, renewal line, action buttons | client/src/pages/settings/plan-billing.tsx:108 | — | browser | OK |
| "Loading your plan…" / "Couldn't load your plan." `text-current-plan` | status text | While the subscription query loads or after a failure | plan-billing.tsx:115-120 | GET /api/stripe/subscription | browser | OK |
| Plan name + status badge `badge-plan-status` ("Standard plan · Active") | text + badge | The bought plan's name (legacy name kept, e.g. "Standard") and the subscription row's status, worded: Active/Trial/Payment past due/Unpaid/Canceled/…/Paused | plan-billing.tsx:123-127 (STATUS_LABELS:26) | GET /api/stripe/subscription → subscriptions.status (row per SUBSCRIPTION_ORDER) | browser + SQL (subscriptions row: plan=standard, status=active); paused label added by this audit (was raw "paused") | OK |
| Legacy note `text-legacy-match` ("Your features now match Starter.") | text | For old plan names: features follow the mapped new plan; Stripe-bought legacy keeps its old price until a plan change | plan-billing.tsx:129-133 | GET /api/stripe/subscription → LEGACY_PLAN_MAP (shared/plans.ts:422) | browser (standard → "Your features now match Starter.") | OK |
| Interval + price line `text-plan-interval` ("Billed monthly · $29/mo") | text | Billing interval and the price-book price for the plan+interval; hidden when the server reports no interval or a legacy plan | plan-billing.tsx:134-138, priceText:93-100 | Prices: shared/plans.ts only (PLANS[*].monthlyCents/annualCents); subscription: subscriptions.billing_interval | browser ($29/$79/$199/$349 = price book ✓); "—" case code only | OK |
| Renewal / end line `text-plan-period` ("Renews Oct 31, 2026" / "Trial ends …" / "Ends …" / "No end date" / "Access granted by ConstructHUB until …") | text | Reads subscriptions.current_period_end (timestamptz, shown in the viewer's time zone); ≥2099 reads "No end date"; Stripe-less grants say who granted the access | plan-billing.tsx:80-91 | GET /api/stripe/subscription → subscriptions.current_period_end, cancel_at_period_end, stripe_subscription_id | code only (dev row has no period end → line hidden, verified in browser) | OK |
| Past-due alert "Your last payment didn't go through. Update your card in Manage billing." | alert line | Shows under the plan name when the subscription status is past_due/unpaid/incomplete | plan-billing.tsx:142-144 (PAYMENT_PROBLEM_STATUSES, client/src/lib/pricing-display.ts:263) | Same status field | code only (user 1 is active); note: "paused" is NOT in this list though the server counts it as paymentNeeded — see bugs | OK |
| "Change plan" / "Choose a plan" `button-upgrade` | button | Goes to /pricing (keeps a yearly interval as ?interval=year); without a plan the label is "Choose a plan" | plan-billing.tsx:158 | none — client route /pricing (App.tsx:176) | browser (clicked → /pricing) | OK |
| "Manage billing" `button-manage-billing` | button | Opens Stripe's billing portal: POST /api/stripe/create-portal → {url} → browser leaves for Stripe. Only shown when the subscription row has a Stripe id | plan-billing.tsx:161-165; hook client/src/pages/settings/use-billing.tsx:45 | POST /api/stripe/create-portal → server/stripe.ts:416 → stripe.billingPortal.sessions.create (return_url /pricing) | curl on dev: 400 "No subscription found" (user 1 has no Stripe customer — Stripe off on dev, expected); code path verified | OK (verified by code) |
| 4 plan cards `card-plan-starter|pro|growth|agency` | link cards | Plan name, "Current"/"Matches" badge, price-book price at the current interval, tagline; click → /pricing | plan-billing.tsx:168-185 | Prices from shared/plans.ts (planPriceCents) | browser (Starter carries "Matches" for this user; $29/$79/$199/$349 ✓) | OK |
| "Usage this month" card `card-usage` (UsageCard) | card | This month's allowances as the server counts them, each with a usage bar | plan-billing.tsx:387-451 | GET /api/entitlements | browser | OK |
| "Platform admin: every feature is on…" `text-usage-admin` | text | For platform admins: explains every limit reads unlimited and per-day caps still apply | plan-billing.tsx:402-406 | GET /api/entitlements → isPlatformAdmin | browser | OK |
| Locations row `usage-locations` ("2 · unlimited") | meter row | Count of this account's business_locations rows vs the plan limit (-1 = unlimited/fair use) | plan-billing.tsx:407-418 | /api/entitlements → locationCount → `SELECT count(*) FROM business_locations WHERE user_id=1` | SQL (count=2 ✓) + browser | OK |
| 5 monthly meter rows `usage-searches|rankings|siteScans|competitorScans|texts` ("16 used · unlimited") | meter rows + progress bars | Permit searches / Ranking-grid credits / Site Scans / Competitor Intel scans / Text segments used this UTC calendar month vs limit; bar only for finite limits; red at ≥100% | plan-billing.tsx:419-441 (USAGE_METERS, client/src/lib/pricing-display.ts:149) | /api/entitlements → growth_budgets keys `quota:user:1:{feature}:2026-10`, period='0' | SQL (siteScans=16, texts=313 match; searches/rankings/competitorScans=0 — no rows, default 0) + browser | OK |
| "Monthly counts reset November 1." `text-usage-resets` | text | Reset date = first of next month, formatted in UTC on purpose | plan-billing.tsx:442-447 | resetsAt() → next UTC month | browser (resetsAt 2026-11-01 → "November 1") | OK |
| "Add-ons" card `card-addons` | card | One row per add-on the plan sells, with − qty + controls; plus the Agency locations row and the Call Assistant tier picker when applicable | plan-billing.tsx:191-330 | POST /api/stripe/addons; GET /api/stripe/addons/release-preview | browser (card visible; controls disabled here: legacy non-Stripe plan) | OK |
| Add-on intro copy + proration note | text | How add-on billing works (prorated, invoiced right away; a failed card changes nothing) | plan-billing.tsx:197-200 | — (copy; matches server behaviour in server/stripe.ts:350) | code only | OK |
| "not bought through Stripe checkout" note `text-addons-no-stripe` | text | Explains add-ons need a Stripe-bought plan; points to Pricing | plan-billing.tsx:201-204 | — (driven by view.viaStripe = subscriptions.stripe_subscription_id) | browser (shown for user 1) | OK |
| Agency "Client locations" row `row-billing-locations` (input `input-billing-locations`, Update `button-billing-locations`, quote `text-billing-locations-quote`, sales `button-billing-locations-sales`) | input + buttons | Agency only: type a location count, see the per-location quote, Update → POST /api/stripe/change-plan {plan:"agency", interval?, locations}; above AGENCY_SELF_SERVE_MAX_LOCATIONS a "talk to sales" button opens the inquiry dialog | plan-billing.tsx:210-254 | POST /api/stripe/change-plan → server/stripe.ts:317 → applyToSubscription (prorated Stripe update); quote: agencyQuote (shared/plans.ts AGENCY_LOCATION_BANDS) | code only (user 1's plan is Starter — row not rendered; verified by route check) | OK |
| Call Assistant card `card-call-assistant-billing` (CallAssistantBillingCard) + `CallAssistantTierPicker` | card + buttons | **Since 2026-10-08 (superseded the row below):** the AI Call Assistant is a separate service on its own subscription. The card shows the held tier (500 / 1,000 / 2,000 / 5,000 minutes at $249 / $349 / $449 / $999 a month, 11 × yearly), extra numbers and status; a switch POSTs /api/call-assistant/billing/change (re-priced in place, prorated, `error_if_incomplete`); a first purchase goes through /api/call-assistant/billing/checkout from Pricing `#call-assistant`; cancellation is in Stripe's portal; reducing below held numbers opens the release confirm dialog | client/src/components/call-assistant-billing-card.tsx; picker client/src/components/call-assistant-tiers.tsx; dialog use-billing.tsx | GET /api/call-assistant/billing/subscription; POST /api/call-assistant/billing/change → server/voice/subscription.ts; GET /api/stripe/addons/release-preview → previewCallNumberReleases (voice_numbers) | code + `server/stripe-billing.test.ts` (prices = shared/plans.ts CALL_ASSISTANT_TIERS ✓); not re-walked in a browser | OK |
| ~~Call Assistant row `row-billing-call-assistant` + tier text `text-billing-call-assistant-tier` + Remove `button-billing-call-assistant-remove`~~ — **historical (pre-2026-10-08)** | rows + buttons | Showed the held tier as a platform add-on; the picker listed Lite/Solo/Crew/Fleet at $149/$249/$449/$799; a switch POSTed /api/stripe/addons. The platform checkout now refuses every Call Assistant key (`checkAddonsForPlan`) | plan-billing.tsx (old); picker call-assistant-tiers.tsx:82 (old) | POST /api/stripe/addons (old path) | code only, at audit time | superseded |
| Add-on rows `row-billing-addon-*` with − `button-addon-dec-*`, qty `text-addon-qty-*`, + `button-addon-inc-*` | stepper buttons | + adds one (POST /api/stripe/addons {addons:{key:qty+1}}); − asks first when the add-on holds Call Assistant numbers, otherwise sets qty−1; a reduction becomes account credit | plan-billing.tsx:284-327; use-billing.tsx:63-75 | POST /api/stripe/addons (prorated Stripe subscription update, server/stripe.ts:350-396) | browser (rows for extra_location $19/mo and extra_seat $15/mo = price book ✓; disabled: not editable on a legacy non-Stripe plan) | OK |
| Number-release confirm dialog `dialog-addon-number-release` ("Keep my number" / "Release the number(s)") | alert dialog | Before a change that would release phone numbers: lists the numbers (with org names), warns they can't be kept or moved | use-billing.tsx:120-163 | GET /api/stripe/addons/release-preview → {numbers:[{phoneNumber, orgName}]} | code only (no Call Assistant numbers on dev) | OK |
| "Payment method & invoices" card `card-payment-method` | card | Points at Stripe's portal for card/invoices/cancellation, or to Pricing when there is no Stripe subscription | plan-billing.tsx:332-374 | — | browser | OK |
| Portal text `text-billing-portal` | text | "Your card, invoices and cancellation are managed in Stripe's secure billing portal." (or the no-Stripe explanation) | plan-billing.tsx:340-355 | — (driven by view.viaStripe) | browser | OK |
| Cancel-releases note `text-billing-cancel-numbers` | text | When the account holds Call Assistant numbers on a Stripe plan: warns cancelling releases numbers X, Y | plan-billing.tsx:345-349 | GET /api/stripe/addons/release-preview?cancel=1 | code only; curl of the endpoint returns {numbers:[]} for user 1 | OK |
| "Manage billing" `button-portal-billing` / "See plans" `button-add-payment` | button | Stripe plan → billing portal (same create-portal call); no Stripe plan → /pricing | plan-billing.tsx:357-371 | POST /api/stripe/create-portal → server/stripe.ts:416 | browser (See plans shown; portal call 400 on dev — expected) | OK |

## subscriptions (SubscriptionsPanel — statement at the top of the Billing tab)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Subscription" card `card-subscription` | card | A read-only statement: plan, interval, start, next billing date, price, add-ons, total | client/src/pages/settings/billing/subscriptions-panel.tsx:106 | — | browser | OK |
| Header buttons (hidden in the shell) `button-change-plan`, `button-manage-billing` | buttons | Standalone use shows Change plan + Manage billing; the settings shell passes showActions:false because the plan cards below carry the actions | subscriptions-panel.tsx:112-121; account-panels.tsx:29 | POST /api/stripe/create-portal (portal) | code only; shell verified in browser (exactly one Manage billing on the page — see e2e) | OK |
| Plan row `text-subscription-plan` + status badge `badge-subscription-status` | text + badge | Stored plan name (legacy names kept) + status label incl. "Paused" | subscriptions-panel.tsx:143-145 (STATUS_LABELS:16) | GET /api/stripe/subscription → subscriptions.plan/status | browser ("Standard"/"Active") | OK |
| Legacy note `text-subscription-legacy` | text | "Your features match the {Plan} plan." | subscriptions-panel.tsx:146-148 | LEGACY_PLAN_MAP | browser | OK |
| Past-due alert | alert line | Same payment-problem line as the plan card (past_due/unpaid/incomplete) | subscriptions-panel.tsx:149-151 | same status field | code only | OK |
| "Billing" row `text-subscription-interval` | text | monthly/yearly from subscriptions.billing_interval, "—" when unknown | subscriptions-panel.tsx:153-155 | subscriptions.billing_interval | browser ("—" for user 1) | OK |
| "Start date" row `text-subscription-start` | text | When the Stripe subscription began (start_date), falling back to the row's period start; "—" when never synced | subscriptions-panel.tsx:156-158, 59 | subscriptions.start_date (recordCancellation, server/billing/sync.ts:137) | browser ("—"); format rules via format.ts:24 | OK |
| "Next billing date" row `text-subscription-next` | text | Period end worded by case: "Ends … (won't renew)" when cancelling, "Trial ends … — first charge that day" when trialing, plain date when renewing, "No end date" for ≥2099, "Access granted by ConstructHUB until …" for admin grants | subscriptions-panel.tsx:159-161, 64-72 | subscriptions.current_period_end + cancel_at_period_end + stripe_subscription_id | browser ("—"); trial/cancel wording covered by e2e | OK |
| "Price" row `text-subscription-price` | text | Price-book price for plan+interval ("$199/mo for 12 locations" style for Agency), or "your existing price (kept until you change plans)" for legacy, "priced with your sales rep" above self-serve | subscriptions-panel.tsx:162-167, 76-92 | shared/plans.ts only; subscriptions.agency_locations for the count | browser (legacy note shown, no number ✓); Pro price case in e2e | OK |
| "Add-ons" rows `list-subscription-addons` / "None" `text-subscription-no-addons` | list | Each held add-on with its quantity and, when the interval is known, its price-book price; quantities from the subscription row | subscriptions-panel.tsx:168-185, 94-103 | GET /api/stripe/subscription → subscriptions.addons (jsonb) | browser ("None"); priced rows in e2e | OK |
| "Total" row `text-subscription-total` + reset note | text | Plan + add-ons total per interval, only when a price could be computed; note that monthly allowances reset at entitlements.resetsAt | subscriptions-panel.tsx:186-193 | price book + /api/entitlements.resetsAt | code only (hidden for legacy/unknown-interval — verified by e2e absence assertions) | OK |
| Loading skeleton / error `text-subscription-error` / empty state `text-no-subscription` | states | Loading shimmer; error message; "No active plan" with the trial offer or the stored subscription's status | subscriptions-panel.tsx:124-140 | — | browser (empty state not shown — plan exists) | OK |

## payment methods (PaymentMethodsPanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Payment methods" card `card-payment-methods` | card | The cards Stripe holds for this account | client/src/pages/settings/billing/payment-methods-panel.tsx:36 | — | browser | OK |
| "Manage" `button-payment-methods-manage` | button | Opens Stripe's billing portal (add/replace/remove cards). Only rendered when at least one card exists | payment-methods-panel.tsx:42-47 | POST /api/stripe/create-portal | code only (empty here) | OK |
| Card rows `row-payment-method-*` | list rows | Brand label (Visa/Mastercard/…/bank name), "•••• last4", "Expires MM/YY" (red "Expired" when past), "Default" badge for the card the subscription charges | payment-methods-panel.tsx:59-80 | GET /api/billing/payment-methods → listPaymentMethods (server/account/billing-routes.ts:367) → Stripe customers.listPaymentMethods; default = subscription's default_payment_method, else customer invoice_settings | curl on dev: {methods:[]} (Stripe off — expected); row rendering incl. expired/Default covered by mocked e2e | OK (verified by code) |
| Empty state `text-payment-methods-empty` + "See plans" `button-payment-methods-plans` | text + button | No card on file → explanation + shortcut to /pricing | payment-methods-panel.tsx:53-57 | — | browser | OK |
| Loading/error `text-payment-methods-error` | states | — | payment-methods-panel.tsx:49-52 | — | code only | OK |

## invoices (InvoicesPanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Invoices" card `card-invoices` | card | Every Stripe invoice on the account, newest first, paged 20 at a time | client/src/pages/settings/billing/invoices-panel.tsx:40 | — | browser | OK |
| Table `table-invoices` (wide) / cards `card-invoice-*` (phone) | table/list | One row per invoice: number (or id), created date, billing period, amount, status badge, View/PDF links | invoices-panel.tsx:56-103 | GET /api/billing/invoices?limit=20[&starting_after=] → server/account/billing-routes.ts:409 → `billing_invoices WHERE user_id=1 ORDER BY COALESCE(created,'epoch') DESC, id DESC` | SQL (0 rows for user 1 = "No invoices yet" ✓); row rendering/pagination via mocked e2e | OK |
| Amount cell `text-invoice-amount-*` | number | Paid invoices show amount_paid; open/uncollectible show amount_due (fallback amount_paid) | invoices-panel.tsx:21, 78 | billing_invoices.amount_paid / amount_due (cents → formatMoney) | mocked e2e (paid/open cases) | OK |
| Status badge `badge-invoice-status-*` (Paid/Open/Uncollectible/Draft/Void) | badge | billing_invoices.status worded; colours: paid default, open secondary, uncollectible destructive, else outline | invoices-panel.tsx:17-18, 79 | billing_invoices.status (Stripe invoice status, webhook-written; drafts never stored) | mocked e2e | OK |
| "View" / "PDF" links `link-invoice-view-*`, `link-invoice-pdf-*` | external links | Open Stripe's hosted invoice page / PDF in a new tab; rendered only for http(s) URLs — a non-URL can never become an href | invoices-panel.tsx:119-140 (httpUrl guard format.ts:66) | billing_invoices.hosted_invoice_url / invoice_pdf | mocked e2e (incl. javascript: URL refused) | OK |
| Period cell `text-invoice-period-*` | text | "Sep 1 – Oct 1, 2026" from period_start/period_end | invoices-panel.tsx:77 (formatPeriod format.ts:40) | billing_invoices.period_start/end | mocked e2e | OK |
| "Load more" `button-invoices-more` | button | Fetches the next keyset page (?starting_after=<last id>) | invoices-panel.tsx:104-110 | pageOf (cursor validated inside user scope — another account's id → 400) | code only (hasMore false here); e2e covers paging | OK |
| Empty state `text-invoices-empty` | text | "No invoices yet. Your first one is created when a plan starts billing." | invoices-panel.tsx:50-53 | — | browser | OK |
| Download note in card description | text | "Each one is also emailed to you when it's paid." | invoices-panel.tsx:43 | — (copy) | code only | OK |

## purchases (PurchasesPanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Purchases" card `card-purchases` | card | One-time payments outside the subscription: courses, services, reinstatement | client/src/pages/settings/billing/purchases-panel.tsx:21 | — | browser | OK |
| Table `table-purchases` / phone cards `card-purchase-*` | table/list | Description (or "Purchase"), kind badge (Course/Service/Reinstatement/Purchase), date, amount, receipt link | purchases-panel.tsx:35-75 | GET /api/billing/purchases → server/account/billing-routes.ts:431 → `billing_purchases WHERE user_id=1 ORDER BY created DESC` | SQL (0 rows = empty state ✓); rows via mocked e2e | OK |
| Kind badge `badge-purchase-kind-*` | badge | From checkout metadata: type master_class → Course, reinstatement → Reinstatement, cart items → Course/Service/Other | purchases-panel.tsx:50 | billing_purchases.kind (purchaseRow, billing-routes.ts:247-260) | mocked e2e | OK |
| "Receipt" link `link-purchase-receipt-*` | external link | Stripe's receipt page for that payment (http(s) only) | purchases-panel.tsx:84-94 | billing_purchases.receipt_url | mocked e2e | OK |
| Empty state `text-purchases-empty` | text | "No one-time purchases on this account." | purchases-panel.tsx:32 | — | browser | OK |

## limits & usage (LimitsUsageSection)

Reads `GET /api/entitlements` for plan/allowances/usage, then one list endpoint per standing count.
Header card: plan name (or "All features, unlimited" for platform admins), "Platform admin" badge,
reset line, "Billing" and "Change plan" buttons (`button-limits-billing` → billing section,
`button-limits-change-plan` → /pricing, client/src/pages/settings/limits-usage.tsx:349-352).
Without a plan: `card-limits-no-plan` + "Compare plans" (`button-limits-choose-plan` → /pricing) +
"Open billing" (`button-limits-open-billing`). Verified in browser (admin header shown).

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Row `limit-locations` ("Google Business Profile locations") | limit row | Included per plan (Agency: "10 included, then per location" + "Billed for N locations."), used = linked locations count, bar vs ceiling; add-on extra_location stepper (`button-limit-addon-inc/dec-extra_location`) or Agency "Change location count" → billing | limits-usage.tsx:157-168 | /api/entitlements → locations.used = count(business_locations) ; Agency hint: view.locations = subscriptions.agency_locations | browser ("2 used", Unlimited) + SQL | OK |
| Row `limit-guardCadenceMinutes` ("Profile Guard edit checks") | limit row | "Every N min" — how often Profile Guard compares the listing to its snapshot; not a usage count | limits-usage.tsx:169-176 | /api/entitlements → allowances.guardCadenceMinutes (admin: fastest cadence, 15) | browser ("Every 15 min") | OK |
| Row `limit-gridCredits` ("Ranking-grid credits") | meter row | Plan's monthly grid credits; used from entitlements.usage.rankings; Agency hint "N per location each month"; add-on competitor note in hint | limits-usage.tsx:176-178 | growth_budgets `quota:user:1:rankings:2026-10` | browser ("0 used this month") + SQL | OK |
| Row `limit-reviewTemplates` ("Review request templates") | limit row | Included count; used = number of the account's review templates | limits-usage.tsx:179-186 | GET /api/review-templates → storage.getReviewTemplatesByUser(user.id) (server/routes.ts:5012) | browser ("1 used") + curl (1 template ✓) | OK |
| Row `limit-autoPublishAiReplies` ("AI review replies publish automatically") | limit row | Included/Not included; hint that drafts wait for approval when excluded | limits-usage.tsx:187-194 | /api/entitlements → allowances.autoPublishAiReplies | browser ("Included") | OK |
| Row `limit-protectedSites` ("Protected websites (Click Guard + IP Tracker + VPN Shield)") | limit row | Included count; used = number of tracked domains; add-on protected_site stepper | limits-usage.tsx:200-208 | GET /api/click-guard/domains → storage.getTrackedDomains(user.id) (server/routes.ts:3484) | browser ("12 used") + curl (12 domains ✓) | OK |
| Row `limit-siteScans` ("Site Scans") | meter row | Monthly Site Scans; used from entitlements.usage.siteScans; Agency per-location hint | limits-usage.tsx:209-211 | growth_budgets `quota:user:1:siteScans:2026-10` (16 ✓) | browser + SQL | OK |
| Row `limit-competitorScans` ("Competitor Intel scans") | meter row | Monthly competitor scans; add-on competitor_pack stepper ("10 more each month") | limits-usage.tsx:212 | growth_budgets `quota:user:1:competitorScans:2026-10` (0 ✓) | browser + SQL | OK |
| Row `limit-permitSearches` ("Permit searches") | meter row | Monthly permit searches | limits-usage.tsx:218 | growth_budgets `quota:user:1:searches:2026-10` (0; the 16 shown in September's row is last month's) | browser + SQL | OK |
| Row `limit-crmSeats` ("CRM seats (estimates, invoices, payments)") | limit row | Included seats; used = distinct seat holders across the owner's CRM orgs (+ agency team); add-on extra_seat stepper | limits-usage.tsx:219-227 | GET /api/crm/me → getSeatUsage (server/crm/tenancy.ts:176 → seatHolders: crm_members status active/invited of owner's orgs + owner + agency_members) | browser ("4 used"); SQL: 4 distinct holders (3 invited emails + u:1) ✓ | OK |
| Row `limit-teamTextSegments` ("Team text alerts") | meter row | Monthly text segments; hint explains the 160/70-char segment counting | limits-usage.tsx:228-230 | growth_budgets `quota:user:1:texts:2026-10` (313 ✓) — reserved in server/crm/sms.ts before sending | browser + SQL | OK |
| Row `limit-clientTexting` ("Two-way client texting") | limit row | none → "Not included"; included → "1 number included"; byo_or_addon → "Your SignalWire number or the texting add-on"; add-on texting_number stepper | limits-usage.tsx:231-242 | /api/entitlements → allowances.clientTexting | browser ("Included (own or dedicated number)" — admin variant) | OK |
| Row `limit-callAssistantMinutes` ("Call Assistant minutes") | meter row | Shown on plans that sell the add-on: included minutes of the held tier, used this month, overage line ($ over included minutes on the next invoice); paused state says "Paused — update your payment method"; embeds the tier picker (`row-limit-call-assistant-tier`) | limits-usage.tsx:256-288 | GET /api/crm/voice/status → server/voice/billing.ts:103 → voice_usage (org+month, server voice month key) via summarizeVoiceUsage; paused from entitlements | browser (admin: "Unlimited", "0 used this month") + curl (usage 0, allowance minutes −1) | OK |
| Row `limit-callAssistantNumbers` ("Call Assistant phone numbers") | limit row | Numbers the held tier (+ extras) allows; used = held active numbers; add-on call_number stepper | limits-usage.tsx:289-300 | /api/crm/voice/status → listOrgNumbers(voice_numbers) + numberAllowance | browser ("5" incl. admin ceiling, "0 of 5") + curl | OK |
| Row `limit-apiUnitsPerMonth` ("API units") | meter row | Monthly API unit allowance; used = plan.usedThisMonth from the keys endpoint; hint explains unit costs; "Manage API keys" button → api-keys section | limits-usage.tsx:309-319 | GET /api/account/api-keys → unitsThisMonth (account_api_usage, day ≥ month start) | browser ("69 used this month") + SQL (69 ✓) | OK |
| Row `limit-apiRatePerMinute` ("API requests per minute") | limit row | Per-key rate cap from the plan | limits-usage.tsx:320-325 | /api/entitlements → allowances.apiRatePerMinute (60) | browser ("60 / min per key") | OK |
| Per-row add-on steppers `button-limit-addon-inc/dec-*`, qty `text-limit-addon-qty-*`, "managed in Billing" link | steppers + link | Same POST /api/stripe/addons flow as Billing (with the same release-confirm dialog for number add-ons); hidden entirely for platform admins; "Coming soon" badge for preview add-ons (steppers disabled) | limits-usage.tsx:396-448 | POST /api/stripe/addons; GET /api/stripe/addons/release-preview | browser (hidden for admin); flow verified on Billing | OK |
| "Monthly counts reset November 1." `text-limits-resets` | text | Reset line (UTC) + Agency per-location growth note + admin explanation | limits-usage.tsx:342-347 | resetsAt() | browser | OK |

## api keys (ApiKeysPanel in the shell; tabs version in client/src/pages/settings/api/index.tsx)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Your data, your tools" alert `banner-api-no-ai` + `link-api-docs` | banner + link | The API-never-generates notice (verbatim on every API surface) + link to /developers (API reference) | client/src/pages/settings/api/api-keys-panel.tsx:115-124 | — (/developers route, App.tsx:235) | browser | OK |
| Quota card `card-api-quota` "API units this month" `text-api-quota` + bar + `text-api-rate` | card + meter | Plan-wide units used this UTC month vs allowance; bar for finite limits; unit-cost and per-key rate copy; exhausted note (429 until reset) | api-keys-panel.tsx:265-289 | GET /api/account/api-keys → plan.usedThisMonth (unitsThisMonth, server/account/api-key-routes.ts:152) | browser ("69 used · fair use") + SQL (69 ✓). Minor: admins see "fair use" though their −1 means unlimited (see bugs) | OK |
| Upgrade card `card-api-upgrade` + "See plans" `button-api-upgrade` | card + button | Starter (0 units): explains API starts with Pro; button → /pricing | api-keys-panel.tsx:132-147 | plan.apiEnabled from apiAllowance (api-key-routes.ts:60) | code only (admin has API on) | OK |
| "Generate API key" `button-generate-key` | button | Opens the generate dialog; disabled when the plan has no API | api-keys-panel.tsx:155-157 | — | browser | OK |
| Key table `table-api-keys` / phone cards `list-api-keys` | table/list | One row per ACTIVE key: title, masked key (chub_prefix…suffix), scope badges, units this month, limit ("Plan" or number), added, last used, expires; revoked keys are not listed | api-keys-panel.tsx:166-221 | GET /api/account/api-keys → `account_api_keys WHERE user_id=1 AND revoked_at IS NULL ORDER BY created_at DESC` + per-key month units | browser (empty for user 1 — all 5 existing keys are revoked ✓ SQL); full row via live create below | OK |
| Row menu `button-key-menu-*` → Rename / Set monthly limit / Revoke… | menu | Rename → PATCH {name}; limit → PATCH {monthlyUnitLimit|null}; revoke → confirm dialog then DELETE | api-keys-panel.tsx:306-325 | PATCH /api/account/api-keys/:id (api-key-routes.ts:288); DELETE (…:316, sets revoked_at — row kept for history) | browser (rename + limit + revoke exercised on an AUDIT- key; row updated then gone) | OK |
| Generate dialog `dialog-generate-key` (title input `input-key-name`, scope checkboxes `checkbox-scope-read|write`, limit `input-key-limit`, expiry select `select-key-expiry`, submit `button-generate-submit`) | dialog + form | Creates the key: name (1-80), ≥1 scope, optional per-key monthly cap (≤ plan units), expiry 30/90/365 days/never. Create is step-up protected: 403 reauth → verification dialog → retry | api-keys-panel.tsx:327-400 | POST /api/account/api-keys → api-key-routes.ts:245 → createApiKey (server/account/api-keys.ts; max 25 active keys) + security event (activity log + notification + email); secret returned once, written past the JSON logger | browser end-to-end: reauth via emailed code from the local sink → key shown once → row appears with expiry 2027-10-04 (365 d ✓) | OK |
| New-key dialog `dialog-new-key` (`text-new-key`, copy `button-copy-key`, Done) | dialog | The one time the full key is visible; copy button; closing forgets it | api-keys-panel.tsx:403-434 | — | browser | OK |
| Revoke dialog `dialog-revoke-key` ("Keep key" / "Revoke key") | alert dialog | Confirms; revoke stops the key immediately (401 for callers) | api-keys-panel.tsx:239-259 | DELETE → revoked_at=now(); security event | browser (revoked AUDIT- key; keys list empty after ✓, usage history kept the key id) | OK |
| Rename dialog `dialog-rename-key`, Limit dialog `dialog-limit-key` | dialogs | PATCH name / monthly cap; blank limit = plan allowance; client-side cap ≤ plan units | api-keys-panel.tsx:441-496 | PATCH | browser (both exercised) | OK |
| Empty state `text-api-keys-empty` | text | "No API keys yet…" (or "No API keys on this account." when the plan lacks API) | api-keys-panel.tsx:160-163 | — | browser | OK |
| Loading/error `text-api-keys-error` | states | — | api-keys-panel.tsx:129 | — | code only | OK |

## api usage (ApiUsagePanel)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "API usage" card `card-api-usage` + description | card | Units and requests per day for the last 30 days, stacked by key | client/src/pages/settings/api/api-usage-panel.tsx:63-67 | — | browser | OK |
| Stat tiles `text-usage-total-units`, `text-usage-total-requests`, `text-usage-active-keys` | stats | Totals over the window; "Keys used" = keys with any use in the window (revoked keys still count) | api-usage-panel.tsx:75-79, 58-59 | GET /api/account/api-usage?days=30 → usageSeries (api-key-routes.ts:162): `account_api_usage WHERE user_id=1`, zero-filled `generate_series(CURRENT_DATE-29, CURRENT_DATE)` | browser (69 / 69 / 5) + SQL (69 units, 69 requests, 5 keys on 2026-10-01 ✓) | OK |
| Bar chart `chart-api-usage` | chart | One stacked bar per day, one colour per key; legend names keys (revoked ones read "Revoked key abc123") | api-usage-panel.tsx:86-95 | same endpoint (by_key per day) | browser (single Oct 1 bar, 5 legend entries "Revoked key …") | OK |
| Day table `table-api-usage` / phone list `list-api-usage` | table/list | Newest first: day, requests, units, per-key breakdown ("Name (chub_…): N · …") | api-usage-panel.tsx:97-133 | same endpoint | browser (Oct 1: 69/69 with per-key breakdown matching SQL by-key sums 1/59/3/3/3) | OK |
| Empty state `text-api-usage-empty` | text | No API calls in the last N days | api-usage-panel.tsx:80-84 | — | code only (data present) | OK |
| Loading/error `text-api-usage-error` | states | — | api-usage-panel.tsx:69-72 | — | code only | OK |

## Cross-checks against SQL (dev user 1)

- `subscriptions`: one row, plan `standard` (legacy → Starter), status `active`, no Stripe ids, no
  period end → statement shows "Standard/Active", interval/start/next "—", legacy price note ✓.
- `business_locations`: 2 rows → UsageCard "2 · unlimited", limit-locations "2 used" ✓
  (billed count for Agency pricing would be 1 distinct `gbp_location_name` — not shown for this user).
- `growth_budgets` (2026-10, period '0'): siteScans 16, texts 313; searches/rankings/competitorScans
  absent → 0. Every meter on both pages matches ✓.
- `billing_invoices` / `billing_purchases`: 0 rows for user 1 → both empty states ✓. List endpoints
  filter `user_id=$1` (cursor resolved in the same scope — no cross-account window) ✓ code.
- `account_api_keys`: 5 rows, all revoked → key list empty; `account_api_usage` October: 69 units /
  69 requests across 5 key ids → quota "69 used", usage stats 69/69/5, by-key sums match per-key ✓.
- CRM seats: 4 distinct holders (u:1 across 4 orgs + 3 invited emails) → "4 used" ✓.
- review-templates: 1 → "1 used" ✓; click-guard domains: 12 → "12 used" ✓.
- POST /api/stripe/create-portal on dev: 400 "No subscription found" (no Stripe customer; Stripe off
  on dev — expected); the portal button path verified by code and by the mocked e2e.
