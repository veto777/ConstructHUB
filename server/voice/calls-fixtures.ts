/**
 * Test-only fixtures for the calls+crm lane's suites (calls.test.ts,
 * leads.test.ts, spam.test.ts, escalations.test.ts). OWNER: calls+crm lane.
 * Never imported by app code. Plain `pg` so a suite can build rows before the
 * app modules (which read DATABASE_URL at import) are loaded.
 *
 * Every row is tagged so cleanup() removes exactly what a suite made:
 * users/orgs are tracked in the `Made` bag, numbers use the 555-01xx fiction
 * range with random digits.
 */
import type pg from "pg";
import { randomInt, randomUUID } from "node:crypto";
import { voiceProfileSchema, defaultVoiceProfile } from "@shared/voice-profile";

export type Made = { users: number[]; orgs: string[] };
export const made = (): Made => ({ users: [], orgs: [] });

export type Account = { userId: number; orgId: string; memberId: string; email: string; ownerPhone: string };

/** +1 555 01xx xxxx — fiction-range numbers that never ring anyone. */
export function fakePhone(): string {
  return `+1555${String(randomInt(100, 199)).padStart(3, "0")}${String(randomInt(0, 10000)).padStart(4, "0")}`;
}

/**
 * A paying account: user + platform subscription (plan) + the Call Assistant's
 * own subscription (a separate service, server/voice/subscription-store.ts;
 * `addon: false` leaves it out) + CRM org + active owner member with a mobile.
 */
export async function makeAccount(pool: pg.Pool, bag: Made, opts: {
  plan?: string | null; addon?: boolean; orgName?: string; customFields?: Record<string, unknown>; timezone?: string;
} = {}): Promise<Account> {
  const email = `voice-calls-${randomUUID()}@example.invalid`;
  const { rows: [u] } = await pool.query("insert into users(email, display_name, email_verified) values ($1, 'Voice lane owner', true) returning id", [email]);
  bag.users.push(u.id);
  const plan = opts.plan === undefined ? "pro" : opts.plan;
  if (plan) {
    await pool.query(
      "insert into subscriptions(user_id, plan, status, stripe_subscription_id, addons) values ($1, $2, 'active', $3, '{}'::jsonb)",
      [u.id, plan, `sub_voice_${randomUUID()}`],
    );
  }
  if (opts.addon !== false) {
    await pool.query(
      "insert into call_assistant_subscriptions(user_id, tier, extra_numbers, status, stripe_subscription_id, stripe_customer_id, billing_interval) values ($1, 'solo', 0, 'active', $2, $3, 'month')",
      [u.id, `sub_voiceca_${randomUUID()}`, `cus_voiceca_${randomUUID()}`],
    );
  }
  const { rows: [org] } = await pool.query(
    "insert into crm_orgs(name, owner_user_id, custom_fields, timezone) values ($1, $2, $3::jsonb, $4) returning id",
    [opts.orgName ?? "Vitest Siding Co", u.id, JSON.stringify(opts.customFields ?? {}), opts.timezone ?? "UTC"],
  );
  bag.orgs.push(org.id);
  const ownerPhone = fakePhone();
  const { rows: [m] } = await pool.query(
    "insert into crm_members(org_id, user_id, email, role, status, phone, display_name) values ($1, $2, $3, 'owner', 'active', $4, 'Owner Olive') returning id",
    [org.id, u.id, email, ownerPhone],
  );
  return { userId: u.id, orgId: org.id, memberId: m.id, email, ownerPhone };
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);
function deepMerge(base: Plain, patch: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && isPlain(base[k]) ? deepMerge(base[k] as Plain, v) : v;
  return out;
}

/** A live published profile (the Studio's output) for the org: the CRM default with `patch` merged in. */
export async function setProfile(pool: pg.Pool, orgId: string, patch: Plain): Promise<void> {
  const base = defaultVoiceProfile({ name: String((patch.company as Plain | undefined)?.name ?? "Vitest Siding Co") }) as unknown as Plain;
  const profile = voiceProfileSchema.parse(deepMerge(base, patch));
  await pool.query(
    `insert into voice_profiles(org_id, profile, published_profile, published_version, status)
     values ($1, $2::jsonb, $2::jsonb, 1, 'live')
     on conflict (org_id) do update set profile = excluded.profile, published_profile = excluded.published_profile, published_version = 1, status = 'live'`,
    [orgId, JSON.stringify(profile)],
  );
}

export async function makeNumber(pool: pg.Pool, orgId: string, label = "Main line"): Promise<{ id: string; phoneNumber: string }> {
  const phoneNumber = fakePhone();
  const { rows: [n] } = await pool.query(
    "insert into voice_numbers(org_id, phone_number, label, state, status) values ($1, $2, $3, 'WA', 'active') returning id",
    [orgId, phoneNumber, label],
  );
  return { id: n.id, phoneNumber };
}

/** A call row as POST /calls leaves it. */
export async function makeCall(pool: pg.Pool, orgId: string, opts: { numberId?: string | null; from?: string; sid?: string } = {}): Promise<{ id: string; callSid: string; from: string }> {
  const callSid = opts.sid ?? `CAvitest${randomUUID().replace(/-/g, "")}`;
  const from = opts.from ?? fakePhone();
  const { rows: [c] } = await pool.query(
    "insert into voice_calls(org_id, number_id, call_sid, from_number, persona, answered_at) values ($1, $2, $3, $4, 'janice', now()) returning id",
    [orgId, opts.numberId ?? null, callSid, from],
  );
  return { id: c.id, callSid, from };
}

export async function cleanup(pool: pg.Pool, bag: Made): Promise<void> {
  const orgs = bag.orgs, users = bag.users;
  if (orgs.length) {
    for (const t of ["voice_escalations", "voice_spam", "voice_spam_reports", "voice_usage", "voice_calls", "voice_numbers", "voice_profiles", "voice_profile_versions",
      "crm_activity_log", "crm_notifications", "crm_projects", "crm_customers", "crm_lead_sources", "crm_sms_optouts", "crm_members"]) {
      await pool.query(`delete from ${t} where org_id = any($1::text[])`, [orgs]).catch(() => {});
    }
    await pool.query("delete from crm_orgs where id = any($1::text[])", [orgs]);
  }
  if (users.length) {
    await pool.query("delete from growth_budgets where key like any($1)", [users.map((u) => `quota:user:${u}:%`)]);
    await pool.query("delete from call_assistant_subscriptions where user_id = any($1::int[])", [users]).catch(() => {});
    await pool.query("delete from subscriptions where user_id = any($1::int[])", [users]);
    await pool.query("delete from users where id = any($1::int[])", [users]);
  }
}

/** recordActivity is fire-and-forget: poll briefly for the audit row. */
export async function waitForActivity(pool: pg.Pool, orgId: string, action: string, timeoutMs = 3000): Promise<any[]> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query("select * from crm_activity_log where org_id = $1 and action = $2", [orgId, action]);
    if (rows.length || Date.now() > until) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}
