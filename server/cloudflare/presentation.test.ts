import { beforeEach, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import {
  ReportTable,
  MetricTiles,
  LoadingReport,
  ReportError,
  ReportTrend,
  cloudflareColumns,
  sumKnown,
  percent,
  accessLabel,
  initialSortDirection,
  analyticsColumns,
} from "../../client/src/components/site-connections/report";
import {
  syncRange,
  urlBelongsToProperty,
  previewFingerprint,
} from "../../client/src/components/site-connections/context";
import {
  UrlActions,
  ReviewDialog,
} from "../../client/src/components/site-connections/url-actions";
// Radix portals don't render on the server: stub the dialog primitives so the
// review dialog's markup can be asserted as static HTML. Handlers are captured
// so tests can drive Esc (onOpenChange) and the confirm click.
const captured = vi.hoisted(() => ({
  openChanges: [] as Array<(open: boolean) => void>,
  confirmClicks: [] as Array<() => Promise<void> | void>,
}));
const dialogStubs = vi.hoisted(async () => {
  const { createElement: h } = await import("react");
  const Div = ({ children, className }: any) => h("div", { className }, children);
  return {
    Dialog: ({ children, open, onOpenChange }: any) => {
      if (open) captured.openChanges.push(onOpenChange);
      return open ? h("div", null, children) : null;
    },
    DialogContent: Div,
    DialogHeader: Div,
    DialogTitle: Div,
    DialogDescription: Div,
  };
});
vi.mock("../../client/src/components/ui/dialog", () => dialogStubs);
vi.mock("../../client/src/components/ui/button", async () => {
  const { createElement: h } = await import("react");
  return {
    Button: ({ children, onClick, ...rest }: any) => {
      if (onClick) captured.confirmClicks.push(onClick);
      return h("button", { ...rest, onClick }, children);
    },
  };
});
it("preserves independently picked sync bounds, including an end-only range", () => {
  expect(syncRange("2026-08-01", "2026-09-01")).toEqual({
    start: "2026-08-01",
    end: "2026-09-01",
  });
  expect(syncRange("", "2026-09-01")).toEqual({ end: "2026-09-01" });
  expect(syncRange("", "")).toEqual({});
});
it("binds a preview to all editable inputs and zone selection, independent of selection order", () => {
  const original = previewFingerprint(
    [1, 2],
    "ads-door",
    "/ads",
    "1.2.3.4",
    "5.6.7.8",
  );
  expect(
    previewFingerprint([2, 1], "ads-door", "/ads", "1.2.3.4", "5.6.7.8"),
  ).toBe(original);
  for (const changed of [
    previewFingerprint([1], "ads-door", "/ads", "1.2.3.4", "5.6.7.8"),
    previewFingerprint([1, 2], "ips", "/ads", "1.2.3.4", "5.6.7.8"),
    previewFingerprint([1, 2], "ads-door", "/new", "1.2.3.4", "5.6.7.8"),
    previewFingerprint([1, 2], "ads-door", "/ads", "", "5.6.7.8"),
    previewFingerprint([1, 2], "ads-door", "/ads", "1.2.3.4", ""),
  ])
    expect(changed).not.toBe(original);
});
it("validates URL membership including subdomains and prefix properties", () => {
  expect(
    urlBelongsToProperty(
      "sc-domain:fixture.example",
      "https://blog.fixture.example/a",
    ),
  ).toBe(true);
  expect(
    urlBelongsToProperty(
      "sc-domain:fixture.example",
      "https://notfixture.example/a",
    ),
  ).toBe(false);
  expect(
    urlBelongsToProperty(
      "https://fixture.example/blog/",
      "https://fixture.example/other",
    ),
  ).toBe(false);
  expect(
    urlBelongsToProperty(
      "sc-domain:fixture.example",
      "https://user:pass@fixture.example/a",
    ),
  ).toBe(false);
  expect(urlBelongsToProperty("sc-domain:fixture.example", "not a URL")).toBe(
    false,
  );
});
it("renders report headers and honest unavailable values without JSON panels", () => {
  for (const field of Object.keys(cloudflareColumns)) {
    const html = renderToStaticMarkup(
      h(ReportTable, {
        caption: field,
        columns: cloudflareColumns[field],
        rows: [{}],
      }),
    );
    expect(html).toContain("<thead>");
    expect(html).toContain('scope="col"');
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("<pre");
  }
  expect(sumKnown(null, "requests")).toBeNull();
  expect(sumKnown([{ sum: { requests: 4 } }, {}], "requests")).toBeNull();
  expect(sumKnown([{ sum: { requests: 0 } }], "requests")).toBe(0);
  expect(percent(null)).toBeNull();
  const html = renderToStaticMarkup(
    h(MetricTiles, { metrics: [{ label: "Clicks", value: null }] }),
  );
  expect(html).toContain("Unavailable");
  expect(html).not.toContain(">0<");
});
it("has separate loading and retryable error displays", () => {
  expect(renderToStaticMarkup(h(LoadingReport))).toContain(
    'aria-label="Loading report"',
  );
  const html = renderToStaticMarkup(
    h(ReportError, { error: new Error("500: unavailable"), retry: () => {} }),
  );
  expect(html).toContain("Retry");
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("No data");
});
it("renders a plan card for module 402s", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const error = new Error(
    '402: {"code":"plan_required","requiredPlan":"pro","message":"Upgrade required"}',
  );
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(
        Router,
        { ssrPath: "/cloudflare" },
        h(ReportError, { error, retry: () => {} }),
      ),
    ),
  );
  expect(html).toContain("plan-required");
  expect(html).not.toContain("402:");
  client.clear();
});
it("URL rows use named properties and keep invalid or blank requests disabled", () => {
  const html = renderToStaticMarkup(
    h(UrlActions, {
      assets: [
        {
          id: 12,
          name: "Fixture site",
          external_id: "sc-domain:fixture.example",
        },
      ],
      busy: false,
      submit: async () => ({}),
    }),
  );
  expect(html).toContain("Fixture site");
  expect(html).toContain("Choose property");
  expect(html).toContain("disabled");
  expect(html).not.toContain("Property IDs");
});

