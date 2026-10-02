# Lane notes — calls+crm

Branch `voice/calls-crm` (on `voice/skeleton` ca72128). What this lane built, where it departs from
`SPEC.md` and why, and what the other lanes and the integrator need to know.

## Files

| file | what |
|---|---|
| `server/voice/internal-calls.ts` | engine → app: `POST /calls`, `PUT /calls/:callSid`, `POST /calls/:callSid/events`, `POST /recordings/:callSid`, `POST /status`, `GET /blocklist` |
| `server/voice/calls.ts` | browser → app: `/api/crm/voice/calls*`, `/spam*`, `/escalations*`; the public "Got it" link; starts the reminder worker |
| `server/voice/leads.ts` | SPEC § 10: match/create the client by phone, "Call Assistant" lead source, VIRTUAL FORM note, pipeline project, notifications |
| `server/voice/escalations.ts` | SPEC § 11: rule match, template, SMS/email send, owner fallback, reminder tick + worker, reply/link confirmation |
| `server/voice/spam.ts` | SPEC § 12: ledger, strikes, auto-block at 2, manual block/unblock |
| `server/voice/usage.ts` | the per-call write into `voice_usage` (minutes metering hook) |
| `server/voice/org-profile.ts` | read-only: org + the profile the engine ran (published → draft → CRM default) + spam thresholds |
| `server/voice/recordings.ts` | R2 put/stream of call recordings; WAV duration from the header |
| `server/r2.ts` (appended block) | `r2Configured()`, `putToR2Key()` (fixed key, validated) |
| `server/crm/activity.ts` (marked block) | `call.answered · call.lead · call.alert · call.spam · call.blocked · call.unblocked · call.escalation_closed` |
| `server/crm/sms.ts` (marked block, after STOP/START/HELP) | inbound escalation replies |
| `client/src/pages/crm-call-assistant/calls.tsx`, `calls-detail.tsx`, `calls-shared.ts` | Calls tab: log + filters + pager, detail drawer (recording player, transcript, slots, client/project links, escalations), Spam view (ledger, block/unblock, spam calls), Escalations view |
| tests | `calls.test.ts` (child server, HTTP), `leads.test.ts`, `spam.test.ts`, `escalations.test.ts` (real a6 DB), `calls-fixtures.ts` (test-only helpers, never imported by app code) |

No DDL was needed: the lane's block in `server/voice/schema.ts` and `shared/schema.ts` is untouched.
`escalations.test.ts` and `calls-fixtures.ts` are new files inside this lane's prefixes (LANES.md lists
`calls/leads/spam.test.ts`; the escalation suite was split out so each file stays readable).

## Departures from SPEC.md (smallest change inside this lane's files)

1. **Recording key is `voice/<orgId>/recordings/<callSid>.wav`, not `voice/<orgId>/<callSid>.wav`.**
   `server/routes.ts` serves `GET /api/files/:folder/:subfolder/:filename` publicly with no auth for any
   three-segment R2 key, so SPEC's key would make every recording world-readable to anyone holding the org
   id and call sid. Four segments cannot match that route. **Architect: please update SPEC § 2.**
2. **`PUT /calls/:callSid` can answer `409 {code:"call_in_progress"}`.** The post-call work is claimed
   with one conditional UPDATE (`flags.processingAt`); a duplicate report that arrives while the first is
   still running gets 409, and one that arrives after gets the stored result (`flags.result`) back,
   byte-identical. A claim older than 2 minutes counts as a crashed run and may be taken over; a run that
   throws releases its claim. **Engine: treat 409 as "retry in a few seconds", not as a failure.**
3. **`GET /api/voice-internal/blocklist?to=&from=[&orgId=]`** (extension) → `{orgId, blocked, strikes,
   calls}`; 404 `unknown_number`. `GET /profile` should carry the same answer (see studio-backend below).
4. **`POST /calls` answers `201 {callId, orgId}`** (orgId added); a retried start returns the same callId
   and only fills gaps (`coalesce`), never blanks fields.
5. **Public route** `GET /api/public/voice/escalations/:id/confirm?t=` (the email "Got it" link) is
   registered inside `registerVoiceCallRoutes` — `server/voice/index.ts` is untouched. Token = HMAC-SHA256
   keyed by `voice-escalation-confirm:` + `VOICE_INTERNAL_SECRET` (else `SESSION_SECRET`); with neither set
   no link is offered and every token is refused (no built-in fallback key). Link base = `APP_URL` →
   `BASE_URL` → `https://constructhub.us`.
