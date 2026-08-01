# ConstructHUB — Handoff

_Last updated 2026-07-10. Repo: `veto777/ConstructHUB` (private). Local: `/home/veto/ConstructHUB` on the tower._

## TL;DR
**LIVE at https://constructhub.us (+www) since 2026-07-10**, self-hosted on vb7 behind ConstructHUB's
own Cloudflare tunnel. Imported from a Replit dump, reviewed, refactored, and had its (~100% fabricated)
government data rebuilt with real, verified sources; deployed with a fresh Postgres and fresh secrets
where possible. See "Live deployment" below for the runbook; owner-pending items at the end.

## Live deployment (2026-07-10)
- **Host:** vb7 (`voiceban@50.125.203.201 -p 2252`, password auth via `~/.ssh/.vb_askpass` on the tower).
- **App:** `~/ConstructHUB` on vb7, port **8110**, systemd `--user` **`constructhub.service`**
  (`node --env-file=.env dist/index.cjs`, Restart=always, enabled; linger on).
- **DB:** local Postgres 16 on vb7, role/db `constructhub` (password only in `~/ConstructHUB/.env` on vb7).
  Schema via `drizzle-kit push` + `scripts/apply-schema-migration.ts`. Seeders ran clean:
  3,139 counties · 32,965 permit databases · 3,040 appraisers (2,314 with real portals) · 717 verified
  portals applied (58 unmatched by jurisdiction naming — known, honest fallback covers them).
- **Tunnel:** own named tunnel **`constructhub` `d8436ec8-5bcc-4864-92e8-9d178c1a34a6`**, creds
  `~/.cloudflared/d8436ec8-*.json` on vb7, config `~/ConstructHUB/tunnel/config.yml`,
  **`constructhub-tunnel.service`** (systemd --user). Created on the tower via `cloudflared tunnel create`
  (account-level op using `~/.cloudflared/cert.pem`); DNS via the account-wide DNS token
  (`~/ConstructHUB/secrets/cf_dns_token.txt`, chmod 600).
- **DNS:** apex + www = proxied CNAME → `d8436ec8-….cfargotunnel.com`. **Rollback snapshot** (incl. old
  Replit A `34.111.179.208`): `tunnel/dns-rollback/constructhub.us.json` + `~/HUB/dns-rollback/`.
  MX/TXT (Google mail, DKIM, verifications) untouched.
- **Secrets:** `.env` on vb7 (600) from `Construct_hub_secrets.txt` + **fresh** `SESSION_SECRET` and DB
  password (the Replit-leaked ones were NOT reused). R2 verified live (bucket `constructhub`, has user
  logo uploads). `R2_ENDPOINT`/`R2_BUCKET_NAME` set.
- **Deploy update flow:** build on tower (`npm run build`) → `rsync -azc dist/ …vb7:~/ConstructHUB/dist/`
  → `systemctl --user restart constructhub` on vb7. (Use `-c` checksums; a plain `-az` once shipped a
  partial `dist/data/` and the appraiser seed silently skipped.)

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
- **LIVE at https://constructhub.us** (see "Live deployment" above). `npm run check`: **0 errors**.
  `npm run build`: **passes**. Tower pre-commit guard: clean on all commits.
- DNS was cut over from the old Replit deployment (Google Frontend `34.111.179.208`) on 2026-07-10;
  the Replit app + its DB were left untouched and still exist for the user-data export.

## Replit user-data export (pending — the one migration left)
The old Replit deployment HAD real users (their uploaded logos are in R2 bucket `constructhub`).
The new vb7 DB started fresh, so their accounts/purchases don't exist on the live site until this runs:
- Export only the **user-generated tables** from the Replit DB (`users`, `subscriptions`,
  `course_purchases`, `service_purchases`, `search_queries`, `business_locations`, `citations`,
  `review_requests`, `seo_contracts`, click/tracking tables) and load them into vb7's Postgres.
- All reference data (counties, cities, appraisers, permit portals, state guides) regenerates from
  code — never copy it from Replit.
- Blocker: the Replit `DATABASE_URL` was Replit-injected and is not on this box — the owner must pull
  the export from the Replit side (or copy that env var out of the Replit Secrets pane).

## Secrets
- Live secrets: `~/ConstructHUB/.env` on **vb7** (mode 600); tower copy at `~/ConstructHUB/.env`, both
  built from `~/Construct_hub_secrets.txt`. `.env.example` documents every key.
