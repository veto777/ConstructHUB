import { expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatNumber } from "../client/src/components/site-connections/format";
import { ReportTable, MetricTiles, analyticsColumns, cloudflareColumns } from "../client/src/components/site-connections/report";
import guides from "./data/state-guides.json";

it("formats counts without converting missing or invalid data to zero", () => {
  for (const n of [18928, "18928"]) expect(formatNumber(n)).toBe("18,928");
  expect(formatNumber(0)).toBe("0");
  for (const n of [null, undefined, "", " ", false, NaN, Infinity, "bad"]) expect(formatNumber(n)).toBe("Unavailable");
  expect(formatNumber(19522.2, "Unavailable", 1)).toBe("19,522.2");
});
it("uses the same grouped counts in tiles and both provider tables", () => {
  const rows = [{ clicks: 18928, impressions: "19522", sum: { requests: 18928, pageViews: "19522" }, count: "19522" }];
  for (const columns of [analyticsColumns, cloudflareColumns.traffic, cloudflareColumns.paths]) {
    const markup = renderToStaticMarkup(h(ReportTable, { caption: "Regression fixture", rows, columns }));
    expect(markup).toContain("19,522");
    expect(markup).not.toContain(">19522<");
  }
  expect(renderToStaticMarkup(h(MetricTiles, { metrics: [{ label: "Clicks", value: 18928 }] }))).toContain("18,928");
});
it("keeps state overviews free of editorial ease and friendliness claims", () => {
  for (const guide of guides) expect(guide.overview).not.toMatch(/friendly|robust|comprehensive|easiest|simpler|relatively simple|straightforward|well-organized|minimal regulation/i);
});

it("keeps the local-search lesson title aligned without changing the content ID", async () => {
  const { SEO } = await import("./master-class/content/seo");
  const { SEO_LESSONS } = await import("../client/src/components/master-class/module-seo");
  expect(SEO.lessons.find(lesson => lesson.id === "content")?.title).toBe("Content Strategy for Local Search");
  expect(SEO_LESSONS.find(lesson => lesson.id === "content")?.title).toBe("Content Strategy for Local Search");
});
