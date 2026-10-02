# Lane notes — studio-backend

Branch `voice/studio-backend`. Owns the files listed under "Lane: studio-backend" in `LANES.md`, plus two
new files of its own (`server/voice/brain.ts`, `server/voice/brain.test.ts`, see below). No architect file
was edited and no DDL was added (the `voice_profiles` / `voice_profile_versions` columns in SPEC §2 were
enough).

## What is built

| file | what |
|---|---|
| `server/voice/profile-store.ts` | Data access: seed a new org's draft from the CRM org (`seedProfileFromOrg`: phone → E.164, 2-letter state, `industry` → `company.trade`, nothing invented), save draft (re-validated), publish (advisory lock per org → version = max+1, compiled + copied to `published_profile`, status `live`, stamps `setup_completed_at`), preview (compiles the draft as version max+1, no write), pause/resume, versions with a diff summary + author name, restore, and the engine lookups (`lookupNumber`, `callerStatus`, `publishedState`). |
| `server/voice/profile.ts` | Every Agent Studio route in SPEC §6, plus `POST /profile/setup` (see extensions). |
| `server/voice/prompt-compiler.ts` | `compileVoiceProfile(profile, version, now)` → `CompiledProfile` in the SPEC §3 section order; `renderSystemPrompt` fills `{{now}}` / `{{caller}}` per call. |
| `server/voice/counties.ts` | Counties by state from the `counties` table; static region shortcuts resolved against the DB rows; `verifyCountyRefs`, `countiesById`. |
| `server/voice/personas.ts` | `shared/voice-personas.ts` + `sampleUrl` only when the rendered file exists. |
| `server/voice/internal-profile.ts` | `GET /api/voice-internal/health` and `GET /api/voice-internal/profile` (SPEC §5). |
| `server/voice/brain.ts` | The decision protocol in TypeScript (the Simulator's default backend). |
| `server/voice/simulator.ts` | `POST /simulator/session`, `POST /simulator/turn`, `GET` + `DELETE /simulator/session/:id`. |

## Extensions to SPEC.md (smallest change that works; integrator please fold into SPEC)

1. **Simulator backend: the app by default, the engine as an option.** SPEC §6 says the app proxies to the
   engine's `/sim/*`. The lane brief asks for the same brain to run server-side so the Studio works
   before the engine is deployed. Both exist: `VOICE_SIM_BACKEND=app` (default) runs `server/voice/brain.ts`
   with the app's own AI provider; `VOICE_SIM_BACKEND=engine` proxies to `/sim/session|turn|session/:id`
   with `voiceInternalHeaders()` (engine down → 503 `voice_engine_unavailable`, never a made-up reply).
   The engine body sent is `{compiled, orgId, callerNumber, caller, timezone}`, which matches
   `voice/server.py` on `voice/engine` (`caller` is extra and ignored). **New env var** for `.env.example`
   (architect-owned): `VOICE_SIM_BACKEND=app|engine`.
2. **Simulator responses carry more than SPEC.** Session → `{sessionId, greeting, compiledVersion, backend,
   draft, persona}`; turn → Decision + `{ended, outcome, events (cumulative), turn, fallback}`; plus
   `GET /simulator/session/:id` (transcript/report) and `DELETE` → `{ended, summary, report}`. Errors: 404
   `unknown_session`, 409 `session_ended`, 409 `unpublished|paused` when `useDraft:false` has nothing to run,
   429 `rate_limited` above **150 simulated turns per org per hour** (each turn is a paid model call), 502
   `ai_unavailable` only if the brain itself throws (provider errors normally become the fallback line).
   Sessions are in-process memory (30-minute TTL, at most 6 per org): a restart ends them; with more than
   one app process they would need sticky sessions (production runs one).
3. **`POST /api/crm/voice/profile/setup`** — the first-run wizard's short payload (company basics, service
   names, `regionIds` / `countyIds`, credibility, policies, offers, persona, an urgent-SMS and an office-email
   contact that become escalation rules `wizard-urgent` / `wizard-office`, lead-delivery recipients,
   `publish`). Merges over the draft, stamps `setup_completed_at`, optionally publishes ("Setup wizard").
   The studio-frontend lane currently builds its wizard on `PUT /profile` + `POST /profile/publish`, which
   works just as well; `/setup` is there if it wants a one-call wizard.
4. **`setup_completed_at`**: every publish stamps it, and `PUT /profile` stamps it when the body has
   `setupCompleted: true` (what studio-frontend sends). `POST /profile/publish` also answers
   `setupCompletedAt`.
5. **Versions list** rows: `{version, note, createdAt, createdBy (member id), author (display name or
   email), first, changed (top-level sections), changedPaths, published}`. The diff is computed on read
   from the stored profiles; no column was added.
