/**
 * The only database access in the Hub (guardrails §1 "No DB in the AI path"):
 * the hub_stats counter, the hub_preset_answers cache, the budget counters
 * (growth_budgets via takeBudget) and the hub_usage_days token counter (the
 * daily cost cap, usage.ts). Nothing here reads a user, an account or any
 * customer data, and nothing here is reachable from the prompt.
 */
import { pool } from "../db";
import { takeBudget, budgetUsed } from "../growth-limits";
import type { Budget } from "./limits";
import type { PresetStore } from "./presets";
import { logError, safeReason, type HubOutcome, type HubTier, type StatsSink } from "./stats";
import type { TokenDay, TokenUsage, UsageStore } from "./usage";
import type { PresetId } from "@shared/hub-presets";

export async function ensureHubSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hub_stats (
      day date NOT NULL, tier text NOT NULL, outcome text NOT NULL, reason text NOT NULL,
      count integer NOT NULL DEFAULT 0, PRIMARY KEY (day, tier, outcome, reason)
    );
    DELETE FROM hub_stats WHERE day < (now() AT TIME ZONE 'utc')::date - 90;
    CREATE TABLE IF NOT EXISTS hub_preset_answers (
      preset_id text NOT NULL, knowledge_hash text NOT NULL, answer text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (preset_id, knowledge_hash)
    );
    DELETE FROM hub_preset_answers WHERE created_at < now() - interval '90 days';
    CREATE TABLE IF NOT EXISTS hub_usage_days (
      day date PRIMARY KEY, prompt_tokens bigint NOT NULL DEFAULT 0, completion_tokens bigint NOT NULL DEFAULT 0,
      calls integer NOT NULL DEFAULT 0
    );
    DELETE FROM hub_usage_days WHERE day < (now() AT TIME ZONE 'utc')::date - 400;
  `);
}

const usageDay = (day: string, r: any): TokenDay => {
  const prompt = Number(r?.prompt_tokens ?? 0), completion = Number(r?.completion_tokens ?? 0);
  return { day, calls: Number(r?.calls ?? 0), prompt, completion, total: prompt + completion };
};

/**
 * The day's token counts in one row (usage.ts). `reserve` is one statement: the
 * row is created (only if the reservation itself fits under the cap) or, under
 * its row lock, added to only while the day's total PLUS the reservation fits —
 * so two calls arriving together can't both squeeze under it; the second sees
 * the first's reservation, and no admission ever takes the day past the cap.
 */
export const pgUsage: UsageStore = {
  async reserve(day, prompt, completion, cap) {
    const r = await pool.query(
      `INSERT INTO hub_usage_days (day, prompt_tokens, completion_tokens, calls)
       SELECT $1::date, $2::bigint, $3::bigint, 1 WHERE $4::bigint IS NULL OR $2::bigint + $3::bigint <= $4::bigint
       ON CONFLICT (day) DO UPDATE SET
         prompt_tokens = hub_usage_days.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = hub_usage_days.completion_tokens + EXCLUDED.completion_tokens,
         calls = hub_usage_days.calls + 1
       WHERE $4::bigint IS NULL OR hub_usage_days.prompt_tokens + hub_usage_days.completion_tokens + EXCLUDED.prompt_tokens + EXCLUDED.completion_tokens <= $4::bigint
       RETURNING prompt_tokens, completion_tokens, calls`,
      [day, prompt, completion, cap],
    );
    return r.rows[0] ? usageDay(day, r.rows[0]) : null;
  },
  async settle(day, reserved: TokenUsage, actual: TokenUsage) {
    await pool.query(
      `UPDATE hub_usage_days SET prompt_tokens = GREATEST(0, prompt_tokens - $2::bigint + $3::bigint),
         completion_tokens = GREATEST(0, completion_tokens - $4::bigint + $5::bigint) WHERE day = $1::date`,
      [day, reserved.prompt, actual.prompt, reserved.completion, actual.completion],
    );
  },
  async today(day) {
    const r = await pool.query(`SELECT prompt_tokens, completion_tokens, calls FROM hub_usage_days WHERE day = $1::date`, [day]);
    return usageDay(day, r.rows[0]);
  },
};

export const pgStats: StatsSink = {
  record(tier: HubTier, outcome: HubOutcome, reason: string) {
    pool.query(
      `INSERT INTO hub_stats(day,tier,outcome,reason,count) VALUES((now() AT TIME ZONE 'utc')::date,$1,$2,$3,1)
       ON CONFLICT(day,tier,outcome,reason) DO UPDATE SET count=hub_stats.count+1`,
      [tier, outcome, safeReason(reason)],
    ).catch((err) => logError("stats", err));
  },
};

export const pgPresetStore: PresetStore = {
  async get(presetId: PresetId, hash: string) {
    const r = await pool.query(`SELECT answer FROM hub_preset_answers WHERE preset_id=$1 AND knowledge_hash=$2`, [presetId, hash]);
    return r.rows[0]?.answer ?? null;
  },
  async put(presetId: PresetId, hash: string, answer: string) {
    await pool.query(
      `INSERT INTO hub_preset_answers(preset_id,knowledge_hash,answer) VALUES($1,$2,$3)
       ON CONFLICT(preset_id,knowledge_hash) DO UPDATE SET answer=EXCLUDED.answer, created_at=now()`,
      [presetId, hash, answer],
    );
  },
};

export const pgBudget: Budget = {
  take: (key, limit, windowMs) => takeBudget(key, limit, 1, windowMs),
  used: (key, windowMs) => budgetUsed(key, windowMs),
};

/** Counts only, for the platform-admin rollup. */
export async function hubStatsRollup(days = 30) {
  const r = await pool.query(
    `SELECT tier, outcome, reason, sum(count)::int AS count FROM hub_stats
      WHERE day >= (now() AT TIME ZONE 'utc')::date - $1::int
      GROUP BY tier, outcome, reason ORDER BY count DESC LIMIT 200`,
    [days],
  );
  return r.rows as { tier: string; outcome: string; reason: string; count: number }[];
}
