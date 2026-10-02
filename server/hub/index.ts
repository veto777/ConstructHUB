/**
 * Wires the Hub (the ConstructHUB corner assistant) into the app with its
 * production dependencies: the TruthCoder client, growth_budgets limits,
 * hub_stats counts and the hub_preset_answers cache. Endpoints are in
 * routes.ts; the rules each module enforces are in its header comment.
 */
import type { Express } from "express";
import { aiModel } from "../ai-config";
import { ipKey } from "../growth-limits";
import { requirePlatformAdmin } from "../crm/admin";
import { createHub } from "./routes";
import { hubAiClient, hubTimeoutMs, providerOk } from "./ai";
import { isBuilder, originOk } from "./access";
import { ensureHubSchema, hubStatsRollup, pgBudget, pgPresetStore, pgStats } from "./store";
import { logError } from "./stats";

export function registerHubRoutes(app: Express): void {
  let client: ReturnType<typeof hubAiClient> | null = null;
  const hub = createHub({
    ai: () => (client ??= hubAiClient()),
    budget: pgBudget,
    stats: pgStats,
    presets: pgPresetStore,
    model: () => aiModel(),
    providerOk: () => providerOk(),
    timeoutMs: hubTimeoutMs,
    ipKey,
    originOk,
    isBuilder,
  });
  app.use(hub.router);

  // Platform admin: Hub outcome counts for the last 30 days (no text, no people).
  app.get("/api/admin/hub-stats", async (req: any, res) => {
    try {
      const admin = await requirePlatformAdmin(req, res, (r: any, s: any) => {
        if (r.user) return r.user;
        s.status(401).json({ message: "Not authenticated" });
        return null;
      });
      if (!admin) return;
      res.setHeader("Cache-Control", "no-store");
      res.json({ days: 30, rows: await hubStatsRollup(30) });
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
