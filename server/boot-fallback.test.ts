/**
 * client/index.html's static fallback ("ConstructHUB — … Privacy Policy · Terms of Use"): there for
 * crawlers, brand checks and visitors without JavaScript, and never on screen for a browser that is
 * about to run the app (owner, 2026-10-08: "this random page that shows the terms and the policy
 * stuff" flashed on every full page load, and in every tutorial video).
 *
 * This file checks the document itself; e2e/boot-fallback.spec.ts checks it in a browser, and
 * scripts/tutorials/check.ts refuses a video with a frame of it.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { composePage } from "../script/prerender";

const html = fs.readFileSync(path.resolve(import.meta.dirname, "../client/index.html"), "utf8");
const head = html.slice(0, html.indexOf("</head>"));
const body = html.slice(html.indexOf("<body>"));

describe("index.html — the static fallback and the boot screen", () => {
  it("keeps the fallback text in the source, with no attribute that hides it", () => {
    const main = /<main id="ch-fallback"([^>]*)>([\s\S]*?)<\/main>/.exec(body);
    expect(main).not.toBeNull();
    expect(main![1]).not.toMatch(/hidden|display\s*:\s*none|visibility|aria-hidden/);
    expect(main![2]).toContain("<h1>ConstructHUB</h1>");
    expect(main![2]).toContain('href="/privacy"');
    expect(main![2]).toContain('href="/terms"');
    expect(main![2]).toContain("support@constructhub.us");
    // What the Google brand check reads.
    expect(main![2]).toMatch(/manage your own Google Business Profile/);
  });
  it("says what the product is: two products, no superlatives", () => {
    const text = /<main id="ch-fallback"[^>]*>([\s\S]*?)<\/main>/.exec(body)![1];
    expect(text).toMatch(/two products for contractors/);
    expect(text).toMatch(/Business tools/);
    expect(text).toMatch(/a separate CRM/);
    expect(text).not.toMatch(/all-in-one|best|leading|#1|ultimate|complete growth/i);
  });
  it("marks the document as script-capable in <head>, before any stylesheet or module can paint", () => {
    const mark = head.indexOf('c.add("js")');
    expect(mark).toBeGreaterThan(0);
    // Inline and synchronous: not a module, not deferred, no src.
    const tag = head.slice(head.lastIndexOf("<script", mark), mark);
    expect(tag).toMatch(/^<script>/);
    expect(mark).toBeLessThan(head.indexOf('rel="stylesheet"'));
    expect(mark).toBeLessThan(html.indexOf('type="module"'));
  });
  it("applies the saved dark theme in that same script (no white flash in dark mode)", () => {
    expect(head).toMatch(/localStorage\.getItem\("theme"\)==="dark"\)c\.add\("dark"\)/);
    expect(head).toMatch(/html\.dark #ch-boot\{background:hsl\(222 30% 14%\)\}/);
  });
  it("hides the fallback and shows the boot screen only under that mark, from an inline style", () => {
    const style = /<style id="ch-boot-style">([\s\S]*?)<\/style>/.exec(head)?.[1] ?? "";
    expect(style).toContain("html.js #ch-fallback{display:none}");
    expect(style).toContain("html.js #ch-boot{display:flex}");
    // Without the mark the boot screen is not there at all.
    expect(style).toMatch(/#ch-boot\{display:none;/);
    // The fallback is hidden by nothing else.
    expect(style.match(/#ch-fallback/g)).toHaveLength(1);
  });
  it("gives the fallback back if the app never mounts", () => {
    expect(head).toMatch(/setTimeout\(function\(\)\{if\(d\.getElementById\("ch-fallback"\)\)c\.remove\("js"\)\},\d{4,}\)/);
  });
  it("the boot screen is the app's own loading state (App.tsx): same colours, same spinner", () => {
    const css = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/index.css"), "utf8");
    const token = (block: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
    const light = css.slice(css.indexOf(":root {"), css.indexOf(".dark {")), dark = css.slice(css.indexOf(".dark {"));
    expect(head).toContain(`#ch-boot{display:none;position:fixed;inset:0;align-items:center;justify-content:center;background:hsl(${token(light, "background")})}`);
    expect(head).toContain(`html.dark #ch-boot{background:hsl(${token(dark, "background")})}`);
    expect(head).toContain(`border:2px solid hsl(${token(light, "primary")})`);
    expect(head).toContain(`html.dark #ch-boot i{border-color:hsl(${token(dark, "primary")})`);
    const app = fs.readFileSync(path.resolve(import.meta.dirname, "../client/src/App.tsx"), "utf8");
    expect(app).toContain('<div className="flex items-center justify-center h-screen bg-background">');
    expect(app).toContain('<div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />');
  });
  it("leaves #root as the prerender step needs it, and a prerendered page carries neither fallback nor boot screen", () => {
    const page = composePage(html, "/", '<div data-testid="page">The page</div>');
    expect(page).toContain('<div id="root" data-prerendered="/"><div data-testid="page">The page</div></div>');
    const root = page.slice(page.indexOf('<div id="root"'));
    expect(root).not.toContain("ch-fallback");
    expect(root).not.toContain("ch-boot");
    expect(root).not.toContain("max-width:720px");
    // The mark and the theme are still applied before paint on that page.
    expect(page).toContain('c.add("js")');
  });
});
