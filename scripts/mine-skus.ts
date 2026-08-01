/**
 * SKU MINING — HCP estimate scopes → ConstructHub price book.
 *
 * IMPORTANT — the HCP export has NO line items. Every option in
 * analysis/hcp-export/estimates-details/*.json carries the same 22 keys and
 * none of them is a line-item array (verified 2026-08-01; import-hcp.ts hits
 * the same wall and synthesizes items). What HCP *did* export is the
 * hand-written scope text the sales rep typed per option:
 *   option.option_description / option.name / option.description
 *   estimate.description
 * plus the option's sub_total (integer cents) — so each scope occurrence
 * comes with one real-world price. That is what this script mines.
 *
 * Pipeline:
 *   1. Collect candidate scope names from every estimate option.
 *   2. Junk filter: blank, pure "Option #N"/"Copy of …" labels, generic
 *      one-word scopes, names containing the customer name or street address
 *      (one-off project-specific lines), paragraph-length text.
 *   3. Normalize: lowercase, collapse whitespace, strip a leading trade
 *      prefix ("Siding - …"), strip trailing separators/unit-ish text,
 *      naive plural flattening.
 *   4. Group: exact-normalized first, then a conservative fuzzy pass —
 *      same first 2 tokens + same detected unit merges into the larger group.
 *   5. Aggregate per group: uses, median/min/max price (cents), last-used
 *      date, typical quantity (null — HCP exported no quantities), sample
 *      raw variants.
 *
 * Modes:
 *   npx tsx scripts/mine-skus.ts
 *       Mine only; writes analysis/hcp-export/skus-review.json for review.
 *   npx tsx scripts/mine-skus.ts --org=<orgId> --database-url=postgres://… \
 *       [--min-uses=2] [--export-dir=analysis/hcp-export] [--limit=N]
 *       Import groups with uses >= --min-uses into the price book.
 *       Idempotent: upsert keyed on orgId + normalized name (stored in
 *       crm_pb_items.code / crm_pb_materials.sku). A second run with
 *       unchanged data writes nothing.
 *
 * Classification (simple heuristic, per assignment):
 *   labor    — name matches /labor|install|installation|removal|tear ?off|hr\b/
 *   material — unit hint (sq|sf|sqft|ln|lf) + material keyword
 *              (shingle|hardie|siding|window|door|gutter|paint|deck|plywood|
 *               tyvek|trim|soffit|fascia|metal)
 *   scope    — everything else → flat-price assembly (crm_pb_items,
 *              pricingMode 'flat', unit 'job', flatPriceCents = median)
 * Category from name keywords (first hit wins): roofing, siding, windows,
 * gutters, decks, paint, other.
 *
 * customFields: crm_pb_items / crm_pb_materials have no custom_fields column
 * in shared/schema.ts (out of this task's file scope), so the script adds one
 * idempotently (ALTER TABLE … ADD COLUMN IF NOT EXISTS) and writes
 * customFields.hcpStats = {uses, lastUsed, medianPrice} via raw SQL.
 * schema-ensure.ts should grow the matching column definitions for fresh DBs.
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const a = argv.find((v) => v.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
if (arg("database-url")) process.env.DATABASE_URL = arg("database-url")!;
const ORG_ID = arg("org");
const MIN_USES = Math.max(1, parseInt(arg("min-uses") ?? "2", 10) || 2);
const LIMIT = arg("limit") ? parseInt(arg("limit")!, 10) : null;
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const EXPORT_DIR = path.resolve(arg("export-dir") ?? path.join(SCRIPT_DIR, "..", "analysis", "hcp-export"));
const REVIEW_PATH = path.join(EXPORT_DIR, "skus-review.json");
if (ORG_ID && !process.env.DATABASE_URL) {
  throw new Error("Provide --database-url=postgres://… or set DATABASE_URL");
}

// ── Normalization ───────────────────────────────────────────────────────────
const TRADE_PREFIX = /^(roofing|siding|windows and doors|windows and doors remodel|windows|doors|window|decking|decks|gutters|gutter|painting|paint|metal roofing)\s*[-–—:]\s*/i;
const UNIT_RE = /\b(sq\.?\s?ft|sqft|sq|sf|ln\.?\s?ft|lf|ln|linear feet|hr|hour|ea|each)\b/i;

