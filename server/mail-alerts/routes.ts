import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { rateLimit } from "../growth-limits";
import { requireMailModule } from "./gmail";
import { forwardingAddress } from "./service";
import { pageInput } from "../domains/routes";
import { SENDERS, REGISTRAR_SENDERS } from "./classify";
export function registerMailAlertRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
) {
  app.use("/api/mail-alerts", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // Agency-only module (Domains + Gmail alerts). The inbound mail webhook (/api/inbound-mail, inbound.ts) is
  // authenticated by its shared secret instead and is not under this path. Removing a saved Gmail connection
  // stays open without the plan (gmailRemovalRoute).
  app.use(
    "/api/mail-alerts",
    rateLimit("mail-alerts", 120, 300),
    requireMailModule(),
  );
  const route = (
    method: "get" | "post",
    path: string,
    fn: (req: Request, res: Response, id: number) => Promise<any>,
  ) =>
    app[method](`/api/mail-alerts${path}`, async (req, res) => {
      const u = auth(req, res);
      if (!u) return;
      try {
        await fn(req, res, u.id);
      } catch (e) {
        res
          .status(e instanceof z.ZodError ? 400 : 500)
          .json({
            message:
              e instanceof z.ZodError
                ? "Invalid mail alert input"
                : "Mail alert operation failed",
          });
      }
    });
  route("get", "/settings", async (req, res, id) => {
    const p = pageInput.parse(req.query);
    const { rows: grants } = await pool.query(
      "SELECT google_subject,email,needs_reconnect,last_error FROM mail_alert_grants WHERE user_id=$1 ORDER BY email LIMIT $2 OFFSET $3",
      [id, p.limit, (p.page - 1) * p.limit],
    );
    res.json({
      address: await forwardingAddress(id),
      oauthEnabled: process.env.GMAIL_OAUTH_ENABLED === "true",
      grants,
      senders: SENDERS,
      registrarSenders: REGISTRAR_SENDERS,
    });
  });
  route("get", "", async (req, res, id) => {
    const p = pageInput
      .extend({
        category: z
          .enum([
            "",
            "gbp",
            "gsc",
            "ads",
            "cloudflare",
            "registrar",
            "blotato",
            "forwarding",
          ])
          .default(""),
        severity: z.enum(["", "critical", "warning", "info"]).default(""),
      })
      .parse(req.query);
    const params = [
      id,
      `%${p.q}%`,
      p.category,
      p.severity,
      p.locationId || null,
    ];
    const filter =
      "user_id=$1 AND expires_at>now() AND (subject ILIKE $2 OR sender ILIKE $2) AND ($3='' OR category=$3) AND ($4='' OR severity=$4) AND ($5::int IS NULL OR location_id=$5)";
    const { rows } = await pool.query(
      `SELECT id,category,severity,sender,subject,body,confirmation_code,confirmation_link,domain_id,location_id,read_at,received_at FROM mail_alert_messages WHERE ${filter} ORDER BY received_at DESC,id DESC LIMIT $6 OFFSET $7`,
      [...params, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM mail_alert_messages WHERE ${filter}`,
      params,
    );
    res.json({ items: rows, total: n.total });
  });
  route("post", "/read", async (req, res, id) => {
    const b = z
      .object({ ids: z.array(z.number().int().positive()).min(1).max(100) })
      .strict()
      .parse(req.body);
    await pool.query(
      "UPDATE mail_alert_messages SET read_at=now() WHERE user_id=$1 AND id=ANY($2::bigint[])",
      [id, b.ids],
    );
    res.json({ ok: true });
  });
  route("post", "/mapping", async (req, res, id) => {
    const b = z
      .object({
        ids: z.array(z.number().int().positive()).min(1).max(100),
        locationId: z.number().int().positive().nullable(),
      })
      .strict()
      .parse(req.body);
    if (b.locationId) {
      const { rowCount } = await pool.query(
        "SELECT id FROM business_locations WHERE id=$1 AND user_id=$2",
        [b.locationId, id],
      );
      if (!rowCount)
        return res.status(404).json({ message: "Location not found" });
    }
    await pool.query(
      "UPDATE mail_alert_messages SET location_id=$3 WHERE user_id=$1 AND id=ANY($2::bigint[])",
      [id, b.ids, b.locationId],
    );
    res.json({ ok: true });
  });
  route("post", "/sync", async (_req, res, id) => {
    if (process.env.GMAIL_OAUTH_ENABLED !== "true")
      return res.status(404).json({ message: "Gmail OAuth is disabled" });
    await pool.query(
      "UPDATE mail_alert_grants SET next_sync=now() WHERE user_id=$1 AND NOT needs_reconnect",
      [id],
    );
    res.status(202).json({ queued: true });
  });
}
