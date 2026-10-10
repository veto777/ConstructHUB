/**
 * Permit alert delivery: one digest per watch per poll on each channel the
 * watch enabled — email (server/email.ts mailer), SMS (server/crm/sms.ts, charged
 * to the owner's CRM texting allowance) and Telegram (the LSA Leads bot: the
 * user's linked chat in lsa_connections.telegram_chat_id).
 *
 * `permitAlertDeliveryDeps` is swapped by the tests; nothing here throws — every
 * channel reports its own ok/error and the poller stores that on the hit.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { crmMembers, crmOrgs, lsaConnections, users, type Permit, type PermitWatch } from "@shared/schema";
import { DIGEST_MAX_PERMITS, type WatchChannels } from "@shared/permit-alerts";
import { sendWithFallback } from "../email";
import { normalizePhone, sendSms } from "../crm/sms";

export type ChannelResult = { ok: boolean; detail?: string | null };
export type DeliveryResults = Partial<Record<"email" | "sms" | "telegram", ChannelResult>>;

export function alertsBaseUrl(): string {
  return (process.env.APP_URL || process.env.LSA_PUBLIC_BASE_URL || "https://constructhub.us").replace(/\/$/, "");
}

export function watchLink(watchId: number): string {
  return `${alertsBaseUrl()}/permit-alerts?watch=${watchId}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const line = (p: Permit) => [p.permitNumber, p.permitType, p.address, p.contractorName ? `by ${p.contractorName}` : null, p.status, p.issuedAt ? `issued ${p.issuedAt}` : p.appliedAt ? `applied ${p.appliedAt}` : null]
  .filter(Boolean).join(" · ");

/** Subject, plain text, HTML and a short SMS/Telegram text for one digest. */
export function renderDigest(watch: Pick<PermitWatch, "id" | "name">, permits: Permit[]) {
  const shown = permits.slice(0, DIGEST_MAX_PERMITS);
  const more = permits.length - shown.length;
  const subject = `${permits.length} new permit${permits.length === 1 ? "" : "s"} — ${watch.name}`;
  const link = watchLink(watch.id);
  const text = [
    `Permit alert: ${watch.name}`,
    "",
    ...shown.map((p) => `• ${line(p)}${p.sourceUrl ? `\n  ${p.sourceUrl}` : ""}`),
    ...(more > 0 ? [`…and ${more} more`] : []),
    "",
    `See every match: ${link}`,
    "",
    "You get this because of a permit watch on your ConstructHUB account. Turn it off from the link above.",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
  <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#f97316;margin:0 0 4px">Permit alert</p>
  <h1 style="font-size:20px;margin:0 0 16px">${esc(watch.name)}</h1>
  <p style="margin:0 0 12px">${permits.length} new permit${permits.length === 1 ? "" : "s"} matched this watch.</p>
  <ul style="padding-left:18px;margin:0 0 16px">
    ${shown.map((p) => `<li style="margin:0 0 10px"><b>${esc(p.permitNumber)}</b>${p.permitType ? ` · ${esc(p.permitType)}` : ""}<br>
      ${p.address ? esc(p.address) : ""}${p.contractorName ? ` · ${esc(p.contractorName)}` : ""}${p.status ? ` · ${esc(p.status)}` : ""}${p.issuedAt ? ` · issued ${esc(p.issuedAt)}` : ""}
      ${p.description ? `<br><span style="color:#555">${esc(p.description.slice(0, 200))}</span>` : ""}
      ${p.sourceUrl ? `<br><a href="${esc(p.sourceUrl)}">Open on the portal</a>` : ""}</li>`).join("")}
  </ul>
  ${more > 0 ? `<p>…and ${more} more.</p>` : ""}
  <p><a href="${esc(link)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600">See every match</a></p>
  <p style="font-size:12px;color:#777;margin-top:24px">You get this because of a permit watch on your ConstructHUB account. Turn it off from the link above.</p>
</div>`;
  const short = `ConstructHUB permit alert — ${watch.name}: ${permits.length} new permit${permits.length === 1 ? "" : "s"}. ` +
    shown.slice(0, 3).map((p) => `${p.permitNumber}${p.address ? ` ${p.address}` : ""}`).join("; ") +
    (permits.length > 3 ? `; +${permits.length - 3} more` : "") + ` ${link}`;
  const telegramHtml = `🏗️ <b>Permit alert — ${esc(watch.name)}</b>\n${permits.length} new permit${permits.length === 1 ? "" : "s"}\n\n` +
    shown.map((p) => `• <b>${esc(p.permitNumber)}</b>${p.permitType ? ` · ${esc(p.permitType)}` : ""}${p.address ? `\n  ${esc(p.address)}` : ""}${p.contractorName ? `\n  ${esc(p.contractorName)}` : ""}${p.sourceUrl ? `\n  <a href="${esc(p.sourceUrl)}">portal</a>` : ""}`).join("\n") +
    (more > 0 ? `\n…and ${more} more` : "") + `\n\n<a href="${esc(link)}">See every match</a>`;
  return { subject, text, html, short, telegramHtml };
}

export const permitAlertDeliveryDeps = {
  sendEmail: async (to: string, subject: string, text: string, html: string): Promise<void> => {
    await sendWithFallback({
      from: `"ConstructHUB Permit Alerts" <${process.env.SMTP_EMAIL}>`,
      to, subject, text, html,
    });
  },
  sendSms: async (to: string, body: string, org: { id: string; customFields: unknown } | null) => {
    const r = await sendSms(to, body, org?.customFields, org?.id);
    return { ok: r.ok, detail: r.ok ? `${r.provider}${r.segments ? ` ×${r.segments}` : ""}` : r.error ?? "not sent" };
  },
  sendTelegram: async (chatId: string, html: string): Promise<ChannelResult> => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, detail: "Telegram bot not configured" };
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return { ok: false, detail: `Telegram ${resp.status}` };
      return { ok: true };
    } catch (e: any) {
      return { ok: false, detail: String(e?.message ?? e).slice(0, 200) };
    }
  },
};

/** The owner's CRM org (for the texting allowance) and a phone to text, when the watch names none. */
async function smsTarget(userId: number, smsTo: string | null | undefined): Promise<{ to: string | null; org: { id: string; customFields: unknown } | null }> {
  const [org] = await db.select({ id: crmOrgs.id, customFields: crmOrgs.customFields, phone: crmOrgs.phone }).from(crmOrgs).where(eq(crmOrgs.ownerUserId, userId)).limit(1);
  let to = normalizePhone(smsTo);
  if (!to && org) {
    const members = await db.select({ phone: crmMembers.phone, role: crmMembers.role, userId: crmMembers.userId })
      .from(crmMembers).where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
    const own = members.find((m) => m.userId === userId && normalizePhone(m.phone));
    to = normalizePhone(own?.phone) ?? normalizePhone(members.find((m) => m.role === "owner" && normalizePhone(m.phone))?.phone) ?? normalizePhone(org.phone);
  }
  return { to, org: org ? { id: org.id, customFields: org.customFields } : null };
}

export async function deliverDigest(watch: PermitWatch, permits: Permit[]): Promise<DeliveryResults> {
  const ch = (watch.channels ?? {}) as Partial<WatchChannels>;
  const out: DeliveryResults = {};
  if (!permits.length) return out;
  const msg = renderDigest(watch, permits);
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, watch.userId)).limit(1);

  if (ch.email) {
    if (!user?.email) out.email = { ok: false, detail: "No email on the account" };
    else {
      try { await permitAlertDeliveryDeps.sendEmail(user.email, msg.subject, msg.text, msg.html); out.email = { ok: true }; }
      catch (e: any) { out.email = { ok: false, detail: String(e?.message ?? e).slice(0, 200) }; }
    }
  }
  if (ch.sms) {
    try {
      const { to, org } = await smsTarget(watch.userId, ch.smsTo);
      if (!to) out.sms = { ok: false, detail: "No phone number to text — add one to the watch or to your CRM profile" };
      else if (!org) out.sms = { ok: false, detail: "Texts need a CRM account (they count against its texting allowance)" };
      else out.sms = await permitAlertDeliveryDeps.sendSms(to, msg.short.slice(0, 480), org);
    } catch (e: any) { out.sms = { ok: false, detail: String(e?.message ?? e).slice(0, 200) }; }
  }
  if (ch.telegram) {
    const [conn] = await db.select({ chatId: lsaConnections.telegramChatId }).from(lsaConnections).where(eq(lsaConnections.userId, watch.userId)).limit(1);
    if (!conn?.chatId) out.telegram = { ok: false, detail: "Telegram is not linked — link it from LSA Leads" };
    else out.telegram = await permitAlertDeliveryDeps.sendTelegram(conn.chatId, msg.telegramHtml);
  }
  return out;
}
