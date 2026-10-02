/**
 * Server-side capture for the issue desk (server/index.ts wires these):
 *
 *   recordUnhandledError — the Express error handler, for any 5xx: method +
 *     route + status + the error's identity (name, normalized message, top
 *     frames) make the fingerprint; the stack goes into the detail.
 *   watchHandledFailures — a response a route answered 500 by itself (it
 *     caught and logged its own error): method + route; the app journal has
 *     the logged cause. Skipped when the error handler already recorded it.
 *   recordProcessFailure — uncaughtException / unhandledRejection.
 */
import type { NextFunction, Request, Response } from "express";
import { errorFacts } from "./scrub";
import { errorKey, normalizePath, recordIssue, shortMessage, type IssueInput } from "./issues";

/** The route pattern that matched (/api/crm/estimates/:id), else the normalized path. */
export function routeOf(req: Request): string {
  const pattern = (req as any).route?.path;
  if (typeof pattern === "string") return `${req.baseUrl || ""}${pattern}`.slice(0, 200);
  return normalizePath(req.originalUrl || req.path);
}

const RECORDED = Symbol.for("constructhub.opsIssueRecorded");

type RecordFn = (input: IssueInput) => Promise<void>;

/** The three capture points, bound to a recorder (the app's recordIssue; tests pass their own). */
export function createServerErrorCapture(record: RecordFn = recordIssue) {
  function recordUnhandledError(req: Request, res: Response, err: unknown, status: number): void {
    try {
      if (status < 500) return;
      (res.locals as any)[RECORDED] = true;
      const route = routeOf(req);
      void record({
        source: "server",
        severity: status === 500 ? "error" : "warning",
        key: `${req.method} ${route}|${status}|${errorKey(err)}`,
        title: `${status} on ${req.method} ${route}: ${shortMessage(err)}`,
        detail: { method: req.method, route, status, path: normalizePath(req.originalUrl || req.path), signedIn: !!(req as any).user, error: errorFacts(err) },
      });
    } catch { /* never in the way of the response */ }
  }

  /** Mounted early (server/index.ts): records a 500 a route answered by itself. */
  function watchHandledFailures(req: Request, res: Response, next: NextFunction): void {
    res.on("finish", () => {
      try {
        if (res.statusCode !== 500 || (res.locals as any)[RECORDED]) return;
        const route = routeOf(req);
        void record({
          source: "server",
          key: `${req.method} ${route}|500|handled`,
          title: `500 on ${req.method} ${route}`,
          detail: {
            method: req.method, route, status: 500, path: normalizePath(req.originalUrl || req.path), signedIn: !!(req as any).user,
            note: "The route caught its own error and answered 500; the app journal has the logged cause at this time.",
          },
        });
      } catch { /* nothing */ }
    });
    next();
  }

  function recordProcessFailure(kind: "uncaughtException" | "unhandledRejection", err: unknown): void {
    try {
      void record({
        source: "server",
        severity: kind === "uncaughtException" ? "critical" : "error",
        key: `${kind}|${errorKey(err)}`,
        title: `${kind === "uncaughtException" ? "Uncaught exception" : "Unhandled promise rejection"}: ${shortMessage(err)}`,
        detail: { kind, error: errorFacts(err) },
      });
    } catch { /* nothing */ }
  }

  return { recordUnhandledError, watchHandledFailures, recordProcessFailure };
}

export const { recordUnhandledError, watchHandledFailures, recordProcessFailure } = createServerErrorCapture();
