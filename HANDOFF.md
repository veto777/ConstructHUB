# ConstructHUB — Handoff

_Last updated 2026-07-07. Repo: `veto777/ConstructHUB` (private). Local: `/home/veto/ConstructHUB` on the tower._

## TL;DR
Imported from a Replit dump, reviewed, refactored, and had its (~100% fabricated) government data
rebuilt with real, verified sources. **Code is done, type-clean, builds, and is verified end-to-end
against Postgres. It is NOT yet deployed.** Deployment is self-hosted on your own servers — Replit
is only where the code came from, not the destination.

## What was done (13 commits, all pushed)

### 1. Code review + fixes (8 findings, all critical ones)
High-effort multi-agent review found 10 verified defects; fixed:
- **Stripe webhook** trusted forged/unsigned events → now fails closed, verifies the raw body.
- **Cart prices** came from the client → resolved server-side via `server/catalog.ts`.
- **Hardcoded session secret** fallback → removed; boot fails in prod if `SESSION_SECRET` unset.
- **Auth bypass** shipped in the default env (`NODE_ENV=development`) → decoupled to an explicit
  `DEV_AUTH_BYPASS_USER1` flag; `.env.example` now ships `NODE_ENV=production`.
- **SSRF** in the Google URL resolver → host allowlist + IP-literal block.
- **Unauthenticated ranking-grid routes** → now require auth.
- **Contract signing** was 100% broken (a `ReferenceError` typo) → fixed.
- **Inverted scheduler filter** (review emails never sent) → fixed.
- Partial: ranking-grid per-user ownership needs a `user_id` column migration (flagged, not done).

### 2. Type + dead-code cleanup
- **112 → 0 tsc errors** (`npm run check` clean; root cause of the 43 schema errors was
  `.omit({id:true})` on `generatedAlwaysAsIdentity` columns — NOT a version mismatch).
- Removed dead `server/replit_integrations/` and scratch `test_pcpao*.ts`.

### 3. Government data rebuilt (the big one)
The data was fabricated: guessed `.gov` URLs, hash-generated phones/addresses. All removed.
- **Appraisers:** 4,485 real county assessment offices, all 51 states, **3,482 (78%) with a real
  verified portal**, 83% with a real phone — scraped from NETR Online → `server/data/appraisers.json`.
- **Permit portals:** **632 verified real portals across 49 states** (Accela, Tyler EnerGov, eTRAKiT,
  SmartGov, OpenGov, CityView, CitizenServe, …) — discovered by two Fable multi-agent workflows, each
  URL passed a liveness + permit-specificity gate → `server/data/permit-portals.json`.
- **Honest fallback:** every jurisdiction with no verified portal shows a "Find permit portal" web
  search link, never a fake URL.
- **Schema:** appraiser `portal_url`/`search_url`/`platform` made nullable; added
  `link_status`/`last_verified_at` to both data tables.

### 4. Verified end-to-end against real Postgres
Ran on a throwaway local Postgres: schema migration ✓, full seed ✓ (3,136 counties, 3,038 real
appraisers, 319 permit rows with real portals), fabrication gone (permit phones 0) ✓, link verifier
✓ (64 live / 0 dead), API queries return real data ✓.

## Current state
- `npm run check`: **0 errors**. `npm run build`: **passes**. Tower pre-commit guard: clean on all commits.
- **Nothing is deployed. No live database has this data yet.**

## What remains (the deploy)

**Deployment is self-hosted, same pattern as your other self-hosted sites — not Replit.** ConstructHUB needs
its own Postgres (some of your other projects have no DB; this one does).

1. **Decide: is the current constructhub.us live with real USERS/customers?**
   - If **no** → deploy fresh; seeders build all reference data; the Replit DB is never touched.
   - If **yes** → export only the user-generated tables from Replit (`users`, `subscriptions`,
     `course_purchases`, `service_purchases`, `search_queries`, `business_locations`, `citations`,
     `review_requests`, `seo_contracts`, click/tracking tables) and load them into the new DB. All
     reference data (counties, cities, appraisers, permit portals, state guides) regenerates from code.
2. **Provision Postgres** on the target server; set `DATABASE_URL` in the app `.env`.
3. **Create schema:** `npx tsx scripts/apply-schema-migration.ts` on a drizzle-created DB, or a fresh
   `drizzle-kit push`. (Prefer the migration script — `drizzle-kit push` trips over pre-existing drift:
   `relation "citations_id_seq" already exists`.)
4. **Deploy the app** (pm2, same pattern as your other Node apps) and boot → seeders auto-populate real data.
5. **DNS/tunnel** → point constructhub.us at it (same pattern as your other self-hosted sites).

## Secrets
- Live secrets are in `~/ConstructHUB/.env` (mode 600, gitignored), built from
  `~/Construct_hub_secrets.txt`. `.env.example` documents every key.
- **⚠️ ROTATE THEM** — they sat in the old Replit git history (Stripe, OpenAI, R2, Google, SMTP,
  `SESSION_SECRET`). `DATABASE_URL` was NOT in the secrets dump (Replit-injected).

## Env vars the app needs (see `.env.example`)
`DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `PORT`, Google OAuth
(`GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_PLACES_API_KEY`), Google Ads/LSA, R2 (`R2_*`), SMTP (`SMTP_*`),
Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), OpenAI (`AI_INTEGRATIONS_OPENAI_*`).
Local dev only: `DEV_AUTH_BYPASS_USER1=true` (never in prod).

## Re-running / extending the data pipelines
- More appraiser refresh: `npx tsx scripts/scrape-netronline.ts` (resumable).
- More permit portals: add candidates + `npx tsx scripts/build-permit-portals.ts` (or run another
  discovery workflow → `server/data/_permit-candidates.json` → the same script verifies + merges).
- Periodic dead-link sweep (needs `DATABASE_URL`): `npx tsx scripts/verify-links.ts`.

## Open items
- [ ] Deploy (steps above) — **primary remaining work**.
- [ ] Rotate secrets.
- [ ] Confirm whether real user data must migrate from Replit.
- [ ] Ranking-grid per-user ownership (`user_id` column migration) — deferred from the review.
- [ ] Optional: keep expanding permit-portal coverage past 632 (pipeline is built for it).
