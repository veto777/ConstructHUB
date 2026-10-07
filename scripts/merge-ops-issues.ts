/**
 * Fold duplicate issue-desk rows into one row per failure (server/ops/merge.ts
 * has the rules). Boot does this by itself; this is the same call by hand.
 *
 *   npx tsx --env-file=.env scripts/merge-ops-issues.ts --dry-run   # what would be folded, nothing written
 *   npx tsx --env-file=.env scripts/merge-ops-issues.ts
 *
 * Idempotent: a second run reports 0 folded, 0 rekeyed.
 */
import pg from "pg";
import { ensureOpsIssuesSchema } from "../server/ops/schema";
import { mergeDuplicateIssues } from "../server/ops/merge";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const dryRun = process.argv.includes("--dry-run");
  const pool = new pg.Pool({ connectionString: url, options: "-c TimeZone=UTC", max: 2 });
  try {
    if (!dryRun) await ensureOpsIssuesSchema(pool);
    const out = await mergeDuplicateIssues(pool, { dryRun });
    console.log(`${dryRun ? "[dry run] " : ""}scanned ${out.scanned} issue(s): ${out.folded} folded into ${out.groups.length} older issue(s), ${out.rekeyed} given a stable fingerprint`);
    for (const g of out.groups) console.log(`  #${g.keep} ← ${g.folded.map((id) => `#${id}`).join(", ")}  (${g.status}, seen ${g.count}×)`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
