/**
 * Per-account interface choices that must follow the person across the phone browser and the iPhone apps — today the
 * phone tab bars (shared/tab-bar.ts; owner, 2026-10-04: "Let the settings allow you to pick what's in your lower
 * Ribbon on mobile and app").
 *
 *   GET /api/account/ui-prefs → { platformTabs: string[] | null, crmTabs: string[] | null }   (null = the default)
 *   PUT /api/account/ui-prefs   { platformTabs?: string[] | null, crmTabs?: string[] | null }  (null resets)
 *
 * Read by the platform tab bar (client/src/components/app-tabbar.tsx) and the CRM ribbon (crm-ribbon.tsx); edited in
 * Settings → Phone tab bar and the CRM ribbon's More → Customize the bar. Keys are checked against the catalogs.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import { CRM_TAB_OPTIONS, PLATFORM_TAB_OPTIONS, cleanTabChoice } from "@shared/tab-bar";

export async function ensureUiPrefsSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS user_ui_prefs (
    user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    platform_tabs jsonb, crm_tabs jsonb, updated_at timestamptz NOT NULL DEFAULT now())`);
}

export async function getUiPrefs(userId: number): Promise<{ platformTabs: string[] | null; crmTabs: string[] | null }> {
  const { rows: [r] } = await pool.query("SELECT platform_tabs, crm_tabs FROM user_ui_prefs WHERE user_id = $1", [userId]);
  return { platformTabs: cleanTabChoice(r?.platform_tabs, PLATFORM_TAB_OPTIONS), crmTabs: cleanTabChoice(r?.crm_tabs, CRM_TAB_OPTIONS) };
}

const tabs = z.array(z.string().max(40)).max(12).nullable().optional();
const body = z.object({ platformTabs: tabs, crmTabs: tabs }).strict();

export function registerUiPrefsRoutes(app: Express, getDevUser: (req: any, res: any) => any): void {
  app.get("/api/account/ui-prefs", async (req: Request, res: Response) => {
    const user = getDevUser(req, res);
    if (!user) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(await getUiPrefs(user.id));
  });

  app.put("/api/account/ui-prefs", async (req: Request, res: Response) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const parsed = body.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Pick up to four tabs from the list." });
    const cur = await getUiPrefs(user.id);
    const next = {
      platformTabs: parsed.data.platformTabs === undefined ? cur.platformTabs : cleanTabChoice(parsed.data.platformTabs, PLATFORM_TAB_OPTIONS),
      crmTabs: parsed.data.crmTabs === undefined ? cur.crmTabs : cleanTabChoice(parsed.data.crmTabs, CRM_TAB_OPTIONS),
    };
    await pool.query(
      `INSERT INTO user_ui_prefs(user_id, platform_tabs, crm_tabs, updated_at) VALUES($1, $2::jsonb, $3::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET platform_tabs = EXCLUDED.platform_tabs, crm_tabs = EXCLUDED.crm_tabs, updated_at = now()`,
      [user.id, next.platformTabs ? JSON.stringify(next.platformTabs) : null, next.crmTabs ? JSON.stringify(next.crmTabs) : null]);
    res.json(next);
  });
}
