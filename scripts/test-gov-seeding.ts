/** Lane-only integration proof: existing IDs/notes survive old -> changed -> repeated seed. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/constructhub_dev_a4') throw Error('Only constructhub_dev_a4 is authorized');
const { db, pool } = await import('../server/db');
const { propertyAppraisers, permitDatabases } = await import('../shared/schema');
const { eq, sql } = await import('drizzle-orm');
const { syncAppraiserRecords } = await import('../server/seed-all-appraisers');
const { syncPermitPortals } = await import('../server/seed-permit-portals');
const apps = JSON.parse(readFileSync('server/data/appraisers.json', 'utf8'));
const portals = JSON.parse(readFileSync('server/data/permit-portals.json', 'utf8'));
const app = apps.find((r: any) => r.stateCode === 'FL' && r.county === 'Pinellas');
const portal = portals.find((r: any) => r.jurisdiction === 'Seattle, WA');
const count = async () => ({ a: (await db.select({ n: sql`count(*)` }).from(propertyAppraisers))[0].n, p: (await db.select({ n: sql`count(*)` }).from(permitDatabases))[0].n });
const [oldApp] = await db.select().from(propertyAppraisers).where(eq(propertyAppraisers.name, app.name));
const [oldPortal] = await db.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, portal.jurisdiction));
assert(oldApp && oldPortal);
const before = await count();
try {
  const note = oldApp.notes + ' Lane audit preservation test.';
  await db.update(propertyAppraisers).set({ notes: note }).where(eq(propertyAppraisers.id, oldApp.id));
  const changes = { ...app, portalUrl: null, phone: null, platform: null, linkStatus: 'none' };
  const permitChanges = { ...portal, url: null, platform: null, linkStatus: 'none' };
  await syncAppraiserRecords([changes]); await syncPermitPortals([permitChanges]);
  await syncAppraiserRecords([changes]); await syncPermitPortals([permitChanges]);
  const [a] = await db.select().from(propertyAppraisers).where(eq(propertyAppraisers.id, oldApp.id));
  const [p] = await db.select().from(permitDatabases).where(eq(permitDatabases.id, oldPortal.id));
  assert.equal(a.portalUrl, null); assert.equal(a.searchUrl, null); assert.equal(a.phone, null); assert.equal(a.notes, note); assert.equal(a.isActive, false);
  assert.equal(p.portalUrl, null); assert.equal(p.searchUrl, null); assert.equal(p.linkStatus, 'none'); assert.equal(p.isActive, false);
  assert.deepEqual(await count(), before);
  await syncAppraiserRecords([{ ...app, linkStatus: 'live', lastVerifiedAt: '2026-09-28T00:00:00.000Z' }]);
  await syncPermitPortals([{ ...portal, linkStatus: 'live', lastVerifiedAt: '2026-09-28T00:00:00.000Z' }]);
  const [restored] = await db.select().from(propertyAppraisers).where(eq(propertyAppraisers.id, oldApp.id));
  assert.equal(restored.portalUrl, app.portalUrl); assert.equal(restored.phone, app.phone); assert.equal(restored.isActive, true);
  assert.equal(restored.notes, note); assert.deepEqual(await count(), before);
  for (const linkStatus of ['unconfirmed', 'verified', 'dead']) {
    const available = linkStatus !== 'dead';
    const lastVerifiedAt = new Date(Date.now() + 60000).toISOString();
    await syncAppraiserRecords([{...app, portalUrl: available ? app.portalUrl : null, linkStatus, lastVerifiedAt}]);
    await syncPermitPortals([{...portal, url: available ? portal.url : null, linkStatus, lastVerifiedAt}]);
    const [a] = await db.select().from(propertyAppraisers).where(eq(propertyAppraisers.id, oldApp.id));
    const [p] = await db.select().from(permitDatabases).where(eq(permitDatabases.id, oldPortal.id));
    for (const row of [a,p]) { assert.equal(row.linkStatus,linkStatus); assert.equal(row.isActive,available); }
  }
  const missingCounty = portals.find((r: any) => r.jurisdiction === 'Allen County, IN');
  const countyBefore = await db.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, missingCounty.jurisdiction));
  await syncPermitPortals([missingCounty]);
  const countyOnce = await db.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, missingCounty.jurisdiction));
  await syncPermitPortals([missingCounty]);
  const countyTwice = await db.select().from(permitDatabases).where(eq(permitDatabases.jurisdiction, missingCounty.jurisdiction));
  assert.equal(countyOnce.length, 1); assert.equal(countyTwice.length, 1);
  assert.equal(countyOnce[0].id, countyTwice[0].id);
  writeFileSync('analysis/gov-seeding-test.json', JSON.stringify({ checkedAt: new Date().toISOString(), database: 'constructhub_dev_a4', before, after: await count(), countyPortalInserted: countyBefore.length === 0, assertions: ['changed and nulled URLs/phones propagated', 'inactive status propagated', 'restored URL and phone propagated', 'IDs and custom notes preserved', 'repeat seed added no duplicates', 'missing county portal inserted by exact county/state key and stable on repeat'] }, null, 2) + '\n');
} finally {
  const { id: aid, ...a } = oldApp; const { id: pid, ...p } = oldPortal;
  await db.update(propertyAppraisers).set(a).where(eq(propertyAppraisers.id, aid));
  await db.update(permitDatabases).set(p).where(eq(permitDatabases.id, pid));
  await pool.end();
}
