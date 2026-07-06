# Google Local Services Ads (LSA) Lead System — Replication Guide

> Everything needed to rebuild the LSA lead-management system in another project: a PRD, a build timeline, the full data model, a step-by-step implementation guide, every Google-API gotcha we hit, and a copy-paste replication checklist.

---

## 0. TL;DR — What this system does

It pulls **Google Local Services Ads (LSA) leads** (the "Google Guaranteed" phone/message/booking leads) into your own database and admin panel, then lets the business owner:

1. **See every lead** (name, phone, email, service requested, charged?, cost) on a dedicated admin page.
2. **Get an instant Telegram alert** the moment a new lead arrives.
3. **Dispute bad leads back to Google for a billing credit** — from the admin UI *or* straight from the Telegram alert by tapping a button — without ever looking like a bot.

The hard parts (and the reason this guide exists) are all in the Google Ads API quirks and the "don't look like abuse" dispute mechanics. Get those wrong and you either find **zero leads**, **crash on connect**, or **risk an LSA account suspension**.

---

## 1. PRD (Product Requirements Document)

### 1.1 Problem
Google's LSA dashboard is clunky. The owner wants leads where the rest of the business lives (their own admin), wants to be pinged the second a lead lands, and wants a fast, safe way to dispute junk leads (spam, sales calls, wrong service) to claw back money Google charged.

### 1.2 Goals
- **G1** — Mirror all LSA leads into our DB, refreshed automatically (no manual button needed).
- **G2** — Real-time-ish notification of every new lead via Telegram.
- **G3** — One-click / one-tap dispute of bad leads, with a billing-credit request sent to Google.
- **G4** — Make disputes **safe**: never look automated, never dispute leads that cost nothing, never fabricate a dispute reason.

