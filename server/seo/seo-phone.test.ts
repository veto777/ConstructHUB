/**
 * Phone sizes across the SEO section (Kimi audit round 2, §6) and the shell's nav addresses (§3.5 / §7.11): source pins
 * of client/src/pages/seo/shell.tsx (the page frame every SEO page sits in), location-picker.tsx and the bare section
 * builders appended to links.ts. The owner's rule: every target is 44 px at 390 px. No browser — a source check, not a
 * render: it pins the classes that do it (Tailwind reads them as written), not what a phone draws.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { seoLinks } from "../../client/src/pages/seo/links";

const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/seo", rel), "utf8");
/** Comments aside; only code counts. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("the nav's addresses come from links.ts", () => {
  it("each section has a plain address with no site", () => {
    expect(seoLinks.rankTrackerHome()).toBe("/seo/rank-tracker");
    expect(seoLinks.localGridHome()).toBe("/seo/local-grid");
    expect(seoLinks.planHome()).toBe("/seo/plan");
    expect(seoLinks.auditHome()).toBe("/seo/audit");
    expect(seoLinks.aiHome()).toBe("/seo/ai");
    expect(seoLinks.reportsHome()).toBe("/seo/reports");
    expect(seoLinks.backlinksHome()).toBe("/seo/backlinks");
    // The sections whose builders take no site (or an empty search) already write the plain address.
    expect(seoLinks.dashboard()).toBe("/seo");
    expect(seoLinks.explorer("")).toBe("/seo/explorer");
    expect(seoLinks.keywords("")).toBe("/seo/keywords");
    expect(seoLinks.content("")).toBe("/seo/content");
    expect(seoLinks.alerts()).toBe("/seo/alerts");
    expect(seoLinks.batch()).toBe("/seo/batch");
    expect(seoLinks.usage()).toBe("/seo/usage");
  });

  it("the 14 tabs are built, none hand-written", () => {
    const shell = code(read("shell.tsx"));
    const tabs = shell.slice(shell.indexOf("const TABS = ["), shell.indexOf("];", shell.indexOf("const TABS = [")));
    expect(tabs).not.toMatch(/href: "\//);
    expect(tabs.match(/\{ href: /g)).toHaveLength(14);
    for (const b of ["seoLinks.dashboard()", 'seoLinks.explorer("")', 'seoLinks.keywords("")', 'seoLinks.content("")', "seoLinks.rankTrackerHome()", "seoLinks.localGridHome()", "seoLinks.planHome()", "seoLinks.auditHome()", "seoLinks.aiHome()", "ALERTS_HOME", "seoLinks.reportsHome()", "seoLinks.backlinksHome()", "seoLinks.batch()", "seoLinks.usage()"]) expect(tabs).toContain(`{ href: ${b}, label: `);
    expect(shell).toContain("const ALERTS_HOME = seoLinks.alerts();");
    // The unread badge still finds the Alerts tab.
    expect(shell).toContain("{t.href === ALERTS_HOME && (status.data?.alertsUnread ?? 0) > 0");
    expect(shell).not.toMatch(/href[=:] ?"\/seo/);
  });
});

describe("the page frame lifts every control to 44 px on a phone", () => {
  const raw = read("shell.tsx"), shell = code(raw);
  const sizes = raw.slice(raw.indexOf("const PHONE_SIZES = ["), raw.indexOf('].join(" ");', raw.indexOf("const PHONE_SIZES = [")));

  it("is on the frame of every SEO page, written out in full", () => {
    expect(shell).toContain("<AppPage className={`before:hidden ${PHONE_SIZES}`}>");
    // Tailwind reads the classes as written: no class is pieced together.
    expect(sizes).not.toContain("${");
    expect(sizes).not.toMatch(/\+\s*"/);
  });

  it("buttons 44 × 44, pills, text boxes and selects 44 px tall, below 640 px; the desktop keeps its 40 px floor", () => {
    for (const c of ["[&_button]:min-h-10", "max-sm:[&_button]:min-h-11", "max-sm:[&_button]:min-w-11", "max-sm:[&_.g-pill]:min-h-11", "max-sm:[&_.g-input]:min-h-11", "max-sm:[&_select]:min-h-11"]) expect(sizes).toContain(c);
  });

  it("a <details> summary is a 44 px line", () => {
    expect(sizes).toContain("max-sm:[&_summary]:min-h-11");
    expect(sizes).toContain("max-sm:[&_summary]:content-center");
  });

  it("a page's own tab strip wraps on a phone, tabs 44 px, its scrollbar visible; TabStrip keeps its own scroll and fade", () => {
    expect(sizes).toContain("max-sm:[&_.g-tabs:not([data-tab-strip])]:flex-wrap");
    expect(sizes).toContain("[&_.g-tabs:not([data-tab-strip])]:[scrollbar-width:thin]");
    for (const c of ["flex", "min-h-11", "items-center"]) expect(sizes).toContain(`[&_.g-tabs:not([data-tab-strip])>a]:${c}`);
    expect(shell).toMatch(/<nav className="g-tabs !mb-0 pr-10 !\[scrollbar-width:thin\][^"]*" aria-label=\{label\} data-tab-strip="">/);
    // The six strips the audit found (§6.5) are plain `.g-tabs`, so the frame's rule reaches them with no page change.
    const strips: Array<[string, string]> = [["keywords.tsx", "Keywords explorer views"], ["keywords.tsx", "Keyword ideas"], ["opportunities.tsx", "Opportunities"], ["gsc-breakdown.tsx", "By page or search"], ["keyword-watch.tsx", "What changed"], ["explorer.tsx", "Report tables"]];
    for (const [file, label] of strips) {
      const s = code(read(file));
      expect(s, `${file} ${label}`).toMatch(new RegExp(`<nav className="g-tabs[^"]*" aria-label="${label}">`));
      expect(s, file).not.toContain("data-tab-strip");
    }
  });

  it("a checkbox: a 20 px box in a 44 × 44 tap area, its label line 44 px; ticked, half-picked, focused and disabled are drawn", () => {
    for (const c of ["max-sm:[&_label:has(input[type=checkbox])]:min-h-11", "max-sm:[&_input[type=checkbox]]:size-11", "max-sm:[&_input[type=checkbox]]:appearance-none", "max-sm:[&_input[type=checkbox]]:border-[12px]", "max-sm:[&_input[type=checkbox]]:border-transparent", "max-sm:[&_input[type=checkbox]]:bg-clip-padding", "max-sm:[&_input[type=checkbox]]:[box-shadow:inset_0_0_0_2px_var(--g-text-2)]", "max-sm:[&_input[type=checkbox]:checked]:bg-[color:var(--g-accent)]", "max-sm:[&_input[type=checkbox]:indeterminate]:bg-[color:var(--g-accent)]", "max-sm:[&_input[type=checkbox]:focus-visible]:[outline-offset:-10px]", "max-sm:[&_input[type=checkbox]:disabled]:opacity-50"]) expect(sizes).toContain(c);
    // The tick and the dash, light and dark.
    expect(sizes.match(/max-sm:\[&_input\[type=checkbox\]:checked\]:bg-\[url\(data:image\/svg\+xml,/g)).toHaveLength(2);
    expect(sizes.match(/max-sm:\[&_input\[type=checkbox\]:indeterminate\]:bg-\[url\(data:image\/svg\+xml,/g)).toHaveLength(2);
    expect(sizes.match(/^\s*"dark:max-sm:/gm)).toHaveLength(2);
  });

  it("the ActiveFilter chip and its clear are 44 px", () => {
    expect(shell).toContain('<span className="g-chip min-h-11 !whitespace-normal py-1 [overflow-wrap:anywhere]"');
    expect(shell).toContain('<button type="button" className="g-pill g-pill--sm !min-h-11" onClick={onClear} data-testid="button-clear-filter">');
    expect(shell).not.toMatch(/g-chip min-h-10/);
  });
});

describe("the rank tracker's place box", () => {
  const picker = code(read("location-picker.tsx"));
  it("the chosen place's remove control is 44 × 44 without making the chip taller", () => {
    expect(picker).toMatch(/<button type="button" className="-my-3 -mr-2 ml-0\.5 inline-grid min-h-11 min-w-11 place-items-center[^"]*" aria-label=\{`Remove \$\{value\.label\}`\}/);
    expect(picker).toContain('data-testid="button-remove-location"');
  });
  it("each place in the list is a 44 px row on a phone", () => {
    expect(picker).toMatch(/role="option"[\s\S]*?className="g-text flex cursor-pointer items-baseline gap-2 px-3 py-1\.5 max-sm:min-h-11 max-sm:items-center"/);
    expect(picker).toContain("data-testid={`option-location-${p.code}`}");
    expect(picker).toContain('data-testid="chip-location"');
  });
});
