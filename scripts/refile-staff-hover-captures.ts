/**
 * Move HOVER captures that piled up on a rep's / the office's record to the client at each capture's address
 * (or a new address-only client). Logic and rules: server/crm/hover-refile.ts.
 *
 *   npx tsx --env-file=.env scripts/refile-staff-hover-captures.ts --org=<orgId> [--dry-run] [--out=moves.json]
 *   npx tsx --env-file=.env scripts/refile-staff-hover-captures.ts --org=<orgId> --undo=moves.json
 *
 * --out saves every move (default ./hover-refile-<org>-<time>.json) so --undo can put them all back.
 */
import fs from "fs";
const argVal = (f: string) => process.argv.find((a) => a.startsWith(`${f}=`))?.slice(f.length + 1);
const ORG_ID = argVal("--org");
if (!ORG_ID) { console.error("--org=<orgId> is required"); process.exit(1); }
const DRY_RUN = process.argv.includes("--dry-run");
const UNDO = argVal("--undo");
const { refileHoverCollectors, undoRefile } = await import("../server/crm/hover-refile");

if (UNDO) {
  const moves = JSON.parse(fs.readFileSync(UNDO, "utf8"));
  console.log(`[undo] restored ${await undoRefile(ORG_ID, moves)} captures`);
  process.exit(0);
}
const { collectors, moves } = await refileHoverCollectors(ORG_ID, { dryRun: DRY_RUN });
for (const c of collectors) {
  const mine = moves.filter((m) => m.fromCustomerId === c.id);
  console.log(`${c.name}: ${c.properties} properties → ${mine.length} captures move (${mine.filter((m) => !m.created).length} to existing clients, `
    + `${mine.filter((m) => m.created).length} new), ${mine.reduce((s, m) => s + m.photos, 0)} photos`);
}
const out = argVal("--out") ?? `hover-refile-${ORG_ID.slice(0, 8)}-${Date.now()}${DRY_RUN ? "-dry" : ""}.json`;
fs.writeFileSync(out, JSON.stringify(moves, null, 1));
console.log(`${DRY_RUN ? "[dry run] would move" : "moved"} ${moves.length} captures, ${moves.reduce((s, m) => s + m.photos, 0)} photos; ${moves.filter((m) => m.created).length} new clients. Moves saved to ${out}`);
process.exit(0);
