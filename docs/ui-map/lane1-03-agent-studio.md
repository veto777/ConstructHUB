# Lane 1 · 03 — Call Assistant Agent Studio (`/call-assistant?tab=studio`)

Audit 2026-10-04, agent "studio", worktree ConstructHUB-audit1 (branch audit/1).
Dev server 8301, signed in as dev platform admin (user 1, org `c5b47b8d-caa8-47e6-ae7e-6248ad5df565` "SKU Dry-Run").
The org's `voice_profiles` row is a never-published draft (`status='draft'`, `published_version=NULL`, `setup_completed_at=NULL`), so the tab opens in the **setup wizard**; "Skip to the editor" reaches the advanced editor. All section fields edit one JSON document (`VoiceProfile`, shared/voice-profile.ts) that is written by **PUT /api/crm/voice/profile** into `voice_profiles.profile` (jsonb) and returned byte-identical by GET (verified live: `profile equal: True` against SQL). AI generation is never triggered by this page: publish/compile is the pure function `compileVoiceProfile` (server/voice/prompt-compiler.ts), verified by code + `server/voice/profile.test.ts`.

Every backend route below goes through `voiceContext` (server/voice/context.ts): 401 → org membership → callAssistant add-on on the org OWNER's subscription (402 `plan_required` when not bought; 402 `payment_required` when past-due — reads stay open, writes are refused) → `manageSettings` permission (403) on writes.

---

## StudioPanel shell — `client/src/pages/crm-call-assistant/studio.tsx`

Decides wizard vs editor from GET /api/crm/voice/profile.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend (METHOD /path → server/file.ts:function → tables.columns, filters, time window) | Verified how | Status |
|---|---|---|---|---|---|---|
| "Loading your assistant…" / `studio-loading` | Loading state | Spinner while the profile is fetched. | studio.tsx:27 | GET /api/crm/voice/profile → server/voice/profile.ts:219 → voice_profiles (org row, created from crm_orgs fields on first access by profile-store.ts:getOrCreateProfile) | code only | OK |
| Plan-required panel (`plan-required-callAssistant`) | Error state | Shown when the profile GET answers 402 (add-on not bought / payment needed); links to Billing. | studio.tsx:28-29 | same GET — 402 body `{code: plan_required\|payment_required}` from context.ts | code + e2e spec "without the add-on" | OK |
| "Couldn't load the assistant" / 501 empty state | Error state | Shown on other load errors (501 = studio backend not wired). | studio.tsx:30-37 | same GET | code only | OK |
| "Your assistant hasn't been set up yet" empty state | Empty state | First-run org + user without manageSettings: explains only owners/admins can run the setup. | studio.tsx:40-46 | client only (canManage from /api/crm/me `permissions.manageSettings`) | code + e2e "members without manageSettings" | OK |
| Wizard ↔ editor switch (`isFirstRun`) | Routing logic | First run = never published AND setup never completed → wizard; otherwise editor. | studio.tsx:39, lib/voice-studio.ts:156-159 | GET /profile fields `publishedVersion`, `setupCompletedAt` (voice_profiles.published_version, setup_completed_at) | live (draft org → wizard shown), SQL | OK |

## Setup wizard — `client/src/pages/crm-call-assistant/studio/wizard.tsx`

