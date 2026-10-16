# The "i" help system (as of 2026-10-15)

Every signed-in page carries an "i" that says what the page is for, what it does, how to run it and how it
works, with the walkthrough (or the feature's overview film) playing inside the panel. ONE registry drives the
"i" panels, the play button beside them and the `/tutorials` page. Every sentence below was read from the files
it cites; when the code and this page disagree, the code wins — fix the page.

## 1. The registry — `shared/help/registry.ts`

- **Shapes** live in `shared/help/types.ts`. `HelpEntry`: `key`, `title`, the four parts (`whatItIs`,
  `whatItDoes`, `howToUse: string[]`, `howItWorks`), optional `needs[]`, `route`, optional `alsoAt[]`, `group`,
  optional `parent`, `youtube?: { hold }`, `unlisted?`, and the three film fields the registry fills in
  (`video`, `film`, `videoSource`). `HelpDraft` is an entry without those three fields — what a human writes.
- **Keys**: `[a-z0-9-]+` for a feature, `<feature>.<section>` for a section (`cloudflare.connections`). A section
  names its feature in `parent`, is never nested two deep, shares its feature's `group`, and its `route` is the
  feature's route or one under it (`server/help-registry.test.ts`, "a section belongs to a feature").
- **`HELP_GROUPS`** (`types.ts`): `Start here`, `Permits & Databases`, `Google Business`, `Google Ads`,
  `Reviews`, `Tools`, `CRM`, in that order. The Tutorials page groups cards this way. Every group but
  "Start here" is the main app's except `CRM`; a non-"Start here" feature is in `CRM` iff `isCrmRoute(route)`
  (`/crm` or `/crm/…`).
- **Where entries come from**: the inline `entries[]` array at the top of `registry.ts` (the first registry,
  Cloudflare and Search Console onwards) plus `collected`, every default export of
  `shared/help/entries/index.ts`, sorted with the "Start here" films first (`START_HERE_ORDER`) then by key.
  `HELP_ENTRIES = [...entries, ...collected].map(withFilms)`.
- **Text rules** enforced by the test: each of the three prose parts > 20 chars, 3–5 distinct steps, no plan
  name typed (plan names come from `shared/plans.ts`: `moduleNeed(...)`, `SEO_NEED`, `CRM_NEED`), no `$` amount,
  and an entry without a `video` must not say "walkthrough" / "tutorial video" / "watch the video".
- **Lookups**: `helpEntry(key)` (written entries, then a synthesized intro entry — see §3), `HELP_FEATURES`
  (no `parent`, not `unlisted`), `helpSections(featureKey)`, `helpFeaturesIn(group)`, `helpSummary` (first
  sentence of `whatItIs`), `helpShortTitle` (text after the last " → "), `helpMatches(entry, query)` (every
  word somewhere in the entry or its sections), `heldHelpKeys()` / `holdReason()` (YouTube holds, with
  `shared/help/holds.ts`).

### `helpKeyForRoute(pathname)` — the page-to-entry rule

Used by the page headers and the tool shell so a page need not name its key. Query string and hash are dropped,
trailing slashes trimmed. For every entry that is not `unlisted`, each of `[route, ...alsoAt]` is a candidate
when `path === r` or `path.startsWith(r + "/")`; `"/"` never matches as a prefix (the home film is not every
page's "i"). Tie-break order, from `registry.ts`:

1. **Longest matching route** wins (`/cloudflare/connections` beats `/cloudflare`).
2. At equal length, **rank**: sections (`parent`) rank 0; "Start here" entries rank 1; features rank
   `2 + named(key, route)` where `named` is 3 when the key equals the last path segment or `crm-<segment>`,
   2 when it ends in `-<segment>`, 1 when it contains it, 0 otherwise. So `/crm/settings` → `crm-settings`,
   `/crm/pipeline` → `crm-pipeline` (not the shorter `crm-project`), `/cloudflare` → `cloudflare` (its sections
   share the route and lose).
3. Still tied: the **shortest key**, then **alphabetical**. Never file order (the test reverses the list and
   checks the answer holds).

`alsoAt` adds routes an entry is the "i" for when that page has no entry of its own; today only
`shared/help/entries/crm/crm-project.ts` uses it (`route: "/crm/pipeline"`, `alsoAt: ["/crm/projects"]`).
A section on a deeper route than its feature is that route's answer; one on the feature's own route is not.

### Films: `video` vs `film` vs `videoSource` (`withFilms`)

- `video` = `helpVideoFor(key)` from the manifest (§2), else `null`. **The Tutorials page reads only this**;
  "Video coming soon" there means no walkthrough was recorded.
- `INTRO_FALLBACKS: help key → feature-page key` (`shared/feature-pages`). The page's film is the intro film
  `intro-<slug>` (`shared/feature-pages/intro-video.ts`, manifest `videos/intro-<slug>.json`).
  `introFallbackKey(e)` looks up `e.parent ?? e.key`, so **sections inherit their feature's pair** and the
  test refuses a section as a map key. Each pair is owner-reviewed: a key maps to the page at its own route or to a
  pairing listed in `reviewedElsewhere` inside the test.
- `NO_INTRO_FALLBACK: key → reason` excuses a main-app feature that sits at a feature page's route without
  that page's film (today only `home`: the Gabe film is about the assistant). The test demands one or the other
  for every non-CRM, non-"Start here" feature whose route is a feature page's `app.href`.
- `film = video ?? intro-fallback-video ?? null`; `videoSource = "walkthrough" | "intro" | null`. The panel
  plays `film` and labels it by `videoSource` ("Watch the walkthrough" / "Watch the overview film"), so an
  overview film is never passed off as a step-by-step recording.
- `introHelpEntry(key)` synthesizes an `unlisted` entry for `intro-*` keys from the feature page's own copy
  (title, lede, cards, steps) so recorders and YouTube descriptions have text; it gets no card and no "i".

## 2. One file per entry, one file per video

- **Entries added after the first registry** live one per file at `shared/help/entries/<group>/<key>.ts`
  (`default export` of a `HelpDraft`; see `shared/help/entries/google-business/agency.jobs.ts`). The directory
  is the group name lower-cased with non-alphanumerics as `-` (`google-business`, `start-here`); the file name
  is the key. CRM keys match `^crm-`, "Start here" keys match `^brand-` (test, "help entries that live one per
  file"). Why: two producers never edit the same line.
- **`shared/help/entries/index.ts`** and **`shared/help/videos/index.ts`** are GENERATED, one sorted
  `export … from` line per file, by `npx tsx scripts/tutorials/gen-index.ts` (`--check` exits 1 when stale).
  Both carry `merge=union` in `.gitattributes`. The test fails when an index does not match its directory.
- **Video manifests** `shared/help/videos/<helpKey>.json` (`shared/help/videos.ts` `VideoManifestEntry`):
  `helpKey`, `durationSec`, and `video` / `captions` / `poster` each with `key`, `bytes`, `sha256`, plus
  `uploaded: { at, video, captions, poster }` — the time and the ETag R2 answered for each object. Keys are
  `tutorials/<helpKey>.<first 8 hex of sha256>.<mp4|vtt|jpg>` (`TUTORIAL_FILE`), so a re-record is a new
  address under the year-long immutable cache. **Never write one by hand**: `scripts/tutorials/upload.ts
  <helpKey>` writes it after the upload succeeded and regenerates the index. `helpVideoFor(key)` turns the
  manifest into `{ url, durationSec, poster, captions }` through `tutorialMediaUrl` →
  `GET /api/tutorials/media/<file>` (`server/tutorials/media.ts`: public, immutable, byte ranges).
- The full recording line (produce → narrate → record → mux → thumbnail → check → upload, music bed, intro
  films, YouTube) is `docs/tutorials/VIDEO-PIPELINE.md`; the step scripts are `docs/tutorials/scripts/<key>.json`
  (`shared/help/step-script.ts`), and the test requires one for every walkthrough.

## 3. The client

### `client/src/components/help-button.tsx`

- `<HelpButton k="…" />`: the "i". Desktop = Radix Popover (`role="dialog"`), phone = bottom Sheet
  (`useIsMobile`). `data-testid`s: `help-button-<k>`, `help-panel-<k>`, `help-title-<k>`, `help-body-<k>`,
  `help-watch-<k>`, `help-inline-video-<k>`, `help-video-soon-<k>`, `help-play-<k>`, `help-all-<k>`.
- `HelpParts` renders the four labelled parts plus "Needs"; shared with the Tutorials page.
- **Inline player**: when `entry.film` exists the panel's footer button swaps `HelpVideoPlayer` in above the text
  (`PanelBody`, `playing` state, `autoPlay` because the person pressed Watch); closing the panel unmounts and
  stops it. The popover widens from 26rem to 40rem while playing. Without a film the footer says
  "Video walkthrough coming soon" and **no play button renders anywhere**.
- A second button beside the "i" (`help-play-<k>`) opens `HelpVideoDialog`, a modal player that returns focus
  to the play button on close. `filmNoun` / `filmKind` derive the labels from `videoSource`.
- Props: `fallback` (the tool shell's crumb "i": `aria-label="About this page: …"` and it does **not** claim
  a mount); `videoOnly` (only the Watch button, nothing when there is no film — for CRM pages whose "i" is an
  InfoTip); `tutorialsLink` (the "Open in Tutorials" link to `/tutorials#help-<feature>`, off on the Tutorials
  page). A key the registry lacks renders nothing.
- Esc and outside-pointerdown are handled here as well as by Radix (dismissable-layer second-mount race).

### `client/src/lib/use-help-entry.ts` — lazy registry + mount claims

- The registry (~270 KB with entries) is `import()`ed on first use (`loadHelpRegistry`); `useHelpEntry(key)` and
  `useHelpKeyForRoute(pathname)` return `undefined` until it has loaded, then synchronously.
- `HelpMountContext` provides a `claim(key) => unclaim` function. Every `HelpButton` (full or video-only, unless
  `fallback`) and every `InfoTip` calls `useClaimHelpMount` in a layout effect while mounted. Outside a provider
  claiming is a no-op.

### Auto-mount by route

- `PageHeader` (`client/src/components/app-ui.tsx`): `helpKey` prop; omitted → `useHelpKeyForRoute(location)`;
  `null` → no "i". Renders `<HelpButton k={helpKey} />` after the `<h1>`.
- `GoogleSectionHeader` (`client/src/components/google/GoogleSectionHeader.tsx`): same rule, but only when
  `as="h1"` and no `titleAfter` is passed (a `titleAfter` replaces the "i" — `site-connections.tsx` passes the
  tab's own `<HelpButton>` that way).
- `CrmPageHeader` (`client/src/components/crm-ui.tsx`): `infoKey` mounts an `InfoTip`; when `help` is omitted
  the route's entry supplies `<HelpButton k={helpKey} videoOnly={!!infoKey} />` — the full "i" on a page with no
  InfoTip, just the walkthrough beside an InfoTip. `SectionTitle` takes `infoKey` only.
- `SeoShell` (`client/src/pages/seo/shell.tsx`) mounts `<HelpButton k={helpKey} />` from an explicit prop.
- **Tool shell crumb fallback** (`client/src/components/tool/shell.tsx`): the shell provides
  `HelpMountContext` with a counter; `crumbHelp = !!helpKey && helpMounts === 0`. Only while nothing on the page
  claimed a help control does the crumb row render `<HelpButton k={helpKey} fallback />` inside
  `data-testid="tool-crumb-help"`. A React fact, never a DOM query.

### InfoTip — the CRM's ⓘ (`client/src/components/info-tip.tsx`, `client/src/lib/info-content.ts`)

A separate, older map: `INFO_CONTENT[key] = { title, body: string[] }` (2–6 paragraphs, contractor voice, one
example). Loaded on demand by `client/src/lib/use-info-content.ts`. Opens a Radix Dialog
(`info-tip-<k>`, `info-dialog-<k>`); a missing key renders nothing. It claims a help mount, so a CRM page with an
InfoTip gets only the video-only walkthrough button from the registry, not a second full "i".

### Tutorials page (`client/src/pages/tutorials.tsx`)

Cards are `HELP_FEATURES` minus `HIDDEN_ROUTES` (the build's `SHOW_COMPETITOR_INTEL` / `SHOW_GOOGLE_REVIEWS`
switches and, in the native apps, `/master-class`, `/reinstatement`, `/google-ads-guide`). **Admin-only
routes** (`/admin…`, `/lsa-account-manager…`) keep their on-page "i" but their cards appear only once
`/api/auth/me` answers `isPlatformAdmin === true` — never while loading. Sections list under their feature's
card; the player waits for "Watch tutorial" and reads `entry.video` only. `#help-<key>` opens that feature,
`#group-<slug>` scrolls to a group.

### SamplePreview — empty-state samples (`client/src/components/sample-preview.tsx`)

Not the "i", but it is how a page explains itself before it has data (owner 2026-10-15). Rules from the file:
- Shown **only while the real dataset is empty**; one real record and the caller renders the real thing. Never
  mixed with real rows. Never used for government, permit or compliance records (CLAUDE.md: no fabricated data).
- Built from static client fixtures: nothing stored, sent to the server or counted. Every value is obviously made
  up ("Sample Roofing Co.", "123 Example St").
- `<SamplePreview what="…" cta={…} testId>`: a dashed amber `<section aria-label="Sample data: <what>">`
  (`data-sample="true"`); the visible "Sample data · <what>" badge is `aria-hidden`; the optional `cta` (the one
  action that brings real data) sits in the badge row, outside the sample; the children are dimmed, `inert` and
  `aria-hidden`, so nothing in them is read, tabbed to or clicked.
- `lazySample(() => import(fixtureModule), "Name")` loads a fixture module only when the empty state renders
  (`traffic-tool/samples.tsx`, `crm-sample-previews.tsx`, `crm-call-assistant/samples.tsx`); a failed chunk draws
  nothing and non-chunk errors go to `reportClientError`. Users: `google-ads.tsx`, `locations.tsx`, `domains.tsx`,
  `social-media.tsx`, `agency.tsx`, `yelp.tsx`, `vpn-shield.tsx`. Help text may mention the sample when it is
  there (the `ranking-grid` entry's `howItWorks`).

## 4. Tests that enforce it (all static, no server)

- `server/help-registry.test.ts` — every `<HelpButton k="…">` and `helpKey: "…"` row in `client/src` exists
  (computed keys only as `k={helpKey}`); Cloudflare/Search Console have an "i" per tab; four parts, group, key
  shape, unique keys; section/parent rules; every `route` is in `shared/app-routes.ts` and `App.tsx`; every
  sidebar URL has a feature entry; the manifest proof (helpKey, ETags, sha-named keys, byte minimums, step script,
  local file hashes when present); `film`/`videoSource` consistency; `INTRO_FALLBACKS` / `NO_INTRO_FALLBACK`
  reviewed; `helpKeyForRoute` fixtures and order independence; per-file entries named and filed by group;
  generated indexes fresh; no typed plan names or prices; Cloudflare/GSC numbers match the server; step-script
  hygiene (demo identities, no prices in tutorials, sourced prices in brand films).
- `server/seo/help-ui.test.ts` — every SEO page passes a `helpKey` to `SeoShell`, it is `seo` or a section
  of it, every `/seo…` route resolves to the same key by route, the rail's 15 sections exist, no price or vendor.
- `server/crm/info-content.test.ts` — every `<InfoTip k>`, `infoKey="…"`, `infoKey: "…"` and the two
  dynamic sets (`estimates`/`invoices`, `role-*`) exist in `INFO_CONTENT`; entries well-formed.
- `server/help-a11y-ui.test.ts` — static markup: the "i" is a named button with `aria-haspopup="dialog"`, the
  fallback says "About this page", the play button names the film by source, the player's `aria-label` is
  "Walkthrough video: …" / "Overview film: …", no autoplay unless asked, unknown key renders "".
  It also pins SamplePreview: the section's `aria-label`, the `aria-hidden` badge, the `inert` + `aria-hidden`
  sample and the CTA placed before (outside) it.

## 5. Audits (`scripts/tutorials/`)

- `audit-help-routes.ts` — static: reads `<Route path>` lines of `DashboardRouter` and `PortalRouter` in
  `client/src/App.tsx` (public/marketing/token/redirect routes skipped), resolves each through
  `helpKeyForRoute` with `:param` → `1`, prints route / host / entry / film (`walkthrough (key)`,
  `intro film (key)`, `none`); exit 1 when a route has no entry. `--list` prints resolving routes for the
  browser audit, `--list all` every route, `--json` the rows.
- `audit-help-pages.cjs` — Playwright: opens each route against a running dev server (`/crm…` with
  `?portal=1` or `--portal-base`), finds `help-button-*` / `info-tip-*` / `help-play-*`, opens the panel, presses
  Watch and requires a `<video>` inside `help-inline-video-<k>`; records console errors and screenshots to
  `--out` (default `tmp/help-audit`), writes `audit.json`; exit 1 on a missing "i", a panel that does not open or
  a film that does not play. Reports when the "i" found was the shell crumb fallback.

## 6. Checklists

### Add help to a new page

1. Add the `<Route>` in `client/src/App.tsx` and the path to `shared/app-routes.ts`; the test checks both.
2. Write `shared/help/entries/<group-dir>/<key>.ts` exporting a `HelpDraft` (key = file name; `crm-` prefix for
   CRM; `route` = the page's path; plan needs through `shared/plans.ts` helpers, never typed). Every sentence
   from the page's and server's code — cite the files in the header comment, as the existing entries do.
3. `npx tsx scripts/tutorials/gen-index.ts`; commit the regenerated `shared/help/entries/index.ts`.
4. If the page sits at a feature page's `app.href`, add the key to `INTRO_FALLBACKS` (its own page's key) or to
   `NO_INTRO_FALLBACK` with the reason. Leave `video` alone: it appears when a manifest is uploaded.
5. Use `PageHeader` / `GoogleSectionHeader as="h1"` / `CrmPageHeader` for the title and the "i" mounts by route.
   A custom title inside a tool shell gets the crumb fallback. Pass `helpKey` only when the route rule picks the
   wrong entry; pass `null` only on a page that should have none.
6. Run `npm test` (the four files above), `npx tsx scripts/tutorials/audit-help-routes.ts`, then the browser
   audit on the route. If the page is listed in a sidebar, the sidebar test also demands the entry.

### Add a tab section

1. Write the section as `<feature>.<section>` with `parent: "<feature>"`, the feature's `group`, and `route`
   equal to the feature's route (its "i" sits on the tab) or a deeper path under it (then `helpKeyForRoute`
   picks it for that page title). File it beside the feature (`shared/help/entries/<group-dir>/<feature>.<section>.ts`
   or the inline list) and regenerate the index.
2. Mount it: a `{ tab, helpKey }` row in the page's tab list (`site-connections.tsx` renders
   `<HelpButton k={helpKey} />` beside each tab) or a literal `<HelpButton k="feature.section" />`. The test
   requires every section to be mounted or listed under a listed feature.
3. No `INTRO_FALLBACKS` line: a section inherits its feature's film. Add `helpSections` expectations if the
   feature has a fixed count in the test (Cloudflare 7, Search Console 8, the SEO rail).