6. **Reminder worker** `startVoiceEscalationWorker()` is started from `registerVoiceCallRoutes` (runs once
   at boot), not from `server/routes.ts`, so no architect file changes. Off unless
   `VOICE_ESCALATION_WORKER_ENABLED=true` (production only). Every 30 min, first pass 15 s after boot.
7. **Inbound SMS hook** passes the carrier's `To`: a reply only confirms escalations of orgs whose SMS
   sender is that number (or whose sender is unknown), so one person on two orgs' lists confirms only the
   org they answered. When it confirmed something the carrier reply is `Got it, thanks.`; otherwise the
   normal empty reply. STOP/START/HELP still run first.
8. **Closing an escalation** (`POST /escalations/:id/close`) needs membership only, not `manageSettings`:
   the teammate who was paged is usually not a settings manager. Unblock/block keep `manageSettings`.
9. **Spam strikes need a confidence.** An end report with `outcome:"spam"` but no `spam.confidence` is
   treated as confidence = the profile's `flagAt` (spam, no notifications, but only a strike if the
   profile's `flagAt ≥ strikeAt`). The owner rule is "two *near-certain* spam calls".
10. **Request log.** `server/index.ts` copies every `res.json` body into the log line. The call list,
    call detail, spam ledger and escalation routes answer with `res.send(JSON.stringify(…))` instead so
    transcripts, summaries and escalation texts never reach the logs (asserted in `calls.test.ts`).
    **Architect (optional, cleaner):** add `/api/crm/voice` and `/api/voice-internal` to the logger's
    exclusion list in `server/index.ts`.

## For the other lanes

- **engine** — End report (`PUT /calls/:callSid`): send `spam: {confidence, reason}` on spam calls,
  `alerts: [{kind, summary}]` and/or `events` entries `{type:"alert", kind}` for every alert,
  `lead: {requested: true}` when a lead was submitted (or `outcome:"lead_submitted"`), `slots` with the
  intake keys (`need, address, city, first_name, phone, email, best_time`), `durationSeconds` (billed as
  ceil/60). A pre-answer `<Reject>` is reported as `PUT` with `{to, from, outcome:"blocked",
  durationSeconds:0}` — no `POST /calls` needed. Recordings: raw body `audio/wav` (≤ 40 MB);
  `503 r2_unconfigured` means "not stored, keep your local WAV". `POST /status` accepts the relayed
  callback as JSON `{callSid, callStatus, duration}`.
- **studio-backend** — `internal-profile.ts` should fill `caller` from this lane:
  `callerSpamStatus(orgId, from)` (`server/voice/spam.ts`) → `blocked, strikes`; `findCustomerByPhone(orgId,
  from)` (`server/voice/leads.ts`) → `customer {id, firstName, email}`. The post-call side reads the spam
  thresholds from `voice_profiles.compiled.spam {flagAt, strikeAt}` and falls back to the sensitivity
  table in `spam.ts` (same numbers as SPEC § 3).
- **numbers+billing** — `voice_usage` rows are written by `usage.ts meterCallUsage` once per finished call:
  `calls, minutes, spam_calls, blocked_calls, included_minutes` (snapshot of
  `callAssistantAllowance(ent).minutes`), `overage_minutes = max(0, minutes − included)`. The
  `overage_reported_*` / `stripe_usage_record_id` columns are yours; this lane never touches them. Blocked
  calls bill 0 minutes; spam calls bill their real minutes (the line was used).
- **studio-frontend** — notifications deep-link to `/crm/call-assistant?tab=calls&call=<id>`; the Calls
  tab opens that call's drawer. `&view=spam|escalations` opens a sub-view.

## Tested / untested

Tested (real a6 DB; the HTTP suite on a child server from this worktree on a free port 8200–8230): every
internal route, the add-on gate, filters, org isolation, permissions, spam → block → reject, idempotent and
racing end reports, metering, lead delivery (new and existing client, project, bell, email sink, SMS log
outbox + text allowance), escalation send/reminder/confirm/follow-up/close with an injected clock, the SMS
reply hook, the signed link, and that transcripts stay out of the request log.

**Untested:** a real R2 upload/stream (no bucket in tests; the route answers 503 without R2, and the
stream has no HTTP Range support — scrubbing in some browsers may need it); real SignalWire SMS and real
SMTP (log/sink providers only); the 30-minute worker timer itself (`tickVoiceEscalations` is tested);
`e2e/41-call-assistant-calls.spec.ts` was not written. The Calls tab UI was type-checked and
smoke-driven once in headless Chromium against a child server from this worktree (seeded through the
internal API; log, detail drawer, Spam and Escalations views at 1280 px and 390 px, no console errors) —
a one-off script, not a committed automated test.
