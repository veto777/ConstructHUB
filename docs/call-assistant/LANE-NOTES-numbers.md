# Lane notes — numbers+billing

Branch `voice/numbers` (from `voice/skeleton` ca72128). What this lane added beyond SPEC.md, and what the
integrator and the other lanes need to know.

## Contract extensions (inside this lane's files)

- **`GET /api/crm/voice/numbers`** also returns `nextNumberMonthlyCents`, `minDays`, `webhooks`
  (`voiceWebhookUrls()`), `configured` (SignalWire creds present or the mock on), `mock`, `canManage`.
  `allowance` = `{ numbers, used, remaining, includedNumbers, extraNumberMonthlyCents }`.
- **`GET /numbers/search`** also takes `contains` (SignalWire `Contains`), caps `limit` at 20, and returns
  `{ numbers, monthlyCents, allowance, mock }`: `monthlyCents` is what the next number would cost
  (0 = included, else the `call_number` price).
- **`POST /numbers`** also takes `state` (two-letter, validated), `locality`, `forwardingFrom` (any US format →
  E.164). Responses: `201 { number, mock }` · `400` bad input · `403 limit_reached` (`feature:"voiceNumbers"`,
  `addon:"call_number"`) · `409 number_taken` (held anywhere, or a second `constructhub-test` number) ·
  `503 signalwire_unconfigured` · carrier refusal `400/404/409 signalwire_error` (nothing bought, reservation
  dropped) · carrier 5xx/timeout `502 signalwire_error` — the row is kept as **`failed`** with `last_error`
  ("Purchase not confirmed … check SignalWire"), so a purchase that may have gone through is never forgotten.
- **`DELETE /numbers/:id`** on a `failed` row (or a `pending` row older than 10 min) **dismisses** it without
  calling the carrier: `200 { released:false, dismissed:true, message }`. Release always goes through the
  carrier that holds the row (`provider`), never the env, so `VOICE_NUMBERS_MOCK` can't "release" a real number.
- **`PATCH /numbers/:id`** refuses the reserved label `constructhub-test` (400).
- **`GET /status`** adds `addon.monthlyCents`, `addon.extraNumber`, `units`, `pricing.numberMinDays`,
  `numbersProvider { configured, mock }`, `canManage`, and (with the add-on) `numberAllowance` and
  `profile.setupCompletedAt/updatedAt`. **`GET /usage?month`** returns the month's summary +
  `allowance` + `history` (12 months, newest first).
- **Env (app):** `VOICE_NUMBERS_MOCK=true` — dev boxes / e2e only: an in-memory carrier, rows get
  `provider='mock'`, every response says `mock:true`, the UI shows "Mock carrier". `VOICE_OVERAGE_WORKER_ENABLED=true`
  — production only, turns on the overage sweep. Both belong in the `.env.example` voice block (architect /
  infra own that file; not edited here).

## For the calls+crm lane

Call this from the end-of-call report (`PUT /api/voice-internal/calls/:callSid`), once per call (make it part of
your idempotency — the meter itself is not idempotent per callSid):

```ts
import { recordVoiceCallUsage } from "./billing-usage";
await recordVoiceCallUsage({ orgId, accountUserId: org.ownerUserId, outcome, durationSeconds, billedMinutes, at: startedAt });
```

`blocked` counts a call and 0 minutes; `spam` counts minutes and `spam_calls`. Minutes = every started
minute (`billedMinutesFor`). A call is never refused for minutes; above the included minutes it is overage.

## For the integrator (architect-owned files this lane did not touch)

1. **Wire the overage sweep** in `server/index.ts` next to `startAgencyLocationSync()`:
   `import { startVoiceOverageWorker } from "./voice/billing-usage"; startVoiceOverageWorker();`
   It stays off unless `NODE_ENV=production`, `STRIPE_SECRET_KEY` and `VOICE_OVERAGE_WORKER_ENABLED=true`.
2. Add `VOICE_NUMBERS_MOCK=` and `VOICE_OVERAGE_WORKER_ENABLED=false` to the `.env.example` voice block.
3. **Proposal for `server/voice/schema.ts`:** `voice_numbers.phone_number` is `UNIQUE` table-wide, so re-buying a
   number that an org once released deletes the old released row (its label disappears from old call rows that
   point at it by `number_id`; `voice_calls.to_number` still shows the number). Better: drop the column UNIQUE and
   add `CREATE UNIQUE INDEX … ON voice_numbers(phone_number) WHERE status <> 'released'`. Until then the
   delete-on-rebuy stays (numbers.ts, POST).
4. `client/src/pages/settings/limits-usage.tsx` now renders an "AI Call Assistant" group (minutes + numbers) on
   plans that sell the add-on, and shows **preview** add-ons with a "Coming soon" badge and disabled +/- (the
   checkout refuses them anyway). `LIMIT_ROW_KEYS` gained `callAssistantMinutes`, `callAssistantNumbers`.

## Billing decisions (PLACEHOLDER pricing unchanged — owner must confirm SPEC §14)

- Buying the add-on is the existing machinery (`POST /api/stripe/addons` → `checkAddonsForPlan` → standard add-on
  price `chub_v1_addon_call_assistant_<interval>_<cents>`). `preview: true` still refuses it (409
  `addon_unavailable`); dropping the flag in `shared/plans.ts` is the only switch, on the owner's word.
- Reducing `call_number` below the numbers held does **not** release numbers (carrier minimum + forwarding);
  the Numbers tab then shows "every number in use" and the owner releases one. Worth a sentence on Billing later.
- Overage: invoice item with `pricing.price` on a one-time price `chub_v1_meter_call_minutes_<cents>` (created
  lazily, `metadata.chub_kind="meter"`, ignored by `roleOfPrice`). Monthly subscriptions: attached to the
  subscription's next invoice. **Annual** subscriptions: the item is invoiced immediately (otherwise it would wait
  up to a year). Idempotent per (org, month, running total). Verified only against a fake Stripe in tests —
  **never against Stripe test mode**.

## SignalWire / the one real test number

`~/ConstructHUB-a5/.env` (and `~/ConstructHUB/.env` on the tower) hold **no `SIGNALWIRE_*` variables**, so no real
search or purchase was possible: **no number was bought**, everything is mocked (stub carrier in tests,
`VOICE_NUMBERS_MOCK` in the UI smoke). The LaML client is unverified against the real API beyond its documented
Twilio-compatible shapes. Launch step (SPEC §18.5): with the creds on vb11 and the engine reachable through the
proxy, buy the single test number in the Numbers tab with label `constructhub-test` (state WA).
