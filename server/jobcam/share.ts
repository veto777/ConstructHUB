/**
 * JobCam sharing:
 *   - Member routes (manageJobs|manageCustomers): create / list / revoke share
 *     links on a project, send one by email or text with the project's client
 *     prefilled — through the CRM's own senders (sendWithFallback, sendSms),
 *     recorded on the client timeline like a quick message.
 *   - Public /api/jc/:token: a branded gallery (fixed set) or live timeline,
 *     optional password (signed cookie once entered), expiry, revocation and
 *     a view counter. Every file read is gated by the same access check.
 *   - Client portal /api/client/jobcam: the shots a team member switched on for
 *     the client (client_visible) from the homeowner's projects — read-only,
 *     scoped to the session's customer ids like every portal read. Share links
 *     are their own explicit act of sharing and do not consult that flag.
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { crmCustomerNotes, crmCustomers, crmOrgs, crmProjects, jobcamMedia, jobcamShareLinks } from "@shared/schema";
import type { JobcamShareLink } from "@shared/schema";
import { requireOrg, type OrgContext } from "../crm/tenancy";
import { allow as rateAllow, requireClient } from "../crm/client-auth";
import { sendWithFallback } from "../email";
import { normalizePhone, sendSms, orgSmsEntitled, smsPlanRequired, resolveSmsSender, orgCanTextClients, CLIENT_TEXT_NEEDS_OWN_NUMBER, smsMissingEnv } from "../crm/sms";
import { sendLimitReached } from "../entitlements";
import { portalBaseUrl } from "../site-context";
import { logActivity } from "../crm/activity";
import { messageNoteBody } from "../crm/messages";
import { canManageJobcam, visibleProject } from "./access";
import { requireJobcamPlan } from "./plan";
import { presentMedia, projectSummary, membersMap, streamVariant, queryFeed, parseFeedParams, feedCursor, portalMediaWhere } from "./routes";
import { expiryFromPreset, hashSharePassword, looksLikeShareToken, newShareToken, safeEqual, shareAccess, shareLinkState, shareSecret, signShareSession, verifySharePassword } from "./share-auth";

type GetUser = (req: any, res: any) => any;

const COOKIE = "jobcam_share";
const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

function cookies(req: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip a malformed cookie */ }
  }
  return out;
}
/** One cookie holds every unlocked link: "token.sig token.sig …" (a viewer may open several). */
function unlockedSig(req: any, token: string): string | null {
  const raw = cookies(req)[COOKIE] || "";
  for (const entry of raw.split(" ")) {
    const [t, sig] = entry.split(".");
    if (t === token && sig) return sig;
  }
  return null;
}
function rememberUnlock(req: any, res: any, token: string, secret: string) {
  const keep = (cookies(req)[COOKIE] || "").split(" ").filter((e) => e && !e.startsWith(`${token}.`)).slice(-9);
  const value = [...keep, `${token}.${signShareSession(token, secret)}`].join(" ");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
}
// Empty when unset in production: every password check then fails closed (share-auth.ts).
const secret = () => shareSecret() ?? "";
const cleanLine = (v?: string | null) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
const clientIp = (req: any) => String(req?.ip || req?.socket?.remoteAddress || "unknown");

export function presentShare(s: JobcamShareLink, baseUrl: string) {
  return {
    id: s.id, projectId: s.projectId, kind: s.kind, title: s.title, mediaIds: s.mediaIds ?? [], showDetails: s.showDetails,
    hasPassword: !!s.passwordHash, expiresAt: s.expiresAt, revokedAt: s.revokedAt, viewCount: s.viewCount, lastViewedAt: s.lastViewedAt,
    sentTo: (s.sentTo as any[]) ?? [], createdAt: s.createdAt, state: shareLinkState(s),
    url: `${baseUrl}/jc/${s.token}`,
  };
}

