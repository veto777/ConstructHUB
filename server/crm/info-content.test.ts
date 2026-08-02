import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { INFO_CONTENT } from "../../client/src/lib/info-content";

/**
 * Static integrity check for the ⓘ info-tip system — no server needed.
 * Every key mounted anywhere in client/ (via <InfoTip k="…" />, the
 * infoKey="…" prop on CrmPageHeader/SectionTitle, or the ribbon's
 * infoKey: "…" rows) must have an entry in client/src/lib/info-content.ts,
 * and every entry must be well-formed (title + 2–6 non-empty paragraphs).
 */

const CLIENT_ROOT = path.resolve(import.meta.dirname, "../../client/src");

function* walk(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield p;
  }
}

function mountedKeys(): { key: string; where: string }[] {
  const found: { key: string; where: string }[] = [];
  for (const file of walk(CLIENT_ROOT)) {
    // The content map and its own component only *reference* the mount syntax
    // in comments/tests — scanning them would match the docs, not real mounts.
    if (/info-content\.ts$|\.test\.[tj]sx?$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(CLIENT_ROOT, file);
    const push = (key: string) => found.push({ key, where: rel });

    // <InfoTip k="dashboard" />
    for (const m of src.matchAll(/<InfoTip\s+k="([^"]+)"/g)) push(m[1]);
    // infoKey="clients" (CrmPageHeader / SectionTitle prop)
    for (const m of src.matchAll(/infoKey="([^"]+)"/g)) push(m[1]);
    // infoKey: "pipeline" (ribbon MORE_LINKS rows)
    for (const m of src.matchAll(/infoKey:\s*"([^"]+)"/g)) push(m[1]);
    // Dynamic mounts with a known, closed set of values:
    if (/infoKey=\{kind\}/.test(src)) ["estimates", "invoices"].forEach(push); // crm-documents
    if (/k=\{`role-\$\{m\.role\}`\}/.test(src))
      ["owner", "admin", "pm", "office", "field"].forEach((r) => push(`role-${r}`)); // crm-team
  }
  return found;
}

describe("info-tip content map", () => {
  it("every mounted key exists in INFO_CONTENT", () => {
    const mounts = mountedKeys();
    // The sweep only passes if it actually found the mounts — an empty
    // result means the regexes rotted, not that nothing is missing.
    expect(mounts.length).toBeGreaterThan(40);
    const missing = mounts.filter(({ key }) => !INFO_CONTENT[key]);
    expect(
      missing.map(({ key, where }) => `${key} (mounted in ${where})`),
      "mounted info-tip keys with no content entry",
    ).toEqual([]);
  });

  it("every entry is well-formed: title + 2–6 non-empty paragraphs", () => {
    for (const [key, entry] of Object.entries(INFO_CONTENT)) {
      expect(entry.title.trim().length, `${key} title`).toBeGreaterThan(0);
      expect(entry.body.length, `${key} paragraph count`).toBeGreaterThanOrEqual(2);
      expect(entry.body.length, `${key} paragraph count`).toBeLessThanOrEqual(6);
      for (const p of entry.body) expect(p.trim().length, `${key} paragraph`).toBeGreaterThan(0);
    }
  });

  it("the Quick Bid entry explains the square-footage math", () => {
    expect(INFO_CONTENT["quick-bid"].body.join(" ")).toMatch(/square footage|square feet/i);
  });
});
