/**
 * Quick Bid seed: turn the two flagship mined scopes into per_sqft SKUs.
 *
 * The mined HCP scopes are flat-priced (a median job price, not a rate) and
 * medianPrice / median sqft is NOT derivable — so the rates here are honest
 * PLACEHOLDERS the owner edits in the price book (the per-sqft rate field on
 * the SKU dialog). Each seeded row is marked in
 * custom_fields->quickBidRate.placeholder = true and the price book UI badges
 * it, so nobody mistakes the placeholder for a real price.
 *
 * Idempotent: matches by name, keeps flat_price_cents (history) intact, and
 * only fills the rate when the row is not already a priced per_sqft SKU.
 *
 * Run:  DATABASE_URL="postgres://..." npx tsx scripts/seed-quick-bid-rates.ts
 */
import pg from "pg";

const FLAGSHIPS = [
  {
    name: "Siding Remodel - Color +",
    sqftMetric: "siding",
    rateCentsPerSqft: 1800, // $18.00/sq ft — placeholder, owner replaces
  },
  {
    name: "Standard Package - Re Roof",
    sqftMetric: "roof",
    rateCentsPerSqft: 800, // $8.00/sq ft — placeholder, owner replaces
  },
] as const;

async function main() {
  const url =
    process.env.DATABASE_URL ??
    "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
  const pool = new pg.Pool({ connectionString: url });

  for (const f of FLAGSHIPS) {
    const r = await pool.query(
      `update crm_pb_items
         set pricing_mode = 'per_sqft',
             sqft_metric = $2,
             rate_cents_per_sqft = case
               when pricing_mode = 'per_sqft' and rate_cents_per_sqft is not null and rate_cents_per_sqft > 0
               then rate_cents_per_sqft else $3 end,
             custom_fields = coalesce(custom_fields, '{}'::jsonb) || $4::jsonb,
             updated_at = now()
       where name = $1 and active = true
       returning id, org_id, name, pricing_mode, rate_cents_per_sqft, sqft_metric`,
      [
        f.name,
        f.sqftMetric,
        f.rateCentsPerSqft,
        JSON.stringify({
          quickBidRate: {
            placeholder: true,
            note: "Placeholder per-sqft rate seeded for Quick Bid — replace it with your real price in the price book.",
          },
        }),
      ],
    );
    if (!r.rows.length) {
      console.log(`• not found (skipped): "${f.name}"`);
    } else {
      for (const row of r.rows) {
        console.log(
          `✓ ${row.name} [org ${row.org_id}] → per_sqft @ $${(row.rate_cents_per_sqft / 100).toFixed(2)}/sq ft (${row.sqft_metric})`,
        );
      }
    }
  }
  await pool.end();
  console.log("\nQuick Bid seed complete.");
}

main().catch((e) => { console.error(e); process.exit(1); });
