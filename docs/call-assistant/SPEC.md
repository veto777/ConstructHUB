# ConstructHUB AI Call Assistant — architecture and contracts

*Architect's spec, 2026-10-02. Seven lanes build on this (ownership in `LANES.md`). Fixed decisions from the
owner are marked **FIXED**; anything marked **PLACEHOLDER** needs the owner. The reference implementation is
Alpine's "Janice" (another project's voice engine, read-only; nothing from its `.env` is ever copied) and the
owner's product spec (AI-RECEPTIONIST-PLAN-2026-10-01 → PRODUCT SPEC / ALPINE RULES / LAUNCH / TEXT ESCALATIONS).*

## 0. What it is

A contractor on Pro/Growth/Agency buys the **AI Call Assistant** add-on, buys a local number by state in the
CRM, forwards their existing line to it, and describes their company in the **Agent Studio**. From then on a
named assistant (Janice, Gabe, …) answers every call 24/7, screens spam, collects the lead the owner's way
(need → address → first name → confirm caller-id → email → best time), files it in the CRM, texts/emails
the right teammate for emergencies and "I want a person", and logs every call with summary, transcript and
recording. A text **Simulator** lets the contractor try the assistant before going live.

## 1. Architecture

```
  caller ──PSTN──▶ SignalWire (ConstructHUB space)
                     │  LaML webhook POST /voice/signalwire/voice   (form-encoded)
                     │  media WS   wss://constructhub.us/voice/media (8 kHz mu-law, <Connect><Stream>)
                     │  status    POST /voice/signalwire/status
                     ▼
  ┌──────────────── vb11: ConstructHUB app (Express 5, :8110) ───────────────────────────────┐
  │  server/voice/proxy.ts  /voice/*  ──raw HTTP + WS upgrade──▶  VOICE_ENGINE_URL           │
  │  server/voice/*          /api/crm/voice/*  (session + org + callAssistant add-on gate)    │
  │  server/voice/internal-* /api/voice-internal/*  (bearer VOICE_INTERNAL_SECRET)           │
  │  Postgres: voice_* tables · crm_customers/projects/activity · R2 recordings              │
  └───────────────▲──────────────────────────────────────────────────────────────────────────┘
                  │ tailnet 100.90.145.13:8152 (HTTP + WS)         ▲ internal API (HTTPS, bearer)
                  ▼                                                │
  ┌──────────────── tower GPU: voice/ (Python, constructhub-voice.service) ──────────────────┐
  │  server.py  webhook · /media Call loop · /health · /sim/* · /tts/preview · /personas     │
  │  speech.py  Silero VAD ─▶ faster-whisper large-v3-turbo ─▶ brain.py ─▶ Kokoro-82M        │
  │  brain.py   compiled profile + transcript ─▶ STRICT JSON Decision (provider-agnostic)     │
  │  app_client.py  GET /profile · POST /calls · POST /calls/:sid/events · PUT /calls/:sid   │
  │                 POST /recordings/:sid · POST /status                                      │
  │  AI: AI_INTEGRATIONS_OPENAI_* + AI_MODEL=truthcode-api (default) | VOICE_AI_PROVIDER=anthropic│
  └───────────────────────────────────────────────────────────────────────────────────────────┘

  browser ──▶ /crm/call-assistant  (Overview · Numbers · Agent Studio · Simulator · Calls)
```

**FIXED:** the engine runs on the tower (RTX PRO 6000; vb11 has no GPU) as the *user* unit
`constructhub-voice.service`, listening on `127.0.0.1:8152` and `100.90.145.13:8152`. No new DNS or tunnel:
SignalWire's public base is `https://constructhub.us/voice/`. The engine **never** touches Postgres.

### Call flow (one inbound call)

1. SignalWire POSTs the voice webhook → proxy → engine `POST /signalwire/voice`.
2. Engine verifies the request (signature with `SIGNALWIRE_SIGNING_KEY`, else CallSid lookup via the LaML
   API: must exist, be live, be to one of our numbers), then `GET /api/voice-internal/profile?to&from&callSid`.
3. App answers with org + compiled profile + `caller.blocked`. Blocked → `<Reject/>` and the app logs a
   `blocked` call (0 minutes). Unknown number → 404 → `<Say>` a generic line, `<Hangup/>`. Paused/unpublished →
   423 with the line to speak.
4. Engine returns `<Connect><Stream url="wss://constructhub.us/voice/media"><Parameter from/to/callSid/>`.
5. Stream opens → `POST /calls` (row created) → greeting after `greetingDelaySeconds` → turn loop
   (VAD → STT → brain Decision → TTS, paced) with barge-in, echo filter, silence prompts, hang-up rules.
