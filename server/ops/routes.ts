/**
 * The issue desk's HTTP surface (docs/ops/ISSUE-DESK.md):
 *
 *   admin (platform admins only — requirePlatformAdmin, the same gate as the
 *   rest of /api/admin, second factor included where configured):
 *     GET  /api/admin/issues?status=&source=&limit=&offset=   newest first
 *     GET  /api/admin/issues/summary                          { new, fixReady, inspecting }
 *     GET  /api/admin/issues/:id                              detail, timeline, Claude's report
 *     POST /api/admin/issues/:id/status { status: fixed | ignored | new }
 *     POST /api/admin/issues/:id/reply  { reply }             a user report's answer to its reporter ("" clears it)
 *     GET  /api/admin/issues/:id/screenshot                   a user report's screenshot, from R2
 *
 *   tower (bearer ISSUE_DESK_SECRET, internal-auth.ts):
 *     GET  /api/ops-internal/issues?status=new[&limit=10][&claim=0][&source=user]   claims → inspecting (claim=0 peeks);
 *                                                                     user reports first, blockers before everything
 *     POST /api/ops-internal/issues/:id/report { status, report, branch?, publicReply? }
 *     POST /api/ops-internal/issues/:id/release { why? }              a user report the run did not reach: back to new
 *     POST /api/ops-internal/user-reports/defer { why? }              a run skipped for the daily cap: marks the waiting user reports
 *     POST /api/ops-internal/runs/:runId/complete { ids }             the bell, only for issues with news
 *
 *   browser:
 *     POST /api/ops/client-error   (client-errors.ts)
 *     POST /api/issues/report · GET /api/issues/mine   a person's own report and their list (user-reports.ts)
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { ISSUE_ADMIN_STATUSES, ISSUE_REPORT_STATUSES, ISSUE_SOURCES, ISSUE_STATUSES } from "@shared/ops-issues";
import { requirePlatformAdmin } from "../crm/admin";
import type { OpsIssue } from "@shared/ops-issues";
import {
  claimIssues, deferUserReports, getIssue, issueSummary, listIssues, MAX_CLAIM, peekNewIssues, PUBLIC_REPLY_MAX, releaseUserReport,
  reportIssue, setIssueStatusByAdmin, setPublicReply,
} from "./issues";
import { registerUserReportRoutes, type UserReportOptions } from "./user-reports";
import { OPS_INTERNAL_PATH, requireIssueDesk } from "./internal-auth";
import { registerClientErrorRoute, type ClientErrorOptions } from "./client-errors";
import { completeRun, type sendRunDigest } from "./digest";
import { maskEmailAddress } from "./scrub";
import { lastDiskStatus } from "./disk";
import type { Queryable } from "./schema";

type GetUser = (req: any, res: any) => any;

export type OpsRouteOptions = {
  /** The database (tests pass a pool scoped to their own schema). */
  pool?: Queryable;
  clientErrors?: ClientErrorOptions;
  deliver?: Parameters<typeof sendRunDigest>[2]["deliver"];
  userReports?: UserReportOptions;
  /** Reads a stored screenshot (tests; default R2). */
  readScreenshot?: (key: string) => Promise<{ body: any; contentType: string }>;
};

