/**
 * The SEO tool shell's navigation (client/src/components/seo-tool/nav.ts, components/tool/shell.tsx): every entry of
 * the rail and the sub-navigation is a real route plus query parameters the page already reads — checked against the
 * pages' own lists, so a renamed view cannot leave a dead entry and a new report cannot be forgotten. Pure modules +
 * source guard, no browser (the *-links tests' pattern).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { ALERT_KINDS, AUDIT_PAGE_SHOWS, AUDIT_TABS, BACKLINK_SECTIONS, DASHBOARD_SORTS, DUPLICATED_ROWS, EXPLORER_VIEWS, KEYWORD_SECTIONS, KEYWORD_VIEWS, MENTION_TABS, PLAN_KINDS, RANK_PANELS, REPORT_SECTIONS, seoNav } from "../../client/src/components/seo-tool/nav";
import { activeSubItem, shownGroups, toolOf, type ToolNavCtx } from "../../client/src/components/tool/shell";
import { nextTabIndex } from "../../client/src/components/tool/tabs";

const src = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src", rel), "utf8");
const at = (address: string): ToolNavCtx => { const [p, q = ""] = address.split("?"); return { path: p, params: new URLSearchParams(q) }; };
const keys = (xs: [string, string][]) => xs.map(([k]) => k).sort();
/** The quoted words of a list in a source file: the text between `start` and the next `end`. */
const listed = (text: string, start: string, end: string) => { const a = text.indexOf(start); expect(a, start).toBeGreaterThan(-1); const b = text.indexOf(end, a + start.length); return [...text.slice(a + start.length, b).matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]); };

const nav = seoNav({ domain: "mysite.com" });
const tool = (key: string) => nav.tools.find((t) => t.key === key)!;

describe("the tools are the SEO routes", () => {
  const app = src("App.tsx");
  it("every tool and every sub-item lives on a route App.tsx serves, and every SEO route belongs to a tool", () => {
    const routes = [...app.matchAll(/<Route path="(\/seo[^"]*)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(10);
    const claimed = new Set<string>();
    for (const t of nav.tools) {
      for (const p of [t.path, ...(t.paths ?? [])]) { expect(routes, `${t.key}: ${p}`).toContain(p); claimed.add(p); }
      for (const g of t.groups) for (const i of g.items) expect(routes, `${t.key}/${i.key}`).toContain(i.path ?? t.path);
    }
    for (const r of routes) expect([...claimed], `route ${r} has no tool`).toContain(r);
    for (const r of routes) expect(toolOf(nav, r).path === r || toolOf(nav, r).paths?.includes(r), r).toBe(true);
  });
  it("App.tsx renders the tool shell under /seo, without the app sidebar on a desktop, and keeps the app's controls", () => {
    expect(app).toContain('if (location === "/seo" || location.startsWith("/seo/")) {');
    expect(app).toContain("<SeoToolLayout actions={controls} banner={<PaymentNeededBanner />} footer={footer}>");
    expect(app).toContain('<div className="md:hidden"><AppSidebar /></div>');
  });
});