6. `alert` / `submit_lead` decisions that must not wait → `POST /calls/:sid/events` (immediate delivery).
7. Call ends (caller goodbye + grace, carrier stop, max turns/seconds) → engine writes the WAV, `PUT
   /calls/:sid` with the full report, `POST /recordings/:sid`, deletes the local WAV on success.
8. App: lead delivery → CRM, escalations, spam ledger, usage; notifications through the org's CRM channels.

## 2. Data (server/voice/schema.ts = THE DDL; shared/schema.ts mirrors it)

All tables org-scoped by `org_id` (= `crm_orgs.id`, varchar uuid). Timestamps are `timestamp` (UTC wall
time, like the rest of the CRM). Lanes may **append columns only**, inside their marked block in the DDL
file and the drizzle block.

| table | purpose | key columns |
|---|---|---|
| `voice_profiles` | one per org: Studio draft, published copy, compiled prompt | `org_id UNIQUE`, `profile jsonb` (draft), `published_version int`, `published_profile jsonb`, `compiled jsonb`, `status` draft/live/paused, `setup_completed_at`, `updated_by_member_id` |
| `voice_profile_versions` | every publish | `org_id`, `profile_id`, `version int` (UNIQUE per org), `profile jsonb`, `compiled jsonb`, `note`, `created_by_member_id` |
| `voice_numbers` | SignalWire numbers an org owns | `phone_number UNIQUE` (E.164), `label`, `location`, `state`, `area_code`, `locality`, `provider` ='signalwire', `provider_sid`, `friendly_name`, `voice_url`, `status_callback_url`, `status` pending/active/releasing/released/failed, `is_test`, `forwarding_from`, `monthly_cents`, `purchased_at`, `release_eligible_at` (= purchased + 14 d), `released_at`, `last_error` |
| `voice_calls` | one row per call, transcript on the row | `call_sid UNIQUE`, `number_id`, `from_number`, `to_number`, `engine`, `model`, `persona`, `profile_version`, `started_at`, `answered_at`, `ended_at`, `duration_seconds`, `billed_minutes` (ceil/60), `outcome`, `caller_name/email/address/city`, `service_needed`, `summary`, `transcript jsonb []`, `slots jsonb`, `events jsonb`, `recording_key` (R2), `recording_seconds`, `customer_id`, `project_id`, `lead_delivered_at`, `spam_confidence numeric(3,2)`, `spam_reason`, `flags jsonb` |
| `voice_escalations` | text/email hand-offs with reminders | `call_id`, `kind`, `rule_id`, `channel` sms/email, `recipient`, `recipient_name`, `body`, `sent_count`, `last_sent_at`, `last_provider_sid`, `remind_every_minutes` 120, `remind_from_hour` 8, `remind_to_hour` 20, `max_days` 14, `follow_up_next_day`, `confirmed_at`, `reply_text`, `followup_sent_at`, `closed_at`, `close_reason`, `last_error` |
| `voice_spam` | ledger per caller number | `(org_id, phone_number) UNIQUE`, `strikes`, `calls`, `last_confidence`, `last_reason`, `last_call_id`, `blocked_at`, `unblocked_at`, `blocked_by` ('auto' or member id), `first_seen_at`, `last_seen_at` |
| `voice_usage` | minutes per org per month | `(org_id, month 'YYYY-MM') UNIQUE`, `account_user_id` (org owner = payer), `calls`, `minutes`, `spam_calls`, `blocked_calls`, `included_minutes` (snapshot), `overage_minutes`, `overage_reported_minutes`, `overage_reported_at`, `stripe_usage_record_id` |

Transcript line: `{ role: "caller"|"assistant"|"system", text, t }`. Event: `{ t, type, decision?, detail? }`.
Call outcomes (`shared/voice-profile.ts CALL_OUTCOMES`): `lead_submitted · alerted · declined · out_of_area ·
info · spam · blocked · hangup · voicemail · error · booked`.

Recordings: R2 key `voice/<orgId>/recordings/<callSid>.wav` (four segments, so the public three-segment `/api/files/:folder/:subfolder/:filename` route can never serve one) (8 kHz mono PCM WAV), uploaded by the engine through the
internal API, streamed to the CRM through `/api/crm/voice/calls/:id/recording` (never a public bucket URL).

## 3. The profile (shared/voice-profile.ts — written in full; this is a summary)