10 steps (company, services, serviceArea, credibility, offers, policies, persona, intake, delivery = leadDelivery+escalations, review). Every **Next** PUT-saves the whole draft; the review step blocks Publish until `studioIssues` (client mirror of the server zod schema, lib/voice-studio.ts:257-290) is empty.

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Set up your assistant" header | Static text | Intro. | wizard.tsx:65 | — | live screenshot | OK |
| "Skip to the editor" / `button-wizard-skip` | Button | Leaves the wizard and opens the advanced editor with the current draft. | wizard.tsx:68 | client only | live — see BUG-1 (was stale; fixed) | OK |
| Step chips ×10 / `wizard-step-<id>` | Stepper | Shows progress; click past step → jump (validates + saves the current step first); ✓ / ⚠ / number per state; a failed save paints the chip red (`data-save-failed`). | wizard.tsx:71-89 | PUT /api/crm/voice/profile on forward moves | live (validation toast seen; save verified in SQL) | OK |
| Step issues panel / `wizard-step-issues` | Inline errors | Lists this step's blocking problems (plain words) while you edit. | wizard.tsx:98-102 | client only (mirrors shared/voice-profile.ts schema) | live | OK |
| "Back" / `button-wizard-back` | Button | Previous step (no save). | wizard.tsx:107 | client only | live | OK |
| "Saving…" indicator | Status text | Spinner text while a step save is in flight. | wizard.tsx:109 | — | live | OK |
| "Next" / `button-wizard-next` | Button | Validates the step, PUT-saves the draft, then advances. Failed save → stays, red chip. | wizard.tsx:115, 42-59 | PUT /api/crm/voice/profile → profile.ts:227 → voice_profiles.profile (+updated_at/updated_by_member_id) | live: SQL showed saved value | OK |
| "Publish and go live" / `button-wizard-publish` | Button | Saves, then publishes: POST /profile/publish `{note:"Initial setup", setupCompleted:true}` → server validates, compiles (pure), writes voice_profile_versions (version=max+1), copies draft to published_profile+compiled, status 'live', stamps setup_completed_at. No AI call. Then opens the editor. Disabled while any issue remains. | wizard.tsx:111-113, 36-40 | POST /api/crm/voice/profile/publish → profile.ts:259 → profile-store.ts:publishProfile → voice_profile_versions INSERT + voice_profiles UPDATE | code + server vitest "setup wizard merges…" + e2e fixture (badge v1) | OK |
| Review summary rows ×11 / `review-row-<section>-<i>` | Read-only rows + jump | One line per area ("What the assistant will know"); click jumps to the step that edits it. | wizard.tsx:125-160 | client only | live screenshot; escalations row fixed (BUG-3) | OK |
| Review issues list / `wizard-review-issues` | Inline errors | Every remaining blocking issue, click → jump to its step. | wizard.tsx:144-150 | client only | e2e fixture (`toHaveCount(0)` when clean) | OK |
| "Next: Publish, then try it in the Simulator" badge | Hint | Points at the Simulator tab (route exists: /call-assistant?tab=simulator). | wizard.tsx:161 | client only | route check in index.tsx | OK |

## Editor — action bar, nav — `client/src/pages/crm-call-assistant/studio/editor.tsx`

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Status badge / `badge-studio-status` | Status pill | draft / live / paused — the profile's state. | editor.tsx:94 | GET /profile `.status` = voice_profiles.status ('draft'→'live' on publish, 'paused' via /pause) | live ("draft"), e2e (live/paused) | OK |
| "v<N>" badge / `badge-studio-version` | Badge | The published version number; hidden until the first publish. | editor.tsx:95 | GET /profile `.publishedVersion` = voice_profiles.published_version | e2e fixture (v1→v2) | OK |
| "Unsaved changes" / "All changes saved" / `text-studio-dirty` | Status text | Compares the open draft to what the server last returned. | editor.tsx:96, 41 | client only | live | OK |
| "<n> to fix before publishing" / `text-studio-issues` | Inline errors | Count of blocking problems (same rules the server enforces). | editor.tsx:97 | client only (studioIssues = friendly mirror of shared/voice-profile.ts zod schema) | live ("2 to fix"); e2e | OK |
| "Setup wizard" / `button-studio-wizard` | Button | Re-runs the setup wizard, seeded from the SAVED draft. Disabled while there are unsaved edits (they would be dropped silently — BUG-2, fixed). | editor.tsx:101 | client only | e2e regression test | OK |
| "Pause"/"Resume" / `button-studio-pause` | Button | Pauses the live assistant (callers hear a short message, call ends) or resumes. Only shown after a publish; 409 "Publish the assistant first." if never published. | editor.tsx:102-106 | POST /api/crm/voice/profile/pause|resume → profile.ts:276 → voice_profiles.status | live: 409 on unpublished org (no write, SQL unchanged); e2e fixture toggle | OK |
| "Save draft" / `button-studio-save` | Button | PUTs the whole draft; server re-validates (400 + plain issues on bad data); toast "Draft saved"; dirty flag clears. | editor.tsx:107-109 | PUT /api/crm/voice/profile → profile.ts:227 → voice_profiles.profile | live: SQL round-trip + reload | OK |
| "Publish" / `button-studio-publish` | Button | Opens the publish dialog (disabled while issues exist or a save is running). | editor.tsx:110 | (dialog → POST /profile/publish) | live (disabled state) | OK |
| "Read-only: only members who manage settings…" / `text-studio-readonly` | Note | Shown instead of the buttons when canManage is false. | editor.tsx:115 | client only (canManage from /api/crm/me) | e2e | OK |
| Section nav ×16 / `studio-nav-<id>` | Nav | 14 form sections + Prompt preview + Version history; ⚠ on sections with issues. | editor.tsx:70-88 | client only | live (all 16 clicked) | OK |
| Section select (mobile) / `select-studio-section` | Select | Same nav as a dropdown on small screens. | editor.tsx:118-126 | client only | e2e mobile test | OK |

