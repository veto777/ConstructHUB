# Dashboard backend lane: notes

*Backend lane, 2026-10-02, branch `dash/backend` (from `dash/skeleton` 921de93).*

`GET /api/dashboard` now serves the real aggregator. Every number comes from the account's own rows, the
active CRM org, or the NETR-sourced appraiser directory. The skeleton's sample payload is still available
through `?fixture=` in development only, as explained below.

## Contract changes (`shared/dashboard.ts`, optional fields only)

| field | why |
|---|---|
| `DashboardUsage.surface?: DashboardSurface` | The CRM seats meter links to `/crm/team?tab=team` on the **portal**. The field is absent for app links, so existing readers are unaffected. The client should resolve `surface: "portal"` with `portalUrl()`, as it does for tiles. |
| `DashboardAccount.endsAt?: string \| null` | A Stripe plan that is set to cancel does not renew. In that case `renewsAt` is `null`, and `endsAt` holds the date the plan ends (`cancel_at`, or else the period end). Without this field the header would have shown "renews …" for a plan that is about to stop. |

The meanings of existing fields are unchanged.

## Metric keys the frontend may see beyond the fixture

| tile | key | notes |
|---|---|---|
| `rankingGrid` | `averageRank` (text) | `ranking_grid_scans.average_rank` of the latest completed grid, shown as stored. |
| `crmLeads` | `needEstimate` | "Leads without an estimate", from the same `/api/crm/attention` logic. |
| `crm` | `todayVisits` | Only for CRM seats **without** `seeReporting`. Those seats get their own visits today instead of the org's money. |
| `lsaLeads` | `cost` (cents) | `lsa_connections.last_cost_total`, with the hint "reported by Google at the last sync". It is the 4th metric. |
| `texting` | `clientTexting` only | `segments` is sent only when the user owns the active org, because texts are metered on the org owner's allowance. |
| `crmSchedule` | `week` | Labelled "Next 7 days" (today 00:00 UTC + 7 days), not a calendar week. |
| `guides`, `reinstatement` | none | Status `ok` with a CTA ("Browse guides", "Get help"), so every tile has a real link. |

Error tiles use one of two messages. A timeout gives "<Title> didn't answer in time. Open the page for live
numbers." A thrown error gives "<Title> couldn't load its numbers right now. Open the page for live numbers."
Both keep the CTA "Open <Title>".

## Decisions to review

- **The dashboard has its own read-only pool** (`server/dashboard/pool.ts`). It holds at most 5 connections and sets `default_transaction_read_only=on` and `statement_timeout=3000`. Any write from a tile query therefore fails by construction, and a slow query is cancelled by Postgres instead of holding a connection after the response. A test covers both. The reused service functions (`getEntitlements`, `monthlyUsage`, `crmStatsFor`, `crmAttentionFor`, `crmTeamActivityFor`, `objectPolicy`, `orgSmsStatus`) still run on the main pool, using the same indexed, org- or user-scoped reads the pages already make.
- **Ads spend and clicks are omitted.** `ads_accounts.snapshot` holds only account structure (`STATE_QUERIES` in `server/ads/protections.ts`: campaign, campaignCriterion, sharedSet and so on). It has no `metrics.*` fields, so there is no spend or click number to show.
- **`?fixture=` is kept in development and removed in production.** The spec said to drop it. The frontend lane's e2e plan runs "against the skeleton (fixture)", so the route still answers the sample payload (with `fixture: true`) when `NODE_ENV !== "production"`. A production server ignores the parameter.
- **Account status.** A dated Stripe-less grant (a trial code) counts as `trialing`. An open-ended manual grant counts as `active`. A platform admin with no plan of their own counts as `active` with the top plan's name, where `none` would have shown "Choose a plan" to the owner.
- **Attention lists.** `crmAttentionFor` reads up to 200 prospect projects for the route, which is unchanged. The dashboard reads up to 1,000 and labels a capped count with the hint "newest 1,000 leads counted" instead of implying a total.
- **Notification links** that start with `/crm` are marked `surface: "portal"`. Absolute URLs are dropped. Today every `notifyUser` link is an app path.

## Extract-only refactors outside `server/dashboard`

- `server/crm/stats.ts`: `crmStatsFor(ctx)` (the `/api/crm/stats` body) and `crmTeamActivityFor(ctx, limit)` (the `/api/crm/team-activity` body). The routes call them. Responses are unchanged.
- `server/crm/follow-ups.ts`: `crmAttentionFor(ctx, { cap = 10, rowLimit = 200 })` (the `/api/crm/attention` body). It also returns `truncated`, which the route strips, so the route's JSON is unchanged.
- The CRM suites that hit those routes passed against a dev server started from this branch: `stats`, `follow-ups`, `notifications-bell`, `inbox-reply-status`, `object-access` and `divisions`.

## Tests

- `server/dashboard/aggregate.test.ts` runs against the real lane DB with throwaway accounts (`test-seed.ts`). It covers:
  - the cache and the timeout;
  - the read-only pool and its statement timeout;
  - a user with no plan (locked tiles and checklist);
  - proof that a locked tile reads no data;
  - that no CRM org is created;
  - a Starter user;
  - an Agency user with seeded data, with exact numbers, built in under 1.5 s;
  - a pinned org;
  - cross-account scoping;
  - a source that throws;
  - a source that never answers (times out in under 3.5 s).
- `server/dashboard/route.test.ts` uses a child server started from this checkout on the first free port in 8240–8260, or on `DASH_TEST_PORT`. It covers:
  - 401 when signed out;
  - the `Cache-Control` header;
  - the cache, and how `?fresh=1` is throttled;
  - a pinned org;
  - the Starter lock, with `crm_orgs` unchanged;
  - an agency teammate who sees their own dashboard;
  - the dev-only fixture.