### 1.3 Non-goals
- No editing of Google's data beyond the official "lead feedback" (rating) call.
- No per-lead price editing by hand (Google's billing is the only source of truth).
- No real-time push from Google (their API has none — we poll).

### 1.4 Users
- **Single business owner / admin.** This is a single-tenant internal tool. Auth is light (see §8.4); the dispute *write* endpoints are token-gated because they touch real money.

### 1.5 Functional requirements
| # | Requirement |
|---|---|
| F1 | OAuth "Connect Google Ads" button; store a long-lived refresh token. |
| F2 | Discover which Google account actually holds the LSA leads (it is usually **not** the MCC). |
| F3 | Sync leads into `lsa_leads`, upserting by Google's lead id. |
| F4 | Auto-sync every ~2 min in the background when connected. |
| F5 | Telegram alert for each brand-new lead (skip the first backfill). |
| F6 | Show leads in an admin page with charged status + derived cost. |
| F7 | Rate/dispute a single lead (Google `ProvideLeadFeedback`). |
| F8 | Batch-dispute many leads, sent **one at a time, 30–60s apart**. |
| F9 | Schedule disputes for **future dates** so they trickle out over days/weeks. |
| F10 | Dispute a lead from the Telegram alert by tapping **🚩 Report bad lead** → pick a reason. |

### 1.6 Safety requirements (the non-negotiables)
| # | Rule | Why |
|---|---|---|
| S1 | **Only dispute CHARGED leads.** | Disputing a free lead recovers $0 and just pads your "dissatisfied" count, which looks bad to Google. |
| S2 | **Never fabricate a dispute reason.** The owner must pick a TRUE reason. | Bulk/false disputes → LSA audit → **account suspension risk**. Cost is *never* a valid reason. |
| S3 | **Space disputes out (30–60s, never identical gaps; or scatter across days).** | A burst of disputes looks like bot abuse. |
| S4 | **Anti-double-dispute must be server-side & atomic.** | A lead must never be disputed twice (race conditions, retries). |
| S5 | **Validate the reason enum against Google's official list.** | A wrong enum value is rejected atomically (safe), but trusting AI/memory for the list got it wrong twice. |

### 1.7 Success criteria
- Connecting Google shows real leads within ~2 minutes.
- A new lead produces a Telegram alert with a working dispute button.
- A dispute with a valid reason returns HTTP 200 and flips Google's `lead_feedback_submitted` to true on the next sync; any credit appears in `credit_state`.

---

## 2. Build timeline (the order it actually happened, and the order to repeat it)

> Each phase is independently shippable. This is the recommended sequence — earlier phases de-risk the later ones.

| Phase | Deliverable | Notes / lessons baked in |
|------|-------------|--------------------------|
| **P0 — Cloud setup** | Google Cloud project, OAuth web client, Developer Token, OAuth consent screen **PUBLISHED (External/In production)** | A "Testing" consent screen issues refresh tokens that **expire in 7 days**. Publish it so tokens never expire. |
| **P1 — Connection layer** | `google-ads-client.ts`: OAuth URL build, code exchange, refresh-token mint, GAQL search, generic POST | Use **Node's built-in `fetch`** only. Do **not** import `googleapis`/`google-auth-library` (crashes under `tsx`). |
| **P2 — Data model** | `google_ads_config` + `lsa_leads` tables | Create via **raw SQL / idempotent `ALTER`**, not `db:push`. |
| **P3 — Account discovery + sync** | `listCandidateAccounts()` + `syncLsaLeads()` | The LSA account is often **not** under your MCC — discover via `listAccessibleCustomers` and self-login per account. |
| **P4 — Admin UI** | `/admin/lsa-leads` page + status/leads/sync routes | Read routes open; write routes token-gated. |
| **P5 — Cost derivation** | `syncLeadCostsForAccount()` | Per-lead cost is **not** available from the API — derive it from campaign daily spend. |
| **P6 — Single-lead dispute** | `provideLeadFeedback()` + feedback route | Get the request **body shape** and the **reason enum** exactly right (from the official docs page). |
| **P7 — Telegram new-lead alerts** | `notifyTelegramNewLead()` | Snapshot existing ids before the loop; skip the first backfill. |
| **P8 — Safe batch dispute** | spaced in-memory queue + atomic claim + charged-only backstop | 30–60s unique gaps; `resumeDisputeQueue()` on boot. |
| **P9 — Scheduled (future-dated) disputes** | `scheduleDisputes` + `promoteDueScheduledDisputes` timer | Promoter does its **own** atomic claim (don't delegate to enqueue — cancellation race). |
| **P10 — Telegram dispute from the alert** | webhook + inline buttons | Group **privacy mode** blocks typed words — use **inline buttons** (callback_query). |

---

## 3. Architecture overview

```
                        ┌─────────────────────────── Google ───────────────────────────┐
                        │  OAuth2  +  Google Ads REST API (GAQL search, ProvideLeadFeedback) │
                        └───────────────▲───────────────────────────────▲────────────────┘
                                        │ refresh token / access token   │ real writes (disputes)
                                        │                                │
   ┌────────────────────────────────────┼────────────────────────────────┼──────────────────────┐
   │ server/services/google-ads-client.ts (auth + transport, built-in fetch only)                 │
   ├──────────────────────────────────────────────────────────────────────────────────────────────┤
   │ server/services/google-ads-leads.ts (all business logic)                                       │
   │   • syncLsaLeads()            – discover accounts, pull leads, upsert, derive cost, alert       │
   │   • provideLeadFeedback()     – single rating/dispute (real write)                              │
   │   • enqueueDisputes()         – spaced batch queue (30–60s)                                     │
   │   • scheduleDisputes()/promoteDueScheduledDisputes() – future-dated disputes                    │
   │   • disputeLeadFromTelegram() – Telegram entry point (reuses enqueue)                           │
   ├──────────────────────────────────────────────────────────────────────────────────────────────┤
   │ server/routes/google-ads-routes.ts  – /api/admin/google-ads/*  (status, oauth, sync, dispute)  │
   │ server/routes.ts                    – Telegram webhook (prod only) + background timers          │
   ├──────────────────────────────────────────────────────────────────────────────────────────────┤
   │ Postgres: google_ads_config (1 row, refresh token) + lsa_leads (one row per lead)              │
   ├──────────────────────────────────────────────────────────────────────────────────────────────┤
   │ client: admin-lsa-leads.tsx  (status poll 15s, leads poll 30s)                                  │
   └──────────────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                  Telegram Bot API
                          (new-lead alerts + 🚩 dispute buttons)
```

**Tech stack:** Express + TypeScript (run with `tsx`), Drizzle ORM over Postgres (Neon), React admin front-end. No third-party Google SDK.

---

## 4. Prerequisites — Google Cloud & accounts (do this first)

1. **Google Cloud project** → enable the **Google Ads API**.
2. **OAuth consent screen**: User type **External**, then **PUBLISH** it ("In production"). *(Critical: unpublished = refresh tokens expire in 7 days.)*
3. **OAuth client ID** of type **Web application**. Add the redirect URI:
   `https://YOUR_DOMAIN/api/admin/google-ads/oauth/callback`
   (add both your prod domain and any dev domain you'll connect from).
4. **Google Ads Developer Token** (from your Google Ads manager account → API Center). Basic access is enough for these calls.
5. Note your **MCC / login customer id** (digits only) if you have a manager account. *(Optional — discovery works without it, but it's a useful fallback.)*
6. **Telegram bot** via @BotFather → get the **bot token**. Add the bot to your team group and get the **chat id** (negative number for groups).

### 4.1 Environment secrets
| Secret | Required | Purpose |
|--------|:---:|---------|
| `GOOGLE_ADS_CLIENT_ID` | ✅ | OAuth web client id |
| `GOOGLE_ADS_CLIENT_SECRET` | ✅ | OAuth web client secret |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | ✅ | Google Ads API developer token |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | ⛔ optional | MCC fallback (digits only). Defaults hardcoded; override per project. |
| `GOOGLE_ADS_API_VERSION` | ⛔ optional | Pin/bump the Ads API version (e.g. `v22`) without a code edit. |
| `TELEGRAM_BOT_TOKEN` | ✅ (for alerts) | Telegram bot token |
| `TELEGRAM_CHAT_ID` | ✅ (for alerts) | Destination chat/group id |

---

## 5. Data model

Two tables. **Create them with raw SQL or idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`** on server boot — *not* `db:push`, which can offer destructive renames.

### 5.1 `google_ads_config` (single row)
| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | — |
| `refresh_token` | text | The long-lived OAuth refresh token (the whole connection hinges on this). |
| `login_customer_id` | text | MCC/login id stored at connect time. |
| `connected_email` | text | (optional) connected Google account email. |
| `last_sync_at` | timestamp | Last sync time (UI). |
| `last_sync_error` | text | Soft notes or hard error from the last sync. |
| `last_sync_count` | integer | Leads imported last sync. |
| `last_cost_total` | numeric(12,2) | **Google's exact billed total** (headline number). |
| `created_at` / `updated_at` | timestamp | — |

### 5.2 `lsa_leads` (one row per lead, upserted by `lead_id`)
| Column | Type | Source | Purpose |
|--------|------|--------|---------|
| `id` | uuid PK | local | — |
| `lead_id` | text **UNIQUE NOT NULL** | Google | Upsert key. |
| `customer_id` | text | Google | Which account the lead came from (needed for the self-login dispute call). |
| `lead_type` | text | Google | PHONE_CALL / MESSAGE / BOOKING. |
| `category_id` | text | Google | **Industry** (e.g. `xcat:service_area_business_roofer`) — *not* a service. |
| `service_id` | text | Google | **What the customer wants** (e.g. `roof_installation`). Drives disputability. |
| `contact_name` | text | Google | Consumer name. |
| `contact_phone` | text | Google | The phone number (the key field for PHONE_CALL leads). |
| `contact_email` | text | Google | Consumer email. |
| `lead_status` | text | Google | Lead status. |
| `lead_charged` | boolean | Google | **Authoritative.** Only charged leads are worth disputing. |
| `lead_cost` | numeric(10,2) | **derived** | Per-lead cost spread from daily campaign spend (see §7). |
| `feedback_submitted` | boolean | Google | Authoritative "has feedback been sent" (here or in the LSA app). |
| `survey_answer` | text | **local** | What WE sent (SATISFIED/DISSATISFIED). Google never echoes it back. |
| `dispute_reason` | text | **local** | Reason WE sent. |
| `credit_state` | text | Google | Credit state after a dispute. |
| `dispute_status` | text | **local** | Pipeline state: `null \| scheduled \| queued \| sending \| disputed \| failed`. **Never** part of the sync upsert set. |
| `dispute_scheduled_at` | timestamp | local | When a scheduled dispute is due. |
| `tg_alert_message_id` | text | local | Telegram `message_id` of this lead's alert (maps a reply/button back to the lead). |
| `lead_creation_time` | timestamp | Google | When Google created the lead. |
| `raw_json` | jsonb | Google | Full raw lead payload (debug/forward-compat). |
| `created_at` | timestamp | local | — |

**Key design rule:** columns that record *what we did* (`survey_answer`, `dispute_reason`, `dispute_status`, `dispute_scheduled_at`, `tg_alert_message_id`) are **local-only** and must be **excluded from the sync upsert `set`**, or a Google sync would wipe them.

---

## 6. Connection layer (`google-ads-client.ts`) — step by step

> **Golden rule:** use Node's global `fetch` for *everything*. Importing `googleapis`/`google-auth-library` under `tsx` pulls in `node-fetch` v3 → `data-uri-to-buffer` (ESM) which fails to resolve and crashes the OAuth callback.

Endpoints used:
- Auth URL: `https://accounts.google.com/o/oauth2/v2/auth`
- Token (exchange + refresh): `https://oauth2.googleapis.com/token`
- Ads REST: `https://googleads.googleapis.com/{API_VERSION}/...`

Functions to implement:

1. **`isConfigured()`** — true when `CLIENT_ID` + `CLIENT_SECRET` + `DEVELOPER_TOKEN` exist. Lets the whole feature go dormant gracefully when unset.
2. **`buildAuthUrl(redirectUri, state)`** — params: `client_id`, `redirect_uri`, `response_type=code`, `scope=https://www.googleapis.com/auth/adwords`, **`access_type=offline`** (required for a refresh token), **`prompt=consent`** (forces refresh-token issuance every time), `include_granted_scopes=true`, `state`.
3. **`getRedirectUri(host)`** → `https://{host}/api/admin/google-ads/oauth/callback`. Built from the request host so dev and prod each work (must match a URI registered in Cloud).
4. **`exchangeCode(code, redirectUri)`** — POST form-encoded `grant_type=authorization_code` to the token endpoint. Returns `{ access_token, refresh_token, ... }`.
5. **`saveRefreshToken(token)`** — upsert the single `google_ads_config` row.
6. **`getAccessToken()`** — POST `grant_type=refresh_token` to mint a short-lived access token on demand (don't store access tokens).
7. **`listAccessibleCustomers()`** — `GET {ver}/customers:listAccessibleCustomers` with `Authorization: Bearer` + `developer-token`. Returns digits-only account ids. **This is the authoritative starting point for finding where leads live.**
8. **`gaqlSearch(customerId, query, loginCustomerId?)`** — `POST {ver}/customers/{cid}/googleAds:search` with headers `Authorization`, `developer-token`, **`login-customer-id`**, body `{ query, pageToken? }`. Follows `nextPageToken` pagination. **Default the `login-customer-id` to the account being queried** (self-login).
9. **`adsPost(customerId, path, body, loginCustomerId?)`** — generic POST for custom verbs like `:provideLeadFeedback`. Throws with Google's raw error text on non-2xx so the real message surfaces.

All ids are normalized with `.replace(/\D/g, "")` (digits only — no dashes) everywhere.

---

## 7. Sync engine (`syncLsaLeads`) — step by step

### 7.1 Account discovery (`listCandidateAccounts`)
The single biggest gotcha: **the LSA account is frequently NOT under your MCC and is NOT the login account.** Build the candidate set as:
1. Every account from **`listAccessibleCustomers`** — each queried with **login-customer-id = itself**.
2. The configured **login/MCC id** as a fallback.
3. For any account that *is* a manager, add its **non-manager children** (`customer_client` where `manager = false`), queried with **the manager as the login context**.

Keep them keyed by `customerId` so no account is queried twice. Return a soft `warning` if child discovery fails.

### 7.2 Pull leads
GAQL against each candidate:
```sql
SELECT
  local_services_lead.id,
  local_services_lead.lead_type,
  local_services_lead.category_id,
  local_services_lead.service_id,
  local_services_lead.contact_details,
  local_services_lead.lead_status,
  local_services_lead.lead_charged,
  local_services_lead.lead_feedback_submitted,
  local_services_lead.credit_details.credit_state,
  local_services_lead.creation_date_time
FROM local_services_lead
ORDER BY local_services_lead.creation_date_time DESC
```
- An account not enrolled in LSA simply **errors** here — that's expected, **skip it**.
- `contact_details` carries `consumerName`, `phoneNumber`, `email`.
- **`cost_micros` is PROHIBITED on `local_services_lead`** — do not request it.

### 7.3 Upsert
Insert by `lead_id` with `onConflictDoUpdate`. The update `set` refreshes **only** Google-authoritative fields (`lead_status`, contact fields, `lead_charged`, `feedback_submitted`, `credit_state`, `raw_json`). It must **never** touch `survey_answer`, `dispute_reason`, `dispute_status`, etc.

### 7.4 Sync truthfulness (don't fake an empty success)
- Per-account query errors are normal → skip + count them.
- If **every** scanned account fails → that's systemic; return `ok:false` with the error in `last_sync_error`.
- Partial failures → still `ok:true` but record a soft note.

### 7.5 New-lead detection → Telegram
- **Before** the loop, snapshot existing `lead_id`s into a Set.
- A lead not in that Set is brand-new → queue a Telegram alert.
- **Skip alerts entirely on the first backfill** (empty table) so connecting doesn't spam your whole lead history.

### 7.6 Cost derivation (`syncLeadCostsForAccount`)
Google gives **no per-lead price**. Approach:
1. Pull the **LOCAL_SERVICES campaign's real daily spend**: `SELECT segments.date, metrics.cost_micros FROM campaign WHERE campaign.advertising_channel_type='LOCAL_SERVICES' AND segments.date BETWEEN '{start}' AND '{today}'`. (`start` = earliest charged-lead date. Note: `LAST_180_DAYS` is invalid; use explicit `BETWEEN`.)
2. For each day, **spread that day's spend evenly across that day's charged leads** (`dayMicros / chargedCount`). Exact on single-charged-lead days; even split otherwise.
3. Clear `lead_cost` on anything not currently charged so stale figures can't linger.
4. **Headline total** = the true sum of daily `cost_micros ÷ 1e6`, stored in `google_ads_config.last_cost_total`. Show *that* as "Total spend" — the per-lead sum can fall slightly short (days with spend but zero charged leads), which is expected.

Date alignment: store `creation_date_time` as wall-clock-in-UTC and key by `toISOString().slice(0,10)` to match `segments.date`.

---

## 8. Disputing a lead (the real write) — step by step

### 8.1 The API call (`provideLeadFeedback`)
- Endpoint: `POST customers/{cid}/localServicesLeads/{id}:provideLeadFeedback`, **login-customer-id = the lead's own account id** (self-login, same as the query).
- **`surveyAnswer` has only TWO usable values:** `SATISFIED` (good) and `DISSATISFIED` (bad). It is *not* a 5-point scale. `UNSPECIFIED`/`UNKNOWN` are return-only.
- A **DISSATISFIED** answer **requires nested details**:
  ```json
  { "surveyAnswer": "DISSATISFIED", "surveyDissatisfied": { "surveyDissatisfiedReason": "SPAM" } }
  ```
  A flat top-level `surveyDissatisfiedReason` is rejected ("Cannot find field"); omitting details → "Survey details is required for DISSATISFIED". A SATISFIED answer sends just `{ "surveyAnswer": "SATISFIED" }`.

### 8.2 The ONLY valid dissatisfied reasons (authoritative)
```
DUPLICATE
GEO_MISMATCH        (outside service area)
JOB_TYPE_MISMATCH   (service not offered)
NOT_READY_TO_BOOK
SOLICITATION
SPAM
```
`OTHER_DISSATISFIED_REASON` exists but requires a free-text `otherReasonComment`, so it's intentionally not offered. **There is no "too expensive", "not a customer", "couldn't reach", "already a customer".** Cost is **not** a disputable reason.

> ⚠️ **Do not trust AI summaries or memory for this enum — fetch the official `LocalServicesLeadSurveyDissatisfiedReasonEnum` page.** It was gotten wrong twice; Google rejects bad values with `INVALID_ARGUMENT`. (A wrong value is at least *safe* — it's an atomic reject, no dispute filed.)

### 8.3 After a successful call
Set local `feedback_submitted=true`, `survey_answer`, `dispute_reason`, and `dispute_status='disputed'` (a "good" rating clears local state instead). On Google's side, `lead_feedback_submitted` flips true on the next sync and any credit shows in `credit_state`.

### 8.4 Auth posture for the routes
- **Read** routes (`/status`, `/leads`) are unauthenticated (front-end is localStorage-gated — match your project's existing posture).
- **Write** routes (`/sync`, `/leads/:id/feedback`, `/dispute-batch`, `/schedule-batch`, `/unschedule`) are **token-gated** (`requireAdminToken`, an HMAC `Authorization: Bearer` guard) because they cause real external account writes / spend real money. An open write endpoint here is CSRF/drive-by exploitable.
- The **OAuth callback** is a full-page browser response, so it can't carry a custom header — CSRF is guarded by a short-lived random **`state`** value. **All dynamic text in the callback HTML must be escaped** (reflected-XSS risk on your own origin).

---

## 9. Safe batch & scheduled disputes — step by step

### 9.1 Spaced queue (`enqueueDisputes`)
- Clean + uppercase + **validate each reason** against the enum; **de-dupe by lead id**.
- **Atomically CLAIM** each lead with a conditional UPDATE → `dispute_status='queued'` only `WHERE lead_charged = true AND (feedback_submitted IS NULL OR false) AND (dispute_status IS NULL OR 'failed' OR 'scheduled')`, using `.returning()`. **Zero rows returned = lost the race / already taken → skip.** This closes the read-then-write race so a lead can never be double-queued.
- Push winners into an in-memory queue with **randomized 30–60s gaps, forced unique within the batch** (no two identical intervals).
- A worker sends them one at a time: mark `sending` → `provideLeadFeedback(..., {fromQueue:true})` → it stamps `disputed`; on error → `failed`.
- **`resumeDisputeQueue()`** on boot re-queues any `queued`/`sending` rows so the UI never hangs after a restart (at-least-once; acceptable for a single-admin tool).

### 9.2 Charged-only backstop (S1)
Enforced in **two** places: the Telegram entry (`disputeLeadFromTelegram` returns `uncharged`) *and* the atomic claim (`lead_charged = true`). The in-memory queue does **not** re-check charge status (the `fromQueue` path bypasses guards), so to cancel a queued-but-unsent uncharged dispute you null its `dispute_status` in the DB and restart.

### 9.3 Scheduled (future-dated) disputes
- `scheduleDisputes(items{leadId,reason,runAt})` claims leads into `dispute_status='scheduled'` + `dispute_scheduled_at`. Survives restarts (state is in the DB).
- A **60s timer** + a boot call runs `promoteDueScheduledDisputes()`: it moves due rows into the spaced send queue.
- **The promoter must do its OWN atomic claim scoped to `WHERE dispute_status='scheduled'`** — do *not* delegate to `enqueueDisputes` (its claim also accepts `NULL`, so a lead cancelled in the promote window could be re-claimed → cancellation race).
- **Retire due-but-ineligible rows** (no longer charged / already rated / bad reason) → flip them to `failed` so the promoter doesn't re-select them every minute. Cancelled (`null`) rows are left untouched.
- `unscheduleDisputes(ids)` clears `scheduled` rows back to `null`.

### 9.4 The anti-abuse policy in one line
**Owner picks the leads + a TRUE reason + (optionally) a date range.** The system never auto-fabricates reasons by dollar threshold. "Dispute everything over $X" is owner shorthand, not an instruction to invent reasons.

---

## 10. Telegram integration — step by step

### 10.1 New-lead alert (`notifyTelegramNewLead`)
- Requires `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`; no-ops if unset.
- HTML message with name/phone/email/type/category/service/status/time. **Escape all dynamic text** (`& < >`).
- Attach an **inline button**: `{ text: "🚩 Report bad lead", callback_data: "lsadq:{leadId}" }`.
- After sending, store the returned `message_id` in `lsa_leads.tg_alert_message_id` (best-effort).
- Best-effort throughout — a notification failure must never break the sync.

### 10.2 The webhook (`/api/telegram/webhook`)
- **Production-only.** Dev must never own the webhook or it steals delivery from the live site. Register with `ensureTgWebhook()` gated on `REPLIT_DEPLOYMENT`, self-healing (re-register when the base URL changes), https-only.
- `setWebhook` `allowed_updates` **must include `callback_query`** (plus `message`, `channel_post`).
- Authenticate incoming calls with a stable **`secret_token`** (a sha256 of the bot token) and verify the **chat id**.
- **Never call `getUpdates`** — it clears the webhook.

### 10.3 Why inline buttons (the key lesson)
Telegram **group privacy mode** (ON by default for bots) means a **plain typed message** like "dispute" is **dropped by Telegram before it ever reaches your webhook** — only `/commands`, replies-to-the-bot, and @mentions are delivered. **A button tap is a `callback_query`, which is always delivered even under privacy mode.** So the reliable dispute path is: tap **🚩 Report bad lead** → bot shows reason buttons → tap a reason.

Callback data scheme (kept well under Telegram's 64-byte limit):
- `lsadq:<leadId>` — "Report bad lead" tapped → reply with the reason keyboard.
- `lsadr:<leadId>:<REASON_ENUM>` — reason tapped → `disputeLeadFromTelegram(leadId, reason)` → confirm.
- `lsadx` — cancel.

A typed-reply fallback also exists (`parseDisputeReason` maps free text → enum) for when the owner *replies to the bot*, but buttons are the primary, privacy-mode-proof path.

### 10.4 Don't let the dispute flow eat live-chat traffic
If the same webhook also relays plain messages elsewhere (e.g. a live-chat relay), a pending "awaiting reason" state must only be consumed when intent is unambiguous: either the message is a Telegram **reply to the bot's reason-prompt** (compare stored `promptMsgId`), or there is **no active chat session** and the text parses to a reason/cancel. Otherwise fall through to the relay. Keep pending state in-memory, keyed by chat id, with a ~15-min TTL.

---

## 11. Background timers (wire these on boot)
| Timer | Interval | Job |
|------|----------|-----|
| Auto-sync | **2 min** | If configured + connected, run `syncLsaLeads()`. Take a reentrancy lock **before** any `await` so slow ticks never overlap. |
| Schedule promoter | **60 s** | `promoteDueScheduledDisputes()` (+ once on boot). |
| Resume queue | once on boot | `resumeDisputeQueue()` to recover interrupted disputes. |
| Webhook ensure | on prod boot + on live traffic | `ensureTgWebhook()` (prod only). |

Polling is **mandatory** — Google's Ads API has **no webhook/streaming** for `local_services_lead`.

---

## 12. Admin API surface
| Method | Path | Auth | Purpose |
|--------|------|:----:|---------|
| GET | `/api/admin/google-ads/status` | open | configured/connected/leadCount/lastSync/total |
| GET | `/api/admin/google-ads/oauth/start` | open | redirect to Google consent |
| GET | `/api/admin/google-ads/oauth/callback` | `state` | exchange code → save refresh token |
| POST | `/api/admin/google-ads/sync` | 🔒 token | manual "Sync now" |
| GET | `/api/admin/google-ads/leads` | open | stored leads (newest first) |
| POST | `/api/admin/google-ads/leads/:leadId/feedback` | 🔒 token | rate/dispute a single lead |
| POST | `/api/admin/google-ads/leads/dispute-batch` | 🔒 token | spaced batch dispute (`items:[{leadId,reason}]`) |
| POST | `/api/admin/google-ads/leads/schedule-batch` | 🔒 token | future-dated disputes (`items:[{leadId,reason,runAt}]`) |
| POST | `/api/admin/google-ads/leads/unschedule` | 🔒 token | cancel scheduled (`leadIds:[]`) |

Front-end: a dedicated `admin-lsa-leads.tsx` page — status query polls 15s, leads query polls 30s (faster while disputes are in-flight), enabled only when connected.

---

## 13. The "offered services" allow-list (optional but useful)
Google does **not** expose which services the owner toggled "on" in *Local Services → Manage industries and services*. So a lead whose `service_id` is a service the owner doesn't offer is legitimately disputable as `JOB_TYPE_MISMATCH`. Keep a **hardcoded `OFFERED_SERVICE_IDS` set** in the client and reconcile it by hand whenever the owner flips a toggle. Blank `service_id` = unknown → never auto-flag. Also: humanize `category_id` to a real industry name via a map (its raw id can mislead — e.g. the "Window Service Provider" industry is internally `..._window_repair`). Disputability is decided by `service_id`, never `category_id`.

---

## 14. Gotchas cheat-sheet (every trap we hit)
1. **LSA account ≠ MCC ≠ login account.** Discover via `listAccessibleCustomers`; self-login per account.
2. **`cost_micros` is prohibited on `local_services_lead`.** Derive cost from campaign daily spend.
3. **No per-lead price and no real-time push.** Poll + spread spend.
4. **`surveyAnswer` is 2-valued; reason must be nested; reason enum is exactly 6 values.** Fetch the official page; don't trust memory.
5. **Don't trust AI/memory for the enum** — verified wrong twice; Google rejects bad values with `INVALID_ARGUMENT`.
6. **Only dispute charged leads.** Enforce in two places.
7. **Space disputes (30–60s unique) or scatter across days.** Bursts look like abuse.
8. **Anti-double-dispute = atomic conditional UPDATE + `.returning()`**, not a UI check.
9. **`dispute_status` & friends are local — exclude from the sync upsert** or syncs wipe them.
10. **Create/alter tables with raw SQL, not `db:push`** (it can offer destructive renames).
11. **Use built-in `fetch`; never import `googleapis`/`google-auth-library`** (crashes under tsx).
12. **OAuth consent screen must be PUBLISHED** or refresh tokens expire in 7 days; use `access_type=offline` + `prompt=consent`.
13. **Escape all dynamic HTML in the OAuth callback** (reflected XSS).
14. **`LAST_180_DAYS` is an invalid GAQL range**; use explicit `BETWEEN`.
15. **API version sunsets cause a sudden silent 404 ("sync does nothing")** — bump `GOOGLE_ADS_API_VERSION` first when sync mysteriously breaks.
16. **Telegram group privacy mode drops typed words** — use inline buttons (`callback_query`); never call `getUpdates`.
17. **Only the deployed prod app may own the Telegram webhook**; dev registering it steals delivery.
18. **All ids must be digits-only** (`replace(/\D/g,"")`) everywhere.

---

## 15. Replication checklist (do this in order)
- [ ] Google Cloud: enable Ads API, **publish** OAuth consent screen, create **Web** OAuth client with the `/api/admin/google-ads/oauth/callback` redirect URI.
- [ ] Get a **Developer Token**.
- [ ] Create the Telegram bot + group; grab token + chat id.
- [ ] Set env secrets (§4.1).
- [ ] Create `google_ads_config` + `lsa_leads` via raw SQL / idempotent `ALTER` (§5).
- [ ] Build `google-ads-client.ts` (built-in fetch only) (§6).
- [ ] Build `syncLsaLeads` + account discovery + cost derivation (§7).
- [ ] Add admin routes + the React page; token-gate the write routes (§8.4, §12).
- [ ] Connect via OAuth; confirm leads appear (first backfill is silent on Telegram).
- [ ] Build `provideLeadFeedback` with the exact body shape + enum (§8); test a wrong enum (safe reject) then one real dispute.
- [ ] Build the spaced queue + atomic claim + charged-only backstop + `resumeDisputeQueue` (§9).
- [ ] Build scheduled disputes + the 60s promoter with its own atomic claim (§9.3).
- [ ] Build the Telegram alert with the inline button (§10.1).
- [ ] Build the prod-only webhook with `callback_query` in `allowed_updates`, secret_token, chat-id check (§10.2–10.3).
- [ ] Wire the background timers (§11).
- [ ] **Publish/deploy** (the webhook is prod-only — disputes-from-Telegram are only testable live).
- [ ] Tap **🚩 Report bad lead** on a fresh alert → pick a reason → verify `dispute_status` advances and Google's `lead_feedback_submitted` flips on the next sync.

---

## 16. File map (where each piece lives in this project)
| Concern | File |
|---------|------|
| Auth + transport | `server/services/google-ads-client.ts` |
| All LSA business logic | `server/services/google-ads-leads.ts` |
| Admin + OAuth routes | `server/routes/google-ads-routes.ts` |
| Telegram webhook + timers wiring | `server/routes.ts` |
| DB schema | `shared/schema.ts` (`googleAdsConfig`, `lsaLeads`) |
| Admin UI | `client/src/pages/admin-lsa-leads.tsx`, `client/src/lib/lsa-services.ts`, `client/src/lib/admin-auth.ts` |
