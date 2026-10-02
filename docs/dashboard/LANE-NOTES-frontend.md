# Dashboard: frontend lane notes

Branch `dash/frontend` (from `dash/skeleton` 921de93). These notes cover what this lane built against the skeleton
fixture and what the backend lane needs to know before the swap.

## Contract change (optional field only)

- `DashboardUsage.surface?: DashboardSurface` was added to `shared/dashboard.ts`. The fixture sends `crmSeats` with
  `href: "/crm/team"`, a CRM page, but usage rows had no `surface`, so the growth app would have routed it to its 404.
  The client reads `surface` when it is present. When it is absent, a `/crm/…` path counts as `"portal"`, because
  the growth app has no `/crm/` routes. Please set `surface: "portal"` on `crmSeats` in the aggregator.

## Calls the client makes

- `GET /api/dashboard` uses query key `["/api/dashboard"]`, `staleTime` `DASHBOARD_CLIENT_STALE_MS`, and refetches on
  window focus.
- `GET /api/dashboard?fresh=1` comes from the Refresh button. The answer goes into the same query key, so the server
  should skip its 60 s cache for this request. The skeleton ignores `fresh` today.
- `?fixture=` is never sent by the client. The e2e adds it with `page.route`.

## Rendering rules the backend can rely on

- Tiles render in payload order inside `DASHBOARD_GROUPS` order. The `crm` tile becomes the CRM snapshot card, which
  shows up to 6 metrics.
- Grid tiles:
  - The first metric is the hero number.
  - Metrics 2 and 3 render as rows.
  - Any metric after the 3rd is not shown.
- A metric with `limit` draws a bar, and `-1` reads "Unlimited".
- `value: null` renders as "—".
- `format: "cents"` is rounded to whole dollars.
- `status: "ok"` with no metrics (`guides`, `reinstatement`) shows the description and a link "Open <title>", or
  `cta` if one is sent.
- `cta.label === "Open"` gets the accessible name "Open <title>".
- The CRM card in `empty` always links to the `/crm-app` gateway (SPEC §4.3), whatever `cta` says.
- The checklist card hides when every visible step is `done`. `requestReviews` is dropped while
  `SHOW_GOOGLE_REVIEWS` is off.
- Usage meters:
  - A monthly meter turns amber at 80 % and red at 100 % ("Limit reached").
  - A standing count (`period: "count"`) at 100 % stays amber and says "All in use", because a solo owner's 1 of 1
    CRM seat is not an overrun.
- `account.resetsAt` is printed on the UTC calendar. 00:00 UTC on Nov 1 reads "Nov 1", not "Oct 31".

## Edits outside the lane's own paths

- `client/src/components/hub/hub-widget.tsx` gets the SPEC §4.6 listener only. `constructhub:hub-open` opens the
  panel and prefills `detail.question` (cut to 500 characters) into the text box. It never sends anything.
- `client/src/components/app-sidebar.tsx` is unchanged. The tiles use lucide icons from the sidebar's own set,
  through `components/dashboard/tile-icons.ts`.

## Not done / open

- No client unit tests for `components/dashboard/format.ts`. `vitest.config.ts` only includes
  `server/**/*.test.ts` and has no `@/` alias. The e2e covers the formatting through the rendered page.
- After the swap, `e2e/dashboard.spec.ts` asserts the fixture-specific statuses (`social` = error, `media` = empty,
  the `new` and `noplan` scenarios). The real API needs either the `?fixture=` switch kept for tests or those
  assertions moved to a mocked payload (`page.route` with `route.fulfill`).
