/**
 * Campaign report from the command line — the same numbers as Platform Admin →
 * Campaigns, read from whatever database DATABASE_URL points at. READ-ONLY:
 * it runs SELECTs inside a READ ONLY transaction and changes nothing.
 *
 *   DATABASE_URL="<url>" npx tsx scripts/campaign-report.ts --since 2026-10-08 [--until 2026-10-14] [--source instagram] [--csv]
 *
 * Days are US Eastern. Without --since it covers the last 7 days. Only
 * visitors who accepted the cookie banner are in the numbers.
 */
import pg from "pg";
import { campaignReport } from "../server/analytics-attribution";
import { campaignReportCsv, campaignReportText, parseReportDate } from "../shared/campaign-attribution";

export type CliArgs = { since?: string; until?: string; source?: string; csv: boolean };

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { csv: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") { out.csv = true; continue; }
    const m = a.match(/^--(since|until|source)(?:=(.*))?$/);
    if (!m) throw new Error(`Unknown argument: ${a}`);
    const value = m[2] ?? argv[++i];
    if (value == null || value.startsWith("--")) throw new Error(`--${m[1]} needs a value`);
    if (m[1] !== "source" && !parseReportDate(value)) throw new Error(`--${m[1]} must be a date like 2026-10-08`);
    out[m[1] as "since" | "until" | "source"] = value;
  }
  return out;
}

async function main() {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e: any) {
    console.error(`${e.message}\nUsage: npx tsx scripts/campaign-report.ts --since 2026-10-08 [--until 2026-10-14] [--source instagram] [--csv]`);
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const report = await campaignReport(client, args);
    await client.query("ROLLBACK");
    console.log(args.csv ? campaignReportCsv(report) : campaignReportText(report));
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (e?.code === "42P01" || e?.code === "42703") {
      console.error("This database does not have the campaign attribution schema yet (deploy the release, or run scripts/apply-schema-migration.ts).");
      process.exitCode = 1;
    } else {
      throw e;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// Only when run directly (the unit test imports parseArgs).
if (process.argv[1] && /campaign-report\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
