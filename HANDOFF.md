# ConstructHUB — Handoff

_Last updated 2026-08-24. Repo: `veto777/ConstructHUB` (private). Local: `/home/veto/ConstructHUB` on the tower._

## 💳 2026-10-09 — refunds and disputes on SEO credit packs now reach the wallet (review M-3, branch `fix-review-high`, NOT deployed)

> **OWNER/OPERATOR ACTION: enable these event types on the live webhook endpoint** (Stripe Dashboard → Developers →
> Webhooks → the constructhub.us endpoint → "Select events"). Until they are enabled nothing below runs and the credit
> behaves exactly as before (no error, no change) — but a refund or chargeback then still leaves the credit in place.
> - `charge.refunded`
> - `charge.refund.updated`
> - `charge.dispute.created`
> - `charge.dispute.updated`
> - `charge.dispute.closed`
> - `charge.dispute.funds_withdrawn`
> - `charge.dispute.funds_reinstated`
> - `checkout.session.async_payment_failed`
> - `checkout.session.async_payment_succeeded` (bank debits are credited on this one — check it is on too)
> No new secret or env var: the same endpoint and signing secret (the webhook still verifies the raw body and fails closed).

- **What was wrong:** the webhook credited a pack once paid and never looked again. A refund or a chargeback left the credit
  in the wallet to keep or spend; Stripe took the money (and a dispute fee) back.
- **Now (`server/seo/credit-reversals.ts`, called from the webhook switch in `server/stripe.ts`):** every pack is found by its
  PaymentIntent (stored at purchase from now on; older packs are found through their checkout session and backfilled).
  Refund, full or partial → the same share of the credit is taken back; a refund that later fails gives it back. Dispute opened →
  the disputed credit is put **on hold** (cannot be spent); won → released; lost → removed. A failed bank debit was never credited
  (credit is granted only once Stripe says paid); one that somehow was is taken back. Each is read from Stripe as it is now, so
  duplicate and out-of-order events move nothing twice. A refund for a pack not credited yet is retried (400), never skipped.
- **Credit already spent:** the rest is recorded as **owed** (`seo_credit_wallets.owed_cents`). While anything is owed, lookups that
  cost credit are refused — the month's allowance included — and the SEO pages and Settings → Limits & usage say why in plain
  words; the next pack bought settles it first. Every movement is a row in `seo_credit_ledger` with the Stripe event, object and
  PaymentIntent ids. A dispute raises an ops issue (critical when it opens). Prices and packs are unchanged; the credit checkout
  now also tags its PaymentIntent with the pack's metadata.
- **Schema:** added at boot by the SEO schema (`CREDIT_SCHEMA_DDL`): wallet `frozen_cents` / `owed_cents`, purchase
  `stripe_payment_intent` / `refunded_cents` / `disputed_lost_cents` / `reversed_at`, tables `seo_credit_disputes`, `seo_credit_ledger`.
- **Not done:** packs refunded or disputed BEFORE this ships are not looked at again (no backfill job); check the Stripe
  dashboard's refunds/disputes for `ConstructHUB SEO data credit` payments since 2026-10-07 and adjust by hand if any exist.

## 🪑 2026-10-09 — the support line can no longer take customers' Call Assistant seats (review S-2, branch `fix-review-high`, NOT deployed)

- **What was wrong:** support calls and customers' Call Assistant calls shared the engine's 6 seats (`VOICE_MAX_ACTIVE_CALLS`). Six
  calls to the public support number filled them; a customer's call was then answered "we can't take your call right now" and hung up.
  Worse, the public `/media` socket took a seat the moment it connected — before proving it was a call — so six idle sockets did the
  same with no phone at all. A dead stream (no audio from the carrier) kept its seat until the 15-minute cap.
- **Which path is live (from the code, not from prod env):** the support number's voice URL is the GPU engine (`voice/server.py`,
  profile `kind: "support"`); the keypad line in the app (`/api/support/ivr`, also the old `/api/support/voice`) is the overflow and the
  number's fallback. The spoken LaML Gather line of 10-08 no longer exists in the code — there is nothing else to fix.
