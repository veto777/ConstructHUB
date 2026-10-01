/**
 * Monthly units: the plan's apiUnitsPerMonth for the whole account, and an
 * optional per-key cap below it. Checked before the handler with the call's
 * base cost; the actual cost (reads grow with the rows returned) is checked
 * again before sending. Each account is serialized through metering so
 * concurrent keys cannot spend the same remaining units twice.
 *
 *   read  = READ_UNITS + floor(rows / ROWS_PER_UNIT)
 *   write = WRITE_UNITS
 *
 * Only successful responses (status < 400) are metered. Rows come from
 * res.locals.apiRows when the handler sets it, else from a top-level array
 * or a `data` / `items` / `results` array in the JSON body.
 */
import type { Request, RequestHandler, Response } from "express";
import { apiMonthResetsAt, monthlyUsage, recordUnits } from "../account/api-keys";
import type { PublicApiContext } from "./auth";
import { apiError } from "./errors";

export const READ_UNITS = 1;
export const ROWS_PER_UNIT = 100;
export const WRITE_UNITS = 5;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const isWriteMethod = (method: string) => !READ_METHODS.has(String(method).toUpperCase());

export function unitsFor(method: string, rows = 0): number {
  if (isWriteMethod(method)) return WRITE_UNITS;
  return READ_UNITS + Math.floor(Math.max(0, Math.floor(rows)) / ROWS_PER_UNIT);
}

export function inferRows(body: unknown): number {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === "object") {
    for (const k of ["data", "items", "results"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.length;
    }
  }
  return 0;
}

// Like billing changes and rate-limit windows, this lock is per process: the
// production app runs one process. A multi-process deployment must move this
// critical section to a shared reservation store before enabling replicas.
const accountTurns = new Map<number, Promise<void>>();
async function acquireTurn(userId: number): Promise<() => void> {
  const prior = accountTurns.get(userId) ?? Promise.resolve();
  let resolve!: () => void;
  const mine = new Promise<void>((done) => { resolve = done; });
  const tail = prior.then(() => mine);
  accountTurns.set(userId, tail);
  await prior;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resolve();
    if (accountTurns.get(userId) === tail) accountTurns.delete(userId);
  };
}

export const quota: RequestHandler = async (req, res, next) => {
  const ctx = req.publicApi;
  if (!ctx) return apiError(res, 401, "unauthorized", "Authenticate with an API key first.");
  let release: (() => void) | undefined;
  try {
    if (ctx.plan.unitsPerMonth <= 0) {
      res.setHeader("X-Units-Remaining", "0");
      return apiError(res, 402, "plan_required", ctx.plan.key
        ? `API access is included with the ${ctx.plan.requiredPlan[0].toUpperCase()}${ctx.plan.requiredPlan.slice(1)} plan and above. Upgrade in Pricing to use it.`
        : "This account has no active plan. API access is included with a paid plan.", { requiredPlan: ctx.plan.requiredPlan });
    }
    release = await acquireTurn(ctx.userId);
    if (res.destroyed) { release(); return; }
    const used = await monthlyUsage(ctx.key.id, ctx.userId);
    const cost = unitsFor(req.method);
    const planLeft = ctx.plan.unitsPerMonth - used.user;
    const keyLeft = ctx.key.monthlyUnitLimit == null ? Number.POSITIVE_INFINITY : ctx.key.monthlyUnitLimit - used.key;
    const left = Math.min(planLeft, keyLeft);
    const refuse = () => {
      const resetsAt = apiMonthResetsAt();
      const byKey = keyLeft < planLeft;
      res.setHeader("X-Units-Remaining", "0");
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((new Date(resetsAt).getTime() - Date.now()) / 1000))));
      return apiError(res, 429, "quota_exceeded", byKey
        ? `This request exceeds this key's monthly limit of ${ctx.key.monthlyUnitLimit} units. It resets on ${resetsAt.slice(0, 10)}; raise the key's limit in Account → API keys.`
        : `This request exceeds this month's ${ctx.plan.unitsPerMonth} API units. They reset on ${resetsAt.slice(0, 10)}.`, {
        scope: byKey ? "key" : "plan",
        limit: byKey ? ctx.key.monthlyUnitLimit : ctx.plan.unitsPerMonth,
        used: byKey ? used.key : used.user,
        resetsAt,
      });
    };
    if (left < cost) { release(); return refuse(); }
    res.setHeader("X-Units-Remaining", String(Math.max(0, Math.floor(left - cost))));
    installMetering(req, res, ctx, left, refuse, release);
    next();
  } catch (e) {
    release?.();
    next(e);
  }
};

/** Keep the account's turn until its successful response is durably metered. */
function installMetering(req: Request, res: Response, ctx: PublicApiContext, left: number, refuse: () => unknown, release: () => void) {
  let metering: Promise<void> | undefined;
  const json = res.json.bind(res);
  const meter = (body?: unknown, sendJson = false): Promise<void> => {
    if (metering) return metering;
    metering = (async () => {
      try {
        if (res.statusCode < 400) {
          const hint = res.locals.apiRows ?? res.locals.apiRowCount;
          const rows = hint != null ? Number(hint) || 0 : inferRows(body);
          const units = unitsFor(req.method, rows);
          if (units > left) {
            // Restore the real sender before writing the error envelope.
            res.json = json;
            if (!res.headersSent && !res.destroyed) refuse();
            return;
          }
          await recordUnits(ctx.key.id, ctx.userId, units);
          res.locals.apiUnits = units;
          if (!res.headersSent) res.setHeader("X-Units-Remaining", String(Math.max(0, Math.floor(left - units))));
        } else if (!res.headersSent) {
          res.setHeader("X-Units-Remaining", String(Math.max(0, Math.floor(left))));
        }
        if (sendJson && !res.destroyed) json(body);
      } catch (e: any) {
        console.error("[public-api] metering failed:", e?.message || e);
        res.json = json;
        if (!res.headersSent && !res.destroyed) {
          apiError(res, 503, "internal_error", "API usage could not be recorded. Check the resource before retrying a write.");
        }
      } finally { release(); }
    })();
    return metering;
  };
  res.json = ((body?: unknown) => { void meter(body, true); return res; }) as Response["json"];
  // Non-JSON responses (e.g. 204) and disconnected callers must also settle
  // their accepted work and release the turn. The shared promise meters once.
  res.once("finish", () => { void meter(); });
  res.once("close", () => { void meter(); });
}
