# Tutorial fixtures — stand-ins for outside accounts, in recording slots only

Some pages only show something once an outside account is connected: Stripe, HOVER, Google Calendar, a
texting number. The demo workspace has none of those accounts and never will (owner, 2026-10-08:
*"with all the accounts you need to make dummy pages! I will not be adding dummy accounts everywhere
and thats not even possible on google!"*). So, **in a recording slot and nowhere else**, a *fixture*
stands in for the provider: the product's real page and real server code run, and the provider's
answers come from this machine.

This is invented data. The project's hard rule is that invented data never reaches a real user
(`CLAUDE.md`). Read "The safety gate" before touching anything here.

Code: `server/tutorials/fixtures/` · seed: `scripts/tutorials/seed-fixtures.ts` · tests:
`server/tutorials/fixtures/fixtures.test.ts`, `server/tutorials/recorder-actions.test.ts`.

## The safety gate (`server/tutorials/fixtures/gate.ts`)

`tutorialFixturesOn()` is true only when **all** of these hold:

1. `TUTORIAL_FIXTURES=1`;
2. `NODE_ENV` is not `production`. The production build compiles `process.env.NODE_ENV` to the literal
   `"production"` (`script/build.ts`), so in `dist/index.cjs` the gate is a constant `false` whatever the
   environment says;
3. `DATABASE_URL` is `127.0.0.1` / `localhost`, port `5432` (5433 is production on this box), and is a
   recording database: a database `constructhub_tut_*`, or `constructhub_dev` with a `search_path` of
   exactly one `constructhub_tut_*` schema (never `public`);
4. the process was started by the line: `TUTORIAL_SLOT` is 1–8 and `PORT` is that slot's port, 8180 + slot.

`TUTORIAL_FIXTURES=1` with anything else wrong is a misconfiguration that must not run:
`server/tutorials/fixtures/boot-guard.ts` is the **first import** of `server/index.ts` and exits (code 78)
with `REFUSING TO BOOT: …` and the list of what failed — before a route, a pool or a provider client exists.

Everything goes through **one registry** (`registry.ts`). With the gate off: `providerFixture(id)` is
`null` for every provider, no `/__tutorial/…` route is mounted, no boot hook runs, no helper works even
when called directly, and `seed-fixtures.ts` refuses to write. The tests assert each of those, plus:
feature code imports only the public face (`server/tutorials/fixtures`), at the listed seams; the client
has no fixture branch at all; the real Stripe webhook has exactly one signature check and no bypass.

In a slot, three more things hold:

- fixture routes answer **this machine only** (loopback, no forwarded headers) and sit outside `/api`,
  so the request log never prints them;
- an **egress guard** refuses any server-side `fetch` that would leave the machine — a provider nobody
  wrote a fixture for fails loudly instead of reaching the real service;
- rows a fixture writes are **marked**: ids start `tutfx-`, the stand-in payment account is
  `acct_tutfx…`, sessions / intents / charges / events carry `tutfx`, HOVER jobs are `hover:tutfx-…`
  (`FIXTURE_MARK`, `fixtureMarked()`). A payment made through the stand-in checkout gets the product's
  own row id; its `stripe_account_id` and provider ids carry the mark.

## What each fixture simulates, and the seam it hooks

A seam is the narrowest place the feature code already asks for its provider. No page is forked: the
client does not know a fixture exists.

| Fixture | Simulates | Seam (feature code) | How it answers |
| --- | --- | --- | --- |
| `stripe` | The demo company's connected Stripe account; checkout sessions; the events that settle a payment (paid by card, bank debit processing → cleared, failed, refunded) | `server/crm/payments.ts` and `server/crm/integrations.ts`: the module-level `stripe` client, Connect client id, Connect webhook secret | **The real Stripe SDK** with an HTTP client that answers locally (`Stripe.createFetchHttpClient`). A session's `url` is a local stand-in page, `/__tutorial/stripe/checkout/<id>` |
| `hover` | A connected HOVER account with three completed measurement jobs (FL, NY, TX): summary, PDF, one drawn photo each | `server/crm/hover.ts`: `hoverBases()`, `hoverConfigured()`, client id / secret | A stand-in HOVER API served by the slot itself (`/__tutorial/hover/…`); the product's own token refresh, job walk, client matching and import run against it at boot |
| `google-calendar` | A connected company calendar ("ConstructHub CRM"), last synced this morning; **Sync now** really diffs and writes | `server/crm/calendar.ts`: client id / secret and `googleFetch` (token, Calendar v3, revoke) | An in-memory calendar |
| `sms` | A texting carrier: the platform sender, plus the company's own number **+1 941 555 0100** (what allows texting clients) | `server/crm/sms.ts`: `smsMissingEnv()`, `platformSender()`, the `fetch` in `signalwireSend()` | Each text is appended to the slot's `sms-outbox.jsonl` and gets a message id — nothing is sent. Plan checks, opt-outs and the monthly allowance run as in production |
| `email` | The recipient's inbox | `server/email.ts`: `sinkToOutbox()` (the existing dev sink) hands each message to the fixture | Keeps the last 60 messages in memory so the recorder can open the link in one, as the recipient would |
| `auth` | A second signed-in person: one of the demo company's own team members | none in feature code — a local route that calls passport's `req.login()` (the dev bypass yields to a real session) | `/__tutorial/auth/as?member=<Display Name>` |
| `search-console` | **Skeleton, not wired** — a verified property `gatorbuilders-demo.example` with 28 days of performance by date, query and page | `SearchConsoleClient(token, http)` / `gscToken(c, http)` already take the fetch to use | Tested data and handler; see "Adding a provider" |

### The stand-in checkout page

Stripe's hosted checkout cannot be shown, so a checkout link opens a plain page titled "Secure checkout":
payee, what for, amount, "Bank account" / "Card", a Pay button, and the line *"Demonstration checkout
page — no real payment is taken."* It copies **nothing** of Stripe's name, logo, colours or layout (a
test checks the word does not appear on it). Narration says it is a stand-in.