function detectUnit(raw: string): string | null {
  const m = raw.toLowerCase().match(UNIT_RE);
  if (!m) return null;
  const u = m[1].replace(/[\s.]+/g, "");
  if (["sqft", "sq", "sf"].includes(u)) return "sqft";
  if (["lnft", "lf", "ln", "linearfeet"].includes(u)) return "lf";
  if (["hr", "hour"].includes(u)) return "hr";
  return "ea";
}

function normalize(raw: string): string {
  let s = raw.toLowerCase().replace(/[\r\n]+/g, " ");
  s = s.replace(/&/g, " and ");
  s = s.replace(TRADE_PREFIX, "");
  s = s.replace(/\s+/g, " ").trim();
  // trailing parenthetical qualifiers: "( 30 year )", "( partial )" — unless
  // stripping one would leave a generic stub ("Windows ( Milgard )" → "windows")
  const stripped = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (stripped && !GENERIC.has(stripped)) s = stripped;
  // trailing unit text ("… per sq ft", "… - 5 inch reveal" is kept — it distinguishes variants)
  s = s.replace(/\s*(per|@)\s*(sq\.?\s?ft|sqft|sq|sf|ln\.?\s?ft|lf|ln|hr|hour|ea|each)\s*$/i, "");
  // naive plural flattening on word tokens (scopes → scope, shingles → shingle)
  s = s
    .split(" ")
    .map((t) => (/^[a-z]{4,}s$/.test(t) && !/ss$|us$|is$/.test(t) ? t.slice(0, -1) : t))
    .join(" ");
  s = s.replace(/[\s\-–—:;,.]+$/, "").replace(/\s+/g, " ").trim();
  return s;
}

const first2 = (n: string) => n.split(" ").slice(0, 2).join(" ");

/** true when the shorter token list is an exact prefix of the longer one. */
const tokenPrefix = (a: string, b: string): boolean => {
  const ta = a.split(" "), tb = b.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.length < long.length && short.every((t, i) => t === long[i]);
};

// ── Junk filter ─────────────────────────────────────────────────────────────
const GENERIC = new Set([
  "option #1", "option #2", "option #3", "option 1", "option 2", "copy of option #1",
  "change order", "standard", "standard package", "full package", "partial", "partial package",
  "whole house", "vinyl", "hardie", "metal", "repair", "windows", "metal roofing",
  "hdz 50 yr", "gaf 30 yr", "builder grade", "investment grade", "primed + paint",
  "exterior paint", "like for like", "service call", "estimate", "siding remodel",
]);

function isJunk(normalized: string, raw: string, customerTokens: string[], street: string): boolean {
  if (!normalized || normalized.length < 4) return true;
  if (normalized.length > 90) return true; // paragraph, not a scope name
  if (/[\r\n]/.test(raw)) return true; // multi-line text block
  if (/^option\s*#?\d+/.test(normalized)) return true;
  if (/^copy of /.test(normalized)) return true;
  if (/\boption$/.test(normalized) && normalized.split(" ").length <= 3) return true;
  if (GENERIC.has(normalized)) return true;
  if (/@|\$|www\.|http/i.test(raw)) return true; // notes/pricing prose, not a scope name
  if (customerTokens.some((t) => t.length > 3 && normalized.includes(t))) return true;
  if (street && street.length > 5 && normalized.includes(street)) return true;
  return false;
}

// ── Classification ──────────────────────────────────────────────────────────
const LABOR_RE = /labor|labour|install|installation|removal|tear ?off|\bhr\b|hour/i;
const MATERIAL_KW_RE = /shingle|hardie|siding|window|door|gutter|paint|deck|plywood|tyvek|trim|soffit|fascia|metal/i;
const UNIT_MATERIAL_RE = /\b(sq\.?\s?ft|sqft|\bsq\b|\bsf\b|ln\.?\s?ft|\blf\b|\bln\b)\b/i;

type Kind = "material" | "labor" | "scope";
function classifyKind(name: string): Kind {
  if (LABOR_RE.test(name)) return "labor";
  if (UNIT_MATERIAL_RE.test(name) && MATERIAL_KW_RE.test(name)) return "material";
  return "scope";
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/re ?roof|roof(?!ing contractor)|shingle|hdz|gaf|skylight|metal roof|standing seam/i, "roofing"],
  [/siding|hardie|mastic|vinyl|soffit|fascia|tyvek|board (and|&) batten|artisan/i, "siding"],
  [/window|door|milgard|andersen/i, "windows"],
  [/gutter/i, "gutters"],
  [/deck|timber ?tech|trex/i, "decks"],
  [/paint|sherwin|stain/i, "paint"],
];
const CATEGORIES = ["roofing", "siding", "windows", "gutters", "decks", "paint", "other"];
function classifyCategory(name: string): string {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat;
  return "other";
}

