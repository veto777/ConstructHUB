import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { pool } from "../db";
import { ensureCloudflareSearchSchema } from "./schema";
import { listAssets } from "./common";

// listAssets' `summary` (synced / notSynced / withError / linkedLocations) must
// cover EVERY row the search + status filter matches for this user and
// provider — never only the page being returned, and never another user's rows.
//
// Fixture (all names carry a per-run tag so a crashed run cannot collide):
//   user / cloudflare
//     Alpha site   synced, no error, linked to 2 locations, status active
//     Beta site    synced, error '',   status active       (empty error is NOT an error)
//     Gamma site   not synced, error 'DNS failed', status pending
//     Delta 50_x   not synced, error 'boom', status active, linked to 1 location
//   user / gsc
//     Alpha prop   synced, status active
//     Beta prop    not synced, error 'quota', status active
//   other / cloudflare (same names, synced, with errors, linked) — must never be counted

let user: number, other: number, tag: string;
let userLocs: number[] = [], otherLoc: number;
let userCf: number, userGsc: number, otherCf: number;
const ids: Record<string, number> = {};

async function insertUser(label: string) {
  const { rows } = await pool.query(
    "INSERT INTO users(email) VALUES('edge-summary-'||$1||'-'||gen_random_uuid()||'@example.invalid') RETURNING id",
    [label],
  );
  return rows[0].id as number;
}
async function insertConnection(u: number, provider: string) {
  const { rows } = await pool.query(
    "INSERT INTO edge_connections(user_id,provider,subject,method) VALUES($1,$2,$3,'fixture') RETURNING id",
    [u, provider, `summary-${provider}-${u}`],
  );
  return rows[0].id as number;
}
async function insertLocation(u: number, name: string) {
  const { rows } = await pool.query(
    "INSERT INTO business_locations(user_id,business_name,website) VALUES($1,$2,'https://summary.example.invalid/') RETURNING id",
    [u, name],
  );
  return rows[0].id as number;
}
async function insertAsset(
  u: number,
  connection: number,
  provider: string,
  name: string,
  { synced = false, error = null as string | null, status = "active" } = {},
) {
  const { rows } = await pool.query(
    `INSERT INTO edge_assets(user_id,connection_id,provider,external_id,name,domain,status,synced_at,error)
     VALUES($1,$2,$3,gen_random_uuid()::text,$4,'summary.example.invalid',$5,CASE WHEN $6::boolean THEN now() END,$7) RETURNING id`,
    [u, connection, provider, name, status, synced, error],
  );
  return rows[0].id as number;
}
async function link(asset: number, u: number, location: number) {
  await pool.query(
    "INSERT INTO edge_location_links(asset_id,user_id,location_id) VALUES($1,$2,$3)",
    [asset, u, location],
  );
}

beforeAll(async () => {
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(new URL(process.env.DATABASE_URL!).pathname))
    throw Error("a5 DB required");
  await ensureCloudflareSearchSchema();
  tag = `t${Date.now().toString(36)}`;
  user = await insertUser("user");
  other = await insertUser("other");
  userLocs = [
    await insertLocation(user, `${tag} loc 1`),
    await insertLocation(user, `${tag} loc 2`),
    await insertLocation(user, `${tag} loc 3`),
  ];
  otherLoc = await insertLocation(other, `${tag} other loc`);
  userCf = await insertConnection(user, "cloudflare");
  userGsc = await insertConnection(user, "gsc");
  otherCf = await insertConnection(other, "cloudflare");

  ids.alpha = await insertAsset(user, userCf, "cloudflare", `${tag} Alpha site`, { synced: true });
  ids.beta = await insertAsset(user, userCf, "cloudflare", `${tag} Beta site`, { synced: true, error: "" });
  ids.gamma = await insertAsset(user, userCf, "cloudflare", `${tag} Gamma site`, { error: "DNS failed", status: "pending" });
  ids.delta = await insertAsset(user, userCf, "cloudflare", `${tag} Delta 50_x`, { error: "boom" });
  await link(ids.alpha, user, userLocs[0]);
  await link(ids.alpha, user, userLocs[1]);
  await link(ids.delta, user, userLocs[2]);

  ids.gscAlpha = await insertAsset(user, userGsc, "gsc", `${tag} Alpha prop`, { synced: true });
  ids.gscBeta = await insertAsset(user, userGsc, "gsc", `${tag} Beta prop`, { error: "quota" });

  // The other user's rows mirror the fixture names so a missing user_id predicate anywhere would inflate the counts.
  ids.otherAlpha = await insertAsset(other, otherCf, "cloudflare", `${tag} Alpha site`, { synced: true, error: "other err" });
  ids.otherGamma = await insertAsset(other, otherCf, "cloudflare", `${tag} Gamma site`, { synced: true, error: "other err" });
  await link(ids.otherAlpha, other, otherLoc);
  await link(ids.otherGamma, other, otherLoc);
});

afterAll(async () => {
  // users → edge_connections → edge_assets → edge_location_links cascade; locations are deleted explicitly.
  await pool.query("DELETE FROM business_locations WHERE user_id=ANY($1::int[])", [[user, other]]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [[user, other]]);
  const { rows } = await pool.query("SELECT count(*)::int n FROM edge_assets WHERE user_id=ANY($1::int[])", [[user, other]]);
  expect(rows[0].n).toBe(0);
  await pool.end();
});

