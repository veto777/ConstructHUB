/**
 * The Messages center — every client message in one place, threaded per
 * client, unread/read like text messages.
 *
 *  GET  /api/crm/inbox                    — thread list (latest message,
 *                                           unread count per client) + total
 *  GET  /api/crm/inbox/:customerId        — the full two-way thread
 *  POST /api/crm/inbox/:customerId/reply  — reply: lands in the client's
 *                                           portal AND their email; marks
 *                                           the thread read
 *  POST /api/crm/inbox/:customerId/read   — mark thread read without replying
 *  GET  /api/client/comments              — portal: the client's own thread
 *                                           (so they see replies)
 *
 * A client waiting hours for an answer is the #1 way to lose a job — the
 * sidebar badge and the "waiting" timers exist to make silence loud.
 */
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  crmClientComments, crmCustomers, crmMembers, crmEstimates, crmOrgs,
  crmProjects, crmJobs,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrg } from "./tenancy";
import { requireClient, allow as rateAllow } from "./client-auth";
import { sendWithFallback } from "../email";

type GetUser = (req: any, res: any) => any;

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));

async function estimateRefs(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await db.select({ id: crmEstimates.id, number: crmEstimates.number })
    .from(crmEstimates)
    .where(and(eq(crmEstimates.orgId, orgId), inArray(crmEstimates.id, ids)));
  for (const r of rows) if (r.number) map.set(r.id, r.number);
  return map;
}

