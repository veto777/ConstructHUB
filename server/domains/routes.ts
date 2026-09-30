import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { rateLimit } from "../growth-limits";
import { requireModule } from "../entitlements";
import { requireRecentAuth } from "../account-security";
import { logActivity } from "../account-events";
import { domainName, changeInput, DomainError } from "./types";
import {
  saveConnection,
  preview,
  confirm,
  rollbackPreview,
  ownedDomains,
  enqueue,
  autoMapDomains,
} from "./service";
import { cloudflareZoneLink, type CloudflareZoneLink } from "./cloudflare-link";
import { registrarGuides } from "./guides";
export const pageInput = z.object({
  q: z.string().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  registrar: z.string().max(50).default(""),
  locationId: z.coerce.number().int().positive().optional(),
});
const idsInput = z.array(z.number().int().positive()).min(1).max(100);
export function registerDomainRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  cf: (userId: number) => CloudflareZoneLink = () => cloudflareZoneLink,
) {
  app.use("/api/domains", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // Agency-only module: every /api/domains route answers 402 plan_required unless the plan includes it.
  app.use(
    "/api/domains",
    rateLimit("domains", 120, 300),
    requireModule("domainsMailAlerts"),
  );
  const route = (
    method: "get" | "post",
    path: string,
    fn: (req: Request, res: Response, id: number) => Promise<any>,
  ) =>
    app[method](`/api/domains${path}`, async (req, res) => {
      const u = auth(req, res);
      if (!u) return;
      try {
        await fn(req, res, u.id);
      } catch (e) {
        res
          .status(
            e instanceof z.ZodError
              ? 400
              : e instanceof DomainError
                ? e.status
                : 500,
          )
          .json({
            message:
              e instanceof DomainError
                ? e.message
                : e instanceof z.ZodError
                  ? "Invalid domain input"
                  : "Domain operation failed",
          });
      }
    });
  route("get", "/guides", async (_req, res) =>
    res.json({
      guides: registrarGuides,
      egressIp: process.env.DOMAINS_EGRESS_IP || null,
      workerEnabled: process.env.DOMAINS_WORKER_ENABLED === "true",
    }),
  );
  route("get", "", async (req, res, id) => {
    const p = pageInput.parse(req.query),
      values = [id, `%${p.q}%`, p.registrar, p.locationId || null];
    const filter =
      "user_id=$1 AND domain ILIKE $2 AND ($3='' OR registrar=$3) AND ($4::int IS NULL OR location_id=$4)";
    const { rows } = await pool.query(
      `SELECT id,domain,registrar,location_id,state - 'records' AS state,checked_at FROM managed_domains WHERE ${filter} ORDER BY domain,id LIMIT $5 OFFSET $6`,
      [...values, p.limit, (p.page - 1) * p.limit],
    );
    const {
      rows: [n],
    } = await pool.query(
      `SELECT count(*)::int total FROM managed_domains WHERE ${filter}`,
      values,
    );
    res.json({ items: rows, total: n.total, page: p.page });
  });
  route("get", "/locations", async (req, res, id) => {
    const p = pageInput.parse(req.query);
    const { rows } = await pool.query(
      "SELECT id,business_name,website FROM business_locations WHERE user_id=$1 AND (business_name ILIKE $2 OR website ILIKE $2) ORDER BY id LIMIT $3 OFFSET $4",
      [id, `%${p.q}%`, p.limit, (p.page - 1) * p.limit],
    );
    res.json({ items: rows });
  });
  route("get", "/connections", async (req, res, id) => {
    const p = pageInput.parse(req.query);
    const { rows } = await pool.query(
      "SELECT id,provider,label,created_at FROM domain_connections WHERE user_id=$1 AND label ILIKE $2 ORDER BY id DESC LIMIT $3 OFFSET $4",
      [id, `%${p.q}%`, p.limit, (p.page - 1) * p.limit],
    );
    res.json({ items: rows });
  });
  route("post", "/connections", async (req, res, id) => {
    const b = z
      .object({
        provider: z.enum(["porkbun", "namecom"]),
        label: z.string().trim().min(1).max(100),
        key: z.string().min(1).max(2048),
        secret: z.string().min(1).max(2048),
      })
      .strict()
      .parse(req.body);
    if (!requireRecentAuth(req, res)) return;
    const connectionId = await saveConnection(
      id,
      b.provider,
      b.label,
      b.key,
      b.secret,
    );
    await logActivity(req, id, "domains.connected", {
      provider: b.provider,
      connectionId,
    });
    res.status(201).json({ id: connectionId });
  });
  route("post", "/sync", async (req, res, id) => {
    const b = z.object({ connectionIds: idsInput }).strict().parse(req.body);
    const { rows } = await pool.query(
      "SELECT id FROM domain_connections WHERE user_id=$1 AND id=ANY($2::bigint[])",
      [id, b.connectionIds],
    );
    if (rows.length !== new Set(b.connectionIds).size)
      throw new DomainError("Connection not found", 404);
    const jobs = [];
    for (const c of rows)
      jobs.push(await enqueue(id, "discover", {}, undefined, c.id));
    res.status(202).json({ jobs });
  });
  route("post", "/manual", async (req, res, id) => {
    const b = z
      .object({
        domains: z.array(domainName).min(1).max(100),
        registrar: z
          .enum(["manual", "squarespace", "wix", "hover", "networksolutions"])
          .default("manual"),
      })
      .strict()
      .parse(req.body);
    const { rows } = await pool.query(
      "INSERT INTO managed_domains(user_id,domain,registrar) SELECT $1,unnest($2::text[]),$3 ON CONFLICT(user_id,domain) DO NOTHING RETURNING id",
      [id, b.domains, b.registrar],
    );
    await autoMapDomains(id);
    res.status(201).json({ added: rows.length });
  });
  route("post", "/mapping", async (req, res, id) => {
    const b = z
      .object({
        ids: idsInput,
        locationId: z.number().int().positive().nullable(),
      })
      .strict()
      .parse(req.body);
    await ownedDomains(id, b.ids);
    if (b.locationId) {
      const { rowCount } = await pool.query(
        "SELECT id FROM business_locations WHERE id=$1 AND user_id=$2",
        [b.locationId, id],
      );
      if (!rowCount) throw new DomainError("Location not found", 404);
    }
    await pool.query(
      "UPDATE managed_domains SET location_id=$3 WHERE user_id=$1 AND id=ANY($2::bigint[])",
      [id, b.ids, b.locationId],
    );
    res.json({ ok: true });
  });
  route("post", "/monitor", async (req, res, id) => {
    const b = z.object({ ids: idsInput }).strict().parse(req.body);
    await ownedDomains(id, b.ids);
    await pool.query(
      "UPDATE managed_domains SET next_check=now() WHERE user_id=$1 AND id=ANY($2::bigint[])",
      [id, b.ids],
    );
    res.status(202).json({ queued: true });
  });
  route("post", "/preview", async (req, res, id) => {
    const b = z
      .object({ ids: idsInput, change: changeInput })
      .strict()
      .parse(req.body);
    res.status(202).json({ jobs: await preview(id, b.ids, b.change) });
  });
  route("post", "/cloudflare-preview", async (req, res, id) => {
    const b = z.object({ ids: idsInput }).strict().parse(req.body);
    const rows = await ownedDomains(id, b.ids);
    const targets = [];
    for (const d of rows) {
      const ns = await cf(id).zoneNameservers(d.domain);
      if (!ns)
        throw new DomainError(
          "Cloudflare zone link is not configured for every selected domain.",
          409,
        );
      targets.push({
        id: Number(d.id),
        change: changeInput.parse({ kind: "nameservers", nameservers: ns }),
      });
    }
    const jobs = [];
    for (const t of targets)
      jobs.push(...(await preview(id, [t.id], t.change)));
    res.status(202).json({ jobs });
  });
  route("post", "/confirm", async (req, res, id) => {
    const b = z
      .object({
        jobIds: z.array(z.string().uuid()).min(1).max(100),
        confirmed: z.literal(true),
        emailWarningAccepted: z.boolean(),
      })
      .strict()
      .parse(req.body);
    if (!requireRecentAuth(req, res)) return;
    await confirm(id, b.jobIds, b.emailWarningAccepted);
    await logActivity(req, id, "domains.confirmed", { jobIds: b.jobIds });
    res.status(202).json({ queued: true });
  });
  route("post", "/rollback-preview", async (req, res, id) => {
    const b = z
      .object({ jobIds: z.array(z.string().uuid()).min(1).max(100) })
      .strict()
      .parse(req.body);
    const jobs = [];
    for (const j of b.jobIds) jobs.push(...(await rollbackPreview(id, j)));
    res.status(202).json({ jobs });
  });
  route("get", "/jobs", async (req, res, id) => {
    const p = pageInput.parse(req.query);
    const { rows } = await pool.query(
      "SELECT j.id,j.domain_id,d.domain,j.kind,j.status,j.payload,j.before_state,j.after_state,j.error,j.created_at,j.expires_at FROM domain_jobs j LEFT JOIN managed_domains d ON d.id=j.domain_id WHERE j.user_id=$1 AND (COALESCE(d.domain,'') ILIKE $2) ORDER BY j.created_at DESC,j.id LIMIT $3 OFFSET $4",
      [id, `%${p.q}%`, p.limit, (p.page - 1) * p.limit],
    );
    res.json({ items: rows });
  });
}
