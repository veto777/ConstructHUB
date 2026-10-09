/**
 * Wires the Hub (the ConstructHUB corner assistant) into the app with its
 * production dependencies: the model client (TruthCoder, or OpenAI when
 * HUB_AI_PROVIDER=openai — ai.ts), growth_budgets limits, hub_stats counts and
 * the hub_preset_answers cache. Endpoints are in routes.ts; the rules each
 * module enforces are in its header comment.
 */
import type { Express } from "express";
import { ipKey } from "../growth-limits";
import { refundReservation, reserveQuotaFor } from "../growth-quotas";
import { requirePlatformAdmin } from "../crm/admin";
import { createHub } from "./routes";
import { hubAiClient, hubModel, hubProviderInfo, hubTimeoutMs, logProvider, providerOk } from "./ai";
import { isBuilder, originOk } from "./access";
import { ensureHubSchema, hubStatsRollup, pgBudget, pgPresetStore, pgStats, pgUsage } from "./store";
import { TokenMeter } from "./usage";
import { logError } from "./stats";

export function registerHubRoutes(app: Express): void {
  let client: ReturnType<typeof hubAiClient> | null = null;
  const hub = createHub({
    ai: () => (client ??= hubAiClient()),
    budget: pgBudget,
    stats: pgStats,
    presets: pgPresetStore,
    model: () => hubModel(),
    providerOk: () => providerOk(),
    timeoutMs: hubTimeoutMs,
    ipKey,
    originOk,
    isBuilder,
    // The daily token counter on hub_usage_days: one row per UTC day, shared by every process, kept across restarts.
    tokens: new TokenMeter(pgUsage),
    // The plan's monthly Gabe questions (limits.gabeQuestions, -1 unlimited): a spent month
    // answers 402/403 with the plan-limit body; a failed model call gives the question back.
    // The per-user/day and global/day budgets above stay on top of this meter.
    quota: {
      take: async (userId: number) => {
        const r = await reserveQuotaFor(userId, "gabeQuestions", 1);
        if (!r.ok) return { ok: false as const, status: r.status, body: r.body };
        return { ok: true as const, refund: () => refundReservation(r.reservation, 1) };
      },
    },
  });
  app.use(hub.router);
  // One boot line: provider, model, host and whether a key is set — never the key.
  logProvider();

  // Platform admin: Hub outcome counts for the last 30 days (no text, no people), plus the
  // provider Gabe is on (mode, model, host, key set or not — never the key) and today's token counts.
  app.get("/api/admin/hub-stats", async (req: any, res) => {
    try {
      const admin = await requirePlatformAdmin(req, res, (r: any, s: any) => {
        if (r.user) return r.user;
        s.status(401).json({ message: "Not authenticated" });
        return null;
      });
      if (!admin) return;
      res.setHeader("Cache-Control", "no-store");
      res.json({ days: 30, rows: await hubStatsRollup(30), provider: { ...hubProviderInfo(), ...(await hub.status()) } });
    } catch (err) {
      logError("admin_stats", err);
      if (!res.headersSent) res.status(500).json({ message: "Could not load Hub stats." });
    }
  });

  // Tables first, then warm the preset answers in the background (never blocks boot).
  ensureHubSchema()
    .then(() => {
      if (process.env.HUB_WARM_PRESETS === "false") return;
      setTimeout(() => { hub.warm().catch((err) => logError("warm", err)); }, 5_000).unref();
    })
    .catch((err) => logError("schema", err));
}
