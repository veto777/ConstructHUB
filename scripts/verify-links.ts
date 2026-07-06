/**
 * Link verifier. Pings every portalUrl / searchUrl in property_appraisers and
 * permit_databases, then records whether it's live and deactivates dead ones so
 * the app only ever surfaces working government links.
 *
 *   linkStatus: 'live'  -> host responded (2xx/3xx, or an auth/blocked status)
 *               'dead'  -> DNS failure, refused/reset, timeout, or 404/410
 *               'none'  -> no URL on record (left as-is)
 *   isActive is set to false when a link is 'dead'.
 *
 * Requires a DATABASE_URL. Run:  npx tsx scripts/verify-links.ts [appraisers|permits]
 */
import { db } from "../server/db";
import { propertyAppraisers, permitDatabases } from "@shared/schema";
import { eq, isNotNull } from "drizzle-orm";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const CONCURRENCY = 12;
const TIMEOUT_MS = 15000;

// Statuses that mean "the host is alive, just guarding the endpoint" — not dead.
const ALIVE_STATUSES = new Set([401, 403, 405, 406, 429, 999]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkUrl(url: string): Promise<"live" | "dead"> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { method, redirect: "follow", headers: { "User-Agent": UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status < 400 || ALIVE_STATUSES.has(res.status)) return "live";
      if (res.status === 404 || res.status === 410) return "dead";
      if (method === "HEAD" && (res.status === 405 || res.status === 501)) continue; // retry with GET
      // Other 4xx/5xx: host responded — treat as live (avoid false deactivation).
      return "live";
    } catch (e: any) {
      // Abort/timeout or network error: try GET after HEAD, else dead.
      if (method === "HEAD") continue;
      return "dead";
    }
  }
  return "dead";
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
  let live = 0, dead = 0, done = 0;
  await mapPool(rows, async (r) => {
    const status = await checkUrl(r.portalUrl!);
    await db.update(propertyAppraisers)
      .set({ linkStatus: status, lastVerifiedAt: new Date(), ...(status === "dead" ? { isActive: false } : {}) })
      .where(eq(propertyAppraisers.id, r.id));
    status === "live" ? live++ : dead++;
    if (++done % 200 === 0) console.log(`  ...${done}/${rows.length} (live ${live}, dead ${dead})`);
  }, CONCURRENCY);
  console.log(`Appraisers done: ${live} live, ${dead} dead.`);
}

async function verifyPermits() {
  const rows = await db.select().from(permitDatabases).where(isNotNull(permitDatabases.portalUrl));
  console.log(`Verifying ${rows.length} permit portals...`);
  let live = 0, dead = 0, done = 0;
  await mapPool(rows, async (r) => {
    const status = await checkUrl(r.portalUrl!);
    await db.update(permitDatabases)
      .set({ linkStatus: status, lastVerifiedAt: new Date(), ...(status === "dead" ? { isActive: false } : {}) })
      .where(eq(permitDatabases.id, r.id));
    status === "live" ? live++ : dead++;
    if (++done % 200 === 0) console.log(`  ...${done}/${rows.length} (live ${live}, dead ${dead})`);
  }, CONCURRENCY);
  console.log(`Permits done: ${live} live, ${dead} dead.`);
}

async function main() {
  const which = process.argv[2];
  if (which === "permits") await verifyPermits();
  else if (which === "appraisers") await verifyAppraisers();
  else { await verifyAppraisers(); await verifyPermits(); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
