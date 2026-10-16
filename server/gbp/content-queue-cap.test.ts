/**
 * The GBP posts queue is bounded per account (server/gbp/content.ts enqueue, review w3-r2 M2): a new batch that would
 * take the account past MAX_QUEUED_PER_USER waiting items is a 409 in words, a replay of an accepted batch is still
 * answered, and the short-window budget counts items, not requests. Needs a local constructhub_dev_<x> database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureGrowthSchema } from "../growth-schema";
import { ensureGbpSchema } from "./schema";
import { ensureAccountEventsSchema } from "../account-events";
import { ensureGbpContentSchema, enqueue, MAX_QUEUED_PER_USER, QUEUE_ITEMS_PER_WINDOW } from "./content";

let user: number, location: number;
const schedule = { start: "2030-01-01T12:00:00Z", everyMinutes: 1440 };
const post = (n: number) => ({ kind: "post", summary: `Fixture update ${n}`, topicType: "STANDARD", photoIds: [] });
const items = (count: number, from = 0) => Array.from({ length: count }, (_, i) => post(from + i));
const queued = async () => Number((await pool.query("SELECT count(*) FROM gbp_content_jobs WHERE user_id=$1 AND status='queued'", [user])).rows[0].count);
/** Fills the queue straight in SQL (not through enqueue, so the item budget is untouched). */
const fill = (n: number, status = "queued") => pool.query(
  `INSERT INTO gbp_content_jobs(user_id,location_id,request_key,item_index,kind,payload,due_at,target,schedule,status)
   SELECT $1,$2,$3,g,'post','{}'::jsonb,now()+interval '1 year','{}'::jsonb,'{}'::jsonb,$5 FROM generate_series(0,$4-1) g`,
  [user, location, randomUUID(), n, status]);

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/constructhub_dev(?:_[a-z0-9]+)?$/.test(url.pathname) || !["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error("a local development DB is required");
  await ensureGrowthSchema();
  await ensureGbpSchema();
  await ensureAccountEventsSchema();
  await ensureGbpContentSchema();
  user = (await pool.query("INSERT INTO users(email) VALUES('queue-cap-'||gen_random_uuid()||'@example.invalid') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO subscriptions(user_id,plan,status) VALUES($1,'pro','active')", [user]);
  location = (await pool.query("INSERT INTO business_locations(user_id,business_name,gbp_account_name,gbp_location_name,gbp_google_subject) VALUES($1,'Queue cap fixture','accounts/cap','locations/cap','subject') RETURNING id", [user])).rows[0].id;
});
beforeEach(async () => {
  await pool.query("DELETE FROM gbp_content_jobs WHERE user_id=$1", [user]);
  await pool.query("DELETE FROM growth_budgets WHERE key=$1", [`gbp-content-items:${user}`]);
});
afterAll(async () => {
  await pool.query("DELETE FROM gbp_content_jobs WHERE user_id=$1", [user]);
  await pool.query("DELETE FROM growth_budgets WHERE key=$1", [`gbp-content-items:${user}`]);
  await pool.query("DELETE FROM business_locations WHERE user_id=$1", [user]);
  await pool.query("DELETE FROM users WHERE id=$1", [user]);
  await pool.end();
});

describe("GBP queue cap (review w3-r2 M2)", () => {
  it("is 500 waiting items per account", () => { expect(MAX_QUEUED_PER_USER).toBe(500); });

  it("accepts a batch that lands exactly on the cap", async () => {
    await fill(MAX_QUEUED_PER_USER - 3);
    await enqueue(user, location, { requestKey: randomUUID(), items: items(3), schedule });
    expect(await queued()).toBe(MAX_QUEUED_PER_USER);
  });

  it("refuses a batch that would pass the cap with a 409 in plain words, and writes nothing", async () => {
    await fill(MAX_QUEUED_PER_USER - 2);
    const err: any = await enqueue(user, location, { requestKey: randomUUID(), items: items(3), schedule }).catch((e) => e);
    expect(err?.status).toBe(409);
    expect(err.message).toMatch(/already have 498 posts and photos waiting/);
    expect(err.message).toMatch(/Up to 500 can wait at once/);
    expect(await queued()).toBe(MAX_QUEUED_PER_USER - 2);
  });

  it("counts only queued rows: published and failed jobs do not use the cap", async () => {
    await fill(MAX_QUEUED_PER_USER, "published");
    await fill(50, "failed");
    await enqueue(user, location, { requestKey: randomUUID(), items: items(10), schedule });
    expect(await queued()).toBe(10);
  });

  it("a replay of an accepted batch is still answered at the cap", async () => {
    const key = randomUUID(), body = { requestKey: key, items: items(2), schedule };
    const first = await enqueue(user, location, body);
    await fill(MAX_QUEUED_PER_USER - 2);
    const again = await enqueue(user, location, body);
    expect(again.map((j: any) => j.id)).toEqual(first.map((j: any) => j.id));
  });

  it("two batches sent at once cannot both pass the count", async () => {
    await fill(MAX_QUEUED_PER_USER - 5);
    const results = await Promise.allSettled([4, 4].map((n) => enqueue(user, location, { requestKey: randomUUID(), items: items(n), schedule })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").map((r: any) => r.reason.status)).toEqual([409]);
    expect(await queued()).toBe(MAX_QUEUED_PER_USER - 1);
  });

  it("the short-window budget counts items, not requests", async () => {
    // Pre-use the item budget so one more 100-item batch would pass it.
    await pool.query("INSERT INTO growth_budgets(key,period,used) VALUES($1,$2,$3)", [`gbp-content-items:${user}`, String(Math.floor(Date.now() / 600_000)), QUEUE_ITEMS_PER_WINDOW - 99]);
    const err: any = await enqueue(user, location, { requestKey: randomUUID(), items: items(100), schedule }).catch((e) => e);
    expect(err?.status).toBe(429);
    expect(await queued()).toBe(0);
    await enqueue(user, location, { requestKey: randomUUID(), items: items(99), schedule });
    expect(await queued()).toBe(99);
  });
});