/** What the tower (and so Claude) gets: never the reporter's address — a report refers to people by role. */
const forDesk = ({ reporterEmail: _e, ...issue }: OpsIssue) => ({ ...issue, reporter: issue.source === "user" ? (issue.reporterUserId ? "a signed-in user" : "a signed-out visitor") : undefined });

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
  publicReply: z.string().trim().max(4000).nullable().optional(),
}).strict().refine((b) => b.status !== "fix_ready" || !!b.branch, { message: "A fix_ready report names its branch", path: ["branch"] });
const claimQuery = z.object({
  status: z.literal("new").default("new"),
  limit: z.coerce.number().int().min(1).max(MAX_CLAIM).default(MAX_CLAIM),
  claim: z.enum(["0", "1"]).default("1"),
  source: z.literal("user").optional(),
});
const replyBody = z.object({ reply: z.string().trim().max(PUBLIC_REPLY_MAX) }).strict();
const whyBody = z.object({ why: z.string().trim().max(80).optional() }).strict();
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
    // `host.disk`: the newest free-space reading (server/ops/disk.ts), for the banner at the top of /admin/issues.
    try { res.json({ ...(await listIssues(parsed.data, q)), host: { disk: lastDiskStatus() } }); } catch (e) { failed(res, "list the issues", e); }
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

  app.post("/api/admin/issues/:id/reply", async (req: Request, res: Response) => {
    const admin = await requirePlatformAdmin(req, res, getDevUser);
    if (!admin) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such issue" });
    const body = replyBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: `A reply is at most ${PUBLIC_REPLY_MAX} characters` });
    try {
      const out = await setPublicReply(id.data, body.data.reply, maskEmailAddress(String(admin.email ?? "")), q);
      if ("error" in out) {
        return out.error === "not_found"
          ? res.status(404).json({ message: "No such issue" })
          : res.status(400).json({ message: "Only a user report has a reporter to reply to" });
      }
      res.json(out.issue);
    } catch (e) { failed(res, "save the reply", e); }
  });

  app.get("/api/admin/issues/:id/screenshot", async (req: Request, res: Response) => {
    if (!(await requirePlatformAdmin(req, res, getDevUser))) return;
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ message: "No such issue" });
    try {
      const issue = await getIssue(id.data, q);
      const shot = issue?.source === "user" ? (issue.detail?.screenshot as { key?: unknown } | null) : null;
      const key = typeof shot?.key === "string" && /^issue-reports\/[A-Za-z0-9-]+\.(png|jpg|webp|gif)$/.test(shot.key) ? shot.key : null;
      if (!key) return res.status(404).json({ message: "This report has no screenshot" });
      const read = opts.readScreenshot ?? (async (k: string) => (await import("../r2")).getFromR2(k));
      const { body, contentType } = await read(key);
      if (!body) return res.status(404).json({ message: "The screenshot is no longer stored" });
      res.setHeader("Content-Type", /^image\/(png|jpeg|webp|gif)$/.test(contentType) ? contentType : "application/octet-stream");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      if (Buffer.isBuffer(body)) return res.end(body);
      if (typeof body.pipe === "function") return void body.pipe(res);
      if (typeof body[Symbol.asyncIterator] === "function") { for await (const chunk of body) res.write(chunk); return res.end(); }
      res.end(Buffer.from(await body.arrayBuffer()));
    } catch (e) {
      if ((e as any)?.name === "NoSuchKey" || (e as any)?.$metadata?.httpStatusCode === 404) return res.status(404).json({ message: "The screenshot is no longer stored" });
      failed(res, "load the screenshot", e);
    }
  });

  // ── tower ──────────────────────────────────────────────────────────────────
  app.get(`${OPS_INTERNAL_PATH}/issues`, requireIssueDesk, async (req: Request, res: Response) => {
    const parsed = claimQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ code: "invalid", message: "Only ?status=new is claimable" });
    try {
      const only = { source: parsed.data.source };
      const issues = parsed.data.claim === "1" ? await claimIssues(parsed.data.limit, q, only) : await peekNewIssues(parsed.data.limit, q, only);
      res.json({ claimed: parsed.data.claim === "1", issues: issues.map(forDesk) });
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

  // A user report the run never reached keeps reading "Received" and is first in the next run.
  app.post(`${OPS_INTERNAL_PATH}/issues/:id/release`, requireIssueDesk, async (req: Request, res: Response) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ code: "not_found" });
    const body = whyBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ code: "invalid" });
    try {
      const out = await releaseUserReport(id.data, body.data.why || "run ended first", q);
      if ("error" in out) return res.status(out.error === "not_found" ? 404 : 409).json({ code: out.error, status: out.status });
      res.json({ id: out.issue.id, status: out.issue.status });
    } catch (e) { failed(res, "release the report", e); }
  });

  // The daily cap skipped a run while user reports wait: say so on each one's timeline.
  app.post(`${OPS_INTERNAL_PATH}/user-reports/defer`, requireIssueDesk, async (req: Request, res: Response) => {
    const body = whyBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ code: "invalid" });
    try { res.json({ deferred: await deferUserReports(body.data.why || "daily run cap", q) }); } catch (e) { failed(res, "mark the waiting reports", e); }
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
  registerUserReportRoutes(app, { pool: q, ...opts.userReports });
}
