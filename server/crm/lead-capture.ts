/**
 * Lead capture — the embeddable "contact us" form for the contractor's own
 * marketing site. A submission lands in the CRM as a client/lead (lead source
 * "Website", tag "website-lead") and emails the owner.
 *
 * The token lives in crm_orgs.custom_fields->leadCaptureToken, minted lazily
 * on first read (the same provisioning idiom as the calendar feed token). It
 * is `${orgId}.${random}`: the org id prefix lets the public routes look the
 * org up directly, the random half is the unguessable credential. Unlike the
 * calendar feed it is stored raw, not hashed — a leak buys an attacker only
 * the ability to CREATE a lead (spam), never to read anything, and rotation
 * is one click away.
 *
 * The public POST is deliberately boring from the outside: honeypot hits and
 * rate-limited requests get the exact same 201 { ok: true } as a real lead —
 * the response can never be an oracle for whether a submission "worked".
 *
 * NOTE on the notification pref: 'leadReceived' is intentionally NOT added to
 * the shared CRM_NOTIFICATION_PREFS list — shared/schema.ts belongs to a
 * parallel workstream (same situation portal.ts documents for
 * 'contractSigned'). crmNotificationEnabled treats an absent key as ON either
 * way, and the cast keeps tsc honest about that.
 */
import type { Express } from "express";
import { randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  crmOrgs,
  crmMembers,
  crmCustomers,
  crmLeadSources,
  crmNotificationEnabled,
  type CrmNotificationPref,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireOrg, requirePermission } from "./tenancy";
import { portalBaseUrl } from "../site-context";
import { sendWithFallback } from "../email";
import { allow } from "./client-auth";

type GetUser = (req: any, res: any) => any;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

const clientIp = (req: any) =>
  String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0].trim().slice(0, 60);

// 10 leads per IP per 15 minutes — generous for a real person refreshing,
// a wall for a script. Shares the client-auth fixed-window buckets.
const IP_LIMIT = 10;

// ── Token ───────────────────────────────────────────────────────────────────

function leadTokenOf(org: typeof crmOrgs.$inferSelect): string | null {
  const cf = (org.customFields ?? {}) as Record<string, any>;
  return typeof cf.leadCaptureToken === "string" && cf.leadCaptureToken ? cf.leadCaptureToken : null;
}

/** Mint (or rotate) the org's token; returns the raw token. */
async function mintLeadToken(orgId: string): Promise<string> {
  const token = `${orgId}.${randomBytes(24).toString("hex")}`;
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, orgId)).limit(1);
  const cf = { ...((org?.customFields ?? {}) as Record<string, any>) };
  cf.leadCaptureToken = token;
  cf.leadCaptureRotatedAt = new Date().toISOString();
  await db
    .update(crmOrgs)
    .set({ customFields: cf, updatedAt: new Date() })
    .where(eq(crmOrgs.id, orgId));
  return token;
}

/** Resolve a presented token to its org, or null. Never leaks which part failed. */
async function orgForLeadToken(token: string): Promise<typeof crmOrgs.$inferSelect | null> {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, token.slice(0, dot))).limit(1);
  if (!org) return null;
  const expected = leadTokenOf(org);
  if (!expected) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return org;
}

// ── Lead intake ─────────────────────────────────────────────────────────────

const leadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  message: z.string().trim().max(5000).nullish(),
  address: z.string().trim().max(300).nullish(),
  // Honeypot: invisible to humans, irresistible to bots. Must come back empty.
  website: z.string().max(300).nullish(),
});

/** The per-org "Website" lead source, created on first use. */
async function websiteLeadSourceId(orgId: string): Promise<string> {
  const [existing] = await db.select().from(crmLeadSources)
    .where(and(eq(crmLeadSources.orgId, orgId), sql`lower(${crmLeadSources.name}) = 'website'`))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db.insert(crmLeadSources).values({ orgId, name: "Website" }).returning();
  return row.id;
}

/** The member a website lead belongs to: the org owner's seat. */
async function orgOwnerMember(org: typeof crmOrgs.$inferSelect) {
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
  return (
    members.find((m) => m.userId === org.ownerUserId) ??
    members.find((m) => m.role === "owner") ??
    null
  );
}

/**
 * Tell the office a lead came in: the lead's owner member, plus the org owner
 * when that is a different person. Gated by the org's 'leadReceived'
 * notificationPref (default ON). Best-effort — a dead SMTP never loses a lead.
 */
