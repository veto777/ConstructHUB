/** GET-only records/permit content verifier. Blocked and exhausted transient errors
 * become unverified, never live/dead guesses. All non-live links are deactivated.
 * Run with an explicit DATABASE_URL: npx tsx --env-file=.env scripts/verify-links.ts.
 */
import { db } from "../server/db";
import { propertyAppraisers, permitDatabases } from "@shared/schema";
import { eq, isNotNull } from "drizzle-orm";

import { fetchGovernmentPage, classifyGovernmentPage } from "../server/government-url-check";
const CONCURRENCY = 4;
async function checkUrl(url: string, kind: string) {
  return classifyGovernmentPage(await fetchGovernmentPage(url), kind).status;
}

async function mapPool<T>(items: T[], fn: (item: T, i: number) => Promise<void>, conc: number) {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i], i);
    }
  }));
}

async function verifyAppraisers() {
  const rows = await db.select().from(propertyAppraisers).where(isNotNull(propertyAppraisers.portalUrl));
  console.log(`Verifying ${rows.length} appraiser portals...`);
  let live = 0, dead = 0, unverified = 0, done = 0;
  await mapPool(rows, async (r) => {
    const status = await checkUrl(r.portalUrl!, "appraiser");
    await db.update(propertyAppraisers)
      .set({ linkStatus: status, lastVerifiedAt: new Date(), isActive: status === "live" })
      .where(eq(propertyAppraisers.id, r.id));
    if (status === "live") live++; else if (status === "dead") dead++; else unverified++;
    if (++done % 200 === 0) console.log(`  ...${done}/${rows.length} (live ${live}, dead ${dead})`);
  }, CONCURRENCY);
  console.log(`Appraisers done: ${live} live, ${dead} dead, ${unverified} unverified.`);
}

async function verifyPermits() {
  const rows = await db.select().from(permitDatabases).where(isNotNull(permitDatabases.portalUrl));
  console.log(`Verifying ${rows.length} permit portals...`);
  let live = 0, dead = 0, unverified = 0, done = 0;
  await mapPool(rows, async (r) => {
    const status = await checkUrl(r.portalUrl!, "permit");
    await db.update(permitDatabases)
      .set({ linkStatus: status, lastVerifiedAt: new Date(), isActive: status === "live" })
      .where(eq(permitDatabases.id, r.id));
    if (status === "live") live++; else if (status === "dead") dead++; else unverified++;
    if (++done % 200 === 0) console.log(`  ...${done}/${rows.length} (live ${live}, dead ${dead})`);
  }, CONCURRENCY);
  console.log(`Permits done: ${live} live, ${dead} dead, ${unverified} unverified.`);
}

async function main() {
  const which = process.argv[2];
  if (which === "permits") await verifyPermits();
  else if (which === "appraisers") await verifyAppraisers();
  else { await verifyAppraisers(); await verifyPermits(); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
