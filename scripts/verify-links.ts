/** GET-only records/permit content verifier. Blocked and exhausted transient errors
 * remain unconfirmed and usable. Only source-qualified rows may be reclassified.
 * Run with an explicit DATABASE_URL: npx tsx --env-file=.env scripts/verify-links.ts.
 */
import { db } from "../server/db";
import { propertyAppraisers, permitDatabases, counties } from "@shared/schema";
import { eq, isNotNull, and, inArray } from "drizzle-orm";

import { fetchGovernmentPage, classifyGovernmentPage } from "../server/government-url-check";
import { classifySourceListedLink } from "../server/government-link-policy";
import * as cheerio from "cheerio";
const CONCURRENCY = 4;
const countyMap = new Map((await db.select().from(counties)).map(c => [c.id, c]));
async function checkUrl(url: string, kind: string, countyId: number, jurisdiction: string) {
  const response = await fetchGovernmentPage(url);
  const check = classifyGovernmentPage(response, kind);
  const $ = cheerio.load(response.html); $('script,style').remove();
  return classifySourceListedLink(url, {...check, httpStatus: response.httpStatus, finalUrl: response.finalUrl, text: $('body').text()},
    {state: countyMap.get(countyId)?.stateCode || '', jurisdiction, sourceListed: true});
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
  const rows = await db.select().from(propertyAppraisers).where(and(isNotNull(propertyAppraisers.portalUrl), inArray(propertyAppraisers.linkStatus, ["live", "verified", "unconfirmed"])));
  console.log(`Verifying ${rows.length} appraiser portals...`);
  let live = 0, dead = 0, unverified = 0, done = 0;
  await mapPool(rows, async (r) => {
    const status = await checkUrl(r.portalUrl!, "appraiser", r.countyId, countyMap.get(r.countyId)?.name || r.name);
    await db.update(propertyAppraisers)
      .set({ linkStatus: status, lastVerifiedAt: new Date(), isActive: status !== "dead", ...(status === "dead" ? {portalUrl: null, searchUrl: null} : {}) })
      .where(eq(propertyAppraisers.id, r.id));
    if (status === "verified") live++; else if (status === "dead") dead++; else unverified++;
    if (++done % 200 === 0) console.log(`  ...${done}/${rows.length} (live ${live}, dead ${dead})`);
  }, CONCURRENCY);
  console.log(`Appraisers done: ${live} live, ${dead} dead, ${unverified} unverified.`);
}

async function verifyPermits() {
  const rows = await db.select().from(permitDatabases).where(and(isNotNull(permitDatabases.portalUrl), inArray(permitDatabases.linkStatus, ["live", "verified", "unconfirmed"])));
  console.log(`Verifying ${rows.length} permit portals...`);
  let live = 0, dead = 0, unverified = 0, done = 0;
  await mapPool(rows, async (r) => {
    const status = await checkUrl(r.portalUrl!, "permit", r.countyId, r.jurisdiction.split(",")[0]);
    await db.update(permitDatabases)
      .set({ linkStatus: status, lastVerifiedAt: new Date(), isActive: status !== "dead", ...(status === "dead" ? {portalUrl: null, searchUrl: null} : {}) })
      .where(eq(permitDatabases.id, r.id));
    if (status === "verified") live++; else if (status === "dead") dead++; else unverified++;
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