## Editor — Prompt preview (`studio-nav-preview`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Refresh" / `button-preview-refresh` | Button | Re-runs the compile of the SAVED draft. | editor.tsx:161 | GET /api/crm/voice/profile/preview → profile.ts:288 → profile-store.ts:previewDraft → compileVoiceProfile(draft) (pure; version = next) | live (greeting/persona matched server draft) | OK |
| Unsaved-changes warning / `text-preview-dirty` | Banner | Reminds that unsaved edits are not in the preview. | editor.tsx:165 | client only | code only | OK |
| Stat tiles ×6 / `preview-persona`, `preview-intake`, `preview-spam`, `preview-silence`, `preview-limits`, `preview-compiled` | Stats | Persona voice, question count, spam thresholds, silence timing, turn/call caps, compile time+hash — all from the compiled output. | editor.tsx:172-179 | GET /profile/preview → compiled jsonb-shaped output (in-memory) | live (values matched defaults: Janice/af_heart, 6 questions, 40 turns, 900s) | OK |
| "Greeting" / `preview-greeting` | Compiled text | The exact first sentence the caller hears (default built from company+assistant name + recording notice). | editor.tsx:182 | same GET → prompt-compiler.ts:186-189 | live ("Thank you for calling …, this is Janice — calls may be recorded. …") | OK |
| "System prompt" / `preview-system-prompt` | Compiled text | The full instruction document the AI is given per call. | editor.tsx:186 | same GET | live + e2e fixture | OK |
| "Intake script" / `preview-intake-list` | Ordered list | The questions, in order, with slot keys and (optional) flags. | editor.tsx:190 | same GET | live (6 default keys) | OK |

## Editor — Version history (`studio-nav-versions`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Version rows / `list-versions`, `row-version-<n>` | List | One row per publish: v-badge (highlighted = live), note, date+author. | editor.tsx:234-244 | GET /api/crm/voice/profile/versions → profile.ts:302 → profile-store.ts:listVersions → voice_profile_versions (org-scoped, desc) + crm_members display name as `author`; `published` = (version == voice_profiles.published_version) | live: "Nothing published yet." on draft org; vitest asserts [version, note, published, author] vs DB; e2e fixture | OK |
| "View"/"Hide" / `button-version-view-<n>` | Button | Shows that version's compiled system prompt below. | editor.tsx:240 | GET /api/crm/voice/profile/versions/:n → profile.ts:309 → voice_profile_versions.profile/compiled | e2e fixture + vitest | OK |
| Version prompt / `version-detail-prompt` | Read-only text | The compiled prompt of that version ("(not compiled)" when absent). | editor.tsx:253 | same GET | e2e fixture | OK |
| "Restore" / `button-version-restore-<n>` + confirm dialog (`dialog-version-restore`, cancel/confirm) | Button + dialog | Copies that version's profile into the DRAFT (voice_profiles.profile). Live assistant unchanged until the next publish. Warns when unsaved edits exist. | editor.tsx:241, 258-271 | POST /api/crm/voice/profile/versions/:n/restore → profile.ts:320 → profile-store.ts:restoreVersion (saveDraft of the version's profile) | e2e fixture + vitest (engine still runs old version after restore) | OK |
| Empty state / `text-versions-empty` | Empty state | "Nothing published yet." | editor.tsx:232 | same GET (0 rows) | live | OK |

## Editor — Publish dialog (`dialog-publish`)

| Element (visible label / testid) | Kind | What it does, in plain words | Frontend (file:line) | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Publish version <N+1>" title | Dialog title | Next version number = publishedVersion+1 (server computes max(versions)+1 — same unless a row was deleted, which the UI never does). | editor.tsx:299 | POST /profile/publish → version = max(voice_profile_versions.version)+1 | code + vitest | OK |
| "What changes" list / `list-publish-diff`, `text-publish-no-changes` | Diff summary | Human lines diffing the draft against the live published version (fetched via GET /versions/:publishedVersion); first publish says so. | editor.tsx:286-313 | GET /api/crm/voice/profile/versions/:n | e2e fixture ("Persona: greeting changed", "FAQ: 0 answers → 1 answer") | OK |
| "Note (optional)" / `input-publish-note` | Input | A short note stored on the version row (UI maxLength 200; server accepts up to 500). | editor.tsx:317 | POST /profile/publish → voice_profile_versions.note | e2e fixture (note persisted + shown in history) | OK |
| "Cancel" / `button-publish-cancel` | Button | Closes without publishing. | editor.tsx:321 | — | e2e | OK |
| "Publish" / `button-publish-confirm` | Button | Saves the draft first if dirty, then publishes: validate → compile (pure, no AI) → INSERT voice_profile_versions → UPDATE voice_profiles (published_version, published_profile, compiled, status 'live', setup_completed_at stamp) → returns {version, compiled}. Toast "Published version N". | editor.tsx:322-324, 290-294 | POST /api/crm/voice/profile/publish → profile.ts:259 → profile-store.ts:publishProfile (advisory-lock serialized) | code + vitest + e2e fixture (badge v1→v2) | OK |