- **Now (`voice/server.py` `seats()` / `seat_free()` / `reap()`):**
  - One pool of seats, two budgets. The support line may hold at most `VOICE_SUPPORT_MAX_CALLS` (default **2**, never all of them);
    every other seat can only go to a customer's call. **This changes the owner's 10-08 rule "the 7th caller goes to the keypad line":
    it is now the 3rd support caller** (set `VOICE_SUPPORT_MAX_CALLS` higher to give support more, at customers' expense).
  - Support calls per hour: 4 per caller number, 40 overall (`VOICE_SUPPORT_CALLS_PER_CALLER_HOUR`, `VOICE_SUPPORT_CALLS_PER_HOUR`;
    in the engine's memory — a restart forgets them, the seat cap still holds). Over any limit → the keypad line, no seat.
  - A support call ends at 8 minutes (`VOICE_SUPPORT_MAX_CALL_SECONDS=480`) with a spoken wrap-up, and after 60 s without a word
    from the caller (`VOICE_SUPPORT_IDLE_SECONDS`). The hang-up never waits on the goodbye being spoken.
  - A `/media` socket holds no seat until its `start` is accepted, must start within 10 s, and waiting sockets are bounded.
  - A reaper (every 5 s) frees every stuck seat: no audio for 45 s (`VOICE_ZOMBIE_SECONDS`), past the time cap, a wrap-up or the
    after-call paperwork that never finishes, a set-up that never greeted. The carrier's status callback (completed / failed /
    no-answer…) frees the seat at once. After-call paperwork now survives the connection being dropped.
- **Operator:** nothing is required — the defaults apply on the next engine deploy (`voice/deploy/restart-when-idle.sh`). The engine's
  `/health` (with the bearer) shows the support settings. Engine tests: `cd voice && .venv/bin/python -m pytest selftest -q` (101).
- **Left as found (separate review items):** the keypad line itself has no cap on calls at once or per caller (S-11), and the
  per-account code budgets can be used up by a stranger (S-10).

## ☎️ 2026-10-08 (late evening) — the AI Call Assistant is a SEPARATE SERVICE, repriced (branch `billing/call-assistant`, NOT deployed)
- **Owner decisions:** the Call Assistant is sold on its **own subscription**, like the CRM (`fd964e1`, `069ffdf`): no platform plan
  includes it, and it is bought **with or without a platform plan**. New tiers (keys lite/solo/crew/fleet kept so the voice code paths
  stand; names and numbers new): **500 minutes $249/mo (1 number) · 1,000 minutes $349/mo (1 number) · 2,000 minutes $449/mo
  (2 numbers) · 5,000 minutes $999/mo (5 numbers)**. **Overage 50¢ a minute on every tier** (the 10¢/5¢ rates were below cost).
  **Yearly = 11 × monthly** (one month free — a smaller discount than the plans' 10 ×; `CALL_ASSISTANT_ANNUAL_MONTHS`) for the four
  tiers; the extra number is unchanged at $5/mo, $50/yr (10 ×). **No intro offer** (the $99 × 3 Solo intro is gone; `server/billing/intro.ts` stays for the grants it
  recorded and is inert — `intro.test.ts` pins that). **More than 5,000 minutes = "Talk to a sales rep"**, never a listed price. Nobody
  held a tier in production (0 rows), so nothing is grandfathered. **Not part of the founding member price lock** (plans + Agency bands
  only; said in `shared/pricing-terms.ts priceSnapshot` and `founding-baseline.test.ts`).
- **How it works:** `call_assistant_subscriptions` (one row per account; DDL in `server/voice/subscription-store.ts`, listed in
  `scripts/apply-schema-migration.ts`, created on first use). Routes `server/voice/subscription.ts`: `GET /api/call-assistant/billing/plans`,
  `GET …/subscription`, `POST …/checkout` (Stripe Checkout on the same customer, `metadata.product = "call_assistant"`, no trial, no
  coupon), `POST …/change` (tier / interval / extra numbers re-priced in place, prorated, `error_if_incomplete`, then the number-release
  decision). Prices are the existing add-on Prices found/created by lookup key from the cents (`chub_v1_addon_call_assistant_*_<cents>`),
  so the new cents made new Stripe Prices on the first checkout — no manual Stripe work. The webhook (`server/stripe.ts`) hands every event
  for one (`isCallAssistantSubscription`: `metadata.product`, or a tier line with no plan line) to `applyCallAssistantSubscription` /
  `endCallAssistantSubscription` and then `afterSubscriptionChange` (numbers released when it ends, past_due only pauses — unchanged
  rules); the platform checkout ignores these subscriptions (never "has_subscription", never withholds the trial) and refuses the Call
  Assistant's add-on keys (`availableOn: []`, `checkAddonsForPlan`). `getEntitlements` joins the row into the one account query
  (`call_assistant_*` columns): `addonModules.callAssistant` is on while THAT subscription holds a tier and is active/trialing, paused on a
  payment-needed status, and its tier + extra numbers are merged into `ent.addons`, so `callAssistantAllowance`, the meter
  (`billing-usage.ts`, overage now billed on the Call Assistant's own subscription), number release (`numbersKeptFor` reads the service's
  row) and every voice route work as before. A Call Assistant key left on a platform row grants nothing (`withoutCallAssistantAddons`).
  The CRM-plan gate no longer covers `/api/crm/voice/*` (the service gates on its own subscription). 402 without it is now
  `call_assistant_required` (+ `href: /pricing#call-assistant`), not `plan_required`.
- **Copy:** every plan (platform and CRM) carries "The AI Call Assistant — … (a separate service, from $249/mo)" in `notIncluded`;
  Pricing has its own `#call-assistant` section (`CallAssistantPlanCards`: review dialog → checkout, switches in place); Settings → Billing
  has a Call Assistant card (tier picker, extra numbers, cancel via the portal); `/call-assistant`, the Hub pack (section 30 "a separate
  service", `output-filter` refuses "an add-on to the … plan" / "the … plan includes the Call Assistant" and every old amount),
  help, dashboard lock ("Separate service", no required plan), Terms, `docs/brand/FACT-BASE.md`.
- **Judgment calls to confirm with the owner:** tier names are the minutes ("500 minutes" …) — the brief said names change but gave none;
  the extra number's yearly price stays the old contract's $50/yr (10 ×; the repricing named the four tiers only — audit #4 put it back
  from the $55 the first pass had set); the service has NO trial (it costs real minutes); a Call Assistant customer
  without a CRM plan can run the assistant (leads are still filed into their org's CRM data; the Calls tab shows every call).
- **Codex audit #1 fixes (2026-10-09, `callassist-audit-1.md`):** (1) one live subscription per account under a race — the open
  Checkout Session id is kept on the row (`open_checkout_session_id`, additive ALTER in `CALL_ASSISTANT_SUBSCRIPTION_DDL`) and re-read by
  id before another checkout (finished → it is the subscription, open → reused or expired first; an expire that fails means it just
  completed), Stripe's lists are paginated, and a second LIVE subscription the webhook sees never replaces the tracked one: it is
  cancelled at Stripe when it is ours (`subscriptions.cancel` with `prorate` + `invoice_now` — the unused time becomes customer credit,
  never a refund by itself) and logged + recorded as an ops issue either way. (2) Overage never lost: ending a subscription settles every
  outstanding month first (`settleVoiceOverageForAccount`, before the tier is cleared), an ended subscription's minutes are billed to its
  customer as an item invoiced right away (the row keeps its customer/subscription ids), and the sweep covers EVERY finished month.
  (3) Gabe's daily token cap is durable and atomic: `hub_usage_days` (day PK; one conditional upsert reserves prompt-estimate + max_tokens
  BEFORE dispatch, settled to the provider's counts after; timeouts keep the reservation; the cap can be overshot by at most one
  reservation). (4) Output filter: a Call Assistant price is bound to the service and its tier (any other amount in a Call Assistant
  sentence, a tier at another tier's price, a priced tier above 5,000 minutes → O9); spelled-out and subject-first customer counts → O10.
  (5) OpenAI model allowlist enforced in every environment (TruthCoder dev behaviour unchanged). (7) The admin checkout test uses a real
  admin fixture and asserts zero Stripe calls. (8) SPEC §14 / ui-map / this file: old tiers marked historical.
- **Codex audit #2 fixes (2026-10-09, `callassist-audit-2.md`) — the cure for every check-then-write is `server/billing/locks.ts`**
  (the SEO lane's advisory-lock sections lifted as a generic copy: `withCallAssistantLock(userId, fn)` = `pg_advisory_xact_lock` on a
  dedicated pooled connection, savepoints for nesting, `BillingBusyError` 503 on contention; same tests in `server/billing/locks.test.ts`).
  (1) The checkout route, the webhook handlers for the service, the duplicate reconciliation and every overage claim run under that
  lock; each checkout attempt is persisted first (`open_checkout_attempt_id/_order`) with a stable Stripe idempotency key
  (`chub-ca-checkout-<attempt>`); a duplicate whose cancellation fails is remembered on the row (`duplicate_subscription_id`,
  `duplicate_retry_needed`), recorded as a critical ops issue and THROWN — the webhook answers 400, its ledger claim is released and
  Stripe retries; `retryDuplicateCancellations` runs at boot + every 6 h (`startCallAssistantReconcileWorker`). (2) Overage is claimed
  before it is billed: `voice_overage_claims` (one row per org-month-rate range, UNIQUE on the range start, state pending → queued →
  invoiced / failed-retried-as-is, keeps the Stripe item/invoice ids); the monthly report, the sweep and settle-on-end all go through
  `reportVoiceOverage` → claims, so two settlements never bill overlapping minutes; "queued" (item on the subscription's next invoice)
  and "invoiced" are tracked apart, and ending the subscription invoices every queued claim now on the kept customer
  (`invoiceQueuedVoiceOverage`). (3) The token cap admits a reservation only when `existing + reservation ≤ cap` (the first of the day
  included; one conditional `INSERT … SELECT … ON CONFLICT … WHERE`), the estimate is an upper bound (chars ÷ 2.5 + framing + max_tokens);
  `server/hub/store.test.ts` proves it against real Postgres with 10 parallel reservations. (4) Output filter: the service's context
  carries under a "Call Assistant" heading and into "It costs …" sentences, the dash form ("10,000 minutes — $999/month") is bound, the
  extra number's $5/month, $50/year count only in the extra number's own clause (audit #7: every amount in a Call Assistant
  sentence is bound to the product clause it sits in — a plan, the CRM, an add-on, the extra number) and the 50¢ only beside "minute", and "one"/"a single" count ("We have
  one customer"). (5) SPEC §20 intro bullet, ui-map pricing add-ons and the home-settings Call Assistant row carry supersession notes.
  Lane tests with the real lock: `server/voice/subscription-lock.test.ts` (two live subscriptions in parallel → one tracked, one
  cancelled; a failed cancel remembered, thrown and retried) and `server/voice/billing.test.ts` (concurrent settle → one claim; a late
  call → only the delta; a failed claim retried as is; a queued claim invoiced at the end).
- **Codex audit #3 fixes (2026-10-09, `callassist-audit-3.md`) — one pattern for every crash window: claim under the lock → the
  Stripe call outside it → record the outcome under the lock, and reconcile an uncertain outcome against Stripe before ever creating
  again.** (1) Every subscription transition is `syncCallAssistantSubscription`: resolve the account → take the shared lock → read
  the subscription from Stripe INSIDE it → apply the whole transition (a stale "active" behind a cancellation never restores
  access); the webhook, the change route and the checkout's "finished session" path all go through it. (2) `voice_overage_claims`
  is the unit of work and carries everything immutable (customer, subscription and interval as of the claim, rate, minutes,
  idempotency key; the claim id goes into the Stripe item's metadata); the claim and the meter marker are one transaction
  (`reported` = claimed); Stripe is called outside the lock with the claim's own parameters; a claim left `creating` is reconciled
  by reading the customer's invoice items for its id before anything is created; a lease (`leased_until`) keeps two processors off
  one claim; a CHECK on the range plus an overlap check in the claim function sit beside the UNIQUE. (3) An end is recorded in the
  same transaction as a `voice_settle_jobs` row; the job (`runVoiceSettlement`) claims every outstanding month invoice-now on the
  job's customer, re-aims the subscription's unfinished claims, invoices every queued claim, and is retried by every sweep
  (`sweepVoiceOverage`: finished months, unfinished claims, orphaned queued claims → jobs, pending/failed jobs); a failed settlement
  is recorded on the job + ops issue, never swallowed. (4) Bounded: Stripe client `timeout` 20 s (`STRIPE_TIMEOUT_MS`), the
  in-process billing queue waits 30 s at most (503 `billing_busy`), lock sections do database work only. (5) No tokenizer package
  is installed, so the reservation is a documented bound — half a token per ASCII byte, a whole token per every other byte
  (the byte-fallback worst case), + 32 framing + max_tokens (≥ chars ÷ 2) — and a settlement above the reservation is counted. (6) Filter: the service's section survives blank lines until another heading-like
  line; "one paying/active/happy customer" is refused. (7) ui-map landing/hero price lines marked historical; this file's cap text.
- **Codex audit #4 (2026-10-09, `callassist-audit-4.md`) — the last round, and the SAFETY SWITCH.** `CALL_ASSISTANT_OVERAGE_BILLING`
  = `on` | `off`, **default OFF**: minutes and overage are metered and shown (Limits & usage, the billing card says "Minutes above your
  plan are not charged yet", the admin card), but no Stripe item or invoice is ever created and no settlement job runs — the minutes
  stay on the meter (`voice_usage.overage_minutes` above `overage_reported_minutes`: NO claim is created while off) and a
  subscription's end still writes its settlement job, which waits; turning the switch on and restarting starts the backlog sweep
  (10 minutes after boot, then every 6 h) that claims and bills them. Tier subscriptions, checkout and entitlements are not
  affected. Why off: the overage machinery is the part of this work the audits kept finding holes in; the owner can go live on the
  tiers alone and switch overage on once the sweep has been watched on real invoices. One boot line names the state.
  Fixes: (1) a checkout or tier change is an ATTEMPT ROW (`call_assistant_checkout_attempts`, one in flight per account by a partial
  unique index, taken under the account lock with its Stripe idempotency key, Stripe outside the lock, completion conditional on the
  attempt's id + state; a competing request resumes the same session or gets 409 `checkout_in_progress`). (2) Claim reconciliation
  reads every page and FAILS CLOSED (`reconcile_incomplete`, the claim waits); the claim's UUID is in the item's metadata and an item
  is adopted only when customer, subscription, org, month, quantity, rate, kind and UUID all match. (3) Claims and settle jobs are
  scoped to the subscription they were created under (`voice_usage.stripe_subscription_id` records the month's latest subscription;
  a settlement claims only its own subscription's months and claims; `billed_on_customer` is separate from the origin id, which is
  never changed). (4) Settle jobs are leased atomically with a token that fences stale writes, complete only when every claim of the
  subscription is verified invoiced and no month is outstanding, and are append-only (new work → a new job); `markInvoiced` marks only
  the claims whose items the invoice's own lines carry (`invoices.listLineItems`). (5) One row per duplicate subscription
  (`call_assistant_duplicate_cancellations`), each completed by its own id. (6) CHECKs: `minutes = to − from`, `rate > 0`; an EXCLUDE
  constraint on overlapping ranges per (org, month, rate) via `btree_gist` when the database user can create the extension (the
  throwaway test DB user can; on vb7 the boot DDL tries and the admin card reports whether it is in place; the application check stands
  either way). (7) Token reservation = one token per UTF-8 byte + 8 per message + max_tokens. (8) Filter: the service stays the subject
  across paragraphs until another product is named or a heading changes the subject; "one local/new/first customer" refused.
  (9) Extra number yearly back to $50. (10) This section.
  **What the tests prove, and what they do not.** Proven (lane DB, real advisory lock, a fake Stripe that models invoice membership and
  item listing): two live subscriptions arriving together leave one tracked and one cancelled; a stale "active" behind a cancellation
  never restores access; a failed duplicate cancellation is persisted, thrown and retried; two reports of one month at once create one
  claim and one item; a late call bills only the delta; a failed claim is retried as it is; a claim sent before and left without its
  item adopts the matching item at Stripe and never creates a second; a retry bills the claim's stored subscription; an ended
  subscription's queued claims are invoiced on its customer from the invoice's lines; a failed settlement is recorded and finished by
  the sweep; the token counter never passes the cap at admission (10 parallel reservations). NOT proven: behaviour against real Stripe
  (idempotency-key expiry, pagination at scale, invoice line shapes beyond the pinned API version); that the token reservation is a
  strict upper bound for every input (one token per byte is the byte-level BPE property, not a measured count — no tokenizer is
  installed); that the EXCLUDE constraint exists on vb7 (depends on `btree_gist`); and nothing here certifies that unrelated prices are
  byte-for-byte unchanged beyond `founding-baseline.test.ts`. The duplicate's first payment is credited, never refunded, by this code.
- **Codex audit #5 (2026-10-09, `callassist-audit-5.md`) — the service SHIPS with overage billing OFF.** Fixed: (1) the fresh-schema
  blocker — the claims CREATE TABLE named `minutes` in a CHECK before the column existed, so a new database stopped creating the voice
  schema (no `voice_usage.stripe_subscription_id`, no settle jobs: metering broke even with billing off); the CREATE now declares every
  column it constrains, the ALTERs come first and the constraints last, the lazy schema helpers rethrow (the boot logs it loudly), and
  `server/voice/fresh-schema.test.ts` creates the schema on an EMPTY throwaway database and meters one call end to end. (4) A change
  attempt left `creating` is reconciled against Stripe (applied → closed; not applied → resumed under its own key); only a definite 4xx
  closes an attempt as failed, a timeout leaves it `creating`. (5) A checkout whose `creating → open` write loses rereads the attempt
  and returns the recorded session (never expires it); stale-session cleanup skips the attempt's own session (its metadata names the
  attempt). (9) Metering is a per-call record (`voice_call_meter`, keyed by the call): written before the call is marked processed,
  moved to `done` in the same transaction as the count (exactly once), a failed meter stays pending (`flags.meterPending`) and the
  metering retry worker (every 15 min, independent of the overage switch) finishes it. (8) Filter: list markers are consumed before
  the subject is tracked; a service price must match its billing unit ("$249/year" refused). (10) Activation: the switch on + Stripe
  configured is all the sweep needs; `VOICE_OVERAGE_WORKER_ENABLED=false` is only a kill switch.
  **Call Assistant overage: NOT PROVEN — keep `CALL_ASSISTANT_OVERAGE_BILLING=off`.** Open, in the auditor's words:
  · #2 "Settlement changes a previously attempted Stripe request before reconciliation. `billed_on_customer` is changed and also
    overridden in memory. If Stripe created a subscription-bound item but its response was lost, reconciliation now expects an
    unattached item and rejects the original. Retrying uses the same key with different parameters; after key expiry, duplicate
    creation becomes possible. Fix: retain the original request immutably, reconcile it first, then perform a separately tracked
    settlement operation."
  · #3 "Deferred minutes can be assigned to a replacement subscription. The meter stores only the latest subscription for the entire
    org-month. Cancel A while OFF, buy B, then make another call: A's accumulated usage now names B. Even an untouched historical month
    is claimed using the account's current subscription. The sweep reports historical months before processing settlement jobs. A's
    job can therefore finish without settling A's usage. Fix: persist usage ownership per subscription/call and derive every claim from
    that immutable ownership."
  · #6 "Recorded jobs are not guaranteed exactly-once execution. Both enqueue and orphan recovery use INSERT … WHERE NOT EXISTS without
    an open-job unique index. Concurrent sweeps can create different jobs for the same subscription; their per-row leases do not
    exclude each other. Long jobs also have no lease renewal, and job fencing does not check whether its UPDATE succeeded. Fix: enforce
    one open job per subscription, renew leases, and stop work when ownership is lost. Make external effects idempotent rather than
    claiming exactly-once execution."
  · #7 "'Full-request matching' still trusts metadata for the rate. The check compares metadata and quantity, but never verifies the
    item's actual amount, currency or price. An item retaining the metadata after a price/amount edit is adopted as correct. Fix:
    persist and compare the actual Stripe price/request economics, not merely the descriptive metadata."
  Also open: turning ON does not guarantee exactly-once processing of recorded jobs, and Stripe keeps collecting items created during
  an earlier ON period. With the switch off none of these paths runs.
- **Checks:** `server/voice/addon.test.ts`, `server/voice/subscription.test.ts`, `server/stripe-billing.test.ts`, `server/pricing-copy.test.ts`,
  `server/hub/output-filter.test.ts`, `server/billing/prices.test.ts`, `server/billing/intro.test.ts`, `server/entitlements.test.ts`,
  `server/billing/founding-baseline.test.ts`; the lane-DB suites (`number-release`, `numbers`, `profile`, `calls`, `voice/billing`) were
  moved to the new table but not run here (no lane DB in the worktree).

## 🐊 2026-10-08 — Gabe on OpenAI (branch `hub/openai-provider`, NOT deployed; waits for the owner's key)
- **Why:** TruthCoder's GPU pods are down, so Gabe fails for everyone. Owner's decision 2026-10-08: run Gabe on
  OpenAI's cheapest model, switched by env only; TruthCoder stays the default and the other AI features are untouched.
- **Model:** `gpt-5.4-nano` (verified 2026-10-08 on OpenAI's model page developers.openai.com/api/docs/models/gpt-5.4-nano:
  default snapshot `gpt-5.4-nano-2026-03-17`, $0.20 / $1.25 per 1M input / output tokens, $0.02 cached input, reasoning
  effort "none" by default). The owner's fallback `gpt-5.4-mini` ($0.75 / $4.50) is on the pin too. Note: OpenAI's pricing
  page also lists the older `gpt-5-nano` at $0.05 / $0.40 — cheaper still; the owner named 5.4 nano, so that is the default.
- **Env to set on the server** (`.env`, then restart `constructhub.service`):
  `HUB_AI_PROVIDER=openai` · `HUB_OPENAI_API_KEY=<Gabe's own OpenAI key>` · optional `HUB_AI_MODEL=gpt-5.4-nano` (default;
  `gpt-5.4-mini` is the other accepted id; any other id also needs `HUB_OPENAI_MODELS=<comma list>` or Gabe stays off site)
  · optional `HUB_AI_DAILY_TOKEN_CAP=<prompt+completion tokens per UTC day>` (unset = off; durable and atomic: one row per UTC
  day in `hub_usage_days`, shared by every process and kept across restarts; a call reserves an upper-bound estimate before it is
  made and is admitted only while `existing + reservation ≤ cap`, then settles to the provider's counts). **Without the key Gabe is off site exactly as today** (chat says "Gabe is off site", presets serve
  templates) and no call is attempted. Boot logs one line `hub: provider openai model gpt-5.4-nano host api.openai.com key set|missing`.
- **Cost per question:** about 6,500 input + up to 400 output tokens → ≈ $0.0013 + $0.0005 = **≈ $0.002 (0.2¢)** on
  gpt-5.4-nano (≈ 0.7¢ on gpt-5.4-mini); at the global cap of 1,500 model calls a day that is ≤ $2.70/day (≤ $10/day on mini).
  Prompt caching may lower the input part. Each call logs `hub: usage in<prompt>-out<completion> <ms>` (counts only), and
  the admin page (/admin → Hub assistant) shows provider, model, key set/missing, chat on/off and today's token counts.
  A sensible cap: `HUB_AI_DAILY_TOKEN_CAP=3500000` ≈ 500 questions ≈ $0.90/day on nano.
- **Request shape on OpenAI** (server/hub/ai.ts `providerBody`): `max_completion_tokens: 400` + `reasoning_effort: "none"`;
  `temperature`, `top_p` and `stop` are left out because the GPT-5 family answers 400 to them on Chat Completions (a 4xx
  never opens the breaker, so Gabe would fail on every question). The TruthCoder request is byte-identical to before.
- **Switch back:** remove `HUB_AI_PROVIDER` (or set anything but `openai`), restart. The preset cache is keyed by model,
  so TruthCoder's cached answers are still there.
- **Tests:** `npx vitest run server/hub` (ai.test.ts: both pins, request shape per provider, usage counts, daily cap;
  routes.test.ts "cost guard"; output-filter.test.ts "OpenAI-style answers").

## 💲 2026-10-08 — SEO tools are Agency-only; grandfathering; founding member offer (branch `seo/pricing-a`, NOT deployed)
- **Owner decisions:** the SEO tools (site explorer, rank tracker, keyword research, backlinks) are included with **Agency only** for new
  sign-ups; everyone who has them today keeps them; a **founding member** offer locks a customer's plan price for life while the offer is open
  (no public number of places, no deadline — the owner closes it from `/admin` → "Founding member offer"). À la carte / an SEO add-on for other
  plans is NOT built and has NO price: do not invent one.
- **How it works:** `shared/plans.ts` `SEO_PLAN_LIMITS` is 0/0 on Starter/Pro/Growth (the gate is `seoKeywords !== 0`, `server/seo/plan.ts`);
  the old numbers live in `SEO_GRANDFATHERED_LIMITS`. `account_pricing_terms` + `pricing_settings` (`server/billing/pricing-terms-schema.ts`,
  listed in `scripts/apply-schema-migration.ts`). **At boot `server/index.ts` awaits `ensurePricingTerms()`** (`server/billing/pricing-terms.ts`,
  after `billingSchemaReady`, NOT inside it: a failure fails boot). It runs, in ONE transaction under an advisory lock, the two CREATE TABLEs
  and — once ever — the cutover: every account whose deciding subscription row is not over (a live Stripe sub incl. past_due, or an unexpired
  grant) gets `seo_grandfathered_at`; the marker `seo_agency_only_cutover` stores the transaction's `ranAt` and it never runs again. Then
  `reconcilePricingTerms` heals from stored `start_date`s. **Grandfathered ≠ founding:** only Stripe rows that were active, trialing or past_due
  at the cutover also got `founding_member_at` + `founding_prices`; grants and non-paying Stripe rows (incomplete / unpaid / paused) are
  grandfathered only. `getEntitlements` lays the grandfathered allowances over the account's current plan (`seoGrandfathered`, `foundingMember`).
  Every Stripe subscription write (`server/stripe.ts` `writeSubscriptionRow` → `noteSubscriptionTerms`) applies the same two rules by the
  subscription's **start date**: grandfathered when it started before `ranAt`; a founding member when it started inside one of the offer's open
  periods (`pricing_settings.founding_offer = { open, periods }`, closed/reopened from `/admin`) and is active or trialing when recorded — never a
  trial code or an admin grant. **No Stripe price, checkout amount or subscription changed**; `foundingPrice()` (`shared/pricing-terms.ts`) is what
  a future repricing must read before touching a founding member.
- **Deliberately not fixed (audit #2, 2026-10-08):** the owner's close is not serialized against a marking statement running in the same instant —
  at worst one extra founding member from that instant, never a lost one; and eligibility is "started inside an open period and active/trialing
  when recorded" — a sign-up whose first activation is recorded after the close still qualifies by its start, one cancelled before its first webhook
  gets no mark (nothing to lock). Both are written by `noteFoundingMember`.
- **Checks:** `script/seo-pricing-check.ts` (real Postgres); `server/billing/pricing-terms.test.ts`; `server/entitlements.test.ts`;
  `server/hub/output-filter.test.ts` (no SEO à la carte price, no founding count or deadline, no vendor name).
- **Owner-pending:** founding prices are stored but NOT yet read at checkout — by design, because no price has changed since the
  offer began. `server/billing/founding-baseline.test.ts` pins today's PLANS prices and the Agency bands and fails the moment one
  moves: before any price change, wire `foundingPrice()` (`shared/pricing-terms.ts`) into `server/billing/order.ts` (plan,
  interval and Agency-band quotes) and decide how a founding member's add-ons are priced. Also owner-pending: whether the offer's
  snapshot should ever be re-taken (today it is the price book at marking time, equal to the sign-up date's prices).

## 🧯 2026-10-07 (night) — all open issues fixed; Report an issue; issue desk runs the deployed code (deployed 2215501)
- **Why the bell was full:** the issue desk had written EIGHT fix branches (`issue/1,30,321,322,332,344,422,432`) since
  10-02 and none was ever merged — "fix ready" was a dead end. Shipped the two real fixes by cherry-pick and closed
  everything. **A "fix ready" issue still needs a person or session to merge + deploy it; nothing does that yet.**
- **HOVER:** root cause = `HOVER token refresh failed: 400` on every attempt since 2026-08-11 (the sign-in made 08-01
  is dead). Code: failed orgs back off to the cadence and keep the real reason (issue/332); a 400/401 refresh sets
  `needsReconnect`, the scheduler skips the org, no ops issue is filed, and the CRM Integrations card shows
  "HOVER sign-in expired … Reconnect HOVER" (`hoverConnNeedsReconnect`, server/crm/hover.ts). **Owner action: click
  Reconnect HOVER on portal → Integrations.** (HOVER support must still enable measurement-file API access.)
- **GBP sync:** an unverified listing's missing performance stats no longer fail the job (issue/422).
- **Stale tabs after a deploy:** a missing `/assets/*` file answers 404 text/plain no-store on every host (it used to
  answer the SPA's HTML); all lazy pages go through `client/src/lib/lazy-page.tsx` → `stale-build.ts`: a newer build =
  "Updating to the latest version…" + ONE reload (10-min sessionStorage guard), otherwise an honest message. Hashed
  bundles are immutable, HTML is no-cache.
- **/property search** threw on every keystroke (handler read `e.target.value` from a string) — fixed + a test.
- **Issue fingerprints are stable across builds** (`server/ops/fingerprint.ts`; they used to include minified stack
  frames, so every deploy filed a new issue). Boot runs `server/ops/merge.ts` (idempotent; prod 35 rows → 5; by hand
  `scripts/merge-ops-issues.ts [--dry-run]`, read-only preview). User reports are never re-keyed or folded.
  The bell rings only when something changes for an issue (`ops_issues.notified_sig`); a run with nothing new is silent.
  All five remaining issues were marked `fixed` with `setIssueStatusByAdmin` after their fixes deployed — a recurrence
  reopens them, which is the regression alarm.
- **Report an issue (owner request):** footer links Help (`/tutorials`) + Report an issue on the platform, the CRM and
  public pages; page `/report-issue` + `/crm/report-issue`; `POST /api/issues/report`, `GET /api/issues/mine`;
  each report is its own `ops_issues` row (`source='user'`). Desk order: a user's blocker, then other user reports,
  then captured failures; up to 4 extra user-report runs past the daily cap (`ISSUE_DESK_USER_REPORT_EXTRA_RUNS`).
  **Signed-out reports are held in `triage` until an admin releases them** (anonymous text must not steer the desk);
  a signed-out blocker still rings the bell once. The desk prompt fences report text as data and may not commit
  changes to auth/billing/permissions/secrets/deploy/data deletion on the strength of a report. Replies are shown on
  the page, NOT emailed. Screenshots go to R2 `issue-reports/`.
- **Issue desk now runs from `~/ConstructHUB-release`** (unit `constructhub-issue-desk.service`, backup `.bak-*`):
  it had been executing `run.sh`/`prompt.md` from the shared working copy on a stale feature branch. Its `.env` stays
  at `~/ConstructHUB/ops/issue-desk/.env` (`ISSUE_DESK_ENV_FILE`). First run from there: OK (daily cap 6/6 reached).
- **Connect walkthroughs:** Cloudflare and Search Console Connections tabs carry numbered, click-by-click steps
  (`client/src/pages/site-connect-steps.tsx`), incl. where the Global API Key is in Cloudflare and what happens to it.
- **First tutorial video exists** (Database Directory, 89 s, Janice voice): vb11
  `~/ConstructHUB-seo/analysis/video-out/database-directory/walkthrough.mp4`; tooling `scripts/tutorials/*` on branch
  `tutorial-video-1` (not merged yet: player wiring + R2 upload in progress).

## 🔎 2026-10-07 — SEO: Site Explorer + SEO data credit (4x markup, plan allowance, prepaid packs)
- **Data source is live:** DataForSEO account `support@constructhub.us` created by the owner 2026-10-07, `DATAFORSEO_LOGIN` /
  `DATAFORSEO_PASSWORD` set on vb11, $51 balance. `/seo` no longer shows "being switched on".
- **Site Explorer** `/seo/explorer` (`server/seo/explorer.ts`, table `seo_domain_reports`): any domain → authority, backlink
  profile, organic/paid footprint, 6-month history, top keywords/pages, competitors, referring domains, anchors. Eight
  vendor calls ≈ $0.26 wholesale; a saved report is free to reopen for 7 days. Design reference: the owner's Ahrefs
  screenshots; request shapes from OpenSEO (MIT, cloned at `~/vendor-src/open-seo`). Parsers are tested on real responses.
- **Owner decisions (2026-10-07) — SEO is sold as data credit, like Ahrefs:** every lookup costs the customer
  **4x wholesale** (`shared/seo-credits.ts` `SEO_MARKUP`); each plan includes a monthly allowance at the customer's price
  (`seoCreditCents`: **Starter $10, Pro $20, Growth $40, Agency $40**; resets on the 1st, no rollover); beyond it the
  customer buys **prepaid packs of $25 / $50 / $100** (spent after the allowance, never expire). The old plan units
  `seoResearch` / `seoBacklinkRefreshes` are GONE; `seoKeywords` (tracked keywords) stays and is still owner-to-confirm.
- **How it charges:** every vendor call already went through `server/seo/budget.ts` reserve→settle, so the customer charge
  lives there (`server/seo/credits.ts`: tables `seo_credit_usage`, `seo_credit_wallets`, `seo_credit_purchases`). Routes and
  jobs charge nothing themselves; weekly rank runs and monthly backlink snapshots draw the same credit and fail with the
  customer message when it is used up (`SeoBudgetError.code === "seo_credits"`, HTTP 402 with `packs`).
  Packs: `POST /api/seo/credits/checkout` (one-time Stripe payment) → webhook `fulfilSeoCredits` (once per session; amount
  must equal a pack). Platform staff are unlimited. `/api/seo/status` carries `credits`, `prices`, `packs`.
- **In-app purchase guard:** `/api/seo/credits/checkout` AND the CRM's `/api/crm/billing/{checkout,change}` (missed when the
  CRM split shipped) are now in `APP_NO_PURCHASE_ROUTES`; the inventory test also scans `server/crm/billing.ts`.
- **Still to do (agreed order):** backlinks full depth → keyword research full depth → rank tracking (configs, local/maps,
  history) → AI visibility → reports; then the Ahrefs-style projects dashboard and Site Audit overview. The internal
  wholesale cap `SEO_MONTHLY_BUDGET_USD` (default 100) still applies on top of customer credit — raise it as usage grows.
  Not verified in a browser by the building session (no browser on vb11).
## 📷 2026-10-07 (evening) — JobCam plans + storage, fast boot, Cloudflare/Search Console worker ON (deployed 1f4a0ea)
- **JobCam is a CRM feature only** (owner: attached to a jobsite; not a platform tool). Included in **CRM Max**; a
  **$39/mo add-on on CRM Basic and CRM Essentials** (`CRM_ADDONS.jobcam` in shared/crm-plans.ts; annual = 12 × $39 =
  $468, NO discount assumed — owner to confirm). Gate: `jobcamEntitled()` in server/jobcam/plan.ts (plan | addon |
  admin | beta); every member route answers 402 `crm_plan_required`; share links already sent and the homeowner
  portal keep working after a downgrade. Upgrade card → PurchaseReviewDialog → `POST /api/crm/billing/change`
  (owner only, prorated, lazy Stripe price `chub_v1_crmaddon_jobcam_*`). NOT yet exercised with real money: the add-on
  purchase/removal and its webhook path — watch the first one. Marketing: `/features/jobcam` (49 prerendered pages
  now) linked under Pricing & Plans; no Tools entry by owner's choice.
- **JobCam storage tiers** (owner: 5 GB included, then 10 / 100 / 500 / 1,000 / 2,000 GB): `shared/jobcam-storage.ts`,
  `jobcam_org_usage.storage_tier_gb`; upload open refused 403 `limit_reached` (stored + in-flight + new file, row
  lock), re-check at complete with cleanup. Tiers have NO prices yet: only a platform admin changes a tier
  (/admin "JobCam storage", `POST /api/admin/jobcam/storage-tier`); customers get the meter, an 80% note, "Storage
  full — next size" and "Request more storage" (requests show in that admin card only; no email).
- **Boot is fast when nothing changed:** `seed_state` remembers the permit-portals file hash + directory row count;
  an unchanged pair skips the 13k row-by-row apply (80 s → 0.1 s on dev). `FORCE_PORTAL_SEED=1` forces it. Every
  restart used to be an ~80 s outage (Cloudflare 502) — the owner hit one while testing.
- **Gateway errors are no longer printed raw** (client/src/lib/queryClient.ts): 502–504/52x or an HTML body reads
  "ConstructHUB is restarting or briefly unavailable."
- **Cloudflare + Search Console:** `EDGE_SEARCH_WORKER_ENABLED=true` set on vb11 (it was missing, so nothing queued
  ever ran; backup `.env.bak-*-pre-edgeworker`). Owner registered `https://constructhub.us/api/gsc/callback` and
  `/api/mail-alerts/oauth/callback` on the Google OAuth client (Google propagation took ~10 min). Cloudflare has no
  third-party "allow access" sign-in: Connections tab = Global API Key → we mint a limited token; or a pasted scoped
  token; the ops-only agency-membership path needs `CLOUDFLARE_AGENCY_*` (unset). No real connect has been run yet;
  the `webmasters` scope is a Google "sensitive" scope (unverified app warning / 100-user cap until verified).
- **In progress (branch `help-tutorials`, vb11 `~/ConstructHUB-seo`):** "i" info buttons on Cloudflare and Search
  Console written from the code, a walkthrough-video slot beside them, a `/tutorials` section for every feature, and
  `docs/tutorials/VIDEO-PIPELINE.md` (Playwright capture + Janice voice + Higgsfield; needs a Higgsfield key).

## 📷 2026-10-07 — JobCam: storage sizes, CRM-plan gate, $39/mo add-on (branch `jobcam-storage`, NOT deployed)
- **Owner decisions (2026-10-07):** storage "5 gigs and then 10, 100, 500, 1000, 2000"; JobCam "is part of the upper tier
  plan" = INCLUDED in CRM Max; "the upgrade will cost $39 a month on basic and essential" = the JobCam add-on on CRM Basic
  and CRM Essentials; JobCam is a CRM feature only (the platform only has its feature page, `/features/jobcam`).
- **Storage:** `shared/jobcam-storage.ts` (sizes, 1 GB = 1024³, formatting, the 403 body). `jobcam_org_usage.storage_tier_gb`
  (default 5). Enforced in `server/jobcam/routes.ts` at upload OPEN (used + open uploads + still-processing media + this
  file, under a row lock on the org's usage row: `withJobcamStorageRoom`) and again at COMPLETE (refusal aborts the
  multipart, deletes the object and the rows). Refusal = 403 `limit_reached`, `feature: "jobcamStorage"`.
  **Larger sizes have NO price**: only a platform admin sets one (`POST /api/admin/jobcam/storage-tier`, /admin →
  "JobCam storage", written to `admin_audit_log`); customers press "Request more storage" (`jobcam_storage_requests`,
  listed in the same admin card — nothing emails the admin yet).
- **Plan gate:** ONE function, `jobcamEntitled(ownerUserId)` / pure `jobcamAccessFrom` in `server/jobcam/plan.ts`
  (`via: plan | addon | admin | beta`). Every member route answers 402 `crm_plan_required` (`feature: "jobcam"`) without
  it; `/jc/:token` share pages and the client portal stay open, and revoking/deleting a share link stays possible.
  `/api/crm/me` carries `crm.jobcam`; the client shows `JobcamUpgradeCard` instead of the feed/camera.
- **Add-on:** `CRM_ADDONS.jobcam` in `shared/crm-plans.ts` ($39/mo; yearly = 12 × $39 = $468, NO discount assumed — owner
  to confirm). Stripe price `chub_v1_crmaddon_jobcam_{month|year}_{cents}` is created lazily like every other price
  (`crmAddonPriceSpec`); it is one more item on the CRM subscription (`crm_subscriptions.jobcam_addon`), added/removed
  through `POST /api/crm/billing/change { jobcam }` with the same proration as extra seats. Moving to CRM Max drops the line.
- **Deploy notes:** new columns/tables are created at boot (idempotent). Orgs whose owner is not staff/beta and has no
  CRM Max / add-on lose JobCam on deploy — check production before shipping. With `CRM_REQUIRE_PLAN=0` an org without a
  CRM plan still has no JobCam.

## 💳 2026-10-07 — the CRM is a SEPARATE PRODUCT (own plans, own subscription) · checkout-return fix · Google tag · ad doors
- **Owner decisions (2026-10-07):** two apps, sold separately; nobody is forced to buy both. Platform tiers keep their
  prices and no longer include the CRM. CRM pricing = half of Housecall Pro (verified on housecallpro.com/pricing):
  **CRM Basic $39/mo ($348/yr, 1 seat) · Essentials $94/mo ($888/yr, 5) · Max $164/mo ($1,788/yr, 8)**, extra seat
  $17/mo, 14-day trial. Every purchase must say what the buyer gets AND what they are not getting.
- **Model:** `shared/crm-plans.ts` (CRM price book; annual is explicit, NOT `ANNUAL_MONTHS`). `PlanLimits.crmSeats` is
  gone: it became `agencySeats` (Agency team pool); `extra_seat` is Agency-only. Every plan has `notIncluded[]`.
- **Billing:** `crm_subscriptions` (own table, created at boot) + `server/crm/billing.ts`
  (`/api/crm/billing/{plans,subscription,checkout,change}`). Same Stripe customer, second subscription marked
  `metadata.product=crm` on `chub_v1_crmplan_*` / `chub_v1_crmseat_*` prices (created lazily like the others). The
  platform webhook hands CRM events to `applyCrmSubscription` / `endCrmSubscription` and never writes them to
  `subscriptions`; platform checkout ignores CRM subscriptions when deciding "already subscribed" / trial.
- **Gate:** `requireOrg()` answers 402 `crm_plan_required` unless the ORG OWNER has an active CRM plan, is beta, or is
  platform staff (`server/crm/entitlements.ts`, 30 s cache). `/api/crm/me` carries `crm:{active,…}`; the portal shows
  `CrmPaywall` (plans; nothing sold inside the iPhone apps). `CRM_REQUIRE_PLAN=0` turns the gate off.
  Texting = CRM plan's segments + a platform plan's, one monthly pool (`reserveQuotaFor(..., extra)`).
- **UI:** /pricing has "Not included" on every card, a `#crm` section, and `PurchaseReviewDialog` before any first
  purchase. CRM Settings shows the CRM subscription + the account's invoices; receipts name CRM lines.
  Logo and the lower profile chip open the profile in both apps (owner request).
- **FIXED (prod bug, owner hit it 18:08 ET):** Stripe success/cancel/portal-return URLs used `getBaseUrl()` =
  `PORTAL_URL` in production, so a buyer landed on `portal.constructhub.us/pricing` (no such page; separate session;
  another account's CRM). They now use `appReturnBaseUrl(req)` (`server/site-context.ts`). The purchase itself was
  always recorded on the right account.
- **Google tag:** `server/google-tag.ts`, runtime env on vb11: `GOOGLE_TAG_IDS`, `GOOGLE_ADS_CONVERSION_{SIGNUP,
  PURCHASE,CRM}`. Nothing is injected until the ids are set (OWNER TO PROVIDE). Marketing hosts only.
- **Ad doors:** `server/ads-landing.ts` — `/googleads-features` (= /features), `/googleads-crm` (= /features/crm):
  Google click id + `k=` key (`ADS_LP_KEYS`, default `ch_feat_2026,ch_crm_2026`), verified-Googlebot exception, bots
  403 + added to Click Guard `blocked_ips` for `ADS_LP_DOMAIN` (default constructhub.us — a Click Guard site for it
  must exist for exclusions; hits are logged in `ads_lp_hits` regardless). Visitors are NOT excluded (nationwide).
- **Not done / owner:** Google tag ids; a Click Guard site for constructhub.us + the Ads script; Cloudflare ASN header
  (`ADS_LP_ASN_HEADER`) for datacenter detection; a "CRM subscription started" email (receipts and invoices work;
  the $0 trial start sends nothing); Stripe's own trial-ending reminder should be switched on in the dashboard.
- Tests: suite at the pre-change baseline (52 pre-existing failures: no DB/server on the tower), +16 new
  (`server/ads-landing.test.ts`, `server/crm/crm-plans.test.ts`).

## 📷 2026-10-07 — JobCam phase A live · deploy incident + new deploy rule (READ THIS)
- **DEPLOY RULE (new, enforced by `script/deploy-vb11.sh`):** production is built ONLY from committed code on `main`
  that type-checks, from the release checkout: `cd ~/ConstructHUB-release && git merge --ff-only <tested commit> &&
  script/deploy-vb11.sh`. Never `git merge` or deploy in `~/ConstructHUB`: it is a shared working copy that a live
  session may have on another branch with uncommitted edits. The script now aborts unless the branch is `main` and
  the tree is clean, and runs `npm run check` itself (`DEPLOY_ALLOW_UNSAFE=1` overrides; write down why).
- **Incident (12:52–12:56 ET):** at 12:49 another live session created and checked out `crm-split` in `~/ConstructHUB`
  and began uncommitted edits to `shared/plans.ts` (CRM as a separate product; `crmSeats` → `agencySeats`,
  `notIncluded`, new `shared/crm-plans.ts`). A deploy run from that directory at 12:52 (a) fast-forwarded `crm-split`
  to `79015a5` (it now contains JobCam, i.e. it is main) and (b) built the dirty tree: the type check FAILED
  (`plan-copy.ts: crmSeats does not exist`) but the failure was masked by a pipe, and the build shipped. That build
  served production for about 90 seconds (prerender 47/48), handled one routine CRM request, no billing/plan
  request, no errors logged. Fixed by rebuilding from a clean checkout of `79015a5` (48/48, boot verified). The other
  session's working tree and uncommitted files were not modified. `main` fast-forwarded to `79015a5`.
- **JobCam phase A** (owner: a CompanyCam clone, "JobCam"): `server/jobcam/*`, pages `/crm/jobcam`,
  `/crm/projects/:id/jobcam`, capture screen, public share page `/jc/:token` (portal host). Capture photo/video from
  the phone, resumable multipart uploads (IndexedDB queue), in-process media worker (sharp/ffmpeg: display, thumb,
  poster, HEVC→720p H.264, EXIF/QuickTime GPS + time), feed, day timeline, tags (anyone can create), starred,
  cross-project search, lightbox, soft delete, gallery/timeline share links (password, expiry, revocable, view count)
  by email/SMS, storage meter. **Homeowner portal shows ONLY media a team member marked "Show to client"**
  (`jobcam_media.client_visible`, default false, enforced in SQL). Spec + CompanyCam research: run folder
  `JOBCAM-SPEC.md`. Tables `jobcam_*` are created at boot (phase B–D tables exist empty).
  Verified: dev end-to-end on local storage (114 API checks + Playwright), 49 unit/integration tests, and every R2
  call against the real bucket under a throwaway `jobcam-probe` prefix (direct presigned part PUT, server part,
  complete at exact size, 206 ranged read, put/download/delete). Bug found there and fixed: presigned part URLs
  must sign `UNSIGNED-PAYLOAD` (R2 answered 403 SignatureDoesNotMatch).
  NOT verified: a real SMS send of a share link; HEIC→JPEG with a real iPhone file; a real phone upload on prod.
  Bucket CORS is not set, so browsers cannot PUT parts straight to R2 yet: the client falls back to the API proxy
  (works; slower for big videos). Owner decisions: storage limit per plan (`limitBytes` null = unlimited), caps
  (25 MB photo, 1 GB / 10 min video). Next phases: annotations incl. time-coded video markup, AI voice/video notes →
  editable report → PDF/email/SMS (needs a speech-to-text key), checklists.
- **First real checkout** happened 2026-10-07 12:36 ET (before the incident, unaffected): Pro monthly, trialing, on
  the correct `chub_v1_plan_pro_month_7900` price; a local `subscriptions` row should exist for that user (verify).
- Also today: collapsed CRM sidebar fixed (root cause: `ui/sidebar.tsx` used Tailwind 4 `x!` syntax on a Tailwind 3
  build, so the collapsed-state overrides never applied); sidebar stays brand orange, page content is Google blue.

## 🔵 2026-10-07 — Google blue is the accent on the platform AND the CRM; Stripe catalog provisioned; JobCam started
- Owner: "the orange is too obnoxious" / "the brand is blue and orange": `--g-accent` and the `.app-theme` / `.crm-theme`
  primaries are Google blue (#1a73e8, dark #8ab4f8); orange remains the brand mark (logo, mascot, sidebar badges, warning
  pills). Deployed (merge 7ce0b70). The SEO vendor card moved to /admin ("SEO data source").
- **Stripe (read-only audit 2026-10-07):** account acct_1TzcYU9yWcdekSaP charges+payouts enabled, card/ACH/transfers
  active, no requirements due; both webhooks enabled. The live account had ZERO products/prices/customers/subscriptions
  ever — prices are created lazily by lookup key. Pre-created all 31 recurring prices with the app's own
  `resolvePriceId` (plans ×2, add-ons ×2 + texting setup, Call Assistant tiers, agency location tiers). Still never
  exercised with real money: owner should buy Starter monthly once, confirm, cancel; refund. Not sellable online by
  design: Master Class modules ($1,500–2,000) and bundle ($2,499) + DFY services are above the $1,000 sales-only rule;
  SEO has no retail price yet; JobCam not built.
- **JobCam** (CompanyCam clone, owner 2026-10-07): spec in the run folder `JOBCAM-SPEC.md` (CompanyCam 2026 tiers
  Core $63 / Crew $119–129 / Scale $199–249; their gaps: no video annotation, no revocable links, permanent stamps).
  Phase A (capture, R2 multipart, ffmpeg worker, feed/timeline/tags/search, share links, client portal) building on
  vb11 worktree `~/ConstructHUB-jobcam` branch `jobcam`. Later: annotations, AI notes → editable report → PDF/email/SMS
  (STT pluggable; OpenAI gpt-4o-mini-transcribe ≈ $0.015 per 5-min video — needs a real OpenAI key, prod AI base URL is
  the local TruthCode API), checklists/comments/map/offline.

## 🎨 2026-10-06/07 — Google format platform-wide (orange accent) + our own SEO tool (deployed, merge 0acc82d)
- Owner: "Let's use this same format and update the other pages and maybe keep the orange. This format will sell better since
  Google has proven it." Every signed-in platform page now sits on `.g-surface` (App.tsx layout; CRM portal untouched):
  Google Sans/Roboto, hairline cards, pill buttons, `--g-accent` = brand orange #F97316 (dark #fb923c) everywhere except the
  Google Business pages, which keep Google blue via `<GoogleSurface accent="google">`. Kit additions in
  `client/src/components/google/`: GoogleSectionHeader, GoogleListRow/GoogleList/GoogleMeta, GoogleStat/GoogleStatGrid,
  `.g-search`. Converted: dashboard, Permits & Databases (/databases /property /search /history /schedules), Google Business
  remainder (/domains /mail-alerts /reinstatement /google-business /media-library), tools (/social-media /site-scan
  /cloudflare /search-console /google-ads /google-ad-fraud /ads-manager /lsa-leads /lsa-account-manager /ip-tracker
  /vpn-shield /call-assistant), guides (typography only), /settings, /admin. Left as is: public marketing pages, /developers,
  big data tables inside Click Guard / LSA account manager, dialogs rendered on body (app font). Screenshots (gitignored):
  vb11 `~/ConstructHUB-gstyle/analysis/google-style-shots/{phase2,phase2a}/`, `~/ConstructHUB-gstyle-b/analysis/google-style-shots/phase2b/`.
- **SEO tool ("our own OpenSEO")** — `server/seo/` (dataforseo client with MIT notice for ported parts, price sheet, budget
  cap, schema, jobs, routes), tables `seo_sites/seo_keywords/seo_rank_runs/seo_rank_checks/seo_backlink_snapshots/seo_api_usage`
  (created at boot + in apply-schema-migration.ts), pages `/seo` `/seo/keywords` `/seo/backlinks` `/seo/competitors`
  (client/src/pages/seo/*), sidebar "SEO", Settings → Limits & usage row. In-process worker (60 s tick, advisory lock,
  `SEO_JOBS_DISABLED=true` to stop): weekly rank run per site (standard queue), monthly backlink snapshot. Plan gate = Site Scan's.
  **Owner-pending env on vb11:** `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` (dataforseo.com, $50 minimum top-up, never expires),
  optional `SEO_MONTHLY_BUDGET_USD` (default 25, platform-wide, enforced reserve→settle in seo_api_usage). Until set, every SEO
  page shows the "Connect DataForSEO" card (prices quoted from the 2026-10-06 report) and nothing is charged. 200 keywords × 2
  devices weekly ≈ $0.24/run ≈ $1.04/month at top-10 depth. Report: run folder `openseo-report.md`.
  Owner asked "can't we build our own?" — answer given: SERP scraping not worth it at our volume (proxies/CAPTCHA/ToS,
  ~same bandwidth cost); keyword volume via Google Ads Keyword Planner API, own-site backlinks via Bing Webmaster, AI mentions
  via direct model queries ARE buildable for free — offered to add those three so DataForSEO becomes optional; awaiting go.
- **White-labelled 2026-10-07 (merge d4950a7):** customers never see DataForSEO — no vendor name, wholesale prices, queue or env copy on
  /seo*, usage shown in plan units from `SEO_PLAN_LIMITS` in shared/plans.ts (owner to confirm: Starter 50 keywords / 25 searches /
  1 refresh, Pro 200/100/4, Growth 1,000/500/12, Agency = Growth); `SEO_MONTHLY_BUDGET_USD` is an internal safety (default 100);
  platform admins see a "Data source" card + `GET /api/seo/admin/usage`. Retail price / SEO add-on: owner decision — TODO in
  server/catalog.ts. Tabs CSS (.g-tabs/.g-table/...) restored after the earlier merge dropped it.

## 🎨 2026-10-06 — Google Business section restyled to look like Google (deployed, merge c5ce9b5)
- Owner: "use the Google fonts and colors and styles to make the platform feel similar to Google on the GMB feature."
  Kit: `client/src/styles/google.css` (`.g-surface` tokens light+dark — Google Sans/Roboto, #1a73e8 blue, #188038 open-green,
  #fbbc04 star, #dadce0 dividers; re-points the shadcn vars inside the surface) + `client/src/components/google/`
  (GoogleSurface, GooglePill, GoogleStars, GoogleOpenStatus, GoogleLocalCard, GoogleMoreButton, GoogleAiOverview).
- Applied: /locations = Google local-pack cards (`components/location-local-card.tsx`; rating/count only for linked
  profiles, Open/Closed from synced hours on the viewer's clock, "N+ years in business" only from `openingDate`,
  latest review snippet, two photos, Call/Directions/Website/Reviews/Open-profile pills); /competitors = local pack +
  "More businesses" + an Overview block from the scan's own numbers; /google-reviews = Google-style review list with
  owner replies indented and AI drafts as "AI reply suggestion" blocks; /gbp-content, /ranking-grid, /gmb-monitor,
  /photos, /google-profile wrapped in GoogleSurface (fonts/colors/pills only). Screenshots (mock data, gitignored):
  vb11 `~/ConstructHUB-gstyle/analysis/google-style-shots/`. No real-data screenshots: the dev account owns no Google data.
- Same deploy: `county-fixes.json` moveCities +34 (fact-check-proven wrong counties, commit 22d67f8).
- Working copy used: vb11 `~/ConstructHUB-gstyle` (clone of this repo, branch `gstyle`, pushed here) — the vb11
  `~/ConstructHUB` dev tree is still the stale August checkout.

## 🗺 2026-10-06/07 — "leftover places" fact-check applied: 8,245 county/town permit routes, +176 portals (deployed)
- **What:** the owner's 10/06 order ("maybe there is no permit required… fact check all these that are left over") ran
  as 178 slices × 22,339 places: Codex researched, Claude fact-checked (different company on purpose), every quote
  mechanically re-verified. Run folder (tower): `/tmp/claude-1000/-home-veto-ConstructHUB/b63db1cc-…/scratchpad/leftover`
  (`RESUME.md`, `FINDINGS.md` = per-slice results + owner decisions, `collect.py` → `final-verdicts.json`).
  Result: 20,290 verdicts agreed, 1,701 corrected with checker-passed fixes, 348 rejected without a provable
  alternative (→ unknown). Codex fabricated nothing; its errors were Census points on same-named places in the
  wrong county, "no building code" read as "no permit" where a zoning/development permit is mandatory, and giving
  up at blocked pages.
- **Applied (this commit):** `scripts/build-permit-routing-from-verdicts.py` → `server/data/permit-routing.json`
  913 → **8,245** routes (6,2xx county + 1,1xx town/township issuers; each issuer is a directory jurisdiction with a
  live portal, each route carries the official source + quote); `_permit-candidates.json` +739 `own` permit pages →
  the normal gate (`PERMIT_BUILD_ONLY_NEW=1 … build-permit-portals.ts`) kept **176** (now 12,564 live portals).
  Code: `server/routes.ts` + `server/seed-permit-routing.ts` + `server/permit-routing.test.ts` now allow a **town**
  (and a county row, e.g. Philadelphia County → Philadelphia) as the issuer. Report: `analysis/leftover-apply-report.json`.
- **Held — needs a directory display first (owner decisions in FINDINGS.md):** `none` 3,032 places with an official
  "no building permit" statement, `state` 693 (state agency issues), `third_party` 63 (PA UCC opt-out etc.),
  plus 893 county-issued and 1,993 town-issued places whose issuer has no live portal, 2,906 `own` places with no
  apply URL, 4,657 honest unknowns (mostly tiny MO/IL/IA/KS/AR/AL towns with no web presence — phone calls).
  Also: zoning-type permits are labelled county/own (wording?), tribal trust land and federal installations need a
  caveat, ~60 directory rows have the wrong county or a bad geocode (listed per slice in FINDINGS.md).
- **Tooling fixed on the way:** `check-authority.py` host blacklist anchored (`x.com` no longer rejects every
  `*tx.com`; `permits.com` no longer rejects ellispermits.com) and PDF text is no longer tag-stripped; `lane.sh` only
  deletes its own claim. Tower disk hit 99% once (a lane bulk-downloaded 3.4 GB of hazard-plan PDFs) — briefs now
  carry a 20 MB download rule and `disk-watch.sh` purges stale downloads. **Owner order 2026-10-06: Claude account A
  is never used for directory lanes — use C (logged in 10/06) and D.**

## 2026-09-15 — per-user calendars (Braxton's request)
- `crm_appointments.created_by_member_id` (stamped on POST; `schema-ensure` adds the column and best-effort
  backfills from `crm_team_activity` "scheduled <title>" rows ±2 min). Prod after deploy: Alpine Exteriors 33
  visits, 13 backfilled to Braxton; the 20 unmatched (mostly the 2026-07-31 import batch) stay unowned and show
  only under "Everyone's calendar".
- Schedule page filter (next to month/week/agenda): **My calendar** (default, remembered per browser) /
  **Everyone's calendar** / one entry per member. "Mine" = visits I booked OR am dispatched to.
- Visibility for members without `viewAllJobs` now includes visits they booked, not just dispatched ones;
  the booker may also progress their own visit without `manageJobs`.
- Tests: `server/crm/appointments.test.ts` (+2). Deployed to vb7 via `script/deploy-vb7.sh`; vb11 DEV tree synced.

## TL;DR
**LIVE at https://constructhub.us (+www) since 2026-07-10**, self-hosted on vb7 behind ConstructHUB's
own Cloudflare tunnel. Imported from a Replit dump, reviewed, refactored, and had its (~100% fabricated)
government data rebuilt with real, verified sources; deployed with a fresh Postgres and fresh secrets
where possible. See "Live deployment" below for the runbook; owner-pending items at the end.

## 📱 2026-10-04/05 — audit, iPhone apps, permit portals ×10 (all deployed; dump-first each time)
- **Element audit (Kimi, 6 lanes):** every number/button/tab/link mapped in `docs/ui-map/*.md` (~4,000 elements, each
  traced to its route/table/window); ~56 bugs fixed. Server routes carry what-it-does comments.
- **iPhone apps (owner: two apps, "ConstructHUB" + "ConstructHUB CRM"; they SELL NOTHING — 3.1.3(f); Construct Hub LLC
  team, new ConstructHUB ASC key):** plan + Remindr lessons in `docs/app/APP-STORE-PLAN.md`. Native shells in `ios/`
  (xcodegen, two targets; CI `.github/workflows/ios-build-check.yml` compiles both on Xcode 26 — results on branch
  `ios-results`). Web app mode = `client/src/lib/app-shell.ts` (UA `ConstructHUBApp/`/`ConstructHUBCRM/`): no sales
  anywhere (central gates + two Kimi sweeps), account deletion in-app only (`server/account/delete.ts` + `erase.ts`;
  erase worker behind ACCOUNT_ERASE_WORKER_ENABLED — turn on when the apps ship), Google sign-in/connections through the
  auth sheet with PKCE (`server/app-auth.ts`, `app-connections.ts`), push tokens (`app-push.ts`), purchase guard
  (`app-purchases.ts`). Pickable phone tab bar (Settings → Phone tab bar; `user_ui_prefs`).
  Left for submission: the ConstructHUB App Store Connect API key (owner login), app records, signing, TestFlight,
  APNs key, demo accounts, review notes, screenshots. AI = TruthCoder (own models) — confirm no outside forwarding.
- **Call Assistant minutes** (owner): Lite 2,000 · Solo 5,000 · Crew 10,000 · Fleet 25,000 (prices unchanged).
  **Superseded 2026-10-08** — see the top entry "the AI Call Assistant is a SEPARATE SERVICE, repriced": 500 / 1,000 /
  2,000 / 5,000 minutes at $249 / $349 / $449 / $999.
- **Permit portals 659 → 6,400** (verified 641 → 4,187). Pipeline: research lanes (Claude A/C/D, Kimi, Codex) write
  gated candidates → `server/data/_permit-candidates.json` → `PERMIT_BUILD_CONCURRENCY=24 PERMIT_BUILD_ONLY_NEW=1 npx tsx
  scripts/build-permit-portals.ts` → spot-check wrong-service links → commit `permit-portals.json` → deploy (boot seeding
  applies it). Dry-run a candidate file: `scripts/check-portal-candidates.ts`. .gov crawler:
  `scripts/discover-permit-portals.ts` (CISA dotgov registry). The checker now rejects tax/budget/procurement/utility
  pages.
- **Directory:** 2,877 missing incorporated cities added from Census 2023 estimates (`scripts/add-missing-cities.ts`,
  only rows that don't exist); Eighty Eight KY / Doña Ana / duplicate St. George & Duluth fixed
  (`scripts/fix-directory-names.ts`). The boot seeder only fills an EMPTY directory — use the scripts on prod.
- **Final crawl:** `script/crawl-all.cjs` (desktop/phone/app × tools/public/CRM, 270 visits) — clean.

## 🔁 2026-10-04 — Alpine's CRM re-synced from Housecall Pro
- A fresh read-only export (`analysis/hcp-export-2026-10-04/`, gitignored) was imported into the Alpine Exteriors org
  with `scripts/import-hcp.ts`, after a database backup. Zero errors. It created 33 customers, 48 estimates,
  21 invoices and 16 jobs, and updated 62 estimates and 12 invoices. The CRM now matches HCP's dashboard: 40
  unscheduled jobs ($1,321,532.67) and 35 open invoices ($744,576.96). Open estimates also match at 36 once one
  record is set aside.
- That record is estimate **#2686** (Karen Belli, $21,150, status sent), which was deleted in HCP after July. It was
  left in place; the owner decides whether to remove it.
- How to repeat the sync: HCP's API is MAX-only and Alpine is on Essentials, so the session comes from the owner's
  browser. In DevTools, open Application → Cookies → pro.housecallpro.com and copy the value of
  `_housecall-web_session_with_domain` (Chrome strips cookies from "Copy as cURL"). Load it into the scraper profile
  `analysis/hcp-crawl/profile` and run `dump.js` (with the `package.json` that says commonjs) in a new folder. Then
  run `import-hcp.ts`: first on a test-DB org, then on production through an SSH tunnel to vb11:5433, after a
  pg_dump.

## 🎨 2026-10-03 — every signed-in platform page redesigned ("less is more")
- Owner: "All these pages are so clunky and not user friendly … make them flow and look cleaner simpler and better!
  Less is more … Better design too." Scope: the ~37 signed-in platform pages. The CRM and marketing pages are separate.
- Foundation: `.app-theme` (brand orange, Plus Jakarta Sans, warm page, white cards; dark mode too) and the page kit
  `client/src/components/app-ui.tsx`. The rules are `docs/design/APP-UI.md` — follow them for every new page.
- Built by seven lanes: Codex lanes 1, 2, 4 and 6, Kimi lanes 3, 5 and 7. Each worked in its own worktree from a
  brief (session scratchpad `ui/`), then I polished: one tab style, styled disclosures, location cards on phones,
  and a word-spacing fix for buttons and inputs. Every page has 0 px overflow at 390 px. Testids are kept.

## 🧰 2026-10-02 evening — what is live now (all deployed to vb11; dump-first each time)
- **Call Assistant is LAUNCHED (purchasable).** _(Prices and the add-on model below are SUPERSEDED by the 2026-10-08 late-evening entry
  at the top: a separate service, 500/1,000/2,000/5,000 minutes at $249/$349/$449/$999, 50¢ overage, 11 × yearly, no intro.)_
  Four tiers in `shared/plans.ts` CALL_ASSISTANT_TIERS: Lite $149
  (2,000 min, 1 number), Solo $249 ($99 × 3 monthly intro; 5,000 min, 1 number), Crew $449 (10,000 min, 5 numbers),
  Fleet $799 (25,000 min, 20 numbers) — minutes raised by the owner 2026-10-04 (was 1,000/2,000/5,000/12,000). Overage 10¢ Lite/Solo, 5¢ Crew/Fleet. 500 spam calls/month free on every tier.
  The two "NOT deployed" entries below are merged, live and superseded by these numbers. Lite yearly $1,199 confirmed by the owner
  2026-10-04. Owner still to confirm: the Stripe failed-payments setting (see the launch gate below).
- **Owner call rules (engine + compiler, `9931a36`):** a caller who asked for work is never hung up on: the spam flag
  is refused unless it sounds like a pitch or robocall, and only their own goodbye ends the call. Unusual or foreign names are
  spelled and read back. "Is <name> available?" (lawyers, firms, collections) gets "I'm not sure. This line is only
  for estimate requests." Personal or non-estimate matters get the estimates-only line, with no message taken. A lone
  early "bye" is treated as a misheard "hi", and queued caller speech is answered before any hang-up. Unanswered
  caller words are kept in the transcript as notes, and the summary gets labelled speakers. These mirror Alpine's
  Janice fixes from the same day. Published profiles keep their compiled prompt until republished; production had none.
- **Feature pages + SEO:** `/features` plus one page per feature and Done-For-You pages, a Features ▾ dropdown in the
  shared ribbon (`client/src/components/site-nav.tsx`) on every public page, and 47 prerendered pages with JSON-LD.
- **Google Profile access (Dennis):** discovery runs for every connected account. There is now a "Google Profile"
  sidebar entry, plus View profiles / Open in Google buttons. Accounts without a plan see "needs a plan" instead of a
  dead Import button.
- **Admin second factor:** a recent identity check (12 h) satisfies the admin gate; a refusal returns `{reauth:true}`
  and the client shows the verify dialog and retries. No more "Admin sign-in required" dead end.
- **Access grants** (`/admin/access`, sidebar "Access grants · ADMIN"): give any account a plan for 1–1000 days,
  extend, revoke. Trial codes go up to 1000 days.
- **Issue desk** (`/admin/issues`, docs/ops/ISSUE-DESK.md): the app records its own 5xx errors, job failures, Call
  Assistant problems and browser errors in `ops_issues`. The tower timer `constructhub-issue-desk.timer` (user unit,
  every 15 min) hands new issues to a headless Claude in `~/ConstructHUB-issue-desk`. Claude has read-only production
  tools and may put a fix on branch `issue/<id>`. It never pushes, deploys or restarts. Admins get a digest and a bell.
  `ISSUE_DESK_SECRET` is in vb11's `.env` and `ops/issue-desk/.env` (600, gitignored). There is a cap of $10 per run
  and 6 runs per day. **Browser reports start as "Needs review"**: they are anonymous input, so Claude only sees one
  after an admin presses Send to Claude. Review every `issue/<id>` branch before merging.
- **Trial invites are one click:** the invite email has an "Accept your invite" button that opens `/invite/<code>`.
  Signing in or signing up there brings the person back, and one click starts the trial. The code also works in
  Settings → Account. Giving access (trial codes, Access grants) never asks the admin for a verification code
  (owner's rule). `script/send-trial-invite.ts` sends one from the command line. Dennis
  (nextsteppainting@gmail.com) got an unlimited invite, TRIAL-B0190130, on 2026-10-02.
- **Janice call log** (`server/voice/ingest.ts`): Alpine's receptionist pushes every finished call to
  `/api/voice-ingest` over the tailnet only, authenticated with `VOICE_INGEST_SECRET`. Calls land in `voice_calls`
  under `VOICE_INGEST_ORG_ID` (Alpine Exteriors) with `engine='external'` and show on Call Assistant → Calls. They
  are records only: never billed, never a lead or alert.
- **Call Assistant Results panel** (Overview and Calls tabs, `client/src/pages/crm-call-assistant/results.tsx`):
  outcome tiles, calls by line, minutes and recordings over a chosen period. The numbers are counted from
  `voice_calls` by `callResultsSummary`, so pushed-in calls count too.
- **The Call Assistant is a platform page, NOT a CRM page** (owner: "the CRM is a standalone service"). Signed
  in, `constructhub.us/call-assistant` is the dashboard, in the main shell. The CRM sidebar and ribbon don't list
  it. The CRM's `/crm/call-assistant` and `/call-assistant` only redirect to the platform, keeping the query, so
  CRM-bell links still work. Leads still land in the CRM as clients.
- **Call numbers:** `voice_calls.call_no` is "Call #57", numbered per account by the `voice_calls_assign_no`
  trigger and unique per org. It shows in the list, the call's title and search (`#57`), and the ingest reply
  returns it as `callNo`. Janice's recordings are two-sided from 2026-10-02 evening. The 63 earlier ones are caller-only.

## ☎️ 2026-10-02 — Call Assistant tiers, 10¢ overage, 500 free spam calls — branch `ca/tiers`, NOT deployed
- Owner: "offer 3 different tiers … 3-5k min used a month … all plans cover 500 spam calls that aren't charged … we
  can charge 10 cents". Solo $249 (2,000 min, 1 number, the $99 × 3 intro), Crew $449 (5,000 min, 3 numbers), Fleet
  $799 (12,000 min, 5 numbers); one tier per subscription; overage $0.10/min; the first 500 spam calls a month free.
- Overage accrues **per call** against the tier in force when the call ends (server/voice/billing-usage.ts), so a
  mid-month upgrade never erases minutes already over, and a downgrade lowers the allowance from then on.
- Holding Crew or Fleet uses the Solo intro up (`markIntrosUsedByHeldAddons`, after every subscription write).
- The "never answer spam" promise is tied to forwarding: with no-answer forwarding spam still rings the contractor
  first; copy says so and tells them to switch to 'always' (CALL_ASSISTANT_SPAM.forwarding).
- **Owner decision:** "reports them" is built as a weekly spam report to the customer (email + bell + Calls → Spam
  blocked). Nothing is reported to SignalWire, carriers or the FTC. Say if you want that. All copy stays limited to
  "your spam report" until then.
- Still `preview: true` (nobody can buy any tier).

## ☎️ 2026-10-02 — Call Assistant billing rules (owner's words) — branch `ca/billing-rules`, NOT deployed
- Owner: "When a person cancels they lose their number … As soon as they stop paying the agent stops working. And
  annually price can be $1999". Answers the two open questions below (intro on annual: no; number on cancel: released).
- **Price:** `call_assistant` annual $1,999 (199900, not 10×). The $99 × 3 intro coupon is MONTHLY only
  (server/billing/intro.ts). Every surface: "$99/mo for your first 3 months, then $249/mo — or $1,999/yr".
- **Stop paying → paused:** add-on modules run only on active/trialing (`ADDON_MODULE_RUN_STATUSES`); past_due /
  unpaid / incomplete / paused → `ent.addonModulesPaused`: engine `/profile` 423 `payment_needed` on the next call,
  CRM reads open / edits 402 `payment_required`, Overview "Paused — update your payment method" → Billing.
- **Cancel → number released:** server/voice/number-release.ts, called from the Stripe webhook + add-on routes;
  scheduled ('releasing') until `release_eligible_at`, then released by a 15-min sweep (ON in production by default;
  `VOICE_NUMBER_RELEASE_WORKER_ENABLED=false` turns it off). past_due never releases. New columns
  `voice_numbers.release_reason`, `release_scheduled_at` (boot DDL + apply-schema-migration).
- Review round: a cancellation is final for every number (no restore on resubscribing within 14 days; only `unpaid`
  → card fixed and a re-added extra number restore); webhook subscription events re-read Stripe before writing the
  row; `VOICE_NUMBER_RELEASE_WORKER_ENABLED=false` now also stops the post-webhook background release; Billing asks
  before an add-on reduction releases numbers; after cancellation callers hear "no longer answered", not "try later".
- **Launch gate:** confirm Stripe → Billing → Subscriptions → Manage failed payments is set to *cancel the
  subscription* or *mark it unpaid*. On "leave it past-due" the agent stays paused (correct) but the number is held
  forever and the platform keeps paying SignalWire for it — past_due never releases.
- Still `preview: true` (nobody can buy it). Launch remains a separate step.

## ☎️ 2026-10-02 — AI Call Assistant built and deployed in admin preview (10:10 UTC)
- **Shape:** SignalWire → `https://constructhub.us/voice/*` (vb11 app, server/voice/proxy.ts, HTTP + WS) → tailnet →
  **tower** engine `constructhub-voice.service` (user unit, `/home/veto/ConstructHUB/voice`, venv `voice/.venv`,
  `127.0.0.1:8152` + `100.90.145.13:8152`; Silero VAD + faster-whisper large-v3-turbo + Kokoro, all on the RTX PRO 6000
  next to alpine-voice — they share nothing). Engine ↔ app: `/api/voice-internal/*` over the tailnet
  (`VOICE_APP_URL=http://100.76.165.33:8110`), bearer `VOICE_INTERNAL_SECRET` (same value in voice/.env and the live
  .env). Brain: ConstructHUB's TruthCoder (`truthcode-api` via `http://100.76.165.33:8250/api`, JSON decision protocol).
  Full design: docs/call-assistant/SPEC.md · ops: docs/call-assistant/RUNBOOK.md.
- **Never restart the engine with systemctl** — `bash voice/deploy/restart-when-idle.sh` (waits for activeCalls 0).
  Health: `bash voice/deploy/healthcheck.sh https://constructhub.us` (local / tailnet / proxy).
- **Product:** CRM → Call Assistant: Overview, Numbers (buy by state via SignalWire LaML, 14-day release rule),
  Agent Studio (wizard + advanced editor, compiled-prompt preview, versions, publish), Simulator, Calls (transcript,
  recording, outcome, spam ledger). Personas Janice/Gabe/Sofia/Maya/Marcus/Ethan. Calls → CRM client + project +
  activity + notifications; escalations by SMS/email with reminders; two-strike spam block pre-answer; minutes metered
  (voice_usage) with an overage job; two-party-consent states force the recording notice; lapsed orgs get 423 "paused".
- **Status: admin preview.** `call_assistant` / `call_number` are still `preview: true` in shared/plans.ts → nobody can
  buy it (409), the public pages say "Coming soon". Platform admins get the module + 1 number + 500 min to test.
  Launch = flip `preview` off after a real call through the carrier and a real Stripe intro-coupon purchase.
- Verified live: engine models loaded, health OK through the proxy, internal API 401 without the secret, forged
  webhook 400, media socket without a token 400. **Not yet exercised on production:** a real carrier call, R2 upload of
  a recording, the Stripe intro coupon. QA fixed 46 findings (incl. unauthenticated media WS, lapsed orgs still served).
- Open owner questions: intro on annual billing; number on cancel (release vs hold).

## 🏠 2026-10-02 — new landing (design B), signed-in dashboard, Call Assistant marketing (deployed 08:35 UTC)
- **Landing** (owner picked design B of three): Fraunces display + Plus Jakarta Sans body on cream paper, scoped by
  `.mkt-editorial` (client/src/index.css) so the app keeps Inter; hard-hat gator hero (srcSet 512/1024) on a navy grid
  panel; ONE orange — #F97316 for large accents/buttons, #AE4A04 (same hue, darker) for small text so it passes AA.
  Runner-up branch `design/c` kept; `design/a` was live for an hour, then replaced.
- **Signed-in home = dashboard** (client/src/pages/home.tsx + client/src/components/dashboard/**; GET /api/dashboard in
  server/dashboard/**, contract shared/dashboard.ts, spec docs/dashboard/SPEC.md): 29 tiles in 5 groups, each computed
  separately on a read-only pool with a 3 s limit, gates from getEntitlements applied before any query, 60 s per-user
  cache (cleared on plan/add-on/webhook changes; ?fresh=1 throttled), "Needs you today", CRM snapshot (read-only org
  lookup — never creates an org), getting-started checklist, recent activity. Indexes for the protect tiles run at boot
  (ensureGrowthSchema). server/crm/follow-ups.ts fix: "leads without an estimate" was over-counted above 2,000 estimates.
- **AI Call Assistant marketing** is live while the product is being built: /call-assistant, landing section, pricing
  line (CALL_ASSISTANT_INTRO in shared/plan-copy.ts: $99/mo × 3 months, then the price-book rate), "Call Assistant · NEW"
  in both sidebars, Gabe knowledge §30. The add-on is `preview: true` in shared/plans.ts → checkout refuses it (409,
  nothing charged), the CRM tab says "Coming soon", /voice/* answers 503. The voice_* tables exist (empty).
  Open owner questions: does the intro apply to annual billing; what happens to a bought number on cancel.
- Test env gotcha: the dev email sink tmp/email-outbox.jsonl hit Node's 512 MB string limit and failed 21 tests at
  read; it was trimmed to its last 2,000 lines. Trim it again if sink-reading tests fail with "Cannot create a string".

## 🐊 2026-10-01 — Gabe (Hub assistant) + the standing-gator mascot (deployed 2026-10-02 03:56 UTC)
- **Mascots** are the owner's artwork in client/public/mascot/ (checkerboard/noisy alpha cut out in-session;
  sources kept in the session scratchpad). `client/src/components/mascot.tsx`: `StandingGator` (hard hat + vest,
  arms crossed) stands to the right of the logo in the site sidebar (`app-sidebar.tsx`, 64px) and the CRM sidebar
  (`crm-sidebar.tsx`, 56px, hidden on the icon rail); `GabeAvatar` is the Hub assistant's face.
- **Hub assistant = "Gabe"** (branch hub/agent-rev merged, then hub/gabe): corner widget on every page; signed-out
  visitors get cached preset answers (pricing, features, setup); signed-in users get free chat through TruthCoder
  (`server/hub/*`: own client with maxRetries 0 + hard timeout, deterministic prefilter + output filter, per-visitor
  and global limits, never any client/user data, no tools). The old `/api/site-assistant/chat` and
  server/site-assistant.ts are gone; the public-API no-AI lists name server/hub/ai.ts and /api/hub/chat.
- **Fixes the verifiers forced before merge:** the Hub's provider pin now accepts `truthcode-api` (the live
  `AI_MODEL`) as well as `truthcode:38` — without it Gabe would have been "offline" on deploy; the output filter
  strips TruthCoder tool-call/reasoning markup and blocks prompt-dump n-grams beyond HARD RULES; the pre-filter
  knows the persona is Gabe; the launcher renders even when /api/hub/presets fails (panel says Gabe is offline).
- **Cloudflare gotcha (cost one redeploy):** a verifier fetched `/mascot/gabe-160.webp` on the live domain BEFORE
  the deploy; the SPA answered 200 text/html and Cloudflare cached that HTML under the image URL for 4 h (it caches
  by extension). The project has no valid Cloudflare API token to purge (`secrets/cf_dns_token.txt` is rejected), so
  the files are named `*.v1.webp` — a changed image gets a new version, never the same name. Never probe a new
  static path on the live domain before it is deployed.

## 🛠 2026-10-01 — audit-4 follow-ups: the four open items (deployed 15:49 UTC)
- **Texting allowance metered (Kimi A1-3)** — every outbound text with an org (manual client texts, reminders,
  estimate texts, invites, consent, re-engagement and owner alerts, the Settings test send) reserves its segments
  from the org owner's monthly `teamTextSegments` allowance through the growth_budgets meter
  (`quota:user:<ownerUserId>:texts:<YYYY-MM>`, UTC month; server/crm/sms.ts `reserveSmsSegments`, counter in
  server/crm/sms-segments.ts — GSM-7 160/153, UCS-2 70/67). Carrier failure refunds; manual sends answer the standard
  403 `limit_reached`; automated alerts skip the text, log once per org per month and fall back to email. Limits &
  usage shows the running total (`usage.texts`). Platform-level beta-invite texts (no org) are not metered.
- **F11 closed** — the vision caption works through the production loopback (`127.0.0.1:8250`, 18 s, HTTP 200);
  the 524 was the public Cloudflare path's 100 s cap, which production never uses.
- **Demo/ops scripts** (scripts/invite-team.ts, scripts/seed-crm-demo.ts) comp the owner on `agency`, not `platinum`.
- **F08/F09 — one-time fulfilment** (server/billing/fulfilment.ts `fulfilOneTimePurchase`, called from both
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`): rows are written only when the
  verified session says `payment_status === "paid"` (an unpaid completion grants nothing; the later async success
  grants it; `async_payment_failed` never does), once per session+item via partial unique indexes
  (`course_purchases(stripe_session_id, COALESCE(module_id,0), COALESCE(is_bundle,false))`,
  `service_purchases(stripe_session_id, service_type)`; `ON CONFLICT DO NOTHING`), all items of a session in one
  transaction — a failure rolls back, rethrows, the billing_events claim is released, the webhook answers 400 and
  Stripe's redelivery re-runs the session. Unreadable metadata throws (no guessed grants). DDL: `FULFILMENT_DDL` in
  server/billing/schema.ts (also in scripts/apply-schema-migration.ts; mirrored in shared/schema.ts). Live DB had 0
  purchase rows at deploy, so the indexes created cleanly.
- **F10 — email outbox**: email_log keeps the dedupe claim on a failed send and becomes `status='pending'` with the
  rendered message, attempts, next_attempt_at, last_error; `drainEmailOutbox()` runs every 60 s
  (`startEmailOutboxDrainer()` from server/routes.ts; `FOR UPDATE SKIP LOCKED`, 10-min lease, backoff
  1m→5m→15m→30m→1h→2h→4h, `failed` after 8 attempts — set `pending` to re-queue). The webhook response never waits
  on mail; a redelivery finds the claim and never double-sends. Known leftover: server/account/email.ts (unused
  lane-1 helper) still has the old delete-claim contract — delete it with server/billing/invoices.ts.

## 🔎 2026-10-01 — audit 4: Codex + Kimi audit of everything since 09-30 (deployed 05:15 UTC)
- Two independent audits of the price book, TruthCoder AI, account/billing/API work (briefs + full reports with
  evidence in the session scratchpad `audit4/`; branches `audit4/codex`, `audit4/kimi`, merged with `--no-ff`).
- **Codex fixed (7):** F01 API monthly quota race + under-metered reads (quota checks serialised through metering,
  real read cost, honest 503 on metering errors — server/public-api/quota.ts, quota-concurrency.test.ts); F02 site
  assistant now on the shared aiClient/aiComplete/timeout path; F03/F04 stale invoice-failure and stray-subscription
  events no longer email; F05 Stripe Connect checkouts can't enter platform course fulfilment; F06 GBP imports are
  atomic under the account location lock (`ImportLocationError`, server/gbp/import-limit.test.ts); F07 Ads
  integration Connect/Manage link opens the MCC manager.
- **Kimi fixed (9 commits):** site assistant hardening (same hole as F02, superset kept), dead `startGbpWorker`
  removed (the lapsed-account sync fix had landed in dead code — the live path in server/agency/jobs.ts was
  already right), test sinks honour `EMAIL_OUTBOX_FILE` / `VOICE_OUTBOX_PATH`, plan-gates test mkdir, Badge-in-<p>
  DOM nesting on Limits & usage, knowledge base no longer says "powered by OpenAI", scan refund test resets state.
- **Still open (owner/engineering):** F08 unpaid `checkout.session.completed` (payment_status=unpaid) still grants a
  course; F09 cart fulfilment DB failure is ack'd to Stripe with no retry; F10 failed billing email has no retry path
  → all three want one transactional one-time fulfilment with event idempotency + an email outbox (server/stripe.ts
  ~599–639). F11 vision caption hit a 524 via the public TruthCoder URL (production uses loopback :8250 — re-test
  there). Kimi A1-3: texting segment allowance (500/1,500 per month) is advertised but not metered server-side
  (server/crm/sms.ts, messages.ts); A1-8: scripts/invite-team.ts + seed-crm-demo.ts still seed `platinum`.
  Unverified: Profile Guard enable has no account-wide lock on downgraded accounts (server/routes.ts:208–226).
- Suite on main after the merge: run with Node 20 (`~/.nvm/versions/node/v20.19.6/bin` — vitest.config needs
  `util.parseEnv`; system Node 18 fails at startup) and `. ~/ConstructHUB-a5/.env` sourced.

## 🧾 2026-10-01 — account settings, billing documents, customer API (deployed 03:45 UTC)
- **Emails** (server/account/billing-emails.ts, one per Stripe event via email_log dedupe, $0 invoices skipped): welcome,
  subscription started, receipt per paid invoice, payment failed, plan/add-on changed, cancellation, one-time purchase.
  Webhook calls onStripeBillingEvent after recordBillingEvent (server/billing/ledger.ts); ledger tables billing_events /
  billing_invoices / billing_purchases (DDL in server/account/schema.ts).
- **Settings** (client/src/pages/settings/*): Ahrefs-style nav — Me (account, password & security, notifications) /
  Workspace (Billing: Subscriptions | Invoices | Payment methods | Purchases; Limits & usage; API keys; API usage; Audit log;
  Integrations). Old ?tab= names redirect.
- **Customer API** `/api/v1/<resource>` with `chub_<prefix>_<secret>` keys (server/public-api/*): account, locations (+POST
  posts), reviews (+POST reply), insights, photos, gbp-posts, social-posts (+POST), site-scans (+POST), citations, /me,
  /openapi.json (docs at /developers). Limits: plan units/month (Starter 0, Pro 10k, Growth 50k, Agency 250k; reads 1 +
  1/100 rows, writes 5), 60 req/min per key, 300/min per account, max 25 active keys, optional per-key cap + expiry.
  **No AI through the API**: server/public-api/no-ai.test.ts walks transitive imports and fails on any AI module;
  server/public-api/guard.ts (mounted first in server/index.ts) rejects chub_ keys on every non-/api/v1 route; API-created
  posts/replies are stored as supplied (source=api). CRM `chk_` keys on /api/v1/customers etc. are unchanged.
- Known leftovers: lane-1 server/account/email.ts and lane-2 server/billing/invoices.ts are unused duplicates (safe to
  delete); course/service fulfilment on a retried checkout.session.completed is not idempotent (pre-existing).

## 💲 2026-09-30 — new price book + TruthCoder AI (deployed 23:45 UTC)
- **Price book** (owner decisions): Starter $29 / Pro $79 / Growth $199 / Agency $349 incl. 10 locations then
  $15 / $10 / $7 per location (quote above 500); annual = 10x; no free plan; 1-day trial (one per Stripe customer);
  add-ons (location $19, seat $15, protected site $15, texting $29 + $29 setup, competitor pack $39); Agency-only:
  agency workspace, Ads/LSA manager, Cloudflare + Search Console, Domains + Gmail alerts; anything >= $1,000 is
  "Talk to a sales rep" (enforced server-side, incl. SEO contracts); CRM included in every plan. Gold/Platinum and
  /individual-pricing are gone (301 to /pricing#add-ons). Legacy keys map via LEGACY_PLAN_MAP (the one Platinum
  row = the owner = Agency).
- **Source of truth:** `shared/plans.ts` (prices, limits, modules, add-ons, bands) + `server/entitlements.ts`
  (getEntitlements, requireModule, 402 plan_required / 403 limit_reached). Never hard-code plan names or prices.
- **Billing:** Stripe Prices are created on first use by lookup key (`chub_v1_…`, amount encoded). Plan/add-on
  changes update the existing subscription (no second checkout). past_due keeps access while Stripe retries —
  **owner must set Stripe → Billing → Subscriptions → Manage failed payments to cancel/mark unpaid**. Agency
  extra-location quantity syncs daily (production only; yearly subs invoice immediately).
- **AI = TruthCoder** (owner's decision): live `.env` has `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:8250/api`
  (truthcoder-webui on the same host, bypasses Cloudflare's 100 s cap), `AI_MODEL=truthcode-api` (the key's API model
  name; verified in the vb11 `.env` 2026-10-01 — it is not `truthcode:38`, which is the preset the key is scoped to),
  `AI_VISION_MODEL=huihui_ai/qwen3-vl-abliterated:8b`, `AI_TIMEOUT_MS=180000`, and the named TruthCoder key **"ConstructHUB"**
  (scoped to truthcode:38 + the vision model; issued by the owner 2026-10-01; rotating his personal key no longer affects it).
  Keys are managed at https://truthcoder.com/api-keys (named, revocable; built by Kimi in the TruthCoder project).
  This is an owner-approved cross-project coupling — record it in `~/HUB/registry.json → known_tower_couplings`.

## 👷 2026-09-30 — Gabe, the corner assistant (merged to main 2026-10-01 as `abaea7a`; **NOT deployed**)
- **Why the widget is not on the live site (2026-10-01):** constructhub.us still serves the bundle built at 11:49
  (commit `30356cc`, before the Hub merge at 23:17): it has no `hub-launcher`, `/api/hub/presets` falls through to the
  SPA catch-all, and `/mascot/*.webp` are missing. **A Cloudflare purge changes nothing** — `index.html` is
  `cf-cache-status: DYNAMIC` (never cached) and the JS bundle is content-hashed. To ship: merge `hub/gabe` (the Gabe
  persona + review fixes), `npm run build` on the tower (Node 20), then `bash script/deploy-vb11.sh` (pg_dump first).
  Verify: the new `/assets/index-*.js` contains `hub-launcher`, and `curl -I https://constructhub.us/mascot/gabe-160.webp`
  returns `image/webp`, not `text/html`. The widget now shows its launcher even when `/api/hub/presets` is missing
  (panel says Gabe is offline, with a retry), so a server/client mismatch is visible instead of silent.
- Replaces the old site assistant (`server/site-assistant.ts`, `site-assistant-chat.tsx` — both removed). Now fronted by Gabe (see the 10-02 entry above); originally a cartoon
  crew member in the bottom-right corner (`client/src/components/hub/`). **Signed out** (marketing pages): 14 preset
  question chips only, no text box; answers come from `hub_preset_answers` (generated in the background through
  TruthCoder, cached per question + knowledge hash) or from price-book templates — a tap never calls the model.
  **Signed in** (growth app + CRM portal): chips + free-text chat. Never on homeowner token pages, `/auth`, `/admin`,
  the client host, or the Google Ads pages (their consultant chat stays). First signed-in visit shows a welcome bubble.
- **No tools, no DB in the AI path**: the model sees only the rules, the public knowledge pack
  (`server/data/hub-knowledge.md`, prices filled from `shared/plans.ts` / `plan-copy.ts`) and the visitor's redacted
  words. Every guardrail is deterministic code in `server/hub/` (pre-filter, output filter, signed turns, budgets,
  breaker, provider pin) — the model (abliterated) is not trusted. Spec + red-team list: `server/hub/redteam-cases.json`.
- Endpoints: `GET /api/hub/presets`, `POST /api/hub/preset {presetId}`, `POST /api/hub/chat` (JSON + same-origin
  `Origin` required), `GET /api/admin/hub-stats` (platform admin; also a card on /admin). Logs: one line
  `hub: <outcome> <reason> <ms>`; `/api/hub` bodies are excluded from the request logger; `hub_stats` holds counts only.
- Env (all optional): `HUB_AI_HOSTS` (default `127.0.0.1:8250`) + `HUB_EXPECTED_MODEL` (comma-separated; default
  `truthcode-api,truthcode:38` — the live `AI_MODEL` is `truthcode-api`, and a pin of only `truthcode:38` would have
  booted Gabe with chat offline) — production refuses chat on any other provider; `HUB_AI_TIMEOUT_MS` (45 s cap), `HUB_GLOBAL_DAILY_CAP` (1500),
  `HUB_MAX_CONCURRENCY` (3), `HUB_TURN_KEY` (else derived from SESSION_SECRET), `HUB_WARM_PRESETS=false` to skip warming.
- Tests: `npx vitest run server/hub/` (unit + in-process routes with a stub model), Playwright
  `-c playwright.hub.config.ts` (needs a bypass-on and a bypass-off dev server), live eval `scripts/hub-redteam.ts`.
- **Owner to confirm on the TruthCoder side** (we don't change it): the "ConstructHUB" key's `truthcode:38` preset has
  no tools, knowledge/RAG, web search or memory, and API calls are not saved as chats. A bare request reports ~600
  extra prompt tokens, so the server appears to add its own system prompt to every call.

## 🚀 2026-09-30 — round-4 lanes + pre-launch QA (deployed 16:08 UTC)
- **Shipped:** agency mode + email onboarding (a1), Site Scan fix guidance (a2), Google Ads/LSA manager (a3),
  Social business selector (a4), Cloudflare + Search Console (a5; Global Key is exchanged for a scoped token and
  never stored), domain registrars (point/update only, no transfer code) + Gmail alert forwarding (a7). None of
  these check a plan yet — gate them when pricing is decided.
- **QA:** 44-agent click-through (400 confirmed findings) → 3 fix rounds → Kimi manual pass (38 findings) → fixed.
  Findings/results: tower scratchpad of session b63db1cc (qa/, kimi-qa/). Pricing reviews (Codex, Kimi, Claude +
  side-by-side) are in the same scratchpad `pricing/` — owner decisions pending (13 pricing-page items wait).
- **Deploy script** now (1) deletes stale hashed bundles in `dist/public/assets` (old bundles stayed downloadable,
  incl. paid Google Ads guide text now served only by `/api/google-ads-guide/:slug`) and (2) runs
  `npx playwright-core install chromium-headless-shell` — live permit search was failing because playwright-core
  1.62 wanted build 1234 while vb11 had 1243. Scrapers use `CHROMIUM_PATH` or the managed build (no Replit path).
- **Boot migrations that ran on prod:** state_guides link-status columns; permit rows re-pointed to real
  counties (27,971) with placeholders cleaned (32,549) and 139 seeded duplicates removed; UNIQUE (org_id, number)
  on crm_invoices/estimates/projects/commitments (skipped automatically on any DB that has duplicates).
- **DB sessions are pinned to UTC** (`server/db.ts`); prod Postgres is already UTC. Tests: `PGOPTIONS="-c TimeZone=UTC"`.
- **Browser tests need three servers** (scratch DB `constructhub_dev_a6`): CRM specs → `VITE_FORCE_PORTAL=true` +
  bypass on; growth specs → portal false + bypass on (+ `INBOUND_MAIL_DOMAIN/SECRET` for domains-mail); anonymous
  specs (growth-reviews, growth-round2, profile-guard-auth, account-security) → bypass OFF. The dev server drops
  page loads under 3+ parallel workers (static index.html shown); failing sweeps pass at `E2E_WORKERS=1`.
  `growth-round2 › real provider failure` needs Google Places unconfigured.
- Pre-deploy dumps: vb11 `~/backups/constructhub-predeploy-*.sql.gz`.

## 🧩 Features shipped 2026-09-30 (security, Profile Guard, AI replies, Posts & Photos, Social, Guides)
Reports: `analysis/FEATURE-a1.md` (security), `-a2` (Profile Guard + AI review replies), `-a3` (Posts & Photos),
`-a4` (Social via Blotato + Guides). Pre-deploy dump: vb11 `backups/pre-features-20260930T002817Z.dump`.
**Production keys in vb11 `~/ConstructHUB-live/.env` — back them up; losing one forces reconnects:**
`GBP_TOKEN_KEY` (32B base64; encrypts Google tokens AND authenticator secrets — lose it = all 2FA + Google
connections reset), `SOCIAL_ENCRYPTION_KEY` (64 hex; customer Blotato keys). `GBP_CONTENT_WORKER_ENABLED=true`
(publishes scheduled posts/photos). Photos reach Google via 1-hour HMAC-signed `/api/public/gbp-media` links
(no public bucket). Honest limits: Google can't be blocked from edits (Lockdown auto-reverts); no API to report
edits/reviews (we prefill Google's form); Google strips EXIF (geotags cosmetic). Blotato = customer's own paid
subscription + API key.

## 🔍 Full audit 2026-09-28 (deployed 09-29 00:17 UTC)
Summary + owner actions + ranked next work: `analysis/AUDIT-SUMMARY-2026-09-28.md` (lane reports
AUDIT-a1/a2-gbp/a3/a4 beside it). Pre-deploy DB dump on vb11: `backups/pre-audit-deploy-20260929T001714Z.dump`.
Open owner items: enable the 4 GBP APIs + register `https://constructhub.us/api/gbp/callback`;
Stripe `sk_test_` key for lanes; SignalWire signing key on vb11; Terms-vs-Privacy SMS wording; CRM
entitlement policy. Lane envs have Stripe secrets BLANKED (only a live key exists) — keep it so.
Browser suites need their own server env: CRM specs → `VITE_FORCE_PORTAL=true` + bypass (let
Playwright boot it); growth-reviews → bypass OFF; `playwright.gbp.config.ts` is pinned to lane a2.

## 🟢 Production host: vb11 (moved from vb7 2026-09-26 22:52 UTC, 194s downtime)
- **LIVE = vb11 `~/ConstructHUB-live`** — NOT vb11 `~/ConstructHUB` (that is a dev tree; never deploy prod there).
- Units (vb11 `systemctl --user`): `constructhub.service` (:8110), `constructhub-demo.service` (:8111,
  `~/ConstructHUB-demo`, its `node_modules` symlinks to the live tree), `constructhub-tunnel.service`
  (d8436ec8, `~/.cloudflared/config-constructhub.yml`), `constructhub-db.service` (dedicated PG16 cluster
  `~/ConstructHUB-live/pgdata`, **port 5433**, dbs `constructhub` + `constructhub_demo`). Node `/usr/bin/node`.
  `.env` at `~/ConstructHUB-live/.env`.
- **Deploy:** `script/deploy-vb11.sh` (replaces `deploy-vb7.sh`). SSH via the tower's `vb11` alias (key auth).
- **vb7 = fallback only:** its units are disabled and guarded (`AssertPathExists`), so restarting them fails
  on purpose. vb11 mirrors DB dumps + `tmp/` to vb7 every 15 min. Failover runbook: vb7 `~/ConstructHUB/FAILOVER.md`.
- Migration done by the infra session; full card: `~/HUB/projects/constructhub.md`. The "Live deployment"
  section below is the **vb7-era history** (2026-07-10 → 09-26).

## Live deployment (2026-07-10) — vb7 era, superseded 2026-09-26 (see above)
- **Host:** vb7 (`voiceban@50.125.203.201 -p 2252`, password auth via `~/.ssh/.vb_askpass` on the tower).
- **App:** `~/ConstructHUB` on vb7, port **8110**, systemd `--user` **`constructhub.service`**
  (`node --env-file=.env dist/index.cjs`, Restart=always, enabled; linger on).
- **DB:** local Postgres 16 on vb7, role/db `constructhub` (password only in `~/ConstructHUB/.env` on vb7).
  Schema via `drizzle-kit push` + `scripts/apply-schema-migration.ts`. Seeders ran clean:
  3,139 counties · 32,965 permit databases · 3,040 appraisers (2,314 with real portals) · 717 verified
  portals applied (58 unmatched by jurisdiction naming — known, honest fallback covers them).
- **Tunnel:** own named tunnel **`constructhub` `d8436ec8-5bcc-4864-92e8-9d178c1a34a6`**, creds
  `~/.cloudflared/d8436ec8-*.json` on vb7, config `~/ConstructHUB/tunnel/config.yml`,
  **`constructhub-tunnel.service`** (systemd --user). Created on the tower via `cloudflared tunnel create`
  (account-level op using `~/.cloudflared/cert.pem`); DNS via the account-wide DNS token
  (`~/ConstructHUB/secrets/cf_dns_token.txt`, chmod 600).
- **DNS:** apex + www = proxied CNAME → `d8436ec8-….cfargotunnel.com`. **Rollback snapshot** (incl. old
  Replit A `34.111.179.208`): `tunnel/dns-rollback/constructhub.us.json` + `~/HUB/dns-rollback/`.
  MX/TXT (Google mail, DKIM, verifications) untouched.
- **Secrets:** `.env` on vb7 (600) from `Construct_hub_secrets.txt` + **fresh** `SESSION_SECRET` and DB
  password (the Replit-leaked ones were NOT reused). R2 verified live (bucket `constructhub`, has user
  logo uploads). `R2_ENDPOINT`/`R2_BUCKET_NAME` set.
- **Deploy update flow:** `script/deploy-vb7.sh` (now `script/deploy-vb11.sh`, retargeted 2026-09-26) — builds on the tower, rsyncs `dist/` (`-azc`
  checksums; a plain `-az` once shipped a partial `dist/data/` and the appraiser seed silently
  skipped), **syncs `package.json`/`package-lock.json` and runs `npm ci --omit=dev` on vb7 whenever
  they differ** (2026-08-01: a deploy shipped `dist/` needing `pdfkit` without installing it — static
  pages kept serving while every `/api/crm/*` route was dead), restarts `constructhub.service`, then
  **verifies the boot** (service active, no "Failed to initialize"/"Cannot find module" in the
  journal, `:8110` 200, `:8110/api/crm/me` 401) and fails loudly instead of leaving a broken deploy
  live. Do not hand-roll rsync + restart — use the script.

## What was done (13 commits, all pushed)

### 1. Code review + fixes (8 findings, all critical ones)
High-effort multi-agent review found 10 verified defects; fixed:
- **Stripe webhook** trusted forged/unsigned events → now fails closed, verifies the raw body.
- **Cart prices** came from the client → resolved server-side via `server/catalog.ts`.
- **Hardcoded session secret** fallback → removed; boot fails in prod if `SESSION_SECRET` unset.
- **Auth bypass** shipped in the default env (`NODE_ENV=development`) → decoupled to an explicit
  `DEV_AUTH_BYPASS_USER1` flag; `.env.example` now ships `NODE_ENV=production`.
- **SSRF** in the Google URL resolver → host allowlist + IP-literal block.
- **Unauthenticated ranking-grid routes** → now require auth.
- **Contract signing** was 100% broken (a `ReferenceError` typo) → fixed.
- **Inverted scheduler filter** (review emails never sent) → fixed.
- Partial: ranking-grid per-user ownership needs a `user_id` column migration (flagged, not done).

### 2. Type + dead-code cleanup
- **112 → 0 tsc errors** (`npm run check` clean; root cause of the 43 schema errors was
  `.omit({id:true})` on `generatedAlwaysAsIdentity` columns — NOT a version mismatch).
- Removed dead `server/replit_integrations/` and scratch `test_pcpao*.ts`.

### 3. Government data rebuilt (the big one)
The data was fabricated: guessed `.gov` URLs, hash-generated phones/addresses. All removed.
- **Appraisers:** 4,485 real county assessment offices, all 51 states, **3,482 (78%) with a real
  verified portal**, 83% with a real phone — scraped from NETR Online → `server/data/appraisers.json`.
- **Permit portals:** **632 verified real portals across 49 states** (Accela, Tyler EnerGov, eTRAKiT,
  SmartGov, OpenGov, CityView, CitizenServe, …) — discovered by two Fable multi-agent workflows, each
  URL passed a liveness + permit-specificity gate → `server/data/permit-portals.json`.
- **Honest fallback:** every jurisdiction with no verified portal shows a "Find permit portal" web
  search link, never a fake URL.
- **Schema:** appraiser `portal_url`/`search_url`/`platform` made nullable; added
  `link_status`/`last_verified_at` to both data tables.

### 4. Verified end-to-end against real Postgres
Ran on a throwaway local Postgres: schema migration ✓, full seed ✓ (3,136 counties, 3,038 real
appraisers, 319 permit rows with real portals), fabrication gone (permit phones 0) ✓, link verifier
✓ (64 live / 0 dead), API queries return real data ✓.

## Current state
- **LIVE at https://constructhub.us** (see "Live deployment" above). `npm run check`: **0 errors**.
  `npm run build`: **passes**. Tower pre-commit guard: clean on all commits.
- DNS was cut over from the old Replit deployment (Google Frontend `34.111.179.208`) on 2026-07-10;
  the Replit app + its DB were left untouched and still exist for the user-data export.
- **CRM (portal.constructhub.us): feature-complete per the owner's field notes and QA'd — see
  "CRM state (2026-08-24)" below.** Last full run: 505/505 vitest, 190+ e2e green.

## CRM state (2026-08-24)
The CRM was built out and hardened across 2026-08-01 → 08-24 (~60 commits; three multi-agent Kimi
sweeps whose reports live in `analysis/KIMI-*.md`). Shipped and live:

- **Communication:** notification bell + per-type In-app/Email/Text matrix (Settings); Messages
  center — two-way client threads with unread counts, waiting timers, assigned-member routing
  (job PM → sales → estimate writer); client portal Messages + Contact-us tab (assigned team w/
  direct lines) + contact footer; estimate "Ask a question" box.
- **Workflow:** editable month/week calendar (appointment CRUD, conflict warnings, auto-navigates
  to a new visit); pipeline with lead create/edit + true per-stage counts; Home stat cards,
  Team Activity, follow-up cadences; client page = HUB (schedule/pipeline/estimate/payment quick
  actions); Project Photos (PM uploads, progress/finished tags, visible in the client portal).
- **Money/docs:** estimate detail/editor — per-line scope & verbiage that renders on the client
  doc, **edit + delete after send** (client link updates, no re-send; signed = locked 409);
  price-book templates; FL/WA division letterheads; take-a-payment (manual recording live;
  online = Stripe checkout link, degrades 503 until the owner's Stripe is verified).
- **Platform:** `/admin` standalone console behind a credential gate (`ADMIN_GATE_USER/PASS` in
  vb7 `.env`); consent-gated first-party analytics + cookie banner; CRM gateway on the growth
  sidebar (`/crm-app`, separate membership); HOVER auto-sync (6h default) — every job creates/
  links a client + imports capture photos (9k+ photos imported).
- **SMS/10DLC (the strategy — do not regress):** carriers ban platform-texting-for-others, so the
  shared number texts ONLY ConstructHub's own users (contractor account notifications) — the model
  SignalWire accepted 8/18. Client texting requires the org's OWN number (`orgCanTextClients`);
  STOP/HELP/START webhook `POST /api/crm/sms/inbound` + `crm_sms_optouts` suppression; consent
  stamps + Privacy §5; optional voice "check your email" nudge (no 10DLC needed). Registration
  materials submitted 2026-08-22; approval pending.
- **Kimi lane workflow:** worktrees `~/ConstructHUB-a{1,2,3}` (ports 8129/39/49, DBs
  `constructhub_dev_aN`, sanitized `.env`); launch `kimi -p "$(cat KIMI-X.md)"` via setsid; check
  `git log main..lane/aN` AND `git status` (Kimi sometimes leaves work uncommitted). New e2e specs
  run in the lane harness (`E2E_PORT`/`E2E_DB`), not against a hand-started 8119. Beware stale tsx
  processes on 8119 serving old code — verify `/proc/<pid>/cwd`, restart, clear `node_modules/.vite`.

## Replit user-data export (pending — the one migration left)
The old Replit deployment HAD real users (their uploaded logos are in R2 bucket `constructhub`).
The new vb7 DB started fresh, so their accounts/purchases don't exist on the live site until this runs:
- Export only the **user-generated tables** from the Replit DB (`users`, `subscriptions`,
  `course_purchases`, `service_purchases`, `search_queries`, `business_locations`, `citations`,
  `review_requests`, `seo_contracts`, click/tracking tables) and load them into vb7's Postgres.
- All reference data (counties, cities, appraisers, permit portals, state guides) regenerates from
  code — never copy it from Replit.
- Blocker: the Replit `DATABASE_URL` was Replit-injected and is not on this box — the owner must pull
  the export from the Replit side (or copy that env var out of the Replit Secrets pane).

## Secrets
- Live secrets: `~/ConstructHUB/.env` on **vb7** (mode 600); tower copy at `~/ConstructHUB/.env`, both
  built from `~/Construct_hub_secrets.txt`. `.env.example` documents every key.
- `SESSION_SECRET` and the DB password on vb7 are **fresh** (generated at deploy, never in Replit).
- **⚠️ ROTATE THE REST** — Stripe, Google, R2, SMTP sat in the old Replit git history. Needs the
  provider dashboards (owner). `~/ConstructHUB/secrets/cf_dns_token.txt` = account-wide Cloudflare
  DNS token (owner-authorized shared account credential; see the tower memory note
  `cloudflare-account-access`).

## Env vars the app needs (see `.env.example`)
`DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `PORT`, Google OAuth
(`GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_PLACES_API_KEY`), Google Ads/LSA, R2 (`R2_*`), SMTP (`SMTP_*`),
Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), OpenAI (`AI_INTEGRATIONS_OPENAI_*`).
Canonical link bases (production): `PORTAL_URL=https://portal.constructhub.us`,
`CLIENT_URL=https://client.constructhub.us`, `APP_URL=https://constructhub.us` — when set they win
over Host-header derivation for every generated link (invites, magic links, doc emails).
Local dev only: `DEV_AUTH_BYPASS_USER1=true` (never in prod).

## Re-running / extending the data pipelines
- More appraiser refresh: `npx tsx scripts/scrape-netronline.ts` (resumable).
- More permit portals: add candidates + `npx tsx scripts/build-permit-portals.ts` (or run another
  discovery workflow → `server/data/_permit-candidates.json` → the same script verifies + merges).
- Periodic dead-link sweep (needs `DATABASE_URL`): `npx tsx scripts/verify-links.ts`.

## GBP API access timeline (Google Business Profile / "GMB" API)
The GMB features (GBP analytics, review management, competitor intel) need Google to grant GBP API
access. **✅ APPROVED 2026-09-23** (application #3, case `1-4033000042334`) — project `90021415768`
(`construction-hub-489119`) granted the default 300 QPM quota. Remaining activation step: enable the
Business Profile APIs in that project's API Library (owner console click — no gcloud/service-account
creds exist on any box). ⚠️ Google policy rider from the approval email: **no public statements or
press releases suggesting partnership/sponsorship/endorsement by Google** without prior written
approval. **2026-09-28: `SHOW_COMPETITOR_INTEL` and `SHOW_GOOGLE_REVIEWS` turned back ON and deployed**
(commits 19d15fd, 7ba311a, 22d63d6). The Google Reviews flow was made compliant first: every rating is
offered the Google review option, no reward is tied to a review (the +1% review bonus and the $5,000
drawing were removed; the 3% referral program stays, decoupled), no Yelp ask, and the "zero bad reviews"
explainer was rewritten. Competitor Intel copy says "public ad activity", never "spy". Google re-audits
sensitive-scope apps, so **never reintroduce review gating, review incentives or surveillance wording.**

| Date | Event |
|---|---|
| before 2026-03-09 | Application #1 submitted (exact date not on this box — it's in the alpinesidingcompany Gmail, case `7-1260000039820`) |
| 2026-03-09 23:07 | **Rejected** — "did not pass our internal quality checks"; likely cause per Replit-agent notes: competitor-surveillance marketing on the site |
| 2026-06-20 ~01:00 ET | Application #2 submitted (Replit era): consent-screen branding verified 12:47 AM (project `gmb-profile-500003`), official form filled ~1:02 AM; sensitive scope `business.manage`; Competitor Intel + review-gating hidden behind flags for the reviewer |
| 2026-07-09 | **Rejected again** (Alpine-account application). Google's stated criteria: requester email must be Owner/Manager of a Business Profile **verified ≥60 days**; website URL on the application must **match** the profile's listed website (official own-domain site) |
| **2026-09-08** | ~~Reapply window opens~~ (prior-session interpretation of "60 days from the 7/09 rejection"; Google's only documented 60-day rule is profile-verification age, already met — so we applied early). Note: the reminder routine id once recorded here (`trig_015TqJmLWrrjh2Ujm7cwJek3`) never existed — 404 verified 9/04 |
| 2026-09-04 | **Application #3 submitted** — case `1-4033000042334`, as `support@constructhub.us` (Primary owner of the "Construct HUB" GBP, ~80 days old, website constructhub.us), project number `90021415768` (`construction-hub-489119` — the same project serving the live site's Google OAuth). Same day, pre-submission: public pricing/vpn-shield/master-class pages scrubbed of "Ad Spy / BS Meter / spy on your site" marketing (ported to this repo as `fb9245d`) |
| **2026-09-23 06:48 ET** | **✅ APPROVED** — "your project (90021415768) has been approved to use the Google Business Profile API", default quota 300 QPM. Next steps per email: activate the API in the Cloud Console API Library. Policy rider: no public statements implying Google partnership/endorsement |

⚠️ The 60-day clock is on the **Business Profile's verification date**, not the rejection: if the GBP
profile that will back the application was verified after 2026-07-10, wait until *its* verification
date + 60 days. Evidence for all of the above: Gmail screenshots in `attached_assets/`
(`Screenshot_2026-06-19_215545_*.png`, `image_17819205*.png`, `image_17819315*.png`, `image_17819317*.png`),
`.agents/memory/competitor-intel-flag.md`, `replit.md`, `client/src/lib/features.ts`.

## Business records (not in git)
- **EIN assignment letter (IRS):** `~/ConstructHUB/private/EIN_ConstructHUB.pdf` on the tower.
  `private/` is gitignored — business documents never reach GitHub. Captured by the 48h 3-tier
  backup (internal `/mnt/data/site-backups/constructhub/*.code.tgz`, external, R2), so it survives
  a tower loss. Needed for: A2P 10DLC brand registration, Stripe business verification, banking.

## Open items
- [x] **SignalWire 10DLC campaign APPROVED 2026-08-26 — SMS LIVE 2026-08-27.** Campaign
      `ConstructHUB CRM Notifications` (`e51c79fa-…`) is active with +13605857553, +17278705005 and
      +12078862206 attached. Prod `SIGNALWIRE_FROM_NUMBER` switched to **+13605857553** — the old
      +13605858200 is a `messaging_integration_test` number SignalWire will not attach to a campaign.
      Test send to the owner's phone returned `delivered`. Opt-in screenshots: `private/signalwire-10dlc/`.
- [x] **Inbound STOP/HELP webhook** `https://portal.constructhub.us/api/crm/sms/inbound` set on all
      three campaign numbers via `PUT /api/relay/rest/phone_numbers/{id}` (2026-08-27); HELP reply verified.
- [ ] **Owner: install the SignalWire signing key.** SignalWire signs inbound webhooks with the
      project *signing key* (Dashboard → API Credentials → Signing Key → Show), not the API token — the
      app was 403'ing real carrier STOPs until 2026-08-27 (fixed: accepts + warns when the key is unset).
      Add `SIGNALWIRE_SIGNING_KEY=…` to vb7 `~/ConstructHUB/.env`, `systemctl --user restart constructhub`,
      then text STOP/START to +13605857553 from any campaign number and confirm 200s in the journal.
      Real STOP → suppression → START round-trip verified end to end on 2026-08-27.
- [ ] **Owner: Stripe payout verification** — unlocks live card/ACH capture for take-a-payment
      (currently clean 503 + manual recording).
- [ ] **Owner: HOVER measurement-file API access** — HOVER 401s all deliverable formats for API apps;
      ask HOVER support to enable. Unlocks sqft + report PDFs for auto-estimates (code ready).
- [ ] **Owner: attorney review** of CRM Terms/Privacy (incl. the new SMS §5).
- [ ] **Owner: Alpine Exteriors has TWO divisions both named "Alpine Exteriors"** (`c3c712bb…` with
      5 projects + Braxton; `5c48ea4c…` with 59 projects + Andrey/Mike). Division scoping is STRICT, so
      Braxton (admin, pinned to the small one) sees only 5 of 64 projects and none of the other arm's
      visits. Merge the divisions or unpin Braxton's `division_id` in /crm/team — a data decision, not code.
      (2026-08-24: the related "calendar isn't saving" report was a code bug, fixed + deployed — unlinked
      appointments were hidden from scoped members; see `appointmentDivisionVisible`. Same day, second
      report "scheduled from the client page, not on my schedule": customer-only appointments inherited
      the customer's inferred division (null for Braxton's test client) and were hidden from the creator.
      Rule now: project-linked = strict; customer-only + unlinked = every member. Fixed + deployed.)
- [ ] Design decisions flagged by audits: multi-org homeowner portal binding (`accounts[0]`),
      expired estimates not counted in client bid tabs, org-wide stats vs divisions,
      adopt `eslint-plugin-react-hooks` (the pipeline blank-screen class).
- [x] **GBP API access — APPROVED 2026-09-23** (application #3, case `1-4033000042334`; timeline above).
- [ ] **Enable the Business Profile APIs** in project `construction-hub-489119` (owner console click,
      links in the timeline section) — then build the GBP integration (OAuth scope `business.manage`,
      account/location listing, info edits, review display + owner replies, performance metrics).
- [x] Deploy — **DONE 2026-07-10** (live at constructhub.us, see "Live deployment").
- [ ] Rotate secrets (Google, SMTP, R2 — provider dashboards; SESSION_SECRET + DB pw already fresh).
      **Stripe: superseded by the cross-wire item below — the leaked key was GGG's, rotate it on the
      GGG side.**
- [x] **2026-08-01 STRIPE CROSS-WIRE — RESOLVED same day.** The `.env` keys were GGG's account;
      owner minted a fresh `sk_live_…` from the real **acct_1TzcYU9yWcdekSaP**, installed
      tower+vb7, BOTH webhook endpoints recreated under it with fresh secrets, fail-closed
      verified, Connect OAuth round-trip confirmed (Alpine Exteriors linked, direct charges +
      Stripe Checkout working end-to-end). **Still open on the GGG side: rotate GGG's leaked
      Stripe key (sat in Replit git history) — GGG-project task.**
- [x] CRM Stripe Connect **client id** — **DONE 2026-08-01.** Platform profile completed (Platform /
      direct charges / Stripe-hosted onboarding / Stripe carries risk), OAuth enabled,
      `STRIPE_CONNECT_CLIENT_ID` (`ca_Uzc1…Rsgf`, correct acct) on tower + vb7.
- [x] CRM Connect **OAuth redirect URIs** — **DONE 2026-08-01** (owner added all 3 callback URIs in
      the dashboard; portal.constructhub.us is Default).
- [ ] Stripe account banner "**Action required** — provide info to keep payouts enabled" — owner,
      Stripe dashboard → View task (business/identity verification).
- [ ] Real OpenAI key — `AI_INTEGRATIONS_OPENAI_API_KEY` is a boot-safe dummy; AI consultant/assistant
      endpoints error until a real key is set (Replit's modelfarm proxy no longer exists).
- [ ] **Export real user data from Replit** — see the "Replit user-data export" section above for the
      table list and the `DATABASE_URL` blocker. The Replit app + DB were left untouched.
- [ ] Ranking-grid per-user ownership (`user_id` column migration) — deferred from the review.
- [ ] Optional: keep expanding permit-portal coverage past 632 (pipeline is built for it).

## Call Assistant (AI phone receptionist) — infra, 2026-10-02

Spec `docs/call-assistant/SPEC.md`, runbook `docs/call-assistant/RUNBOOK.md`, lane notes `LANE-NOTES-*.md`.
Built in lanes on `voice/*` branches; not deployed to production by any lane.

- **Where it runs:** the Python engine (`voice/`) on the **tower GPU** as the user unit
  `constructhub-voice.service` (`127.0.0.1:8152` + tailnet `100.90.145.13:8152`). The vb11 app proxies
  `https://constructhub.us/voice/*` to it (`server/voice/proxy.ts`: raw HTTP + the media WebSocket; 503
  JSON when the engine is down). No new DNS/tunnel entries.
- **Units/ports on the tower:** `constructhub-voice` :8152. `alpine-voice*` (:8150/:8151) are another
  project's — never restarted, never read.
- **Secrets (names only):** `VOICE_INTERNAL_SECRET` — same value in the app `.env` (vb11) and in the tower's
  `voice/.env` (gitignored). App: `VOICE_ENGINE_URL`, `VOICE_PUBLIC_BASE`, `VOICE_PROXY_TIMEOUT_MS`. Engine:
  see `voice/.env.example`. Rotation steps in RUNBOOK §7.
- **The restart-when-idle rule:** never `systemctl --user restart constructhub-voice` by hand; use
  `bash voice/deploy/restart-when-idle.sh` (waits for `activeCalls == 0`; unit `TimeoutStopSec=620`).
- **Install/update on the tower:** `bash voice/deploy/install.sh` (venv, requirements, `.env` from example,
  model warm-up, unit). Health: `bash voice/deploy/healthcheck.sh https://constructhub.us`.
- **Owner-pending:** pricing confirmation (SPEC §14), the single `constructhub-test` number (numbers lane),
  and the Alpine cut-over of +1 360-585-8200 (RUNBOOK §10 — owner decision only).
- **Dev stage currently on the tower:** engine from `~/ConstructHUB-voice-infra/voice` via a systemd drop-in +
  a dev app on :8201 (RUNBOOK §11, teardown steps there).
