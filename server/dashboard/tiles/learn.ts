/**
 * Learn: Master Class progress; Guides and Reinstatement are link tiles.
 * The AI Call Assistant is "coming_soon" by its gate (server/dashboard/access.ts)
 * and has no source here: no voice table is read (SPEC §3.5).
 */
import { dq } from "../pool";
import { EMPTY, int, metric, ok, type TileSources } from "./types";

export const learnTiles: TileSources = {
  async masterClass(ctx) {
    const [r] = await dq(
      `SELECT (SELECT count(*)::int FROM master_class_modules WHERE is_active) total,
              EXISTS(SELECT 1 FROM course_purchases WHERE user_id=$1 AND is_bundle) bundle,
              (SELECT count(DISTINCT p.module_id)::int FROM course_purchases p
                 JOIN master_class_modules m ON m.id=p.module_id AND m.is_active
                WHERE p.user_id=$1) owned`, [ctx.userId]);
    const total = int(r.total);
    if (!total) return EMPTY;
    const owned = r.bundle ? total : Math.min(int(r.owned), total);
    return ok([metric("owned", "Modules unlocked", owned, "count", { hint: `of ${total}` })]);
  },

  guides: async () => ok([]),
  reinstatement: async () => ok([]),
};