// Exercise the shared list's real query branches, including stale data after a failed refresh.
import { DataList } from "../../client/src/pages/site-connections";
it("a failed list refresh keeps the saved rows and counts, flagged with their saved time and a retry", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = ["/fixture?q=&page=1&limit=25&status="];
  client.setQueryData(key, { total: 3, items: [{ name: "stale row" }] });
  client
    .getQueryCache()
    .find({ queryKey: key })!
    .setState({ status: "error", error: new Error("500: Report unavailable") });
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(DataList, { title: "Events", url: "/fixture", render: (r) => r.name }),
    ),
  );
  // Last-good presentation survives: the row, the total, and no empty state…
  expect(html).toContain("stale row");
  expect(html).toContain("3 results");
  expect(html).not.toContain("No data available");
  // …flagged honestly, with the saved time and a Retry.
  expect(html).toContain("Refresh failed — showing saved data from");
  expect(html).toContain("button-retry-saved-data");
  expect(html).not.toContain("role=\"alert\"");
  client.clear();
});
it("a list that never loaded shows the bare error, not zeros and not an empty state", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  const key = ["/fixture?q=&page=1&limit=25&status="];
  client.setQueryData(key, { total: 0, items: [] });
  client
    .getQueryCache()
    .find({ queryKey: key })!
    .setState({
      status: "error",
      error: new Error("500: Report unavailable"),
      data: undefined,
      dataUpdatedAt: 0,
    });
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(DataList, { title: "Events", url: "/fixture", render: (r) => r.name }),
    ),
  );
  expect(html).toContain("Report unavailable");
  expect(html).toContain("Retry");
  expect(html).not.toContain("Refresh failed");
  expect(html).not.toContain("0 results");
  expect(html).not.toContain("No data available");
  client.clear();
});
it("a list module 402 renders PlanRequired instead of an empty dataset", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = ["/fixture?q=&page=1&limit=25&status="];
  client.setQueryData(key, { total: 0, items: [] });
  client
    .getQueryCache()
    .find({ queryKey: key })!
    .setState({
      status: "error",
      error: new Error(
        '402: {"code":"plan_required","requiredPlan":"pro","message":"Upgrade required"}',
      ),
    });
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(
        Router,
        { ssrPath: "/cloudflare" },
        h(DataList, { title: "Events", url: "/fixture", render: () => null }),
      ),
    ),
  );
  expect(html).toContain("plan-required-cloudflareSearchConsole");
  expect(html).not.toContain("No data available");
  client.clear();
});
it("a pending list displays skeletons, never the successful empty state", () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(DataList, { title: "Events", url: "/fixture", render: () => null }),
    ),
  );
  expect(html).toContain('aria-label="Loading report"');
  expect(html).not.toContain("No data available");
  client.clear();
});
import { DatasetStatus } from "../../client/src/pages/site-connections";
it("a failed inspection job is never labeled as successfully completed", () => {
  const client = new QueryClient();
  client.setQueryData(["/api/gsc/assets/12/sync-status"], {
    jobs: [
      {
        kind: "inspect",
        state: "failed",
        finished_at: "2026-10-10T10:00:00Z",
        error: "Provider unavailable",
      },
    ],
    analytics: { pending: 3, failed: 1, updated_at: null },
    datasets: [],
  });
  const html = renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(DatasetStatus, {
        provider: "gsc",
        id: 12,
        busy: false,
        onSync: () => {},
      }),
    ),
  );
  expect(html).toContain("Importing history");
  expect(html).toContain("Provider unavailable");
  expect(html).not.toContain("Last completed");
  client.clear();
});
import { relativeTime } from "../../client/src/components/site-connections/report";
it("audit dates use relative language while absent dates stay unavailable", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  expect(relativeTime("2026-10-11T10:00:00Z", now)).toBe("2 hours ago");
  expect(relativeTime(null, now)).toBe("Not available");
  expect(relativeTime("invalid", now)).toBe("Not available");
});
it("the review dialog confirms with a real styled button, not a pill missing its surface", () => {
  const html = renderToStaticMarkup(
    h(ReviewDialog, {
      review: "inspect",
      picked: [{ assetId: "12", url: "https://fixture.example/a", selected: true }],
      assets: [
        {
          id: 12,
          name: "Fixture site",
          external_id: "sc-domain:fixture.example",
        },
      ],
      busy: false,
      submit: async () => ({}),
      close: () => {},
      onSubmitted: () => {},
    }),
  );
  // The portal re-supplies the surface tokens (the domains fix)…
  expect(html).toContain("g-surface");
  // …and the primary is a shadcn button — never an unscoped g-pill rendering as bare text.
  expect(html).toContain("button-confirm-queue");
  expect(html).toContain("Confirm and queue");
  expect(html).not.toContain("g-pill");
});
// The r5 regression: ANY dialog close (Esc, X, overlay → Radix onOpenChange(false)) must
// run the plain close — clearing the picked rows belongs to the submit-success path only.
it("cancelling the review dialog closes without touching the submit-success path", () => {
  const close = vi.fn();
  const onSubmitted = vi.fn();
  const submit = vi.fn(async () => ({ queued: 1 }));
  captured.openChanges.length = 0;
  renderToStaticMarkup(
    h(ReviewDialog, {
      review: "inspect",
      picked: [{ assetId: "12", url: "https://fixture.example/a", selected: true }],
      assets: [
        { id: 12, name: "Fixture site", external_id: "sc-domain:fixture.example" },
      ],
      busy: false,
      submit,
      close,
      onSubmitted,
    }),
  );
  expect(captured.openChanges.length).toBe(1);
  // Esc / X / overlay all reduce to onOpenChange(false):
  captured.openChanges[0](false);
  expect(close).toHaveBeenCalledTimes(1);
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
it("only a successful submit fires onSubmitted — a failed submit keeps everything", async () => {
  const close = vi.fn();
  const onSubmitted = vi.fn();
  captured.confirmClicks.length = 0;
  renderToStaticMarkup(
    h(ReviewDialog, {
      review: "sitemap",
      picked: [{ assetId: "12", url: "https://fixture.example/sitemap.xml", selected: true }],
      assets: [
        { id: 12, name: "Fixture site", external_id: "sc-domain:fixture.example" },
      ],
      busy: false,
      submit: async () => ({ queued: 1 }),
      close,
      onSubmitted,
    }),
  );
  expect(captured.confirmClicks.length).toBe(1);
  await captured.confirmClicks[0]();
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  // A rejected or empty result: nothing fires — the dialog stays open with rows intact.
  const close2 = vi.fn();
  const onSubmitted2 = vi.fn();
  captured.confirmClicks.length = 0;
  renderToStaticMarkup(
    h(ReviewDialog, {
      review: "inspect",
      picked: [{ assetId: "12", url: "https://fixture.example/a", selected: true }],
      assets: [
        { id: 12, name: "Fixture site", external_id: "sc-domain:fixture.example" },
      ],
      busy: false,
      submit: async () => null,
      close: close2,
      onSubmitted: onSubmitted2,
    }),
  );
  await captured.confirmClicks[0]();
  expect(onSubmitted2).not.toHaveBeenCalled();
  expect(close2).not.toHaveBeenCalled();
});
it("trend bars are focusable controls with exact values and a labelled maximum", () => {
  const rows = [
    { date: "2026-09-01", clicks: 12 },
    { date: "2026-09-02", clicks: 40 },
    { date: "2026-09-03", clicks: null },
  ];
  const html = renderToStaticMarkup(
    h(ReportTrend, {
      rows,
      label: "Daily clicks",
      date: (r: any) => r.date,
      value: (r: any) => r.clicks,
    }),
  );
  // Labelled scale maximum (the null row is excluded, so 40).
  expect(html).toContain("text-trend-max");
  expect(html).toContain("Max 40");
  // Each bar is a focusable button announcing its exact date and value.
  expect(html).toContain('aria-label="2026-09-01: 12"');
  expect(html).toContain('aria-label="2026-09-02: 40"');
  expect(html.match(/<button/g)!.length).toBe(2);
  // No hover-only role="img" summary that screen readers can't inspect by bar.
  expect(html).not.toContain('role="img"');
  expect(html).toContain('role="list"');
});
it("server-sorted tables disclose the whole report and never re-sort the page client-side", () => {
  const rows = [
    { date: "2026-09-01", clicks: 5 },
    { date: "2026-09-02", clicks: 40 },
  ];
  // The server already returned these in clicks-desc order across all 58 rows.
  const html = renderToStaticMarkup(
    h(ReportTable, {
      caption: "Search analytics",
      total: 58,
      rows,
      columns: [
        { label: "Period", value: (r: any) => r.date, sortKey: "date" },
        { label: "Clicks", value: (r: any) => r.clicks, sortKey: "clicks" },
      ],
      sort: { key: "clicks", dir: "desc" },
      onSort: () => {},
    }),
  );
  expect(html).toContain("Sorted by Clicks descending, across all 58 rows.");
  expect(html).toContain('aria-sort="descending"');
  // Rows stay in server order (5 before 40 would be wrong for desc if re-sorted).
  expect(html.indexOf('aria-sort="descending"')).toBeGreaterThan(-1);
  expect(html).toMatch(/<td[^>]*>40<\/td>/);
  const pos5 = html.indexOf(">2026-09-01</td>");
  const pos40 = html.indexOf(">2026-09-02</td>");
  expect(pos5).toBeLessThan(pos40);
});
it("page-local tables keep the honest within-this-page disclosure", () => {
  const html = renderToStaticMarkup(
    h(ReportTable, {
      caption: "Events",
      total: 60,
      rows: [{ n: 1 }],
      columns: [{ label: "N", value: (r: any) => r.n }],
    }),
  );
  // No onSort: the button itself warns before the user clicks.
  expect(html).toContain("Sorts the rows on this page only");
  expect(html).not.toContain("across all");
});
import { toTrendPeriods } from "../../client/src/components/site-connections/report";
it("mobile report tables label every cell and associate it with its column header", () => {
  const html = renderToStaticMarkup(
    h(ReportTable, {
      caption: "Traffic",
      rows: [{ dimensions: { date: "2026-10-01" }, sum: { requests: 7 } }],
      columns: cloudflareColumns.traffic,
    }),
  );
  // Every cell carries its metric label; every td names the header that describes it
  // (the thead is visually hidden below 640px, so labels must live on the cells).
  expect(html).toContain('data-label="Date (UTC)"');
  expect(html).toContain('data-label="Requests"');
  expect(html).toContain('data-label="Unique visitors"');
  const cells = html.match(/<td[\s>]/g)!.length;
  expect(html.match(/headers="[^"]+"/g)!.length).toBe(cells);
  expect(html.match(/data-label=/g)!.length).toBe(cells);
  // The report tables opt into first-column labels for the phone card layout.
  expect(html).toContain("g-table--report");
});
it("server-sorted tables expose a phone-visible Sort by and Direction control", () => {
  const html = renderToStaticMarkup(
    h(ReportTable, {
      caption: "Traffic",
      total: 60,
      rows: [],
      columns: cloudflareColumns.traffic,
      sort: { key: "requests", dir: "desc" },
      onSort: () => {},
    }),
  );
  // Visible below 640px only, and it reflects the server/URL sort state.
  expect(html).toContain("sm:hidden");
  expect(html).toContain("Sort by");
  expect(html).toContain("Direction");
  expect(html).toContain('aria-label="Sort Traffic by"');
  expect(html).toContain('aria-label="Sort direction for Traffic"');
  expect(html).toMatch(/selected[^>]*>Requests<\/option>/);
  expect(html).toMatch(/selected[^>]*>Descending<\/option>/);
  // Whole-report disclosure stays visible where the hidden thead can't be.
  expect(html).toContain("Sorted by Requests descending, across all 60 rows.");
  // Local-only tables get no server-sort control.
  const local = renderToStaticMarkup(
    h(ReportTable, {
      caption: "Events",
      rows: [{ n: 1 }],
      columns: [{ label: "N", value: (r: any) => r.n }],
    }),
  );
  expect(local).not.toContain("Sort by");
});
it("trend ranges over 90 days aggregate to weeks with a persistent date-value readout", () => {
  // 120 consecutive days from 2026-06-01 — far past the ~90-day threshold.
  const rows = Array.from({ length: 120 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 5, 1 + i));
    return { date: d.toISOString().slice(0, 10), clicks: i + 1 };
  });
  const { periods, weekly } = toTrendPeriods(rows, (r: any) => r.clicks, (r: any) => r.date);
  expect(weekly).toBe(true);
  expect(periods.length).toBeLessThan(25);
  for (const p of periods) expect(p.date).toMatch(/^Week of \d{4}-\d{2}-\d{2}$/);
  // The SELECTED range drives the decision too: 58 actual days inside a 132-day
  // selection still render weekly — widening the range asks for the long view.
  const shortData = rows.slice(0, 58);
  const byDataAlone = toTrendPeriods(shortData, (r: any) => r.clicks, (r: any) => r.date);
  expect(byDataAlone.weekly).toBe(false);
  const bySelectedRange = toTrendPeriods(
    shortData,
    (r: any) => r.clicks,
    (r: any) => r.date,
    "2026-06-01",
    "2026-10-11",
  );
  expect(bySelectedRange.weekly).toBe(true);
  expect(bySelectedRange.periods.length).toBeLessThan(20);
  const html = renderToStaticMarkup(
    h(ReportTrend, {
      rows,
      label: "Daily clicks",
      date: (r: any) => r.date,
      value: (r: any) => r.clicks,
    }),
  );
  expect(html).toContain("weekly periods");
  expect(html).toContain("Range over 90 days: each bar totals one week");
  // One bar per week, not 120 daily bars.
  expect(html.match(/<button/g)!.length).toBe(periods.length);
  // The readout is pinned to the max period without any hover, date and value both shown.
  expect(html).toContain("text-trend-selection");
  const maxPeriod = periods.reduce((a, b) => ((b.value ?? -Infinity) > (a.value ?? -Infinity) ? b : a));
  expect(html).toContain(`${maxPeriod.date}: ${maxPeriod.value!.toLocaleString("en-US")}`);
  expect(html).toContain('aria-pressed="true"');
});
it("the trend chart is a single Tab stop with arrow-key roving selection", () => {
  const rows = [
    { date: "2026-09-01", clicks: 12 },
    { date: "2026-09-02", clicks: 40 },
    { date: "2026-09-03", clicks: 8 },
  ];
  const html = renderToStaticMarkup(
    h(ReportTrend, {
      rows,
      label: "Daily clicks",
      date: (r: any) => r.date,
      value: (r: any) => r.clicks,
    }),
  );
  // Exactly one bar is in the tab order; the rest are reached with arrow keys.
  expect(html.match(/tabindex="0"/g)!.length).toBe(1);
  expect(html.match(/tabindex="-1"/g)!.length).toBe(2);
  // Daily range stays daily, and the default selection is the maximum bar.
  expect(html).toContain("daily periods");
  expect(html).toContain("2026-09-02: 40");
});
import SiteConnections from "../../client/src/pages/site-connections";
it("a failed config refetch keeps the saved data under a strip, never a bare alert", () => {
  // Render-time window reads (URL params / deep-link notice) need a minimal browser shim.
  const original = (globalThis as any).window;
  (globalThis as any).window = {
    location: { search: "", href: "http://localhost/search-console" },
    history: { replaceState: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  try {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ["/api/gsc/connections?limit=1"];
    client.setQueryData(key, { total: 1, items: [{ id: 3, email: "fixture@example.invalid" }] });
    client
      .getQueryCache()
      .find({ queryKey: key })!
      .setState({ status: "error", error: new Error("500: config unavailable") });
    const html = renderToStaticMarkup(
      h(
        QueryClientProvider,
        { client },
        h(Router, { ssrPath: "/search-console" }, h(SiteConnections, { provider: "gsc" })),
      ),
    );
    // Saved data survives under the strip — the page keeps rendering its content.
    expect(html).toContain("strip-saved-data");
    expect(html).toContain("Refresh failed — showing saved data from");
    expect(html).not.toContain('role="alert"');
    // Never-loaded config still falls back to the bare error panel.
    const fresh = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false } },
    });
    const key2 = ["/api/cloudflare/connections?limit=1"];
    fresh.setQueryData(key2, { total: 0, items: [] });
    fresh
      .getQueryCache()
      .find({ queryKey: key2 })!
      .setState({
        status: "error",
        error: new Error("500: config unavailable"),
        data: undefined,
        dataUpdatedAt: 0,
      });
    const html2 = renderToStaticMarkup(
      h(
        QueryClientProvider,
        { client: fresh },
        h(Router, { ssrPath: "/search-console" }, h(SiteConnections, { provider: "cloudflare" })),
      ),
    );
    expect(html2).toContain('role="alert"');
    expect(html2).not.toContain("strip-saved-data");
    client.clear();
    fresh.clear();
  } finally {
    (globalThis as any).window = original;
  }
});

