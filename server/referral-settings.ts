import { z } from "zod";
import { pool } from "./db";
export const referralSettingsInput = z.object({ enabled: z.boolean(), offer: z.string().trim().max(500) })
  .refine(s => !s.enabled || s.offer.length > 0, "Describe the referral offer before enabling it");
export async function getReferralSettings(userId: number) {
  const { rows } = await pool.query("SELECT enabled,offer FROM review_referral_settings WHERE user_id=$1", [userId]);
  return rows[0] || { enabled: false, offer: "" };
}
export async function saveReferralSettings(userId: number, input: z.infer<typeof referralSettingsInput>) {
  await pool.query(`INSERT INTO review_referral_settings(user_id,enabled,offer) VALUES($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,offer=EXCLUDED.offer`, [userId, input.enabled, input.offer]);
  return input;
}
