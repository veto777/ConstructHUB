/**
 * SMS (SignalWire) — bid reminders by text, a test-send for Settings, and the
 * "client is reviewing their bid again — call them" engagement alert.
 *
 * SignalWire is the carrier: same delivery as Twilio at roughly half the
 * per-message cost, over a Twilio-compatible (LaML) API. Credentials come
 * from env (SIGNALWIRE_SPACE_URL / PROJECT_ID / API_TOKEN / FROM_NUMBER) and
 * are read AT CALL TIME, never cached at module scope, so smsConfigured()
 * always tells the truth about the process it's running in. When the env vars
 * are absent the provider seam falls back to a LOG provider that records each
 * message to tmp/sms-outbox.jsonl (override with SMS_OUTBOX_PATH) instead of
 * sending — dev and e2e exercise the exact production code path without a
 * carrier account, and the result names the provider so the UI never pretends
 * a text went out.
 */
import type { Express } from "express";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { db } from "../db";
import {
  crmCustomers, crmEstimates, crmMembers, crmOrgs, crmProjects,
  crmEngagementSessions, crmNotificationEnabled,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { sendWithFallback } from "../email";
import { getBaseUrl } from "../auth";
import { portalBaseUrl } from "../site-context";
import { logEvent, presentEstimate } from "./entities";

type GetUser = (req: any, res: any) => any;

// ── Configuration ───────────────────────────────────────────────────────────

export const SIGNALWIRE_ENV_VARS = [
  "SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN", "SIGNALWIRE_FROM_NUMBER",
] as const;

/** Names of the env vars that still need to be set (empty = fully configured). */
export function smsMissingEnv(): string[] {
  return SIGNALWIRE_ENV_VARS.filter((k) => !process.env[k]);
}

export function smsConfigured(): boolean {
  return smsMissingEnv().length === 0;
}

/** What the Settings card renders — never leaks the auth token. */
export function smsStatus() {
  const missing = smsMissingEnv();
  return {
    configured: missing.length === 0,
    missing,
    provider: missing.length === 0 ? "signalwire" : null,
    fromNumber: missing.length === 0 ? process.env.SIGNALWIRE_FROM_NUMBER! : null,
  };
}

// ── The provider seam ───────────────────────────────────────────────────────

export type SmsResult = {
  ok: boolean;
  provider: "signalwire" | "log";
  sid?: string | null;
  error?: string | null;
};

const LOG_PATH = () => process.env.SMS_OUTBOX_PATH ?? path.join(process.cwd(), "tmp", "sms-outbox.jsonl");

/**
 * Dev/e2e provider: records instead of sends. Same call shape as the carrier, so
 * callers never branch on configuration — the RESULT tells them which
 * provider actually handled the message.
 */
function logProviderSend(to: string, body: string): SmsResult {
  const entry = { at: new Date().toISOString(), provider: "log", to, body };
  try {
    fs.mkdirSync(path.dirname(LOG_PATH()), { recursive: true });
    fs.appendFileSync(LOG_PATH(), JSON.stringify(entry) + "\n");
  } catch { /* a full disk must not break a bid reminder */ }
  console.log(`[SMS LOG] no carrier configured — recorded instead of sending (to: ${to})`);
  return { ok: true, provider: "log", sid: null };
}

/** SignalWire Compatibility API — Twilio-shaped: POST {space}/api/laml/2010-04-01/
 *  Accounts/{project}/Messages.json, basic auth project:token. */
async function signalwireSend(to: string, body: string): Promise<SmsResult> {
  const space = process.env.SIGNALWIRE_SPACE_URL!.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const project = process.env.SIGNALWIRE_PROJECT_ID!;
  const token = process.env.SIGNALWIRE_API_TOKEN!;
  const from = process.env.SIGNALWIRE_FROM_NUMBER!;
  try {
    const resp = await fetch(
      `https://${space}/api/laml/2010-04-01/Accounts/${encodeURIComponent(project)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${project}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
      },
    );
    const payload: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = String(payload?.message ?? `SignalWire HTTP ${resp.status}`).slice(0, 300);
      console.error("[sms] SignalWire send failed:", msg);
      return { ok: false, provider: "signalwire", error: msg };
    }
    return { ok: true, provider: "signalwire", sid: payload?.sid ?? null };
  } catch (e: any) {
    console.error("[sms] SignalWire send failed:", e?.message || e);
    return { ok: false, provider: "signalwire", error: String(e?.message || e).slice(0, 300) };
  }
}

/**
 * Send a text: SignalWire when configured, the recording log provider when
 * not — check `result.provider` before telling a user a text "went out".
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!smsConfigured()) return logProviderSend(to, body);
  return signalwireSend(to, body);
}

/** Loose E.164 sanity: optional +, 7–15 digits. Returns null when unusable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return s.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

const money = (c?: number | null) =>
  c === null || c === undefined ? "" : `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

// ── Engagement re-engagement alert ──────────────────────────────────────────

/** UTC day key — the once-per-estimate-per-day idempotency unit. */
export function reengagementDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fire the "client is reviewing their bid — call them" alert. Callers decide
 * WHAT counts as a repeat open (a 2nd+ distinct engagement session, or a
 * deduped repeat view on the gated GET); this decides WHETHER to tell anyone:
 * once per estimate per UTC day, gated on the org's clientReengaged
 * notificationPref (default ON). Marks custom_fields->'reengagementAlerts'
 * by MERGING into the existing jsonb — never a wholesale replace.
 *
 * Email: the estimate's creator; fallback the admins of the estimate's
 * division; fallback the org owner(s). SMS: that person's member.phone
 * (falling back to the org phone when the target is the owner) — through the
 * same provider seam as everything else.
 *
 * Returns true when the alert fired (and the day marker was written).
 */
export async function maybeAlertReengagement(args: {
  est: typeof crmEstimates.$inferSelect;
  org: typeof crmOrgs.$inferSelect;
  cust: typeof crmCustomers.$inferSelect;
  req: any;
}): Promise<boolean> {
  const { est, org, cust, req } = args;
  if (!crmNotificationEnabled(org.customFields, "clientReengaged")) return false;

  const cf = { ...((est.customFields as Record<string, any> | null) ?? {}) };
  const prior = (cf.reengagementAlerts as { lastDay?: string; count?: number } | undefined) ?? null;
  const today = reengagementDayKey();
  if (prior?.lastDay === today) return false; // already alerted today

  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, est.orgId), eq(crmMembers.status, "active")));

  let targets = members.filter((m) => m.id === est.createdByMemberId);
  if (!targets.length && est.projectId) {
    const [p] = await db.select({ divisionId: crmProjects.divisionId }).from(crmProjects)
      .where(and(eq(crmProjects.orgId, est.orgId), eq(crmProjects.id, est.projectId))).limit(1);
    if (p?.divisionId) {
      targets = members.filter((m) => m.role === "admin" && m.divisionId === p.divisionId);
    }
  }
  if (!targets.length) targets = members.filter((m) => m.role === "owner");

  const emails = [...new Set(targets.map((m) => m.email).filter(Boolean))] as string[];
  if (!emails.length) return false;

  const clientLink = `${portalBaseUrl(req)}/crm/clients/${cust.id}`;
  const estLabel = est.number ? `estimate ${est.number}` : "their estimate";
  const total = money(est.totalCents);

  await sendWithFallback({
    to: emails.join(","),
    subject: `👀 ${cust.displayName} is reviewing ${estLabel} again — good time to call`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <p><strong>${esc(cust.displayName)}</strong> opened ${esc(estLabel)}${total ? ` (${total})` : ""} again.</p>
      <p>A second look usually means they're close to deciding — a quick call now wins the job.</p>
      <p><a href="${esc(clientLink)}">Open ${esc(cust.displayName)} in the CRM</a></p>
    </div>`,
  } as any).catch((e: any) => console.error("[crm] reengagement email failed:", e?.message || e));

  // Text the person who should make the call. The owner's fallback is the
  // org's main phone; anyone else without a mobile simply doesn't get a text.
  const smsPerson = targets.find((t) => t.phone) ?? targets.find((t) => t.role === "owner");
  const smsTo = normalizePhone(smsPerson?.phone ?? (smsPerson?.role === "owner" ? org.phone : null));
  let smsResult: SmsResult | null = null;
  if (smsTo) {
    smsResult = await sendSms(
      smsTo,
      `${cust.displayName} is reviewing ${estLabel}${total ? ` (${total})` : ""} again — good time to call. ${clientLink}`,
    );
  }

  // Mark AFTER the sends so a crashed alert can retry on the next open; the
  // day key still caps it at one alert per estimate per day.
  cf.reengagementAlerts = {
    lastDay: today,
    lastAlertedAt: new Date().toISOString(),
    count: (prior?.count ?? 0) + 1,
    emailedTo: emails,
    textedTo: smsResult?.ok ? smsTo : null,
    smsProvider: smsResult?.provider ?? null,
  };
  await db.update(crmEstimates).set({ customFields: cf, updatedAt: new Date() })
    .where(eq(crmEstimates.id, est.id));
  return true;
}

/**
 * Repeat-open detector for the engagement/start path: a 2nd+ DISTINCT
 * session on the same estimate means the client came back. First visit = 0
 * prior sessions = no alert (that's the "opened" notification's job).
 */
export async function priorEstimateSessionCount(estimateId: string): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmEngagementSessions)
    .where(and(
      eq(crmEngagementSessions.docType, "estimate"),
      eq(crmEngagementSessions.docId, estimateId),
    ));
  return n;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerCrmSmsRoutes(app: Express, getDevUser: GetUser): void {
  /** Settings card: configured/not-configured, naming the missing env vars. */
  app.get("/api/crm/sms/status", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    res.json(smsStatus());
  });

  /** Send a real test text — manageIntegrations only. Honest 503 when the
   *  carrier env vars are missing (the log provider is for system sends, not
   *  for pretending a test reached a phone). */
  app.post("/api/crm/sms/test", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;

    if (!smsConfigured()) {
      return res.status(503).json({
        message: `SMS is not configured — set ${smsMissingEnv().join(", ")} on the server.`,
        missing: smsMissingEnv(),
      });
    }

    const parsed = z.object({
      to: z.string().min(7).max(24),
      body: z.string().max(1600).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid test text", issues: parsed.error.issues });

    const to = normalizePhone(parsed.data.to);
    if (!to) return res.status(400).json({ message: "That doesn't look like a phone number." });

    const result = await sendSms(to, parsed.data.body?.trim() || `Test text from ${ctx.org.name} — SMS is working.`);
    if (!result.ok) return res.status(502).json({ message: `SignalWire rejected the text: ${result.error}` });
    res.json({ ok: true, provider: result.provider, sid: result.sid, to });
  });

  /**
   * Bid reminder: re-email the estimate link (existing resend path) and, when
   * the client has a phone, text it too. Every reminder is appended to
   * estimate custom_fields->'reminders' (who/when/channel) — merged into the
   * existing jsonb, never clobbered.
   */
  app.post("/api/crm/estimates/:id/remind", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageEstimates")) return;

    const [est] = await db.select().from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, ctx.org.id), eq(crmEstimates.id, req.params.id))).limit(1);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (!est.sentAt) return res.status(409).json({ message: "Send the estimate before reminding about it." });
    if (est.approvedAt) return res.status(409).json({ message: "This estimate has been approved — no reminder needed." });
    if (est.declinedAt) return res.status(409).json({ message: "This estimate has been declined." });

    const [cust] = await db.select().from(crmCustomers).where(eq(crmCustomers.id, est.customerId)).limit(1);
    if (!cust) return res.status(400).json({ message: "Customer not found" });

    const to = cust.email || est.sentToEmail;
    const phone = normalizePhone(cust.phone);
    if (!to && !phone) {
      return res.status(400).json({ message: "This client has no email address or phone number. Add one first." });
    }

    const base = getBaseUrl(req);
    const link = `${base}/e/${est.publicToken}`;
    const estLabel = est.number ? `estimate ${est.number}` : "your estimate";
    const total = money(est.totalCents);

    // Email — the same resend path as the original send.
    let emailed = false;
    let emailError: string | null = null;
    if (to) {
      try {
        await sendWithFallback({
          to,
          subject: `Reminder: ${estLabel} from ${ctx.org.name} is waiting`,
          html: `
            <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e5e5;padding:28px 24px">
              <p style="font-size:16px">Hi ${esc(cust.displayName)},</p>
              <p style="font-size:16px">Just a friendly reminder from <strong>${esc(ctx.org.name)}</strong> —
                 ${esc(estLabel)}${total ? ` for <strong>${total}</strong>` : ""} is still waiting for your answer.</p>
              <p style="text-align:center;margin:30px 0 18px">
                <a href="${link}" style="background:#2563eb;color:#fff;padding:14px 34px;border-radius:24px;
                   text-decoration:none;font-weight:600;font-size:16px;display:inline-block">View estimate</a>
              </p>
              <p style="font-size:12px;color:#999;word-break:break-all">If the button doesn't work, paste this into your browser: ${link}</p>
            </div>`,
          replyTo: ctx.org.email || undefined,
        } as any);
        emailed = true;
      } catch (e: any) {
        emailError = String(e?.message || e).slice(0, 300);
        console.error("[crm] estimate reminder email failed:", emailError);
      }
    }

    // Text — only when the client has a usable phone. `provider` says whether
    // it really went out (signalwire) or was recorded (log, unconfigured dev).
    let texted = false;
    let smsProvider: SmsResult["provider"] | null = null;
    let smsError: string | null = null;
    if (phone) {
      const r = await sendSms(
        phone,
        `${ctx.org.name}: reminder — ${estLabel}${total ? ` for ${total}` : ""} is waiting: ${link}`,
      );
      texted = r.ok;
      smsProvider = r.provider;
      smsError = r.error ?? null;
    }

    // Record who/when/channel — append into custom_fields->'reminders'.
    const cf = { ...((est.customFields as Record<string, any> | null) ?? {}) };
    const reminders = [...(Array.isArray(cf.reminders) ? cf.reminders : [])];
    reminders.push({
      at: new Date().toISOString(),
      by: ctx.member.id,
      channel: [emailed ? "email" : null, texted ? "sms" : null].filter(Boolean).join("+") || "none",
      email: to ?? null,
      phone: texted ? phone : null,
      smsProvider,
      emailed, emailError, smsError,
    });
    cf.reminders = reminders;
    const [row] = await db.update(crmEstimates).set({ customFields: cf, updatedAt: new Date() })
      .where(eq(crmEstimates.id, est.id)).returning();

    await logEvent(ctx.org.id, est.id, "reminded", ctx.member.id, req, {
      to, emailed, emailError, texted, smsProvider, smsError,
    });

    res.json({
      estimate: presentEstimate(row, ctx), link, reminders,
      emailed, emailError, texted, smsProvider, smsError,
    });
  });
}