6. **`GET /counties?state=XX`** answers `{state, counties:[{id,name,stateCode}], regions:[{id, name,
   stateCode, description, counties (resolved refs), missing}]}`; the last region is always
   `all-<state>`. Region shortcuts: WA `wa-border-to-tacoma` (Whatcom, San Juan, Skagit, Island, Snohomish,
   King, Pierce), `wa-puget-sound`; FL `fl-tampa-bay` (Pinellas, Hillsborough, Manatee, Sarasota),
   `fl-orlando` (Orange, Seminole, Osceola), `fl-south`; TX DFW / Houston; AZ Phoenix; CA Bay Area /
   SoCal; CO Denver; GA Atlanta. A test checks every shortcut resolves completely against the dev DB.
7. **PUT/publish reject unknown counties**: a county ref whose id is not a `counties` row in that state →
   400 with an issue on `serviceArea.counties`.
8. **Internal `/profile`** also returns `number.phoneNumber`, `caller.number` (normalized), and on 423 the
   `org {id, name}`; 400 `bad_request` when `to` is not a number. The paused/unpublished lines the engine
   speaks are `PAUSED_LINE` / `UNPUBLISHED_LINE` in `internal-profile.ts`. `org.timezone` is the profile's
   `company.timezone` (falls back to the CRM org's).
9. **Caller match** (`caller.customer`): the CRM stores phones as typed, so the match is on the last ten
   digits of `crm_customers.phone` / `alt_phone` (like `entities.ts` / `hover.ts`), archived customers
   excluded. The spam ledger lookup uses the normalized E.164 (≥ 10 digits) — calls+crm should key
   `voice_spam.phone_number` the same way (`normalizeE164` in `profile-store.ts`, or `normalizePhone` in
   `server/crm/sms.ts` for 10/11-digit US numbers, which gives the same result).

## Compiler output vs. the brief

The brief lists `{systemPrompt, intakeScript, decisionSchema, greeting, botAnswer, spamRules,
escalationRules}`; the architect's `CompiledProfile` type carries them as `systemPrompt`, `intake`
(the ordered script), `decisionSchema` (JSON Schema), `greeting`, `botAnswer`, `spam {flagAt, strikeAt}`
and `escalationKinds` (the rules themselves stay in the profile: calls+crm reads
`published_profile.escalations.rules` when it sends an escalation, so recipients never reach the engine).
Two per-call placeholders stay in `systemPrompt`: `{{now}}` and `{{caller}}`. **Engine lane:** fill them
the way `renderSystemPrompt` + `callerLine` + `spokenNow` do (caller id in spoken groups with "never read
it aloud", the CRM's first name/email when known, local time in `company.timezone`).

The greeting matches the architect's contract test: `Thank you for calling <spoken>, this is <name> — calls
may be recorded. What can we help you with today?` (no notice when `recordingNotice` is off).

## brain.ts (TypeScript decision loop) — for the engine lane to mirror

- Cleans tool-call / `<think>` / fence markup (the families `server/ai-output.ts` strips), takes the first
  balanced `{…}` that validates against `decisionSchema`; invalid → one retry with
  `RETRY_INSTRUCTION`; still invalid or provider error → `FALLBACK_SAY` + an `error` event. It does not go
  through `aiComplete` because `aiAnswer` judges prose, not JSON; it uses the same `aiClient()` and
  `aiModel()` (no `response_format`, no tools — the TruthCoder gateway refuses both).
- Enforced rules: `end_call` only after a goodbye ("bye" counts only at the end of the utterance, so
  "12 Bye Lane" is not a goodbye) / "anything else?" → "no" / two silences / spam / the turn cap; refused
  → `continue` + "Is there anything else I can help you with?". `flag_spam` below `flagAt` → `continue`;
  at/above it every `submit_lead` is refused and the call ends as `spam`. An ending call with ≥ 2 caller
  turns, a callback (phone slot or caller id) and an address or a stated need that never submitted or
  alerted is force-submitted (Alpine's `_force_submit`), except for declined / out_of_area / spam outcomes;
  a caller who only asked a question stays `info`. (Alpine asks the model to extract the lead; here the
  slots already hold it, so the rule is deterministic.) `alert` without a kind is not an
  alert. A call with only an alert ends as `alerted`.

## Not done / untested (be honest)

- **Never ran against the real model.** The dev `.env` files on the tower point the AI provider at
  `localhost:1106` (a Replit leftover that is not running), and production secrets were not touched. Every
  brain/simulator test uses a scripted fake provider or a local stub server. First thing to try on a box
  with the TruthCoder provider: a few Simulator turns, checking that `truthcode-api` answers with bare JSON
  (the retry + fallback cover it if not, but a model that never complies would make every turn a fallback).
- Persona samples: `/voice/samples/<id>.mp3` sits under the `/voice/*` engine proxy (`app.use("/voice",
  …)` in `proxy.ts` on `voice/infra`), so in production the browser's request for a sample goes to the
  engine, not the static files. **Infra/architect:** either skip `/voice/samples/` in the proxy or move
  the samples (then change `VOICE_SAMPLE_URL_BASE` / `VOICE_SAMPLE_DIR` in `personas.ts`). Until the engine
  lane renders the files `sampleUrl` is null and the Studio shows no play button.
- No e2e/browser test here (studio-frontend owns `e2e/40-call-assistant-studio.spec.ts`).
- `appointments` compiles into "the team will confirm the exact time" guidance only; no booking.
