# KIMI SMS REPORT — SMS compliance pivot (lane/a1)

## What was built (and why)

US carriers banned one platform texting on behalf of many businesses, so the
SMS product pivots to the approvable "Remindr model": the shared ConstructHUB
number **only texts our own users (contractors)** — account notifications.
Client/homeowner texting is refused on the platform number and only works when
an org connects its OWN registered number/account (BYO or dedicated). Voice
calls need no 10DLC campaign, so an optional voice "check your email" nudge
covers the client-deliverability gap.

## 1. Client-texting gate

- `server/crm/sms.ts` — new `orgCanTextClients(customFields)` (sender resolves
  AND mode !== "platform"), exported `CLIENT_TEXT_NEEDS_OWN_NUMBER` refusal
  string, and `smsStatus()` now returns `canTextClients` for the UI.
- Gated every CLIENT-facing text (email legs unaffected):
  - `server/crm/portal.ts` estimate send: platform org → `texted:false`,
    `smsError: "Client texting needs your own number — connect one in
    Settings → Text messaging"`. Never falls through to the platform number.
  - `server/crm/sms.ts` estimate reminder: same refusal, recorded in the
    reminder audit entry.
  - `server/crm/messages.ts` quick message (channel "text"): 409 with the same
    reason when a sender exists but is platform-mode.
- CONTRACTOR-facing texts deliberately NOT gated (a brand texting its own
  users): `notify.ts` notifyMembers sms, `sms.ts` maybeAlertReengagement +
  textOrgOwners, the settings test text, team invite (`crm/routes.ts`) and
  beta invite (`admin.ts` — platform-level, no org context, kept as-is).
- Client UI: `crm-settings.tsx` SMS card explains the split when
  `canTextClients === false`, "Text estimates to clients" switch is disabled
  with the connect-your-own-number note; `crm-client.tsx` hides the per-send
  "Also text it" checkbox and shows the note instead; `crm-create-menu.tsx`
  Text channel points at Settings → Text messaging.

## 2. STOP / HELP / START

- New table `crm_sms_optouts` (`shared/schema.ts`, `server/crm/schema-ensure.ts`:
  CREATE TABLE IF NOT EXISTS + unique index on `(org_id, phone)`). `org_id
  '*' ` is the platform-wide row — a STOP to the shared number suppresses the
  phone for every org, because the carrier sees one sender.
- Public webhook `POST /api/crm/sms/inbound` (form-encoded LaML shape,
  From/To/Body), registered in `registerCrmSmsRoutes`. Case-insensitive:
  - STOP | STOPALL | UNSUBSCRIBE | CANCEL | END | QUIT → records opt-out for
    every org with a member/org main line on that number, plus the `'*'` row;
    replies "You're unsubscribed and won't get more texts. Reply START to resume."
  - HELP | INFO → "ConstructHub alerts. Help: support@constructhub.us. Reply
    STOP to opt out."
  - START | UNSTOP | YES → removes all rows for the phone; "You're resubscribed."
  - All replies are LaML XML, `Content-Type: text/xml`.
- Verification: `signalwireSignatureOk()` validates X-SignalWire-Signature
  (Twilio-algorithm HMAC-SHA1) **when a signature is present and a token is
  configured**; unsigned requests are still processed — an inbound STOP is
  never dropped.
- Suppression: `sendSms(to, body, orgCustomFields?, orgId?)` — new optional
  4th arg. When the org is known, an opted-out number is skipped and reported
  (`ok:false`, error names the STOP), never thrown. A DB failure during the
  check fails OPEN (logged) so notifications can't be taken down by it. Wired
  into every org-scoped send (estimate send, reminder, quick message,
  reengagement, owner alerts, test text, team invite).

## 3. Consent + Privacy Policy

- `crm_members.sms_consent_at` / `sms_consent_phone` (schema + ensure ALTERs),
  exposed via `presentMember`.
- Consent is stamped (first time only) when: (a) the member checks the new
  disclosure checkbox in Settings → Notifications → `POST
  /api/crm/me/sms-consent {agree}`; (b) they flip ANY notification's Text
  channel on (org PATCH auto-stamps — the toggle is the affirmative act);
  (c) they save a phone on their profile. `agree:false` withdraws.
- Settings disclosure text: "I agree to receive account-notification texts
  from ConstructHUB at the phone number on my profile. Message frequency
  varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.
  We do not share or sell your SMS consent or phone number."

### Exact Privacy Policy text added (`client/src/pages/crm-legal.tsx`, new §5)

