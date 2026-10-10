/** Door recordings: anonymous writes, platform-admin-only reads, bounded append
 * storage. All decisions share this endpoint; the recorder is never verdict-gated. */
import express, { type Express, type Request, type Response } from "express";
import { pool } from "./db";
import { visitorIp } from "./route-guards";
import { requirePlatformAdmin } from "./crm/admin";
import { ADS_LANDING_PATHS } from "./ads-landing";

export const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
const JSON_LIMIT = 40 * 1024 * 1024;
const DDL = `CREATE TABLE IF NOT EXISTS ads_lp_rr (
  session_id uuid PRIMARY KEY, door text NOT NULL, ip text NOT NULL,
  hit_id bigint, started_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(), events jsonb NOT NULL,
  bytes integer NOT NULL, next_sequence integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ads_lp_rr_started_idx ON ads_lp_rr(started_at);
CREATE INDEX IF NOT EXISTS ads_lp_rr_hit_idx ON ads_lp_rr(hit_id);`;
let schema: Promise<unknown> | undefined;
const ready = () => schema ??= pool.query(DDL).catch(e => { schema = undefined; throw e; });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function recordingInput(body: any): boolean {
  return !!body && uuid.test(body.sessionId) && ADS_LANDING_PATHS.includes(body.door) &&
    Array.isArray(body.events) && body.events.length > 0 && body.events.length <= 10000 &&
    (body.sequence === undefined || (Number.isSafeInteger(body.sequence) && body.sequence >= 0)) &&
    body.events.every((event: any) => event && Number.isInteger(event.type) && event.type >= 0 && event.type <= 6 &&
      Number.isFinite(event.timestamp) && event.data && typeof event.data === "object");
}
const rates = new Map<string, { at: number; count: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  for (const [key, value] of rates) if (now - value.at >= 60000) rates.delete(key);
  const entry = rates.get(ip) ?? { at: now, count: 0 };
  if (!rates.has(ip) && rates.size >= 10000) return true;
  rates.set(ip, entry);
  return ++entry.count > 120;
}
async function admin(req: Request, res: Response) {
  return requirePlatformAdmin(req, res, (request: any, response: any) => {
    if (request.user) return request.user;
    response.status(401).json({ message: "Not authenticated" });
    return null;
  });
}

export async function pruneRecordings(): Promise<void> {
  const db = await pool.connect();
  try {
    // Same global lock as the Ads worker; skip a busy run and retry next night.
    const { rows: [lock] } = await db.query("SELECT pg_try_advisory_lock(8249,0) locked");
    if (!lock.locked) return;
    try { await db.query("DELETE FROM ads_lp_rr WHERE started_at < now()-interval '60 days'"); }
    finally { await db.query("SELECT pg_advisory_unlock(8249,0)"); }
  } finally { db.release(); }
}
let retentionStarted = false;
export function registerAdsLandingRecording(app: Express): void {
  void ready().catch(() => console.warn("[ads-lp] recording storage unavailable"));
  if (!retentionStarted) {
    retentionStarted = true;
    setInterval(() => void ready().then(pruneRecordings).catch(() => console.warn("[ads-lp] recording retention failed")), 24 * 3600e3).unref();
  }
  app.use("/api/ads-lp", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  app.post("/api/ads-lp/rr", (req, res, next) => {
    if (rateLimited(visitorIp(req))) return res.status(429).json({ message: "Too many recording batches" });
    // index.ts has already parsed JSON with a 50 MB cap in production.
    if (Number(req.headers["content-length"] || 0) > JSON_LIMIT ||
        ((req as any).rawBody?.length ?? 0) > JSON_LIMIT) return res.sendStatus(413);
    next();
  }, express.json({ limit: "40mb" }), async (req, res) => {
    if (!recordingInput(req.body)) return res.status(400).json({ message: "Invalid recording batch" });
    const { sessionId, door, events, sequence } = req.body;
    const encoded = JSON.stringify(events), bytes = Buffer.byteLength(encoded);
    if (bytes > MAX_RECORDING_BYTES) return res.sendStatus(413);
    const ip = visitorIp(req);
    try {
      await ready();
      // The conflict update serializes concurrent batches and enforces identity,
      // size, duration and ordering atomically. An initial delta cannot create a row.
      const { rows } = await pool.query(`INSERT INTO ads_lp_rr(session_id,door,ip,hit_id,events,bytes)
        SELECT $1,$2,$3,
          (SELECT id FROM ads_lp_hits WHERE ip=$3 AND door=$2 AND at BETWEEN now()-interval '5 minutes' AND now()
            AND reason<>'google_verified' ORDER BY at DESC LIMIT 1),$4::jsonb,$5
        WHERE ($6 AND ($7::integer IS NULL OR $7=0)) OR EXISTS(SELECT 1 FROM ads_lp_rr WHERE session_id=$1)
        ON CONFLICT(session_id) DO UPDATE SET
          events=ads_lp_rr.events || excluded.events, bytes=ads_lp_rr.bytes+excluded.bytes,
          last_at=now(), hit_id=COALESCE(ads_lp_rr.hit_id,excluded.hit_id), next_sequence=ads_lp_rr.next_sequence+1
        WHERE ads_lp_rr.ip=excluded.ip AND ads_lp_rr.door=excluded.door
          AND ads_lp_rr.bytes+excluded.bytes <= $8
          AND ads_lp_rr.started_at > now()-interval '30 minutes'
          AND ($7::integer IS NULL OR ads_lp_rr.next_sequence=$7)
        RETURNING session_id`, [sessionId, door, ip, encoded, bytes, events[0].type === 2, sequence ?? null, MAX_RECORDING_BYTES]);
      if (!rows.length) {
        // A retried acknowledged batch is harmless; never append it twice.
        if (sequence !== undefined) {
          const { rows: duplicates } = await pool.query(`SELECT 1 FROM ads_lp_rr WHERE session_id=$1 AND ip=$2 AND door=$3 AND next_sequence>$4`, [sessionId, ip, door, sequence]);
          if (duplicates.length) return res.sendStatus(204);
        }
        return res.status(409).json({ message: "Snapshot required, session full, expired, or batch out of order" });
      }
      return res.sendStatus(204);
    } catch {
      return res.status(503).json({ message: "Recording storage unavailable" });
    }
  });
  app.get("/api/ads-lp/hits", async (req, res) => {
    if (!(await admin(req, res))) return;
    await ready();
    const { rows } = await pool.query(`SELECT h.*, r.session_id FROM ads_lp_hits h
      LEFT JOIN LATERAL (SELECT session_id FROM ads_lp_rr WHERE hit_id=h.id OR
        (hit_id IS NULL AND ip=h.ip AND door=h.door AND started_at BETWEEN h.at-interval '5 minutes' AND h.at+interval '5 minutes')
        ORDER BY started_at DESC LIMIT 1) r ON true ORDER BY h.at DESC,h.id DESC LIMIT 200`);
    res.json({ items: rows });
  });
  app.get("/api/ads-lp/rr/:sessionId", async (req, res) => {
    if (!(await admin(req, res))) return;
    if (!uuid.test(String(req.params.sessionId))) return res.sendStatus(400);
    await ready();
    const { rows } = await pool.query("SELECT session_id,door,started_at,events FROM ads_lp_rr WHERE session_id=$1", [req.params.sessionId]);
    if (!rows.length) return res.sendStatus(404);
    res.json(rows[0]);
  });
}