describe("listAssets summary", () => {
  it("counts every matching row for the user and provider, not just the page", async () => {
    const r = await listAssets(user, "cloudflare", { q: tag, limit: 1 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe(ids.alpha);
    expect(r.items[0].locations).toBe(2);
    expect(r.total).toBe(4);
    expect(r.summary).toEqual({ synced: 2, notSynced: 2, withError: 2, linkedLocations: 3 });
  });

  it("keeps the same summary on a later page", async () => {
    const r = await listAssets(user, "cloudflare", { q: tag, limit: 2, page: 2 });
    expect(r.items.map((i: any) => i.id)).toEqual([ids.gamma, ids.delta]);
    expect(r.page).toBe(2);
    expect(r.summary).toEqual({ synced: 2, notSynced: 2, withError: 2, linkedLocations: 3 });
  });

  it("returns zeros for a page past the end but still the full summary", async () => {
    const r = await listAssets(user, "cloudflare", { q: tag, limit: 10, page: 5 });
    expect(r.items).toEqual([]);
    expect(r.total).toBe(4);
    expect(r.summary).toEqual({ synced: 2, notSynced: 2, withError: 2, linkedLocations: 3 });
  });

  it("scopes the summary to the search", async () => {
    const r = await listAssets(user, "cloudflare", { q: `${tag} alpha` });
    expect(r.items.map((i: any) => i.id)).toEqual([ids.alpha]);
    expect(r.summary).toEqual({ synced: 1, notSynced: 0, withError: 0, linkedLocations: 2 });

    const g = await listAssets(user, "cloudflare", { q: `${tag} gamma` });
    expect(g.total).toBe(1);
    expect(g.summary).toEqual({ synced: 0, notSynced: 1, withError: 1, linkedLocations: 0 });
  });

  it("treats % and _ in the search literally", async () => {
    const r = await listAssets(user, "cloudflare", { q: "50_x" });
    expect(r.items.map((i: any) => i.id)).toEqual([ids.delta]);
    expect(r.summary).toEqual({ synced: 0, notSynced: 1, withError: 1, linkedLocations: 1 });
    const none = await listAssets(user, "cloudflare", { q: `${tag}%nothing` });
    expect(none.total).toBe(0);
  });

  it("scopes the summary to the status filter", async () => {
    const active = await listAssets(user, "cloudflare", { q: tag, status: "active" });
    expect(active.total).toBe(3);
    expect(active.items.map((i: any) => i.id)).toEqual([ids.alpha, ids.beta, ids.delta]);
    expect(active.summary).toEqual({ synced: 2, notSynced: 1, withError: 1, linkedLocations: 3 });

    const pending = await listAssets(user, "cloudflare", { q: tag, status: "pending" });
    expect(pending.total).toBe(1);
    expect(pending.summary).toEqual({ synced: 0, notSynced: 1, withError: 1, linkedLocations: 0 });

    const missing = await listAssets(user, "cloudflare", { q: tag, status: "deleted" });
    expect(missing.total).toBe(0);
    expect(missing.summary).toEqual({ synced: 0, notSynced: 0, withError: 0, linkedLocations: 0 });
  });

  it("does not count an empty error string as an error", async () => {
    const r = await listAssets(user, "cloudflare", { q: `${tag} beta` });
    expect(r.items.map((i: any) => i.id)).toEqual([ids.beta]);
    expect(r.summary.withError).toBe(0);
  });

  it("separates providers", async () => {
    const g = await listAssets(user, "gsc", { q: tag });
    expect(g.total).toBe(2);
    expect(g.items.map((i: any) => i.id)).toEqual([ids.gscAlpha, ids.gscBeta]);
    expect(g.summary).toEqual({ synced: 1, notSynced: 1, withError: 1, linkedLocations: 0 });
    // "Alpha" exists under both providers; the gsc view must not see the cloudflare links.
    const a = await listAssets(user, "gsc", { q: `${tag} alpha` });
    expect(a.total).toBe(1);
    expect(a.summary).toEqual({ synced: 1, notSynced: 0, withError: 0, linkedLocations: 0 });
  });

  it("never counts another user's rows or links", async () => {
    // The other user has two synced+errored+linked rows with the same names; none of them may leak.
    const mine = await listAssets(user, "cloudflare", { q: `${tag} gamma` });
    expect(mine.summary).toEqual({ synced: 0, notSynced: 1, withError: 1, linkedLocations: 0 });

    const theirs = await listAssets(other, "cloudflare", { q: tag });
    expect(theirs.total).toBe(2);
    expect(theirs.items.map((i: any) => i.id)).toEqual([ids.otherAlpha, ids.otherGamma]);
    expect(theirs.summary).toEqual({ synced: 2, notSynced: 0, withError: 2, linkedLocations: 2 });

    const stranger = await listAssets(other + 1_000_000, "cloudflare", { q: tag });
    expect(stranger.total).toBe(0);
    expect(stranger.summary).toEqual({ synced: 0, notSynced: 0, withError: 0, linkedLocations: 0 });
  });

  it("returns zeros when nothing matches", async () => {
    const r = await listAssets(user, "cloudflare", { q: `${tag} no such site` });
    expect(r).toMatchObject({ items: [], total: 0, page: 1, limit: 25 });
    expect(r.summary).toEqual({ synced: 0, notSynced: 0, withError: 0, linkedLocations: 0 });
  });
});
