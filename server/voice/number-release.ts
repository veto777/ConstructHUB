/**
 * The Call Assistant number is part of the service (owner, 2026-10-02):
 *
 *   "When a person cancels they lose their number - that is the entire purpose
 *    of the service you don't keep the number. And the only thing that can
 *    keep a customer from leaving."
 *
 * So when the subscription ENDS (Stripe deleted it, or its status is canceled /
 * unpaid / incomplete_expired, or a trial grant ran out) or the call_assistant
 * add-on is removed, every number the org holds is released on SignalWire; when
 * the call_number add-on quantity drops below what the org holds, the NEWEST
 * extra numbers go the same way (the oldest — normally the included one — is
 * kept). A failed payment (past_due) never releases anything: the assistant is
 * paused (server/entitlements.ts ADDON_MODULE_RUN_STATUSES) and the number is
 * held, so fixing the card restores the agent.
 *
 * SignalWire keeps a bought number for at least CALL_NUMBER_MIN_DAYS
 * (voice_numbers.release_eligible_at). A number past that date is released at
 * once; an earlier one is SCHEDULED — status 'releasing', release_reason,
 * release_scheduled_at — and stops answering immediately (internal-profile.ts
 * answers 423 number_releasing), then the sweep below releases it as soon as
 * it is eligible. If the subscription comes back before then (the card is
 * fixed after `unpaid`, the add-on is re-added), the scheduled number is
 * restored to active.
 *
 * Safety:
 *   - only rows of voice_numbers for an org the account OWNS are ever looked
 *     at, and the carrier is called with that row's own SignalWire SID — never
 *     a number outside this table (the texting number, anyone else's lines);
 *   - platform admins' orgs are never touched (their access is not a
 *     subscription), nor is the build's one test number (is_test);
 *   - idempotent: a webhook redelivery or a second sweep finds the row already
 *     'releasing' or 'released' and does nothing; the carrier call happens
 *     under a row lock (FOR UPDATE SKIP LOCKED), so two runs never release the
 *     same number twice; a carrier failure keeps the row 'releasing' with
 *     last_error and the next sweep retries it;
 *   - every decision is logged, and the org's owners get an activity row and a
 *     bell notification ("Your Call Assistant number +1… was released because
 *     the subscription ended").
 *
 * Entry points: afterSubscriptionChange(userId) from the Stripe webhook and the
 * add-on routes (server/stripe.ts); startVoiceNumberReleaseWorker() at boot
 * (server/voice/index.ts) for the scheduled ones and any missed webhook.
 */
import { pool } from "../db";
import { accountSubscriptionRow, activePlanKey, grantExpired, parseAddons } from "../entitlements";
import { isPlatformAdminEmail } from "../admin";
import { recordActivity } from "../crm/activity";
import {
  ACCESS_STATUSES, ADDONS, CALL_ASSISTANT_INCLUDED_NUMBERS, CALL_NUMBER_MIN_DAYS, NUMBER_RELEASE_STATUSES,
} from "@shared/plans";
// Type only: the carrier code (./numbers → ./proxy) loads lazily, so the Stripe
// webhook that imports this module does not pull in the voice routes.
import type { NumbersMock } from "./numbers";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type ReleaseReason = "subscription_ended" | "addon_removed" | "over_allowance";
export const RELEASE_REASONS: readonly ReleaseReason[] = ["subscription_ended", "addon_removed", "over_allowance"];

/** "…because the subscription ended" — the owner-facing why. */
export function releaseReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "addon_removed": return `the ${ADDONS.call_assistant.name} add-on was removed`;
    case "over_allowance": return `the subscription no longer pays for it (fewer ${ADDONS.call_number.name} add-ons)`;
    default: return "the subscription ended";
  }
}

/** How many numbers an account's orgs may keep, and why the rest go; null = leave its numbers alone. */
export type NumberKeep = { keep: number; reason: ReleaseReason };

