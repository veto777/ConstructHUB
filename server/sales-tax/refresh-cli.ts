/**
 * Refresh the official sales-tax rate tables (rates change quarterly).
 *
 *   Download + rewrite the bundled file (on a tower, then commit it):
 *     npx tsx server/sales-tax/refresh-cli.ts --out server/data/sales-tax-rates.json
 *   Load straight into a database (production timer, vb11):
 *     node --env-file=.env dist/refresh-sales-tax.cjs --apply
 *   Options: --states WA,CA (only these) · --force (reload even when unchanged)
 *
 * Each state is fetched, parsed and sanity-checked by its adapter
 * (server/sales-tax/sources/*). A state that fails keeps its previous rows —
 * a broken download never empties a table — and the run exits 1 so the timer's
 * journal shows it. With --out, a failed state keeps its entry from the
 * existing file.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeFetchCtx } from "./fetch-util";
import { SALES_TAX_SOURCES } from "./sources";
import { packResult, type BundledSalesTaxFile } from "./store";
import type { SalesTaxSourceResult } from "./types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function main(): Promise<number> {
  const out = arg("--out");
  const apply = has("--apply");
  const force = has("--force");
  const only = arg("--states")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!out && !apply) {
    console.error("usage: refresh-cli (--out <file> | --apply) [--states WA,CA] [--force]");
    return 2;
  }

  const ctx = makeFetchCtx();
  const results: SalesTaxSourceResult[] = [];
  let failed = 0;
  for (const src of SALES_TAX_SOURCES) {
    if (only && !src.states.some((s) => only.includes(s))) continue;
    try {
      const got = (await src.load(ctx)).filter((r) => !only || only.includes(r.state));
      for (const r of got) console.log(`fetched ${r.state} ${r.periodLabel} (${r.effectiveDate}) ${r.rows.length} rows — ${r.sourceUrl}`);
      results.push(...got);
    } catch (e: any) {
      failed++;
      console.error(`FAILED ${src.name} [${src.states.join(",")}]: ${e?.message ?? e}`);
    }
  }

  if (out) {
    const prev: BundledSalesTaxFile | null = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
    const byState = new Map((prev?.states ?? []).map((s) => [s.state, s]));
    for (const r of results) byState.set(r.state, packResult(r));
    const file: BundledSalesTaxFile = {
      generatedAt: new Date().toISOString(),
      states: [...byState.values()].sort((a, b) => a.state.localeCompare(b.state)),
    };
    // One state per line keeps diffs reviewable without a 10 MB single line.
    const body = `{"generatedAt":${JSON.stringify(file.generatedAt)},"states":[\n${file.states.map((s) => JSON.stringify(s)).join(",\n")}\n]}\n`;
    writeFileSync(out, body);
    console.log(`wrote ${out}: ${file.states.length} state(s)`);
  }

  if (apply) {
    const { pool } = await import("../db");
    const { ensureSalesTaxSchema } = await import("./schema");
    const { loadStateRates } = await import("./store");
    await ensureSalesTaxSchema(pool);
    for (const r of results) {
      try {
        console.log(`${r.state}: ${await loadStateRates(pool, r, "refresh", { force })}`);
      } catch (e: any) {
        failed++;
        console.error(`${r.state}: load FAILED — ${e?.message ?? e}`);
      }
    }
    await pool.end();
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
