/**
 * Send a trial invite from the command line, exactly as Settings → Trial codes does (code row + invite email with
 * the one-click /invite/<code> link). For when the owner asks Claude to "send it to him".
 *
 *   npx tsx script/send-trial-invite.ts --email someone@example.com --name Dennis --days 0   (0 = unlimited)
 *
 * Needs DATABASE_URL and the app's SMTP settings (run with the live app's .env). Created by user 1 (the platform
 * admin). Prints the code and the invite link.
 */
import { randomUUID } from "crypto";
import pg from "pg";
import { sendTrialInviteEmail, trialInviteUrl } from "../server/email";
import { trialCodeDays } from "../shared/access-grants";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim();
  const name = arg("name")?.trim() || "there";
  const days = trialCodeDays(Number(arg("days") ?? "0"));
  const baseUrl = arg("base") || "https://constructhub.us";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email is required");
  if (days === null) throw new Error("--days must be 0 (unlimited) or 1–1000");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const unlimited = days === 0;
  const code = "TRIAL-" + randomUUID().slice(0, 8).toUpperCase();
  const expiresAt = unlimited ? new Date("2099-12-31T23:59:59Z") : new Date(Date.now() + days * 86_400_000);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `INSERT INTO beta_access_codes (code, created_by_user_id, expires_at, trial_days, recipient_email, recipient_name, revoked)
       VALUES ($1, 1, $2, $3, $4, $5, false)`, [code, expiresAt, days, email, name === "there" ? null : name]);
  } finally {
    await pool.end();
  }
  await sendTrialInviteEmail(email, name, code, unlimited ? -1 : days, baseUrl);
  console.log(JSON.stringify({ sent: true, to: email, code, inviteUrl: trialInviteUrl(baseUrl, code), days: unlimited ? "unlimited" : days }));
}

main().catch((e) => { console.error("send-trial-invite failed:", e?.message || e); process.exit(1); });
