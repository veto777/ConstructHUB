/**
 * Compare the rank sources on one site's tracked keywords against today's paid source (owner, 2026-10-10:
 * "lets try all 3 and see how accurate it is compared to DataForSEO").
 *
 *   npx tsx script/seo-rank-compare.ts --site alpineexteriorswa.com [--place 1027510] [--device mobile]
 *       [--sources gsc,cse,scrape] [--limit 20] [--out ~/codex-audits/seo-rank-compare.md]
 *
 * Run on vb11 with the live .env (the baseline costs about $0.002 per keyword; Custom Search $0.005 after the free 100
 * a day; Search Console and the scrape nothing). For the scrape, start a proxy relay first and set SEO_SCRAPE_PROXY.
 * Prints the summary table and writes the full report (keyword by keyword, first pages) to --out.
 */
import { writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { pool } from "../server/db";
import { runComparison, type SourceName } from "../server/seo/rank-sources";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

(async () => {
  const site = arg("site");
  if (!site) { console.error("--site is required"); process.exit(2); }
  const device = arg("device") === "mobile" ? "mobile" : "desktop";
  const placeCode = arg("place") ? Number(arg("place")) : null;
  const sources = arg("sources")?.split(",").map((s) => s.trim()).filter(Boolean) as SourceName[] | undefined;
  const limit = Number(arg("limit")) || 50;
  const out = arg("out") || join(homedir(), "codex-audits", `seo-rank-compare-${site}-${placeCode ?? "us"}-${device}-${new Date().toISOString().slice(0, 10)}.md`);
  const run = await runComparison({ domain: site, device, placeCode, sources, limit, log: (l) => console.log("  " + l) });
  writeFileSync(out, run.report);
  console.log("\n" + run.report.split("\n## ")[0]);
  console.log(`\nfull report: ${out}`);
  const cost = run.baseline.reduce((n, b) => n + b.costUsd, 0) + run.scores.reduce((n, s) => n + s.costUsd, 0);
  console.log(`spent: $${cost.toFixed(4)}`);
  await pool.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); await pool.end().catch(() => {}); process.exit(1); });