type SubscriptionLike = {
  plan?: string | null;
  status?: string | null;
  addons?: unknown;
  stripe_subscription_id?: string | null;
  current_period_end?: Date | string | null;
};

/**
 * The release decision for an account's deciding subscription row (the one
 * getEntitlements reads):
 *   - platform admin → null (never touched);
 *   - no subscription, an ended one (NUMBER_RELEASE_STATUSES) or an expired
 *     grant → keep 0, "subscription_ended";
 *   - active / trialing / past_due → keep what the add-ons pay for (one per
 *     call_assistant unit + every call_number unit); none → "addon_removed";
 *   - anything else (incomplete, paused, a row we can't read) → null: hold,
 *     never guess a release.
 */
export function numbersKeptFor(row: SubscriptionLike | null | undefined, admin: boolean, now = new Date()): NumberKeep | null {
  if (admin) return null;
  if (!row || !row.status) return { keep: 0, reason: "subscription_ended" };
  if (grantExpired(row, now) || NUMBER_RELEASE_STATUSES.includes(row.status)) return { keep: 0, reason: "subscription_ended" };
  if (!ACCESS_STATUSES.includes(row.status)) return null;
  const plan = activePlanKey(row, now);
  if (!plan) return null;
  const addons = parseAddons(row.addons);
  const units = ADDONS.call_assistant.availableOn.includes(plan) ? addons.call_assistant ?? 0 : 0;
  if (units <= 0) return { keep: 0, reason: "addon_removed" };
  return { keep: units * CALL_ASSISTANT_INCLUDED_NUMBERS + (addons.call_number ?? 0), reason: "over_allowance" };
}

export type ReleaseDeps = {
  /** The carrier for a row (tests inject a fake; default: the row's own provider). */
  carrierFor?: (row: { provider: string }) => NumbersMock;
  now?: Date;
};

const HOLDING = "(n.status = 'active' OR (n.status = 'releasing' AND n.release_reason IS NOT NULL))";

/** Orgs an account owns that hold a number this module may act on. */
async function orgsHoldingNumbers(userId: number, q: Queryable = pool): Promise<{ id: string; name: string }[]> {
  const { rows } = await q.query(
    `SELECT DISTINCT o.id, o.name FROM crm_orgs o JOIN voice_numbers n ON n.org_id = o.id
      WHERE o.owner_user_id = $1 AND NOT n.is_test AND ${HOLDING}`, [userId]);
  return rows.map((r) => ({ id: String(r.id), name: String(r.name ?? "") }));
}

/** Bell notification for the org's active owners (best-effort, never throws). */
async function notifyOwners(orgId: string, title: string, body: string): Promise<void> {
  await pool.query(
    `INSERT INTO crm_notifications (org_id, member_id, type, title, body, link)
     SELECT $1::varchar, m.id, 'call.number_released', $2::text, $3::text, '/crm/call-assistant?tab=numbers'
       FROM crm_members m WHERE m.org_id = $1::varchar AND m.role = 'owner' AND m.status = 'active'`,
    [orgId, title.slice(0, 300), body.slice(0, 1000)],
  ).catch((e: any) => console.error("[voice-numbers] notification insert failed:", e?.message || e));
}

const dateText = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export type OrgSchedule = { orgId: string; scheduled: string[]; restored: string[]; due: number };

/**
 * Apply a keep decision to one org under its numbers lock (the same advisory
 * lock a purchase takes, so a buy and a release decision never interleave):
 * the oldest `keep` numbers stay (a scheduled one among them is restored), the
 * newer ones are scheduled for release. Returns what changed and how many
 * scheduled numbers are already eligible.
 */
