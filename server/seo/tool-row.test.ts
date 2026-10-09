/**
 * The SEO dashboard's site row (client/src/components/seo-tool/project-row.tsx) — "everything is clickable and
 * separately" (owner, 2026-10-09). Rendered to markup (no browser): every figure, change, badge, sparkline and sub-count
 * is its own link or button with a non-empty accessible name; within a metric each piece goes somewhere different; the
 * metrics' numbers go to six different reports; nothing is nested in another link and no strip or cell is one big link.
 * The fixture below is test data, not product data.
 */
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import * as cheerio from "cheerio";
import { ProjectRow, type SiteCard } from "../../client/src/components/seo-tool/project-row";

const months = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, v: f(i) }));
const card: SiteCard = {
  site: { id: 7, domain: "fixture.example", locationCode: 2840, languageCode: "en", devices: "desktop", serpDepth: 10, keywordCount: 12, nextRankCheckAt: null, lastRankCheckAt: null, nextBacklinksAt: null, lastBacklinksAt: null, group: "Fixture", starred: false },
  audit: { jobId: "crawl-b", at: "2026-06-02T10:00:00Z", readable: true, health: 82, pages: 140, errorPages: 9, pageCap: 150, trend: [
    { jobId: "crawl-a", at: "2026-05-02T10:00:00Z", readable: true, health: 78, pages: 138, errorPages: 11, pageCap: 150 },
    { jobId: "crawl-b", at: "2026-06-02T10:00:00Z", readable: true, health: 82, pages: 140, errorPages: 9, pageCap: 150 },
  ] },
  openTasks: 4,
  rank: { top3: 2, top10: 5, ranked: 9, checked: 12, checkedOn: "2026-06-03", firstOn: "2026-06-03", device: "desktop" },
  report: {
    fetchedAt: "2026-06-03T08:00:00Z", authority: 31, backlinks: 900, referringDomains: 120, organicKeywords: 40, organicTraffic: 75, trafficValue: 210, top3: 3, top10: 8,
    history: months(6, (i) => i).map((m) => ({ month: m.month, traffic: 50 + m.v * 5, keywords: 30 + m.v * 2 })),
    linkHistory: months(6, (i) => i).map((m) => ({ month: m.month, referringDomains: 100 + m.v * 4, authority: 28 + (m.v > 3 ? 3 : 0) })),
  },
};
const noop = () => {};
const render = (c: SiteCard) => cheerio.load(renderToStaticMarkup(h(Router, { ssrPath: "/seo" }, h(ProjectRow, {
  card: c, busy: false, canAnalyse: true, price: "$1.20", priceNote: "", onAnalyse: noop, onPick: noop,
  star: { pending: false, onToggle: noop },
  group: { editing: false, draft: "", pending: false, onDraft: noop, onEdit: noop, onSave: noop, onCancel: noop },
}))));
const nameOf = ($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>) => (el.attr("aria-label") ?? el.text()).trim();

