/**
 * Citation audit routes (the campaign CRUD and the row marks stay in server/routes.ts):
 *
 *   POST /api/citations/campaigns/:id/audit        start an audit (paid plan + the month's citation-audit quota)
 *   GET  /api/citations/campaigns/:id/audit        the latest audit's progress + the quota + what the finder can do
 *   POST /api/citations/campaigns/:id/import       a CSV of listings (text/csv body) → marks + links on the checklist
 *   GET  /api/citations/campaigns/:id/export.csv   the checklist with every audit finding
 *   GET  /api/citations/template.csv               the import template, one row per site
 */
import express, { type Express } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { citationCampaigns, citations } from "@shared/schema";
import { requirePlan, getEntitlements } from "../entitlements";
import { monthlyLimit, quotaKey, reserveMonthlyQuota } from "../growth-quotas";
import { webSearchMode } from "./finder";
import { exportCsv, importCsv, latestAudit, profileFor, startAudit, templateCsv } from "./audit";

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "citations";

export function registerCitationRoutes(app: Express, getDevUser: (req: any, res: any) => any): void {
  const owned = async (req: any, res: any) => {
    const user = getDevUser(req, res);
    if (!user) return null;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ message: "Bad campaign id" }); return null; }
    const [campaign] = await db.select().from(citationCampaigns).where(and(eq(citationCampaigns.id, id), eq(citationCampaigns.userId, user.id)));
    if (!campaign) { res.status(404).json({ message: "Campaign not found" }); return null; }
    return { user, campaign };
  };

  app.get("/api/citations/template.csv", (_req, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="constructhub-citations-template.csv"');
    res.send(templateCsv());
  });

  app.get("/api/citations/campaigns/:id/audit", async (req: any, res) => {
    const o = await owned(req, res);
    if (!o) return;
    try {
      const [audit, ent, profile] = await Promise.all([latestAudit(o.campaign.id), getEntitlements(o.user.id), profileFor(o.campaign, o.user.id)]);
      const limit = monthlyLimit(ent, "citationAudits");
      const { rows: [u] } = await pool.query("SELECT used FROM growth_budgets WHERE key=$1 AND period='0'", [quotaKey(o.user.id, "citationAudits")]);
      res.json({
        audit, quota: { used: Number(u?.used ?? 0), limit },
        ready: !!profile, readyReason: profile ? null : "Add the business phone and city to this location first; the audit needs them to tell your business from others with the same name.",
        capabilities: { webSearch: webSearchMode() !== "off", webSearchProvider: webSearchMode() },
      });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/citations/campaigns/:id/audit", async (req: any, res) => {
    const o = await owned(req, res);
    if (!o) return;
    if (!(await requirePlan(res, o.user.id, "The citation audit", (a) => a.citationAudits !== 0))) return;
    try {
      const profile = await profileFor(o.campaign, o.user.id);
      if (!profile) return res.status(400).json({ message: "Add the business phone and city to this location first; the audit needs them to tell your business from others with the same name." });
      const current = await latestAudit(o.campaign.id);
      const busy = current && (current.status === "queued" || current.status === "running") && Date.now() - new Date(current.createdAt).getTime() < 30 * 60_000;
      if (!busy && !(await reserveMonthlyQuota(req, res, "citationAudits"))) return;
      const r = await startAudit(o.campaign.id, o.user.id);
      res.status(r.started ? 202 : 200).json(r);
    } catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });

  app.post("/api/citations/campaigns/:id/import", express.text({ type: ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"], limit: "2mb" }), async (req: any, res) => {
    const o = await owned(req, res);
    if (!o) return;
    if (!(await requirePlan(res, o.user.id, "Citation imports"))) return;
    const csv = typeof req.body === "string" ? req.body : typeof req.body?.csv === "string" ? req.body.csv : "";
    if (!csv.trim()) return res.status(400).json({ message: "Send the spreadsheet as CSV text (in Excel: File → Save As → CSV)." });
    try { res.json(await importCsv(o.campaign.id, csv)); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/citations/campaigns/:id/export.csv", async (req: any, res) => {
    const o = await owned(req, res);
    if (!o) return;
    try {
      const rows = await db.select().from(citations).where(eq(citations.campaignId, o.campaign.id)).orderBy(asc(citations.id));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="citations-${slug(o.campaign.businessName)}-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(exportCsv(o.campaign, rows));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
