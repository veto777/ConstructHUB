import { expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import {
  ReportTable,
  MetricTiles,
  LoadingReport,
  ReportError,
  cloudflareColumns,
  sumKnown,
  percent,
} from "../../client/src/components/site-connections/report";
import {
  syncRange,
  urlBelongsToProperty,
  previewFingerprint,
} from "../../client/src/components/site-connections/context";
import { UrlActions } from "../../client/src/components/site-connections/url-actions";
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
it("a failed list refresh hides stale counts and rows and offers retry", () => {
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
  expect(html).toContain("Retry");
  expect(html).not.toContain("stale row");
  expect(html).not.toContain("3 results");
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