## Section: Company — `studio/section-company.tsx` (CompanySection)

All fields write `profile.company.*` in the local draft; persisted by Save/Publish (PUT → voice_profiles.profile). Live round-trip verified for name+tagline (save → SQL → reload → same values).

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Company name" / `input-company-name` | Input (200) | The legal name; required. | section-company.tsx:19-20 | PUT /profile → profile.company.name (schema: 1-200 chars) | live + SQL | OK |
| "Spoken name (optional)" / `input-company-spoken-name` | Input (200) | How the assistant says the name on the phone. | :21-22 | profile.company.spokenName | live | OK |
| "Trade, in one line" / `input-company-trade` | Input (200) | "We are a …" line. | :23-24 | profile.company.trade | live ("Construction & Remodeling" from org industry) | OK |
| "Tagline (optional)" / `input-company-tagline` | Input (200) | May be used when a caller asks what the company is about. | :25-27 | profile.company.tagline | live round-trip | OK |
| "Office phone" / `input-company-phone` | Input (tel) | Number the assistant gives for "what is your number?"; normalized to E.164 by toE164 on change. | :28-29 | profile.company.officePhone (schema: E.164 or "") | live; server 400 on bad value verified | OK |
| "Website" / `input-company-website` | Input (300, url) | Company website. | :30-31 | profile.company.website | live | OK |
| "Timezone" / `select-company-timezone` | Select | Company clock for hours/call-backs; 7 US zones. | :32-34 | profile.company.timezone | live ("Pacific (Los Angeles)") | OK |
| "About the company" / `textarea-company-about` | Textarea (2000, 4 rows) | Plain facts the assistant may read from; blank = says nothing. | :36-39 | profile.company.about | live | OK |
| Hours — 7 day switches + from/to time inputs / `switch-hours-<day>`, `input-hours-<day>-from/to` | Switch + 2 time inputs ×7 | Office hours per weekday (closed Sat/Sun by default). Hint: the assistant answers 24/7 either way; hours decide "call back today vs tomorrow". Compiler speaks them ("OFFICE HOURS: …", prompt-compiler.ts:294-295). | fields.tsx:163-188 | profile.company.hours.<day> {open,from,to} (schema HH:MM 24h) | live (08:00-17:00 Mon-Fri, closed weekends) + compiler code | OK |

## Section: Services & don'ts — `studio/section-company.tsx` (ServicesSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Add service" / `button-add-service` | Button | Adds an empty service row. (No client cap; the schema caps at 40 and studioIssues shows "too many entries" before the server 400s.) | section-company.tsx:59-62 | profile.company.services[] (max 40) | live + schema compare | OK |
| Service row / `row-service-<i>`: name `input-service-name-<i>`, tier radios `radio-service-tier-<i>-primary|secondary`, details `textarea-service-details-<i>`, remove `row-service-<i>-remove` | Repeater | What you sell; "Primary" is pitched, "Only with a primary job" never alone. Empty-name rows block publishing. | :66-90 | profile.company.services[i] {name(1-200), details(≤2000), tier} | live (empty state text seen; add/edit in e2e) | OK |
| "No services yet…" / `text-services-empty` | Empty state | Explains at least one service is required. | :65 | — | live | OK |
| "Materials" / `list-materials` (+input/add/chips/remove) | Chip list (max 40) | What you install; the assistant recommends only these. | :95-96 | profile.company.materials | schema max matches UI (40=40) | OK |
| "Brands" / `list-brands` | Chip list (max 40) | Brands you carry. | :97-98 | profile.company.brands | same | OK |
| "Add a don't" / `button-add-decline` + rows `row-decline-<i>` (`input-decline-what-<i>`, `input-decline-referral-<i>`, remove) | Repeater | What to politely decline + where to send the caller instead. | :101-127 | profile.company.declines[i] {what(1-200), referral} | live + e2e | OK |

