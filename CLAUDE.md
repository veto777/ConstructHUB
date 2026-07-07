# ConstructHUB — operating rules for Claude

Construction-permit data aggregator + GMB/Google-Ads toolset. Express 5 + React/Vite/shadcn +
Drizzle (Postgres). Imported from Replit 2026-07-06; being moved to self-hosting on your own servers.

## 🚫 HARD RULE — never fabricate data
This project shipped from Replit with **~100% fabricated government data** (guessed `.gov` URLs,
hash-generated phone numbers and addresses). That is the single worst defect here and it has been
removed. **Never reintroduce it.**
- Government data (appraiser offices, permit portals, phones, addresses) must come from a **real,
  verified source** — never generated, guessed, or hash-derived.
- Unknown value → **`null`**, and the UI shows an honest fallback (e.g. "Find permit portal" web
  search), never a fake link.
- Every portal URL that ships is **liveness-checked** (see the pipelines below). A wrong or dead link
  is worse than none.

## 🚫 Tower boundary
Self-contained. Never pull in another tower project's infra, domains, or accounts — see
`~/HUB/ROUTER.md` for the specifics. Enforced by `.git/hooks/pre-commit` (tower guard).

## Stack & layout
- `server/` — Express 5 + Drizzle. `shared/schema.ts` is the DB schema (source of truth).
- `client/` — React + Vite + shadcn/ui (New York style) + Tailwind.
- `server/data/*.json` — reference data, bundled to `dist/data/` at build (`script/build.ts`).
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
`npm run db:push` (drizzle — but prefer `apply-schema-migration.ts`, see above).

## Security (from the code review — keep these intact)
Stripe webhook verifies the raw body + fails closed; cart prices resolved server-side
(`server/catalog.ts`); no hardcoded session secret; auth dev-bypass gated on `DEV_AUTH_BYPASS_USER1`
(not `NODE_ENV`); SSRF-safe Google URL resolver (host allowlist). Don't regress these.

## Deploy
Self-hosted (NOT Replit). Needs its own Postgres. See `HANDOFF.md` for the full state + deploy steps.
`replit.md` is the inherited architecture doc — historical reference, superseded by this file + HANDOFF.