// ── Mining ──────────────────────────────────────────────────────────────────
type Occurrence = { raw: string; priceCents: number | null; usedAt: string | null };
type Group = {
  normalized: string;
  unit: string | null;
  uses: number;
  prices: number[];
  medianPriceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  lastUsed: string | null;
  typicalQuantity: number | null;
  variants: string[];
  kind: Kind;
  category: string;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function mine(): Group[] {
  const dir = path.join(EXPORT_DIR, "estimates-details");
  const exact = new Map<string, { unit: string | null; occ: Occurrence[] }>();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let optionCount = 0;
  for (const f of files) {
    const e = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const customerTokens = String(e.customer_name ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
    const street = String(e.address ?? "").toLowerCase().split(",")[0].trim();
    for (const o of e.options ?? []) {
      optionCount++;
      const raws = [o.option_description, o.name, o.description, e.description]
        .filter((v: any) => typeof v === "string" && v.trim()) as string[];
      const priceCents =
        typeof o.sub_total === "number" && Number.isFinite(o.sub_total) ? Math.round(o.sub_total) : null;
      const usedAt = typeof e.created_at === "string" ? e.created_at : null;
      const seen = new Set<string>();
      for (const raw of raws) {
        const n = normalize(raw);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        if (isJunk(n, raw, customerTokens, street)) continue;
        let g = exact.get(n);
        if (!g) { g = { unit: detectUnit(raw), occ: [] }; exact.set(n, g); }
        g.occ.push({ raw: raw.trim(), priceCents, usedAt });
      }
    }
  }
  console.log(`mined ${files.length} estimates, ${optionCount} options → ${exact.size} exact-normalized groups`);

  // Conservative fuzzy pass: same first-2 tokens + same unit → merge into the
  // group with more uses (its normalized name wins).
  const byKey = new Map<string, string[]>();
  for (const n of exact.keys()) {
    const key = `${first2(n)}|${exact.get(n)!.unit ?? ""}`;
    const arr = byKey.get(key) ?? [];
    arr.push(n);
    byKey.set(key, arr);
  }
  const repOf = new Map<string, string>(); // normalized → representative
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => exact.get(b)!.occ.length - exact.get(a)!.occ.length || (a < b ? -1 : 1));
    // Conservative: merge only genuine prefixes ("Standing Seam Metal" ⊂
    // "Standing Seam Metal Roofing"), never same-opening distinct scopes
    // ("Siding Remodel - Color +" ✗ "Siding Remodel - James Hardie …").
    for (let i = 1; i < arr.length; i++) {
      if (tokenPrefix(arr[i], arr[0])) repOf.set(arr[i], arr[0]);
    }
  }
  const merged = new Map<string, { unit: string | null; occ: Occurrence[] }>();
  for (const [n, g] of exact) {
    const rep = repOf.get(n) ?? n;
    let m = merged.get(rep);
    if (!m) { m = { unit: g.unit, occ: [] }; merged.set(rep, m); }
    m.occ.push(...g.occ);
    if (!m.unit && g.unit) m.unit = g.unit;
  }
  const fuzzyMerged = exact.size - merged.size;
  if (fuzzyMerged > 0) console.log(`fuzzy pass merged ${fuzzyMerged} near-duplicate groups → ${merged.size} groups`);

  const groups: Group[] = [];
  for (const [normalized, g] of merged) {
    const prices = g.occ.map((o) => o.priceCents).filter((p): p is number => p != null && p > 0);
    const dates = g.occ.map((o) => o.usedAt).filter((d): d is string => !!d).sort();
    const variantCount = new Map<string, number>();
    for (const o of g.occ) variantCount.set(o.raw, (variantCount.get(o.raw) ?? 0) + 1);
    const variants = [...variantCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
      .slice(0, 3)
      .map(([v]) => v);
    groups.push({
      normalized,
      unit: g.unit,
      uses: g.occ.length,
      prices,
      medianPriceCents: median(prices),
      minPriceCents: prices.length ? Math.min(...prices) : null,
      maxPriceCents: prices.length ? Math.max(...prices) : null,
      lastUsed: dates.length ? dates[dates.length - 1] : null,
      typicalQuantity: null, // HCP exported no quantities
      variants,
      kind: classifyKind(normalized),
      category: classifyCategory(normalized),
    });
  }
  groups.sort((a, b) => b.uses - a.uses || a.normalized.localeCompare(b.normalized));
  return groups;
}

function displayName(g: Group): string {
  // Use the most frequent raw variant as the human-facing name.
  return g.variants[0] ?? g.normalized;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const groups = mine();
  const selected = groups.filter((g) => g.uses >= MIN_USES).slice(0, LIMIT ?? undefined);

  const review = {
    generatedAt: new Date().toISOString(),
    source: path.relative(process.cwd(), EXPORT_DIR),
    note: "HCP exported no line items — mined from hand-written option/estimate scope names; price = option sub_total.",
    cutoff: { minUses: MIN_USES, limit: LIMIT, totalGroups: groups.length, selectedGroups: selected.length },
    groups: groups.map((g) => ({
      name: displayName(g),
      normalized: g.normalized,
      kind: g.kind,
      category: g.category,
      unit: g.unit,
      uses: g.uses,
      medianPriceCents: g.medianPriceCents,
      minPriceCents: g.minPriceCents,
      maxPriceCents: g.maxPriceCents,
      lastUsed: g.lastUsed,
      typicalQuantity: g.typicalQuantity,
      sampleVariants: g.variants,
      selected: g.uses >= MIN_USES && selected.includes(g),
    })),
  };
  writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2));
  console.log(`review written to ${REVIEW_PATH}`);
  const dist = [1, 2, 3, 5, 10].map((n) => `uses>=${n}: ${groups.filter((g) => g.uses >= n).length}`);
  console.log(`use-count distribution — ${dist.join("  ")}`);
  console.log(`selected for import (uses>=${MIN_USES}${LIMIT ? `, limit ${LIMIT}` : ""}): ${selected.length}`);

  if (!ORG_ID) {
    console.log("no --org given — mine-only mode, nothing imported");
    return;
  }

  // DATABASE_URL must be set before this module constructs its pool.
  const { pool } = await import("../server/db");

  // custom_fields columns — absent from shared/schema.ts for these two tables;
  // added here idempotently so hcpStats has a structured home.
  await pool.query(`ALTER TABLE crm_pb_items ADD COLUMN IF NOT EXISTS custom_fields jsonb`);
  await pool.query(`ALTER TABLE crm_pb_materials ADD COLUMN IF NOT EXISTS custom_fields jsonb`);

  const org = await pool.query(`SELECT id, name FROM crm_orgs WHERE id = $1`, [ORG_ID]);
  if (!org.rows.length) throw new Error(`Org ${ORG_ID} not found — pass an existing org id via --org`);
  console.log(`importing into org ${ORG_ID} (${org.rows[0].name})`);

  // Categories by name (title-cased), idempotent.
  const catId = new Map<string, string>();
  for (const c of CATEGORIES) {
    const name = c[0].toUpperCase() + c.slice(1);
    const ex = await pool.query(`SELECT id FROM crm_pb_categories WHERE org_id = $1 AND lower(name) = $2`, [ORG_ID, c]);
    if (ex.rows.length) { catId.set(c, ex.rows[0].id); continue; }
    const ins = await pool.query(
      `INSERT INTO crm_pb_categories (org_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id`,
      [ORG_ID, name, CATEGORIES.indexOf(c)],
    );
    catId.set(c, ins.rows[0].id);
  }

  const stats = { created: 0, updated: 0, skipped: 0, errors: [] as { name: string; error: string }[] };
  for (const g of selected) {
    const name = displayName(g).slice(0, 200);
    const hcpStats = JSON.stringify({
      hcpStats: {
        uses: g.uses,
        lastUsed: g.lastUsed,
        medianPrice: g.medianPriceCents,
        minPrice: g.minPriceCents,
        maxPrice: g.maxPriceCents,
      },
      source: "hcp_estimate_scopes",
    });
    const description =
      `Mined from ${g.uses} HCP estimate option${g.uses === 1 ? "" : "s"} (scope names — HCP exported no line items).` +
      (g.lastUsed ? ` Last used ${g.lastUsed.slice(0, 10)}.` : "") +
      (g.variants.length > 1 ? ` Variants: ${g.variants.slice(1).join(" | ").slice(0, 300)}` : "");
    try {
      // No unique constraint exists on (org_id, code/sku) — idempotency is a
      // SELECT on the normalized-name key, then INSERT or no-op UPDATE.
      if (g.kind === "material") {
        const sku = g.normalized.slice(0, 120);
        const price = g.medianPriceCents ?? 0;
        const ex = await pool.query(`SELECT id FROM crm_pb_materials WHERE org_id=$1 AND sku=$2`, [ORG_ID, sku]);
        if (!ex.rows.length) {
          await pool.query(
            `INSERT INTO crm_pb_materials (org_id, category_id, name, sku, description, unit, price_cents, custom_fields)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [ORG_ID, catId.get(g.category)!, name, sku, description, g.unit ?? "ea", price, hcpStats],
          );
          stats.created++;
          continue;
        }
        const u = await pool.query(
          `UPDATE crm_pb_materials SET category_id=$3, name=$4, description=$5, unit=$6, price_cents=$7,
             custom_fields=$8, cost_updated_at=now(), updated_at=now()
           WHERE org_id=$1 AND sku=$2
             AND (name IS DISTINCT FROM $4 OR description IS DISTINCT FROM $5 OR price_cents IS DISTINCT FROM $7
                  OR custom_fields IS DISTINCT FROM $8::jsonb OR unit IS DISTINCT FROM $6 OR category_id IS DISTINCT FROM $3)
           RETURNING id`,
          [ORG_ID, sku, catId.get(g.category)!, name, description, g.unit ?? "ea", price, hcpStats],
        );
        if (u.rows.length) stats.updated++; else stats.skipped++;
      } else {
        const code = g.normalized.slice(0, 120);
        const price = g.medianPriceCents;
        const unit = g.kind === "labor" ? (g.unit ?? "hr") : (g.unit ?? "job");
        const ex = await pool.query(`SELECT id FROM crm_pb_items WHERE org_id=$1 AND code=$2`, [ORG_ID, code]);
        if (!ex.rows.length) {
          await pool.query(
            `INSERT INTO crm_pb_items (org_id, category_id, code, name, description, unit, pricing_mode, flat_price_cents, custom_fields)
             VALUES ($1,$2,$3,$4,$5,$6,'flat',$7,$8)`,
            [ORG_ID, catId.get(g.category)!, code, name, description, unit, price, hcpStats],
          );
          stats.created++;
          continue;
        }
        const u = await pool.query(
          `UPDATE crm_pb_items SET category_id=$3, name=$4, description=$5, unit=$6, pricing_mode='flat',
             flat_price_cents=$7, custom_fields=$8, updated_at=now()
           WHERE org_id=$1 AND code=$2
             AND (name IS DISTINCT FROM $4 OR description IS DISTINCT FROM $5 OR flat_price_cents IS DISTINCT FROM $7
                  OR custom_fields IS DISTINCT FROM $8::jsonb OR unit IS DISTINCT FROM $6 OR category_id IS DISTINCT FROM $3)
           RETURNING id`,
          [ORG_ID, code, catId.get(g.category)!, name, description, unit, price, hcpStats],
        );
        if (u.rows.length) stats.updated++; else stats.skipped++;
      }
    } catch (e: any) {
      stats.errors.push({ name, error: e?.message || String(e) });
    }
  }

  console.log("\n── sku import summary ───────────────────────");
  console.log(`created ${stats.created}  updated ${stats.updated}  skipped ${stats.skipped}  errors ${stats.errors.length}`);
  for (const e of stats.errors.slice(0, 10)) console.log(`  ERROR ${e.name}: ${e.error}`);
  const kinds = selected.reduce<Record<string, number>>((m, g) => ((m[g.kind] = (m[g.kind] ?? 0) + 1), m), {});
  const cats = selected.reduce<Record<string, number>>((m, g) => ((m[g.category] = (m[g.category] ?? 0) + 1), m), {});
  console.log(`kinds: ${JSON.stringify(kinds)}  categories: ${JSON.stringify(cats)}`);
  await pool.end();
}

main().catch((e) => { console.error("MINE FAILED:", e); process.exitCode = 1; });
