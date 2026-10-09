/**
 * The Call Assistant number is part of the service (owner, 2026-10-02):
 *
 *   "When a person cancels they lose their number - that is the entire purpose
 *    of the service you don't keep the number. And the only thing that can
 *    keep a customer from leaving."
 *
 * So when the Call Assistant's OWN subscription ENDS (Stripe deleted it, or its
 * status is canceled / unpaid / incomplete_expired — the service is sold apart
 * from the platform plans, server/voice/subscription-store.ts) or it no longer
 * holds a tier, every number the org holds is released on SignalWire; when a
 * smaller tier (5,000 → 2,000 → 1,000 → 500 minutes) or a lower call_number
 * quantity pays for fewer numbers than the org holds, the NEWEST extra numbers
 * go the same way (the oldest — normally the included one — is kept). A failed
 * payment (past_due) never releases anything: the assistant is paused
 * (server/entitlements.ts ADDON_MODULE_RUN_STATUSES) and the number is held,
 * so fixing the card restores the agent. The platform plan plays no part.
 *
 * SignalWire keeps a bought number for at least CALL_NUMBER_MIN_DAYS
 * (voice_numbers.release_eligible_at). A number past that date is released at
 * once; an earlier one is SCHEDULED — status 'releasing', release_reason,
 * release_scheduled_at — and stops answering immediately (internal-profile.ts
 * answers 423 number_releasing), then the sweep below releases it as soon as
 * it is eligible. Only a payment problem or a smaller extra-number count can be
 * undone before then: a number scheduled because the payment was not recovered
 * (`unpaid`, reason payment_failed) is restored when the card is fixed, and an
 * extra one (over_allowance) when the call_number add-on comes back. A
 * CANCELLATION is final, whatever the number's age (owner: "you don't keep the
 * number"): a number scheduled because the subscription ended or the Call
 * Assistant add-on was removed is never restored, even when the customer
 * subscribes again within the 14 days; a returning customer buys a new number
 * (FINAL_RELEASE_REASONS rows do not count against the allowance). Nor is a
 * number whose release was already attempted (last_error set: the carrier may
 * have taken it), which the sweep then finishes.
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
 *     same number twice, and a decision locks the org's rows too (FOR UPDATE),
 *     so it waits for an in-flight release and never "keeps" a number that was
 *     just released; a carrier failure keeps the row 'releasing' with
 *     last_error and the next sweep retries it;
 *   - VOICE_NUMBER_RELEASE_WORKER_ENABLED=false (or a non-production server
 *     without =true) stops every carrier release: the sweep and the background
 *     release after a webhook both honour it; decisions (DB only) still run;
 *   - every decision is logged, and the org's owners get an activity row and a
 *     bell notification ("Your Call Assistant number +1… was released because
 *     the subscription ended").
 *
 * Entry points: afterSubscriptionChange(userId) from the Stripe webhook
 * (server/stripe.ts) and the Call Assistant's own billing routes
 * (server/voice/subscription.ts); startVoiceNumberReleaseWorker() at boot
 * (server/voice/index.ts) for the scheduled ones and any missed webhook.
 */
import { pool } from "../db";
import { accountSubscriptionRow } from "../entitlements";
import { callAssistantSubscriptionOf, type CallAssistantSubscriptionState } from "./subscription-store";
import { isPlatformAdminEmail } from "../admin";
import { recordActivity } from "../crm/activity";
import {
  ACCESS_STATUSES, ADDONS, CALL_ASSISTANT_NAME, CALL_NUMBER_MIN_DAYS, NUMBER_RELEASE_STATUSES, callAssistantIncluded,
  type AddonKey,
} from "@shared/plans";
import { mergeAddonRequest } from "../billing/order";
// Type only: the carrier code (./numbers → ./proxy) loads lazily, so the Stripe
// webhook that imports this module does not pull in the voice routes.
import type { NumbersMock } from "./numbers";
import { recordFailure } from "../ops/issues";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type ReleaseReason = "subscription_ended" | "addon_removed" | "payment_failed" | "over_allowance";
export const RELEASE_REASONS: readonly ReleaseReason[] = ["subscription_ended", "addon_removed", "payment_failed", "over_allowance"];
/** A cancellation: a number scheduled for one of these is never restored (owner: "you don't keep the number"). */
export const FINAL_RELEASE_REASONS: readonly ReleaseReason[] = ["subscription_ended", "addon_removed"];

/**
 * A 'releasing' row that will be released whatever happens next: scheduled by a
 * cancellation, or a release was already attempted (last_error: the carrier may
 * have taken it). It is never restored and does not count against the allowance.
 */
export function releaseIsFinal(row: { status?: string | null; release_reason?: string | null; last_error?: string | null }): boolean {
  if (row.status !== "releasing" || !row.release_reason) return false;
  return (FINAL_RELEASE_REASONS as readonly string[]).includes(row.release_reason) || !!row.last_error;
}

