/**
 * One-shot HOVER takeoff back-fill — ZERO HOVER API calls.
 *
 * Every HOVER measurement whose full_json is already stored (raw_payload.fullJson) gets raw_payload.takeoff
 * and the crm_measurements numeric columns re-derived by shared/hover-takeoff.ts under its org's takeoff rules
 * (default: roof + 5 % waste, siding rounded up to 100 ft²). Idempotent: rows whose derived values are already
 * current are not written, so a second run reports "updated 0". The scheduled HOVER sync runs the same
 * back-fill per org (server/crm/hover-file.ts backfillHoverTakeoffs); this script is for doing it now.
 *
 *   npx tsx --env-file=.env scripts/backfill-hover-takeoffs.ts [--org=<orgId>] [--dry-run] [--create-projects]
 *
 *   --org              one org only (default: every org)
 *   --dry-run          report what would change, write nothing
 *   --create-projects  ALSO give every HOVER capture that has a client but no project one (an existing project
 *                      at the address, else the client's single open project, else a NEW "lead" project). Off by
 *                      default: on an established account it can add hundreds of leads to the pipeline at once.
 *                      Ambiguous and staff-ordered captures never get a project. Ignored with --dry-run.
 */
const argVal = (f: string) => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`));
  if (eq) return eq.slice(f.length + 1);
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
};
const ORG_ID = argVal("--org");
const DRY_RUN = process.argv.includes("--dry-run");
const CREATE_PROJECTS = process.argv.includes("--create-projects");

const { backfillHoverTakeoffs, backfillHoverProjects } = await import("../server/crm/hover-file");

const takeoffs = await backfillHoverTakeoffs(ORG_ID, { dryRun: DRY_RUN });
console.log(
  `[takeoff] ${DRY_RUN ? "dry run — " : ""}checked ${takeoffs.checked}, ${DRY_RUN ? "would update" : "updated"} ${takeoffs.updated}, `
  + `unchanged ${takeoffs.unchanged}, skipped ${takeoffs.skipped} (no usable full_json)`,
);
if (CREATE_PROJECTS && !DRY_RUN) {
  const p = await backfillHoverProjects(ORG_ID);
  console.log(`[projects] checked ${p.checked}, created ${p.created}, linked ${p.linked}, skipped ${p.skipped}`);
}
process.exit(0);