One zod document, `voiceProfileSchema`, every field defaulted, unknown keys dropped:

- **company** — name, spokenName, tagline, trade, `services[] {name, details, tier primary|secondary}`,
  materials[], brands[], `declines[] {what, referral}`, hours (per day open/from/to), timezone,
  officePhone, website, about.
- **serviceArea** — `counties[] {id, name, stateCode}` from the `counties` table (never typed by hand),
  spokenAreas[], defaultStateCode, outOfArea decline|take_lead_anyway, outOfAreaLine. The Studio's county
  picker is per state with "add all counties in a region" shortcuts (static region → county list in
  `server/voice/counties.ts`; e.g. "Canadian border to Tacoma" = Whatcom, San Juan, Skagit, Island,
  Snohomish, King, Pierce).
- **credibility** — yearsInBusiness, foundedYear, licenses[], insured, bonded, warranties[], awards[],
  reviews (typed, never fetched), certifications[], memberships[].
- **offers** — financing {available, details}, promotions[] {name, details, endsOn}, freeEstimate +
  line, referralProgram.
- **policies** — pricing never|ranges (+ priceRanges[]), repairs replacements_only|repairs_and_replacements|
  repairs_only, minimumJob, emergencies {handle, definition, line}, rules[] (verbatim extra rules).
- **persona** — presetId (janice|gabe|sofia|maya|marcus|ethan), assistantName, greeting, botAnswer,
  languages (en today), recordingNotice, style {warmth, brevity, formality 1–5}.
- **intake** — ordered `questions[] {key, prompt, required, validation none|address|name|phone|email|
  datetime|yes_no|choice, choices[], confirm, neverReadAloud, prefillFrom ''|caller_id|crm}`, submitLine,
  submitOnGoodbye. `DEFAULT_INTAKE_QUESTIONS` = need → address → first_name → phone (caller-id, never read
  aloud) → email (read back once, optional) → best_time (optional).
- **faq** — `[{question, answer}]` ≤ 60.
- **escalations** — `rules[] {id, kinds[], channel sms|email, recipientName, recipient, template,
  reminders {enabled, everyMinutes 120, fromHour 8, toHour 20, maxDays 14, followUpNextDay}, enabled}`,
  callerLine, fallbackToOwner. Kinds: `human · urgent · existing_customer · estimate_missing · scheduling ·
  contract · payment · complaint · vendor · other`.
- **leadDelivery** — crm {enabled, createProject, tags}, email {enabled, extraRecipients}, sms {enabled,
  recipients}, notifyOnEveryCall.
- **appointments** — enabled **false** by default; crews[] {name, windows[] {day, from, to}}, slotMinutes,
  bufferMinutes, leadTimeHours, confirmBySms. (Booking tools are a later lane; the schema is there.)
- **advanced** — extraInstructions (≤ 4000, appended verbatim), temperature, maxTurns, silencePromptSeconds,
  silencePromptsBeforeHangup, maxCallSeconds, greetingDelaySeconds, spamSensitivity low|normal|high,
  vocabulary[] (STT initial prompt).

`defaultVoiceProfile(org)` builds a usable profile from the CRM's own company fields — nothing invented.

### Prompt compiler (server/voice/prompt-compiler.ts → `CompiledProfile`)

Deterministic, snapshot-tested. Output: `{ schemaVersion, version, hash (sha256 of profile JSON),
compiledAt, persona {id, voice, name}, greeting, botAnswer, languages, systemPrompt, intake[],
decisionSchema (JSON Schema), escalationKinds[], timings {silencePromptSeconds, silencePromptsBeforeHangup,
maxCallSeconds, greetingDelaySeconds, maxTurns}, style {temperature}, spam {flagAt, strikeAt}, vocabulary[],
appointments {enabled} }`. Spam thresholds by sensitivity: low 0.9/0.98, normal 0.8/0.95, high 0.7/0.9.

The system prompt is assembled in a fixed section order (identity+style → job → what we do/don't +
referrals → service area → credibility → offers → pricing policy → emergencies → escalations → intake
script → FAQ → spam screening → hang-up rules → goodbye rule → decision-protocol rules → extraInstructions
→ current time). Wording lives only there. Janice's prompt (brain.py) is the model for tone and rules.

## 4. Decision protocol (brain ↔ engine) — **FIXED**

Every model turn returns exactly ONE JSON object, nothing else:

