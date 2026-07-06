/**
 * LSA Telegram integration — MULTI-TENANT, one shared bot.
 *
 * Each user links their own Telegram by opening a deep link
 * (https://t.me/<bot>?start=<token>). The bot's /start handler captures their
 * private chat id into lsa_connections.telegram_chat_id — that's what we DM. A
 * bot can NEVER DM a user by @username, so the deep-link handshake is required.
 *
 * New-lead alerts DM the owning user only. Inline-button disputes (reported from
 * the alert) are authorized: the callback's chat id must own the lead.
 */
import crypto from "crypto";
import { db } from "../db";
import { lsaLeads, lsaConnections } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { enqueueDisputes } from "./disputes";
import { getConnectionByChatId, getConnectionByLinkToken } from "./store";
import type { LsaConnection } from "@shared/schema";

const TG_API = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Reason mapping (free-text → Google enum) ────────────────────────────────
const TG_REASON_MAP: { keys: string[]; reason: string; label: string }[] = [
  { keys: ["spam"], reason: "SPAM", label: "Spam" },
  { keys: ["solicit", "sales call", "sales", "telemarket", "marketing call", "selling"], reason: "SOLICITATION", label: "Solicitation (sales call)" },
  { keys: ["duplicate", "dupe", "same lead", "already have this"], reason: "DUPLICATE", label: "Duplicate" },
  { keys: ["not my service", "don't offer", "dont offer", "not offer", "wrong service", "job type", "don't do", "dont do", "not offered", "not the service", "service i don"], reason: "JOB_TYPE_MISMATCH", label: "Service I don't offer" },
  { keys: ["outside", "out of area", "out of my area", "too far", "not in my area", "wrong area", "geo", "far away"], reason: "GEO_MISMATCH", label: "Outside my area" },
  { keys: ["not ready", "just looking", "browsing", "window shopping"], reason: "NOT_READY_TO_BOOK", label: "Not ready to book" },
];

export function parseDisputeReason(text: string): { reason: string; label: string } | null {
  const t = String(text || "").toLowerCase();
  for (const r of TG_REASON_MAP) {
    for (const k of r.keys) if (t.includes(k)) return { reason: r.reason, label: r.label };
  }
  return null;
}

function reasonLabel(reason: string): string {
  const hit = TG_REASON_MAP.find((r) => r.reason === reason);
  return hit ? hit.label : reason;
}

/** Inline keyboard offering each valid dispute reason for a lead. */
function reasonKeyboard(leadId: string) {
  const rows = TG_REASON_MAP.map((r) => [{ text: r.label, callback_data: `lsadr:${leadId}:${r.reason}` }]);
  rows.push([{ text: "✖️ Cancel", callback_data: `lsadx:${leadId}` }]);
  return { inline_keyboard: rows };
}