export async function scheduleOrgReleases(org: { id: string; name?: string }, decision: NumberKeep, now = new Date()): Promise<OrgSchedule> {
  const out: OrgSchedule = { orgId: org.id, scheduled: [], restored: [], due: 0 };
  const notices: { title: string; body: string; phone: string; at: Date }[] = [];
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7172, hashtext($1))", [org.id]);
    const { rows } = await c.query(
      `SELECT n.id, n.phone_number, n.status, n.release_reason, n.release_eligible_at, n.purchased_at, n.created_at
         FROM voice_numbers n WHERE n.org_id = $1 AND NOT n.is_test AND ${HOLDING}
        ORDER BY n.purchased_at ASC NULLS LAST, n.created_at ASC NULLS LAST, n.id ASC`, [org.id]);
    const keep = Math.max(0, decision.keep);
    for (const [i, r] of rows.entries()) {
      if (i < keep) {
        if (r.status === "releasing") {
          await c.query(
            `UPDATE voice_numbers SET status = 'active', release_reason = NULL, release_scheduled_at = NULL, last_error = NULL, updated_at = $2
              WHERE id = $1 AND status = 'releasing' AND release_reason IS NOT NULL`, [r.id, now]);
          out.restored.push(r.phone_number);
        }
        continue;
      }
      const base = r.purchased_at ?? r.created_at ?? now;
      const eligible: Date = r.release_eligible_at ? new Date(r.release_eligible_at) : new Date(new Date(base).getTime() + CALL_NUMBER_MIN_DAYS * 86_400_000);
      if (r.status === "active") {
        const { rowCount } = await c.query(
          `UPDATE voice_numbers SET status = 'releasing', release_reason = $2, release_scheduled_at = $3, release_eligible_at = $4, last_error = NULL, updated_at = $3
            WHERE id = $1 AND status = 'active'`, [r.id, decision.reason, now, eligible]);
        if (rowCount) {
          out.scheduled.push(r.phone_number);
          const when = eligible.getTime() <= now.getTime() ? "now" : `on ${dateText(eligible)} (the carrier keeps a number for at least ${CALL_NUMBER_MIN_DAYS} days)`;
          notices.push({
            phone: r.phone_number, at: eligible,
            title: `Your Call Assistant number ${r.phone_number} stopped answering because ${releaseReasonText(decision.reason)}`,
            body: `The number is part of the ${ADDONS.call_assistant.name} service, so it is released ${when}. Your own business numbers were never moved: turn off forwarding with your carrier and calls ring through to you as before.`,
          });
        }
      }
      if (eligible.getTime() <= now.getTime()) out.due += 1;
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  for (const n of notices) {
    console.log(`[voice-numbers] org ${org.id}: ${n.phone} scheduled for release (${decision.reason}), eligible ${n.at.toISOString()}`);
    recordActivity({ orgId: org.id, actorLabel: "ConstructHUB billing", action: "call.number_release_scheduled", entityType: "voice_number", meta: { phone: n.phone, reason: decision.reason, releaseAt: n.at.toISOString() } });
    await notifyOwners(org.id, n.title, n.body);
  }
  for (const phone of out.restored) {
    console.log(`[voice-numbers] org ${org.id}: ${phone} kept (the subscription pays for it again)`);
    recordActivity({ orgId: org.id, actorLabel: "ConstructHUB billing", action: "call.number_release_cancelled", entityType: "voice_number", meta: { phone } });
  }
  return out;
}

export type AccountSchedule = { decision: NumberKeep | null; orgIds: string[]; scheduled: number; restored: number; due: number };

/**
 * Decide (DB only, no carrier call) for every org the account owns that holds
 * numbers. Cheap for the common case: an account with no numbers costs one query.
 */
export async function scheduleAccountCallNumbers(userId: number, deps: ReleaseDeps = {}): Promise<AccountSchedule> {
  const empty: AccountSchedule = { decision: null, orgIds: [], scheduled: 0, restored: 0, due: 0 };
  const orgs = await orgsHoldingNumbers(userId);
  if (!orgs.length) return empty;
  const now = deps.now ?? new Date();
  const row = await accountSubscriptionRow(userId);
  const decision = numbersKeptFor(row, isPlatformAdminEmail(row?.email), now);
  if (!decision) return { ...empty, orgIds: orgs.map((o) => o.id) };
  const out: AccountSchedule = { decision, orgIds: [], scheduled: 0, restored: 0, due: 0 };
  for (const org of orgs) {
    const r = await scheduleOrgReleases(org, decision, now);
    out.orgIds.push(org.id);
    out.scheduled += r.scheduled.length;
    out.restored += r.restored.length;
    out.due += r.due;
  }
  return out;
}

