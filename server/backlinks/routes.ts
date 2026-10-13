/**
 * The Backlinks database's admin surface (platform admins only — requirePlatformAdmin, second factor included):
 *
 *   GET  /api/admin/backlinks/summary                        progress to the goal, counts, spend, what is configured
 *   GET  /api/admin/backlinks/sources?kind&status&tier&q&quality&limit&offset
 *   GET  /api/admin/backlinks/sources/:id                    detail: signals, metrics, reasons, events, outreach
 *   POST /api/admin/backlinks/sources/:id/status {status, priceUsd?, turnaroundDays?, notes?}
 *   POST /api/admin/backlinks/sources/:id/recheck            back through vetting
 *   POST /api/admin/backlinks/import {kind, lines}           an admin's own list (domains or URLs, one per line)
 *   POST /api/admin/backlinks/run {step}                     run one step now: discover | vet | measure | draft
 *   POST /api/admin/backlinks/outreach/:id/approve           a draft → approved (sent by the worker when sending is on)
 *
 * Nothing here is customer-facing: selling packages starts once the database reaches the goal.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { BACKLINK_ADMIN_STATUSES, BACKLINK_KINDS, BACKLINK_STATUSES, BACKLINK_TIERS } from "@shared/backlinks";
import { requirePlatformAdmin } from "../crm/admin";
import { isConfigured } from "../seo/dataforseo";
import * as store from "./store";
import { parseImportLine } from "./discover";
import { outreachConfig, sendBlocker } from "./outreach";
import { runDiscovery, runDrafts, runMetrics, runVetting, workerConfig } from "./worker";

type GetUser = (req: any, res: any) => any;

const idParam = z.coerce.number().int().positive().max(2_147_483_647);
const listQuery = z.object({
  kind: z.enum(BACKLINK_KINDS).optional(),
  status: z.enum(BACKLINK_STATUSES).optional(),
  tier: z.enum(BACKLINK_TIERS).optional(),
  q: z.string().trim().max(100).optional(),
  quality: z.enum(["0", "1"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
const statusBody = z.object({
  status: z.enum(BACKLINK_ADMIN_STATUSES),
  priceUsd: z.number().min(0).max(100_000).nullable().optional(),
  turnaroundDays: z.number().int().min(0).max(365).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
const importBody = z.object({
  kind: z.enum(BACKLINK_KINDS).refine((k) => k !== "pbn", "PBNs are not imported"),
  lines: z.string().max(500_000),
}).strict();
const runBody = z.object({ step: z.enum(["discover", "vet", "measure", "draft"]) }).strict();

const failed = (res: Response, what: string, e: unknown) => {
  console.error(`[backlinks] ${what} failed:`, (e as Error)?.message ?? e);
  if (!res.headersSent) res.status(500).json({ message: `Could not ${what}. Try again.` });
};

export const IMPORT_MAX = 5000;

export function registerBacklinkRoutes(app: Express, getDevUser: GetUser): void {
  const admin = (req: Request, res: Response) => requirePlatformAdmin(req, res, getDevUser);

  app.get("/api/admin/backlinks/summary", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "no-store");
    const cfg = workerConfig();
    try {
      res.json(await store.summary(cfg.capUsd, { dataSource: isConfigured(), worker: cfg.enabled, outreachSend: sendBlocker(outreachConfig()) === null }));
    } catch (e) { failed(res, "load the summary", e); }
  });

  app.get("/api/admin/backlinks/sources", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "no-store");
    const p = listQuery.safeParse(req.query);
    if (!p.success) return res.status(400).json({ message: "Unknown filter" });
    try { res.json(await store.listSources({ ...p.data, quality: p.data.quality === "1" })); } catch (e) { failed(res, "list the sources", e); }
  });

  app.get("/api/admin/backlinks/sources/:id", async (req, res) => {
    if (!(await admin(req, res))) return;
    res.setHeader("Cache-Control", "no-store");
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such source" });
    try {
      const s = await store.getSource(id.data);
      if (!s) return res.status(404).json({ message: "No such source" });
      res.json(s);
    } catch (e) { failed(res, "load the source", e); }
  });

  app.post("/api/admin/backlinks/sources/:id/status", async (req, res) => {
    const a = await admin(req, res);
    if (!a) return;
    const id = idParam.safeParse(req.params.id);
    const body = statusBody.safeParse(req.body);
    if (!id.success) return res.status(404).json({ message: "No such source" });
    if (!body.success) return res.status(400).json({ message: "Check the status, price and turnaround" });
    try {
      const { status, ...patch } = body.data;
      if (!(await store.setStatus(id.data, status, a.id, patch))) return res.status(404).json({ message: "No such source" });
      res.json(await store.getSource(id.data));
    } catch (e) { failed(res, "update the source", e); }
  });

  app.post("/api/admin/backlinks/sources/:id/recheck", async (req, res) => {
    if (!(await admin(req, res))) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such source" });
    try {
      if (!(await store.requeue(id.data))) return res.status(409).json({ message: "It is being vetted right now, or it does not exist." });
      res.json({ ok: true });
    } catch (e) { failed(res, "re-check the source", e); }
  });

  app.post("/api/admin/backlinks/import", async (req, res) => {
    const a = await admin(req, res);
    if (!a) return;
    const body = importBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Pick a kind and paste domains or URLs" });
    const seen = new Set<string>();
    const hits = body.data.lines.split(/\r?\n/).map(parseImportLine).filter((h): h is NonNullable<typeof h> => !!h && !seen.has(h.domain) && !!seen.add(h.domain));
    if (hits.length > IMPORT_MAX) return res.status(400).json({ message: `At most ${IMPORT_MAX} sites per import` });
    try {
      const added = await store.addCandidates(hits, body.data.kind, `import by admin ${a.id}`, null);
      res.json({ read: hits.length, added, alreadyKnown: hits.length - added });
    } catch (e) { failed(res, "import the list", e); }
  });

  app.post("/api/admin/backlinks/run", async (req, res) => {
    if (!(await admin(req, res))) return;
    const body = runBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Unknown step" });
    try {
      const step = body.data.step;
      if (step === "discover") return res.json(await runDiscovery(5));
      if (step === "vet") return res.json(await runVetting(25));
      if (step === "measure") return res.json(await runMetrics(undefined, true));
      return res.json(await runDrafts(50));
    } catch (e) { failed(res, "run that step", e); }
  });

  app.post("/api/admin/backlinks/outreach/:id/approve", async (req, res) => {
    const a = await admin(req, res);
    if (!a) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such draft" });
    try {
      const d = await store.approveDraft(id.data, a.id);
      if (!d) return res.status(409).json({ message: "That draft was already approved or sent." });
      res.json(d);
    } catch (e) { failed(res, "approve the draft", e); }
  });
}
