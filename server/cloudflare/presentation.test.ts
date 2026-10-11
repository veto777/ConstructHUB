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
// review dialog's markup can be asserted as static HTML.
const dialogStubs = vi.hoisted(async () => {
  const { createElement: h } = await import("react");
  const Div = ({ children, className }: any) => h("div", { className }, children);
  return {
    Dialog: ({ children, open }: any) => (open ? h("div", null, children) : null),
    DialogContent: Div,
    DialogHeader: Div,
    DialogTitle: Div,
    DialogDescription: Div,
  };
});
vi.mock("../../client/src/components/ui/dialog", () => dialogStubs);
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
    }),
  );
  // The portal re-supplies the surface tokens (the domains fix)…
  expect(html).toContain("g-surface");
  // …and the primary is a shadcn button — never an unscoped g-pill rendering as bare text.
  expect(html).toContain("button-confirm-queue");
  expect(html).toContain("Confirm and queue");
  expect(html).not.toContain("g-pill");
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
