/**
 * Review-request escalation: the owner's score threshold and the private-feedback alert.
 *
 *   getReviewEscalationThreshold(userId)      — the stored threshold, or the default (8)
 *   saveReviewEscalationThreshold(userId, n)  — upsert (review_escalation_settings, server/growth-schema.ts)
 *   escalatePrivateFeedback(request, …)       — once per request: bell + email (notifyUser, kind
 *                                               reviews.private_feedback) and Telegram through the LSA bot
 *                                               when the owner linked it, then escalation_alerted_at.
 *
 * Routing itself is shared/review-flow.ts. None of this touches the Google link: the client page shows it
 * on every step whatever the score (the hard rule in review-flow.ts).
 */
import { pool } from "./db";
import { notifyUser } from "./account-events";
import {
  DEFAULT_REVIEW_ESCALATION_THRESHOLD, isPrivateFirstScore, normalizeReviewEscalationThreshold, reviewEscalationSettingsInput,
} from "@shared/review-flow";

export { reviewEscalationSettingsInput };

export async function getReviewEscalationThreshold(userId: number): Promise<number> {
  const { rows } = await pool.query("SELECT threshold FROM review_escalation_settings WHERE user_id=$1", [userId]);
  return rows[0] ? normalizeReviewEscalationThreshold(rows[0].threshold) : DEFAULT_REVIEW_ESCALATION_THRESHOLD;
}

export async function saveReviewEscalationThreshold(userId: number, threshold: number): Promise<{ reviewEscalationThreshold: number }> {
  const { reviewEscalationThreshold } = reviewEscalationSettingsInput.parse({ reviewEscalationThreshold: threshold });
  await pool.query(`INSERT INTO review_escalation_settings(user_id,threshold,updated_at) VALUES($1,$2,now())
    ON CONFLICT(user_id) DO UPDATE SET threshold=EXCLUDED.threshold,updated_at=now()`, [userId, reviewEscalationThreshold]);
  return { reviewEscalationThreshold };
}

export type EscalationRequest = {
  id: number; userId: number; clientName: string; clientEmail?: string | null; projectDescription?: string | null;
  feedbackRating: number | null; feedbackCategories?: unknown; feedbackComments?: string | null;
  escalationAlertedAt?: Date | null;
};

const TG_API = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

/** The owner's Telegram chat from the LSA alert bot link (server/lsa/telegram.ts); null when not linked. */
async function ownerTelegramChatId(userId: number): Promise<string | null> {
  const { rows } = await pool.query("SELECT telegram_chat_id FROM lsa_connections WHERE user_id=$1 AND telegram_chat_id IS NOT NULL LIMIT 1", [userId]);
  return rows[0]?.telegram_chat_id ? String(rows[0].telegram_chat_id) : null;
}

async function sendTelegram(chatId: string, html: string): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  try {
    const resp = await fetch(TG_API("sendMessage"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!resp.ok) { console.warn(`Telegram review alert rejected (${resp.status})`); return false; }
    return true;
  } catch (e: any) {
    console.warn(`Telegram review alert failed: ${e?.message || String(e)}`);
    return false;
  }
}

const categoriesOf = (v: unknown): string[] => Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && c.trim() !== "") : [];

/**
 * The owner alert for a sub-threshold score, sent once per request (escalation_alerted_at). Name, score,
 * job and the client's own words; a request without text still alerts ("no written feedback yet").
 * Returns what was sent so the route can log it; never throws (an alert failure must not fail the client's save).
 */
export async function escalatePrivateFeedback(
  request: EscalationRequest, threshold: number,
  deps: { notify?: typeof notifyUser; telegram?: typeof sendTelegram; chatIdFor?: typeof ownerTelegramChatId } = {},
): Promise<{ sent: boolean; telegram: boolean }> {
  const rating = request.feedbackRating;
  if (rating == null || !isPrivateFirstScore(rating, threshold) || request.escalationAlertedAt) return { sent: false, telegram: false };
  const notify = deps.notify ?? notifyUser, telegram = deps.telegram ?? sendTelegram, chatIdFor = deps.chatIdFor ?? ownerTelegramChatId;

  const job = request.projectDescription?.trim() || "not specified";
  const categories = categoriesOf(request.feedbackCategories);
  const text = request.feedbackComments?.trim() || "";
  const lines = [
    `Job: ${job}`,
    categories.length ? `Areas: ${categories.join(", ")}` : "",
    text ? `"${text}"` : "No written feedback yet.",
    `Score ${rating}/10 is below your threshold of ${threshold}. They were asked privately first and are still being offered the Google link, so a quick call now can fix it before it becomes a public review.`,
  ].filter(Boolean);

  let sent = false, tg = false;
  try {
    const r = await notify(request.userId, "reviews.private_feedback", {
      title: `Private feedback from ${request.clientName}: ${rating}/10`,
      body: lines.join("\n"),
      link: "/google-reviews",
      severity: "warning",
      actionLabel: "Open Google Reviews",
      actionUrl: "/google-reviews",
    });
    sent = r.inApp || r.email === "sent";
  } catch (e: any) {
    console.error("[review-escalation] notify failed:", e?.message || e);
  }
  try {
    const chatId = await chatIdFor(request.userId);
    if (chatId) {
      const html =
        `🟠 <b>Private feedback: ${esc(request.clientName)} scored ${rating}/10</b>\n\n` +
        `🔧 Job: <b>${esc(job)}</b>\n` +
        (categories.length ? `🗂️ Areas: ${esc(categories.join(", "))}\n` : "") +
        (text ? `💬 "${esc(text)}"\n` : `💬 No written feedback yet.\n`) +
        `\nBelow your threshold of ${threshold}. They are still being offered the Google link — reach out now, while they are reachable.`;
      tg = await telegram(chatId, html);
    }
  } catch (e: any) {
    console.error("[review-escalation] telegram failed:", e?.message || e);
  }
  await pool.query("UPDATE review_requests SET escalation_alerted_at=now() WHERE id=$1 AND escalation_alerted_at IS NULL", [request.id]);
  return { sent, telegram: tg };
}