export type ReleaseRun = { released: string[]; failed: { phone: string; error: string }[] };

/**
 * Release every scheduled number whose release_eligible_at has passed (or only
 * those of `orgIds`). One row at a time under FOR UPDATE SKIP LOCKED: the
 * carrier is called with the row's own SID while the row is locked, so a
 * concurrent run skips it; a failure keeps it 'releasing' with last_error for
 * the next run.
 */
export async function releaseDueCallNumbers(opts: ReleaseDeps & { orgIds?: string[] } = {}): Promise<ReleaseRun> {
  const out: ReleaseRun = { released: [], failed: [] };
  const now = opts.now ?? new Date();
  const tried: string[] = [];
  const carrierFor = opts.carrierFor ?? (await import("./numbers")).carrierForRow;
  for (;;) {
    const c = await pool.connect();
    let notice: { orgId: string; phone: string; reason: string | null } | null = null;
    try {
      await c.query("BEGIN");
      const { rows: [row] } = await c.query(
        `SELECT * FROM voice_numbers
          WHERE status = 'releasing' AND release_reason IS NOT NULL AND NOT is_test AND release_eligible_at <= $1
            AND NOT (id = ANY($2::varchar[])) ${opts.orgIds ? "AND org_id = ANY($3::varchar[])" : ""}
          ORDER BY release_eligible_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
        opts.orgIds ? [now, tried, opts.orgIds] : [now, tried]);
      if (!row) { await c.query("COMMIT"); break; }
      tried.push(row.id);
      try {
        // Only this row's own SID; a row without one never reached the carrier.
        if (row.provider_sid) await carrierFor({ provider: row.provider }).release(row.provider_sid);
        await c.query("UPDATE voice_numbers SET status = 'released', released_at = $2, last_error = NULL, updated_at = $2 WHERE id = $1", [row.id, now]);
        await c.query("COMMIT");
        out.released.push(row.phone_number);
        notice = { orgId: row.org_id, phone: row.phone_number, reason: row.release_reason };
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 300);
        await c.query("UPDATE voice_numbers SET last_error = $2, updated_at = $3 WHERE id = $1", [row.id, `Release failed, will retry: ${msg}`, now]);
        await c.query("COMMIT");
        out.failed.push({ phone: row.phone_number, error: msg });
        console.error(`[voice-numbers] release of ${row.phone_number} (org ${row.org_id}) failed, will retry: ${msg}`);
      }
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    if (notice) {
      const why = releaseReasonText(notice.reason);
      console.log(`[voice-numbers] org ${notice.orgId}: released ${notice.phone} on the carrier (${notice.reason})`);
      recordActivity({ orgId: notice.orgId, actorLabel: "ConstructHUB billing", action: "call.number_released", entityType: "voice_number", meta: { phone: notice.phone, reason: notice.reason } });
      await notifyOwners(notice.orgId,
        `Your Call Assistant number ${notice.phone} was released because ${why}`,
        `The number is part of the ${ADDONS.call_assistant.name} service and has gone back to the carrier. Your own business numbers were never moved: turn off forwarding to ${notice.phone} with your carrier and calls ring through to you as before.`);
    }
  }
  return out;
}

/**
 * After the account's subscription row changed (webhook, add-on change):
 * decide now (awaited, DB only), release what is already eligible in the
 * background. Never throws — a failure is logged and the sweep catches up.
 */
export async function afterSubscriptionChange(userId: number | null | undefined, deps: ReleaseDeps = {}): Promise<AccountSchedule | null> {
  if (!userId) return null;
  try {
    const out = await scheduleAccountCallNumbers(userId, deps);
    if (out.due > 0) {
      void releaseDueCallNumbers({ ...deps, orgIds: out.orgIds })
        .catch((e: any) => console.error(`[voice-numbers] background release for user ${userId} failed:`, e?.message || e));
    }
    return out;
  } catch (e: any) {
    console.error(`[voice-numbers] release decision for user ${userId} failed (the sweep retries):`, e?.message || e);
    return null;
  }
}

/**
 * One pass: re-decide every account that holds numbers (catches a missed
 * webhook or an expired grant), then release what is due. `userIds` narrows
 * the pass to those accounts (tests on a shared dev database).
 */
export async function runCallNumberSweep(deps: ReleaseDeps & { userIds?: number[] } = {}): Promise<{ accounts: number; scheduled: number; restored: number } & ReleaseRun> {
  const { rows } = await pool.query(
    `SELECT DISTINCT o.owner_user_id FROM crm_orgs o JOIN voice_numbers n ON n.org_id = o.id
      WHERE NOT n.is_test AND ${HOLDING} ${deps.userIds ? "AND o.owner_user_id = ANY($1::int[])" : ""}`,
    deps.userIds ? [deps.userIds] : []);
  let scheduled = 0, restored = 0;
  for (const r of rows) {
    try {
      const s = await scheduleAccountCallNumbers(Number(r.owner_user_id), deps);
      scheduled += s.scheduled; restored += s.restored;
    } catch (e: any) {
      console.error(`[voice-numbers] sweep: account ${r.owner_user_id} failed:`, e?.message || e);
    }
  }
  let orgIds: string[] | undefined;
  if (deps.userIds) {
    const { rows: orgs } = await pool.query("SELECT id FROM crm_orgs WHERE owner_user_id = ANY($1::int[])", [deps.userIds]);
    orgIds = orgs.map((o) => String(o.id));
  }
  const run = await releaseDueCallNumbers({ ...deps, orgIds });
  return { accounts: rows.length, scheduled, restored, ...run };
}

// ── The sweep worker (started from registerVoiceRoutes in server/voice/index.ts) ──

const SWEEP_EVERY_MS = 15 * 60_000;
const SWEEP_FIRST_DELAY_MS = 2 * 60_000;
let workerStarted = false;

/**
 * Why the release sweep is off, or null when it runs. ON by default in
 * production (the owner's rule must hold without an env change);
 * VOICE_NUMBER_RELEASE_WORKER_ENABLED=false turns it off there, =true turns
 * it on elsewhere (a dev box).
 */
export function voiceNumberReleaseWorkerOffReason(env: NodeJS.ProcessEnv = process.env): string | null {
  const flag = env.VOICE_NUMBER_RELEASE_WORKER_ENABLED;
  if (flag === "false") return "VOICE_NUMBER_RELEASE_WORKER_ENABLED is false";
  if (flag === "true") return null;
  if (env.NODE_ENV !== "production") return "this is not a production server (set VOICE_NUMBER_RELEASE_WORKER_ENABLED=true to run it)";
  return null;
}

export function startVoiceNumberReleaseWorker(): boolean {
  if (workerStarted || process.env.NODE_ENV === "test" || process.env.VITEST) return false;
  workerStarted = true;
  const off = voiceNumberReleaseWorkerOffReason();
  if (off) {
    console.log(`[voice-numbers] Call Assistant number release sweep is off: ${off}.`);
    return false;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const out = await runCallNumberSweep();
      if (out.scheduled || out.restored || out.released.length || out.failed.length) {
        console.log(`[voice-numbers] sweep: ${out.accounts} account(s), scheduled ${out.scheduled}, kept ${out.restored}, released ${out.released.length}, failed ${out.failed.length}`);
      }
    } catch (e: any) {
      console.error("[voice-numbers] sweep failed:", e?.message || e);
    } finally { running = false; }
  };
  setTimeout(run, SWEEP_FIRST_DELAY_MS).unref();
  setInterval(run, SWEEP_EVERY_MS).unref();
  return true;
}
