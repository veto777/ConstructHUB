# Call Assistant — lane ownership (who edits what)

Seven lanes build in parallel from `voice/skeleton`. The rule is simple: **a file has one owner.** A lane
that needs something in another lane's file asks for it through the interface in `SPEC.md`, or appends
inside a block marked for it. Nobody edits the architect's files; if a contract is wrong, raise it and the
architect changes it on `voice/skeleton`.

Common rules: Node 20 (`export PATH=$HOME/.nvm/versions/node/v20.19.6/bin:$PATH`), `npm run check` = 0
errors, tests per the recipe in the task brief (child server on a free port 8200–8230, never hard-coded),
DB changes = idempotent `ADD COLUMN IF NOT EXISTS` in your marked block of `server/voice/schema.ts` +
the mirror in `shared/schema.ts` (ask the architect for a new table). Commit trailers as in the brief.
Never deploy, never push, never touch another project's services or secrets. Untested = say untested.

## Architect-owned (nobody else edits)

| file | why |
|---|---|
| `server/voice/index.ts` | route registration — each lane's `register*` function is called here already |
| `server/voice/schema.ts` | ALL DDL; lanes append `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in their marked block only |
| `shared/schema.ts` "Call Assistant" block | drizzle mirror; same append-only rule, same block owner |
| `shared/voice-profile.ts` | the profile + decision contracts (studio-backend may propose changes; architect applies) |
| `shared/voice-personas.ts` | mirror of `voice/personas.json` (engine lane sends the verified list; architect applies) |
| `shared/plans.ts` add-on block | **handed to numbers+billing after the skeleton** (see that lane) |
| `server/entitlements.ts` add-on-module code, `server/billing/order.ts` preview guard | architect |
| `server/voice/context.ts`, `server/voice/internal-auth.ts` | the gate and the bearer |
| `server/index.ts` (proxy registration), `server/routes.ts` (voice mount, `/api/entitlements`) | one-line mounts |
| `client/src/components/crm-sidebar.tsx` entry, `client/src/App.tsx` route + section label | shell wiring |
| `client/src/pages/crm-call-assistant/index.tsx` | the tab shell and the add-on prompt |
| `client/src/lib/growth-tools.ts`, `client/src/pages/home.tsx`, `client/src/pages/landing.tsx`, `client/src/pages/pricing.tsx` badge, `server/data/hub-knowledge.md` Call Assistant copy, `server/hub/knowledge.ts` §24 keywords, `server/hub/output-filter.ts` ADDON_CUE terms (+ the $5→$6 cases in its test, and the add-on annual exemption in `server/pricing-copy.test.ts`) | the site copy (owner asked for it; keep it honest: "coming soon" until it ships) |
| `scripts/apply-schema-migration.ts` VOICE_SCHEMA_DDL line, `.env.example` voice block, `.gitignore` voice block | |
| `docs/call-assistant/SPEC.md`, `LANES.md` | |

## Lane: engine — `voice/**` except `voice/sim.py`, `voice/tests/**`, `voice/deploy/**`

Owns: `voice/server.py` (the Call loop — port Alpine's `server.py` rules: paced sender, time-based
playback, barge-in + echo check, whisper filter, greeting delay, silence watch, hang-up rules, stall
warning, unconditional hang-up), `voice/audio.py`, `voice/speech.py`, `voice/brain.py` (provider-agnostic
decision loop), `voice/decision.py` (JSON validation/cleanup/retry/fallback), `voice/providers/*.py`
(openai-compatible default, anthropic optional), `voice/app_client.py`, `voice/config.py`,
`voice/personas.json` (verify voice ids, swap missing, write the list; render samples to
`client/public/voice/samples/<id>.mp3` — those files are yours), `voice/requirements.txt`, `voice/README.md`,
`voice/.env.example`. Interfaces you must honour: SPEC §4 (decision protocol), §5 (internal API — you call
it), §7 (your endpoints). Do NOT read `~/alpine/voice/.env`; do not restart `alpine-voice*`; the only
phone number you may ever dial in a test is the harness's synthetic caller (no real calls to anyone).

## Lane: numbers+billing — SignalWire numbers and money

Owns: `server/voice/numbers.ts`, `server/voice/numbers-signalwire.ts` (LaML REST client, mockable),
`server/voice/numbers.test.ts`, `server/voice/billing.ts`, `server/voice/billing-usage.ts` (voice_usage
upserts, overage reporting via the `server/billing/prices.ts` lookup-key pattern), `server/voice/billing.test.ts`,
the add-on block in `shared/plans.ts` (`call_assistant`, `call_number`, the `CALL_*` constants — remove
`preview` only on the owner's word), `client/src/pages/crm-call-assistant/numbers.tsx` (+ `numbers-*.tsx`:
buy-by-state wizard, number list with release dates, forwarding instructions per carrier/CallRail), and
`client/src/pages/settings/limits-usage.tsx` rows for Call Assistant minutes/numbers. DDL: your marked
block in `server/voice/schema.ts`. **Only this lane may purchase a number, and at most ONE real one in the
whole build (label `constructhub-test`, `is_test=true`); everything else is mocked.** Interfaces: SPEC §6
Numbers/Overview, §13, §14.

## Lane: studio-backend — profile, compiler, counties, simulator proxy

Owns: `server/voice/profile.ts`, `server/voice/profile-store.ts`, `server/voice/prompt-compiler.ts`
(+ `prompt-compiler.test.ts` with snapshots under `server/voice/__snapshots__/`), `server/voice/counties.ts`
(counties by state from the DB + static region shortcuts), `server/voice/personas.ts`,
`server/voice/simulator.ts` (proxy to the engine's `/sim/*` with `voiceInternalHeaders()`),
`server/voice/internal-profile.ts` (`GET /api/voice-internal/profile`), `server/voice/profile.test.ts`.
Proposes changes to `shared/voice-profile.ts` to the architect. Interfaces: SPEC §3, §4 (you write the
decision schema text into the prompt), §5 `/profile`, §6 Agent Studio + Simulator.

## Lane: studio-frontend — the Studio, Overview and Simulator UI

Owns: `client/src/pages/crm-call-assistant/**` **except** `index.tsx`, `numbers*.tsx`, `calls*.tsx`:
`overview.tsx`, `studio.tsx` + `studio/*.tsx` (setup wizard on first run, then the editor with every
profile section, county picker with region shortcuts, persona picker with sample playback, intake script
editor, FAQ, escalation rules, lead delivery, appointments (off), advanced; prompt preview; version
history; publish/pause), `simulator.tsx` (chat UI showing each turn's decision), `client/src/lib/voice-*.ts`
helpers, and the e2e spec `e2e/40-call-assistant-studio.spec.ts`. Reads/writes only `/api/crm/voice/*`
(SPEC §6). Uses the shell's `data-testid` names from `index.tsx`.

## Lane: calls+crm — the call log and everything that happens after a call

Owns: `server/voice/calls.ts`, `server/voice/internal-calls.ts`, `server/voice/leads.ts` (SPEC §10),
`server/voice/escalations.ts` (+ the reminder worker, SPEC §11), `server/voice/spam.ts` (SPEC §12),
`server/voice/recordings.ts` (R2 put/get; you may **append** an exported helper to `server/r2.ts`),
`server/voice/calls.test.ts`, `server/voice/leads.test.ts`, `server/voice/spam.test.ts`, the `call.*` cases
appended to `activityText` in `server/crm/activity.ts` (marked block), the inbound-SMS confirmation hook
appended in `server/crm/sms.ts` (marked block, after the STOP handling, never before it),
`client/src/pages/crm-call-assistant/calls.tsx` (+ `calls-*.tsx`: log, detail with transcript and recording
player, spam view with ledger/unblock, open escalations), and `e2e/41-call-assistant-calls.spec.ts`. DDL:
your marked block.

## Lane: infra — proxy, units, runbook

Owns: `server/voice/proxy.ts` (SPEC §8: raw HTTP proxy + WS tunnel, 503 when down; `proxy.test.ts`),
`voice/deploy/**` (`constructhub-voice.service` user unit with `TimeoutStopSec=620`, `install.sh` that
creates `voice/.venv` and installs `requirements.txt`, `restart-when-idle.sh`), `docs/call-assistant/RUNBOOK.md`
(start/stop/logs/health, secret rotation, the "never restart during a live call" rule, how vb11 reaches the
tower, what to check when SignalWire gets a 503), the voice lines of `.env.example` (append-only), and the
HANDOFF.md section "Call Assistant" (append-only). Never deploys to production; never touches
`alpine-voice*`, `coderail`'s tunnel or any other project's units.

## Lane: harness — simulators and shared test fixtures

Owns: `voice/sim.py` (text simulator CLI against a compiled-profile JSON fixture, dry-run by default),
`voice/tests/**` (`fake_signalwire.py`: a synthetic caller that speaks scripted lines through the real
`/media` protocol with a different Kokoro voice, `--no-marks`, `--echo`, `--noise`; scripted calls
`*.txt` for the break test in SPEC §18.6; `test_decision.py` for the decision parser), and
`server/voice/fixtures/**` (`profile.alpine-like.json`, `compiled.v1.json`, `call-report.*.json`) that every
server lane's tests import. Does not edit lane code; files failing scenarios as issues to the lane.

## Integration order (merge to `voice/skeleton` → main, one PR per lane, rebased)

1. engine + infra (the engine answers /health through the proxy) → 2. studio-backend (profile + compiler +
`/profile` internal route) → 3. numbers+billing (a test number rings the engine) → 4. calls+crm (a call
becomes a lead) → 5. studio-frontend → 6. harness (break test green). The architect merges and runs
`npm run check` + the full vitest suite after each.