> **5. SMS / Text Messaging**
>
> **What we send:** ConstructHUB sends account-notification text messages (for
> example: "your client opened your estimate", "a bid was signed", "a payment
> landed") to the Contractor account holder who opted in, at the phone number
> on their profile. These are transactional account notifications, not
> marketing. When a Contractor connects their own registered phone number,
> texts to their Clients (such as an estimate link) come from the Contractor's
> own number under the Contractor's own carrier registration — not from
> ConstructHUB's shared number.
>
> **Consent — and what we never do with it:** SMS opt-in is collected per
> account holder with an explicit checkbox in Settings (timestamped and stored
> with the phone number). **We do not share or sell SMS opt-in data, consent
> records, or phone numbers to any third party or affiliate for marketing
> purposes.** Phone numbers and consent are used solely to deliver the
> notifications the account holder asked for, through the carrier provider
> that transmits the message.
>
> **Message frequency varies** with account activity. **Message and data rates
> may apply.** Carriers are not liable for delayed or undelivered messages.
>
> **Opt out any time:** reply **STOP** to any text to unsubscribe — the number
> goes on a suppression list and receives no further texts. Reply **START** to
> resubscribe, or **HELP** for help (or email support@constructhub.us). Opting
> out never affects email notifications or account access.
>
> **Voice calls:** if a Contractor enables it, a short automated "your estimate
> is in your email" call may be placed to a Client when an estimate is sent.
> Clients can ask their Contractor to turn this off, or email us.

Also corrected the now-false "We only contact you by email — never by phone,
text or social media" bullet in §1 (subsequent sections renumbered 6–10).

## 4. Voice nudge

- New `server/crm/voice.ts`: `placeEmailNudgeCall(to, org)` resolves the org's
  sender (platform is fine — no campaign needed) and POSTs
  `/api/laml/2010-04-01/Accounts/{project}/Calls.json` with `From`, `To`,
  `Twiml=<Response><Say>Hi, this is {org.name}. We just sent your estimate —
  please check your email inbox or spam folder. Thank you.</Say></Response>`.
  Unconfigured dev → "log" provider recording to `tmp/voice-outbox.jsonl`
  (`VOICE_OUTBOX_PATH` override). Never throws.
- Org toggle `voiceNudge` (custom_fields, virtual field in PATCH /api/crm/org,
  same pattern as smsAlerts/smsEstimates) + switch in Settings → SMS card:
  "Call the client to check their email".
- `portal.ts` estimate send: when on and the client has a phone, the call is
  placed fire-and-forget (`void …catch`), never blocking or undoing the send.

## Inbound webhook URL to configure at the carrier

```
POST https://portal.constructhub.us/api/crm/sms/inbound
```

Set it as the SignalWire number's "Message Handling" / inbound-message webhook
(LaML webhook, HTTP POST, form-encoded). Accepts Twilio-shape webhooks too.

## Files touched

- `shared/schema.ts` — member consent columns; `crm_sms_optouts` table.
- `server/crm/schema-ensure.ts` — ALTERs + CREATE TABLE/unique index.
- `server/crm/sms.ts` — gate, opt-out helpers, send suppression, inbound
  webhook, `canTextClients` in status, orgId on org-scoped sends.
- `server/crm/voice.ts` — NEW: nudge call + toggle reader.
- `server/crm/portal.ts` — send-route gate + voice nudge hook.
- `server/crm/messages.ts` — quick-message gate + suppression orgId.
- `server/crm/notify.ts`, `server/crm/routes.ts` (invite) — suppression orgId.
- `server/crm/routes.ts` — `voiceNudge` virtual field, consent endpoint,
  consent auto-stamps (org PATCH + profile PATCH), presentMember fields.
- `client/src/pages/crm-settings.tsx` — client-texting notes + disabled
  switch, voice switch, consent checkbox.
- `client/src/pages/crm-client.tsx` — per-send text toggle gating.
- `client/src/components/crm-create-menu.tsx` — composer gating + hint.
- `client/src/pages/crm-legal.tsx` — privacy §5 SMS section + renumber.
- `vitest.config.ts` — loads `.env` into process.env (vitest doesn't by
  default; CRM_TEST_* / base URL were silently falling back to lane-shared
  defaults). No new dependency (Node 20 `util.parseEnv`).
- Tests: `server/crm/sms-compliance.test.ts` (NEW), `server/crm/sms.test.ts`
  (reminder test updated for the BYO gate).

## Tests

`server/crm/sms-compliance.test.ts` (15 tests):
- gating pure: platform refused, dedicated/BYO allowed, incomplete-BYO falls
  back to platform and is refused, unconfigured refused; `smsStatus` surfaces
  `canTextClients`.
- suppression seam (real test DB): STOP row skips + reports (no throw);
  tenant isolation (org A opted-out, org B still sends); `'*'` row suppresses
  all; START (clearSmsOptout) resumes.
- voice pure: toggle reader, Twiml content/escaping, dev "log" provider,
  SignalWire Calls.json payload shape (mocked fetch).
- webhook helpers: LaML shape/escaping; unsigned passes, wrong present
  signature fails.
- dev server: platform org send refused with reason (email still sends); BYO
  org send attempted (not gated) and honestly fails against a dead endpoint,
  message-center ungated for BYO, 409 for platform; STOP→rows for org + `'*'`
  →HELP→START clears; consent stamp via Text-channel toggle + explicit
  endpoint set/clear; voice nudge places a log call on send when ON and stays
  silent when OFF.

`server/crm/sms.test.ts` reminder test now asserts the platform-mode refusal
(`texted:false`, reason in `smsError`, channel "email"). The reengagement
tests are unchanged — they text the CONTRACTOR, which stays allowed.

`npm run check` = 0 errors; `npm test` fully green: **53 files, 505 tests
passed** (vitest, serial files, against the lane dev server on :8129).

## Open / honest notes

- **Signature verification is best-effort by design**: unsigned webhooks are
  accepted (spec: STOP must never be dropped). In prod, a forged STOP could
  suppress a number; a forged START could re-enable one. Tighten by rejecting
  unsigned requests once SignalWire reliably signs.
- **BYO inbound**: STOPs texted to an org's OWN number go to THEIR SignalWire
  account, not our webhook — the org handles those (their registration, their
  obligation). Our suppression list covers the shared/dedicated numbers.
- The admin **beta invite** text (`admin.ts`) has no org context, so no
  suppression check applies there; it's a platform-level onboarding text
  (kept per spec).
- Consent auto-stamp on the Text-channel toggle treats the toggle as the
  affirmative act; the explicit checkbox + privacy link is the primary record.
- Voice nudge is not volume-capped per client — one call per estimate send
  (a resend re-calls). If that proves noisy, add a per-estimate once-only
  marker like the reengagement day key.
- Dev/e2e never hit a real carrier: SMS "log" provider and voice "log"
  provider record to `tmp/*-outbox.jsonl`.