describe("each sub-navigation lists the page's own views — no more, no fewer", () => {
  it("Site explorer: the report menu", () => {
    const text = src("pages/seo/explorer.tsx"), a = text.indexOf("const MENU:"), b = text.indexOf("\n];", a);
    const menu = [...text.slice(a, b).matchAll(/\["([A-Za-z]+)", "/g)].map((m) => m[1]);
    expect(menu.length).toBeGreaterThan(15);
    const mine = EXPLORER_VIEWS.flatMap((g) => g.items.map(([k]) => k));
    expect([...mine].sort()).toEqual([...new Set(menu)].sort());
    expect(new Set(mine).size).toBe(mine.length);
  });
  it("Site audit: its tabs and the pages tab's own narrowings", () => {
    const audit = src("pages/seo/audit.tsx");
    expect(keys(AUDIT_TABS)).toEqual(listed(audit, "const VIEWS: View[] = [", "]").sort());
    const links = src("pages/seo/links.ts");
    for (const [show] of AUDIT_PAGE_SHOWS) expect(links, show).toMatch(new RegExp(`[(| ]${show}[ |)]`));
  });
  it("Alerts and mentions: the kinds and the tabs", () => {
    expect(keys(ALERT_KINDS)).toEqual(listed(src("pages/seo/alerts.tsx"), "const KINDS = [", "]").sort());
    expect(keys(MENTION_TABS)).toEqual(listed(src("pages/seo/mentions.tsx"), "const TABS: Tab[] = [", "]").sort());
  });
  it("Rank tracker: panels the page scrolls to; bands and movements the address takes", () => {
    for (const [panel] of RANK_PANELS) expect(src("pages/seo/rank-params.ts"), panel).toMatch(new RegExp(`\\b${panel}: "`));
    const links = src("pages/seo/links.ts");
    for (const g of tool("rank").groups) for (const i of g.items) for (const [k, v] of Object.entries(i.params ?? {})) if (k === "band" || k === "move") expect(links, `${k}=${v}`).toContain(`"${v}"`);
  });
  it("Backlinks, reports, action plan, keywords, the dashboard", () => {
    expect(keys(BACKLINK_SECTIONS)).toEqual(listed(src("pages/seo/backlinks.tsx"), "const SECTIONS: readonly Section[] = [", "]").sort());
    const reports = src("pages/seo/reports.tsx");
    for (const [s] of REPORT_SECTIONS) expect(reports, s).toMatch(new RegExp(`\\b${s}: \\{ id: "`));
    const plan = src("pages/seo/plan.tsx");
    for (const [k] of PLAN_KINDS) expect(plan, k).toMatch(new RegExp(`\\b${k}: "`));
    const keywords = src("pages/seo/keywords.tsx");
    for (const [v] of KEYWORD_VIEWS) expect(keywords, v).toContain(`"${v}"`);
    const sections = listed(keywords, "const SECTIONS: readonly Section[] = [", "]");
    for (const [s] of KEYWORD_SECTIONS) expect(sections, s).toContain(s);
    const sorts = listed(src("pages/seo/dashboard.tsx"), "const SORTS: [SortKey, string][] = [", "];");
    for (const [s] of DASHBOARD_SORTS) expect(sorts, s).toContain(s);
  });
  it("the tab rows hidden while the sub-navigation is open are rows the pages still render", () => {
    expect(DUPLICATED_ROWS).toEqual(["Keywords explorer views", "Audit views"]);
    expect(src("pages/seo/keywords.tsx")).toContain('aria-label="Keywords explorer views"');
    expect(src("pages/seo/audit.tsx")).toContain('aria-label="Audit views"');
    expect(src("pages/seo/explorer.tsx")).toContain('data-testid="explorer-menu"');
    expect(src("pages/seo/alerts.tsx")).toContain('<TabStrip label="Which alerts"');
    const css = src("styles/tool.css");
    for (const sel of ['[data-testid="explorer-menu"]', 'nav[aria-label="Keywords explorer views"]', 'nav[aria-label="Audit views"]', 'nav[aria-label="Which alerts"]']) expect(css, sel).toContain(sel);
    expect(css).toContain('.tool-shell[data-subnav-inline="true"]');
  });
});

describe("addresses and the current item", () => {
  it("every entry builds an address on its own route", () => {
    const c = at("/seo/audit?site=3");
    for (const t of nav.tools) {
      expect(t.to(c).split("?")[0], t.key).toBe(t.path);
      for (const g of t.groups) for (const i of g.items) {
        const href = i.to(c);
        expect(href.split("?")[0], `${t.key}/${i.key}`).toBe(i.path ?? t.path);
        // An item's own parameters are in the address it builds.
        const q = new URLSearchParams(href.split("?")[1] ?? "");
        for (const [k, v] of Object.entries(i.params ?? {})) expect(q.get(k), `${t.key}/${i.key} ${k}`).toBe(v);
      }
    }
  });
  it("the chosen site, domain and keyword carry; nothing is invented when there is none", () => {
    expect(tool("audit").to(at("/seo/rank-tracker?site=3"))).toBe("/seo/audit?site=3");
    expect(tool("audit").to(at("/seo"))).toBe("/seo/audit");
    expect(tool("explorer").to(at("/seo"))).toBe("/seo/explorer?domain=mysite.com");
    expect(tool("explorer").to(at("/seo/explorer?domain=rival.com&view=anchors"))).toBe("/seo/explorer?domain=rival.com");
    expect(seoNav().tools.find((t) => t.key === "explorer")!.to(at("/seo"))).toBe("/seo/explorer");
    const backlinks = tool("explorer").groups.flatMap((g) => g.items).find((i) => i.key === "backlinks")!;
    expect(backlinks.to(at("/seo/explorer?domain=rival.com&view=anchors&anchor=x"))).toBe("/seo/explorer?domain=rival.com&view=backlinks");
    const ideas = tool("keywords").groups.flatMap((g) => g.items).find((i) => i.key === "section-ideas")!;
    expect(ideas.to(at("/seo/keywords?keyword=roof+repair"))).toBe("/seo/keywords?keyword=roof+repair&section=ideas");
  });
  it("the current item is the most specific match of the address", () => {
    const cur = (key: string, address: string) => activeSubItem(tool(key), at(address))?.key;
    expect(cur("explorer", "/seo/explorer?domain=a.com")).toBe("overview");
    expect(cur("explorer", "/seo/explorer?domain=a.com&view=anchors")).toBe("anchors");
    expect(cur("explorer", "/seo/backlinks?site=1")).toBe("monitor");
    expect(cur("explorer", "/seo/backlinks?site=1&section=lost")).toBe("monitor-lost");
    expect(cur("explorer", "/seo/batch")).toBe("batch");
    expect(cur("audit", "/seo/audit?site=1")).toBe("issues");
    expect(cur("audit", "/seo/audit?site=1&tab=pages")).toBe("pages");
    expect(cur("audit", "/seo/audit?site=1&tab=pages&status=4xx")).toBe("status-4xx");
    expect(cur("alerts", "/seo/alerts?kind=links_lost")).toBe("links_lost");
    expect(cur("alerts", "/seo/mentions?site=1&tab=linked")).toBe("mentions-linked");
    expect(cur("dashboard", "/seo?sort=health")).toBe("sort-health");
    expect(cur("rank", "/seo/competitors?site=1")).toBe("competitors-page");
  });
  it("sections that need a keyword show only when the address has one", () => {
    const labels = (address: string) => shownGroups(tool("keywords"), at(address)).map((g) => g.key);
    expect(labels("/seo/keywords")).toEqual(["main"]);
    expect(labels("/seo/keywords?keyword=roof+repair")).toEqual(["main", "sections"]);
    expect(labels("/seo/keywords?keyword=roof+repair&view=bulk")).toEqual(["main"]);
  });
});

describe("the shared tabs", () => {
  it("← → Home End move between tabs and wrap at the ends", () => {
    expect(nextTabIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextTabIndex("Home", 2, 3)).toBe(0);
    expect(nextTabIndex("End", 0, 3)).toBe(2);
    expect(nextTabIndex("Enter", 0, 3)).toBeNull();
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
  });
  it("a tab is active by its own attribute; touch targets are 44px; a tab row never wraps", () => {
    const tabs = src("components/tool/tabs.tsx"), css = src("styles/tool.css");
    expect(tabs).toContain(`const ACTIVE = '[aria-current="page"], [aria-selected="true"], [data-state="active"], [aria-pressed="true"]'`);
    expect(tabs).toContain('role={as === "tablist" ? "tablist" : "group"} aria-label={label}');
    expect(tabs).toContain('<nav className="tool-tabs__list" aria-label={label}>');
    expect(css).toContain(".tool-tabs .tool-tabs__list { display: flex; flex-wrap: nowrap;");
    expect(css).toContain(".tool-link { min-height: 44px;");
    expect(css).toMatch(/@media \(pointer: coarse\) \{ \.tool-btn \{ min-height: 44px; \}/);
    expect(css).toContain('.tool-tabs[data-variant="bar"][data-sticky="true"] { position: sticky; top: 0; z-index: 20; }');
  });
});