## Section: Service area — `studio/section-service-area.tsx`

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "State" / `select-county-state` | Select | Picks which state's county list to show (51 options). | section-service-area.tsx:60-65 | GET /api/crm/voice/counties?state=XX → profile.ts:331 → counties table (state_code=XX, name-sorted) | live (39 WA counties) | OK |
| "Find a county" / `input-county-search` | Input | Filters the county list by name. | :69 | client only | live | OK |
| Region shortcuts / `button-region-<id>` (live: wa-border-to-tacoma, wa-puget-sound; "All of <state>" hidden because the backend already sends `all-wa`; `button-region-clear`) | Buttons | Add a whole region at once / clear the picker state. Counts + "missing" tooltip are honest about unmatched counties. | :76-91 | region defs from server/voice/counties.ts REGION_SHORTCUTS resolved against the counties table | live API regions; e2e | OK |
| County checkboxes / `checkbox-county-<id>` (39 in WA) | Checkboxes | Toggle a county in/out of the service area. | :100-111 | profile.serviceArea.counties[] {id,name,stateCode}; server verifyCountyRefs rejects unknown ids (400, verified live) | live + SQL | OK |
| "Selected" panel / `selected-counties`, count `badge-county-count`, chips `chip-county-<id>` (+ `-remove`) | Panel | Shows chosen counties grouped by state; × removes. | :116-139 | same jsonb path | live ("0 counties") | OK |
| "Home state" / `select-default-state` | Select | State assumed when a caller gives no state; "" allowed ("— none —"). | :140-143 | profile.serviceArea.defaultStateCode ('' or 2 letters) | live | OK |
| "Areas the assistant names out loud" / `list-spoken-areas` | Chip list (max 60) | Spoken phrasing for the area ("the Puget Sound area"). | :147-149 | profile.serviceArea.spokenAreas | schema 60=60 | OK |
| "Caller is outside the area" / `select-out-of-area` | Select | Decline politely vs take the lead anyway (flagged). | :152-154 | profile.serviceArea.outOfArea | live | OK |
| "Out-of-area line" / `input-out-of-area-line` | Input (200) | The exact polite line said to out-of-area callers. | :155-156 | profile.serviceArea.outOfAreaLine | live | OK |

## Section: Credibility — `studio/section-trust.tsx` (CredibilitySection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Years in business" / `input-years-in-business` | Number 0-200, blank=null | Spoken when relevant; blank skips. | section-trust.tsx:19-20 | profile.credibility.yearsInBusiness (int 0-200 nullable) | schema+UI bounds match; live render | OK |
| "Founded (year)" / `input-founded-year` | Number 1800-2100, blank=null | The founding year. | :21-22 | profile.credibility.foundedYear | same | OK |
| "Insured" / `switch-insured`, "Bonded" / `switch-bonded` | Switches | Trust facts the assistant may state. | :25-26 | profile.credibility.insured/bonded | live | OK |
| "Licenses" `list-licenses`, "Warranties" `list-warranties`, "Certifications" `list-certifications`, "Awards" `list-awards`, "Memberships" `list-memberships` | Chip lists (max 20 each) | Typed by you; the assistant quotes as-is, never invents. | :29-33 | profile.credibility.{licenses,warranties,certifications,awards,memberships} | schema 20=20 | OK |
| "Reviews and ratings" / `input-reviews` | Input (200) | e.g. "4.9 stars on Google (312 reviews)" — quoted as typed. | :34-35 | profile.credibility.reviews | live | OK |

## Section: Offers — `studio/section-trust.tsx` (OffersSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Financing available" / `switch-financing` + "Financing details" `textarea-financing-details` (2000) | Switch + textarea | Lets the assistant answer financing questions with the typed details. | section-trust.tsx:47-52 | profile.offers.financing.{available,details} | live | OK |
| "Estimates are free" / `switch-free-estimate` + "How the assistant says it" `input-free-estimate-line` | Switch + input (200) | Free-estimate policy and the exact wording. | :54-55 | profile.offers.{freeEstimate,freeEstimateLine} | live | OK |
| "Add promotion" / `button-add-promotion` + rows `row-promotion-<i>` (name `input-promotion-name-<i>`, "Ends on" `input-promotion-ends-<i>` date, details `textarea-promotion-details-<i>`, remove) | Repeater (schema max 20) | Current promotions; the assistant stops mentioning one after its end date (compiler omits expired — prompt-compiler offersSection). | :57-85 | profile.offers.promotions[i] {name(1-200), details, endsOn(YYYY-MM-DD\|null)} | schema + compiler code | OK |
| "Referral program (optional)" / `textarea-referral-program` | Textarea (2000) | The referral terms. | :86-87 | profile.offers.referralProgram | live | OK |

