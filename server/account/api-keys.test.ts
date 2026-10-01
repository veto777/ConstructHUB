/**
 * Public API keys against the local lane DB: token shape, hashing, verify
 * (tamper / revoked / expired), ownership, metering and the monthly window.
 * Every fixture row carries the ACCT- prefix and is removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureAccountSchema } from "./schema";
import {
  API_KEY_TOKEN_RE, ApiKeyInputError, apiMonthResetsAt, apiMonthStart, createApiKey, getApiKey, listApiKeys, looksLikeApiKey,
  monthlyUsage, parseApiKeyToken, recordUnits, revokeApiKey, serializeApiKey, unitsThisMonth, updateApiKey, usageByDay, usageDay, verifyApiKey,
} from "./api-keys";

const users: number[] = [];
async function account() {
  const { rows: [u] } = await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`acct-l1-keys-${randomUUID()}@example.invalid`]);
  users.push(u.id);
  return u.id as number;
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Local lane development database required");
  await ensureAccountSchema();
});
afterAll(async () => {
  await pool.query("DELETE FROM account_api_usage WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM account_api_keys WHERE user_id=ANY($1::int[])", [users]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
});

describe("createApiKey", () => {
  it("mints chub_<prefix>_<secret>, stores only a hash, and normalises the input", async () => {
    const uid = await account();
    const { secret, row } = await createApiKey(uid, { name: "  ACCT-Zapier  ", scopes: ["write", "read", "write"], monthlyUnitLimit: 500, expiresInDays: 30 });
    expect(secret).toMatch(API_KEY_TOKEN_RE);
    expect(row.id).toMatch(/^key_[a-f0-9]{24}$/);
    expect(row.name).toBe("ACCT-Zapier");
    expect(row.scopes).toEqual(["read", "write"]);
    expect(row.prefix).toBe(secret.split("_")[1]);
    expect(row.suffix).toBe(secret.slice(-4));
    expect(row.monthlyUnitLimit).toBe(500);
    expect(row.expiresAt && new Date(row.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(row).not.toHaveProperty("secretHash");
    const { rows: [stored] } = await pool.query("SELECT * FROM account_api_keys WHERE id=$1", [row.id]);
    expect(stored.secret_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(secret.split("_")[2]);
  });

  it("refuses bad input with a 400-class error", async () => {
    const uid = await account();
    for (const input of [
      { name: "", scopes: ["read"] },
      { name: "x".repeat(81), scopes: ["read"] },
      { name: "ACCT-k", scopes: [] },
      { name: "ACCT-k", scopes: ["admin"] },
      { name: "ACCT-k", scopes: ["read"], monthlyUnitLimit: 0 },
      { name: "ACCT-k", scopes: ["read"], monthlyUnitLimit: 1.5 },
      { name: "ACCT-k", scopes: ["read"], expiresInDays: 0 },
      { name: "ACCT-k", scopes: ["read"], expiresInDays: 4000 },
    ]) {
      const err = await createApiKey(uid, input as any).catch((e) => e);
      expect(err, JSON.stringify(input)).toBeInstanceOf(ApiKeyInputError);
      expect(err.status).toBe(400);
    }
    expect(await listApiKeys(uid)).toEqual([]);
  });
});

describe("verifyApiKey", () => {
  it("resolves a live key (with or without the Bearer prefix) and nothing else", async () => {
    const uid = await account();
    const { secret, row } = await createApiKey(uid, { name: "ACCT-verify", scopes: ["read"] });
    expect((await verifyApiKey(secret))?.id).toBe(row.id);
    expect((await verifyApiKey(`Bearer ${secret}`))?.id).toBe(row.id);
    expect((await verifyApiKey(`bearer   ${secret}`))?.id).toBe(row.id);
    const tampered = secret.slice(0, -1) + (secret.endsWith("0") ? "1" : "0");
    expect(await verifyApiKey(tampered)).toBeNull();
    expect(await verifyApiKey(`chub_zzzzzzzz_${secret.split("_")[2]}`)).toBeNull();
    expect(await verifyApiKey("chk_abcdef0123456789")).toBeNull();
    expect(await verifyApiKey("")).toBeNull();
    expect(await verifyApiKey(undefined)).toBeNull();
    expect(parseApiKeyToken("Bearer chub_short")).toBeNull();
    expect(looksLikeApiKey("Bearer chub_short")).toBe(true);
    expect(looksLikeApiKey("Bearer chk_x")).toBe(false);
  });

  it("stamps last_used_at on success", async () => {
    const uid = await account();
    const { secret, row } = await createApiKey(uid, { name: "ACCT-used", scopes: ["read"] });
    expect(row.lastUsedAt).toBeNull();
    await verifyApiKey(secret);
    await new Promise((r) => setTimeout(r, 50));
    expect((await getApiKey(uid, row.id))?.lastUsedAt).toBeTruthy();
  });

  it("returns null for revoked and expired keys", async () => {
    const uid = await account();
    const live = await createApiKey(uid, { name: "ACCT-revoke", scopes: ["read"] });
    expect(await revokeApiKey(uid, live.row.id)).toBe(true);
    expect(await revokeApiKey(uid, live.row.id)).toBe(false);
    expect(await verifyApiKey(live.secret)).toBeNull();
    expect((await listApiKeys(uid)).map((k) => k.id)).not.toContain(live.row.id);
    const expiring = await createApiKey(uid, { name: "ACCT-expire", scopes: ["read"], expiresInDays: 1 });
    expect((await verifyApiKey(expiring.secret))?.id).toBe(expiring.row.id);
    expect(await verifyApiKey(expiring.secret, new Date(Date.now() + 2 * 86_400_000))).toBeNull();
  });
});

describe("ownership", () => {
  it("lists, renames, re-caps and revokes only the owner's keys", async () => {
    const owner = await account(), other = await account();
    const { row } = await createApiKey(owner, { name: "ACCT-mine", scopes: ["read"] });
    expect((await listApiKeys(owner)).map((k) => k.id)).toEqual([row.id]);
    expect(await listApiKeys(other)).toEqual([]);
    expect(await getApiKey(other, row.id)).toBeNull();
    expect(await updateApiKey(other, row.id, { name: "stolen" })).toBeNull();
    expect(await revokeApiKey(other, row.id)).toBe(false);
    const renamed = await updateApiKey(owner, row.id, { name: "ACCT-renamed", monthlyUnitLimit: 42 });
    expect(renamed).toMatchObject({ id: row.id, name: "ACCT-renamed", monthlyUnitLimit: 42 });
    expect((await updateApiKey(owner, row.id, { monthlyUnitLimit: null }))?.monthlyUnitLimit).toBeNull();
    await expect(updateApiKey(owner, row.id, { name: "" })).rejects.toBeInstanceOf(ApiKeyInputError);
    expect((await updateApiKey(owner, row.id, {}))?.name).toBe("ACCT-renamed");
    expect(serializeApiKey(renamed!, 7)).toEqual({
      id: row.id, name: "ACCT-renamed", prefix: row.prefix, suffix: row.suffix, scopes: ["read"], monthlyUnitLimit: 42,
      unitsThisMonth: 7, createdAt: new Date(row.createdAt).toISOString(), lastUsedAt: null, expiresAt: null,
    });
  });
});

describe("metering", () => {
  it("accumulates units per key and per account, only inside the current UTC month", async () => {
    const uid = await account();
    const a = await createApiKey(uid, { name: "ACCT-a", scopes: ["read"] });
    const b = await createApiKey(uid, { name: "ACCT-b", scopes: ["read"] });
    await recordUnits(a.row.id, uid, 3);
    await recordUnits(a.row.id, uid, 4);
    await recordUnits(b.row.id, uid, 10, 2);
    await recordUnits(b.row.id, uid, 0, 0); // a no-op
    expect(await unitsThisMonth(a.row.id)).toBe(7);
    expect(await unitsThisMonth(b.row.id)).toBe(10);
    expect(await unitsThisMonth(uid)).toBe(17);
    expect(await monthlyUsage(a.row.id, uid)).toEqual({ key: 7, user: 17 });
    const { rows: [today] } = await pool.query("SELECT units, requests, to_char(day,'YYYY-MM-DD') AS day FROM account_api_usage WHERE key_id=$1", [a.row.id]);
    expect(today).toEqual({ units: 7, requests: 2, day: usageDay() });
    // Last month's row is outside the window.
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15));
    await recordUnits(a.row.id, uid, 1000, 1, lastMonth);
    expect(await unitsThisMonth(a.row.id)).toBe(7);
    expect(await unitsThisMonth(uid)).toBe(17);
    // The window is open-ended ("since the 1st of that month"), so asked as of last month it includes today's 7.
    expect(await unitsThisMonth(a.row.id, lastMonth)).toBe(1007);
    const usage = await usageByDay(uid, 7);
    expect(usage.days).toHaveLength(7);
    expect(usage.days.at(-1)).toEqual({ date: usageDay(), units: 17, requests: 4, byKey: { [a.row.id]: 7, [b.row.id]: 10 } });
    expect(usage.totals).toEqual({ units: 17, requests: 4 });
  });

  it("knows where the month starts and resets", () => {
    const d = new Date("2026-09-30T23:59:59Z");
    expect(apiMonthStart(d)).toBe("2026-09-01");
    expect(apiMonthResetsAt(d)).toBe("2026-10-01T00:00:00.000Z");
    expect(apiMonthResetsAt(new Date("2026-12-05T00:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
    expect(usageDay(d)).toBe("2026-09-30");
  });
});