- `SESSION_SECRET` and the DB password on vb7 are **fresh** (generated at deploy, never in Replit).
- **⚠️ ROTATE THE REST** — Stripe, Google, R2, SMTP sat in the old Replit git history. Needs the
  provider dashboards (owner). `~/ConstructHUB/secrets/cf_dns_token.txt` = account-wide Cloudflare
  DNS token (owner-authorized shared account credential; see the tower memory note
  `cloudflare-account-access`).

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

## GBP API access timeline (Google Business Profile / "GMB" API)
The GMB features (GBP analytics, review management, competitor intel) need Google to grant GBP API
access. **Twice rejected; earliest reapply date: 2026-09-08.** A one-time cloud reminder routine
fires that morning (`trig_015TqJmLWrrjh2Ujm7cwJek3`, claude.ai/code/routines).

| Date | Event |
|---|---|
| before 2026-03-09 | Application #1 submitted (exact date not on this box — it's in the alpinesidingcompany Gmail, case `7-1260000039820`) |
| 2026-03-09 23:07 | **Rejected** — "did not pass our internal quality checks"; likely cause per Replit-agent notes: competitor-surveillance marketing on the site |
| 2026-06-20 ~01:00 ET | Application #2 submitted (Replit era): consent-screen branding verified 12:47 AM (project `gmb-profile-500003`), official form filled ~1:02 AM; sensitive scope `business.manage`; Competitor Intel + review-gating hidden behind flags for the reviewer |
| 2026-07-09 | **Rejected again** (Alpine-account application). Google's stated criteria: requester email must be Owner/Manager of a Business Profile **verified ≥60 days**; website URL on the application must **match** the profile's listed website (official own-domain site) |
| **2026-09-08** | **Reapply window opens** (60 days from the 2026-07-09 rejection). Checklist: profile verified ≥60 days + lists constructhub.us as its website; apply from the Owner/Manager email of THAT profile; zero competitor-surveillance marketing visible on the site; site is live (done 2026-07-10) |

⚠️ The 60-day clock is on the **Business Profile's verification date**, not the rejection: if the GBP
profile that will back the application was verified after 2026-07-10, wait until *its* verification
date + 60 days. Evidence for all of the above: Gmail screenshots in `attached_assets/`
(`Screenshot_2026-06-19_215545_*.png`, `image_17819205*.png`, `image_17819315*.png`, `image_17819317*.png`),
`.agents/memory/competitor-intel-flag.md`, `replit.md`, `client/src/lib/features.ts`.

## Open items
- [ ] **2026-09-08: reapply for GBP API access** (see "GBP API access timeline" above — cloud reminder armed).
- [x] Deploy — **DONE 2026-07-10** (live at constructhub.us, see "Live deployment").
- [ ] Rotate secrets (Stripe, Google, SMTP, R2 — provider dashboards; SESSION_SECRET + DB pw already fresh).
- [x] `STRIPE_WEBHOOK_SECRET` — **DONE 2026-08-01.** Endpoint `we_1Tzdpj4e8DdHYZEhJ2zSi20W` created
      via the Stripe API (no dashboard needed — the API returns the secret at creation), events:
      `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
      Secret in tower + vb7 `.env`; service restarted; unsigned POST → 400; endpoint `enabled`.
- [x] CRM **Stripe Connect webhook** — **DONE 2026-08-01.** Endpoint `we_1TzeAd4e8DdHYZEhJOrdMGU8`
      (`connect=true`) → `/api/crm/stripe/connect-webhook`, all 7 events `server/crm/integrations.ts`
      handles. `STRIPE_CONNECT_WEBHOOK_SECRET` on tower + vb7; verified 400 on unsigned POST.
- [ ] CRM Stripe Connect **client id** — owner: Stripe Dashboard → Settings → Connect →
      Platform settings → copy the `ca_…` client ID into `STRIPE_CONNECT_CLIENT_ID` on vb7 `.env` +
      restart. Until then contractors can't OAuth-connect their own Stripe accounts (the CRM
      payments settings page reports exactly this as "missing"). Everything else is ready.
- [ ] Real OpenAI key — `AI_INTEGRATIONS_OPENAI_API_KEY` is a boot-safe dummy; AI consultant/assistant
      endpoints error until a real key is set (Replit's modelfarm proxy no longer exists).
- [ ] **Export real user data from Replit** — see the "Replit user-data export" section above for the
      table list and the `DATABASE_URL` blocker. The Replit app + DB were left untouched.
- [ ] Ranking-grid per-user ownership (`user_id` column migration) — deferred from the review.
- [ ] Optional: keep expanding permit-portal coverage past 632 (pipeline is built for it).
