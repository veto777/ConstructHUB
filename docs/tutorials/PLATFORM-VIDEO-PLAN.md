# Platform walkthrough videos — the plan (business tools)

Owner (2026-10-10/11): intro video for every feature page, placed at the top of the page (`intro-<key>` slot, shipped in
`0afafa24`); Google Ads, Google Business and the SEO Suite FIRST; the other tools only after the Kimi/Codex fix lanes
bring them to ≥7/7. Then several deep-dive videos per feature, as the CRM got.

Everything follows `PRODUCER-GUIDE.md` (slots, dry runs, narration rules, house framing, produce → inspect → upload).
What differs for platform tools:

- **helpKey = `intro-<kebab feature key>`** (`shared/feature-pages/intro-video.ts`): `intro-gbp`, `intro-profile-guard`,
  `intro-gbp-content`, `intro-media`, `intro-ranking-grid`, `intro-reviews`, `intro-reinstatement`, `intro-agency`,
  `intro-ads-manager`, `intro-click-guard`, `intro-lsa-leads`, `intro-seo`. No help entry is needed for an intro
  (the test allows an `intro-*` manifest + step script whose key names a catalogue feature). Deep dives use normal
  help keys with entries (`shared/help/entries/<group>/`).
- **Routes are on the MAIN host** (`http://127.0.0.1:818N/...`), not the CRM host; a `goto` with a non-/crm path lands
  there. Signed in as user 1 "Demo Account" (dev bypass).
- **Sample data**: the recording template carries the platform seeds (`scripts/tutorials/seed-platform.ts`): the
  listings, reviews, grids, ads accounts, sites etc. belong to "Summit Roofing Co." (Denver) — say "this roofing
  company" / "the listing", never "our customer". The SEO Suite data is `script/feature-shots/seed/50-seo.sql`
  (site summitroofing.example, 40 keywords, 11 weekly checks, grids, backlinks, audit).
- **Never film a connect-an-account screen** (Google, Cloudflare, Ads OAuth): start from the connected state. The
  provider rows carry placeholder tokens, so Sync/Refresh/Run buttons that would call a provider are either disabled
  or must not be clicked; say "runs on its schedule" instead.
- **Intro = 60–90 s, 10–14 steps**: what the tool is for (1 line), the main screen with real data, the 2–3 things a
  contractor does with it, where it is in the menu. End on the feature's menu entry. Thumbnail headline 2–5 words.

## Phase 1 — intros (video-first set)

| # | helpKey | Feature page | Opens at | The viewer learns | Sample data | Slot |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | `intro-gbp` | /features/gbp | /locations | Every Google Business Profile location in one list; open one; insights; what syncs | 3 Summit Roofing locations | 1 |
| G2 | `intro-profile-guard` | /features/profile-guard | /locations (GMB Edit Monitor) | Unwanted edits caught, approved vs detected values, history | guard changes seeded | 1 |
| G3 | `intro-gbp-content` | /features/gbp-content | /gbp-content | AI posts and photo captions queued on a schedule; approve; calendar | content jobs seeded | 2 |
| G4 | `intro-media` | /features/media | /photos | Folders, GPS, SEO filenames, service-area keywords | media folders seeded | 2 |
| G5 | `intro-ranking-grid` | /features/ranking-grid | /ranking-grid | Where you rank on Maps point by point; the report | 7×7 Denver scan | 3 |
| G6 | `intro-reviews` | /features/reviews | /google-reviews | Requests with tracking; synced reviews with AI reply drafts; what the client sees | requests + reviews seeded | 3 |
| G7 | `intro-reinstatement` | /features/reinstatement | /reinstatement | What the request form asks for and what happens next | form only | 4 |
| G8 | `intro-agency` | /features/agency | /agency | Client workspaces, bulk actions across locations | agency clients seeded | 4 |
| A1 | `intro-ads-manager` | /features/ads-manager | /ads-manager | Client Ads accounts, health audit findings, a protection preview before anything touches Google | ads accounts + findings | 5 |
| A2 | `intro-click-guard` | /features/click-guard | /google-ads | Repeat/bot clickers blocked, traffic signals, blocked IPs | click visits + blocks | 5 |
| A3 | `intro-lsa-leads` | /features/lsa-leads | /lsa-leads | LSA accounts in one list; leads with charges and dispute tools | lsa seeded (needs GOOGLE_ADS_* placeholders in the slot env) | 6 |
| S1 | `intro-seo` | /features/seo | /seo | Dashboard → rank tracker → local grid → site explorer → audit → action plan, in 90 s | 50-seo.sql | 6 |

Call Assistant (`intro-call-assistant`) and the other 15 tools wait for the fix lanes.

## Phase 2 — deep dives (after the intros)
One row per capability card of the feature page (`shared/feature-pages/<key>.ts` → `cards`), 45–100 s each, in the
CRM style; SEO Suite gets one per screen (~25). Tracks for `youtube-order.json`: google-business, google-ads, seo.
