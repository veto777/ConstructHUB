/**
 * The issue desk's HTTP surface (docs/ops/ISSUE-DESK.md):
 *
 *   admin (platform admins only — requirePlatformAdmin, the same gate as the
 *   rest of /api/admin, second factor included where configured):
 *     GET  /api/admin/issues?status=&source=&limit=&offset=   newest first
 *     GET  /api/admin/issues/summary                          { new, fixReady, inspecting }
 *     GET  /api/admin/issues/:id                              detail, timeline, Claude's report
 *     POST /api/admin/issues/:id/status { status: fixed | ignored | new }
 *
 *   tower (bearer ISSUE_DESK_SECRET, internal-auth.ts):
 *     GET  /api/ops-internal/issues?status=new[&limit=10][&claim=0]   claims → inspecting (claim=0 peeks)
 *     POST /api/ops-internal/issues/:id/report { status, report, branch? }
 *     POST /api/ops-internal/runs/:runId/complete { ids }             the bell, only for issues with news
 *
 *   browser:
 *     POST /api/ops/client-error   (client-errors.ts)
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ISSUE_ADMIN_STATUSES, ISSUE_REPORT_STATUSES, ISSUE_SOURCES, ISSUE_STATUSES } from "@shared/ops-issues";
import { requirePlatformAdmin } from "../crm/admin";
import {
  claimIssues, getIssue, issueSummary, listIssues, MAX_CLAIM, peekNewIssues, reportIssue, setIssueStatusByAdmin,
} from "./issues";
import { OPS_INTERNAL_PATH, requireIssueDesk } from "./internal-auth";
import { registerClientErrorRoute, type ClientErrorOptions } from "./client-errors";
import { completeRun, type sendRunDigest } from "./digest";
import { maskEmailAddress } from "./scrub";
import type { Queryable } from "./schema";

type GetUser = (req: any, res: any) => any;

export type OpsRouteOptions = {
  /** The database (tests pass a pool scoped to their own schema). */
  pool?: Queryable;
  clientErrors?: ClientErrorOptions;
  deliver?: Parameters<typeof sendRunDigest>[2]["deliver"];
};

const idParam = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const listQuery = z.object({
  status: z.enum(ISSUE_STATUSES).optional(),
  source: z.enum(ISSUE_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const adminStatusBody = z.object({ status: z.enum(ISSUE_ADMIN_STATUSES) }).strict();
const reportBody = z.object({
  status: z.enum(ISSUE_REPORT_STATUSES),
  report: z.string().trim().min(1).max(20_000),
  branch: z.string().trim().regex(/^[A-Za-z0-9._/-]{1,120}$/).nullable().optional(),
}).strict().refine((b) => b.status !== "fix_ready" || !!b.branch, { message: "A fix_ready report names its branch", path: ["branch"] });
const claimQuery = z.object({
  status: z.literal("new").default("new"),
  limit: z.coerce.number().int().min(1).max(MAX_CLAIM).default(MAX_CLAIM),
  claim: z.enum(["0", "1"]).default("1"),
});
const runIdParam = z.string().regex(/^[A-Za-z0-9-]{6,64}$/);
const completeBody = z.object({ ids: z.array(z.number().int().positive()).max(50).default([]) });

const failed = (res: Response, what: string, e: unknown) => {
  console.error(`[issues] ${what} failed:`, (e as Error)?.message ?? e);
  if (!res.headersSent) res.status(500).json({ message: `Could not ${what}. Try again.` });
};

export function registerOpsIssueRoutes(app: Express, getDevUser: GetUser, opts: OpsRouteOptions = {}): void {
  const q = opts.pool;

  // ── admin ──────────────────────────────────────────────────────────────────
  app.get("/api/admin/issues/summary", async (req: Request, res: Response) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    res.setHeader("Cache-Control", "no-store");
    try { res.json(await issueSummary(q)); } catch (e) { failed(res, "count the issues", e); }
  });

  app.get("/api/admin/issues", async (req: Request, res: Response) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    res.setHeader("Cache-Control", "no-store");
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Unknown status or source filter" });
    try { res.json(await listIssues(parsed.data, q)); } catch (e) { failed(res, "list the issues", e); }
  });

  app.get("/api/admin/issues/:id", async (req: Request, res: Response) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    res.setHeader("Cache-Control", "no-store");
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such issue" });
    try {
      const issue = await getIssue(id.data, q);
      if (!issue) return res.status(404).json({ message: "No such issue" });
      res.json(issue);
    } catch (e) { failed(res, "load the issue", e); }
  });

  app.post("/api/admin/issues/:id/status", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such issue" });
    const body = adminStatusBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Status must be fixed, ignored or new" });
    try {
      const issue = await setIssueStatusByAdmin(id.data, body.data.status, maskEmailAddress(String(admin.email ?? "")), q);
      if (!issue) return res.status(404).json({ message: "No such issue" });
      res.json(issue);
    } catch (e) { failed(res, "update the issue", e); }
  });

  // ── tower ──────────────────────────────────────────────────────────────────
  app.get(`${OPS_INTERNAL_PATH}/issues`, requireIssueDesk, async (req: Request, res: Response) => {
    const parsed = claimQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ code: "invalid", message: "Only ?status=new is claimable" });
    try {
      const issues = parsed.data.claim === "1" ? await claimIssues(parsed.data.limit, q) : await peekNewIssues(parsed.data.limit, q);
      res.json({ claimed: parsed.data.claim === "1", issues });
    } catch (e) { failed(res, "claim issues", e); }
  });

  app.post(`${OPS_INTERNAL_PATH}/issues/:id/report`, requireIssueDesk, async (req: Request, res: Response) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ code: "not_found" });
    const body = reportBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ code: "invalid", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    try {
      const out = await reportIssue(id.data, body.data, q);
      if ("error" in out) {
        return out.error === "not_found"
          ? res.status(404).json({ code: "not_found" })
          : res.status(409).json({ code: "not_claimed", status: out.status, message: "This issue is not being inspected (an admin changed it, or it was never claimed)." });
      }
      res.json({ id: out.issue.id, status: out.issue.status });
    } catch (e) { failed(res, "store the report", e); }
  });

  app.post(`${OPS_INTERNAL_PATH}/runs/:runId/complete`, requireIssueDesk, async (req: Request, res: Response) => {
    const runId = runIdParam.safeParse(req.params.runId);
    const body = completeBody.safeParse(req.body ?? {});
    if (!runId.success || !body.success) return res.status(400).json({ code: "invalid" });
    try {
      const db = q ?? (await import("../db")).pool;
      // Only issues with news reach the bell; a run with nothing new notifies no one (digest.ts).
      res.json(await completeRun(runId.data, body.data.ids, { q: db, deliver: opts.deliver }));
    } catch (e) { failed(res, "send the digest", e); }
  });

  // ── browser ────────────────────────────────────────────────────────────────
  registerClientErrorRoute(app, opts.clientErrors);
}