async function notifyLeadReceived(
  org: typeof crmOrgs.$inferSelect,
  owner: typeof crmMembers.$inferSelect | null,
  lead: { name: string; email?: string | null; phone?: string | null; message?: string | null },
) {
  if (!crmNotificationEnabled(org.customFields, "leadReceived" as CrmNotificationPref)) return;

  const recipients = new Set<string>();
  if (owner?.email) recipients.add(owner.email);
  const members = await db.select().from(crmMembers)
    .where(and(eq(crmMembers.orgId, org.id), eq(crmMembers.status, "active")));
  for (const m of members) {
    if (m.role === "owner" && m.email) recipients.add(m.email);
  }
  if (!recipients.size) return;

  const contact = [lead.email, lead.phone].filter(Boolean).map(esc).join(" · ");
  await sendWithFallback({
    to: [...recipients].join(","),
    subject: `🌐 New website lead — ${lead.name}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
      `<p><strong>${esc(lead.name)}</strong> just sent a message through your website lead form.</p>` +
      (contact ? `<p>${contact}</p>` : "") +
      (lead.message ? `<p style="white-space:pre-wrap">${esc(lead.message)}</p>` : "") +
      `<p>The lead is waiting in Clients, tagged <strong>website-lead</strong>.</p></div>`,
  } as any).catch((e: any) => console.error("[crm] lead notify failed:", e?.message || e));
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerCrmLeadCaptureRoutes(app: Express, getDevUser: GetUser): void {
  /** The org's lead-capture token + form URL + a recent-lead count. Mints on first read. */
  app.get("/api/crm/integrations/lead-capture", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;

    const token = leadTokenOf(ctx.org) ?? (await mintLeadToken(ctx.org.id));
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` })
      .from(crmCustomers)
      .where(and(
        eq(crmCustomers.orgId, ctx.org.id),
        sql`${"website-lead"} = any(${crmCustomers.tags})`,
        sql`${crmCustomers.createdAt} > now() - interval '30 days'`,
      ));

    res.json({
      token,
      formUrl: `${portalBaseUrl(req)}/lead-form/${token}`,
      leads30d: n,
    });
  });

  /** Rotate: every embedded copy and shared link of the old form dies. */
  app.post("/api/crm/integrations/lead-capture/rotate", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    if (!requirePermission(res, ctx, "manageIntegrations")) return;

    const token = await mintLeadToken(ctx.org.id);
    res.json({ token, formUrl: `${portalBaseUrl(req)}/lead-form/${token}` });
  });

  /** Public: just enough for the embedded form's header — name and logo, nothing else. */
  app.get("/api/public/leads/:token", async (req: any, res) => {
    const org = await orgForLeadToken(String(req.params.token || ""));
    if (!org) return res.status(404).json({ message: "This form is no longer available." });
    res.json({ name: org.name, logoUrl: org.logoUrl ?? null });
  });

  /**
   * Public intake. Anti-enumeration: a filled honeypot or a tripped rate
   * limit gets the same 201 { ok: true } as a real lead — it just creates
   * nothing and notifies nobody.
   */
  app.post("/api/public/leads/:token", async (req: any, res) => {
    const org = await orgForLeadToken(String(req.params.token || ""));
    if (!org) return res.status(404).json({ message: "This form is no longer available." });

    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid submission", issues: parsed.error.issues });

    const { name, email, phone, message, address, website } = parsed.data;
    // Bots fill the invisible field; humans never see it. Pretend it worked.
    if (website) return res.status(201).json({ ok: true });
    if (!allow(`lead:${clientIp(req)}`, IP_LIMIT)) return res.status(201).json({ ok: true });

    const owner = await orgOwnerMember(org);
    const leadSourceId = await websiteLeadSourceId(org.id);
    await db.insert(crmCustomers).values({
      orgId: org.id,
      displayName: name,
      email: email || null,
      phone: phone || null,
      addressLine1: address || null,
      notes: message || null,
      leadSourceId,
      ownerMemberId: owner?.id ?? null,
      tags: ["website-lead"],
      portalToken: randomBytes(24).toString("hex"),
    });

    notifyLeadReceived(org, owner, { name, email, phone, message })
      .catch((e: any) => console.error("[crm] lead notify failed:", e?.message || e));
    res.status(201).json({ ok: true });
  });
}