export function registerJobcamShareRoutes(app: Express, getDevUser: GetUser): void {
  const ctxFor = async (req: any, res: any): Promise<OrgContext | null> => {
    const user = getDevUser(req, res);
    if (!user) return null;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return null;
    if (!canManageJobcam(ctx)) { res.status(403).json({ message: "Requires permission: manageJobs" }); return null; }
    return ctx;
  };

  // ── Member: share links on a project ──────────────────────────────────────

  app.get("/api/crm/projects/:projectId/jobcam/shares", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    if (!(await visibleProject(ctx, req.params.projectId))) return res.status(404).json({ message: "Project not found" });
    const rows = await db.select().from(jobcamShareLinks)
      .where(and(eq(jobcamShareLinks.orgId, ctx.org.id), eq(jobcamShareLinks.projectId, req.params.projectId)))
      .orderBy(desc(jobcamShareLinks.createdAt)).limit(100);
    res.json(rows.map((s) => presentShare(s, portalBaseUrl(req))));
  });

  app.post("/api/crm/projects/:projectId/jobcam/shares", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    if (!(await requireJobcamPlan(res, ctx))) return;
    const project = await visibleProject(ctx, req.params.projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });
    const parsed = z.object({
      kind: z.enum(["gallery", "timeline"]),
      title: z.string().trim().max(120).optional().nullable(),
      mediaIds: z.array(z.string().max(64)).max(2000).optional(),
      password: z.string().min(4).max(100).optional().nullable(),
      expires: z.enum(["never", "7d", "30d", "90d", "custom"]).optional(),
      expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
      showDetails: z.boolean().optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Invalid share link", issues: parsed.error.issues });
    const b = parsed.data;
    let mediaIds: string[] | null = null;
    if (b.kind === "gallery") {
      // Only this project's own, ready media can be in a gallery.
      const ids = b.mediaIds ?? [];
      const rows = ids.length ? await db.select({ id: jobcamMedia.id }).from(jobcamMedia)
        .where(and(eq(jobcamMedia.orgId, ctx.org.id), eq(jobcamMedia.projectId, project.id), isNull(jobcamMedia.deletedAt), eq(jobcamMedia.status, "ready"), inArray(jobcamMedia.id, ids))) : [];
      if (!rows.length) return res.status(400).json({ message: "Pick at least one photo or video for a gallery link (or share the live timeline)." });
      const keep = new Set(rows.map((r) => r.id));
      mediaIds = ids.filter((i) => keep.has(i));
    }
    let expiresAt: Date | null = expiryFromPreset(b.expires);
    if (b.expires === "custom" && b.expiresAt) {
      const d = new Date(b.expiresAt);
      if (!Number.isFinite(d.getTime()) || d.getTime() < Date.now()) return res.status(400).json({ message: "The expiry must be in the future." });
      expiresAt = d;
    }
    const [row] = await db.insert(jobcamShareLinks).values({
      orgId: ctx.org.id, projectId: project.id, kind: b.kind, token: newShareToken(),
      title: cleanLine(b.title) || (b.kind === "gallery" ? `${project.name} — photos` : `${project.name} — live timeline`),
      mediaIds, showDetails: b.showDetails ?? true, passwordHash: b.password ? hashSharePassword(b.password) : null,
      expiresAt, createdByMemberId: ctx.member.id, sentTo: [],
    }).returning();
    logActivity(ctx, "jobcam.share.created", { entityType: "jobcam_share", entityId: row.id, customerId: project.customerId, meta: { kind: row.kind, projectId: project.id } });
    res.status(201).json(presentShare(row, portalBaseUrl(req)));
  });

  const shareFor = async (ctx: OrgContext, id: string) => {
    const [s] = await db.select().from(jobcamShareLinks).where(and(eq(jobcamShareLinks.orgId, ctx.org.id), eq(jobcamShareLinks.id, id))).limit(1);
    if (!s) return null;
    return (await visibleProject(ctx, s.projectId)) ? s : null;
  };

  app.post("/api/crm/jobcam/shares/:id/revoke", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const s = await shareFor(ctx, req.params.id);
    if (!s) return res.status(404).json({ message: "Share link not found" });
    const [row] = await db.update(jobcamShareLinks).set({ revokedAt: s.revokedAt ?? new Date() }).where(eq(jobcamShareLinks.id, s.id)).returning();
    logActivity(ctx, "jobcam.share.revoked", { entityType: "jobcam_share", entityId: s.id, meta: { kind: s.kind, projectId: s.projectId } });
    res.json(presentShare(row, portalBaseUrl(req)));
  });

  app.delete("/api/crm/jobcam/shares/:id", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const s = await shareFor(ctx, req.params.id);
    if (!s) return res.status(404).json({ message: "Share link not found" });
    await db.delete(jobcamShareLinks).where(eq(jobcamShareLinks.id, s.id));
    res.json({ ok: true });
  });

  /** Send the link by email or text — the project's client is the default recipient (the UI prefills it). */
  app.post("/api/crm/jobcam/shares/:id/send", async (req: any, res) => {
    const ctx = await ctxFor(req, res); if (!ctx) return;
    const s = await shareFor(ctx, req.params.id);
    if (!s) return res.status(404).json({ message: "Share link not found" });
    if (shareLinkState(s) !== "ok") return res.status(409).json({ message: `This link is ${shareLinkState(s)} — make a new one.` });
    const parsed = z.object({
      channel: z.enum(["email", "text"]),
      to: z.string().trim().min(3).max(320),
      message: z.string().trim().max(1000).optional().nullable(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Enter who to send it to", issues: parsed.error.issues });
    const { channel, message } = parsed.data;
    if (!rateAllow(`jcsend:${ctx.member.id}`, 30)) return res.status(429).json({ message: "That's a lot of sends — wait a few minutes." });
    const [project] = await db.select().from(crmProjects).where(and(eq(crmProjects.orgId, ctx.org.id), eq(crmProjects.id, s.projectId))).limit(1);
    const [customer] = project ? await db.select().from(crmCustomers).where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, project.customerId))).limit(1) : [];
    const url = `${portalBaseUrl(req)}/jc/${s.token}`;
    const what = s.kind === "gallery" ? "photos" : "live photo timeline";
    let to: string;
    if (channel === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.data.to)) return res.status(400).json({ message: "That email address doesn't look right." });
      to = parsed.data.to;
      await sendWithFallback({
        to,
        subject: cleanLine(`${s.title || `${project?.name ?? "Your project"} ${what}`} — from ${ctx.org.name}`).slice(0, 200),
        replyTo: ctx.org.email || undefined,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
          ${ctx.org.logoUrl ? `<img src="${esc(ctx.org.logoUrl)}" alt="" style="max-height:48px;margin-bottom:12px">` : ""}
          <p style="font-size:16px"><strong>${esc(ctx.org.name)}</strong> shared ${esc(what)} from <strong>${esc(project?.name ?? "your project")}</strong>.</p>
          ${message ? `<p style="font-size:15px;white-space:pre-wrap;border-left:3px solid #1a73e8;padding:8px 14px;color:#333">${esc(message)}</p>` : ""}
          <p><a href="${esc(url)}" style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600">Open the ${esc(what)}</a></p>
          <p style="font-size:12px;color:#666">${s.passwordHash ? "This link is password-protected — the password was shared with you separately." : ""}${s.expiresAt ? ` It expires ${new Date(s.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.` : ""}</p>
          <p style="font-size:12px;color:#999">— ${esc(ctx.org.name)}${ctx.org.phone ? ` · ${esc(ctx.org.phone)}` : ""}</p>
        </div>`,
      } as any);
    } else {
      // The same honesty rules as quick messages: texting a client needs the
      // org's own number, a plan that includes texting, and a carrier.
      if (!(await orgSmsEntitled(ctx.org.id))) return res.status(402).json(smsPlanRequired());
      if (resolveSmsSender(ctx.org.customFields) && !orgCanTextClients(ctx.org.customFields)) return res.status(409).json({ message: CLIENT_TEXT_NEEDS_OWN_NUMBER });
      if (!resolveSmsSender(ctx.org.customFields)) {
        return res.status(409).json({ message: `Texting is off — enable it in Settings → Integrations (set ${smsMissingEnv().join(", ")} on the server).`, missing: smsMissingEnv() });
      }
      const phone = normalizePhone(parsed.data.to);
      if (!phone) return res.status(400).json({ message: "That phone number doesn't look right." });
      to = phone;
      const body = `${ctx.org.name}: ${message ? `${message} ` : ""}${project?.name ? `${project.name} ${what}: ` : ""}${url}`;
      const r = await sendSms(to, body, ctx.org.customFields, ctx.org.id);
      if (!r.ok) {
        if (r.limit) return sendLimitReached(res, r.limit);
        return res.status(502).json({ message: `The text could not be sent: ${r.error ?? "provider error"}` });
      }
    }
    const sent = [...((s.sentTo as any[]) ?? []), { channel, to, at: new Date().toISOString(), by: ctx.member.displayName || ctx.member.email }].slice(-50);
    const [row] = await db.update(jobcamShareLinks).set({ sentTo: sent }).where(eq(jobcamShareLinks.id, s.id)).returning();
    if (customer) {
      await db.insert(crmCustomerNotes).values({
        orgId: ctx.org.id, customerId: customer.id, authorMemberId: ctx.member.id,
        body: messageNoteBody(channel, to, `${s.title || what}: ${url}`),
      }).catch(() => {});
    }
    logActivity(ctx, "jobcam.share.sent", { entityType: "jobcam_share", entityId: s.id, customerId: customer?.id ?? null, meta: { channel, to, kind: s.kind } });
    res.json({ ok: true, channel, to, share: presentShare(row, portalBaseUrl(req)) });
  });

  // ── Public: /api/jc/:token ────────────────────────────────────────────────

  const linkByToken = async (token: string) => {
    if (!looksLikeShareToken(token)) return null;
    const [s] = await db.select().from(jobcamShareLinks).where(eq(jobcamShareLinks.token, token)).limit(1);
    // The unique index found the row; the constant-time compare is the actual auth decision.
    return s && safeEqual(s.token, token) ? s : null;
  };
  /** A link only ever serves a project that still exists in its own org. */
  const projectOf = async (s: JobcamShareLink) => {
    const [p] = await db.select().from(crmProjects).where(and(eq(crmProjects.orgId, s.orgId), eq(crmProjects.id, s.projectId))).limit(1);
    return p ?? null;
  };
  const shareBase = (token: string) => `/api/jc/${token}/media`;

  app.get("/api/jc/:token", async (req: any, res) => {
    const s = await linkByToken(String(req.params.token));
    if (!s) return res.status(404).json({ message: "This link isn't valid." });
    const state = shareLinkState(s);
    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, s.orgId)).limit(1);
    const project = await projectOf(s);
    if (!project) return res.status(404).json({ message: "This link isn't valid." });
    const access = shareAccess(s, unlockedSig(req, s.token), secret());
    if (state === "ok" && access.allowed) {
      await db.update(jobcamShareLinks).set({ viewCount: sql`${jobcamShareLinks.viewCount} + 1`, lastViewedAt: new Date() }).where(eq(jobcamShareLinks.id, s.id)).catch(() => {});
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      kind: s.kind, title: access.allowed ? s.title : null, state, locked: !access.allowed && (access as any).reason === "locked",
      showDetails: s.showDetails, expiresAt: access.allowed ? s.expiresAt : null,
      org: org ? { name: org.name, logoUrl: org.logoUrl, phone: org.phone, email: org.email, website: org.website } : null,
      // Who shared it is always shown (the page is branded); WHAT was shared —
      // the job's name and address — only once the link actually opens.
      project: access.allowed ? { ...projectSummary(project), ...(s.showDetails ? {} : { address: null }) } : null,
    });
  });

  app.post("/api/jc/:token/unlock", async (req: any, res) => {
    const s = await linkByToken(String(req.params.token));
    if (!s) return res.status(404).json({ message: "This link isn't valid." });
    if (shareLinkState(s) !== "ok") return res.status(410).json({ message: `This link has been ${shareLinkState(s)}.` });
    const key = secret();
    if (!key) return res.status(503).json({ message: "Password-protected links are unavailable right now." });
    if (!rateAllow(`jcunlock:${s.id}`, 20) || !rateAllow(`jcunlock-ip:${clientIp(req)}`, 40)) return res.status(429).json({ message: "Too many tries — wait a few minutes." });
    const password = String(req.body?.password ?? "");
    if (!verifySharePassword(password, s.passwordHash)) return res.status(401).json({ message: "That password isn't right." });
    rememberUnlock(req, res, s.token, key);
    res.json({ ok: true });
  });

  const gate = async (req: any, res: any) => {
    const s = await linkByToken(String(req.params.token));
    if (!s) { res.status(404).json({ message: "This link isn't valid." }); return null; }
    const access = shareAccess(s, unlockedSig(req, s.token), secret());
    if (!access.allowed) {
      const reason = (access as any).reason as string;
      res.setHeader("Cache-Control", "no-store");
      res.status(reason === "locked" ? 401 : 410).json({ message: reason === "locked" ? "Enter the password first." : `This link has been ${reason}.`, reason });
      return null;
    }
    if (!(await projectOf(s))) { res.status(404).json({ message: "This link isn't valid." }); return null; }
    return s;
  };

  app.get("/api/jc/:token/media", async (req: any, res) => {
    const s = await gate(req, res); if (!s) return;
    const p = parseFeedParams(req.query);
    const rows = await queryFeed({
      orgId: s.orgId, projectIds: [s.projectId], mediaIds: s.kind === "gallery" ? (s.mediaIds ?? []) : null,
      tags: p.tags, tagMode: p.tagMode, kind: p.kind, limit: Math.min(p.limit, 120) + 1, before: p.before,
    });
    const page = rows.slice(0, Math.min(p.limit, 120));
    const members = s.showDetails ? await membersMap(s.orgId, true) : new Map();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      media: page.map((m) => presentMedia(m, shareBase(s.token), { guest: true, showDetails: s.showDetails, uploader: m.uploaderMemberId ? members.get(m.uploaderMemberId) ?? null : null })),
      nextCursor: rows.length > page.length ? feedCursor(page[page.length - 1]) : null,
    });
  });

  app.get("/api/jc/:token/media/:id/file/:variant", async (req: any, res) => {
    const s = await gate(req, res); if (!s) return;
    const where = [eq(jobcamMedia.orgId, s.orgId), eq(jobcamMedia.projectId, s.projectId), eq(jobcamMedia.id, req.params.id), isNull(jobcamMedia.deletedAt), eq(jobcamMedia.status, "ready")];
    if (s.kind === "gallery") where.push(inArray(jobcamMedia.id, s.mediaIds?.length ? s.mediaIds : ["-"]));
    const [m] = await db.select().from(jobcamMedia).where(and(...where)).limit(1);
    if (!m) return res.status(404).json({ message: "Not found" });
    const variant = String(req.params.variant);
    // Guests never get the untouched original unless the link allows details; the display rendition is the share copy.
    if (variant === "original" && !s.showDetails) return res.status(404).json({ message: "Not available on this link" });
    // Short cache: a revoked or expired link must stop showing its files quickly.
    await streamVariant(req, res, m, variant, req.query.download === "1", 300);
  });

  // ── Client portal: read-only feed of what the team chose to show the homeowner ──

  app.get("/api/client/jobcam", async (req: any, res) => {
    const client = await requireClient(req, res); if (!client) return;
    if (!client.customerIds.length) return res.json({ media: [], nextCursor: null });
    const projects = await db.select().from(crmProjects).where(inArray(crmProjects.customerId, client.customerIds));
    if (!projects.length) return res.json({ media: [], nextCursor: null });
    const p = parseFeedParams(req.query);
    const byId = new Map(projects.map((pr) => [pr.id, pr]));
    const orgIds = [...new Set(projects.map((pr) => pr.orgId))];
    const pages = await Promise.all(orgIds.map((orgId) => queryFeed({
      orgId, projectIds: projects.filter((pr) => pr.orgId === orgId).map((pr) => pr.id), tags: p.tags, tagMode: p.tagMode, kind: p.kind,
      clientVisibleOnly: true,
      limit: Math.min(p.limit, 120) + 1, before: p.before,
    })));
    const rows = pages.flat().sort((a, b) => (b.capturedAt ?? b.uploadedAt ?? new Date()).getTime() - (a.capturedAt ?? a.uploadedAt ?? new Date()).getTime());
    const page = rows.slice(0, Math.min(p.limit, 120));
    res.json({
      media: page.map((m) => presentMedia(m, "/api/client/jobcam", { guest: true, project: byId.has(m.projectId) ? projectSummary(byId.get(m.projectId)!) : null, showDetails: true })),
      nextCursor: rows.length > page.length ? feedCursor(page[page.length - 1]) : null,
    });
  });

  app.get("/api/client/jobcam/:id/file/:variant", async (req: any, res) => {
    const client = await requireClient(req, res); if (!client) return;
    if (!client.customerIds.length) return res.status(404).json({ message: "Not found" });
    const [m] = await db.select().from(jobcamMedia).where(portalMediaWhere(client.customerIds, String(req.params.id))).limit(1);
    if (!m) return res.status(404).json({ message: "Not found" });
    await streamVariant(req, res, m, String(req.params.variant), req.query.download === "1");
  });
}