## Section: Policies — `studio/section-trust.tsx` (PoliciesSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Price questions" / `select-pricing` | Select | never = defer every price to the estimator; ranges = read the typed ranges only. | section-trust.tsx:99-101 | profile.policies.pricing | live ("Never quote…") | OK |
| "Repairs" / `select-repairs` | Select | repairs+replacements / replacements only (uses the referral lines) / repairs only. | :102-108 | profile.policies.repairs | live | OK |
| "Add range" / `button-add-price-range` + rows `row-price-range-<i>` (`input-price-range-service-<i>`, `input-price-range-range-<i>`, remove) | Repeater (shown when pricing=ranges; schema max 40; empty list blocks publish) | Typed price ranges the assistant may read. | :110-130 | profile.policies.priceRanges[i] {service,range} | e2e clamp test covers sibling pattern; schema compare | OK |
| "Minimum job (optional)" / `input-minimum-job` | Input (200) | Said when a request is too small. | :132-133 | profile.policies.minimumJob | live | OK |
| "Handle emergencies" / `switch-emergencies` + "What counts as an emergency" `textarea-emergency-definition` (2000) + "What the assistant promises" `textarea-emergency-line` (200) | Switch + textareas | Emergency handling toggle, definition, and the promise line. | :135-145 | profile.policies.emergencies.{handle,definition,line} | live | OK |
| "Extra rules, verbatim" / `list-rules` | Chip list (max 40) | Appended to the prompt word for word. | :147-148 | profile.policies.rules | hint matches compiler (extraSection) | OK |

## Section: Persona — `studio/section-persona.tsx`

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Voice cards ×6 / `card-persona-<id>` (radiogroup `persona-cards`) | Radio cards | Pick the voice (Janice/Gabe/Sofia/Maya/Marcus/Ethan); name, gender badge, blurb, sample line. | section-persona.tsx:53-83 | profile.persona.presetId (enum, shared/voice-personas.ts); GET /api/crm/voice/personas → profile.ts:341 → personaList() (sampleUrl only when client/public/persona-samples/<id>.mp3 exists) | live API returned all 6 with sampleUrls; files exist; e2e | OK |
| "Play sample" / `button-persona-play-<id>` | Icon button | Plays the pre-rendered sample mp3; disabled with "Sample not rendered yet" when the file is missing (`text-persona-no-sample-<id>`). Client-side audio only — no server call. | :71-76 | client only (static file /persona-samples/<id>.mp3) | live API + files on disk | OK |
| "Assistant's name" / `input-assistant-name` | Input (200) | Blank = the voice's own name. | :87-88 | profile.persona.assistantName | live | OK |
| "When asked 'are you a bot?'" / `input-bot-answer` | Input (200) | The honest answer the assistant gives. | :89-90 | profile.persona.botAnswer | live | OK |
| "Greeting" / `textarea-greeting` | Textarea (200) | Blank = built from company+assistant name; the compiler appends "calls may be recorded" when required (prompt-compiler.ts:183-189). | :92-93 | profile.persona.greeting | live preview matched the rule | OK |
| 'Say "calls may be recorded"' / `switch-recording-notice` | Switch (forced on + disabled in all-party-consent states) | Two-party-consent states are derived from service-area counties + home state (recordingNoticeStates, shared/voice-profile.ts:388); the compiler forces the notice regardless of the switch. Hint names the states. | :94-97 | profile.persona.recordingNotice; compiler overrides per profile | code + live render | OK |
| Warmth / `slider-style-warmth`, Brevity / `slider-style-brevity`, Formality / `slider-style-formality` | Sliders 1-5 + value labels | Style knobs the compiler maps to prompt phrasing bounds. | :99-106 | profile.persona.style.{warmth,brevity,formality} (1-5) | live (4/4/2 = defaults) | OK |
| "Languages: English. Spanish is on the roadmap…" | Static note | Honest statement; schema only allows "en" today. | :108 | profile.persona.languages (["en"]) | schema | OK |

## Section: Intake questions — `studio/section-intake.tsx`

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Question rows / `row-intake-<i>`: prompt `input-intake-prompt-<i>`, "Required" `switch-intake-required-<i>` (`-sm-` variant in the options panel), reorder `button-intake-up-<i>`/`button-intake-down-<i>` + drag handle, remove `button-intake-remove-<i>`, options toggle `button-intake-options-<i>` | Repeater (schema min 1, max 20 — Add disables at 20) | The ordered questions asked one at a time. Keys are normalized to [a-z0-9_]; duplicates/blank prompts/bad keys block publish. | section-intake.tsx:44-105 | profile.intake.questions[i] {key,prompt,required,validation,choices,confirm,neverReadAloud,prefillFrom} | live (6 defaults render); e2e reorder test | OK |
| Options panel / `panel-intake-options-<i>`: "Slot key" `input-intake-key-<i>`, "Answer looks like" `select-intake-validation-<i>`, "Choices" `list-intake-choices-<i>` (when validation=choice, max 20), "Already known from" `select-intake-prefill-<i>`, "Read back once" `switch-intake-confirm-<i>`, "Never read aloud" `switch-intake-never-read-<i>` | Sub-form | Where each answer lands in the lead, its format, prefill source (caller-id confirm / CRM), and read-back behavior. | :80-101 | same jsonb paths | e2e (options panel follows its question on reorder) | OK |
| "Ask a custom question…" / `input-intake-new` + "Add" / `button-intake-add` | Input + button | Appends a custom question with a derived unique key. | :108-113 | profile.intake.questions[] | live + e2e | OK |
| "Default script" / `button-intake-reset` | Button | Restores the 6 owner-written default questions (lib/voice-studio.ts:446). | :114 | client only | live | OK |
| "After the last answer" / `input-submit-line` | Input (200) | Closing line said once the lead is filed. | :118-119 | profile.intake.submitLine | live | OK |
| "Goodbye = submit immediately" / `switch-submit-on-goodbye` | Switch | File what was collected the moment the caller says goodbye. | :120-121 | profile.intake.submitOnGoodbye | live | OK |

