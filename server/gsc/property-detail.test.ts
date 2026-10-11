/**
 * Search Console property detail (client/src/pages/site-connections.tsx). The
 * Oct 2026 regression: <MetricRows key={asset.id}> and <UrlActions key={asset.id}>
 * were adjacent siblings with the same key. React's reconciler maps siblings by
 * key once a conditional slot shifts, the two collided, and the first MetricRows
 * fiber was never reconciled or removed — a dead duplicate block with permanent
 * skeletons on every cold load of a property. Source guard (the repo's pattern
 * for client structure, see server/seo/tool-nav.test.ts): the detail subtree is
 * mounted once under one unique key, and DataList uses the standard query
 * lifecycle (default queryFn keyed by path).
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/pages/site-connections.tsx"), "utf8");
const between = (start: string, end: string, from = 0) => {
  const a = src.indexOf(start, from);
  expect(a, start).toBeGreaterThan(-1);
  const b = src.indexOf(end, a + start.length);
  expect(b, end).toBeGreaterThan(-1);
  return { text: src.slice(a, b), at: a };
};
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("DataList", () => {
  const list = between("export function DataList(", "\nfunction MetricRows(").text;
  it("uses the default queryFn with the request path as its key", () => {
    expect(list).toContain("queryKey: [path],");
    expect(list).not.toMatch(/queryFn\s*:/);
    expect(list).not.toContain("read(");
    expect(list).toContain("refetchInterval: pollUnlessPlanRequired(15000)");
  });
  it("shows skeleton, then data or an error with retry", () => {
    expect(list).toContain("data.isLoading ? (");
    expect(list).toContain("<LoadingReport />");
    expect(list).toContain("<ReportError error={data.error} retry={() => void data.refetch()} />");
  });
});

describe("the selected property's detail", () => {
  const detail = between("{asset && (\n            <section>", '{cf && detailTab === "Activity" && (');
  it("mounts MetricRows and UrlActions once, inside a single keyed Fragment", () => {
    expect(count(detail.text, "<MetricRows")).toBe(1);
    expect(count(detail.text, "<UrlActions")).toBe(1);
    expect(detail.text).toMatch(/<Fragment key=\{`property-\$\{asset\.id\}`\}>\s*<MetricRows asset=\{asset\} \/>\s*<UrlActions\b/);
    expect(src).toMatch(/import \{[^}]*\bFragment\b[^}]*\} from "react"/);
  });
  it("gives no two siblings the same key", () => {
    const keys = [...detail.text.matchAll(/\bkey=\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size, `keys: ${keys.join(" | ")}`).toBe(keys.length);
    // No element anywhere in the file keyed by the bare asset id any more.
    expect(src).not.toMatch(/<\w+[^>]*\bkey=\{asset\.id\}/);
  });
});
