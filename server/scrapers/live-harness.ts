/**
 * Live test harness for a single adapter against a real tenant. Never run in
 * production; used by adapter authors to record honest results for REPORT.md.
 *
 *   npx tsx server/scrapers/live-harness.ts <slug> <targets.json> <jurisdiction-substring> search <type> <value>
 *   npx tsx server/scrapers/live-harness.ts <slug> <targets.json> <jurisdiction-substring> recent [sinceISO]
 *   npx tsx server/scrapers/live-harness.ts <slug> <targets.json> <jurisdiction-substring> detail <permitNumber>
 *
 * The adapter module (server/scrapers/<slug>.ts) must `export default` its
 * PortalAdapter (a named `adapter` export also works). Results print as JSON on
 * stdout; logs go to stderr. Exit code 2 = portal blocked / adapter threw.
 */
import { readFileSync } from "fs";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import type { AdapterCtx, PortalAdapter } from "./types";
import { CHROMIUM_ARGS, USER_AGENT, PortalBlockedError } from "./polite-fetch";

type Target = { jurisdiction: string; url: string; platform: string | null };

async function main() {
  const [slug, targetsPath, needle, mode, a, b] = process.argv.slice(2);
  if (!slug || !targetsPath || !needle || !mode) {
    console.error("usage: live-harness.ts <slug> <targets.json> <jurisdiction-substring> search|recent|detail [args]");
    process.exit(1);
  }
  const targets: Target[] = JSON.parse(readFileSync(targetsPath, "utf8"));
  const target = targets.find((t) => t.jurisdiction.toLowerCase().includes(needle.toLowerCase()));
  if (!target) { console.error(`no target matching "${needle}" in ${targetsPath}`); process.exit(1); }
  const mod = await import(`./${slug}.ts`);
  const adapter: PortalAdapter = mod.default ?? mod.adapter;
  if (!adapter?.search) { console.error(`server/scrapers/${slug}.ts does not export a PortalAdapter`); process.exit(1); }

  const state: { browser: Browser | null } = { browser: null };
  const contexts: BrowserContext[] = [];
  const ctx: AdapterCtx = {
    databaseId: 0,
    databaseName: target.jurisdiction,
    jurisdiction: target.jurisdiction,
    searchUrl: target.url,
    portalUrl: target.url,
    browser: async () => {
      state.browser ??= await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
      const c = await state.browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: USER_AGENT });
      c.setDefaultTimeout(45000);
      c.setDefaultNavigationTimeout(45000);
      contexts.push(c);
      return c;
    },
    log: (m) => console.error(`${new Date().toISOString()} [${slug}] ${m}`),
    politeness: { minDelayMs: 1000 },
  };
  const started = Date.now();
  try {
    let out: unknown;
    if (mode === "search") out = await adapter.search(ctx, { type: a as any, value: b });
    else if (mode === "recent") out = await adapter.listRecent(ctx, a ?? new Date(Date.now() - 7 * 86400000).toISOString());
    else if (mode === "detail") out = adapter.detail ? await adapter.detail(ctx, a) : null;
    else throw new Error(`unknown mode ${mode}`);
    const list = Array.isArray(out) ? out : out ? [out] : [];
    console.error(`${target.jurisdiction} (${target.platform}) ${mode}: ${list.length} record(s) in ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(JSON.stringify({ target, mode, args: [a, b].filter(Boolean), count: list.length, capabilities: adapter.capabilities, records: list }, null, 2));
  } catch (e: any) {
    const blocked = e instanceof PortalBlockedError;
    console.error(`${blocked ? "BLOCKED" : "ERROR"}: ${e?.message ?? e}`);
    console.log(JSON.stringify({ target, mode, error: String(e?.message ?? e), blocked }, null, 2));
    process.exitCode = 2;
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await state.browser?.close().catch(() => {});
  }
}

main();
