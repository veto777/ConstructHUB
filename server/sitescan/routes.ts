import type { Express } from "express";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { pool } from "../db";
import { takeBudget, rateLimit, ipKey } from "../growth-limits";
import { reserveQuotaFor, refundReservation } from "../growth-quotas";
import { logActivity } from "../account-events";
import { sendWithFallback } from "../email";
import { requirePlatformAdmin } from "../crm/admin";
import {
  PRIMARY_DOMAIN,
  isKnownHost,
  requestHost,
  siteBaseUrl,
  siteDomainOf,
} from "../site-context";
import { siteUrl } from "./http";
import { enqueue, profileFor } from "./worker";
import { pageInput, reportView, enqueueLocations, bulkInput } from "./agency";
import { checklist } from "./guidance";
import { openAIProvider, planBatches } from "./providers";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(32).toString("hex");
const input = z.object({
  url: z.string().max(2048).optional(),
  locationId: z.number().int().positive().optional(),
  pageCap: z.number().int().min(1).max(500).default(150),
  psiPages: z.number().int().min(0).max(5).default(1),
});
const idSchema = z.string().uuid(),
  tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const DAY = 86400_000;
/**
 * Reserve Site Scans from the account's monthly plan allowance (Agency: per
 * location). Answers the 402/403 itself and returns null when refused.
 */
async function reserveScans(res: any, user: number, count: number) {
  const quota = await reserveQuotaFor(user, "siteScans", count);
  if (!quota.ok) {
    res.status(quota.status).json(quota.body);
    return null;
  }
  return quota.reservation;
}
// Return a reservation for work that never ran (provider outage, nothing to draft).
const refundBudget = async (key: string, amount: number, period: string) => {
  if (amount > 0)
    await pool.query(
      "UPDATE growth_budgets SET used=greatest(0,used-$3) WHERE key=$1 AND period=$2",
      [key, period, amount],
    );
};
/**
 * The free scan is a marketing page, so its verification link belongs on the
 * caller's allowlisted marketing domain (never the portal, never a spoofed
 * Host). Dev uses the request origin so local links open the running server.
 */
