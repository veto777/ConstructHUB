/**
 * Samples (components/sample-preview.tsx) show ONLY when the real dataset is truly empty — never while loading,
 * after a failed request, when a filter/search/date range/page narrows a non-empty dataset, or when a permission
 * hides rows (CLAUDE.md: never fabricate data). Every call site goes through the one shared guard, `showSample()`,
 * so those rules live in one place. This test is static: it reads the client sources, no dev server, no database.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { showSample } from "../client/src/components/sample-preview";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLIENT = path.join(ROOT, "client/src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const files = walk(CLIENT).map((abs) => ({ rel: path.relative(ROOT, abs), src: fs.readFileSync(abs, "utf8") }));

/** Drop comments so a `<SamplePreview>` in a doc comment is not a call site (keeps line numbers). */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));

/**
 * The sample components: <SamplePreview> itself, every exported fixture component whose body renders one
 * (crm-sample-previews, traffic-tool/samples, seo/samples, crm-call-assistant/samples …), and every
 * `lazySample(…, "Name")` binding of those.
 */
const definers = new Map<string, string>(); // component name → defining file
definers.set("SamplePreview", "client/src/components/sample-preview.tsx");
/** Character ranges of fixture components' own bodies: the <SamplePreview> inside one is its definition. */
const definitionRanges = new Map<string, [number, number][]>();
for (const { rel, src } of files) {
  const code = stripComments(src);
  const decls = [...code.matchAll(/export function (\w+)\s*\(/g)];
  decls.forEach((m, i) => {
    const end = decls[i + 1]?.index ?? code.length;
    const body = code.slice(m.index!, end);
    // Fixture components are named for what they are (IpSample, SampleClientsTable …); a page that renders a
    // sample (ApiUsagePanel …) is a call site, not a fixture.
    if (m[1] !== "SamplePreview" && /^Sample|Sample$/.test(m[1]) && /<SamplePreview\b/.test(body)) {
      definers.set(m[1], rel);
      definitionRanges.set(rel, [...(definitionRanges.get(rel) ?? []), [m.index!, end]]);
    }
  });
}
for (const { rel, src } of files) {
  // A lazy binding is a call-site name, not a definition: keep the fixture's own file as its definer.
  for (const m of stripComments(src).matchAll(/const (\w+)\s*=\s*lazySample\(/g)) if (!definers.has(m[1])) definers.set(m[1], "(lazy)");
}

/**
 * Samples with no dataset behind them — a "how it looks" block, not an empty state — so there is nothing for the
 * guard to check: permit search shows labels only before any search; the call simulator shows a sample chat before
 * the first test call. Keyed "file:Component".
 */
const NO_DATASET = new Set([
  "client/src/pages/search.tsx:SamplePreview",
  "client/src/pages/crm-call-assistant/simulator.tsx:SampleConversationPreview",
]);

const LOOKBACK = 30;

type Site = { file: string; line: number; name: string; ok: boolean };
const sites: Site[] = [];
for (const { rel, src } of files) {
  if (rel === "client/src/components/sample-preview.tsx") continue;
  const code = stripComments(src);
  const lines = code.split("\n");
  const lineStart = lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0));
  const ranges = definitionRanges.get(rel) ?? [];
  // Names assigned from the helper in this file (`const noSites = showSample({ … })`).
  const guards = [
    ...[...code.matchAll(/\b(\w+)\s*=\s*showSample\(/g)].map((m) => m[1]),
    ...[...code.matchAll(/\b(\w+)\s*=(?![=>])[^;\n]*?\bshowSample\(/g)].map((m) => m[1]),
  ];
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/<([A-Z]\w*)\b/g)) {
      const name = m[1];
      const def = definers.get(name);
      if (!def) continue;
      // A fixture component wrapping its own body in <SamplePreview> is the definition, not a call site.
      const at = lineStart[i] + m.index!;
      if (name === "SamplePreview" && ranges.some(([a, b]) => at >= a && at < b)) continue;
      if (rel === def && name !== "SamplePreview") continue;
      const window = lines.slice(Math.max(0, i - LOOKBACK), i + 1).join("\n");
      const ok = /\bshowSample\(/.test(window) || guards.some((g) => new RegExp(`\\b${g}\\b`).test(window))
        || NO_DATASET.has(`${rel}:${name}`);
      sites.push({ file: rel, line: i + 1, name, ok });
    }
  });
}

describe("sample previews only show for a truly empty dataset", () => {
  it("finds the sample call sites", () => {
    // Sanity: the scan sees the pages it should (a broken scan would pass vacuously).
    const seen = new Set(sites.map((s) => s.file));
    for (const f of ["client/src/pages/ip-tracker.tsx", "client/src/pages/crm-payments.tsx", "client/src/pages/crm-schedule.tsx",
      "client/src/pages/settings/api/api-usage-panel.tsx", "client/src/pages/google-reviews.tsx", "client/src/pages/gbp-content.tsx"]) {
      expect(seen, f).toContain(f);
    }
    expect(sites.length).toBeGreaterThan(40);
  });

  it("every call site's guard goes through showSample()", () => {
    const bad = sites.filter((s) => !s.ok).map((s) => `${s.file}:${s.line} <${s.name}>`);
    expect(bad, "guard each sample with showSample({ isLoading, isError, total, filtered, page })").toEqual([]);
  });

  it("showSample is true only for a known-empty, unfiltered, first-page, settled dataset", () => {
    expect(showSample({ total: 0 })).toBe(true);
    expect(showSample({ total: 3 })).toBe(false);
    expect(showSample({ total: undefined })).toBe(false); // not known yet
    expect(showSample({ total: null })).toBe(false);
    expect(showSample({ isLoading: true, total: 0 })).toBe(false);
    expect(showSample({ isError: true, total: 0 })).toBe(false);
    expect(showSample({ filtered: true, total: 0 })).toBe(false); // filter / search / range / permission
    expect(showSample({ page: 2, total: 0 })).toBe(false); // past the first page
    expect(showSample({ page: 0, total: 0 })).toBe(true);
  });
});

describe("sample fixtures cannot be mistaken for real records", () => {
  const fixture = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  it("mail alerts use reserved .example sender addresses", () => {
    const src = fixture("client/src/pages/mail-alerts.tsx");
    const block = src.slice(src.indexOf("const SAMPLE_ALERTS"), src.indexOf("];", src.indexOf("const SAMPLE_ALERTS")));
    for (const m of block.matchAll(/sender:\s*"([^"]+)"/g)) expect(m[1]).toMatch(/\.example$/);
  });
  it("traffic samples refer only to example domains", () => {
    const src = fixture("client/src/components/traffic-tool/samples.tsx");
    expect(src).not.toMatch(/\b(google|facebook|bing|nextdoor|yelp)\.com\b/);
  });
  it("LSA / Ads sample rows use obviously fake customer ids", () => {
    for (const rel of ["client/src/pages/lsa-account-manager.tsx", "client/src/pages/lsa-leads.tsx", "client/src/pages/ads-manager.tsx"]) {
      const rows = fixture(rel).split("\n").filter((l) => /GoogleListRow[^>]*title="Sample /.test(l));
      expect(rows.length, rel).toBeGreaterThan(0);
      for (const row of rows) expect(row, rel).not.toMatch(/123-?456-?789\d|\b\d{10}\b/);
    }
  });
});