Pay builds the event Stripe would send (`checkout.session.completed`), **signs it** with a webhook secret
that is random per process, and POSTs it to the product's real endpoint, `/api/crm/stripe/connect-webhook`.
The handler verifies the signature exactly as in production (`stripe.webhooks.constructEvent`) — an
unsigned or wrongly signed request is refused in a slot too — then the real ledger, receipt, notification
and invoice status code run. A card settles at once; a bank payment completes as *processing* until
`stripe.settle`.

### What the seed adds (`scripts/tutorials/seed-fixtures.ts`)

After `seed-demo.ts`, one transaction of rows only, idempotent, additive (it never changes a row of
`seed-demo.ts`, an invoice or an estimate):

- the connected payment account (`tutfx-payacct-01`, cards and bank on);
- five online payments, amounts a share of each job's contract value — paid by card (Hadley, Austin TX),
  paid by bank (Oyelaran, Albany NY), bank debit processing (Ellison, Venice FL), refunded (Nguyen, FL),
  failed (Quintanilla, Houston TX);
- the Google Calendar connection, the company texting number and the owner's texting consent — only
  where the workspace has no such setting yet;
- a marker asking the slot app to connect HOVER at boot (its token is encrypted with each slot's own
  secret, so it cannot be seeded).

`produce.ts` and `app.ts up` run it on every fresh slot database. `db.ts template` runs it when the
template is built; `db.ts reseed --fixtures` applies it to the existing template under the exclusive
template lock (do that only once every producer's working copy has this code — a copy without it would
list five online payments on a page that still says "not configured").

## Recorder actions that use fixtures (`fixture` and `session` steps)

`POST /__tutorial/action/<provider>.<action>` — the recorder calls it from Node, by address.

