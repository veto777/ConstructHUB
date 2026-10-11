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
  // The Mail Alerts setup sections: the owner's private forwarding address, the saved Gmail-connection
  // grants, and the recognized provider sender lists.
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
  // The Mail Alerts provider inbox: the retained alerts (30 days) with search and category/severity/client
  // filters. `unread=1` keeps only unread alerts; `mapped=mapped|unmapped` keeps alerts with (or without) an
  // assigned client; `locationId` filters to one client. Rows carry the matched client's business name (never
  // a bare location id), and the response carries the page-wide counts the triage chips lead with.
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
        unread: z.enum(["", "1"]).default(""),
        mapped: z.enum(["", "mapped", "unmapped"]).default(""),
      })
      .parse(req.query);
    const params = [
      id,
      `%${p.q}%`,
      p.category,
      p.severity,
      p.locationId || null,
      p.unread,
      p.mapped,
    ];
    const filter =
      "m.user_id=$1 AND m.expires_at>now() AND (m.subject ILIKE $2 OR m.sender ILIKE $2) AND ($3='' OR m.category=$3) AND ($4='' OR m.severity=$4) AND ($5::int IS NULL OR m.location_id=$5) AND ($6='' OR m.read_at IS NULL) AND ($7='' OR ($7='mapped' AND m.location_id IS NOT NULL) OR ($7='unmapped' AND m.location_id IS NULL))";
    const { rows } = await pool.query(
      `SELECT m.id,m.category,m.severity,m.sender,m.subject,m.body,m.confirmation_code,m.confirmation_link,m.domain_id,m.location_id,bl.business_name AS location_name,m.read_at,m.received_at FROM mail_alert_messages m LEFT JOIN business_locations bl ON bl.id=m.location_id AND bl.user_id=m.user_id WHERE ${filter} ORDER BY m.received_at DESC,m.id DESC LIMIT $8 OFFSET $9`,
      [...params, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM mail_alert_messages m WHERE ${filter}`,
      params,
    );
    const {
      rows: [counts],
    } = await pool.query(
      `SELECT count(*) FILTER (WHERE read_at IS NULL)::int unread,
              count(*) FILTER (WHERE severity='critical')::int critical,
              count(*) FILTER (WHERE location_id IS NULL)::int unmapped
       FROM mail_alert_messages WHERE user_id=$1 AND expires_at>now()`,
      [id],
    );
    res.json({ items: rows, total: n.total, counts });
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
