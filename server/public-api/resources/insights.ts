/**
 * /api/v1/insights — daily Business Profile Performance metrics as synced (gbp_daily_metrics),
 * one row per day with every metric, plus totals for the range. `?locationId=` is required here;
 * /locations/{id}/insights is the same data nested.
 */
import { z } from "zod";
import { pool } from "../../db";
import { OPENAPI, handler, isoDate, positiveId, requireLocation, resource, sendList } from "./_shared";

/** The metrics the Google sync stores (server/gbp/client.ts METRICS); the API never calls Google itself. */
export const METRIC_NAMES = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "WEBSITE_CLICKS", "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS",
] as const;

/** Google serves ~18 months of daily metrics; one request may ask for up to that. */
export const MAX_RANGE_DAYS = 548;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const insightsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  metric: z.string().max(60).optional(),
}).transform((q) => {
  const to = q.to ?? ymd(new Date());
  const from = q.from ?? ymd(new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86_400_000));
  return { ...q, from, to };
}).superRefine((q, ctx) => {
  const a = new Date(`${q.from}T00:00:00Z`).getTime(), b = new Date(`${q.to}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) ctx.addIssue({ code: "custom", message: "Invalid date", path: ["from"] });
  else if (a > b) ctx.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
  else if ((b - a) / 86_400_000 >= MAX_RANGE_DAYS) ctx.addIssue({ code: "custom", message: `Range is limited to ${MAX_RANGE_DAYS} days`, path: ["to"] });
  if (q.metric && !(METRIC_NAMES as readonly string[]).includes(q.metric)) {
    ctx.addIssue({ code: "custom", message: `Unknown metric; one of ${METRIC_NAMES.join(", ")}`, path: ["metric"] });
  }
});
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

export const INSIGHTS_PARAMS = [
  OPENAPI.query("from", { type: "string", format: "date" }, "First day (default: 29 days before `to`)"),
  OPENAPI.query("to", { type: "string", format: "date" }, "Last day (default: today, UTC)"),
  OPENAPI.query("metric", { type: "string", enum: [...METRIC_NAMES] }, "One metric only"),
];

export const INSIGHTS_SCHEMA = { type: "object", properties: {
  date: { type: "string", format: "date" },
  metrics: { type: "object", additionalProperties: { type: "integer" }, description: `Keys: ${METRIC_NAMES.join(", ")}` },
} };

/** Days with at least one stored metric in the range, oldest first, plus per-metric totals. */
export async function insightsFor(locationId: number, q: InsightsQuery) {
  const values: unknown[] = [locationId, q.from, q.to];
  let metricSql = "";
  if (q.metric) { values.push(q.metric); metricSql = " AND metric=$4"; }
  const { rows } = await pool.query(
    `SELECT date::text AS date, metric, value::text AS value FROM gbp_daily_metrics
      WHERE location_id=$1 AND date BETWEEN $2::date AND $3::date${metricSql} ORDER BY date, metric`, values);
  const byDay = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const n = Number(r.value) || 0;
    let day = byDay.get(r.date);
    if (!day) { day = {}; byDay.set(r.date, day); }
    day[r.metric] = n;
    totals[r.metric] = (totals[r.metric] ?? 0) + n;
  }
  const days = [...byDay.entries()].map(([date, metrics]) => ({ date, metrics }));
  return { days, totals, range: { from: q.from, to: q.to } };
}

export const insightsResource = resource("insights", {
  tags: [{ name: "Insights", description: "Daily Business Profile metrics (impressions, website clicks, calls, direction requests)." }],
  paths: {
    "/insights": { get: {
      tags: ["Insights"], summary: "Daily metrics for one location", operationId: "listInsights",
      parameters: [OPENAPI.workspaceParam, { ...OPENAPI.query("locationId", { type: "integer" }), required: true }, ...INSIGHTS_PARAMS],
      responses: { ...OPENAPI.list("#/components/schemas/InsightDay", {
        totals: { type: "object", additionalProperties: { type: "integer" } },
        range: { type: "object", properties: { from: { type: "string", format: "date" }, to: { type: "string", format: "date" } } },
      }), 400: OPENAPI.errors[400], 401: OPENAPI.errors[401], 403: OPENAPI.errors[403], 404: OPENAPI.errors[404], 429: OPENAPI.errors[429] },
    } },
  },
  components: { schemas: { ...OPENAPI.baseSchemas, InsightDay: INSIGHTS_SCHEMA } },
}, (r) => {
  r.get("/", handler(async (req, res, scope) => {
    const { locationId } = z.object({ locationId: positiveId }).parse(req.query ?? {});
    const q = insightsQuerySchema.parse(req.query ?? {});
    await requireLocation(scope, locationId);
    const { days, totals, range } = await insightsFor(locationId, q);
    sendList(res, days, days.length, { limit: Math.max(1, days.length), offset: 0 }, { totals, range });
  }));
});