## Section: FAQ — `studio/section-rest.tsx` (FaqSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| FAQ rows / `row-faq-<i>`: `input-faq-question-<i>`, `textarea-faq-answer-<i>`, remove | Repeater (schema max 60; Add disables at 60) | Q/A pairs the assistant answers verbatim, ahead of everything else. | section-rest.tsx:18-32 | profile.faq[i] {question,answer} — blank either blocks publish | live empty state; e2e add+publish | OK |
| "Add question" / `button-add-faq` | Button | Adds an empty FAQ row. | :35-37 | profile.faq[] | e2e | OK |

## Section: Escalations — `studio/section-rest.tsx` (EscalationsSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| Rule rows / `row-escalation-<i>`: id badge, "Enabled" `switch-escalation-enabled-<i>`, situation checkboxes `checkbox-escalation-<i>-<kind>` (9 kinds), "Page" `input-escalation-name-<i>`, "By" `select-escalation-channel-<i>` (sms/email), recipient `input-escalation-recipient-<i>` (E.164-normalized on blur for sms), "Message" `textarea-escalation-template-<i>` (+placeholder placeholder list), remove | Repeater (schema max 30; Add disables at 30) | Who gets paged per situation; blank name/kinds/recipient block publish. First enabled rule matching a kind wins (server/voice/escalations.ts). | section-rest.tsx:54-126 | profile.escalations.rules[i]; at call time escalations.ts sends SMS via crm sms / email and writes voice_escalations | e2e (E.164 blur test); server behavior in escalations.test.ts | OK |
| "Remind until they reply" `switch-escalation-reminders-<i>` + "Every" `input-escalation-every-<i>` (15-1440), "From" `input-escalation-from-<i>` (0-23h), "Until" `input-escalation-to-<i>` (1-24h), "For up to" `input-escalation-days-<i>` (1-30 days), follow-up `switch-escalation-followup-<i>` | Switch + 4 number fields + switch | Reminder cadence; worker resends unconfirmed escalations (server/voice/escalations.ts, 30-min worker, production only). | :105-123 | profile.escalations.rules[i].reminders.* — UI bounds match schema exactly | schema compare | OK |
| "Add rule" / `button-add-escalation` | Button | New rule with default kinds human+urgent, id rule-N. | :129-131 | profile.escalations.rules[] | e2e | OK |
| "What the caller hears after an alert" / `input-caller-line` | Input (200) | Spoken right after an alert is sent. | :135 | profile.escalations.callerLine | live | OK |
| "No matching rule → notify the owners" / `switch-fallback-owner` | Switch | Unmatched kinds go to the org's CRM channels; urgent/human ALWAYS reach owners too (server/voice/escalations.ts:251 — matches the hint text). | :136-137 | profile.escalations.fallbackToOwner | server code | OK |

## Section: Lead delivery — `studio/section-rest.tsx` (LeadDeliverySection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "File the lead in the CRM" / `switch-crm-enabled` + "Also start a pipeline project" `switch-crm-create-project` + "Tags on the client" `list-crm-tags` (max 10) | Switch + switch + chip list | Creates/matches the client (by phone) with transcript+recording; optional stage-"lead" project; tags applied. | section-rest.tsx:161-169 | profile.leadDelivery.crm.{enabled,createProject,tags} — consumed at call time by server/voice/leads.ts | live defaults (on/on/["call-assistant"]); schema 10=10 | OK |
| "Email the lead" / `switch-email-enabled` + "Extra email recipients" `list-email-recipients` (max 10, lowercased) | Switch + chip list | Lead email to notification subscribers plus extras. | :171-177 | profile.leadDelivery.email.{enabled,extraRecipients} (zod email) | schema | OK |
| "Text the lead" / `switch-sms-enabled` + "Text these numbers" `list-sms-recipients` (max 10, E.164) | Switch + chip list | SMS from the CRM texting number, metered like any text. | :179-185 | profile.leadDelivery.sms.{enabled,recipients} | schema; studioIssues validates E.164 | OK |
| "Send a summary for every call" / `switch-notify-every-call` | Switch | Also summarize non-lead calls; spam/hangups never notify. | :187-188 | profile.leadDelivery.notifyOnEveryCall | live | OK |

