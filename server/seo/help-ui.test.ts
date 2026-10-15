import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { helpEntry, helpKeyForRoute, helpSections } from "@shared/help/registry";

/**
 * The SEO pages' "i" (owner's program, 2026-10-15: every page says what it is for, in plain words, with the walkthrough
 * in the panel). SeoShell (client/src/pages/seo/shell.tsx) mounts <HelpButton k={helpKey} /> beside the title from the
 * `helpKey` each page passes; server/help-registry.test.ts cannot see a key passed as a prop, so this test does:
 * every key named exists, every SEO route of App.tsx has a page that names one, and the dashboard carries the feature.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const PAGES = path.join(ROOT, "client/src/pages/seo");
const read = (f: string) => fs.readFileSync(f, "utf8");

/** [file, helpKey] for every page that renders a SeoShell. */
function shellPages(): [string, string | null][] {
  return fs.readdirSync(PAGES).filter((f) => f.endsWith(".tsx")).map((f) => read(path.join(PAGES, f))).flatMap((src, i) => {
    const file = fs.readdirSync(PAGES).filter((f) => f.endsWith(".tsx"))[i];
    if (!/<SeoShell\b/.test(src) || file === "shell.tsx") return [];
    // The opening tag can hold JSX in its props (actions={<Button …>}), so the key is the first helpKey after the tag.
    const m = /<SeoShell\b[\s\S]*?\bhelpKey="([^"]+)"/.exec(src);
    return [[file, m ? m[1] : null]];
  });
}

describe("SEO pages' help", () => {
  it("every SEO page names a help key that exists, as a section of the SEO Suite", () => {
    const pages = shellPages();
    expect(pages.length).toBeGreaterThanOrEqual(16);
    for (const [file, key] of pages) {
      expect(key, `${file} passes helpKey to SeoShell`).toBeTruthy();
      const e = helpEntry(key!);
      expect(e, `${file}: ${key} is in the registry`).toBeTruthy();
      if (key !== "seo") expect(e!.parent, `${file}: ${key} is a section of "seo"`).toBe("seo");
    }
  });

  it("every /seo route in App.tsx has a page with an 'i', and the shell mounts it", () => {
    const app = read(path.join(ROOT, "client/src/App.tsx"));
    const routes = [...app.matchAll(/<Route path="(\/seo[^"]*)" component=\{(\w+)\}/g)].map((m) => [m[1], m[2]] as const);
    expect(routes.length).toBeGreaterThanOrEqual(16);
    const imports = Object.fromEntries([...app.matchAll(/const (\w+) = lazyPage\(\(\) => import\("@\/pages\/seo(?:\/([\w-]+))?"\)\)/g)].map((m) => [m[1], `${m[2] ?? "index"}.tsx`]));
    const keys = Object.fromEntries(shellPages());
    for (const [route, component] of routes) {
      const file = imports[component];
      expect(file, `${route} → ${component} is an SEO page`).toBeTruthy();
      expect(keys[file], `${route} (${file}) has an "i"`).toBeTruthy();
    }
    // The dashboard (/seo) is the feature itself; every other SEO route resolves to its own section (the section's
    // route is the page's), so a header that looks its key up by route and the explicit prop agree.
    expect(keys["dashboard.tsx"]).toBe("seo");
    expect(helpKeyForRoute("/seo")).toBe("seo");
    for (const [route, component] of routes) expect(helpKeyForRoute(route), route).toBe(keys[imports[component]]);
    const shell = read(path.join(PAGES, "shell.tsx"));
    expect(shell).toMatch(/<HelpButton k=\{helpKey\} \/>/);
  });

  it("the SEO sections cover every tool of the rail", () => {
    const keys = new Set(helpSections("seo").map((s) => s.key));
    for (const k of ["seo.explorer", "seo.keywords", "seo.content", "seo.rank-tracker", "seo.local-grid", "seo.audit", "seo.ai", "seo.plan", "seo.alerts", "seo.mentions", "seo.reports", "seo.usage", "seo.batch", "seo.backlinks", "seo.competitors"]) expect(keys.has(k), k).toBe(true);
  });

  it("the help text names no price and no data vendor (white-label)", () => {
    for (const e of [helpEntry("seo")!, ...helpSections("seo")]) {
      const text = [e.whatItIs, e.whatItDoes, e.howItWorks, ...e.howToUse, ...(e.needs ?? [])].join(" ");
      expect(text, `${e.key} names a price`).not.toMatch(/\$\d/);
      expect(text.toLowerCase(), `${e.key} names the vendor`).not.toMatch(/dataforseo/);
    }
  });
});
