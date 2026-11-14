import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
const create = vi.hoisted(() => vi.fn());
vi.mock("./billing/client", async importOriginal => ({
  ...await importOriginal<typeof import("./billing/client")>(),
  stripe: { customers: { create } },
}));
import { getOrCreateCustomer } from "./stripe";

let userId: number;
beforeAll(async () => {
  const { rows: [user] } = await pool.query(
    "INSERT INTO users(display_name,email,password_hash) VALUES($1,$2,'fixture') RETURNING id",
    [`customer_${randomUUID()}`, `${randomUUID()}@example.invalid`]);
  userId = user.id;
});
afterAll(async () => {
  await pool.query("DELETE FROM subscriptions WHERE user_id=$1", [userId]);
  await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
});

describe("M5 customer creation with real database locks", () => {
  it("rechecks after concurrent provider calls and stores one customer row", async () => {
    let bothStarted!: () => void;
    const started = new Promise<void>(resolve => { bothStarted = resolve; });
    let calls = 0;
    create.mockImplementation(async () => {
      const id = `cus_${++calls}`;
      if (calls === 2) bothStarted();
      await started;
      return { id };
    });
    const ids = await Promise.all([
      getOrCreateCustomer(userId, "fixture@example.invalid", null),
      getOrCreateCustomer(userId, "fixture@example.invalid", null),
    ]);
    expect(ids[0]).toBe(ids[1]);
    const { rows } = await pool.query("SELECT stripe_customer_id FROM subscriptions WHERE user_id=$1", [userId]);
    expect(rows).toEqual([{ stripe_customer_id: ids[0] }]);
    expect(await getOrCreateCustomer(userId, "fixture@example.invalid")).toBe(ids[0]);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