export function marketingBaseUrl(req: any): string {
  if (process.env.NODE_ENV !== "production" && !process.env.REPLIT_DEPLOYMENT)
    return siteBaseUrl(req);
  const host = requestHost(req);
  if (isKnownHost(host)) return `https://${siteDomainOf(host)}`;
  return (
    (process.env.APP_URL || "").trim().replace(/\/+$/, "") ||
    `https://${PRIMARY_DOMAIN}`
  );
}
const scoreLabel: Record<string, string> = {
  local: "Local",
  content: "Content",
  technical: "Technical",
  performance: "Performance",
  "ai-readiness": "AI Readiness",
};
const labLabel: Record<string, string> = {
  "largest-contentful-paint": "Largest Contentful Paint",
  "cumulative-layout-shift": "Cumulative Layout Shift",
  "total-blocking-time": "Total Blocking Time",
  "speed-index": "Speed Index",
  "total-byte-weight": "Total page weight",
  "uses-optimized-images": "Image optimization",
  "uses-responsive-images": "Responsive images",
};
/** Plain-language PageSpeed lines for the PDF (no raw JSON). */
export function psiLines(psi: any[]): string[] {
  return psi.map((p) => {
    const head =
      [p.strategy, p.url].filter(Boolean).join(" · ") || "PageSpeed";
    if (p.unavailable)
      return `${head}: PageSpeed data unavailable (${p.unavailable})`;
    const lab = Object.entries(p.lab || {}).flatMap(([k, v]: [string, any]) => {
      const shown = v?.display ?? v?.value;
      return shown === null || shown === undefined
        ? []
        : [`  ${labLabel[k] ?? k}: ${shown}`];
    });
    const field = p.field || p.originField;
    return [
      `${head}: performance score ${typeof p.score === "number" ? p.score : "not reported"}`,
      ...lab,
      field
        ? `  Real-user field data${p.field ? "" : " (site-wide)"}: ${Object.entries(
            field,
          )
            .map(
              ([k, m]: [string, any]) =>
                `${k.toLowerCase().replace(/_/g, " ")} ${m?.category ?? "no rating"}`,
            )
            .join("; ")}`
        : "  No real-user field data reported.",
    ].join("\n");
  });
}
export function registerSiteScanRoutes(
  app: Express,
  auth: (req: any, res: any) => any,
  deps = { provider: openAIProvider, send: sendWithFallback, http: fetch },
) {
  const owner = (
    method: "get" | "post" | "delete",
    path: string,
    fn: (req: any, res: any, user: number) => Promise<any>,
  ) =>
    app[method](path, async (req, res, next) => {
      try {
        const u = auth(req, res);
        if (!u) return;
        await fn(req, res, u.id);
      } catch (e) {
        if (e instanceof z.ZodError || e instanceof TypeError)
          return void res
            .status(400)
            .json({ message: "Invalid Site Scan input" });
        next(e);
      }
    });
  const getJob = async (req: any, res: any, user: number) => {
    const id = idSchema.parse(req.params.id);
    const {
      rows: [job],
    } = await pool.query(
      "SELECT * FROM sitescan_jobs WHERE id=$1 AND user_id=$2",
      [id, user],
    );
    if (!job) res.status(404).json({ message: "Report not found" });
    return job;
  };
  owner("get", "/api/sitescan", async (req, res, user) => {
    const v = pageInput
      .extend({
        locationOffset: z.coerce.number().int().min(0).max(1000000).default(0),
        locationQ: z.string().max(200).default(""),
        status: z
          .enum(["", "queued", "running", "completed", "failed"])
          .default(""),
        locationId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query || {});
    const args = [user, "%" + v.q + "%", v.status, v.locationId ?? null];
    const where =
      "user_id=$1 AND (url ILIKE $2 OR profile->>'business_name' ILIKE $2) AND ($3='' OR status=$3) AND ($4::int IS NULL OR profile->>'id'=$4::text)";
    const [jobs, count, locations, lc, schedules] = await Promise.all([
      pool.query(
        `SELECT id,url,status,error,created_at,completed_at,report->'scores' AS scores,jsonb_array_length(state->'pages') AS pages,page_cap,profile->>'business_name' AS client FROM sitescan_jobs WHERE ${where} ORDER BY created_at DESC,id LIMIT $5 OFFSET $6`,
        [...args, v.limit, v.offset],
      ),
      pool.query(
        `SELECT count(*)::int total FROM sitescan_jobs WHERE ${where}`,
        args,
      ),
      pool.query(
        "SELECT id,business_name,website FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NOT NULL AND (business_name ILIKE $2 OR website ILIKE $2) ORDER BY id LIMIT $3 OFFSET $4",
        [user, "%" + v.locationQ + "%", v.limit, v.locationOffset],
      ),
      pool.query(
        "SELECT count(*)::int total FROM business_locations WHERE user_id=$1 AND gbp_location_name IS NOT NULL AND (business_name ILIKE $2 OR website ILIKE $2)",
        [user, "%" + v.locationQ + "%"],
      ),
      pool.query(
        "SELECT * FROM sitescan_schedules WHERE user_id=$1 ORDER BY url LIMIT 100",
        [user],
      ),
    ]);
    res.json({
      jobs: jobs.rows,
      total: count.rows[0].total,
      locations: locations.rows,
      locationTotal: lc.rows[0].total,
      schedules: schedules.rows,
    });
  });
  owner("post", "/api/sitescan/bulk", async (req, res, user) => {
    // Validate first (400), then take one monthly Site Scan per selected location.
    const ids = new Set(bulkInput.parse(req.body).locationIds).size;
    const reservation = await reserveScans(res, user, ids);
    if (!reservation) return;
    let jobs;
    try {
      jobs = await enqueueLocations(user, req.body);
    } catch (e) {
      await refundReservation(reservation, ids);
      throw e;
    }
    if (!jobs) {
      await refundReservation(reservation, ids);
      return res
        .status(429)
        .json({ message: "Agency queue budget reached (1,000 sites/day)." });
    }
    await logActivity(req, user, "sitescan.started", {
      bulk: true,
      count: jobs.length,
    });
    res.status(202).json({ jobs });
  });
  owner("get", "/api/sitescan/branding", async (_req, res, user) => {
    const {
      rows: [brand],
    } = await pool.query(
      "SELECT name,logo FROM sitescan_branding WHERE user_id=$1",
      [user],
    );
    res.json(brand || { name: "", logo: null });
  });
  owner("post", "/api/sitescan/branding", async (req, res, user) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(120),
        logo: z
          .string()
          .max(300000)
          .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/)
          .nullable()
          // Omitted keeps the saved logo, so a rename never re-sends it (the stored, normalized PNG
          // can exceed this upload cap); null removes it.
          .optional(),
      })
      .strict()
      .parse(req.body);
    if (b.logo) {
      // Decode locally, constrain dimensions, and normalize image bytes; never fetch a user URL.
      const sharp = (await import("sharp")).default;
      try {
        const bytes = await sharp(Buffer.from(b.logo.split(",")[1], "base64"), {
          limitInputPixels: 4000000,
        })
          .resize({
            width: 600,
            height: 300,
            fit: "inside",
            withoutEnlargement: true,
          })
          .png()
          .toBuffer();
        b.logo = "data:image/png;base64," + bytes.toString("base64");
      } catch {
        throw new TypeError("Invalid logo");
      }
    }
    if (b.logo === undefined)
      await pool.query(
        "INSERT INTO sitescan_branding(user_id,name) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET name=$2",
        [user, b.name],
      );
    else
      await pool.query(
        "INSERT INTO sitescan_branding(user_id,name,logo) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET name=$2,logo=$3",
        [user, b.name, b.logo],
      );
    res.json({ ok: true });
  });
  // Removing branding returns PDFs to the ConstructHUB title. Agency members never reach this
  // (the access layer only delegates object routes), so it only clears the owner's own row.
  owner("delete", "/api/sitescan/branding", async (_req, res, user) => {
    await pool.query("DELETE FROM sitescan_branding WHERE user_id=$1", [user]);
    res.json({ ok: true });
  });
  owner("post", "/api/sitescan/jobs/:id/fixes", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    const b = z
      .object({
        keys: z
          .array(z.string().regex(/^[a-f0-9]{64}$/))
          .min(1)
          .max(1000),
        done: z.boolean(),
      })
      .strict()
      .parse(req.body);
    if (b.keys.some((k) => !j.report?.fixes?.some((f: any) => f.key === k)))
      throw new TypeError("Unknown fix");
    await pool.query(
      "UPDATE sitescan_jobs SET fix_done=fix_done || $3::jsonb WHERE id=$1 AND user_id=$2",
      [
        j.id,
        user,
        JSON.stringify(Object.fromEntries(b.keys.map((k) => [k, b.done]))),
      ],
    );
    await logActivity(req, user, "sitescan.fixes_updated", {
      id: j.id,
      count: b.keys.length,
      done: b.done,
    });
    res.json({ ok: true });
  });
  owner("post", "/api/sitescan/jobs/:id/retry", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    const reservation = await reserveScans(res, user, 1);
    if (!reservation) return;
    if (!(await takeBudget("sitescan:scan:" + user, 5, 1, 86400000))) {
      await refundReservation(reservation, 1);
      return res
        .status(429)
        .json({ message: "Daily rescan budget reached (5)." });
    }
    const profile = j.profile?.id ? await profileFor(user, j.profile.id) : null;
    let id;
    try {
      id = await enqueue(user, j.url, j.page_cap, Math.max(1, j.psi_pages), profile);
    } catch (e) {
      await refundReservation(reservation, 1); // the rescan never started
      throw e;
    }
    await logActivity(req, user, "sitescan.started", { id, retryOf: j.id });
    res.status(202).json({ id });
  });
  owner("post", "/api/sitescan/jobs/:id/email", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    const b = z
      .object({ email: z.string().email().max(254) })
      .strict()
      .parse(req.body);
    if (!j.report)
      return res.status(409).json({ message: "Wait for the report." });
    if (!(await takeBudget("sitescan:email:" + user, 10, 1, 86400000)))
      return res
        .status(429)
        .json({ message: "Daily checklist email limit reached." });
    const fixes = (j.report.fixes || []).map((f: any) => ({
      ...f,
      done: j.fix_done?.[f.key] ?? f.done,
    }));
    const sent = await deps.send({
      to: b.email,
      subject: "Website fix checklist",
      text: checklist(j.report, fixes),
    });
    if (sent && "success" in sent && !sent.success)
      return res
        .status(503)
        .json({
          message: "Email could not be sent; use the share link or PDF.",
        });
    await logActivity(req, user, "sitescan.shared", {
      id: j.id,
      channel: "email",
    });
    res.json({ ok: true, sink: process.env.EMAIL_FORCE_SINK === "1" });
  });
  owner("post", "/api/sitescan", async (req, res, user) => {
    const body = input.parse(req.body);
    const profile =
      body.locationId || !body.url
        ? await profileFor(user, body.locationId)
        : null;
    if (body.locationId && !profile)
      return res
        .status(400)
        .json({ message: "Sync the selected GBP profile before scanning." });
    let url: string;
    try {
      url = siteUrl(body.url || profile?.website || "");
    } catch {
      return res
        .status(400)
        .json({ message: "Enter a public HTTP or HTTPS website URL." });
    }
    const reservation = await reserveScans(res, user, 1);
    if (!reservation) return;
    if (!(await takeBudget("sitescan:scan:" + user, 5, 1, 86400_000))) {
      await refundReservation(reservation, 1);
      return res
        .status(429)
        .json({ message: "Daily scan budget reached (5)." });
    }
    let id;
    try {
      id = await enqueue(user, url, body.pageCap, body.psiPages, profile);
    } catch (e) {
      await refundReservation(reservation, 1); // the scan never started
      throw e;
    }
    await logActivity(req, user, "sitescan.started", { id, url });
    res.status(202).json({ id });
  });
  owner("get", "/api/sitescan/jobs/:id", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (j)
      res.json({
        id: j.id,
        url: j.url,
        status: j.status,
        error: j.error,
        pages: j.state.pages.length,
        pageCap: j.page_cap,
        report: reportView(j, req.query || {}),
        aiDraft: j.ai_draft,
        shareEnabled: !!j.share_hash,
      });
  });
  owner("post", "/api/sitescan/jobs/:id/plan", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    if (j.status !== "completed")
      return res.status(409).json({ message: "Wait for the report." });
    // Same window takeBudget uses, so a refund reaches the reservation just made.
    const period = String(Math.floor(Date.now() / DAY));
    const draftKey = "sitescan:ai:" + user,
      callsKey = "sitescan:ai-calls:" + user,
      globalKey = "sitescan:ai-global";
    if (!(await takeBudget(draftKey, 3, 1, DAY)))
      return res
        .status(429)
        .json({ message: "Daily AI draft budget reached (3)." });
    const batches = planBatches(j.state, j.report.findings, j.profile);
    if (!batches.length) {
      await refundBudget(draftKey, 1, period);
      return res
        .status(409)
        .json({ message: "No readable pages are available for an AI plan." });
    }
    const callsTaken = await takeBudget(callsKey, 20, batches.length, DAY);
    if (
      !callsTaken ||
      !(await takeBudget(globalKey, 100, batches.length, DAY))
    ) {
      await refundBudget(draftKey, 1, period);
      if (callsTaken) await refundBudget(callsKey, batches.length, period);
      return res
        .status(429)
        .json({ message: "AI provider-call budget exhausted. Try tomorrow." });
    }
    const sections: string[] = [];
    try {
      for (const batch of batches)
        sections.push(await deps.provider.generate(batch));
    } catch {
      // No draft was produced: give back the draft and every call that did not complete.
      const unused = batches.length - sections.length;
      await refundBudget(draftKey, 1, period);
      await refundBudget(callsKey, unused, period);
      await refundBudget(globalKey, unused, period);
      return res.status(503).json({
        message:
          "AI provider unavailable, so no draft was created and your daily AI draft allowance was not used. The audit remains available" +
          (j.report.jsonLdDraft
            ? ", including the factual JSON-LD draft."
            : "."),
      });
    }
    // Only a provider failure is refunded; a storage error after generation is not an outage.
    const draft = sections
      .map(
        (text, i) =>
          `AI DRAFT — page batch ${i + 1}/${sections.length}\n\n${text}`,
      )
      .join("\n\n");
    await pool.query(
      "UPDATE sitescan_jobs SET ai_draft=$3 WHERE id=$1 AND user_id=$2",
      [j.id, user, draft],
    );
    await logActivity(req, user, "sitescan.plan_drafted", { id: j.id });
    res.json({ draft, label: "AI draft — review before publishing" });
  });
  owner("post", "/api/sitescan/jobs/:id/share", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    if (!j.report)
      return res.status(409).json({ message: "Wait for the report." });
    const value = token();
    await pool.query(
      "UPDATE sitescan_jobs SET share_hash=$3,share_expires=now()+interval '30 days' WHERE id=$1 AND user_id=$2",
      [j.id, user, hashToken(value)],
    );
    await logActivity(req, user, "sitescan.shared", { id: j.id });
    res.json({ path: "/site-scan/report/" + value });
  });
  owner("delete", "/api/sitescan/jobs/:id", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    // Removes the report, its share link and fix progress. A queued or running scan stops: the
    // worker's lease-checked writes find no row. The daily scan budget is not refunded.
    await pool.query("DELETE FROM sitescan_jobs WHERE id=$1 AND user_id=$2", [
      j.id,
      user,
    ]);
    await logActivity(req, user, "sitescan.deleted", { id: j.id, url: j.url });
    res.json({ ok: true });
  });
  owner("delete", "/api/sitescan/jobs/:id/share", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    await pool.query(
      "UPDATE sitescan_jobs SET share_hash=NULL,share_expires=NULL WHERE id=$1 AND user_id=$2",
      [j.id, user],
    );
    res.json({ ok: true });
  });
  owner("post", "/api/sitescan/schedule", async (req, res, user) => {
    const body = input.extend({ enabled: z.boolean() }).parse(req.body);
    let url: string;
    try {
      url = siteUrl(body.url || "");
    } catch {
      return res
        .status(400)
        .json({ message: "Enter a public HTTP or HTTPS website URL." });
    }
    if (
      body.enabled &&
      body.locationId &&
      !(await profileFor(user, body.locationId))
    )
      return res.status(404).json({ message: "Synced profile not found" });
    if (body.enabled) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        // Serialize this owner's limit check and insert, including new URLs.
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
        const {
          rows: [n],
        } = await c.query(
          "SELECT count(*)::int n, bool_or(url=$2) AS existing FROM sitescan_schedules WHERE user_id=$1",
          [user, url],
        );
        if (n.n >= 10 && !n.existing) {
          await c.query("ROLLBACK");
          return res
            .status(409)
            .json({ message: "Maximum 10 scheduled sites" });
        }
        await c.query(
          "INSERT INTO sitescan_schedules(user_id,url,location_id,page_cap,psi_pages) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,url) DO UPDATE SET location_id=$3,page_cap=$4,psi_pages=$5",
          [user, url, body.locationId ?? null, body.pageCap, body.psiPages],
        );
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    } else
      await pool.query(
        "DELETE FROM sitescan_schedules WHERE user_id=$1 AND url=$2",
        [user, url],
      );
    res.json({ ok: true });
  });
  owner("get", "/api/sitescan/jobs/:id/pdf", async (req, res, user) => {
    const j = await getJob(req, res, user);
    if (!j) return;
    if (!j.report)
      return res.status(409).json({ message: "Wait for the report." });
    res
      .type("application/pdf")
      .setHeader("Content-Disposition", 'attachment; filename="site-scan.pdf"');
    const {
      rows: [brand],
    } = await pool.query(
      "SELECT name,logo FROM sitescan_branding WHERE user_id=$1",
      [user],
    );
    const doc = new PDFDocument({ margin: 45 });
    doc.pipe(res);
    if (brand?.logo)
      doc
        .image(Buffer.from(brand.logo.split(",")[1], "base64"), {
          fit: [160, 80],
        })
        .moveDown(5);
    doc
      .fontSize(22)
      .text((brand?.name || "ConstructHUB") + " Site Scan")
      .fontSize(11)
      .text(j.url)
      .text("Overall: " + (j.report.scores.overall ?? "Unavailable"));
    for (const [k, v] of Object.entries(j.report.scores.categories || {}))
      doc.text(
        `${scoreLabel[k] ?? k.charAt(0).toUpperCase() + k.slice(1)}: ${v ?? "N/A"}`,
      );
    doc
      .moveDown()
      .fontSize(10)
      .text(
        checklist(
          j.report,
          (j.report.fixes || []).map((f: any) => ({
            ...f,
            done: j.fix_done?.[f.key] ?? f.done,
          })),
        ),
      );
    if (!j.report.fixes)
      for (const f of j.report.findings)
        doc
          .moveDown()
          .text(
            f.title + "\n" + f.why + "\n" + f.fix + "\n" + f.urls.join("\n"),
          );
    if (j.report.scoreExplanation) {
      doc.moveDown().text("What raised or lowered these scores:");
      for (const [k, v] of Object.entries(j.report.scoreExplanation))
        doc.text(`${scoreLabel[k] ?? k}: ${String(v)}`);
    }
    if (j.report.psi?.length)
      doc
        .addPage()
        .fontSize(14)
        .text("PageSpeed measurements")
        .fontSize(9)
        .text(psiLines(j.report.psi).join("\n\n"));
    if (j.ai_draft)
      doc
        .addPage()
        .text("AI DRAFT — review before publishing")
        .text(j.ai_draft);
    if (j.report.jsonLdDraft)
      doc
        .addPage()
        .text("GBP JSON-LD DRAFT — review before publishing")
        .text(JSON.stringify(j.report.jsonLdDraft, null, 2));
    doc.moveDown().text(j.report.coverage.notes.join("\n"));
    doc.end();
  });
  const publicRoute = (
    method: "get" | "post",
    path: string,
    fn: (req: any, res: any) => Promise<any>,
  ) =>
    app[method](
      path,
      rateLimit("sitescan-public", 600, 600),
      async (req, res, next) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        try {
          await fn(req, res);
        } catch (e) {
          if (e instanceof z.ZodError || e instanceof TypeError)
            return void res.status(400).json({ message: "Invalid input" });
          next(e);
        }
      },
    );
  publicRoute("get", "/api/sitescan/shared/:token", async (req, res) => {
    const value = tokenSchema.parse(req.params.token);
    const {
      rows: [j],
    } = await pool.query(
      "SELECT report,ai_draft,fix_done FROM sitescan_jobs WHERE share_hash=$1 AND share_expires>now()",
      [hashToken(value)],
    );
    if (!j)
      return res
        .status(404)
        .json({ message: "This report link expired or was revoked." });
    res.json({ report: reportView(j, req.query || {}), aiDraft: j.ai_draft });
  });
  publicRoute("get", "/api/sitescan/public/config", async (_req, res) =>
    res.json({
      captchaSiteKey:
        process.env.RECAPTCHA_SITE_KEY ||
        process.env.VITE_RECAPTCHA_SITE_KEY ||
        null,
    }),
  );
  publicRoute("post", "/api/sitescan/public/start", async (req, res) => {
    const body = z
      .object({
        url: z.string().max(2048),
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase().trim()),
        captchaToken: z.string().max(4096).optional(),
      })
      .parse(req.body);
    let url: string;
    try {
      url = siteUrl(body.url);
    } catch {
      return res
        .status(400)
        .json({ message: "Enter a public HTTP or HTTPS website URL." });
    }
    if (process.env.RECAPTCHA_SECRET_KEY) {
      if (!body.captchaToken)
        return res.status(400).json({ message: "Complete the CAPTCHA." });
      try {
        const r = await deps.http(
          "https://www.google.com/recaptcha/api/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: process.env.RECAPTCHA_SECRET_KEY,
              response: body.captchaToken,
            }),
            signal: AbortSignal.timeout(5000),
          },
        );
        const c = await r.json();
        if (!r.ok || c.success !== true)
          return res.status(400).json({ message: "CAPTCHA failed." });
      } catch {
        return res
          .status(503)
          .json({ message: "CAPTCHA unavailable. Please retry." });
      }
    }
    if (
      !(await takeBudget("sitescan:lead-ip:" + ipKey(req), 3, 1, 86400_000)) ||
      !(await takeBudget(
        "sitescan:lead-email:" + hashToken(body.email),
        2,
        1,
        86400_000,
      )) ||
      !(await takeBudget("sitescan:lead-global", 100, 1, 86400_000))
    )
      return res
        .status(429)
        .json({ message: "Free scan limit reached. Try again tomorrow." });

    const job = await enqueue(null, url, 11, 1),
      verify = token(),
      access = token();
    await pool.query(
      "INSERT INTO sitescan_leads(id,job_id,email,verify_hash,access_hash) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), job, body.email, hashToken(verify), hashToken(access)],
    );
    const link = marketingBaseUrl(req) + "/free-site-scan?verify=" + verify;
    await deps.send({
      to: body.email,
      subject: "Verify your ConstructHUB Site Scan email",
      text: `Verify your email to view the full report: ${link}\nThis link expires in 7 days.`,
    });
    res.status(202).json({
      access,
      message:
        "Check your email to unlock the full report. Most quick scans take about 60 seconds; slow sites may take longer.",
    });
  });
  publicRoute("get", "/api/sitescan/public/status/:token", async (req, res) => {
    const value = tokenSchema.parse(req.params.token);
    const {
      rows: [j],
    } = await pool.query(
      "SELECT j.status,j.error,j.report FROM sitescan_leads l JOIN sitescan_jobs j ON j.id=l.job_id WHERE l.access_hash=$1 AND l.expires_at>now()",
      [hashToken(value)],
    );
    if (!j) return res.status(404).json({ message: "Scan not found" });
    res.json({
      status: j.status,
      error: j.error,
      summary: j.report
        ? {
            scores: j.report.scores,
            findings: j.report.findings.slice(0, 5),
            pages: j.report.pages,
          }
        : null,
    });
  });
  publicRoute("post", "/api/sitescan/public/verify", async (req, res) => {
    const value = tokenSchema.parse(req.body?.token);
    const {
      rows: [l],
    } = await pool.query(
      "UPDATE sitescan_leads SET verified_at=COALESCE(verified_at,now()) WHERE verify_hash=$1 AND expires_at>now() RETURNING job_id",
      [hashToken(value)],
    );
    if (!l)
      return res
        .status(404)
        .json({ message: "Verification link expired or invalid." });
    const {
      rows: [j],
    } = await pool.query(
      "SELECT status,error,report FROM sitescan_jobs WHERE id=$1",
      [l.job_id],
    );
    res.json(j);
  });
  app.get("/api/admin/sitescan-leads", async (req, res) => {
    if (!(await requirePlatformAdmin(req, res, auth))) return;
    const { rows } = await pool.query(
      "SELECT l.id,l.email,l.verified_at,l.created_at,j.url,j.status FROM sitescan_leads l JOIN sitescan_jobs j ON j.id=l.job_id ORDER BY l.created_at DESC LIMIT 500",
    );
    res.json({ leads: rows });
  });
}