// ── New-lead alert ──────────────────────────────────────────────────────────
export async function notifyNewLead(
  conn: Pick<LsaConnection, "telegramChatId">,
  lead: {
    leadId: string;
    userId: number | null;
    contactName: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    leadType: string | null;
    categoryId: string | null;
    serviceId: string | null;
    leadStatus: string | null;
    leadCreationTime: Date | null;
  },
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = conn.telegramChatId;
  if (!botToken || !chatId) return;

  const row = (label: string, val?: string | null) => (val ? `${label}: <b>${esc(String(val))}</b>\n` : "");
  const when = lead.leadCreationTime
    ? lead.leadCreationTime.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
    : "";

  const text =
    `🟢 <b>New Google LSA Lead</b>\n\n` +
    row("👤 Name", lead.contactName) +
    row("📞 Phone", lead.contactPhone) +
    row("✉️ Email", lead.contactEmail) +
    row("🔧 Type", lead.leadType) +
    row("🗂️ Category", lead.categoryId) +
    row("🛠️ Service", lead.serviceId) +
    row("📊 Status", lead.leadStatus) +
    (when ? `🕐 ${esc(when)}\n` : "") +
    `\n⚡ Source: <b>Google Local Services Ads</b>` +
    `\n\n🚩 Bad lead? Tap <b>Report bad lead</b> below and pick a reason.`;

  const replyMarkup = { inline_keyboard: [[{ text: "🚩 Report bad lead", callback_data: `lsadq:${lead.leadId}` }]] };

  try {
    const resp = await fetch(TG_API("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`Telegram LSA alert rejected (${resp.status}): ${body.slice(0, 300)}`);
      return;
    }
    try {
      const data: any = await resp.json();
      const mid = data?.result?.message_id;
      if (mid != null) {
        await db.update(lsaLeads).set({ tgAlertMessageId: String(mid) }).where(eq(lsaLeads.leadId, lead.leadId));
      }
    } catch { /* non-fatal */ }
  } catch (e: any) {
    console.warn(`Telegram LSA alert failed: ${e?.message || String(e)}`);
  }
}

// ── Telegram-driven single-lead dispute (scoped to owner) ───────────────────
async function findLeadByTgAlertMessageId(
  userId: number,
  messageId: string,
): Promise<{ leadId: string; contactName: string | null } | null> {
  const mid = String(messageId || "").trim();
  if (!mid) return null;
  const rows = await db
    .select({ leadId: lsaLeads.leadId, contactName: lsaLeads.contactName })
    .from(lsaLeads)
    .where(and(eq(lsaLeads.tgAlertMessageId, mid), eq(lsaLeads.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function disputeLeadFromTelegram(
  userId: number,
  leadId: string,
  reason: string,
): Promise<{ ok: boolean; code: "ok" | "uncharged" | "already" | "not_found"; label?: string; name?: string }> {
  const id = String(leadId || "").replace(/\D/g, "");
  if (!id) return { ok: false, code: "not_found" };
  const rows = await db
    .select()
    .from(lsaLeads)
    .where(and(eq(lsaLeads.leadId, id), eq(lsaLeads.userId, userId)))
    .limit(1);
  const lead = rows[0];
  if (!lead) return { ok: false, code: "not_found" };
  const name = lead.contactName || lead.contactEmail || `Lead ${id}`;
  if (lead.feedbackSubmitted === true) return { ok: false, code: "already", name };
  if (["queued", "sending", "disputed"].includes(String(lead.disputeStatus))) {
    return { ok: false, code: "already", name };
  }
  if (lead.leadCharged !== true) return { ok: false, code: "uncharged", name };
  try {
    await enqueueDisputes(userId, [{ leadId: id, reason }]);
  } catch {
    return { ok: false, code: "already", name };
  }
  return { ok: true, code: "ok", label: reasonLabel(reason), name };
}

// ── Telegram API helpers ────────────────────────────────────────────────────
async function tgCall(method: string, body: unknown): Promise<void> {
  try {
    await fetch(TG_API(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    console.warn(`Telegram ${method} failed: ${e?.message || String(e)}`);
  }
}

async function answerCallback(id: string, text?: string): Promise<void> {
  await tgCall("answerCallbackQuery", { callback_query_id: id, text: text || undefined, show_alert: false });
}

let cachedBotUsername: string | null = null;
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  try {
    const resp = await fetch(TG_API("getMe"));
    const data: any = await resp.json();
    cachedBotUsername = data?.result?.username || null;
  } catch { /* ignore */ }
  return cachedBotUsername;
}

// ── Webhook handler ─────────────────────────────────────────────────────────
export async function handleWebhookUpdate(update: any): Promise<void> {
  try {
    if (update?.callback_query) {
      await handleCallback(update.callback_query);
      return;
    }
    if (update?.message) {
      await handleMessage(update.message);
      return;
    }
  } catch (e: any) {
    console.warn(`LSA Telegram webhook error: ${e?.message || String(e)}`);
  }
}

async function handleCallback(cq: any): Promise<void> {
  const data = String(cq?.data || "");
  const chatId = String(cq?.message?.chat?.id || "");
  const messageId = cq?.message?.message_id;
  const cbId = String(cq?.id || "");
  if (!chatId || !data) {
    await answerCallback(cbId);
    return;
  }
  const conn = await getConnectionByChatId(chatId);
  if (!conn) {
    await answerCallback(cbId, "This Telegram isn't linked to an account.");
    return;
  }

  // Step 1: "Report bad lead" — show the reason buttons.
  if (data.startsWith("lsadq:")) {
    const leadId = data.slice("lsadq:".length);
    await answerCallback(cbId);
    await tgCall("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: reasonKeyboard(leadId) });
    return;
  }

  // Cancel — restore the single report button.
  if (data.startsWith("lsadx:")) {
    const leadId = data.slice("lsadx:".length);
    await answerCallback(cbId, "Cancelled.");
    await tgCall("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "🚩 Report bad lead", callback_data: `lsadq:${leadId}` }]] },
    });
    return;
  }

  // Step 2: a reason was picked — file the dispute (owner-scoped).
  if (data.startsWith("lsadr:")) {
    const rest = data.slice("lsadr:".length);
    const idx = rest.lastIndexOf(":");
    const leadId = rest.slice(0, idx);
    const reason = rest.slice(idx + 1);
    const res = await disputeLeadFromTelegram(conn.userId, leadId, reason);
    let note = "";
    if (res.code === "ok") note = `✅ Reported "${res.name}" as ${res.label}. It'll be sent to Google shortly.`;
    else if (res.code === "uncharged") note = `ℹ️ "${res.name}" wasn't charged, so there's nothing to dispute.`;
    else if (res.code === "already") note = `ℹ️ "${res.name}" is already disputed or in progress.`;
    else note = "Couldn't find that lead.";
    await answerCallback(cbId, note.slice(0, 190));
    await tgCall("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    return;
  }

  await answerCallback(cbId);
}

async function handleMessage(msg: any): Promise<void> {
  const chatId = String(msg?.chat?.id || "");
  const text = String(msg?.text || "").trim();
  if (!chatId) return;

  // Deep-link linking: /start <token> captures this chat id for the connection.
  if (text.startsWith("/start")) {
    const token = text.slice("/start".length).trim();
    if (token) {
      const conn = await getConnectionByLinkToken(token);
      if (conn) {
        await db
          .update(lsaConnections)
          .set({ telegramChatId: chatId, telegramLinkToken: null, updatedAt: new Date() })
          .where(eq(lsaConnections.id, conn.id));
        await tgCall("sendMessage", {
          chat_id: chatId,
          text: "✅ Telegram linked! You'll get a DM here for every new Google LSA lead, and you can report bad leads right from the alert.",
        });
        return;
      }
    }
    await tgCall("sendMessage", {
      chat_id: chatId,
      text: "👋 To link this Telegram to your ConstructHUB account, open the link from the LSA Leads page in the app.",
    });
    return;
  }

  // Plain-text reply to a lead alert: map back to the lead and dispute.
  const replyTo = msg?.reply_to_message?.message_id;
  if (replyTo) {
    const conn = await getConnectionByChatId(chatId);
    if (!conn) return;
    const lead = await findLeadByTgAlertMessageId(conn.userId, String(replyTo));
    if (!lead) return;
    const parsed = parseDisputeReason(text);
    if (!parsed) {
      await tgCall("sendMessage", {
        chat_id: chatId,
        text: "I couldn't tell the reason. Try: spam, sales call, duplicate, not my service, outside my area, or not ready.",
      });
      return;
    }
    const res = await disputeLeadFromTelegram(conn.userId, lead.leadId, parsed.reason);
    if (res.code === "ok") {
      await tgCall("sendMessage", { chat_id: chatId, text: `✅ Reported "${res.name}" as ${res.label}.` });
    } else if (res.code === "uncharged") {
      await tgCall("sendMessage", { chat_id: chatId, text: `ℹ️ "${res.name}" wasn't charged — nothing to dispute.` });
    } else if (res.code === "already") {
      await tgCall("sendMessage", { chat_id: chatId, text: `ℹ️ "${res.name}" is already disputed or in progress.` });
    }
  }
}

// ── Webhook registration (prod only) ────────────────────────────────────────
export function webhookSecretToken(): string {
  return crypto.createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN || "").digest("hex");
}

export async function ensureWebhook(baseUrl: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  const url = `${baseUrl.replace(/\/$/, "")}/api/lsa/telegram/webhook`;
  try {
    const resp = await fetch(TG_API("setWebhook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: webhookSecretToken(),
        allowed_updates: ["message", "callback_query"],
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (data?.ok) console.log(`✅ LSA Telegram webhook set: ${url}`);
    else console.warn(`LSA Telegram setWebhook response: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (e: any) {
    console.warn(`LSA Telegram setWebhook failed: ${e?.message || String(e)}`);
  }
}
