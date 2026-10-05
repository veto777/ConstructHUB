/**
 * Erase accounts closed more than 30 days ago (server/account/erase.ts) — the daily worker does this in production.
 * Run:  npx tsx scripts/erase-closed-accounts.ts --dry-run   (reports what would go, changes nothing)
 *       npx tsx scripts/erase-closed-accounts.ts              (erases)
 */
import { eraseDueAccounts } from "../server/account/erase";
import { pool } from "../server/db";

const dryRun = process.argv.includes("--dry-run");
eraseDueAccounts({ dryRun })
  .then((reports) => {
    console.log(JSON.stringify(reports, null, 2));
    console.log(`${reports.length} closed account(s) due${dryRun ? " (dry run — nothing changed)" : ""}.`);
  })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