/** "…because the subscription ended" — the owner-facing why. */
export function releaseReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "addon_removed": return `the ${CALL_ASSISTANT_NAME} tier was removed from the subscription`;
    case "over_allowance": return `the subscription no longer pays for it (a smaller ${CALL_ASSISTANT_NAME} tier or fewer ${ADDONS.call_number.name} add-ons)`;
    case "payment_failed": return "the subscription's payment was not recovered";
    default: return "the subscription ended";
  }
}

/** How many numbers an account's orgs may keep, and why the rest go; null = leave its numbers alone. */
export type NumberKeep = { keep: number; reason: ReleaseReason };

/** The slice of the Call Assistant subscription the decision reads: its Stripe status and its lines as a quantities map. */
export type CallAssistantSubscriptionLike = Pick<CallAssistantSubscriptionState, "status" | "addons">;

/**
 * The release decision for an account's Call Assistant subscription (the row
 * getEntitlements reads, server/voice/subscription-store.ts):
 *   - platform admin → null (never touched);
 *   - no subscription or an ended one (NUMBER_RELEASE_STATUSES) → keep 0,
 *     "subscription_ended" — except `unpaid` (Stripe stopped retrying a
 *     failed payment) → keep 0, "payment_failed", which a fixed card can still
 *     undo;
 *   - active / trialing / past_due → keep what the subscription pays for (the
 *     held tier's numbers — 1 / 1 / 2 / 5, shared/plans.ts CALL_ASSISTANT_TIERS
 *     — + every call_number unit, so a downgrade releases the newest extras);
 *     no tier → "addon_removed";
 *   - anything else (incomplete, paused, a row we can't read) → null: hold,
 *     never guess a release.
 */
