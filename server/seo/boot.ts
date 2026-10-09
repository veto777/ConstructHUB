/**
 * The SEO module's boot step (reliability review H1, 2026-10-09).
 *
 * server/routes.ts used to await ensureSeoSchema() un-caught: one failing statement was a "Fatal startup error",
 * exit(1), and systemd's Restart=always then took the whole site — CRM included — through a restart loop. Now the
 * schema step is guarded: on failure the error goes to the log and the issue desk, /api/seo answers 503 with an
 * honest message, the SEO worker is not started, and the rest of the site boots. `seoModule` says which it was.
 */
import type { Express } from "express";
import { recordFailure } from "../ops/issues";
import { onShutdown } from "../shutdown";
import { ensureSeoSchema, type SeoSchemaOutcome } from "./schema";

export const SEO_UNAVAILABLE_MESSAGE = "The SEO tools are not available on this server right now. The team has been told; nothing was charged.";

/** This process's SEO module: on, or off with the reason (shown to admins, never the schema error text to customers). */
export const seoModule: { enabled: boolean; reason: string | null; schema: SeoSchemaOutcome | null } = { enabled: true, reason: null, schema: null };

/** Answer every /api/seo request while the module is off. */
export function seoUnavailableHandler(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => unknown } }): void {
  res.status(503).json({ configured: false, code: "seo_unavailable", message: SEO_UNAVAILABLE_MESSAGE });
}

/**
 * Bring up the SEO tables, routes and worker. Returns false — with the process still booting — when the schema step
 * failed; the routes then answer 503 (`seoUnavailableHandler`) and no worker runs in this process.
 */
export async function bootSeoModule(app: Express, auth: (req: any, res: any) => any, deps: {
  ensureSchema?: () => Promise<SeoSchemaOutcome>;
  registerRoutes?: (app: Express, auth: (req: any, res: any) => any) => void;
  startWorker?: () => NodeJS.Timeout | undefined;
  log?: (line: string) => void;
} = {}): Promise<boolean> {
  const log = deps.log ?? ((line: string) => console.log(line));
  try {
    const out = await (deps.ensureSchema ?? ensureSeoSchema)();
    seoModule.schema = out;
    log(out.skipped
      ? `[seo] schema up to date (${out.hash.slice(0, 12)}), no DDL run, ${out.ms}ms`
      : `[seo] schema applied: ${out.ran} statements in ${out.ms}ms (${out.hash.slice(0, 12)})`);
  } catch (e: any) {
    seoModule.enabled = false;
    seoModule.reason = `The SEO schema step failed at boot: ${e?.message ?? e}`;
    console.error(`[seo] ${seoModule.reason} — booting WITHOUT the SEO module (/api/seo answers 503, no SEO worker). Fix the statement and restart; the step is idempotent.`);
    void recordFailure("server", "SEO schema at boot", e, { statement: e?.statement ?? null }, "critical");
    app.use("/api/seo", seoUnavailableHandler as any);
    return false;
  }
  const registerRoutes = deps.registerRoutes ?? (await import("./routes")).registerSeoRoutes;
  registerRoutes(app, auth);
  const startWorker = deps.startWorker ?? (await import("./jobs")).startSeoWorker;
  const timer = startWorker();
  if (timer) onShutdown("seo worker", () => clearInterval(timer));
  return true;
}