```json
{ "say": "What's the street address and city for the property?",
  "action": "continue",
  "slots": { "need": "Hardie siding replacement, whole house" },
  "alert": { "kind": "urgent", "summary": "active roof leak, 123 Main St" },
  "spam": { "confidence": 0.96, "reason": "Google listing verification pitch" },
  "outcome": "lead_submitted" }
```

- `say` — spoken to the caller; one short sentence (two only when confirming a submission); ≤ 400 chars;
  may be empty only with `end_call` after the caller's goodbye.
- `action` — `continue` | `submit_lead` (slots complete enough: callback number + address or a clear
  request) | `flag_spam` (with `spam`) | `alert` (with `alert`) | `end_call` (with `outcome`).
- `slots` — every intake key collected so far (cumulative), plus free keys the profile's custom questions
  define.
- Validation (`shared/voice-profile.ts decisionSchema`, mirrored in `voice/decision.py`): strip tool-call /
  `<think>` markup the way `server/ai-output.ts` does, parse the first `{…}` block, validate; invalid →
  one retry with a corrective user message ("Reply with only the JSON object"); still invalid → fallback
  `{ "say": "I'm sorry, could you say that one more time?", "action": "continue" }` and an `error` event.
- The engine enforces the rules the model cannot be trusted with: `end_call` is honoured only after a
  caller goodbye / "nothing else" / two silences / spam; a call ending without `submit_lead` but with ≥ 2
  caller turns and a callback number forces a submit from the transcript (Alpine's `_force_submit`);
  `flag_spam` ≥ `strikeAt` suppresses every notification.
- Provider adapters: **openai** (default: `AI_INTEGRATIONS_OPENAI_BASE_URL/API_KEY`, `AI_MODEL`
  `truthcode-api`, `response_format` json when the server accepts it, else prompt-only) and **anthropic**
  (`VOICE_AI_PROVIDER=anthropic` + `VOICE_ANTHROPIC_API_KEY`, real tool use mapped onto the same Decision).
  No other provider reads the profile.

## 5. Internal API (engine → app) — `/api/voice-internal/*`, bearer `VOICE_INTERNAL_SECRET`

| route | request | response |
|---|---|---|
| `GET /health` | — | `200 {ok:true, app:"constructhub"}` · `503 voice_internal_unconfigured` · `401` |
| `GET /profile?to&from&callSid` | E.164 numbers | `200 { org:{id,name,timezone}, number:{id,label,location,isTest}, status:"live", version, compiled: CompiledProfile, caller:{ blocked, strikes, customer:{id,firstName,email}|null } }` · `404 {code:"unknown_number"}` · `423 {code:"paused"|"unpublished", say}` |
| `POST /calls` | `{callSid, to, from, numberId?, startedAt, engine, model, persona, profileVersion}` | `201 {callId}` (upsert by callSid) |
| `POST /calls/:callSid/events` | `{type:"alert", kind, summary, slots}` or `{type:"lead", slots}` | `{delivered, escalationId?, customerId?}` — immediate delivery |
| `PUT /calls/:callSid` | `{endedAt, durationSeconds, outcome, summary, transcript[], slots, events[], caller:{name,email,address,city}, serviceNeeded, spam?:{confidence,reason}, lead?:{requested:true}, alerts?:[{kind,summary}]}` | `{callId, outcome, customerId, projectId, blocked}` — idempotent |
| `POST /recordings/:callSid` | body `audio/wav` (≤ 40 MB) | `{recordingKey, seconds}` |
| `POST /status` | `{callSid, callStatus, duration}` (SignalWire status callback relayed) | `{ok:true}` |

The secret must be ≥ 16 chars and never start with `chub_` (the public-API guard). No secret → 503, never open.

## 6. CRM API (browser → app) — `/api/crm/voice/*`

Every route: session → `requireOrg` → **callAssistant add-on on the org owner's subscription** (402
`{code:"plan_required", requiredPlan:"pro", addon:"call_assistant", message}`) → optional CRM permission
(`server/voice/context.ts voiceContext`). Reads need membership; edits need `manageSettings`.