it("preserves missing dates as unknown, distinguishes observed zero and labels partial weeks", () => {
  const rows = [{ date: "2026-06-01", clicks: 0 }, { date: "2026-06-03", clicks: 9 }];
  const daily = toTrendPeriods(rows, r => r.clicks, r => r.date, "2026-06-01", "2026-06-04");
  expect(daily.periods.map(p => p.value)).toEqual([0, null, 9, null]);
  const weekly = toTrendPeriods(rows, r => r.clicks, r => r.date, "2026-06-01", "2026-10-01");
  expect(weekly.weekly).toBe(true);
  expect(weekly.periods[0]).toMatchObject({ value: 9, partial: true });
  expect(weekly.periods[1].value).toBeNull();
  const empty = toTrendPeriods([], r => r.clicks, r => r.date, "2026-06-01", "2026-06-03");
  expect(empty.periods.map(p => p.value)).toEqual([null, null, null]);
  const html = renderToStaticMarkup(h(ReportTrend, { rows, label: "Clicks", value: r => r.clicks, date: r => r.date }));
  expect(html).toContain("No imported data");
  expect(html).toContain("min-w-[24px]");
  expect(html).toContain("overflow-x-auto");
});

it("formats overview counts like the trend while retaining unknowns", () => {
  const html = renderToStaticMarkup(h(MetricTiles, { metrics: [
    { label: "Requests", value: 22010 }, { label: "Unknown", value: null },
    { label: "Invalid", value: NaN }, { label: "Zero", value: 0 },
  ] }));
  expect(html).toContain("22,010");
  expect(html.match(/Unavailable/g)).toHaveLength(2);
  expect(html).toContain(">0</dd>");
});

it("uses plain access labels and chooses descending only for numeric analytics columns", () => {
  expect(["siteOwner", "siteFullUser", "siteRestrictedUser", "siteUnverifiedUser"].map(accessLabel)).toEqual(["Owner", "Full", "Restricted", "Unverified"]);
  for (const column of analyticsColumns) {
    expect(initialSortDirection(column)).toBe(["clicks", "impressions", "ctr", "position"].includes(column.sortKey!) ? "desc" : "asc");
  }
  expect(initialSortDirection()).toBe("asc");
});
