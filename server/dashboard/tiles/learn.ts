/**
 * Learn: Master Class progress; Guides and Reinstatement are link tiles.
 * The Call Assistant is "coming_soon" by its gate (server/dashboard/access.ts)
 * and has no source here: no voice table is read (SPEC §3.5).
 *
 * "Modules unlocked" follows the course's own access rule (server/state-guides.ts
 * courseUnlocks): a plan that includes the Master Class (ctx.ent.modules.masterClass)
 * or a bundle purchase opens every module; a module purchase opens the module whose
 * category it bought. Counting purchase rows alone said "0 of 4" to an Unlimited
 * account whose every module was open (re-score, 2026-10-11). No dev preview here —
 * the tile reports what the account holds.
 */
import { courseUnlocks } from "../../state-guides";
import { dq } from "../pool";
import { EMPTY, int, metric, ok, type TileSources } from "./types";

export const learnTiles: TileSources = {
  async masterClass(ctx) {
    const [modules, purchases] = await Promise.all([
      dq<{ id: number; category: string }>(`SELECT id, category FROM master_class_modules WHERE is_active ORDER BY sort_order`),
      dq<{ module_id: number | null; is_bundle: boolean | null }>(`SELECT module_id, is_bundle FROM course_purchases WHERE user_id=$1`, [ctx.userId]),
    ]);
    const total = modules.length;
    if (!total) return EMPTY;
    const included = ctx.ent.modules.masterClass === true;
    const u = courseUnlocks({ included, purchases: purchases.map((p) => ({ moduleId: p.module_id == null ? null : int(p.module_id), isBundle: p.is_bundle })) }, modules);
    const owned = u.all ? total : modules.filter((m) => u.unlocked[m.category as keyof typeof u.unlocked] === true).length;
    return ok([metric("owned", "Modules unlocked", owned, "count", { hint: included ? `of ${total} · included in your plan` : `of ${total}` })]);
  },

  guides: async () => ok([]),
  reinstatement: async () => ok([]),
};
