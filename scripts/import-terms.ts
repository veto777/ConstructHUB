/**
 * HCP TERMS IMPORT — sets org document text from the HCP org-settings export.
 *
 * Sources (analysis/hcp-export/, see hcp-terms.md for the full texts and the
 * evidence trail):
 *   termsAndConditions ← company.json terms_and_conditions (10,275 chars;
 *     verified content-identical to organization.json and to the live public
 *     page https://pro.housecallpro.com/Alpine/682746/terms on 2026-08-01)
 *   estimateFooter     ← company.json message_from_pro (org-wide estimate
 *     "message from pro" — Alpine's 25-year workmanship warranty sentence)
 *   warrantyText       ← same sentence (it IS the warranty HCP shows customers)
 *   invoiceFooter      ← NOT set: no invoice-footer text exists anywhere in
 *     the export or the crawled HCP settings screens.
 *
 * Idempotent: fields whose value already matches are reported "unchanged" and
 * not written. Prints a unified diff for every field that changes.
 *
 * Usage:
 *   npx tsx scripts/import-terms.ts --org=<orgId> --database-url=postgres://… \
 *       [--export-dir=analysis/hcp-export] [--yes]
 * Without --yes it prints the diff and asks for nothing — it is a dry run
 * (no writes). With --yes it applies.
 */
import { readFileSync } from "fs";
import path from "path";

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
const APPLY = argv.includes("--yes");
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const EXPORT_DIR = path.resolve(arg("export-dir") ?? path.join(SCRIPT_DIR, "..", "analysis", "hcp-export"));

const company = JSON.parse(readFileSync(path.join(EXPORT_DIR, "company.json"), "utf8"));
const TERMS = String(company.terms_and_conditions ?? "").trim();
const MESSAGE = String(company.message_from_pro ?? "").trim();
if (!TERMS) throw new Error("company.json has no terms_and_conditions");

const FIELDS: Record<string, string | null> = {
  termsAndConditions: TERMS,
  estimateFooter: MESSAGE || null,
  warrantyText: MESSAGE || null,
  invoiceFooter: null, // no source — leave untouched
};
const COL: Record<string, string> = {
  termsAndConditions: "terms_and_conditions",
  estimateFooter: "estimate_footer",
  warrantyText: "warranty_text",
  invoiceFooter: "invoice_footer",
};

function unifiedDiff(field: string, before: string, after: string): string {
  const b = before.split("\n"), a = after.split("\n");
  const out = [`--- ${field} (current, ${before.length} chars)`, `+++ ${field} (incoming, ${after.length} chars)`];
  // Simple LCS-free diff good enough for review: common prefix/suffix, middle replaced.
  let pre = 0;
  while (pre < b.length && pre < a.length && b[pre] === a[pre]) pre++;
  let suf = 0;
  while (suf < b.length - pre && suf < a.length - pre && b[b.length - 1 - suf] === a[a.length - 1 - suf]) suf++;
  const ctx = 2;
  if (pre > ctx) out.push(`  … (${pre - ctx} identical leading lines)`);
  for (let i = Math.max(0, pre - ctx); i < pre; i++) out.push(`  ${b[i]}`);
  for (let i = pre; i < b.length - suf; i++) out.push(`- ${b[i]}`);
  for (let i = pre; i < a.length - suf; i++) out.push(`+ ${a[i]}`);
  for (let i = b.length - suf; i < Math.min(b.length, b.length - suf + ctx); i++) out.push(`  ${b[i]}`);
  if (suf > ctx) out.push(`  … (${suf - ctx} identical trailing lines)`);
  return out.join("\n");
}

async function main() {
  const { pool } = await import("../server/db");
  const r = await pool.query(
    `SELECT name, terms_and_conditions, estimate_footer, invoice_footer, warranty_text FROM crm_orgs WHERE id = $1`,
    [ORG_ID],
  );
  if (!r.rows.length) throw new Error(`Org ${ORG_ID} not found`);
  const org = r.rows[0];
  console.log(`org ${ORG_ID} (${org.name}) — mode: ${APPLY ? "APPLY" : "DRY RUN (pass --yes to write)"}\n`);

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [field, incoming] of Object.entries(FIELDS)) {
    if (incoming === null) { console.log(`• ${field}: no source — leaving untouched`); continue; }
    const current = String(org[COL[field]] ?? "").trim();
    if (current === incoming) {
      console.log(`• ${field}: unchanged (${incoming.length} chars already set)`);
      continue;
    }
    console.log(unifiedDiff(field, current, incoming));
    console.log();
    sets.push(`${COL[field]} = $${vals.length + 2}`);
    vals.push(incoming);
  }
  if (!sets.length) { console.log("nothing to change"); await pool.end(); return; }
  if (!APPLY) { console.log(`\ndry run — ${sets.length} field(s) would change. Re-run with --yes to apply.`); await pool.end(); return; }
  vals.unshift(ORG_ID);
  await pool.query(`UPDATE crm_orgs SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
  console.log(`\napplied: ${sets.length} field(s) updated`);
  await pool.end();
}

main().catch((e) => { console.error("TERMS IMPORT FAILED:", e); process.exitCode = 1; });
