/**
 * Plan limits that live in the database, against the local lane DB: trial codes
 * (never overwrite a paid plan, expire, grant Agency) and CRM seats per plan.
 * Every fixture row is created here and removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { getEntitlements, redeemTrialCode, endRevokedTrial, TRIAL_CODE_PLAN } from "./entitlements";
import { monthlyUsage } from "./growth-quotas";
import { getSeatUsage, getOwnerSeatUsage } from "./crm/tenancy";
import { PLANS } from "@shared/plans";

const users: number[] = [], codes: number[] = [], orgs: string[] = [];
async function account(plan?: string, extra: { status?: string; stripe?: string | null; end?: Date | null; customer?: string } = {}) {
  const { rows: [u] } = await pool.query("insert into users(email) values($1) returning id", [`p-plan-${randomUUID()}@example.invalid`]);
  users.push(u.id);
  if (plan) await pool.query(
    "insert into subscriptions(user_id,plan,status,stripe_subscription_id,stripe_customer_id,current_period_end) values($1,$2,$3,$4,$5,$6)",
    [u.id, plan, extra.status ?? "active", extra.stripe === undefined ? `sub_p_${randomUUID()}` : extra.stripe, extra.customer ?? null, extra.end ?? null]);
  return u.id as number;
}
async function code(trialDays = 2) {
  const { rows: [c] } = await pool.query(
    "insert into beta_access_codes(code,created_by_user_id,trial_days,expires_at) values($1,$2,$3,now()+interval '1 day') returning id,trial_days",
    [`TRIAL-P${randomUUID().slice(0, 8).toUpperCase()}`, users[0] ?? 1, trialDays]);
  codes.push(c.id);
  return { id: c.id as number, trialDays: c.trial_days as number };
}
const sub = async (userId: number) => (await pool.query("select * from subscriptions where user_id=$1", [userId])).rows;
const redeemedBy = async (id: number) => (await pool.query("select redeemed_by_user_id from beta_access_codes where id=$1", [id])).rows[0].redeemed_by_user_id;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/^\/constructhub_dev(?:_a\d+)?$/.test(url.pathname)) throw new Error("Local lane development database required");
});
afterAll(async () => {
  await pool.query("delete from business_locations where user_id=any($1::int[])", [users]);
  await pool.query("delete from crm_orgs where id=any($1::text[])", [orgs]);
  await pool.query("delete from crm_subscriptions where user_id=any($1::int[])", [users]);
  await pool.query("delete from beta_access_codes where id=any($1::int[])", [codes]);
  await pool.query("delete from subscriptions where user_id=any($1::int[])", [users]);
  await pool.query("delete from users where id=any($1::int[])", [users]);
  await pool.end();
});

describe("trial codes", () => {
  it("grant the Agency plan for the trial window, then expire", async () => {
    const user = await account();
    const now = new Date();
    const out = await redeemTrialCode(user, await code(2), now);
    expect("trialEnd" in out && out.trialEnd.getTime()).toBe(now.getTime() + 2 * 86400_000);
    const [row] = await sub(user);
    expect(row).toMatchObject({ plan: TRIAL_CODE_PLAN, status: "trialing", stripe_subscription_id: null });
    const during = await getEntitlements(user);
    expect(during.plan).toBe("agency");
    expect(during.modules.adsManager).toBe(true);
    expect(during.grantEndsAt?.getTime()).toBe(now.getTime() + 2 * 86400_000);
    // Past the end date the grant counts for nothing.
    const after = await getEntitlements(user, new Date(now.getTime() + 2 * 86400_000 + 1000));
    expect(after.plan).toBeNull();
    expect(after.allowances).toBeNull();
    expect(after.modules.agencyWorkspace).toBe(false);
  });

  it("never overwrite a paid subscription or an open-ended grant, and don't burn the code", async () => {
    const paid = await account("pro");
    const c = await code();
    expect(await redeemTrialCode(paid, c)).toMatchObject({ status: 409 });
    expect(await redeemedBy(c.id)).toBeNull();
    expect(await sub(paid)).toMatchObject([{ plan: "pro", status: "active" }]);

    const dunning = await account("growth", { status: "past_due" });
    expect(await redeemTrialCode(dunning, c)).toMatchObject({ status: 409 });
    // A failed payment pauses the plan until it's paid (owner, 2026-10-04); a trial code still can't paper over it.
    expect((await getEntitlements(dunning)).plan).toBeNull();

    const granted = await account("platinum", { stripe: null });
    expect(await redeemTrialCode(granted, c)).toMatchObject({ status: 409 });
    expect(await sub(granted)).toMatchObject([{ plan: "platinum", current_period_end: null }]);
    expect(await redeemedBy(c.id)).toBeNull();
  });

  it("replace an ended Stripe subscription (keeping the customer) and never shorten a live trial", async () => {
    const lapsed = await account("pro", { status: "canceled", customer: "cus_p_fixture" });
    expect("trialEnd" in await redeemTrialCode(lapsed, await code(1))).toBe(true);
    expect(await sub(lapsed)).toMatchObject([{ plan: "agency", status: "trialing", stripe_subscription_id: null, stripe_price_id: null, stripe_customer_id: "cus_p_fixture" }]);

    // What the ended subscription bought doesn't ride along into the trial.
    const expired = await account("pro", { status: "incomplete_expired", customer: "cus_p_fixture2" });
    await pool.query("update subscriptions set addons=$2, billing_interval='year', agency_locations=40 where user_id=$1", [expired, { competitor_pack: 3 }]);
    expect("trialEnd" in await redeemTrialCode(expired, await code(1))).toBe(true);
    expect(await sub(expired)).toMatchObject([{ plan: "agency", status: "trialing", addons: {}, billing_interval: null, agency_locations: null }]);
    expect((await getEntitlements(expired)).allowances?.competitorScans).toBe(50);

    const now = new Date();
    const long = await account();
    await redeemTrialCode(long, await code(14), now);
    const shorter = await redeemTrialCode(long, await code(1), now);
    expect("trialEnd" in shorter && shorter.trialEnd.getTime()).toBe(now.getTime() + 14 * 86400_000);
  });

  it("can be spent once, even when two accounts race for it", async () => {
    const [a, b] = [await account(), await account()];
    const c = await code();
    const results = await Promise.all([redeemTrialCode(a, c), redeemTrialCode(b, c)]);
    expect(results.filter((r) => "trialEnd" in r)).toHaveLength(1);
    expect(results.filter((r) => "refused" in r)).toMatchObject([{ status: 400 }]);
    expect([a, b]).toContain(await redeemedBy(c.id));
  });
});

describe("revoking a trial code ends only the trial it keeps alive", () => {
  const redeemed = async (id: number) => {
    const { rows: [c] } = await pool.query("update beta_access_codes set revoked=true, revoked_at=now() where id=$1 returning id, redeemed_by_user_id, redeemed_at, trial_days", [id]);
    return { id: c.id, redeemedByUserId: c.redeemed_by_user_id, redeemedAt: c.redeemed_at, trialDays: c.trial_days };
  };
  it("ends the trial when no other code covers it, and leaves paid or open-ended plans alone", async () => {
    const user = await account();
    const c = await code(2);
    await redeemTrialCode(user, c);
    expect(await endRevokedTrial(await redeemed(c.id))).toBe("ended");
    expect(await sub(user)).toMatchObject([{ plan: "agency", status: "canceled" }]);
    expect((await getEntitlements(user)).plan).toBeNull();

    const paid = await account("pro");
    const paidCode = await code(2);
    await pool.query("update beta_access_codes set redeemed_by_user_id=$1, redeemed_at=now() where id=$2", [paid, paidCode.id]);
    expect(await endRevokedTrial(await redeemed(paidCode.id))).toBe("unchanged");
    expect(await sub(paid)).toMatchObject([{ plan: "pro", status: "active" }]);
  });

  it("keeps a newer code's trial when an older, finished code is revoked, and cuts back to another live code", async () => {
    const now = new Date();
    const user = await account();
    const old = await code(1);
    await redeemTrialCode(user, old, new Date(now.getTime() - 3 * 86400_000));
    const fresh = await code(2);
    await redeemTrialCode(user, fresh, now);
    expect(await endRevokedTrial(await redeemed(old.id), now)).toBe("unchanged");
    expect((await getEntitlements(user, now)).plan).toBe("agency");

    const other = await account();
    const long = await code(14), short = await code(1);
    await redeemTrialCode(other, long, now);
    await redeemTrialCode(other, short, now);
    expect(await endRevokedTrial(await redeemed(long.id), now)).toBe("shortened");
    const [row] = await sub(other);
    expect(new Date(row.current_period_end).getTime()).toBe(now.getTime() + 86400_000);
    expect(row.status).toBe("trialing");
  });
});

describe("Agency monthly allowances are flat, not per-location", () => {
  it("reads the plan's flat limits from the stored row, raises them with an add-on, and drops them when the plan lapses", async () => {
    const owner = await account("agency");
    // 12 linked Business Profile locations among 40 rows — linked locations multiply nothing anymore.
    await pool.query(
      `insert into business_locations(user_id,business_name,gbp_location_name)
       select $1::int,'P-billed '||i, case when i<=12 then 'locations/p-billed-'||$1::int||'-'||i end from generate_series(1,40) i`, [owner]);
    const usage: any = await monthlyUsage(owner, await getEntitlements(owner));
    expect(usage.rankings.limit).toBe(150); // Unlimited's flat grid credits
    expect(usage.siteScans.limit).toBe(-1); // unlimited Site Scans
    // An add-on raises the flat allowance.
    await pool.query("update subscriptions set addons=$2 where user_id=$1", [owner, { grid_pack: 2 }]);
    const raised: any = await monthlyUsage(owner, await getEntitlements(owner));
    expect(raised.rankings.limit).toBe(170);
    // A lapsed plan loses the allowances.
    await pool.query("update subscriptions set status='canceled' where user_id=$1", [owner]);
    const lapsed: any = await monthlyUsage(owner, await getEntitlements(owner));
    expect(lapsed.rankings.limit).toBe(0);
    expect(lapsed.siteScans.limit).toBe(0);
  });
});

describe("CRM seats follow the owner's CRM plan", () => {
  const org = async (owner: number) => {
    const { rows: [o] } = await pool.query("insert into crm_orgs(name,owner_user_id) values('P-seat fixture',$1) returning *", [owner]);
    orgs.push(o.id);
    return { ...o, ownerUserId: o.owner_user_id };
  };
  const crmSub = async (owner: number, plan: string, extra: { status?: string; extraSeats?: number } = {}) => pool.query(
    "insert into crm_subscriptions(user_id,plan,status,extra_seats) values($1,$2,$3,$4) on conflict (user_id) do update set plan=$2,status=$3,extra_seats=$4",
    [owner, plan, extra.status ?? "active", extra.extraSeats ?? 0]);
  it("reads CRM seats from the stored CRM row, and Extra seats raise them", async () => {
    // The CRM is a separate product: seats come from the CRM subscription (shared/crm-plans.ts), never the platform plan.
    const basic = await account("starter");
    await crmSub(basic, "crm_basic");
    expect(await getSeatUsage(await org(basic))).toMatchObject({ plan: "crm_basic", planName: "CRM Basic", limit: 1, canAddSeat: true });
    const boosted = await account("starter");
    await crmSub(boosted, "crm_basic", { extraSeats: 2 });
    expect((await getSeatUsage(await org(boosted))).limit).toBe(3);
    // A stored platform plan key is not a CRM plan key: no CRM seats from it.
    const legacy = await account("pro");
    await crmSub(legacy, "premium");
    expect((await getSeatUsage(await org(legacy))).limit).toBe(0);
  });

  it("keeps the CRM seat pool separate from the platform team seats", async () => {
    // Pools are separate by design (owner, 2026-10-07): the CRM pool is the CRM plan's seats
    // ONLY — a platform plan's agencySeats never enter it, not even on Agency or Unlimited.
    const growth = await account("growth");
    await crmSub(growth, "crm_basic");
    expect(await getSeatUsage(await org(growth))).toMatchObject({ plan: "crm_basic", planName: "CRM Basic", limit: 1 });
    // Unlimited's platform agencySeats are -1; the CRM pool still has just the CRM plan's seat.
    const unlimited = await account("agency");
    await crmSub(unlimited, "crm_basic");
    expect((await getSeatUsage(await org(unlimited))).limit).toBe(1);
    // The platform pool answers separately: the owner's platform team seats, never CRM seats.
    expect((await getOwnerSeatUsage(growth, { product: "platform" })).limit).toBe(PLANS.growth.limits.agencySeats);
    expect((await getOwnerSeatUsage(unlimited, { product: "platform" })).limit).toBe(-1);
  });

  it("one seat message without any plan, and an expired CRM grant drops its seats", async () => {
    const none = await getSeatUsage(await org(await account()));
    expect(none).toMatchObject({ plan: "none", limit: 0 });
    expect(none.message).toContain("The ConstructHUB CRM is a separate subscription");
    // A canceled CRM plan drops its seats; the platform plan's agencySeats stay in the platform pool.
    const lapsed = await account("growth");
    await crmSub(lapsed, "crm_essentials", { status: "canceled" });
    expect((await getSeatUsage(await org(lapsed))).limit).toBe(0);
    expect((await getOwnerSeatUsage(lapsed, { product: "platform" })).limit).toBe(PLANS.growth.limits.agencySeats);
  });

  it("keeps beta owners unlimited", async () => {
    const owner = await account("starter");
    await pool.query("update users set beta_at=now() where id=$1", [owner]);
    expect(await getSeatUsage(await org(owner))).toMatchObject({ plan: "beta", limit: -1, canAddSeat: true });
  });
});
