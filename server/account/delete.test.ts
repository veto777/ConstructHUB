/**
 * Self-serve account deletion, step 1 (closing) — server/account/delete.ts. Function-level on throwaway users only:
 * nothing here goes through the dev-bypass HTTP user.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { ensureAccountSchema } from "./schema";
import { closeAccount, deletionBlockers, ensureAccountDeletionSchema, fromNativeApp } from "./delete";

const users: number[] = [];
const orgs: string[] = [];
async function user(): Promise<{ id: number; email: string }> {
  const email = `acct-delete-${randomUUID()}@example.invalid`;
  const { rows: [u] } = await pool.query("INSERT INTO users(email, password_hash, display_name) VALUES($1, 'x', 'Del Test') RETURNING id", [email]);
  users.push(u.id);
  return { id: u.id, email };
}

beforeAll(async () => {
  await ensureAccountSchema();
  await ensureAccountDeletionSchema();
});
afterAll(async () => {
  await pool.query("DELETE FROM crm_members WHERE org_id = ANY($1::text[])", [orgs]);
  await pool.query("DELETE FROM crm_orgs WHERE id = ANY($1::text[])", [orgs]);
  await pool.query("DELETE FROM subscriptions WHERE user_id = ANY($1::int[])", [users]);
  await pool.query("DELETE FROM email_log WHERE user_id = ANY($1::int[])", [users]);
  await pool.query("DELETE FROM session WHERE sess->'passport'->>'user' = ANY($1::text[])", [users.map(String)]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [users]);
});

describe("closing an account (App Store 5.1.1(v))", () => {
  it("cancels billing first, frees the email, clears sign-in, ends every session", async () => {
    const u = await user();
    const subId = `sub_test_${randomUUID().slice(0, 8)}`;
    await pool.query("INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id) VALUES($1, 'pro', 'active', $2)", [u.id, subId]);
    await pool.query(`INSERT INTO session(sid, sess, expire) VALUES($1, $2::json, now() + interval '1 day')`,
      [`del-${randomUUID()}`, JSON.stringify({ cookie: {}, passport: { user: u.id } })]);
    const cancelled: string[] = [];
    const r = await closeAccount(u.id, { cancelSubscription: async (id) => { cancelled.push(id); } });
    expect(r).toMatchObject({ ok: true, cancelledSubscriptions: 1 });
    expect(cancelled).toEqual([subId]);
    const { rows: [row] } = await pool.query("SELECT * FROM users WHERE id = $1", [u.id]);
    expect(row.deletion_requested_at).not.toBeNull();
    expect(row.deleted_email).toBe(u.email);
    expect(row.email).toMatch(/^deleted\+\d+\.\d+@deleted\.constructhub\.invalid$/);
    expect(row).toMatchObject({ password_hash: null, google_id: null, display_name: null });
    expect((await pool.query("SELECT status FROM subscriptions WHERE user_id = $1", [u.id])).rows[0].status).toBe("canceled");
    expect((await pool.query("SELECT count(*)::int n FROM session WHERE sess->'passport'->>'user' = $1", [String(u.id)])).rows[0].n).toBe(0);
    // The address is free to sign up again.
    const { rows: [again] } = await pool.query("INSERT INTO users(email) VALUES($1) RETURNING id", [u.email]);
    users.push(again.id);
    // Closing twice is refused.
    expect(await closeAccount(u.id)).toMatchObject({ ok: false, code: "already_closed" });
  });

  it("a failed Stripe cancel changes nothing", async () => {
    const u = await user();
    await pool.query("INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id) VALUES($1, 'pro', 'active', $2)", [u.id, `sub_test_${randomUUID().slice(0, 8)}`]);
    const r = await closeAccount(u.id, { cancelSubscription: async () => { throw new Error("card network down"); } });
    expect(r).toMatchObject({ ok: false, status: 502, code: "billing_cancel_failed" });
    const { rows: [row] } = await pool.query("SELECT email, deletion_requested_at FROM users WHERE id = $1", [u.id]);
    expect(row).toMatchObject({ email: u.email, deletion_requested_at: null });
  });

  it("refuses while a CRM workspace it owns still has other active members", async () => {
    const owner = await user();
    const crew = await user();
    const { rows: [org] } = await pool.query("INSERT INTO crm_orgs(name, owner_user_id) VALUES('Del Test Roofing', $1) RETURNING id", [owner.id]);
    orgs.push(String(org.id));
    await pool.query("INSERT INTO crm_members(org_id, user_id, email, role, status) VALUES($1, $2, $3, 'owner', 'active'), ($1, $4, $5, 'field', 'active')",
      [org.id, owner.id, owner.email, crew.id, crew.email]);
    expect(await deletionBlockers(owner.id)).toEqual([{ kind: "crm_team", orgId: String(org.id), orgName: "Del Test Roofing", members: 1 }]);
    expect(await closeAccount(owner.id, { cancelSubscription: async () => {} })).toMatchObject({ ok: false, status: 409, code: "crm_team" });
    // The crew member (not an owner) can always close their own account.
    expect(await deletionBlockers(crew.id)).toEqual([]);
  });

  it("only the iPhone apps may delete (owner: the website keeps the support request)", () => {
    expect(fromNativeApp({ headers: { "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit/605 ConstructHUBApp/1.0" } })).toBe(true);
    expect(fromNativeApp({ headers: { "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit/605 ConstructHUBCRM/1.0" } })).toBe(true);
    expect(fromNativeApp({ headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" } })).toBe(false);
    expect(fromNativeApp({ headers: {} })).toBe(false);
  });
});

describe("erasing a closed account (step 2)", () => {
  it("erases its data, its own CRM workspace and files; keeps payment records; dry run changes nothing", async () => {
    const { eraseClosedAccount } = await import("./erase");
    const u = await user();
    const tag = randomUUID().slice(0, 8);
    const { rows: [loc] } = await pool.query("INSERT INTO business_locations(user_id, business_name) VALUES($1, 'Erase Test Co') RETURNING id", [u.id]);
    await pool.query("INSERT INTO location_analytics(location_id, date) VALUES($1, '2026-10-01')", [loc.id]);
    const { rows: [dom] } = await pool.query("INSERT INTO tracked_domains(user_id, domain, tracking_id) VALUES($1, $2, $3) RETURNING id", [u.id, `erase-${tag}.example`, `trk-${tag}`]);
    await pool.query("INSERT INTO click_visits(domain_id, ip_address) VALUES($1, '198.51.100.7')", [dom.id]);
    const { rows: [org] } = await pool.query("INSERT INTO crm_orgs(name, owner_user_id) VALUES('Erase Test Roofing', $1) RETURNING id", [u.id]);
    orgs.push(String(org.id));
    await pool.query("INSERT INTO crm_members(org_id, user_id, email, role, status) VALUES($1, $2, $3, 'owner', 'active')", [org.id, u.id, u.email]);
    const { rows: [cust] } = await pool.query("INSERT INTO crm_customers(org_id, display_name, portal_token) VALUES($1, 'Homeowner', $2) RETURNING id", [org.id, `pt-${tag}`]);
    await pool.query("INSERT INTO crm_estimates(org_id, customer_id, public_token) VALUES($1, $2, $3)", [org.id, cust.id, `et-${tag}`]);
    await pool.query("INSERT INTO voice_calls(org_id, call_sid, recording_key) VALUES($1, $2, $3)", [org.id, `CAerase${tag}`, `voice/${org.id}/CAerase${tag}.wav`]);
    await pool.query("INSERT INTO subscriptions(user_id, plan, status, stripe_subscription_id) VALUES($1, 'pro', 'active', $2)", [u.id, `sub_erase_${tag}`]);
    expect(await closeAccount(u.id, { cancelSubscription: async () => {} })).toMatchObject({ ok: true });

    // Not due yet (30 days), then a dry run that rolls back.
    expect((await eraseClosedAccount(u.id)).status).toBe("not_due");
    const dry = await eraseClosedAccount(u.id, { ignoreWait: true, dryRun: true });
    expect(dry).toMatchObject({ status: "dry_run", files: 1 });
    expect(dry.rows).toMatchObject({ users: 1, crm_orgs: 1, crm_customers: 1, crm_estimates: 1, voice_calls: 1, business_locations: 1, tracked_domains: 1 });
    expect((await pool.query("SELECT count(*)::int n FROM users WHERE id = $1", [u.id])).rows[0].n).toBe(1);

    const deleted: string[] = [];
    const done = await eraseClosedAccount(u.id, { ignoreWait: true, deleteObject: async (k) => { deleted.push(k); } });
    expect(done.status).toBe("erased");
    expect(deleted).toEqual([`voice/${org.id}/CAerase${tag}.wav`]);
    const count = async (sql: string, v: unknown[]) => (await pool.query(sql, v)).rows[0].n;
    expect(await count("SELECT count(*)::int n FROM users WHERE id = $1", [u.id])).toBe(0);
    expect(await count("SELECT count(*)::int n FROM crm_orgs WHERE id = $1", [org.id])).toBe(0);
    expect(await count("SELECT count(*)::int n FROM crm_customers WHERE org_id = $1", [org.id])).toBe(0);
    expect(await count("SELECT count(*)::int n FROM location_analytics WHERE location_id = $1", [loc.id])).toBe(0);
    expect(await count("SELECT count(*)::int n FROM click_visits WHERE domain_id = $1", [dom.id])).toBe(0);
    // Payment records stay (the privacy policy's 7 years), with no user row left to name anyone.
    expect(await count("SELECT count(*)::int n FROM subscriptions WHERE user_id = $1", [u.id])).toBe(1);
  });
});