| area | routes |
|---|---|
| Overview | `GET /status` (answers for everyone; `enabled`, add-on, allowance, pricing, engine, numbers, profile, usage) · `GET /usage?month` |
| Numbers | `GET /numbers/search?state&areaCode&city&limit` → `{numbers:[{phoneNumber, locality, region, areaCode, monthlyCents}]}` · `GET /numbers` → `{numbers, allowance, forwarding}` · `POST /numbers {phoneNumber,label,location}` → 201 row (403 limit_reached `addon:"call_number"` above the allowance) · `PATCH /numbers/:id` · `DELETE /numbers/:id` → `{released}` or `409 {code:"too_early", releaseEligibleAt}` |
| Agent Studio | `GET /profile` · `PUT /profile {profile}` (draft; 400 `{issues}`) · `POST /profile/publish {note?}` → `{version, compiled}` · `POST /profile/pause` · `POST /profile/resume` · `GET /profile/preview` (compiled draft) · `GET /profile/versions` · `GET /profile/versions/:v` · `POST /profile/versions/:v/restore` · `GET /counties?state=WA` → `{counties, regions}` · `GET /personas` |
| Simulator | `POST /simulator/session {useDraft?, callerNumber?}` → `{sessionId, greeting, compiledVersion}` · `POST /simulator/turn {sessionId, text}` → Decision + `{ended, outcome, events}` · `DELETE /simulator/session/:id`. The app proxies to the engine's `/sim/*` with the bearer; engine down → 503 `voice_engine_unavailable`, never a fake reply. |
| Calls | `GET /calls?outcome&spam=1&numberId&from&to&q&page&limit` · `GET /calls/:id` (+customer, escalations) · `GET /calls/:id/recording` (audio/wav from R2) · `GET /spam` · `POST /spam/:id/unblock` · `POST /spam/block {phoneNumber}` · `GET /escalations?open=1` · `POST /escalations/:id/close` |

## 7. Engine endpoints (Python, unprefixed; the proxy strips `/voice`)

`POST /signalwire/voice` · `POST /signalwire/status` · `GET /media` (WS) · `GET /health` — public (SignalWire-verified).
`GET /personas` · `POST /sim/session` · `POST /sim/turn` · `DELETE /sim/session/{id}` · `POST /tts/preview
{personaId, text}` → audio/wav — bearer `VOICE_INTERNAL_SECRET` (the engine enforces it; the proxy forwards
everything under `/voice/*`).

