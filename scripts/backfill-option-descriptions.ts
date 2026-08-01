/**
 * BACKFILL estimate option descriptions from the HCP export.
 *
 * import-hcp.ts maps option_description ?? description into
 * crm_estimate_options.description (see replaceEstimateChildren there). Any
 * org whose options were written BEFORE that mapping existed — or whose rows
 * were created another way — has NULL descriptions even though the export
 * carries the text. This script re-aligns every imported estimate with its
 * export record and patches the option rows.
 *
 * Matching: estimates join on customFields->>'hcpId' = export estimate id.
 * Options carry no HCP id of their own, so they are aligned with the export's
 * options array by position — exactly the order import-hcp.ts inserted them
 * (tier = array index + 1). An estimate whose DB option count differs from
 * the export's options array is skipped with a warning rather than guessed.
 *
 * Idempotent: a row is only written when the description actually differs
 * (SQL IS DISTINCT FROM). A second run reports everything "skipped".
 *
 * Usage:
 *   npx tsx scripts/backfill-option-descriptions.ts --database-url=postgres://… \
 *       [--org=<orgId>] [--dry-run] [--export-dir=analysis/hcp-export]
 * Without --org every org with hcpId-keyed estimates is processed.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const a = argv.find((v) => v.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
if (arg("database-url")) process.env.DATABASE_URL = arg("database-url")!;
if (!process.env.DATABASE_URL) {
  throw new Error("Provide --database-url=postgres://… or set DATABASE_URL");
}
const ORG_ID = arg("org");
const DRY_RUN = argv.includes("--dry-run");
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const EXPORT_DIR = path.resolve(arg("export-dir") ?? path.join(SCRIPT_DIR, "..", "analysis", "hcp-export"));

// DATABASE_URL must be set before this module constructs its pool.
const { pool } = await import("../server/db");

const clean = (v: any): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

async function main() {
  // ── Export: hcp estimate id → ordered option descriptions ────────────────
  const dir = path.join(EXPORT_DIR, "estimates-details");
  const exportOpts = new Map<string, (string | null)[]>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const e = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    exportOpts.set(
      e.id,
      (e.options ?? []).map((o: any) => clean(o.option_description) ?? clean(o.description)),
    );
  }
  console.log(`export: ${exportOpts.size} estimates (${DRY_RUN ? "DRY RUN — no writes" : "write mode"})`);

  // ── Imported estimates keyed on customFields.hcpId ───────────────────────
  const ests = await pool.query(
    `SELECT id, org_id, number, custom_fields->>'hcpId' AS hcp_id
       FROM crm_estimates
      WHERE custom_fields->>'hcpId' IS NOT NULL
        ${ORG_ID ? "AND org_id = $1" : ""}
      ORDER BY org_id, number`,
    ORG_ID ? [ORG_ID] : [],
  );
  console.log(`db: ${ests.rows.length} hcp-keyed estimates${ORG_ID ? ` in org ${ORG_ID}` : " (all orgs)"}`);

  const stats = { updated: 0, skipped: 0, noExportText: 0, noExportMatch: 0, countMismatch: 0 };
  const samples: string[] = [];
  for (const est of ests.rows) {
    const exp = exportOpts.get(est.hcp_id);
    if (!exp) { stats.noExportMatch++; continue; }
    const dbOpts = await pool.query(
      `SELECT id, tier, name, description FROM crm_estimate_options
        WHERE estimate_id = $1 ORDER BY tier`,
      [est.id],
    );
    if (dbOpts.rows.length !== exp.length) {
      stats.countMismatch++;
      console.log(`  WARN estimate ${est.number ?? est.id} (hcp ${est.hcp_id}): db has ${dbOpts.rows.length} options, export has ${exp.length} — skipped`);
      continue;
    }
    for (let i = 0; i < exp.length; i++) {
      const want = exp[i];
      const row = dbOpts.rows[i];
      if (!want) { stats.noExportText++; continue; } // export itself has no text — leave as-is
      if (DRY_RUN) {
        if ((row.description ?? null) !== want) {
          stats.updated++;
          if (samples.length < 8) {
            samples.push(`  ${est.number} tier ${row.tier} "${row.name}"\n    before: ${(row.description ?? "∅").slice(0, 90)}\n    after:  ${want.slice(0, 90)}`);
          }
        } else stats.skipped++;
        continue;
      }
      const u = await pool.query(
        `UPDATE crm_estimate_options SET description = $2
          WHERE id = $1 AND description IS DISTINCT FROM $2
          RETURNING id`,
        [row.id, want],
      );
      if (u.rows.length) {
        stats.updated++;
        if (samples.length < 8) {
          samples.push(`  ${est.number} tier ${row.tier} "${row.name}"\n    before: ${(row.description ?? "∅").slice(0, 90)}\n    after:  ${want.slice(0, 90)}`);
        }
      } else stats.skipped++;
    }
  }

  console.log("\n── backfill summary ─────────────────────────");
  console.log(`options updated ${stats.updated}  already-correct ${stats.skipped}  no-text-in-export ${stats.noExportText}`);
  console.log(`estimates: no-export-match ${stats.noExportMatch}  option-count-mismatch ${stats.countMismatch}`);
  if (samples.length) {
    console.log("\nsamples:");
    for (const s of samples) console.log(s);
  }
  await pool.end();
}

main().catch((e) => { console.error("BACKFILL FAILED:", e); process.exitCode = 1; });
