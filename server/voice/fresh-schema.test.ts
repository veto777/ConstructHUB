/**
 * The voice schema on an EMPTY database (Codex audit #5): every DDL statement
 * runs in order on a database that has none of the tables — the claims table's
 * CREATE is self-contained, the constraints come after the columns they name,
 * and metering one call end to end works right after. A throwaway database
 * is created beside the lane DB (its user is a superuser there) and dropped at
 * the end; the lane DB itself is never touched. Entitlements are a fixture:
 * the meter's only outside read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy_for_module_import";
process.env.DATABASE_URL = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://constructhub_dev:crmdev_local_only@127.0.0.1:5432/constructhub_dev";

const ENT = {
  isPlatformAdmin: false,
  addonModules: { callAssistant: true },
  addonModulesPaused: { callAssistant: false },
  addons: { call_assistant: 1 },
  storedAddons: { call_assistant: 1 },
  callAssistant: { status: "active", tier: "solo", extraNumbers: 0, addons: { call_assistant: 1 }, interval: "month", currentPeriodEnd: null, cancelAtPeriodEnd: false, stripeSubscriptionId: "sub_fresh" },
};
vi.mock("../entitlements", async (importOriginal) => ({ ...(await importOriginal<typeof import("../entitlements")>()), getEntitlements: async () => ENT as any }));

import { ensureVoiceSchema, VOICE_SCHEMA_DDL } from "./schema";
import { CALL_ASSISTANT_SUBSCRIPTION_DDL } from "./subscription-store";
import { meterVoiceCall, retryPendingVoiceMeters, getVoiceUsageRow } from "./billing-usage";

describe("the voice schema created on an empty database, then one call metered (lane server, throwaway database)", () => {
  const laneUrl = new URL(process.env.DATABASE_URL!);
  const name = `constructhub_dev_a${100 + Math.floor(Math.random() * 900)}`;
  const adminUrl = new URL(laneUrl.href); adminUrl.pathname = "/postgres";
  const freshUrl = new URL(laneUrl.href); freshUrl.pathname = `/${name}`;
  let admin: pg.Pool, fresh: pg.Pool;

  beforeAll(async () => {
    if (!/^\/constructhub_dev(?:_a\d+)?$/.test(laneUrl.pathname)) throw new Error("Requires a ConstructHUB development lane DB");
    admin = new pg.Pool({ connectionString: adminUrl.href });
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
    fresh = new pg.Pool({ connectionString: freshUrl.href });
  });
  afterAll(async () => {
    await fresh?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin?.end();
  });

  it("every statement runs on an empty database, in order, and every table, column and constraint the billing code needs is there", async () => {
    await ensureVoiceSchema(fresh);
    for (const ddl of CALL_ASSISTANT_SUBSCRIPTION_DDL) await fresh.query(ddl);
    const tables = (await fresh.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename);
    for (const t of ["voice_usage", "voice_overage_claims", "voice_settle_jobs", "voice_call_meter", "call_assistant_subscriptions", "call_assistant_checkout_attempts", "call_assistant_duplicate_cancellations"]) {
      expect(tables, t).toContain(t);
    }
    const columns = async (table: string) => (await fresh.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [table])).rows.map((r) => r.column_name);
    expect(await columns("voice_usage")).toContain("stripe_subscription_id");
    for (const c of ["minutes", "claim_uid", "billed_on_customer", "lease_token", "idempotency_key", "attempts"]) expect(await columns("voice_overage_claims"), c).toContain(c);
    for (const c of ["leased_until", "lease_token"]) expect(await columns("voice_settle_jobs"), c).toContain(c);
    const constraints = (await fresh.query("SELECT conname FROM pg_constraint WHERE conrelid = 'voice_overage_claims'::regclass ORDER BY conname")).rows.map((r) => r.conname);
    for (const c of ["voice_overage_claims_range_check", "voice_overage_claims_rate_check", "voice_overage_claims_minutes_check"]) expect(constraints, c).toContain(c);
    // The EXCLUDE constraint needs btree_gist: this database's user is a superuser, so it is in place here.
    expect(constraints).toContain("voice_overage_claims_no_overlap");
    // Running it all again changes nothing (idempotent).
    await ensureVoiceSchema(fresh);
    for (const ddl of CALL_ASSISTANT_SUBSCRIPTION_DDL) await fresh.query(ddl);
    expect(VOICE_SCHEMA_DDL.length).toBeGreaterThan(10);
  });

  it("one call is metered end to end on the fresh schema — exactly once, with the subscription it was under", async () => {
    const at = new Date("2001-05-10T12:00:00Z");
    const row = await meterVoiceCall({ callId: "call-fresh-1", orgId: "org-fresh", accountUserId: 7, outcome: "info", billedMinutes: 3, at }, fresh as any);
    expect(row).toMatchObject({ orgId: "org-fresh", accountUserId: 7, month: "2001-05", calls: 1, minutes: 3, includedMinutes: 1000, overageMinutes: 0, stripeSubscriptionId: "sub_fresh" });
    // The same call reported again counts nothing again.
    expect(await meterVoiceCall({ callId: "call-fresh-1", orgId: "org-fresh", accountUserId: 7, outcome: "info", billedMinutes: 3, at }, fresh as any)).toMatchObject({ calls: 1, minutes: 3 });
    expect((await fresh.query("SELECT state, attempts FROM voice_call_meter WHERE call_id = 'call-fresh-1'")).rows[0]).toEqual({ state: "done", attempts: 1 });
    expect(await retryPendingVoiceMeters(fresh as any)).toEqual({ pending: 0, metered: 0, failed: 0 });
    expect(await getVoiceUsageRow("org-fresh", "2001-05", fresh)).toMatchObject({ calls: 1, minutes: 3 });
  });
});