export function registerCrmInboxRoutes(app: Express, getDevUser: GetUser): void {
  // ── Contractor: thread list ───────────────────────────────────────────────
  app.get("/api/crm/inbox", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;

    // One row per client: newest message + unread count (client-authored,
    // never our own replies).
    const threads = await db.execute(sql`
      SELECT c.customer_id            AS "customerId",
             cust.display_name        AS "customerName",
             max(c.created_at)        AS "lastAt",
             count(*) FILTER (WHERE c.author_member_id IS NULL AND c.read_at IS NULL)::int AS "unread",
             (array_agg(c.body ORDER BY c.created_at DESC))[1]             AS "lastBody",
             (array_agg(c.author_member_id ORDER BY c.created_at DESC))[1] AS "lastAuthorMemberId",
             min(c.created_at) FILTER (WHERE c.author_member_id IS NULL AND c.read_at IS NULL) AS "oldestUnreadAt"
      FROM crm_client_comments c
      JOIN crm_customers cust ON cust.id = c.customer_id
      WHERE c.org_id = ${ctx.org.id}
      GROUP BY c.customer_id, cust.display_name
      ORDER BY max(c.created_at) DESC
      LIMIT 200
    `);
    const rows = (threads as any).rows ?? threads;
    const unreadTotal = rows.reduce((n: number, t: any) => n + (t.unread ?? 0), 0);
    res.json({ unreadTotal, threads: rows });
  });

  // ── Contractor: one thread ────────────────────────────────────────────────
  app.get("/api/crm/inbox/:customerId", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.customerId)))
      .limit(1);
    if (!cust) return res.status(404).json({ message: "Client not found" });

    const msgs = await db.select().from(crmClientComments)
      .where(and(eq(crmClientComments.orgId, ctx.org.id), eq(crmClientComments.customerId, cust.id)))
      .orderBy(desc(crmClientComments.createdAt)).limit(500);
    const members = await db.select().from(crmMembers).where(eq(crmMembers.orgId, ctx.org.id));
    const refs = await estimateRefs(ctx.org.id, [...new Set(msgs.map((m) => m.estimateId).filter(Boolean))] as string[]);

    res.json({
      customer: { id: cust.id, displayName: cust.displayName, email: cust.email },
      messages: msgs.reverse().map((m) => ({
        id: m.id,
        body: m.body,
        fromClient: !m.authorMemberId,
        authorName: m.authorMemberId
          ? (() => { const a = members.find((x) => x.id === m.authorMemberId); return (a?.displayName || a?.email) ?? "Team"; })()
          : cust.displayName,
        toMemberName: m.toMemberId
          ? (() => { const t = members.find((x) => x.id === m.toMemberId); return t ? (t.displayName || t.email) : null; })()
          : null,
        estimateNumber: m.estimateId ? refs.get(m.estimateId) ?? null : null,
        createdAt: m.createdAt,
        readAt: m.readAt,
      })),
    });
  });

  // ── Contractor: mark read ─────────────────────────────────────────────────
  app.post("/api/crm/inbox/:customerId/read", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    await db.update(crmClientComments).set({ readAt: new Date() })
      .where(and(
        eq(crmClientComments.orgId, ctx.org.id),
        eq(crmClientComments.customerId, req.params.customerId),
        isNull(crmClientComments.authorMemberId),
        isNull(crmClientComments.readAt),
      ));
    res.json({ ok: true });
  });

  // ── Contractor: reply — portal thread + email to the client ───────────────
  app.post("/api/crm/inbox/:customerId/reply", async (req: any, res) => {
    const user = getDevUser(req, res);
    if (!user) return;
    const ctx = await requireOrg(req, res, user.id);
    if (!ctx) return;
    const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "Write a message first" });
    const [cust] = await db.select().from(crmCustomers)
      .where(and(eq(crmCustomers.orgId, ctx.org.id), eq(crmCustomers.id, req.params.customerId)))
      .limit(1);
    if (!cust) return res.status(404).json({ message: "Client not found" });

    const [row] = await db.insert(crmClientComments).values({
      orgId: ctx.org.id,
      customerId: cust.id,
      body: parsed.data.body.trim(),
      authorMemberId: ctx.member.id,
      readAt: new Date(), // our own message is never "unread" for us
    }).returning();

    // Replying answers the thread — clear the unread flags.
    await db.update(crmClientComments).set({ readAt: new Date() })
      .where(and(
        eq(crmClientComments.orgId, ctx.org.id),
        eq(crmClientComments.customerId, cust.id),
        isNull(crmClientComments.authorMemberId),
        isNull(crmClientComments.readAt),
      ));

    // The client is not sitting in the portal — the reply goes to their email
    // too, from the member who wrote it (reply-to their address).
    if (cust.email) {
      const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, ctx.org.id)).limit(1);
      const from = ctx.member.displayName || org?.name || "Your contractor";
      await sendWithFallback({
        to: cust.email,
        subject: `💬 New message from ${org?.name ?? from}`,
        replyTo: ctx.member.email || org?.email || undefined,
        html: `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">
            <p style="font-size:16px"><strong>${esc(from)}</strong> replied to your message:</p>
            <blockquote style="border-left:3px solid #4f46e5;margin:16px 0;padding:8px 14px;color:#333;white-space:pre-wrap">${esc(parsed.data.body.trim())}</blockquote>
            <p style="font-size:14px;color:#555">You can reply to this email directly, or answer from your client portal.</p>
          </div>`,
      } as any).catch((e: any) => console.error("[crm] inbox reply email failed:", String(e?.message || e).slice(0, 300)));
    }

    res.status(201).json({ id: row.id, createdAt: row.createdAt });
  });

  // ── Client portal: the people on my job + how to reach the office ─────────
  app.get("/api/client/team", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    const customerId = String(req.query.customerId || "");
    if (!client.customerIds.includes(customerId)) {
      return res.status(403).json({ message: "That is not your account" });
    }
    const [cust] = await db.select().from(crmCustomers)
      .where(eq(crmCustomers.id, customerId)).limit(1);
    if (!cust) return res.status(404).json({ message: "Not found" });

    const [org] = await db.select().from(crmOrgs).where(eq(crmOrgs.id, cust.orgId)).limit(1);
    const members = await db.select().from(crmMembers)
      .where(and(eq(crmMembers.orgId, cust.orgId), eq(crmMembers.status, "active")));

    // Everyone attached to this client's work: project PM + sales rep, the
    // crews assigned to the jobs, and whoever wrote their estimates.
    const projects = await db.select().from(crmProjects)
      .where(and(eq(crmProjects.orgId, cust.orgId), eq(crmProjects.customerId, customerId)));
    const ids = new Set<string>();
    for (const p of projects) {
      if (p.projectManagerMemberId) ids.add(p.projectManagerMemberId);
      if (p.salesMemberId) ids.add(p.salesMemberId);
    }
    if (projects.length) {
      const jobs = await db.select().from(crmJobs)
        .where(and(eq(crmJobs.orgId, cust.orgId),
          inArray(crmJobs.projectId, projects.map((p) => p.id))));
      for (const j of jobs) for (const id of j.assignedMemberIds ?? []) ids.add(id);
    }
    const ests = await db.select({ createdByMemberId: crmEstimates.createdByMemberId })
      .from(crmEstimates)
      .where(and(eq(crmEstimates.orgId, cust.orgId), eq(crmEstimates.customerId, customerId)));
    for (const e of ests) if (e.createdByMemberId) ids.add(e.createdByMemberId);

    const roleLabel = (r: string) =>
      r === "owner" ? "Owner" : r === "admin" ? "Project Manager"
      : r === "sales" ? "Sales" : "Team";
    const team = members
      .filter((m) => ids.has(m.id))
      .map((m) => ({
        memberId: m.id,
        name: m.displayName || m.email || "Team member",
        role: roleLabel(m.role),
        email: m.email,
        phone: m.phone,
      }));

    res.json({
      office: {
        name: org?.name ?? null,
        email: org?.email ?? null,
        phone: org?.phone ?? null,
        website: org?.website ?? null,
      },
      team,
    });
  });

  // ── Client portal: the client's own thread (they see replies) ─────────────
  app.get("/api/client/comments", async (req: any, res) => {
    const client = await requireClient(req, res);
    if (!client) return;
    const customerId = String(req.query.customerId || "");
    if (!client.customerIds.includes(customerId)) {
      return res.status(403).json({ message: "That is not your account" });
    }
    if (!rateAllow(`ccthread:${customerId}`, 60)) {
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    const msgs = await db.select().from(crmClientComments)
      .where(eq(crmClientComments.customerId, customerId))
      .orderBy(desc(crmClientComments.createdAt)).limit(200);
    const orgId = msgs[0]?.orgId;
    const members = orgId
      ? await db.select().from(crmMembers).where(eq(crmMembers.orgId, orgId))
      : [];
    res.json({
      messages: msgs.reverse().map((m) => ({
        id: m.id,
        body: m.body,
        fromMe: !m.authorMemberId,
        authorName: m.authorMemberId
          ? (() => { const a = members.find((x) => x.id === m.authorMemberId); return (a?.displayName || a?.email) ?? "Your contractor"; })()
          : "You",
        toMemberName: m.toMemberId
          ? (() => { const t = members.find((x) => x.id === m.toMemberId); return t ? (t.displayName || t.email) : null; })()
          : null,
        createdAt: m.createdAt,
      })),
    });
  });
}
