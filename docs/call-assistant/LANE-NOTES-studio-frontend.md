# Lane notes — studio-frontend (Agent Studio, Overview, Simulator UI)

Branch `voice/studio-frontend`. Owned files per `LANES.md`: `client/src/pages/crm-call-assistant/{overview,studio,simulator}.tsx`,
`client/src/pages/crm-call-assistant/studio/*`, `client/src/lib/voice-studio.ts`, `e2e/40-call-assistant-studio.spec.ts`.

## What is built

- **Overview** — add-on/preview badges, assistant status + published version, numbers (from `/status.numbers`),
  minutes used vs included (progress bar, overage rate from `CALL_MINUTE_OVERAGE_CENTS`), calls this month, the last
  5 calls (`GET /calls?limit=5`; an error just hides the list), and a "next step" card (publish → number → simulator).
- **Agent Studio**
  - First run (`publishedVersion == null && !setupCompletedAt`): a 10-step **setup wizard** (company → services &
    don'ts → service area → credibility → offers → policies → persona → questions → delivery & escalations → review &
    publish). Every Next validates the step and `PUT`s the draft. "Skip to the editor" is always offered.
  - **Editor**: left nav per section (a select on phones), every profile section editable, red marker on sections with
    blocking issues, sticky bar with status/version, dirty state, Save draft, Publish (dialog with a section-level diff
    against the live version + note), Pause/Resume, Setup wizard. **Prompt preview** (`GET /profile/preview`, the
    SAVED draft) and **Version history** (view a version's prompt, restore into the draft).
  - County picker per state with search, region shortcuts, a selected-counties panel grouped by state.
  - Persona cards (name, gender, blurb, sample line, play button disabled with "Sample audio not rendered yet" while
    `sampleUrl` is null), style sliders, a recording-notice warning when turned off.
  - Intake editor: drag handle + up/down arrows, required switch, per-question options (slot key, validation, choices,
    prefill source, read-back-once, never-read-aloud), custom questions, "Default script" reset.
  - FAQ pairs, escalation rule builder (kinds as chips, SMS/email + recipient normalized to E.164, template with
    placeholders, reminder cadence, next-day follow-up), lead delivery, appointments (off by default; the copy says
    booking tools are not live), advanced (extra instructions, timings, temperature, spam sensitivity, vocabulary).
  - Members without `manageSettings` see everything read-only (first run: "ask an owner or admin").
- **Simulator** — choose Published vs Draft, optional caller number (E.164), chat log with each reply's action badge,
  alert/spam/fallback badges, a side panel with the last decision, the slots collected and the events. Every error is
  said in plain words (engine down, AI provider down, unpublished, paused, session expired) — never a fake reply.
- **Plan gate** — the shell's `CallAssistantPlanRequired` is reused when `/profile` or the simulator answers 402.

## Contract notes (for the integrator and studio-backend)

1. **Publish body** — the wizard sends `POST /profile/publish { note: "Initial setup", setupCompleted: true }`. The
   extra `setupCompleted` is harmless if ignored (studio-backend currently reads only `note`); the wizard stops
   showing anyway once `publishedVersion` is set. If the backend wants the stamp on first publish, honour that key
   (or stamp `setup_completed_at` on any first publish). The wizard does **not** use studio-backend's
   `POST /profile/setup` short payload — it edits the full profile and uses `PUT /profile`, so both paths coexist.
2. **Regions** — `GET /counties` regions are accepted in both shapes: SPEC's `countyIds: number[]` and studio-backend's
   `counties: CountyRef[]` (+ `description`, `missing`). When a region id starts with `all-`, the Studio hides its own
   "All of <state>" button. Region counties are always intersected with the state's county list, so an id the DB
   does not have is never added.
3. **Simulator events** — studio-backend returns the call's events **cumulatively** each turn; the engine may return
   only new ones. The Studio de-duplicates (`mergeSimulatorEvents`), so either is fine. `ended` from the backend is
   trusted over `action === "end_call"` (the engine may refuse an early end). `fallback: true` shows a badge.
4. **400 issues** — studio-backend sends zod issues with `path` as a dotted string; the Studio's `profileIssueText`
   handles strings and arrays (the generic `apiIssueMessage` assumes arrays and would print one letter).
5. **Restore** — `POST /profile/versions/:v/restore` must answer with `{ profile, … }` (studio-backend does); the editor
   replaces its local draft with it, even when it had unsaved edits (the confirm dialog says so).
6. **Persona samples** — played from `sampleUrl` (`/voice/samples/<id>.mp3`). That path sits under the `/voice/*`
   engine proxy; see studio-backend's note — infra must let `/voice/samples/` through to the static files (or move
   the samples) before the play buttons work in production.

## Tests

- `server/voice/studio-frontend.test.ts` (vitest; the suite only includes `server/**`, so the client's pure helper
  file `client/src/lib/voice-studio.ts` is tested from there — new file, not in another lane's list).
- `e2e/40-call-assistant-studio.spec.ts` — 7 browser tests against a child server from this worktree, with every
  `/api/crm/voice/*` call answered by an in-browser stateful fixture (SPEC § 6 shapes + the studio-backend
  extensions above). The shell, session, `/api/crm/me` and routing are real. Not covered: the real studio-backend
  routes (they live on another branch) — after integration, re-run this spec once with the mock removed, or add a
  thin smoke against the real `/profile` + `/preview`.

## Untested / left for others

- Against the real studio-backend, engine or numbers lanes: untested (separate branches).
- Audio playback of persona samples: untested (no sample files exist yet).
- The Numbers and Calls tabs are other lanes' files and were not touched.
