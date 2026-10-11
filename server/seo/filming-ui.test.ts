/** Render regressions for the filming findings. All records here are test fixtures. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import * as cheerio from "cheerio";
import fs from "node:fs";

const state = vi.hoisted(() => ({ search: "", answers: {} as Record<string, unknown>, error: "" }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: state.answers[String(queryKey[0])], isError: !!state.error, error: new Error(state.error), isLoading: false, isSuccess: !state.error }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../client/src/pages/seo/shell", async (original) => ({
  ...await original<typeof import("../../client/src/pages/seo/shell")>(),
  SeoShell: ({ children }: { children: ReactNode }) => children,
  useSeoStatus: () => ({ data: { configured: true, prices: { gridPer100: 100 }, credits: { availableCents: 10000 } } }),
  useSeoSites: () => ({ data: [], isSuccess: true }),
  useSelectedSite: () => [{ id: 7, domain: "fixture.example" }, vi.fn()],
  useSiteMissing: () => false,
  useAddress: () => new URLSearchParams(state.search),
  useScrollTo: () => {},
}));
import Grid from "../../client/src/pages/seo/grid";
import Plan from "../../client/src/pages/seo/plan";
import Explorer from "../../client/src/pages/seo/explorer";
vi.mock("../../client/src/pages/seo/market", async (original) => ({
  ...await original<typeof import("../../client/src/pages/seo/market")>(),
  useMarket: () => [{ locationCode: 2840, languageCode: "en", label: "United States" }, vi.fn()],
}));

const read = (file: string) => fs.readFileSync(new URL(`../../client/src/${file}`, import.meta.url), "utf8");
const render = (component: typeof Grid, address: string) => cheerio.load(renderToStaticMarkup(h(Router, { ssrPath: address }, h(component))));
beforeEach(() => { state.search = ""; state.answers = {}; state.error = ""; });

describe("saved grid scan", () => {
  beforeEach(() => {
    state.answers["/api/seo/sites/7/grid"] = { pin: { name: "Fixture", lat: 1, lng: 1, domain: "fixture.example" }, scans: [], sizes: [3, 5, 7], spacings: [1, 2, 5], suggestion: "" };
    state.answers["/api/seo/sites/7/grid/12"] = { status: "done", scan: { id: 12, keyword: "fixture query", size: 7, spacing: 1, center: { name: "Fixture", lat: 1, lng: 1 }, points: [], rivals: [], summary: { points: 49, checked: 49, found: 0, top3: 0, avgRank: 21 }, fetchedAt: "2026-10-11T12:00:00Z" } };
  });
  it("opens the result before a collapsed new-scan form and retains the metered action", () => {
    state.search = "scan=12";
    const $ = render(Grid, "/seo/local-grid?scan=12");
    expect($('[data-testid="grid-result"]').text()).toContain("7 × 7, 1 mile apart");
    expect($('[data-testid="grid-new-scan"]').attr("open")).toBeUndefined();
    expect($('[data-testid="grid-new-scan"] summary').text()).toBe("Run a new scan");
    const order = $('[data-testid="grid-result"], [data-testid="grid-new-scan"]').toArray();
    expect($(order[0]).attr("data-testid")).toBe("grid-result");
    expect($('[data-testid="button-grid-scan"]').text()).toContain("about");
    expect($('[data-testid="text-grid-cost"]').length).toBe(1);
  });
  it("keeps the form expanded without a saved scan", () => {
    expect(render(Grid, "/seo/local-grid")('[data-testid="grid-new-scan"]').attr("open")).toBeDefined();
  });
  it("a failed read says it could not open the scan and renders no result figures", () => {
    state.search = "scan=12"; delete state.answers["/api/seo/sites/7/grid/12"]; state.error = "Lookup unavailable";
    const $ = render(Grid, "/seo/local-grid?scan=12");
    expect($.text()).toContain("Couldn't open that scan");
    expect($('[data-testid="grid-summary"]').length).toBe(0);
  });
  it("hydrates all scan controls without resetting user edits on each poll", () => {
    const src = read("pages/seo/grid.tsx");
    expect(src).toContain("setKeyword(shown.keyword); setSize(shown.size); setSpacing(shown.spacing);");
    expect(src).toContain("[site?.id, openId, shown?.keyword, shown?.size, shown?.spacing]");
  });
  it("keeps a truncated rival domain available in its title and preserves the last column", () => {
    state.search = "scan=12";
    const saved = state.answers["/api/seo/sites/7/grid/12"] as { scan: { rivals: unknown[] } };
    saved.scan.rivals = [{ name: "Fixture rival", domain: "long-business-domain.fixture.example", ours: false, top3: 4, found: 8, avgRank: 5, reviews: 12, rating: 4 }];
    const $ = render(Grid, "/seo/local-grid?scan=12");
    const domain = $('[data-testid="table-grid-rivals"] a[title="long-business-domain.fixture.example"]');
    expect(domain.text()).toBe("long-business-domain.fixture.example");
    expect(domain.hasClass("truncate")).toBe(true);
    expect($('[data-testid="table-grid-rivals"] th').last().text()).toBe("Reviews");
    expect(read("components/seo-tool/seo-layout.css")).toContain("table-layout: fixed");
  });
});

it("action-plan totals explain both sums and distinguish the recent subset", () => {
  state.answers["/api/seo/sites/7/tasks"] = { tasks: [], counts: { todo: 4, doing: 2, done: 2, dropped: 1, doneRecently: 1 } };
  const $ = render(Plan, "/seo/plan");
  expect($('[data-testid="tab-plan-open"]').text()).toBe("Open (to do + in progress) 6");
  expect($('[data-testid="tab-plan-closed"]').text()).toBe("Closed (done + dropped) 3");
  expect($('[data-testid="plan-summary"]').text()).toContain("Done (all time)");
  expect($('[data-testid="plan-summary"]').text()).toContain("Dropped (all time)");
  expect($.text()).toContain("included in Done (all time)");
});

it("My site remains present when the address already names the owned domain; Analyse is next to the field", () => {
  const $ = render(Explorer, "/seo/explorer?domain=fixture.example");
  expect($('[data-testid="button-explorer-my-site"]').text()).toBe("My site");
  expect($('[data-testid="input-explorer-domain"]').val()).toBe("fixture.example");
  expect($('[data-testid="input-explorer-domain"]').parent().next().attr("data-testid")).toBe("button-explorer-analyse");
});

it("SEO owns its compact overflow menu, active-tab resize reveal and target offsets", () => {
  const layout = read("components/seo-tool/layout.tsx"), css = read("components/seo-tool/seo-layout.css");
  expect(layout).toContain("new ResizeObserver(reveal)");
  expect(layout).toContain("strip.scrollLeft");
  expect(layout).toContain("config.tools.map((tool)");
  expect(layout).toContain("onKeyDownCapture");
  expect(layout).toContain("link.getClientRects().length > 0");
  expect(css).toContain('a:not([aria-current="page"]):not([data-testid="tool-tab-dashboard"])');
  expect(css).toContain("scroll-margin-top: calc(var(--seo-header-height, 96px) + 12px)");
  expect(css).toContain("(max-height: 650px)");
});

it("the audit explains warnings and the rank tooltip reserves space above the plot", () => {
  expect(read("pages/seo/audit.tsx")).toContain("Warnings and notices do not lower this score, even when they affect every page.");
  const rank = read("pages/seo/rank-history.tsx");
  expect(rank).toContain("margin={{ top: 96,");
  expect(rank).toContain("position={{ x: 0, y: 0 }}");
  expect(rank).toContain('pointerEvents: "none"');
});
