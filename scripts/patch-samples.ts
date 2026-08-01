/**
 * PATCH the 3 sample estimates (create-samples.ts: sample-martinez /
 * sample-chen / sample-obrien, keyed on customFields.sampleKey) with the real
 * scope text mined from the HCP export.
 *
 * The samples were created with bare scope TITLES as line-item names and no
 * descriptions / no option rows. For every sample estimate in the target org:
 *   1. Each line item whose name matches a mined SKU group (by group name,
 *      normalized key, or any known variant — from skus-review.json) gets the
 *      group's FULL representative scope text in crm_estimate_items.description
 *      (most common variant in full + alternate writings, never truncated).
 *      Items with no matching group are reported and left untouched.
 *   2. The estimate gets an option-level description: a tier-1
 *      crm_estimate_options row (created when absent) named after the
 *      estimate title, whose description is the bundle's full scope text —
 *      the matched items' scope texts joined " + " in line order.
 *
 * Idempotent: updates are guarded by IS DISTINCT FROM and the option row is
 * only inserted when missing. A second run reports everything "skipped".
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx scripts/patch-samples.ts --org=<orgId> [--dry-run]
 *   (skus-review.json comes from scripts/mine-skus.ts; regenerate with the
 *    mine-only mode if analysis/hcp-export changed)
 */
import { readFileSync } from "fs";
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
if (!ORG_ID) throw new Error("--org=<orgId> is required");
const DRY_RUN = argv.includes("--dry-run");
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const EXPORT_DIR = path.resolve(arg("export-dir") ?? path.join(SCRIPT_DIR, "..", "analysis", "hcp-export"));
const REVIEW_PATH = path.join(EXPORT_DIR, "skus-review.json");

// DATABASE_URL must be set before this module constructs its pool.
const { pool } = await import("../server/db");

type ReviewGroup = {
  name: string;
  normalized: string;
  uses: number;
  lastUsed: string | null;
  sampleVariants: string[];
  selected: boolean;
};

/** Full scope text for a group — mirrors scopeDescription() in mine-skus.ts
 *  minus the internal mining-provenance sentence (these rows are
 *  customer-facing). */
function fullScopeText(g: ReviewGroup): string {
  const full = g.sampleVariants[0] ?? g.name;
  const alts = g.sampleVariants.slice(1);
  return full + (alts.length ? ` Also written as: ${alts.join(" | ")}.` : "");
}

const firstLine = (v: string | null): string => (v ?? "∅").split("\n")[0].slice(0, 110);

async function main() {
  const review = JSON.parse(readFileSync(REVIEW_PATH, "utf8"));
  const groups = (review.groups as ReviewGroup[]).filter((g) => g.selected);
  // Lookup by group name, normalized key and every known raw variant.
  const lookup = new Map<string, ReviewGroup>();
  for (const g of groups) {
    for (const key of [g.name, g.normalized, ...g.sampleVariants]) {
      const k = key.trim().toLowerCase();
      if (k && !lookup.has(k)) lookup.set(k, g);
    }
  }
  console.log(`${groups.length} selected SKU groups indexed from ${path.relative(process.cwd(), REVIEW_PATH)} (${DRY_RUN ? "DRY RUN — no writes" : "write mode"})`);

  const ests = await pool.query(
    `SELECT id, number, title, subtotal_cents, total_cents, custom_fields->>'sampleKey' AS sample_key
       FROM crm_estimates
      WHERE org_id = $1 AND custom_fields->>'sampleKey' IS NOT NULL
      ORDER BY number`,
    [ORG_ID],
  );
  if (!ests.rows.length) {
    console.log(`no sample estimates (customFields.sampleKey) in org ${ORG_ID} — nothing to do`);
    await pool.end();
    return;
  }
  console.log(`patching ${ests.rows.length} sample estimates in org ${ORG_ID}`);

  const stats = { itemsUpdated: 0, itemsSkipped: 0, itemsNoMatch: 0, optionsCreated: 0, optionsUpdated: 0, optionsSkipped: 0 };
  for (const est of ests.rows) {
    console.log(`\n${est.number} [${est.sample_key}] ${est.title}`);
    const items = await pool.query(
      `SELECT id, name, description FROM crm_estimate_items
        WHERE estimate_id = $1 ORDER BY sort_order`,
      [est.id],
    );

    const scopeParts: string[] = [];
    for (const it of items.rows) {
      const g = lookup.get(it.name.trim().toLowerCase());
      if (!g) {
        stats.itemsNoMatch++;
        console.log(`  · "${it.name}" — no SKU group match, left as-is`);
        scopeParts.push(it.name);
        continue;
      }
      const want = fullScopeText(g);
      scopeParts.push(want);
      if ((it.description ?? null) === want) {
        stats.itemsSkipped++;
        console.log(`  · "${it.name}" — already patched`);
        continue;
      }
      console.log(`  ✓ "${it.name}"\n    before: ${firstLine(it.description)}\n    after:  ${firstLine(want)}`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE crm_estimate_items SET description = $2
            WHERE id = $1 AND description IS DISTINCT FROM $2`,
          [it.id, want],
        );
      }
      stats.itemsUpdated++;
    }

    // Option-level description — one tier-1 row named after the estimate.
    const optDesc = scopeParts.join(" + ");
    const opt = await pool.query(
      `SELECT id, name, description FROM crm_estimate_options
        WHERE estimate_id = $1 ORDER BY tier LIMIT 1`,
      [est.id],
    );
    if (!opt.rows.length) {
      console.log(`  ✓ option "${est.title}" — creating with scope description\n    after:  ${firstLine(optDesc)}`);
      if (!DRY_RUN) {
        await pool.query(
          `INSERT INTO crm_estimate_options (org_id, estimate_id, name, tier, description, subtotal_cents, total_cents)
           VALUES ($1, $2, $3, 1, $4, $5, $6)`,
          [ORG_ID, est.id, est.title, optDesc, est.subtotal_cents, est.total_cents],
        );
      }
      stats.optionsCreated++;
    } else if ((opt.rows[0].description ?? null) !== optDesc) {
      console.log(`  ✓ option "${opt.rows[0].name}" — patching description\n    before: ${firstLine(opt.rows[0].description)}\n    after:  ${firstLine(optDesc)}`);
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE crm_estimate_options SET description = $2
            WHERE id = $1 AND description IS DISTINCT FROM $2`,
          [opt.rows[0].id, optDesc],
        );
      }
      stats.optionsUpdated++;
    } else {
      console.log(`  · option "${opt.rows[0].name}" — already patched`);
      stats.optionsSkipped++;
    }
  }

  console.log("\n── patch-samples summary ────────────────────");
  console.log(`items:    updated ${stats.itemsUpdated}  already-patched ${stats.itemsSkipped}  no-group-match ${stats.itemsNoMatch}`);
  console.log(`options:  created ${stats.optionsCreated}  updated ${stats.optionsUpdated}  already-patched ${stats.optionsSkipped}`);
  await pool.end();
}

main().catch((e) => { console.error("PATCH FAILED:", e); process.exitCode = 1; });
