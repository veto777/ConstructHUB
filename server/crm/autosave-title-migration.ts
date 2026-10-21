/**
 * One-time fix for drafts autosaved before the live auto-title (2026-10-21): the old dialog copied the FIRST picked
 * price-book item's name into the title and never updated it ("Seamless Gutter Installation" on a draft whose only
 * line is "Door Remodel"). For every unfinished autosaved draft that has no auto-title flag yet:
 *   - title looks automatic (shared/estimate-draft.ts titleLooksAuto: the default, the lines' own title, or a
 *     price-book item's name) → title recomputed from the lines, flag autoTitle: true;
 *   - anything else was typed → title kept, flag autoTitle: false.
 * Idempotent: a draft with the flag is never touched again. Runs at boot after the CRM schema; never blocks it.
 */
import { pool } from "../db";
import { autoTitleFrom, titleLooksAuto } from "@shared/estimate-draft";

export async function migrateAutosaveTitles(): Promise<number> {
  const drafts = (await pool.query(
    `SELECT id, org_id, title, custom_fields FROM crm_estimates
     WHERE custom_fields ? 'autosave' AND status = 'draft' AND sent_at IS NULL
       AND (custom_fields->'autosave'->'meta'->'autoTitle') IS NULL`,
  )).rows as Array<{ id: string; org_id: string; title: string; custom_fields: any }>;
  let retitled = 0;
  const namesByOrg = new Map<string, Set<string>>();
  for (const d of drafts) {
    if (!namesByOrg.has(d.org_id)) {
      const r = await pool.query(`SELECT lower(trim(name)) AS n FROM crm_pb_items WHERE org_id = $1`, [d.org_id]);
      namesByOrg.set(d.org_id, new Set(r.rows.map((x: any) => x.n)));
    }
    const items = (await pool.query(
      `SELECT name, kind FROM crm_estimate_items WHERE org_id = $1 AND estimate_id = $2 ORDER BY sort_order`, [d.org_id, d.id],
    )).rows as Array<{ name: string; kind: string }>;
    const auto = titleLooksAuto(d.title, items, namesByOrg.get(d.org_id));
    const cf = d.custom_fields ?? {};
    const meta = { ...(cf.autosave?.meta ?? {}), autoTitle: auto };
    const next = { ...cf, autosave: { ...(cf.autosave ?? {}), meta } };
    const title = auto ? autoTitleFrom(items) : d.title;
    await pool.query(`UPDATE crm_estimates SET title = $3, custom_fields = $4::jsonb WHERE org_id = $1 AND id = $2`,
      [d.org_id, d.id, title, JSON.stringify(next)]);
    if (auto && title !== d.title) retitled++;
  }
  if (drafts.length) console.log(`[crm] autosaved drafts: ${retitled} title(s) recomputed from their lines, ${drafts.length} flagged`);
  return retitled;
}