## Section: Appointments — `studio/section-rest.tsx` (AppointmentsSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Let the assistant book estimates" / `switch-appointments-enabled` | Switch | Off by default and honest about it: "Booking tools are not live yet; turning this on records your availability." Compiled profile only carries `appointments.enabled`. | section-rest.tsx:202-203 | profile.appointments.enabled; compiler output `appointments:{enabled}` (prompt-compiler.ts) | live + compiler code | OK |
| "Visit length" `input-slot-minutes` (15-480), "Buffer between" `input-buffer-minutes` (0-240), "Earliest offer" `input-lead-time-hours` (0-336), "Confirm by text" `switch-confirm-sms` | 3 number fields + switch | Availability knobs; bounds match the schema exactly. | :206-211 | profile.appointments.{slotMinutes,bufferMinutes,leadTimeHours,confirmBySms} | schema compare | OK |
| "Add crew" / `button-add-crew` + crew rows `row-crew-<i>` (name `input-crew-name-<i>`, windows: day `select-crew-<i>-window-<k>-day`, from/to `input-crew-<i>-window-<k>-from/to`, remove window `button-crew-<i>-window-<k>-remove`, "Add window" `button-crew-<i>-add-window`, remove crew) | Repeater (schema max 20 crews / 50 windows) | Crew availability windows. | :213-247 | profile.appointments.crews[i] {name(1-200), windows[{day,from,to}]} | schema compare | OK |

## Section: Advanced — `studio/section-rest.tsx` (AdvancedSection)

| Element (visible label / testid) | Kind | What it does | Frontend | Backend | Verified how | Status |
|---|---|---|---|---|---|---|
| "Additional instructions" / `textarea-extra-instructions` | Textarea (4000) | Appended to the system prompt verbatim after every built-in rule. | section-rest.tsx:261-262 | profile.advanced.extraInstructions (≤4000) | live | OK |
| "Creativity" / `input-temperature` | Number 0-1 (step .05) | Model temperature; 0.3 tested default. | :264 | profile.advanced.temperature | live (0.3) | OK |
| "Max turns per call" / `input-max-turns` | Number 4-80 | Turn cap; clamps on blur; 999 blocks Publish. | :265 | profile.advanced.maxTurns | e2e clamp test | OK |
| "Max call length" / `input-max-call-seconds` | Number 60-3600 (step 30) | Hard cap on one call, seconds. | :266 | profile.advanced.maxCallSeconds | live (900) | OK |
| "Advanced timing" `<details>`: "Silence before 'still there?'" `input-silence-seconds` (5-60), "Silence prompts before goodbye" `input-silence-prompts` (1-5), "Greeting delay" `input-greeting-delay` (0-10, step .5) | Disclosure + 3 number fields | Silence handling + forwarded-call bridge delay. | :268-273 | profile.advanced.{silencePromptSeconds,silencePromptsBeforeHangup,greetingDelaySeconds} | live (12/2/3) | OK |
| "Spam sensitivity" / `select-spam-sensitivity` | Select | low/normal/high → compiler maps to flag/strike confidence thresholds (SPAM_THRESHOLDS). Hint about two near-certain calls blocking a number matches server/voice/spam.ts. | :274-276 | profile.advanced.spamSensitivity | compiler + spam.ts code | OK |
| "Words the listener should know" / `list-vocabulary` | Chip list (max 60) | Extra recognizer vocabulary (brands, towns). | :277-278 | profile.advanced.vocabulary | schema 60=60 | OK |

## Notes / context

- `POST /api/crm/voice/profile/setup` (profile.ts:240, `applyWizard`) is a complete parallel wizard-merge API, but **no UI element calls it** — the frontend wizard edits the full profile and uses PUT /profile + POST /publish. The route is exercised by server/voice/profile.test.ts. Not a bug; noted so nobody assumes the UI depends on it.
- Client-side `studioIssues` mirrors the server zod schema (same file: shared/voice-profile.ts) — Publish/Next are disabled for anything the server would 400 on, so the server limits and UI hints were compared field by field (all numeric bounds and maxLengths match; e.g. intake ≤20, FAQ ≤60, escalation rules ≤30, reminders 15-1440/0-23/1-24/1-30).
- The publish/compile path never calls an AI provider: `compileVoiceProfile` is a pure string builder (sha256 hash, deterministic); AI is only used by the Simulator and live calls.