export function numbersKeptFor(sub: CallAssistantSubscriptionLike | null | undefined, admin: boolean): NumberKeep | null {
  if (admin) return null;
  if (!sub || !sub.status) return { keep: 0, reason: "subscription_ended" };
  if (sub.status === "unpaid") return { keep: 0, reason: "payment_failed" };
  if (NUMBER_RELEASE_STATUSES.includes(sub.status)) return { keep: 0, reason: "subscription_ended" };
  // A failed payment (past_due) pauses the assistant (shared/plans.ts ADDON_MODULE_RUN_STATUSES) while Stripe retries
  // the card, but the numbers are held as if paid: a failed payment never releases one (only `unpaid`, above, does).
  const status = sub.status === "past_due" ? "active" : sub.status;
  if (!ACCESS_STATUSES.includes(status)) return null;
  const addons = sub.addons ?? {};
  // The held tier's numbers plus every extra number.
  const { tier, numbers } = callAssistantIncluded(addons);
  if (!tier) return { keep: 0, reason: "addon_removed" };
  return { keep: numbers + (addons.call_number ?? 0), reason: "over_allowance" };
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
     SELECT $1::varchar, m.id, 'call.number_released', $2::text, $3::text, '/call-assistant?tab=numbers'
       FROM crm_members m WHERE m.org_id = $1::varchar AND m.role = 'owner' AND m.status = 'active'`,
    [orgId, title.slice(0, 300), body.slice(0, 1000)],
  ).catch((e: any) => {
    console.error("[voice-numbers] notification insert failed:", e?.message || e);
    void recordFailure("job", "Call number release bell notification", e, { orgId });
  });
}

const dateText = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** An org's numbers this module may act on, oldest first (the order `keep` counts in). */
const ORG_NUMBERS_OLDEST_FIRST =
  `SELECT n.id, n.phone_number, n.status, n.release_reason, n.release_eligible_at, n.purchased_at, n.created_at, n.last_error
     FROM voice_numbers n WHERE n.org_id = $1 AND NOT n.is_test AND ${HOLDING}
    ORDER BY n.purchased_at ASC NULLS LAST, n.created_at ASC NULLS LAST, n.id ASC`;

export type OrgSchedule = { orgId: string; scheduled: string[]; restored: string[]; due: number };

/**
 * Apply a keep decision to one org under its numbers lock (the same advisory
 * lock a purchase takes, so a buy and a release decision never interleave) and
 * a row lock on its numbers (so an in-flight carrier release in
 * releaseDueCallNumbers finishes first, and a row it released drops out):
 * the oldest `keep` numbers that can still be kept stay (a scheduled one among
 * them is restored unless its release is final — releaseIsFinal), the rest are
 * scheduled for release. Returns what changed and how many scheduled numbers
 * are already eligible.
 */
export async function scheduleOrgReleases(org: { id: string; name?: string }, decision: NumberKeep, now = new Date()): Promise<OrgSchedule> {
  const out: OrgSchedule = { orgId: org.id, scheduled: [], restored: [], due: 0 };
  const notices: { title: string; body: string; phone: string; at: Date }[] = [];
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(7172, hashtext($1))", [org.id]);
    const { rows } = await c.query(`${ORG_NUMBERS_OLDEST_FIRST} FOR UPDATE`, [org.id]);
    const keep = Math.max(0, decision.keep);
    const final = (FINAL_RELEASE_REASONS as readonly string[]).includes(decision.reason);
    let kept = 0;
    for (const r of rows) {
      if (kept < keep && !releaseIsFinal(r)) {
        kept += 1;
        if (r.status === "releasing") {
          const { rowCount } = await c.query(
            `UPDATE voice_numbers SET status = 'active', release_reason = NULL, release_scheduled_at = NULL, last_error = NULL, updated_at = $2
              WHERE id = $1 AND status = 'releasing' AND release_reason IS NOT NULL AND last_error IS NULL`, [r.id, now]);
          if (rowCount === 1) out.restored.push(r.phone_number);
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
            body: `The number is part of the ${CALL_ASSISTANT_NAME} service, so it is released ${when}. Your own business numbers were never moved: turn off forwarding with your carrier and calls ring through to you as before.`,
          });
        }
      } else if (final && r.release_reason !== decision.reason && !releaseIsFinal(r)) {
        // Scheduled for a payment problem or a smaller add-on count, and now the
        // subscription is cancelled: the release becomes final (no restore on a
        // later resubscription). Its date and notice stay as they were.
        await c.query(`UPDATE voice_numbers SET release_reason = $2, updated_at = $3 WHERE id = $1 AND status = 'releasing'`, [r.id, decision.reason, now]);
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
  const decision = numbersKeptFor(callAssistantSubscriptionOf(row), isPlatformAdminEmail(row?.email));
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

export type ReleasePreview = { phoneNumber: string; orgName: string }[];

/**
 * The account's answering Call Assistant numbers that a change WOULD stop and
 * release (read only — the Billing page's confirm step): `cancel` = the
 * subscription ends; `addons` = the new add-on quantities (the rest as stored).
 * Same rule as scheduleOrgReleases: the oldest keepable numbers stay.
 */
export async function previewCallNumberReleases(userId: number, change: { cancel?: boolean; addons?: Record<string, number> }): Promise<ReleasePreview> {
  const orgs = await orgsHoldingNumbers(userId);
  if (!orgs.length) return [];
  const row = await accountSubscriptionRow(userId);
  const admin = isPlatformAdminEmail(row?.email);
  const sub = callAssistantSubscriptionOf(row);
  const decision: NumberKeep | null = admin ? null
    : change.cancel ? { keep: 0, reason: "subscription_ended" }
    : numbersKeptFor({ status: sub.status, addons: mergeAddonRequest(sub.addons, (change.addons ?? {}) as Partial<Record<AddonKey, number>>) }, false);
  if (!decision) return [];
  const out: ReleasePreview = [];
  for (const org of orgs) {
    const { rows } = await pool.query(ORG_NUMBERS_OLDEST_FIRST, [org.id]);
    let kept = 0;
    for (const r of rows) {
      if (kept < decision.keep && !releaseIsFinal(r)) { kept += 1; continue; }
      if (r.status === "active") out.push({ phoneNumber: r.phone_number, orgName: org.name });
    }
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
        void recordFailure("job", "Call number release", e, { orgId: row.org_id, numberId: row.id }, "warning");
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
        `The number is part of the ${CALL_ASSISTANT_NAME} service and has gone back to the carrier. Your own business numbers were never moved: turn off forwarding to ${notice.phone} with your carrier and calls ring through to you as before.`);
    }
  }
  return out;
}

/**
 * After the account's subscription row changed (webhook, add-on change):
 * decide now (awaited, DB only), release what is already eligible in the
 * background — only where the release worker is on (the same switch as the
 * sweep: VOICE_NUMBER_RELEASE_WORKER_ENABLED=false stops every carrier
 * release). Never throws — a failure is logged and the sweep catches up.
 */
export async function afterSubscriptionChange(userId: number | null | undefined, deps: ReleaseDeps & { env?: NodeJS.ProcessEnv } = {}): Promise<AccountSchedule | null> {
  if (!userId) return null;
  try {
    const out = await scheduleAccountCallNumbers(userId, deps);
    const off = out.due > 0 ? voiceNumberReleaseWorkerOffReason(deps.env) : null;
    if (off) {
      console.log(`[voice-numbers] user ${userId}: ${out.due} number(s) due for release, not released now: ${off}.`);
    } else if (out.due > 0) {
      void releaseDueCallNumbers({ ...deps, orgIds: out.orgIds })
        .catch((e: any) => {
          console.error(`[voice-numbers] background release for user ${userId} failed:`, e?.message || e);
          void recordFailure("job", "Call number background release", e, { userId });
        });
    }
    return out;
  } catch (e: any) {
    console.error(`[voice-numbers] release decision for user ${userId} failed (the sweep retries):`, e?.message || e);
    void recordFailure("job", "Call number release decision", e, { userId }, "warning");
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
      void recordFailure("job", "Call number sweep (one account)", e, { userId: Number(r.owner_user_id) });
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
      void recordFailure("job", "Call number sweep", e);
    } finally { running = false; }
  };
  setTimeout(run, SWEEP_FIRST_DELAY_MS).unref();
  setInterval(run, SWEEP_EVERY_MS).unref();
  return true;
}
