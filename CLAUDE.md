# ConstructHUB — operating rules for Claude

Construction-permit data aggregator + GMB/Google-Ads toolset. Express 5 + React/Vite/shadcn +
Drizzle (Postgres). Imported from Replit 2026-07-06; **LIVE at https://constructhub.us since
2026-07-10** (self-hosted on vb7 — see Deploy below). GBP/GMB API access: **approved by Google
2026-09-23** (application #3, after two rejections — details in `HANDOFF.md` → "GBP API access timeline").

## 🚫 HARD RULE — never fabricate data
This project shipped from Replit with **~100% fabricated government data** (guessed `.gov` URLs,
hash-generated phone numbers and addresses). That is the single worst defect here and it has been
removed. **Never reintroduce it.**
- Government data (appraiser offices, permit portals, phones, addresses) must come from a **real,
  verified source** — never generated, guessed, or hash-derived.
- Unknown value → **`null`**, and the UI shows an honest fallback (e.g. "Find permit portal" web
  search), never a fake link.
- Every published portal URL is **checked** (see the pipelines below). Owner-approved link policy
  (audit a4 round 2): `verified` is live/on-topic; `unconfirmed` is a source-listed URL whose check
  was blocked or inconclusive, and stays visible with its status and last-checked date. `dead`
  (DNS/refused connection, 404/410, soft 404, parking, invalid browser TLS or a generic homepage)
  becomes null after replacement research. An absent source URL is `none`, never guessed.
- A statewide portal can be verified through its state-agency identity plus a county-specific
  source listing; it need not name each county. See `analysis/AUDIT-a4.md` → Round 2.

## 🔴 OWNER ORDER (2026-10-09) — a usage limit is never a reason to stop
When a usage/session limit cuts work off, do not stop and report: save the resume plan, schedule the resume for the
reset time (a cron/wakeup that says "resume <task>"), relaunch cut-off agents in their worktrees, and keep going.
"If you get cut off keep working after the session is reset… especially when I told you don't stop."
When Fable reaches its limit, switch the agents to Opus (Agent tool `model: "opus"`) and keep working — never wait for the reset.

## 🚫 Tower boundary
Self-contained. Never pull in another tower project's infra, domains, or accounts — see
`~/HUB/ROUTER.md` for the specifics. Enforced by `.git/hooks/pre-commit` (tower guard).

## Stack & layout
- `server/` — Express 5 + Drizzle. `shared/schema.ts` is the DB schema (source of truth).
- `client/` — React + Vite + shadcn/ui (New York style) + Tailwind.
- `server/data/*.json` — reference data, bundled to `dist/data/` at build (`script/build.ts`).
- `server/hub/` — Hub, the corner assistant (TruthCoder). Its guardrails are deterministic code there, not the
  prompt; its knowledge pack is `server/data/hub-knowledge.md` (prices are tokens filled from `shared/plans.ts`).
- Auth: session (connect-pg-simple) + Google OAuth. Payments: Stripe. Storage: Cloudflare R2. AI: OpenAI.

## Data pipelines (`scripts/`, re-runnable)
- `scrape-netronline.ts` — real assessor/appraiser offices from NETR Online → `server/data/appraisers.json`.
- `build-permit-portals.ts` — verify permit-portal candidates (liveness + permit-specificity) →
  `server/data/permit-portals.json`. Merges `_permit-candidates.json` (workflow output) with the inline list.
- `verify-links.ts` — ping every stored portal, mark dead ones `linkStatus='dead'` + `isActive=false`.
- `apply-schema-migration.ts` — idempotent ALTERs for the data-rebuild schema (use instead of
  `drizzle-kit push`, which trips over pre-existing DB drift: `citations_id_seq already exists`).

## Seeding model
Boot runs `seedDatabase()` (`server/seed.ts`). `seedAllAppraisers` loads real JSON and wipes the old
fabricated rows once (guarded by a "Sourced from NETR Online." sentinel note → idempotent).
`seedPermitPortals` applies verified portals by matching `permit_databases.jurisdiction` ("City, ST"
or "Name County, ST"). Counties/cities from `seed-all-counties.ts` / `seed-all-cities.ts`.

## Commands
`npm run dev` (tsx server) · `npm run build` · `npm start` (dist) · `npm run check` (tsc, must be 0) ·
`npm test` (vitest — CRM server unit + money-path integration tests; integration tests need the dev server) ·
`npm run db:push` (drizzle — but prefer `apply-schema-migration.ts`, see above).

## Marketing pages ship prerendered (SEO)
`npm run build` ends by prerendering every public marketing page (`shared/seo.ts` `MARKETING_ROUTES`:
home, /features + every ready /features/<slug>, /call-assistant, /done-for-you + every
/done-for-you/<slug>, /pricing, /reinstatement, legal pages, guides) with playwright-core's
chromium-headless-shell into `dist/public/prerender/`, plus sitemap lastmod dates in
`dist/seo-manifest.json` (`script/prerender.ts`, `script/build.ts`). No DB or secrets needed; a failure
prints a loud warning and the build still succeeds (`SKIP_PRERENDER=1` skips it). `server/static.ts`
serves a snapshot to every signed-out visitor (never by user agent) and the SPA shell when signed in;
every marketing page gets its title/description/canonical/OG/JSON-LD from `shared/route-meta.ts` +
`shared/seo.ts`. A new public page = a `ROUTE_META` entry + a `MARKETING_ROUTES` entry (the vitest checks both).

## Security (from the code review — keep these intact)
Stripe webhook verifies the raw body + fails closed; cart prices resolved server-side
(`server/catalog.ts`); no hardcoded session secret; auth dev-bypass gated on `DEV_AUTH_BYPASS_USER1`
(not `NODE_ENV`); SSRF-safe Google URL resolver (host allowlist). Don't regress these.

## Deploy
**LIVE at https://constructhub.us since 2026-07-10** — vb7 `~/ConstructHUB` :8110 (systemd --user
`constructhub.service`), local Postgres 16, own Cloudflare tunnel `d8436ec8…` (`constructhub-tunnel.service`).
Update flow: build on tower → `rsync -azc dist/` to vb7 → restart the service (full runbook + owner-pending
items in `HANDOFF.md`). `replit.md` is the inherited architecture doc — historical reference, superseded
by this file + HANDOFF.
