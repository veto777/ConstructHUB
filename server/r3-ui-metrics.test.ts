import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: {} as any }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: () => state.query,
}));
import { DashboardView, PagesView, TrafficSourcesView } from "@/pages/ip-tracker";

beforeEach(() => {
  state.query = { data: undefined, isError: false, isLoading: true, dataUpdatedAt: 0, refetch: vi.fn() };
});

function tile(html: string, id: string) {
  const start = html.indexOf(`data-testid="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf('data-testid="card-stat-', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

it.each([false, true])("does not manufacture metric zeroes (error=%s)", (failed) => {
  state.query.isError = failed;
  state.query.isLoading = !failed;
  state.query.error = failed ? new Error("offline") : undefined;
  const expected = failed ? "Unavailable" : "…";
  const dashboard = renderToStaticMarkup(React.createElement(DashboardView, { domainId: 1, domains: [], analyticsQuery: state.query }));
  expect(tile(dashboard, "card-stat-online-now")).toContain(expected);
  expect(tile(dashboard, "card-stat-today")).toContain(expected);
  const traffic = renderToStaticMarkup(React.createElement(TrafficSourcesView, { analyticsQuery: state.query, since: new Date("2026-10-01") }));
  for (const id of ["total-sources", "total-page-loads", "unique-visitors"]) expect(tile(traffic, `card-stat-${id}`)).toContain(expected);
  const pages = renderToStaticMarkup(React.createElement(PagesView, { domainId: 1 }));
  for (const id of ["total-pages", "total-hits"]) expect(tile(pages, `card-stat-${id}`)).toContain(expected);
});

it("keeps a successful empty result as zero", () => {
  state.query.data = [];
  state.query.isLoading = false;
  const html = renderToStaticMarkup(React.createElement(PagesView, { domainId: 1 }));
  expect(tile(html, "card-stat-total-pages")).toMatch(/>0</);
  expect(html).not.toContain("Unavailable");
});

it("labels cached metrics with their actual last successful time after a refresh failure", () => {
  state.query = { ...state.query, data: [{ url: "/", hits: 7, uniqueVisitors: 2 }], isLoading: false, isError: true, dataUpdatedAt: Date.parse("2026-10-10T12:00:00Z") };
  const html = renderToStaticMarkup(React.createElement(PagesView, { domainId: 1 }));
  expect(tile(html, "card-stat-total-hits")).toMatch(/>7</);
  expect(html).toContain("Refresh failed — showing saved data from");
  expect(html).toContain(new Date(state.query.dataUpdatedAt).toLocaleString());
});