describe("the site row", () => {
  const $ = render(card);

  it("every figure, change, badge, sparkline and sub-count is its own named link", () => {
    const pieces = [".tool-stat__value:not(.tool-stat__value--none)", ".tool-delta", ".tool-badge", ".tool-stat__spark", ".tool-stat__sub > :last-child"];
    let n = 0;
    for (const sel of pieces) $(sel).each((_, e) => {
      const el = $(e), link = el.is("a") ? el : el.closest("a");
      expect(link.length, `${sel}: ${el.text()}`).toBe(1);
      expect(link.attr("href"), sel).toMatch(/^\/seo/);
      expect(nameOf($, link).length, `${sel} has a name`).toBeGreaterThan(3);
      n++;
    });
    expect(n).toBeGreaterThanOrEqual(6 + 5 + 1 + 4 + 5);
    // Names say where they lead.
    $(".tool-stat__value, .tool-stat__spark").filter("a").each((_, e) => expect($(e).attr("aria-label"), $(e).text()).toMatch(/ — open /));
  });

  it("within a metric each piece goes somewhere different, and the six numbers go to six reports", () => {
    const numbers: string[] = [];
    $(".tool-stat").each((_, e) => {
      const own = [$(e).children(".tool-stat__figure").find("a"), $(e).children(".tool-stat__spark"), $(e).find(".tool-stat__sub a")].flatMap((x) => x.map((_, a) => $(a).attr("href")).get());
      expect(new Set(own).size, `${$(e).attr("data-testid")}: ${own.join(" | ")}`).toBe(own.length);
      const v = $(e).find("a.tool-stat__value").attr("href");
      if (v) numbers.push(v);
    });
    expect(numbers).toHaveLength(6);
    expect(new Set(numbers).size).toBe(6);
  });

  it("nothing is nested in a link, and no cell or strip is one big link", () => {
    expect($("a a, a button, button a, button button").length).toBe(0);
    expect($(".tool-stat").closest("a").length).toBe(0);
    expect($(".tool-strip").closest("a").length).toBe(0);
  });

  it("the header's pieces are separate: the domain, the website, the tools, the group, the star, the purchase", () => {
    const hrefOf = (t: string) => $(`[data-testid="${t}"]`).attr("href");
    expect(hrefOf("link-domain-7")).toBe("/seo/explorer?domain=fixture.example");
    expect(hrefOf("link-open-site-7")).toBe("https://fixture.example");
    expect(hrefOf("link-rank-7")).toBe("/seo/rank-tracker?site=7");
    expect(hrefOf("link-audit-7")).toBe("/seo/audit?site=7");
    expect(hrefOf("link-plan-7")).toBe("/seo/plan?site=7");
    for (const t of ["button-group-7", "button-star-7", "button-analyse-7"]) {
      const b = $(`[data-testid="${t}"]`);
      expect(b.is("button"), t).toBe(true);
      expect(nameOf($, b).length, t).toBeGreaterThan(2);
    }
    // Every link and button in the row has a name.
    $("a, button").each((_, e) => expect(nameOf($, $(e)).length, $.html(e).slice(0, 120)).toBeGreaterThan(0));
  });

  it("the destinations the owner named", () => {
    const href = (t: string) => $(`[data-testid="${t}"]`).attr("href");
    expect(href("link-health-7")).toBe("/seo/audit?site=7&tab=issues");
    expect(href("link-health-move-7")).toBe("/seo/audit?site=7&at=crawl-b&vs=crawl-a");
    expect(href("link-health-pages-7")).toBe("/seo/audit?site=7&tab=pages");
    expect(href("link-health-errors-7")).toBe("/seo/audit?site=7&tab=pages&show=errors");
    expect(href("link-health-crawled-7")).toBe("/seo/audit?site=7&at=crawl-b");
    expect(href("link-domains-7")).toBe("/seo/explorer?domain=fixture.example&view=referringDomains");
    expect(href("link-backlinks-7")).toBe("/seo/explorer?domain=fixture.example&view=backlinks");
    expect(href("spark-domains-7")).toBe("/seo/explorer?domain=fixture.example&series=domains");
    expect(href("link-traffic-7")).toBe("/seo/explorer?domain=fixture.example&view=pages");
    expect(href("spark-traffic-7")).toBe("/seo/explorer?domain=fixture.example&series=traffic");
    expect(href("link-keywords-7")).toBe("/seo/explorer?domain=fixture.example&view=keywords");
    expect(href("link-tracked-7")).toBe("/seo/rank-tracker?site=7");
    expect(href("link-tracked-checked-7")).toBe("/seo/rank-tracker?site=7&device=desktop");
  });

  it("with nothing saved yet: honest dashes, and the empty states are small buttons with their own targets", () => {
    const empty = render({ ...card, audit: null, report: null, rank: { top3: 0, top10: 0, ranked: 0, checked: 0, checkedOn: null }, site: { ...card.site, keywordCount: 0 } });
    expect(empty('[data-testid="button-analyse-empty-7"]').is("button")).toBe(true);
    expect(empty('[data-testid="link-start-rank-7"]').attr("href")).toBe("/seo/rank-tracker?site=7");
    expect(empty('[data-testid="link-start-audit-7"]').attr("href")).toBe("/seo/audit?site=7");
    expect(empty(".tool-stat__value").length).toBe(0);
    const partial = render({ ...card, report: { ...card.report!, authority: null } });
    const dash = partial('[data-testid="metric-authority-7"] .tool-stat__value--none');
    expect(dash.text()).toBe("—");
    expect(dash.attr("title")).toBe("Not in the saved report");
  });
});