| Action | Input | What it does |
| --- | --- | --- |
| `stripe.checkout` | — | The newest open checkout's address (for the client's browser: `"open": true`) |
| `stripe.pay` | `method`: `card` / `ach` | Pays the newest open checkout without showing the page |
| `stripe.settle` | `paymentId?` | A processing bank payment clears ("a few days later") |
| `stripe.fail` | `paymentId?`, `reason?` | A pending / processing payment is declined |
| `stripe.refund` | `paymentId?`, `amountCents?` | Refunds a paid payment, whole or part |
| `email.link` | `to`, `match?`, `subject?` | The link in the newest email to that address — "View estimate", an invoice, a change order, an invitation, a photo gallery |
| `email.signIn` | `to`, and optionally `invoice` or `estimate` (its number) | Asks for the client's sign-in link through the product's own route and hands it over — start a homeowner's session already signed in |
| `email.opened` | `estimate` or `invoice`, `minutesAgo?`, `visits?`, `seconds?` | Marks a **sent** document opened by the client at an earlier time: the same rows the public page writes on a real open |
| `email.count` | `to` | How many emails that address has received |
| `email.changeOrder` | `title?`, `client?` | The client's page of a change order (`/co/<token>`) — the newest one marked sent, or the one named. "Mark sent & copy link" emails nothing, so `email.link` has nothing to open; this hands over the link the button copies. A draft is refused |
| `auth.unfinishedSetup` | — | The demo owner's first day: clears the owner's own mobile number and the checklist's "dismissed" stamp in this slot's copy, so Home shows "Finish setting up". Run it from the script's `before` list (off camera); the video fills the number back in |
| `sms.inbound` | `from` (a `+1XXX55501XX` number), `body`, `to?` | A text arrives, posted to the real carrier webhook |
| `sms.last` | — | The last text the slot "sent" |
| `google-calendar.events` | — | How many events the stand-in calendar holds |

A script's `"before": [{ "fixture": "auth.unfinishedSetup" }]` runs helpers before the camera starts —
for the state a video begins in, never to stage what it then shows.

"Advance time" is done by the action that moves the thing forward — `stripe.settle`, `email.opened` —
not by changing the clock: the slot's clock is real.

**The product decides what an inbound text does.** STOP / START / HELP are handled; a client's free-text
reply is not threaded into Messages today. A video must not suggest it is.

## Adding a provider (Google Business Profile, Google Ads, Search Console, Cloudflare, SEO data, Site Scan)

`providers/search-console.ts` is the worked skeleton. For each provider:

1. **Find the seam** — the client class or `fetch` the feature already calls. Prefer an injectable one
   (`SearchConsoleClient(token, http)` takes its fetch). Never fork the page or the route.
2. **Write `providers/<id>.ts`**: `defineProviderFixture({ id, simulates, seam, adapter, routes?, actions?, onBoot? })`.
   The adapter's `fetch` answers the provider's hosts; every handler starts with
   `requireTutorialFixtures(...)`. Deterministic data — a formula, not `Math.random()` — so a re-record
   shows the same screen. Add one `import` line to `index.ts`.
3. **One line at the seam**: `const fx = providerFixture<XFixture>("<id>")`, used only when not null.
4. **Connection state**: rows in `seed-fixtures.ts` (marked ids) — or `onBoot` when the row holds something
   encrypted with the slot's own secret.
5. **Tests**: add the seam to the list in `fixtures.test.ts` ("feature code reaches a fixture only
   through the registry"), and assert the content rules below.
6. **Operate the page in a slot before writing a word of narration.**

## What must never be fixtured

- **Government data.** No appraiser office, permit portal, phone, address or record — the permit
  directory uses real, verified data and stays that way. The fixture tests refuse `.gov`, permit and
  appraiser tables in fixture code.
- **A real company, person, address, phone or email.** `example.com` / `.example` only, phones
  `555-01xx` only, the demo company and the demo clients of `seed-demo.ts` only.
- **A provider's own screens.** Stripe's checkout and Connect onboarding, Google's consent screen,
  HOVER's sign-in: never imitated. A video shows our side — connected state, what the product does
  next — and a neutral stand-in where a page must exist. Connecting itself is described, not faked.
- **Results.** No ranking, review count, lead count, revenue or "customers like you" number presented as
  an outcome. Fixture numbers are scenery; narration never calls the demo company or its numbers real.
- **Anything outside a slot.** No fixture flag in a `.env`, a service unit, a test lane or production.
  If you need provider behaviour in a test, write a test double in the test.
