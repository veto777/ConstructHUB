/**
 * The only database access in the Hub (guardrails §1 "No DB in the AI path"):
 * the hub_stats counter, the hub_preset_answers cache and the budget
 * counters (growth_budgets via takeBudget). Nothing here reads a user, an
 * account or any customer data, and nothing here is reachable from the prompt.
 */
import { pool } from "../db";
import { takeBudget, budgetUsed } from "../growth-limits";
import type { Budget } from "./limits";
import type { PresetStore } from "./presets";
import { logError, safeReason, type HubOutcome, type HubTier, type StatsSink } from "./stats";
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
  `);
}

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
