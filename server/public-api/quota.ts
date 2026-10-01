/**
 * Monthly units: the plan's apiUnitsPerMonth for the whole account, and an
 * optional per-key cap below it. Checked before the handler with the call's
 * base cost; the actual cost (reads grow with the rows returned) is recorded
 * when the response is sent, so a big page shows up on the next call.
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

export const quota: RequestHandler = async (req, res, next) => {
  const ctx = req.publicApi;
  if (!ctx) return apiError(res, 401, "unauthorized", "Authenticate with an API key first.");
  try {
    if (ctx.plan.unitsPerMonth <= 0) {
      res.setHeader("X-Units-Remaining", "0");
      return apiError(res, 402, "plan_required", ctx.plan.key
        ? `API access is included with the ${ctx.plan.requiredPlan[0].toUpperCase()}${ctx.plan.requiredPlan.slice(1)} plan and above. Upgrade in Pricing to use it.`
        : "This account has no active plan. API access is included with a paid plan.", { requiredPlan: ctx.plan.requiredPlan });
    }
    const used = await monthlyUsage(ctx.key.id, ctx.userId);
    const cost = unitsFor(req.method);
    const planLeft = ctx.plan.unitsPerMonth - used.user;
    const keyLeft = ctx.key.monthlyUnitLimit == null ? Number.POSITIVE_INFINITY : ctx.key.monthlyUnitLimit - used.key;
    const left = Math.min(planLeft, keyLeft);
    if (left < cost) {
      const resetsAt = apiMonthResetsAt();
      const byKey = keyLeft < planLeft;
      res.setHeader("X-Units-Remaining", "0");
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((new Date(resetsAt).getTime() - Date.now()) / 1000))));
      return apiError(res, 429, "quota_exceeded", byKey
        ? `This key's monthly limit of ${ctx.key.monthlyUnitLimit} units is used up. It resets on ${resetsAt.slice(0, 10)}; raise the key's limit in Account → API keys.`
        : `This month's ${ctx.plan.unitsPerMonth} API units are used up. They reset on ${resetsAt.slice(0, 10)}.`, {
        scope: byKey ? "key" : "plan",
        limit: byKey ? ctx.key.monthlyUnitLimit : ctx.plan.unitsPerMonth,
        used: byKey ? used.key : used.user,
        resetsAt,
      });
    }
    res.setHeader("X-Units-Remaining", String(Math.max(0, Math.floor(left - cost))));
    installMetering(req, res, ctx);
    next();
  } catch (e) {
    next(e);
  }
};

/** Record the call's units once, when the response goes out. */
function installMetering(req: Request, res: Response, ctx: PublicApiContext) {
  let metered = false;
  const meter = (body?: unknown): Promise<void> => {
    if (metered) return Promise.resolve();
    metered = true;
    if (res.statusCode >= 400) return Promise.resolve();
    const rows = res.locals.apiRows != null ? Number(res.locals.apiRows) || 0 : inferRows(body);
    const units = unitsFor(req.method, rows);
    res.locals.apiUnits = units;
    return recordUnits(ctx.key.id, ctx.userId, units).catch((e: any) => console.error("[public-api] metering failed:", e?.message || e));
  };
  // res.send(object) delegates to res.json, so this covers both.
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    // The real send runs after the meter row is written. A handler that sends
    // twice would make the second send throw ("headers already sent") inside
    // this callback: catch it here, where there is no router try/catch any more.
    void meter(body).finally(() => {
      try { json(body); } catch (e: any) { console.error("[public-api] send failed:", e?.message || e); }
    });
    return res;
  }) as Response["json"];
  res.on("finish", () => { void meter(); });
}
