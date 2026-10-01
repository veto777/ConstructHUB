/**
 * Welcome email on the real sign-up path, against the running dev server:
 * POST /api/auth/signup → the verification link from the database →
 * GET /api/auth/verify-email → exactly one welcome email in the mail sink
 * (the target server's tmp/email-outbox.jsonl; EMAIL_FORCE_SINK=1 on the dev
 * server — point EMAIL_OUTBOX_FILE at it when it runs from another checkout) and one
 * email_log claim. A second welcome for the same account is refused.
 *
 *   DATABASE_URL=… EMAIL_FORCE_SINK=1 PORT=8333 npx tsx server/index.ts
 * Override the target with CRM_TEST_BASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sendWelcomeEmail } from "./billing-emails";
import { pool as appPool } from "../db";

const BASE = process.env.CRM_TEST_BASE_URL ?? "http://127.0.0.1:8119";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";
// The sink file the TARGET server writes (EMAIL_FORCE_SINK=1) — its own cwd's
// tmp/, which need not be this checkout (a shared dev server runs elsewhere).
const OUTBOX = process.env.EMAIL_OUTBOX_FILE ?? path.join(process.cwd(), "tmp", "email-outbox.jsonl");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const email = `welcome-${randomUUID()}@example.invalid`;
let userId: number | null = null;

const outboxFor = (to: string) => {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => (m.to ?? []).includes(to));
};
const until = async (check: () => Promise<boolean>, ms = 8000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return check();
};

beforeAll(async () => {
  const url = new URL(DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) {
    throw new Error("Requires a local ConstructHUB development database");
  }
  const r = await fetch(`${BASE}/api/stripe/plans`);
  expect(r.status, `dev server reachable at ${BASE}`).toBe(200);
});
afterAll(async () => {
  if (userId) {
    await pool.query("DELETE FROM email_log WHERE user_id = $1", [userId]).catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  await pool.end();
  await appPool.end();
});

describe("welcome email on sign-up verification", () => {
  it("sends one welcome email when the verification link is used, and never a second", async () => {
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "fixture-password-123", displayName: "Welcome Fixture" }),
    });
    expect(signup.status, await signup.clone().text()).toBe(200);
    userId = (await signup.json()).userId;
    expect(userId).toBeTypeOf("number");

    // Sign-up alone sends only the verification email — no welcome yet.
    expect(outboxFor(email).filter((m) => /welcome/i.test(m.subject))).toHaveLength(0);
    const { rows: [row] } = await pool.query("SELECT verification_token FROM users WHERE id = $1", [userId]);
    expect(row.verification_token).toBeTruthy();

    const verify = await fetch(`${BASE}/api/auth/verify-email?token=${row.verification_token}`, { redirect: "manual" });
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe("/?auth=verified");

    expect(await until(async () => (await pool.query("SELECT 1 FROM email_log WHERE user_id = $1 AND kind = 'welcome'", [userId])).rowCount === 1)).toBe(true);
    expect(await until(async () => outboxFor(email).some((m) => /welcome/i.test(m.subject)))).toBe(true);
    const welcome = outboxFor(email).filter((m) => /welcome/i.test(m.subject));
    expect(welcome).toHaveLength(1);
    expect(welcome[0].subject).toBe("Welcome to ConstructHUB, Welcome Fixture");
    expect(welcome[0].html).toContain("/pricing");
    expect(welcome[0].html).toContain("/settings?tab=security");
    expect(welcome[0].text).toContain("1. Choose a plan");

    // A used link is dead, and the dedupe refuses a second welcome outright.
    const again = await fetch(`${BASE}/api/auth/verify-email?token=${row.verification_token}`, { redirect: "manual" });
    expect(again.headers.get("location")).toBe("/auth?error=invalid-token");
    expect(await sendWelcomeEmail(userId!, BASE)).toBe(false);
    expect(outboxFor(email).filter((m) => /welcome/i.test(m.subject))).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int n FROM email_log WHERE user_id = $1", [userId])).rows[0].n).toBe(1);
  });
});
