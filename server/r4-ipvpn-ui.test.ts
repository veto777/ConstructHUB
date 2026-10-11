import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { Chrome, Compass, Globe, Laptop, Smartphone, Tablet } from "lucide-react";

const state = vi.hoisted(() => ({ query: {} as any }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: () => state.query,
}));
import { DashboardView, PagesView, browserIcon, osIcon } from "@/pages/ip-tracker";
import { blockingNotice } from "@/pages/vpn-shield";
import { GEO_SOURCE_NOTE } from "@/components/ip-tracker/country-names";

beforeEach(() => {
  state.query = { data: undefined, isError: false, isLoading: true, dataUpdatedAt: 0, refetch: vi.fn() };
});

it("gives each browser and OS its own icon, neutral when there is no generic one", () => {
  expect(browserIcon("Chrome")).toBe(Chrome);
  expect(browserIcon("Safari")).toBe(Compass);
  expect(browserIcon("Firefox")).toBe(Globe);
  expect(browserIcon("Edge")).toBe(Globe);
  expect(osIcon("iOS")).toBe(Smartphone);
  expect(osIcon("Android")).toBe(Smartphone);
  expect(osIcon("iPadOS")).toBe(Tablet);
  expect(osIcon("Windows")).toBe(Laptop);
  expect(osIcon("macOS")).toBe(Laptop);
  expect(osIcon("Unknown")).toBe(Globe);
});

it("says 'after you save' only while the mode is changing to blocking", () => {
  expect(blockingNotice("log", "block")).toBeNull();
  expect(blockingNotice("block", "log")).toEqual({ headline: "Blocking turns ON when you save.", changing: true });
  expect(blockingNotice("block", undefined)).toMatchObject({ changing: true });
  expect(blockingNotice("block", "block")).toEqual({ headline: "Blocking is ON.", changing: false });
  expect(blockingNotice("redirect", "block")).toMatchObject({ changing: true });
});

it("names the date location data starts from", () => {
  expect(GEO_SOURCE_NOTE).toMatch(/since Sep 30, 2026/);
  expect(GEO_SOURCE_NOTE).not.toMatch(/this update/);
});

it("shows one Updated line on the dashboard and a labelled maximum on the daily chart", () => {
  const hour = new Date(); hour.setMinutes(0, 0, 0);
  const key = hour.toISOString().slice(0, 13);
  state.query = { ...state.query, isLoading: false, dataUpdatedAt: Date.parse("2026-10-10T12:00:00Z"),
    data: { totalVisits: 12, hourlyVisits: { [key]: 12 }, trafficSources: [] } };
  const html = renderToStaticMarkup(React.createElement(DashboardView, {
    domainId: 1, domains: [], analyticsQuery: state.query, domainsQuery: { isError: false, dataUpdatedAt: Date.parse("2026-10-10T11:59:00Z") },
  }));
  expect(html.match(/Updated /g)).toHaveLength(1);
  expect(html).not.toMatch(/Visit summary:|Online visitors:|Project totals/);
  expect(html).toContain('data-testid="text-daily-max"');
  expect(html).toMatch(/12 visits<\/span>/);
  expect(html).toMatch(/aria-label="[A-Z][a-z]{2} \d+: 12 visits"/);
});

it("labels the Pages totals as all time", () => {
  state.query = { ...state.query, isLoading: false, dataUpdatedAt: 1, data: [{ url: "/", hits: 7, uniqueVisitors: 2 }] };
  const html = renderToStaticMarkup(React.createElement(PagesView, { domainId: 1 }));
  expect(html).toContain("All recorded visits (all time).");
  expect(html).toContain("All time");
});
