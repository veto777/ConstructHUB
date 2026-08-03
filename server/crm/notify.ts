/**
 * In-app notifications — the bell at the top of the CRM, fed by the same
 * events that already email (and sometimes text) the owner. One row per
 * recipient member; the per-pref channel matrix in Settings decides which
 * channels fire (in-app / email / sms). Everything here is best-effort: a
 * notification insert must never break the action that caused it.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmNotifications, crmMembers, crmOrgs,
  crmNotificationChannel, type CrmNotificationPref,
} from "@shared/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireOrg } from "./tenancy";
import { sendSms, normalizePhone, resolveSmsSender } from "./sms";

type GetUser = (req: any, res: any) => any;

/** Active owner members (the default audience) plus any extra member ids. */
async function recipientMembers(orgId: string, extraMemberIds: string[] = []) {
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, orgId), eq(crmMembers.status, "active")));
  const ids = new Set<string>();
  for (const m of members) if (m.role === "owner") ids.add(m.id);
  for (const id of extraMemberIds) if (members.some((m) => m.id === id)) ids.add(id);
  return members.filter((m) => ids.has(m.id));
}

/**
 * Fan a notification out on every channel the org enabled for the pref.
 * Email is NOT sent here — the existing per-event email paths own that
 * (they render richer bodies); this covers in-app rows and the sms channel.
 */
export async function notifyMembers(args: {
  org: typeof crmOrgs.$inferSelect;
  pref: CrmNotificationPref;
  type?: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Beyond the owners — e.g. the estimate's creator. */
  extraMemberIds?: string[];
  /** Members who caused the event and shouldn't be pinged about themselves. */
  excludeMemberIds?: string[];
  /** True when the caller already texts through its own gated path. */
  smsHandled?: boolean;
}): Promise<void> {
  try {
    const { org, pref } = args;
    const exclude = new Set(args.excludeMemberIds ?? []);
    const recipients = (await recipientMembers(org.id, args.extraMemberIds ?? []))
      .filter((m) => !exclude.has(m.id));
    if (!recipients.length) return;

    if (crmNotificationChannel(org.customFields, pref, "inApp")) {
      await db.insert(crmNotifications).values(recipients.map((m) => ({
        orgId: org.id, memberId: m.id, type: args.type ?? pref,
        title: args.title.slice(0, 300),
        body: args.body ? String(args.body).slice(0, 1000) : null,
        link: args.link ?? null,
      }))).catch((e: any) => console.error("[crm] notification insert failed:", e?.message || e));
    }

    if (!args.smsHandled && crmNotificationChannel(org.customFields, pref, "sms") && resolveSmsSender(org.customFields)) {
      const numbers = new Set<string>();
      for (const m of recipients) {
        const p = normalizePhone(m.phone);
        if (p) numbers.add(p);
      }
      if (!numbers.size) {
        const fallback = normalizePhone(org.phone);
        if (fallback) numbers.add(fallback);
      }
      for (const to of numbers) {
        await sendSms(to, `${org.name}: ${args.title}`.slice(0, 320), org.customFields)
          .catch((e: any) => console.error("[crm] notification sms failed:", e?.message || e));
      }
    }
  } catch (e: any) {
    console.error("[crm] notifyMembers failed:", e?.message || e);
  }
}

export function registerCrmNotificationRoutes(app: Express, getDevUser: GetUser): void {
  /** My notifications, newest first, with the unread count for the badge. */
  app.get("/api/crm/notifications", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "30")) || 30));
    const rows = await db.select().from(crmNotifications)
      .where(and(eq(crmNotifications.orgId, ctx.org.id), eq(crmNotifications.memberId, ctx.member.id)))
      .orderBy(desc(crmNotifications.createdAt)).limit(limit);
    const [{ n: unread }] = await db.select({ n: sql<number>`count(*)::int` }).from(crmNotifications)
      .where(and(
        eq(crmNotifications.orgId, ctx.org.id),
        eq(crmNotifications.memberId, ctx.member.id),
        isNull(crmNotifications.readAt),
      ));
    res.json({ unread, notifications: rows });
  });

  app.post("/api/crm/notifications/read-all", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    await db.update(crmNotifications).set({ readAt: new Date() })
      .where(and(
        eq(crmNotifications.orgId, ctx.org.id),
        eq(crmNotifications.memberId, ctx.member.id),
        isNull(crmNotifications.readAt),
      ));
    res.json({ ok: true });
  });

  app.post("/api/crm/notifications/:id/read", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const parsed = z.string().min(1).max(64).safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ ok: false });
    await db.update(crmNotifications).set({ readAt: new Date() })
      .where(and(
        eq(crmNotifications.id, parsed.data),
        eq(crmNotifications.orgId, ctx.org.id),
        eq(crmNotifications.memberId, ctx.member.id),
      ));
    res.json({ ok: true });
  });
}