Media loop rules (port of Alpine's `server.py`, keep them): paced sender (0.8 s lead), time-based playback
state, barge-in = 0.65 s loud speech + echo-correlation < 0.35, echo sentences stripped from transcripts,
Whisper phantom phrases dropped on near-silence, CallRail "whisper" filter in the first 15 s, greeting after
`greetingDelaySeconds`, silence prompt after `silencePromptSeconds` (×`silencePromptsBeforeHangup` then
goodbye), overlapping speech queued never dropped, hang-up only after goodbye + 1.5 s grace, stall
warning when the carrier stops sending media > 8 s, unconditional hang-up even if bookkeeping fails.

## 8. Proxy (server/voice/proxy.ts, registered in server/index.ts before every body parser)

`/voice/<rest>` → `${VOICE_ENGINE_URL}/<rest>`; raw body streamed; `X-Forwarded-*` added; hop-by-hop headers
dropped; `upgrade` on `/voice/media` tunneled to the engine's `/media`; engine down → 503 JSON. Default
`VOICE_ENGINE_URL=http://100.90.145.13:8152`. Helpers: `voiceWebhookUrls()` = the URLs the numbers lane
writes on every purchased number.

## 9. Environment

App (`.env`): `VOICE_ENGINE_URL` (default `http://100.90.145.13:8152`), `VOICE_INTERNAL_SECRET`,
`VOICE_PUBLIC_BASE` (default `https://constructhub.us/voice`), `VOICE_ESCALATION_WORKER_ENABLED` (false in
lanes). Existing: `SIGNALWIRE_SPACE_URL/PROJECT_ID/API_TOKEN/FROM_NUMBER/SIGNING_KEY`, `R2_*`, `AI_*`.

Engine (`voice/.env`, gitignored): `VOICE_PORT` 8152, `VOICE_BIND` `127.0.0.1,100.90.145.13`,
`VOICE_APP_URL`, `VOICE_INTERNAL_SECRET` (same value), `VOICE_PUBLIC_BASE`, `VOICE_AI_PROVIDER` openai|anthropic,
`AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS` (copied by the
operator from the app's values), `VOICE_ANTHROPIC_API_KEY`, `VOICE_ANTHROPIC_MODEL`, `SIGNALWIRE_SPACE_URL/
PROJECT_ID/API_TOKEN/SIGNING_KEY` (verification only), `VOICE_WHISPER_MODEL`, `VOICE_TTS_DEVICE`,
`VOICE_STT_DEVICE`, `VOICE_MODELS_DIR`, `VOICE_RECORDINGS_DIR`, `VOICE_GREETING_DELAY_S`, `VOICE_SKIP_SIGNATURE`.

## 10. Lead delivery into the CRM (calls+crm lane, `server/voice/leads.ts`)

On `submit_lead` (mid-call event or end-of-call report), for a non-spam call:

1. **Customer** — match `crm_customers` in the org by normalized phone (`server/crm/sms.ts normalizePhone`,
   `phone` or `alt_phone`); else create: `displayName` = caller name or "Caller (xxx) xxx-xxxx",
   `firstName`, `phone`, `email` (slot), `addressLine1`/`city`/`state` (slot + `serviceArea.defaultStateCode`),
   `leadSourceId` = the org's "Call Assistant" `crm_lead_sources` row (created on first use, like "Website"),
   `tags` = `leadDelivery.crm.tags`, `notes` = "VIRTUAL FORM — filled out by <assistant>, <company>'s virtual
   assistant, on a phone call to <number label>". `portalToken` as `entities.ts` mints it.
2. **Project** (when `createProject`) — `crm_projects` `{ customerId, name: "<need> — <city>", status:
   "lead", addressLine1/city/state, description: summary }`.
3. **Activity** — `recordActivity({ orgId, actorLabel: "<assistant> (Call Assistant)", action:
   "call.answered" | "call.lead" | "call.alert" | "call.spam", entityType: "voice_call", entityId,
   customerId, meta: { outcome, durationSeconds, summary, recording: bool } })`; the lane appends the
   `call.*` cases to `activityText` in `server/crm/activity.ts` (append-only block).
4. **Notify** — `notifyMembers({ org, pref: "leadReceived", title: "New phone lead — <name>", body, link:
   /crm/clients/<id> })` (in-app + SMS per the org's channel matrix) and the `leadReceived` email like
   `lead-capture.ts notifyLeadReceived`, plus `leadDelivery.email.extraRecipients` and `leadDelivery.sms.
   recipients`. Telegram only if the CRM grows a Telegram channel (it has none today — do not add one here).
5. `voice_calls.customer_id/project_id/lead_delivered_at` set; `flags.lead = slots`.

Non-lead outcomes (`info`, `declined`, `out_of_area`) create no customer; with `notifyOnEveryCall` they
send a summary notification. `voicemail`/`hangup` with < 8 s never notify.

## 11. Escalations (calls+crm lane, `server/voice/escalations.ts`)

An `alert` decision (mid-call event or end report) → match `profile.escalations.rules` by `kind`
(first enabled rule containing it) → render the template (`{{callerName}} {{callback}} {{address}}
{{summary}} {{assistant}} {{company}}`; default body = Alpine's: company · kind label · caller · callback
· address · gist · "Reply OK to confirm") → send (sms via `server/crm/sms.ts sendSms` with the org's
sender, metered like every other text; email via `sendWithFallback`) → `voice_escalations` row. No rule
→ `fallbackToOwner`: the CRM's notification channels (bell/email/SMS) with pref `leadReceived`, title
"<kind> — caller asked for a person". `urgent` and `human` always also notify the owners.

Reminder worker (`startVoiceEscalationWorker`, every 30 min, `VOICE_ESCALATION_WORKER_ENABLED=true` on
production only): unconfirmed → resend every `remind_every_minutes` within local `remind_from/to_hour`
(company timezone) until `max_days`; a reply from the recipient confirms (inbound SMS: hook in
`/api/crm/sms/inbound` — a text from an open escalation's recipient to the org's sender sets `confirmed_at`;
email replies are not parsed in v1 — the recipient clicks a signed "Got it" link); confirmed + 20 h →
one next-day follow-up ("was this taken care of? Reply DONE"); then closed. The assistant never gives out
a recipient's number.

## 12. Spam (calls+crm lane, `server/voice/spam.ts`) — owner rules

- The assistant always asks what the call is about before collecting anything.
- `flag_spam` with confidence ≥ `flagAt` → outcome `spam`, **no notifications, no lead, no escalation**;
  the call shows in Calls → Spam. Confidence ≥ `strikeAt` → a **strike** on `voice_spam` (upsert by org +
  number; `calls`, `last_*` always updated).
- **2 strikes → `blocked_at` (blocked_by 'auto')**: the next call from that number is `<Reject>`ed before
  answering and logged as `blocked` (0 minutes, no notification). Unblock from Calls → Spam (manageSettings);
  manual block by number too. Per org only; no cross-org list in v1.

## 13. Numbers (numbers+billing lane) — SignalWire LaML REST (Twilio-compatible)

Search `GET /api/laml/2010-04-01/Accounts/{project}/AvailablePhoneNumbers/US/Local.json?InRegion=WA
[&AreaCode=360][&InLocality=Bellingham]`; buy `POST …/IncomingPhoneNumbers.json` with `PhoneNumber`,
`FriendlyName=<org name>`, `VoiceUrl`/`StatusCallback` = `voiceWebhookUrls()`, `VoiceMethod=POST`; release
`DELETE …/IncomingPhoneNumbers/{sid}.json` only on/after `release_eligible_at` (purchase + 14 days; the
API answers 409 `too_early` with the date). Allowance = `callAssistantAllowance(ent)` (1 per
`call_assistant` unit + every `call_number` unit). **At most ONE real number in the whole build** —
label `constructhub-test`, `is_test=true`; tests mock the REST client. Forwarding instructions per
carrier (AT&T `*72`, Verizon `*72`, T-Mobile `**21*`, Spectrum/Comcast portal, CallRail: edit the tracking
number's destination and turn off call whisper) are static copy in the Numbers tab.

## 14. Pricing (shared/plans.ts) — **PLACEHOLDER, owner must confirm**

| add-on | monthly | annual (10×) | includes | on |
|---|---|---|---|---|
| `call_assistant` "AI Call Assistant" | $249 | $2,490 | 1 number + 500 min/mo, then $0.15/min overage | pro, growth, agency |
| `call_number` "Extra Call Assistant number" | $5 | $50 | one more number (requires call_assistant) | pro, growth, agency |

Both carry `preview: true`: listed on Pricing/Terms with a "Coming soon" badge, refused at checkout
(`server/billing/order.ts checkAddonsForPlan` → 409 `addon_unavailable`), and `GET /api/crm/voice/status`
reports `addon.preview`. No setup fee (≥ $1,000 would be "talk to sales"). Entitlement:
`ent.addonModules.callAssistant` is true when the subscription holds ≥ 1 `call_assistant` on a plan that
sells it (platform admins: always); `requireModule("callAssistant")` / `voiceContext` gate every route;
the 402 carries `addon`. Overage: `voice_usage.overage_minutes` reported to Stripe as a metered usage
record on a `chub_v1_meter_call_minutes` price (numbers+billing lane, `server/billing/prices.ts` pattern)
at month end; the Overview shows minutes used vs included and the overage rate.

## 15. Personas — **FIXED** list (voice ids verified by the engine lane)

janice → af_heart · gabe → am_michael · sofia → af_bella · maya → af_sarah · marcus → am_adam ·
ethan → am_eric. Each has a sample line (`shared/voice-personas.ts`), pre-rendered to
`client/public/persona-samples/<id>.mp3` by the engine lane (served by the app at `/persona-samples/<id>.mp3`, outside the
`/voice/*` engine proxy); `voice/personas.json` is the engine's copy and
`verified` flips to true once checked.

## 16. Side ribbon and page

Sidebar entry **Call Assistant** (Phone icon, `link-portal-nav-call-assistant`) → `/crm/call-assistant?tab=`
`overview|numbers|studio|simulator|calls` (`tab-call-assistant-<tab>`, `panel-call-assistant-<tab>`).
The page shows the add-on prompt (`plan-required-callAssistant`) when `/status.enabled` is false or any
voice route answers 402. Numbers/Studio edits need `manageSettings` (the panels say so to other members).

## 17. Security

- Internal API: bearer only, constant-time compare, 503 when unset; recordings capped at 40 MB.
- Webhooks: signature (`SIGNALWIRE_SIGNING_KEY`) or CallSid lookup; `VOICE_SKIP_SIGNATURE=1` only on a dev
  box with no public webhook.
- The engine reads only `voice/.env`; the operator copies ConstructHUB's own AI and SignalWire values in.
  Nothing from Alpine's engine `.env` or any other project is ever read or copied. Never restart/stop
  `alpine-voice*` or touch +1 360-585-8200.
- No PII in logs beyond what the CRM already logs; recordings only through the org-scoped route.
- Two-party-consent states: `recordingNotice` on by default; the Studio warns when turning it off.

## 18. Launch checklist (owner + infra, in order)

1. Owner confirms pricing (§14) → numbers+billing lane drops `preview` → Stripe prices are created lazily.
2. `VOICE_INTERNAL_SECRET` generated once, set in the app's `.env` on vb11 and in `voice/.env` on the tower.
3. Tower: `voice/.venv`, models downloaded, `constructhub-voice.service` enabled (`voice/deploy/install.sh`),
   `/health` green on `127.0.0.1:8152` and `100.90.145.13:8152`; the engine's startup health check against
   `https://constructhub.us/api/voice-internal/health` passes.
4. vb11: deploy the app build (HANDOFF runbook), `VOICE_ENGINE_URL` set, `curl https://constructhub.us/voice/health`.
5. SignalWire: buy the single test number (label `constructhub-test`) through the Numbers tab; call it from a
   real phone; the call appears in Calls with transcript + recording; the lead lands in Clients.
6. Break test (≥ 20 scored calls: booking-free lead, repair decline, out of area, price question, "are you a
   bot?", "I want a person", emergency at night, spam pitch, silence/hang-up, goodbye mid-intake, bad
   address, email spelling) via `voice/sim.py` and `voice/tests/fake_signalwire.py`, then on the phone.
7. Escalation worker on in production only; one sample escalation to the owner's phone.
8. Forwarding instructions verified on one real carrier line (no-answer/after-hours first, then always).
9. HANDOFF.md updated: units, ports, secrets' names (never values), the restart-when-idle rule.

## 19. Open questions for the owner

- Pricing (§14): $249/mo incl. 1 number + 500 min, $0.15/min overage, $5/mo per extra number — confirm or change.
- Annual = 10× monthly for the add-on too (consistent with the price book) — confirm.
- Spanish: STT/TTS support for `languages: ["es"]` is a later lane; keep the field but hide the option until then?
- Appointments: keep OFF for v1 (schema present, booking tools not built) — confirm.
- Telegram alerts: the CRM has no Telegram channel; v1 uses SMS/email/in-app. Add Telegram to the CRM later?
- Recording retention: keep WAVs in R2 indefinitely or purge after N days?
- A cross-org spam list (a number blocked by two orgs is suspect everywhere) — v2?

## 20. Folded in at integration (voice/integration, 2026-10-02)

The lanes' contract extensions, recorded in `LANE-NOTES-*.md`, as merged:

- **Recording key** — §2 above (calls+crm). **Persona samples** — `/persona-samples/<id>.mp3` (§15); the engine
  also serves `/samples/<id>.mp3` for direct checks.
- **Simulator** — `VOICE_SIM_BACKEND=app` (default: `server/voice/brain.ts` with the app's AI provider) or
  `engine` (proxy to the engine's `/sim/*`). Silence is `{text:"(silence)", silence:true}`. Turn responses carry
  `{ended, outcome (null mid-call), events (cumulative), turn, fallback}`; strip those before validating a Decision.
  429 `rate_limited` above 150 simulated turns per org per hour.
- **Decision parser** — one implementation for the app (`server/voice/decision.ts`) mirroring `voice/decision.py`;
  `server/voice/fixtures/decision-cases.json` is the binding contract for both (over-long `say` is cut, trailing
  commas repaired, unknown alert kind → `other`, unknown outcome dropped, empty `say` only with `end_call`).
- **Prompt placeholders** — the compiled `systemPrompt` keeps `{{now}}` and `{{caller}}`; the engine and the
  Simulator fill them per call, and the engine appends its OUTPUT FORMAT + RUNTIME block.
- **Engine rules added** — fillers around a "no" after "anything else?" end the call; no alert is delivered after
  a spam flag; a flagged spam call hangs up even if the caller keeps talking during the grace.
- **Internal API** — `POST /calls` → `201 {callId, orgId}`; `PUT /calls/:sid` may answer `409 call_in_progress`
  (the engine retries); a second `{type:"lead"}` event for a call updates the same client/project;
  `GET /blocklist?to&from` (extension); `/profile` 200 adds `number.phoneNumber` and `caller.number`.
- **Minutes** — one meter, `recordVoiceCallUsage` (`server/voice/billing-usage.ts`), called once per call under
  the end-report claim; the month is the call's start (UTC).
- **Numbers** — `VOICE_NUMBERS_MOCK=true` (dev/e2e only), purchase failures kept as `failed` rows, release through
  the carrier that holds the row. Overage sweep `startVoiceOverageWorker` (production + Stripe +
  `VOICE_OVERAGE_WORKER_ENABLED=true`), started from `registerVoiceRoutes`.
- **Intro price** (owner, 2026-10-02) — `call_assistant` is $99/mo for the first 3 months, then the regular price:
  a Stripe coupon (`duration: repeating`, 3 months, `amount_off` = regular − $99) applied once per customer when the
  add-on is first added (§14 pricing stays the placeholder until the owner confirms it).

