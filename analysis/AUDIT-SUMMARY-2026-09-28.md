# ConstructHUB full audit — 2026-09-28 summary

Four Codex lanes (Kimi's login had expired), two rounds each, reviewed and merged by Claude, deployed
to vb11 production 2026-09-29 00:17 UTC (pre-deploy DB dump:
`vb11:~/ConstructHUB-live/backups/pre-audit-deploy-20260929T001714Z.dump`).
Detailed reports: `AUDIT-a1.md` (CRM), `AUDIT-a3.md` (growth platform), `AUDIT-a2-gbp.md` (GBP
integration), `AUDIT-a4.md` (government data).

Verification on merged main: 795/795 Vitest; CRM browser suite 169 passed + 5 load-flaky (pass
alone), serial 24 + 1 flaky; growth 26/27 (the 1 = env had a Places key), GBP 3/3.

## Restored after GBP approval
- Competitor Intel (flag on) — minus **Public Ad Activity** (`SHOW_AD_ACTIVITY=false`, `/api/ad-spy/*`
  410): it fabricated "ads" from Places listings.
- Google Reviews (flag on) — made compliant first: every rating offered Google; no review
  incentives ($5k drawing, +1% bonus removed; 3% referral now a per-contractor setting, off by
  default); no Yelp ask; AI drafting keeps the customer's own words/sentiment.

## Fixed (highlights)
- CRM money: concurrent double payments; signed discounts lost on invoicing; draw rounding; atomic
  Stripe reconciliation with durable ids; refunds reverse invoice balances (ledger).
- CRM access: cross-org references; division/assignment object access on every direct-ID route;
  price-blind event redaction; CSV formula neutralization.
- Growth: permit search history/schedules and ranking scans were global/unauthenticated → owned;
  AI/photo cost budgets; BS Meter framed as sampled heuristics; geocoded competitor scans with visible
  provider failures; timezone-aware reminders; recipient-wide unsubscribe; session revocation on
  password reset + auth rate limits; OAuth `state`; bearer tokens stripped from analytics.
- GBP: scoped grants, account/location import, review sync, reply publish/delete confirmed by Google,
  performance metrics; random "Seed Demo Data" removed.
- Government data: 4,485 offices + 632 portals rechecked; 2,839 verified / 1,576 unconfirmed
  (shown, labelled) / 308 dead removed; 4,194 source-verified phones; seeders now update existing
  rows. Live: appraisers 1,778 verified / 939 unconfirmed / 172 dead / 151 none (3,040 county rows).

## Owner actions
1. GBP go-live: enable in project construction-hub-489119 — My Business Account Management API,
   My Business Business Information API, Google My Business API, Business Profile Performance API;
   add redirect URI `https://constructhub.us/api/gbp/callback` (keep the login callback); then
   Locations → Connect Google Business Profile.
2. Stripe test key (`sk_test_…`) so checkout/refund flows can be exercised end to end off-production.
3. SignalWire signing key on vb11 (closes unsigned inbound SMS fallback).
4. Decisions: CRM Terms "never text" vs Privacy SMS wording; whether CRM access needs its own
   subscription; historical Stripe reconciliation for ambiguous legacy rows (none in prod today).
5. Re-login Kimi (`kimi` interactive) if you want a second-opinion pass.

## Recommended next work (ranked)
1. Replace `/google-ad-fraud` article — unsubstantiated statistics/claims (a3 R2 #4).
2. Real ad data source before re-enabling Ad Activity; BS Meter validation.
3. Municipal jurisdiction model (1,444 town/city assessor records + 31 city permit portals can't map
   to county rows; CRM office suggestions use city-name text matching).
4. Per-tool site allowances (Gold/Premium) and enforce-or-remove inert Click Guard switches.
5. Durable job/notification outbox (reminders, photo jobs, payment receipts).
6. Full CRM backup + tested restore (current scheduled export = clients/estimates/invoices only).
7. Ranking-grid provider error handling like competitor scans.
8. DB-side pagination for reviews, lists and aggregates; bundle code-splitting (2.8 MB main chunk).
9. Scheduled link re-verification with a human-review queue and "report bad link".
