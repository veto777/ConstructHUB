# Pricing — how the price book drives the product

The owner-facing runbook for the ConstructHUB price book: where every plan
price and limit lives, how the pricing page and the plan-matrix doc are
derived from it, and how a change ships safely.

## The one source of truth

- **Platform plans (Business Tools): `shared/plans.ts`** — `PLANS`, `PLAN_KEYS`,
  `ADDONS`, `COMING_MODULES`, `CALL_ASSISTANT_TIERS`. Money is in cents.
- **CRM plans: `shared/crm-plans.ts`** — `CRM_PLANS`, `CRM_ADDONS`, the extra
  seat price. The CRM is a separate product: no platform plan grants CRM
  seats and no CRM plan grants platform tools.
- **The AI Call Assistant** is a separate service on its own subscription —
  no plan includes it.

### Plan keys never change

Stored subscriptions, Stripe metadata and the founding-member snapshot all
key off plan **keys**. A key is permanent; only the display `name` (and the
prices/limits) may change. The current ladder (2026-10-09, cost-based):

| key       | name (display) | monthly |
| --------- | -------------- | ------- |
| `starter` | Solo           | $29     |
| `team`    | Team           | $49     |
| `pro`     | Pro            | $99     |
| `growth`  | Agency         | $199    |
| `agency`  | Unlimited      | $449    |

Renaming a plan customers see = edit `PLANS[key].name` only. Never rename a
key, never reorder `PLAN_KEYS` (cheapest first is the upgrade order).

## Change a price or a limit

Edit **only `shared/plans.ts`** (or `shared/crm-plans.ts` for the CRM):

- A plan's price: `monthlyCents` / `annualCents` (annual is `ANNUAL_MONTHS`
  × monthly = 10×, two months free, for plans and platform add-ons; the CRM
  and the Call Assistant have their own yearly multiples).
- A limit: the `limits` block of the plan (a `-1` means unlimited, fair use).
- An add-on: the `ADDONS` record (`availableOn` is which plans can buy it,
  `grants` is what one unit adds, `preview: true` lists it as coming soon and
  refuses checkout until you drop the flag).
- A module (a yes/no feature): `PlanModules` + the plan's `modules`, and add
  the key to `COMING_MODULES` while it is promised but not live.

**Founding members keep their price for life** (`shared/pricing-terms.ts`):
never read `PLANS[plan].monthlyCents` at billing time — read
`foundingPrice(terms, plan, interval)`. Changing a price never moves a
founding member; the snapshot taken at join is what they pay.

There is **no per-location pricing and no extra-location add-on** (retired
2026-10-09). Outgrow a plan → move up. The legacy `AGENCY_LOCATION_BANDS` /
`extra_location` records stay in `shared/plans.ts` only so stored old
subscriptions still read and bill as they did.

## The comparison tables: `shared/plan-matrix.ts`

`shared/plan-matrix.ts` is the ONE source behind the comparison tables on
`/pricing` (both tabs) **and** `docs/pricing/PLAN-MATRIX.md`. Every cell is
derived from `PLANS` / `CRM_PLANS` / `ADDONS` — never type a number into a
table.

- **Add a row:** add one entry to the row list in `businessToolsMatrix()` or
  `crmMatrixRows()` (a `key`, a `label`, and a `cell: (plan) => …` that reads
  the price book).
- **Mark a row Coming:** set `coming: true` on the row (renders a Coming
  badge; used today for scan & ranking history, whose retention is not
  enforced yet). A module in `COMING_MODULES` renders as Coming on the plans
  that promise it (today: CSV export and permit alerts) — on the comparison
  table, the plan cards and the checkout purchase review alike. The cards and
  the review badge a plan bullet through `FEATURE_BULLET_MODULE` /
  `isComingFeature` (shared/plans.ts), one map derived from `COMING_MODULES`:
  when a module ships and leaves `COMING_MODULES`, its badge disappears from
  every surface at once. (Scheduled client email reports shipped 2026-10-09 —
  server/seo/site-report-send.ts — so it is a plain ✅, not Coming.)
- Cell values: `true` / `false` / a number / `"unlimited"` (use the `count()`
  helper for any `-1` limit) / a short string / `{ coming: true }`.

After any price-book change, regenerate the doc:

```sh
npm run pricing:matrix   # tsx script/pricing-matrix-md.ts → docs/pricing/PLAN-MATRIX.md
```

Commit the regenerated `PLAN-MATRIX.md` with the price-book change. The
header dates it; the doc says "do not edit by hand" and means it.

## Stripe: nothing to do by hand

Stripe Prices are **auto-created by lookup key** at checkout
(`server/billing/prices.ts`): `chub_plan_<plan>_<interval>_<cents>` and
`chub_addon_<addon>_<interval>_<cents>`. A new cents value makes a new Stripe
Price on the next checkout — no Dashboard work, no seed script. The lookup
key carries the cents, so old subscriptions keep billing their old price
until they change plans.

## The founding-offer switch

The founding-member offer is opened/closed from the admin surface
(`POST /api/admin/founding-offer { open }`, card at
`GET /api/admin/founding-offer`; storage and rules in
`server/billing/pricing-terms.ts`). The public pricing page shows the line
only while the server says open — never hard-code it, never snapshot it.

## Tests to run after a price-book change

```sh
npx tsc                        # must be clean
npx vitest run server/pricing-copy.test.ts server/client-plan-ui.test.ts server/pricing-display.test.ts
npm run pricing:matrix && git diff --exit-code docs/pricing/PLAN-MATRIX.md  # doc is current
npx vitest run                                               # the whole unit suite, before merging
```

`server/pricing-copy.test.ts` checks every page, prompt and email against the
price book; `server/client-plan-ui.test.ts` checks the client helpers and
copies; `server/pricing-display.test.ts` checks the display helpers against
`shared/plan-matrix.ts`. The Playwright lanes (`e2e/pricing.spec.ts`,
`e2e/pricing-copy.spec.ts`, configs `playwright.pricing*.config.ts`) run
against a lane dev server (`npm run e2e:lane`).

## Shipping it (deploy rule)

This branch (`pricing/rebuild-ui`) is UI + docs; the price book itself is
`shared/plans.ts` on the rebuild branch. When the rebuild is approved:

1. Merge to **main** (the release worktree `~/ConstructHUB-release`), never
   deploy from a lane worktree.
2. Deploy with `script/deploy-vb11.sh` (build on the tower, rsync `dist/` to
   vb11, restart `constructhub.service`; the script takes the pre-deploy dump
   and skips the restart when nothing changed).
3. Watch the first checkout: the new cents create new Stripe Prices by lookup
   key, and `/admin/issues` + the request log should stay quiet.

Never merge or deploy from this worktree — Lane B only changes client,
shared, docs, scripts and tests.

## Deploying a new price book

Founding members lock the prices of the book that was in force when their
subscription **started**, not when a webhook was processed
(`shared/pricing-terms.ts`, `priceSnapshot(startedAt)`).

When a new ladder goes live:

1. In the deploy commit, set `FIVE_PLAN_PRICE_BOOK_EFFECTIVE_AT` (or the next
   dated book's boundary) to the production deploy time in UTC.
2. Keep the previous book frozen as a dated constant; never edit it.
3. Existing snapshots are never rewritten.

